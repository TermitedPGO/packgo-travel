/**
 * Trust Account Deferral Service (Phase 4).
 *
 * Implements CST §17550 income recognition: customer prepayments sit in a
 * trust account until departure, then are recognized as income.
 *
 * Feature-flagged via PLAID_TRUST_DEFERRAL_ENABLED env. When off, this
 * service short-circuits — all behavior reverts to immediate recognition
 * (Phase 3 behavior).
 *
 * Configuration (defaults reflect strictest legal reading; Jeff can flip
 * via env vars after reviewing PHASE_4_TRUST_DEFERRAL_DESIGN.md Q1-Q7):
 *
 *   PLAID_TRUST_DEFERRAL_ENABLED       — 'true' to enable (default off)
 *   PLAID_TRUST_RECOGNITION_OFFSET_DAYS — days after departure to recognize
 *                                         (default 0 = same day as departure)
 *   PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE — auto-link txn→booking threshold
 *                                          (default 80; below = needs Jeff)
 *   PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD — same-day match tolerance
 *                                              (default 1.00)
 *   PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS — bookings paid ±N days back
 *                                            (default 2)
 *
 * Public API:
 *   processTrustInflow(bankTransactionId)
 *     — Called by AccountingAgent service when a transaction is classified
 *       as income_booking on a trust account. Creates a trustDeferredIncome
 *       row, attempts auto-match to a booking.
 *
 *   recognizeReadyDepartures(runId?)
 *     — Called by the daily cron. Recognizes all rows where
 *       expectedRecognitionDate <= today, recognizedAt IS NULL, reversedAt
 *       IS NULL. Returns counts.
 *
 *   linkInflowToBooking(deferredId, bookingId, userId)
 *     — Admin override. Manually associate a deferred row with a booking.
 *       Recomputes expectedRecognitionDate from booking.departureDate.
 *
 *   reverseDeferral(deferredId, reason, userId)
 *     — Admin override. Marks the deferral as reversed (e.g., customer
 *       cancelled and was refunded). Subtracts from trust-account balance
 *       reconciliation. Never recognizes.
 *
 *   computeOutstandingTrust(linkedAccountId)
 *     — Sum of recognized=NULL AND reversed=NULL rows. Used for CST
 *       reconciliation: should equal current trust account balance.
 */

