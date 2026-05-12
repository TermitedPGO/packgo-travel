/**
 * tripReminderService.ts — daily scan that emails customers as their
 * confirmed-booking departure date approaches.
 *
 * v77: addresses the #1 member-system gap (no trip notifications).
 *
 * Reminder schedule:
 *   - 30 days out: "trip planning, balance reminder if unpaid"
 *   - 14 days out: "passport check, packing prep"
 *   - 7 days out:  "balance due if any, weather forecast hint"
 *   - 3 days out:  "final itinerary attached, departure airport reminder"
 *   - 1 day out:   "departure tomorrow, emergency contact"
 *
 * Idempotency: a Redis SET tracks `reminder:sent:{bookingId}:{daysOut}` so
 * a single booking + window combo only ever fires once. Window is exact day
 * match (computed in UTC days since epoch) so a booking 7 days out today
 * won't trigger 7-day AND 6-day on consecutive days.
 */

import { getDb } from "../db";
import { bookings, tourDepartures, tours } from "../../drizzle/schema";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { sendTripReminderEmail, sendReviewRequestEmail, sendWinbackEmail, sendCheckinEmail } from "../email";
import { redis } from "../redis";

export type ReminderWindow = 30 | 14 | 7 | 3 | 1;
const REMINDER_WINDOWS: ReminderWindow[] = [30, 14, 7, 3, 1];

export interface ReminderScanResult {
  scanned: number;
  emailsQueued: number;
  errors: number;
  perWindow: Record<ReminderWindow, number>;
}

/**
 * Idempotency check via Redis SET. Returns true if this booking+window
 * combination already had a reminder sent — caller should skip.
 */
async function alreadySent(bookingId: number, daysOut: ReminderWindow): Promise<boolean> {
  try {
    const key = `reminder:sent:${bookingId}:${daysOut}`;
    const existed = await redis.exists(key);
    if (existed) return true;
    // Set with 60-day TTL so the key auto-expires after the trip is over
    await redis.setex(key, 60 * 24 * 60 * 60, String(Date.now()));
    return false;
  } catch (err) {
    // Redis unavailable — fail-safe: don't send (avoid duplicates over no-sends)
    console.warn("[tripReminderService] Redis check failed, skipping send to be safe:", (err as Error)?.message);
    return true;
  }
}

/**
 * Scan all confirmed bookings whose departure date falls in any of the
 * reminder windows; queue + send the appropriate email.
 */
export async function runTripReminderScan(): Promise<ReminderScanResult> {
  const db = await getDb();
  const result: ReminderScanResult = {
    scanned: 0,
    emailsQueued: 0,
    errors: 0,
    perWindow: { 30: 0, 14: 0, 7: 0, 3: 0, 1: 0 },
  };
  if (!db) return result;

  // Compute the date range we care about: any departure in the next 31 days.
  // Per-window matching happens in JS so we only need one DB query.
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfWindow = new Date(startOfToday.getTime() + 31 * 24 * 60 * 60 * 1000);

  // Pull active bookings + their departure dates + tour title, JOINed.
  // Filter to confirmed/pending bookings (skip cancelled/refunded).
  const rows = await db
    .select({
      bookingId: bookings.id,
      customerName: bookings.customerName,
      customerEmail: bookings.customerEmail,
      customerLanguage: bookings.customerLanguage, // v78y
      bookingStatus: bookings.bookingStatus,
      paymentStatus: bookings.paymentStatus,
      remainingAmount: bookings.remainingAmount,
      currency: bookings.currency,
      departureDate: tourDepartures.departureDate,
      returnDate: tourDepartures.returnDate,
      tourId: bookings.tourId,
      tourTitle: tours.title,
    })
    .from(bookings)
    .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
    .leftJoin(tours, eq(bookings.tourId, tours.id))
    .where(
      and(
        inArray(bookings.bookingStatus, ["pending", "confirmed"]),
        gte(tourDepartures.departureDate, startOfToday),
        lte(tourDepartures.departureDate, endOfWindow)
      )
    );

  result.scanned = rows.length;

  for (const row of rows) {
    if (!row.departureDate || !row.customerEmail) continue;
    // Compute days until departure in UTC days
    const dep = new Date(row.departureDate);
    const depUtc = new Date(Date.UTC(dep.getUTCFullYear(), dep.getUTCMonth(), dep.getUTCDate()));
    const diffMs = depUtc.getTime() - startOfToday.getTime();
    const daysOut = Math.round(diffMs / (24 * 60 * 60 * 1000));

    // Match against our reminder windows
    if (!REMINDER_WINDOWS.includes(daysOut as ReminderWindow)) continue;
    const window = daysOut as ReminderWindow;

    if (await alreadySent(row.bookingId, window)) continue;

    try {
      await sendTripReminderEmail({
        to: row.customerEmail,
        customerName: row.customerName,
        bookingId: row.bookingId,
        tourTitle: row.tourTitle || `Tour #${row.tourId}`,
        departureDate: dep,
        returnDate: row.returnDate ? new Date(row.returnDate) : null,
        daysOut: window,
        balanceDue: Number(row.remainingAmount) || 0,
        balanceCurrency: row.currency || "TWD",
        balanceUnpaid: row.paymentStatus !== "paid",
        // v78y: respect each customer's preferred language stored on the booking
        language: (row.customerLanguage === "en" ? "en" : "zh-TW") as "zh-TW" | "en",
      });
      result.emailsQueued++;
      result.perWindow[window]++;
    } catch (err) {
      console.error(
        `[tripReminderService] Failed to email booking ${row.bookingId} (${window}d out):`,
        (err as Error)?.message
      );
      result.errors++;
    }
  }

  return result;
}