import { getDb } from "../db";
import {
  trustDeferredIncome,
  linkedBankAccounts,
  bankTransactions,
  bookings,
  tourDepartures,
  payments,
} from "../../drizzle/schema";
import { and, eq, isNull, lte, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
// SECURITY_AUDIT_2026_05_14 P3-3: feature flag reads come from the typed
// featureFlags module so a typo in env-var names becomes a compile error.
import * as featureFlags from "../_core/featureFlags";

// ─── Feature flag + config ─────────────────────────────────────────────────

export function isTrustDeferralEnabled(): boolean {
  return featureFlags.trustDeferralEnabled();
}

const RECOGNITION_OFFSET_DAYS = featureFlags.trustRecognitionOffsetDays();
const AUTOMATCH_MIN_CONFIDENCE = featureFlags.trustAutomatchMinConfidence();
const AUTOMATCH_AMOUNT_WINDOW = Math.max(
  0,
  parseFloat(process.env.PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD ?? "1.00") ||
    1.0
);
const AUTOMATCH_DATE_WINDOW_DAYS = Math.max(
  0,
  parseInt(process.env.PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS ?? "2", 10) || 2
);
// Q7: when departure is within this many days of the deposit, recognize
// income on the deposit date instead of deferring to departure. Per Jeff's
// 2026-05-13 answer (option B), this is 30 days — short-lead bookings
// crossing year boundaries get attributed to the deposit year, not the
// departure year. Set to 0 to disable early recognition entirely (strict
// departure-date attribution).
const EARLY_RECOGNITION_WINDOW_DAYS = Math.max(
  0,
  parseInt(
    process.env.PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS ?? "30",
    10
  ) || 30
);

// ─── Heuristic matching ────────────────────────────────────────────────────
//
// Phase 4 default: auto-match attempts pairs of (bank txn) ↔ (payment row)
// based on amount + date window. Joins through bookings → tourDepartures
// to get the departure date.
//
// This is intentionally a "weak" heuristic — it'll catch the obvious cases
// (Stripe deposit hits the same day, matches the booking.depositAmount
// exactly) and leave ambiguous ones for Jeff to manually link via the
// admin UI. Q3 of PHASE_4_TRUST_DEFERRAL_DESIGN.md asks Jeff to confirm
// his preferred matching strategy; until he answers, we default to
// "auto-link high-confidence, queue ambiguous".

/**
 * Look up the most-likely booking + its departure date for a trust
 * inflow. Returns null if no payment in the date window matches the
 * amount within tolerance.
 */
async function findBookingMatch(txn: {
  id: number;
  amount: number;
  date: string;
  description: string | null;
}): Promise<{
  bookingId: number;
  confidence: number;
  departureDate: string | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const txnAmt = Math.abs(txn.amount);
  const txnDate = new Date(txn.date);
  const since = new Date(
    txnDate.getTime() - AUTOMATCH_DATE_WINDOW_DAYS * 86_400_000
  );
  const until = new Date(
    txnDate.getTime() + AUTOMATCH_DATE_WINDOW_DAYS * 86_400_000
  );

  // Pull recent payments + their booking + booking's departure date
  const candidates = await db
    .select({
      paymentId: payments.id,
      paidAt: payments.paidAt,
      amount: payments.amount,
      paymentType: payments.paymentType,
      bookingId: bookings.id,
      depositAmount: bookings.depositAmount,
      totalPrice: bookings.totalPrice,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      departureDate: tourDepartures.departureDate,
    })
    .from(payments)
    .leftJoin(bookings, eq(payments.bookingId, bookings.id))
    .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
    .where(
      and(
        gte(payments.paidAt, since),
        lte(payments.paidAt, until)
      )
    )
    .limit(50);

  let best:
    | { bookingId: number; confidence: number; departureDate: string | null }
    | null = null;

  for (const c of candidates) {
    if (!c.bookingId) continue;
    const pmAmt = parseFloat(String(c.amount ?? 0));
    const dep = parseFloat(String(c.depositAmount ?? 0));
    const tot = parseFloat(String(c.totalPrice ?? 0));
    const targets = [pmAmt, dep, tot].filter((v) => v > 0);
    const amountDelta = Math.min(...targets.map((t) => Math.abs(t - txnAmt)));
    if (amountDelta > AUTOMATCH_AMOUNT_WINDOW) continue;

    // Score components (Phase 4 E2E test 2026-05-13 calibration):
    //   Exact amount + same calendar day on its own = strong signal even
    //   without a pi_* hint in the description. Weighting:
    //     exact amount (50) + same day (30) = 80 → just crosses threshold
    //     exact amount (50) + same day (30) + pi_* (20) = 100 → ceiling
    //     close amount (30-40) + same day (30) = 60-70 → below threshold,
    //                                                    surfaces for Jeff
    //   This reflects PACK&GO's actual transaction density (1-5 payments/
    //   day, mostly unique amounts) — false-positive rate of same-day
    //   exact-amount is very low.
    let score = 0;
    if (amountDelta === 0) score += 50;
    else if (amountDelta < 0.5) score += 40;
    else score += 25;

    // Time proximity. Compare by CALENDAR DATE (UTC), not raw millisecond
    // diff — a deposit hit 2026-05-13 00:00 (a Plaid DATE field gets parsed
    // as midnight) and a payment.paidAt 2026-05-13 20:42 are the SAME day
    // but their ms-diff is 0.86 days, which would have triggered the
    // `days <= 1` branch (score 20) instead of the same-day branch (score
    // 30). Without the +30 same-day boost, generic Stripe descriptors
    // without pi_* IDs land at score 60 — below the 80 auto-match
    // threshold — and the row stays unmatched even when the payment is
    // obviously the right one. Fix: bucket by ISO date string.
    if (c.paidAt) {
      const txnYmd = txnDate.toISOString().slice(0, 10);
      const paidYmd = new Date(c.paidAt).toISOString().slice(0, 10);
      if (txnYmd === paidYmd) {
        score += 30;
      } else {
        const days =
          Math.abs(txnDate.getTime() - new Date(c.paidAt).getTime()) /
          86_400_000;
        if (days <= 1) score += 20;
        else score += 10;
      }
    }

    // Stripe PaymentIntent ID match (Stripe transfer descriptors include pi_*).
    // Reduced from +30 to +20 after the 2026-05-13 calibration — exact
    // amount + same day no longer needs this boost to clear 80, so pi_*
    // becomes "icing" rather than required.
    const desc = (txn.description ?? "").toLowerCase();
    if (
      c.stripePaymentIntentId &&
      desc.includes(c.stripePaymentIntentId.toLowerCase())
    ) {
      score += 20;
    }

    score = Math.min(100, score);

    if (!best || score > best.confidence) {
      const depStr = c.departureDate
        ? new Date(c.departureDate as any).toISOString().slice(0, 10)
        : null;
      best = {
        bookingId: c.bookingId,
        confidence: score,
        departureDate: depStr,
      };
    }
  }

  if (best && best.confidence >= AUTOMATCH_MIN_CONFIDENCE) {
    return best;
  }
  return null;
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface ProcessTrustInflowResult {
  deferredId: number | null;
  matched: boolean;
  bookingId: number | null;
  confidence: number;
  expectedRecognitionDate: string | null;
  reason: string;
}

/**
 * Called by AccountingAgent flow when a transaction is classified
 * income_booking AND its account isTrustAccount=1.
 *
 * Creates a trustDeferredIncome row, attempts auto-match. Idempotent on
 * bankTransactionId (unique key).
 */
export async function processTrustInflow(
  bankTransactionId: number
): Promise<ProcessTrustInflowResult> {
  if (!isTrustDeferralEnabled()) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "trust deferral disabled by env flag",
    };
  }

  const db = await getDb();
  if (!db) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "db unavailable",
    };
  }

  // Fetch the bank transaction + verify it's on a trust account
  const [row] = await db
    .select({
      txn: bankTransactions,
      acct: linkedBankAccounts,
    })
    .from(bankTransactions)
    .leftJoin(
      linkedBankAccounts,
      eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
    )
    .where(eq(bankTransactions.id, bankTransactionId))
    .limit(1);

  if (!row?.txn) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "transaction not found",
    };
  }
  if (row.acct?.isTrustAccount !== 1) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "not a trust account",
    };
  }

  const amount = parseFloat(row.txn.amount as any) || 0;
  // Plaid sign convention: negative = inflow (income). Trust deferral
  // only applies to INflows (customer paying us).
  if (amount >= 0) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "not an inflow (amount >= 0)",
    };
  }

  // Try to match to a booking (joins payments → bookings → tourDepartures)
  const match = await findBookingMatch({
    id: row.txn.id,
    amount,
    date: String(row.txn.date),
    description: row.txn.description,
  });

  let expectedRecognitionDate: string | null = null;
  if (match?.departureDate) {
    const dep = new Date(match.departureDate);
    const deposit = new Date(String(row.txn.date));
    const daysToDeparture = Math.ceil(
      (dep.getTime() - deposit.getTime()) / 86_400_000
    );

    // Q7 early-recognition: short-lead bookings recognize on deposit date.
    // Keeps year-end attribution simple — a 12/30 deposit for 1/5 departure
    // is 2026 income, not 2027. Disabled by setting window to 0.
    if (
      EARLY_RECOGNITION_WINDOW_DAYS > 0 &&
      daysToDeparture <= EARLY_RECOGNITION_WINDOW_DAYS
    ) {
      expectedRecognitionDate = deposit.toISOString().slice(0, 10);
      console.log(
        `[trust-deferral] txn ${row.txn.id} short-lead (${daysToDeparture}d to departure) — recognize on deposit ${expectedRecognitionDate}`
      );
    } else {
      dep.setDate(dep.getDate() + RECOGNITION_OFFSET_DAYS);
      expectedRecognitionDate = dep.toISOString().slice(0, 10);
    }
  }

  // Insert (idempotent on bankTransactionId)
  try {
    const ins: any = await db.insert(trustDeferredIncome).values({
      bankTransactionId: row.txn.id,
      linkedAccountId: row.txn.linkedAccountId,
      bookingId: match?.bookingId ?? null,
      matchConfidence: match?.confidence ?? 0,
      matchMethod: match ? "auto" : "unmatched",
      amount: String(Math.abs(amount)),
      isoCurrencyCode: row.txn.isoCurrencyCode ?? "USD",
      depositDate: row.txn.date as any,
      expectedRecognitionDate: expectedRecognitionDate as any,
    });
    const deferredId = Number(ins?.[0]?.insertId ?? 0) || null;
    return {
      deferredId,
      matched: Boolean(match),
      bookingId: match?.bookingId ?? null,
      confidence: match?.confidence ?? 0,
      expectedRecognitionDate,
      reason: match ? "auto-matched" : "unmatched — awaits Jeff",
    };
  } catch (err) {
    const e = err as any;
    if (String(e?.code ?? "").includes("DUP")) {
      // Already deferred — fetch existing
      const [existing] = await db
        .select()
        .from(trustDeferredIncome)
        .where(eq(trustDeferredIncome.bankTransactionId, row.txn.id))
        .limit(1);
      return {
        deferredId: existing?.id ?? null,
        matched: Boolean(existing?.bookingId),
        bookingId: existing?.bookingId ?? null,
        confidence: existing?.matchConfidence ?? 0,
        expectedRecognitionDate:
          existing?.expectedRecognitionDate
            ? String(existing.expectedRecognitionDate)
            : null,
        reason: "already deferred (idempotent skip)",
      };
    }
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: `insert failed: ${e?.message ?? "unknown"}`,
    };
  }
}

export interface RecognizeReadyResult {
  runId: string;
  scanned: number;
  recognized: number;
  totalRecognizedAmount: number;
  skippedNoDepartureDate: number;
  skippedNotMatched: number;
}

/**
 * Daily cron: scan trustDeferredIncome for rows whose expectedRecognitionDate
 * has arrived. Mark them recognized.
 *
 * After recognition, the bankPLService treats these as income on the
 * recognition date (not the deposit date).
 */
export async function recognizeReadyDepartures(
  opts?: { runId?: string; today?: string }
): Promise<RecognizeReadyResult> {
  const runId = opts?.runId ?? `trust-recog-${nanoid(10)}`;
  const today =
    opts?.today ?? new Date().toISOString().slice(0, 10);

  const empty: RecognizeReadyResult = {
    runId,
    scanned: 0,
    recognized: 0,
    totalRecognizedAmount: 0,
    skippedNoDepartureDate: 0,
    skippedNotMatched: 0,
  };

  if (!isTrustDeferralEnabled()) return empty;

  const db = await getDb();
  if (!db) return empty;

  // Candidates: not yet recognized, not reversed
  const candidates = await db
    .select()
    .from(trustDeferredIncome)
    .where(
      and(
        isNull(trustDeferredIncome.recognizedAt),
        isNull(trustDeferredIncome.reversedAt)
      )
    );

  let recognized = 0;
  let totalAmt = 0;
  let skipNoDate = 0;
  let skipNoMatch = 0;

  for (const r of candidates) {
    if (!r.expectedRecognitionDate) {
      skipNoDate++;
      continue;
    }
    if (!r.bookingId) {
      // Without a matched booking we can't know the departure date for sure.
      // Leave for Jeff to manually link.
      skipNoMatch++;
      continue;
    }
    const expected = String(r.expectedRecognitionDate);
    if (expected > today) continue; // not yet
    await db
      .update(trustDeferredIncome)
      .set({
        recognizedAt: new Date(),
        recognitionRunId: runId,
      })
      .where(eq(trustDeferredIncome.id, r.id));
    recognized++;
    totalAmt += parseFloat(r.amount as any) || 0;
  }

  console.log(
    `[trust-deferral] run=${runId} scanned=${candidates.length} recognized=${recognized} skippedNoDate=${skipNoDate} skippedNoMatch=${skipNoMatch} totalAmt=${totalAmt.toFixed(2)}`
  );

  return {
    runId,
    scanned: candidates.length,
    recognized,
    totalRecognizedAmount: totalAmt,
    skippedNoDepartureDate: skipNoDate,
    skippedNotMatched: skipNoMatch,
  };
}