// ─── v78l Sprint 4C: Post-trip review request scan ─────────────────────────
//
// Pairs with runTripReminderScan but for the FAR side of the trip:
// 3 days after the trip's returnDate, ask the customer for a Google/Yelp
// review (with 5% off discount as thank-you incentive).
//
// Same idempotency pattern: redis key `review:sent:{bookingId}` (90-day TTL).
// ───────────────────────────────────────────────────────────────────────────

export interface PostTripReviewScanResult {
  scanned: number;
  emailsQueued: number;
  errors: number;
}

const POST_TRIP_DAYS = 3;

async function alreadyReviewed(bookingId: number): Promise<boolean> {
  try {
    const key = `review:sent:${bookingId}`;
    const existed = await redis.exists(key);
    if (existed) return true;
    await redis.setex(key, 90 * 24 * 60 * 60, String(Date.now()));
    return false;
  } catch (err) {
    console.warn("[postTripReview] Redis check failed, skipping:", (err as Error)?.message);
    return true;
  }
}

export async function runPostTripReviewScan(): Promise<PostTripReviewScanResult> {
  const db = await getDb();
  const result: PostTripReviewScanResult = { scanned: 0, emailsQueued: 0, errors: 0 };
  if (!db) return result;

  // Find bookings whose returnDate was exactly POST_TRIP_DAYS ago
  const now = new Date();
  const targetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - POST_TRIP_DAYS));
  // 24-hour window so we don't miss timezone edge cases
  const targetStart = targetDate;
  const targetEnd = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      bookingId: bookings.id,
      customerName: bookings.customerName,
      customerEmail: bookings.customerEmail,
      bookingStatus: bookings.bookingStatus,
      paymentStatus: bookings.paymentStatus,
      returnDate: tourDepartures.returnDate,
      tourId: bookings.tourId,
      tourTitle: tours.title,
    })
    .from(bookings)
    .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
    .leftJoin(tours, eq(bookings.tourId, tours.id))
    .where(
      and(
        inArray(bookings.bookingStatus, ["confirmed"]),
        eq(bookings.paymentStatus, "paid"),
        gte(tourDepartures.returnDate, targetStart),
        lte(tourDepartures.returnDate, targetEnd)
      )
    );

  result.scanned = rows.length;

  for (const row of rows) {
    if (!row.customerEmail || !row.returnDate) continue;
    if (await alreadyReviewed(row.bookingId)) continue;

    try {
      const ok = await sendReviewRequestEmail({
        customerEmail: row.customerEmail,
        customerName: row.customerName,
        bookingId: row.bookingId,
        tourTitle: row.tourTitle || `Tour #${row.tourId}`,
        language: "zh-TW", // future: detect from booking metadata
        // Future: configurable per-tour Google Place ID + Yelp URL
        googleReviewUrl: process.env.PACKGO_GOOGLE_REVIEW_URL,
        yelpReviewUrl: process.env.PACKGO_YELP_REVIEW_URL,
      });
      if (ok) result.emailsQueued++;
    } catch (err) {
      console.error(`[postTripReview] booking ${row.bookingId} failed:`, (err as Error)?.message);
      result.errors++;
    }
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// 30-day winback scan — QA Audit 2026-05-11 Phase 9 fix.
//
// Phase 9 finding: PACK&GO had no automation reminding former customers
// after their trip ended. Repeat-booking rate is the #1 revenue lever for
// a one-person agency; this closes that gap.
//
// Cadence: 30 days after returnDate. Idempotency: redis key
// `winback:sent:{bookingId}` (180-day TTL — prevents double-sending if a
// customer somehow lingers in the 30-day window for >1 scan cycle).
// ───────────────────────────────────────────────────────────────────────────

export interface WinbackScanResult {
  scanned: number;
  emailsQueued: number;
  errors: number;
}

const WINBACK_DAYS = 30;

async function alreadyWinback(bookingId: number): Promise<boolean> {
  try {
    const key = `winback:sent:${bookingId}`;
    const existed = await redis.exists(key);
    if (existed) return true;
    await redis.setex(key, 180 * 24 * 60 * 60, String(Date.now()));
    return false;
  } catch (err) {
    console.warn("[winback] Redis check failed, skipping:", (err as Error)?.message);
    return true;
  }
}

export async function runWinbackScan(): Promise<WinbackScanResult> {
  const db = await getDb();
  const result: WinbackScanResult = { scanned: 0, emailsQueued: 0, errors: 0 };
  if (!db) return result;

  // Find bookings whose returnDate was exactly WINBACK_DAYS ago, where the
  // trip actually happened (paid + confirmed/completed). 24-hour window so
  // timezone edge cases don't drop the booking.
  const now = new Date();
  const targetDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - WINBACK_DAYS)
  );
  const targetStart = targetDate;
  const targetEnd = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      bookingId: bookings.id,
      customerName: bookings.customerName,
      customerEmail: bookings.customerEmail,
      bookingStatus: bookings.bookingStatus,
      paymentStatus: bookings.paymentStatus,
      returnDate: tourDepartures.returnDate,
      tourId: bookings.tourId,
      tourTitle: tours.title,
    })
    .from(bookings)
    .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
    .leftJoin(tours, eq(bookings.tourId, tours.id))
    .where(
      and(
        inArray(bookings.bookingStatus, ["confirmed", "completed"]),
        eq(bookings.paymentStatus, "paid"),
        gte(tourDepartures.returnDate, targetStart),
        lte(tourDepartures.returnDate, targetEnd)
      )
    );

  result.scanned = rows.length;

  for (const row of rows) {
    if (!row.customerEmail || !row.returnDate) continue;
    if (await alreadyWinback(row.bookingId)) continue;

    try {
      const ok = await sendWinbackEmail({
        customerEmail: row.customerEmail,
        customerName: row.customerName,
        bookingId: row.bookingId,
        pastTourTitle: row.tourTitle || `Tour #${row.tourId}`,
        language: "zh-TW",
      });
      if (ok) result.emailsQueued++;
    } catch (err) {
      console.error(`[winback] booking ${row.bookingId} failed:`, (err as Error)?.message);
      result.errors++;
    }
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// 90-day check-in scan — QA Audit 2026-05-11 Phase 9 fix (Step ⑦).
//
// Final touchpoint in the customer journey. By 90 days post-trip the
// active memory has faded and competitors are easier to switch to.
// Tone is intentionally low-pressure (referral perk, not direct sell)
// — goal is mental availability, not immediate conversion.
//
// Idempotency: redis key `checkin:sent:{bookingId}` (270-day TTL).
// ───────────────────────────────────────────────────────────────────────────

export interface CheckinScanResult {
  scanned: number;
  emailsQueued: number;
  errors: number;
}

const CHECKIN_DAYS = 90;

async function alreadyCheckedIn(bookingId: number): Promise<boolean> {
  try {
    const key = `checkin:sent:${bookingId}`;
    const existed = await redis.exists(key);
    if (existed) return true;
    await redis.setex(key, 270 * 24 * 60 * 60, String(Date.now()));
    return false;
  } catch (err) {
    console.warn("[checkin] Redis check failed, skipping:", (err as Error)?.message);
    return true;
  }
}

export async function runCheckinScan(): Promise<CheckinScanResult> {
  const db = await getDb();
  const result: CheckinScanResult = { scanned: 0, emailsQueued: 0, errors: 0 };
  if (!db) return result;

  const now = new Date();
  const targetDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - CHECKIN_DAYS)
  );
  const targetStart = targetDate;
  const targetEnd = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      bookingId: bookings.id,
      customerName: bookings.customerName,
      customerEmail: bookings.customerEmail,
      bookingStatus: bookings.bookingStatus,
      paymentStatus: bookings.paymentStatus,
      returnDate: tourDepartures.returnDate,
      tourId: bookings.tourId,
      tourTitle: tours.title,
    })
    .from(bookings)
    .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
    .leftJoin(tours, eq(bookings.tourId, tours.id))
    .where(
      and(
        inArray(bookings.bookingStatus, ["confirmed", "completed"]),
        eq(bookings.paymentStatus, "paid"),
        gte(tourDepartures.returnDate, targetStart),
        lte(tourDepartures.returnDate, targetEnd)
      )
    );

  result.scanned = rows.length;

  for (const row of rows) {
    if (!row.customerEmail || !row.returnDate) continue;
    if (await alreadyCheckedIn(row.bookingId)) continue;

    try {
      const ok = await sendCheckinEmail({
        customerEmail: row.customerEmail,
        customerName: row.customerName,
        bookingId: row.bookingId,
        pastTourTitle: row.tourTitle || `Tour #${row.tourId}`,
        language: "zh-TW",
      });
      if (ok) result.emailsQueued++;
    } catch (err) {
      console.error(`[checkin] booking ${row.bookingId} failed:`, (err as Error)?.message);
      result.errors++;
    }
  }

  return result;
}