/**
 * Admin override: manually link an unmatched deferred row to a booking.
 * Recomputes expectedRecognitionDate from booking.departureDate.
 */
export async function linkInflowToBooking(opts: {
  deferredId: number;
  bookingId: number;
}): Promise<{ success: boolean; expectedRecognitionDate: string | null }> {
  const db = await getDb();
  if (!db) return { success: false, expectedRecognitionDate: null };

  // Get departureDate via bookings → tourDepartures join + the deferred
  // row's depositDate for early-recognition check
  const [booking] = await db
    .select({ departureDate: tourDepartures.departureDate })
    .from(bookings)
    .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
    .where(eq(bookings.id, opts.bookingId))
    .limit(1);

  const [deferred] = await db
    .select({ depositDate: trustDeferredIncome.depositDate })
    .from(trustDeferredIncome)
    .where(eq(trustDeferredIncome.id, opts.deferredId))
    .limit(1);

  let expectedRecognitionDate: string | null = null;
  if (booking?.departureDate && deferred?.depositDate) {
    const dep = new Date(booking.departureDate as any);
    const deposit = new Date(String(deferred.depositDate));
    const daysToDeparture = Math.ceil(
      (dep.getTime() - deposit.getTime()) / 86_400_000
    );
    // Q7 short-lead → recognize on deposit
    if (
      EARLY_RECOGNITION_WINDOW_DAYS > 0 &&
      daysToDeparture <= EARLY_RECOGNITION_WINDOW_DAYS
    ) {
      expectedRecognitionDate = deposit.toISOString().slice(0, 10);
    } else {
      dep.setDate(dep.getDate() + RECOGNITION_OFFSET_DAYS);
      expectedRecognitionDate = dep.toISOString().slice(0, 10);
    }
  }

  await db
    .update(trustDeferredIncome)
    .set({
      bookingId: opts.bookingId,
      matchMethod: "manual",
      matchConfidence: 100,
      expectedRecognitionDate: expectedRecognitionDate as any,
    })
    .where(eq(trustDeferredIncome.id, opts.deferredId));

  return { success: true, expectedRecognitionDate };
}

/**
 * Admin override: mark a deferred row as reversed (booking cancelled,
 * refund processed). Never recognized. Subtracts from trust reconciliation.
 */
export async function reverseDeferral(opts: {
  deferredId: number;
  reason: string;
}): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) return { success: false };
  await db
    .update(trustDeferredIncome)
    .set({
      reversedAt: new Date(),
      reversedReason: opts.reason.slice(0, 256),
    })
    .where(eq(trustDeferredIncome.id, opts.deferredId));
  return { success: true };
}

// ─── Manual-override deferral sync (2026-05-29) ──────────────────────────────
//
// The AGENT path calls processTrustInflow when it classifies a trust inflow as
// income_booking. The MANUAL override path (plaidRouter.transactionUpdate) used
// to write jeffOverrideCategory WITHOUT touching the deferral ledger — so a
// hand-marked trust deposit never created a deferred row and got counted as
// income immediately, violating CST §17550 for long-lead bookings. These
// helpers let the override path keep the ledger in step.
//
// Single source of truth for "should a deferred row exist?": the txn's
// EFFECTIVE category is income_booking AND it is not excluded from accounting.

/**
 * Effective accounting category = Jeff's manual override when set, else the
 * agent's category. An empty-string / null override falls back to the agent.
 */
export function effectiveCategory(
  jeffOverride: string | null | undefined,
  agentCategory: string | null | undefined
): string | null {
  if (jeffOverride && jeffOverride !== "") return jeffOverride;
  return agentCategory ?? null;
}

/**
 * A trust deferred-income row should exist for a bank txn iff its effective
 * category is income_booking and it is not excluded from accounting. Pure.
 */
export function shouldHaveDeferral(opts: {
  effectiveCategory: string | null;
  excluded: boolean;
}): boolean {
  return !opts.excluded && opts.effectiveCategory === "income_booking";
}

export type DeferralSyncAction = "create" | "reverse" | "noop";

/**
 * Decide whether a manual override needs to create, reverse, or leave alone the
 * deferred row, by comparing the "should-defer" predicate before vs after the
 * edit. Pure — no DB, no env reads beyond the `enabled` flag passed in.
 *
 * Note: this decides INTENT from category/exclude only. The trust-account +
 * inflow guard lives in processTrustInflow (the create side) and the
 * row-existence check lives in reverseDeferralForTransaction (the reverse
 * side), so a "create"/"reverse" on a non-trust or non-inflow txn is a safe
 * no-op at the DB layer. The important invariant is that this never returns
 * "noop" when the booking-ness of the effective category actually flipped.
 */
export function decideDeferralSync(opts: {
  enabled: boolean;
  before: { effectiveCategory: string | null; excluded: boolean };
  after: { effectiveCategory: string | null; excluded: boolean };
}): { action: DeferralSyncAction; reason: string } {
  if (!opts.enabled) {
    return { action: "noop", reason: "trust deferral disabled" };
  }
  const had = shouldHaveDeferral(opts.before);
  const wants = shouldHaveDeferral(opts.after);
  if (wants && !had) {
    return { action: "create", reason: "now income_booking (non-excluded)" };
  }
  if (had && !wants) {
    return {
      action: "reverse",
      reason: "no longer income_booking (changed away or excluded)",
    };
  }
  return { action: "noop", reason: "deferral state unchanged" };
}

/**
 * Reverse the active (unrecognized, unreversed) deferred row for a bank
 * transaction, if one exists. Used when a manual override moves a trust inflow
 * AWAY from income_booking (or excludes it). Idempotent: a second call finds no
 * active row and no-ops. Recognized rows are left untouched — the income is
 * already booked and reversing here would not un-recognize it.
 */
export async function reverseDeferralForTransaction(opts: {
  bankTransactionId: number;
  reason: string;
}): Promise<{ reversed: boolean; deferredId: number | null; reason: string }> {
  const db = await getDb();
  if (!db) return { reversed: false, deferredId: null, reason: "db unavailable" };
  const [existing] = await db
    .select({ id: trustDeferredIncome.id })
    .from(trustDeferredIncome)
    .where(
      and(
        eq(trustDeferredIncome.bankTransactionId, opts.bankTransactionId),
        isNull(trustDeferredIncome.recognizedAt),
        isNull(trustDeferredIncome.reversedAt)
      )
    )
    .limit(1);
  if (!existing) {
    return { reversed: false, deferredId: null, reason: "no active deferred row" };
  }
  await reverseDeferral({ deferredId: existing.id, reason: opts.reason });
  return { reversed: true, deferredId: existing.id, reason: "reversed" };
}

/**
 * Orchestrate the deferral ledger update for a manual category/exclude override.
 * Called by plaidRouter.transactionUpdate AFTER the bank-transaction row is
 * written. Best-effort: callers should not let a deferral-sync failure roll
 * back the (already committed) category change.
 */
export async function syncDeferralForManualOverride(input: {
  bankTransactionId: number;
  before: { effectiveCategory: string | null; excluded: boolean };
  after: { effectiveCategory: string | null; excluded: boolean };
  reason?: string;
}): Promise<{ action: DeferralSyncAction; reason: string; deferredId: number | null }> {
  const decision = decideDeferralSync({
    enabled: isTrustDeferralEnabled(),
    before: input.before,
    after: input.after,
  });
  if (decision.action === "create") {
    const r = await processTrustInflow(input.bankTransactionId);
    return { action: "create", reason: r.reason, deferredId: r.deferredId };
  }
  if (decision.action === "reverse") {
    const r = await reverseDeferralForTransaction({
      bankTransactionId: input.bankTransactionId,
      reason:
        input.reason ?? "manual override moved txn out of income_booking",
    });
    return { action: "reverse", reason: r.reason, deferredId: r.deferredId };
  }
  return { action: "noop", reason: decision.reason, deferredId: null };
}

/**
 * Compute outstanding (unrecognized, unreversed) trust amount for a
 * given linked account. Used for CST §17550 reconciliation:
 *
 *   linkedBankAccounts.currentBalance SHOULD equal
 *   sum(trustDeferredIncome.amount WHERE recognizedAt IS NULL AND reversedAt IS NULL)
 *
 * If they diverge, something's wrong — un-matched deposits, manual
 * trust withdrawals not yet recorded, etc.
 */
export interface OutstandingTrustSummary {
  totalOutstanding: number;
  rowCount: number;
  unmatchedCount: number;
  unmatchedTotal: number;
}

/** Minimal row shape foldOutstandingTrust reads. */
export interface TrustDeferredRowLike {
  amount: string | number | null;
  bookingId?: number | null;
}

/**
 * Pure summation over already-fetched (unrecognized, non-reversed) deferred
 * rows. Split out from computeOutstandingTrust (M5, 2026-05-28) so the
 * outstanding / unmatched math is unit-testable without a DB — same pattern
 * as bankPLService.foldBankPLRows. Caller is responsible for filtering rows
 * to recognizedAt IS NULL AND reversedAt IS NULL before passing them in.
 */
export function foldOutstandingTrust(
  rows: TrustDeferredRowLike[]
): OutstandingTrustSummary {
  let total = 0;
  let unmatchedTotal = 0;
  let unmatchedCount = 0;
  for (const r of rows) {
    const a = parseFloat(r.amount as any) || 0;
    total += a;
    if (!r.bookingId) {
      unmatchedTotal += a;
      unmatchedCount++;
    }
  }
  return {
    totalOutstanding: total,
    rowCount: rows.length,
    unmatchedCount,
    unmatchedTotal,
  };
}

export async function computeOutstandingTrust(
  linkedAccountId: number
): Promise<OutstandingTrustSummary> {
  const db = await getDb();
  if (!db) {
    return { totalOutstanding: 0, rowCount: 0, unmatchedCount: 0, unmatchedTotal: 0 };
  }
  const rows = await db
    .select()
    .from(trustDeferredIncome)
    .where(
      and(
        eq(trustDeferredIncome.linkedAccountId, linkedAccountId),
        isNull(trustDeferredIncome.recognizedAt),
        isNull(trustDeferredIncome.reversedAt)
      )
    );
  return foldOutstandingTrust(rows);
}

/**
 * Total amount currently deferred (not yet recognized) — used by
 * bankPLService to subtract from monthly income when trust deferral is on.
 *
 * 2026-05-22 — userId now optional. Single-tenant PACK&GO aggregates across
 * every active linked trust account. Jeff: 「放在trust account 是客人訂金
 * 不能算我的, 除非真的跑到我的checking」.
 *
 * 2026-05-23 — added `depositSince` to scope the subtraction to a SPECIFIC
 * period. Without it, the cumulative deferred amount (e.g. $8,908) was
 * being subtracted from each month's gross income — incorrectly turning
 * "本月賺" negative because prior months' deferrals got re-counted.
 *
 * Correct semantics:
 *   - Per-month P&L → pass `depositSince = startDate` so we only subtract
 *     this month's NEW trust deposits (matches the income_booking we just
 *     summed for the period).
 *   - YTD report → pass `depositSince = jan-1` for the same reason.
 *   - "what's currently locked in trust" tile → omit depositSince to get
 *     the full unrecognized cumulative balance.
 */
export async function totalDeferredForUser(opts: {
  userId?: number;
  asOfDate: string;     // YYYY-MM-DD — include deposits up to (and including) this date
  depositSince?: string; // optional YYYY-MM-DD — only deposits ON/AFTER this date
}): Promise<number> {
  if (!isTrustDeferralEnabled()) return 0;
  const db = await getDb();
  if (!db) return 0;
  // Deferred = deposited within [depositSince, asOfDate], not yet recognized, not reversed
  const filters: any[] = [
    eq(linkedBankAccounts.isActive, 1),
    lte(trustDeferredIncome.depositDate, opts.asOfDate as any),
    isNull(trustDeferredIncome.recognizedAt),
    isNull(trustDeferredIncome.reversedAt),
  ];
  if (opts.depositSince) {
    filters.push(gte(trustDeferredIncome.depositDate, opts.depositSince as any));
  }
  if (opts.userId !== undefined) {
    filters.push(eq(linkedBankAccounts.userId, opts.userId));
  }
  const rows = await db
    .select({
      amount: trustDeferredIncome.amount,
      ownerUserId: linkedBankAccounts.userId,
    })
    .from(trustDeferredIncome)
    .leftJoin(
      linkedBankAccounts,
      eq(trustDeferredIncome.linkedAccountId, linkedBankAccounts.id)
    )
    .where(and(...filters));
  let total = 0;
  for (const r of rows) {
    total += parseFloat(r.amount as any) || 0;
  }
  return total;
}
