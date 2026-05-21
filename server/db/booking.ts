// server/db/booking.ts — extracted from server/db.ts in v2 Wave 2 Module 2.1 (D2 locked split).
//
// Owns: booking + bookingParticipants + payments CRUD. Refunds/vouchers/packpoint live in
// db/payment.ts (Module 2.4). Departure-slot reserve/release lives in db/tour.ts (Module 2.2).
//
// Re-exported from server/db.ts via `export * from "./db/booking"` so all existing callers
// (sub-routers, autonomous agents, services) continue importing from "../db" unchanged.

import { eq, and, ne } from "drizzle-orm";
import {
  bookings, InsertBooking, Booking,
  bookingParticipants, InsertBookingParticipant, BookingParticipant,
  payments, InsertPayment, Payment,
} from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";
import {
  encryptPassport,
  decryptParticipantRow,
} from "../_core/passportEncryption";

// ============================================
// Booking Management Functions
// ============================================

/**
 * Get bookings for a specific user
 */
export async function getUserBookings(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user bookings: database not available");
    return [];
  }

  const result = await db.select().from(bookings).where(eq(bookings.userId, userId));
  return result;
}

/**
 * v75: Get active (non-cancelled) bookings tied to a specific departure.
 * Used as a safety check before allowing admin to delete a departure —
 * silently orphaning bookings would lose customer money trail.
 */
export async function getActiveBookingsByDepartureId(departureId: number) {
  const db = await getDb();
  if (!db) return [];
  const result = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.departureId, departureId),
        ne(bookings.bookingStatus, "cancelled" as any)
      )
    );
  return result;
}

/**
 * Get all bookings with optional filtering, joined with tours and departures
 */
export async function getAllBookings(filters?: {
  userId?: number;
  bookingStatus?: string;
  paymentStatus?: string;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get bookings: database not available");
    return [];
  }

  // Use raw SQL to JOIN bookings with tours and departures for full info
  const { sql } = await import('drizzle-orm');
  const result = await db.execute(sql`
    SELECT
      b.*,
      t.title AS tourTitle,
      d.departureDate AS departureDate
    FROM bookings b
    LEFT JOIN tours t ON b.tourId = t.id
    LEFT JOIN tourDepartures d ON b.departureId = d.id
    ${filters?.userId ? sql`WHERE b.userId = ${filters.userId}` : sql``}
    ORDER BY b.createdAt DESC
  `);

  // Normalize field names to match what the frontend expects
  const rows = Array.isArray(result) ? (result[0] as unknown as any[]) : ((result as any).rows ?? []);
  return rows.map((row: any) => ({
    ...row,
    // Alias fields to match frontend expectations
    contactName: row.customerName,
    contactEmail: row.customerEmail,
    totalAmount: row.totalPrice,
    totalPax: (row.numberOfAdults ?? 0) + (row.numberOfChildrenWithBed ?? 0) + (row.numberOfChildrenNoBed ?? 0) + (row.numberOfInfants ?? 0),
    tourTitle: row.tourTitle ?? null,
    departureDate: row.departureDate ?? null,
  }));
}

/**
 * Get a single booking by ID.
 *
 * Phase 2 (2026-05-18): accepts an optional `tx` so reads inside a
 * `db.transaction` (e.g. the refund handler's seat-count snapshot) see
 * writes made earlier in the same transaction. Outside a tx the behavior
 * is unchanged.
 */
export async function getBookingById(
  id: number,
  tx?: DrizzleTx
): Promise<Booking | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get booking: database not available");
    return undefined;
  }

  const reader = tx ?? db;
  const result = await reader.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new booking
 */
export async function createBooking(booking: InsertBooking): Promise<Booking> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(bookings).values(booking);
  const insertId = Number(result[0].insertId);

  const newBooking = await getBookingById(insertId);
  if (!newBooking) {
    throw new Error("Failed to retrieve created booking");
  }

  return newBooking;
}

/**
 * Update an existing booking.
 *
 * Phase 2 (2026-05-18): accepts an optional `tx` parameter so the
 * stripe-webhook handlers can run this write inside a `db.transaction`.
 * When `tx` is supplied we use the transaction handle for the UPDATE;
 * the subsequent SELECT still goes through `getDb()` because reads
 * inside a write-only transaction don't need the same visibility
 * guarantee, and the row is being read back for a return value, not
 * for further mutation.
 */
export async function updateBooking(
  id: number,
  updates: Partial<InsertBooking>,
  tx?: DrizzleTx,
): Promise<Booking> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const writer = tx ?? db;
  await writer.update(bookings).set(updates).where(eq(bookings.id, id));

  const updatedBooking = await getBookingById(id);
  if (!updatedBooking) {
    throw new Error("Failed to retrieve updated booking");
  }

  return updatedBooking;
}

/**
 * Get all participants for a booking
 */
export async function getBookingParticipants(bookingId: number): Promise<BookingParticipant[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get participants: database not available");
    return [];
  }

  const result = await db.select().from(bookingParticipants).where(eq(bookingParticipants.bookingId, bookingId));
  // v2 Module 1.8: decrypt passportNumber on the way out so callers see plaintext.
  return result.map((row) => decryptParticipantRow(row));
}

/**
 * Create a new booking participant
 *
 * v2 Module 1.8: passportNumber is encrypted before insert and decrypted
 * on the return row so callers continue to see plaintext.
 */
export async function createBookingParticipant(participant: InsertBookingParticipant): Promise<BookingParticipant> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const toInsert: InsertBookingParticipant = {
    ...participant,
    passportNumber: participant.passportNumber ? encryptPassport(participant.passportNumber) : participant.passportNumber,
  };

  const result = await db.insert(bookingParticipants).values(toInsert);
  const insertId = Number(result[0].insertId);

  const participants = await db.select().from(bookingParticipants).where(eq(bookingParticipants.id, insertId)).limit(1);
  if (participants.length === 0) {
    throw new Error("Failed to retrieve created participant");
  }

  return decryptParticipantRow(participants[0]);
}

/**
 * v77: replace ALL participants for a booking in one atomic operation.
 * Used by the customer-facing form that captures passenger details after
 * the booking is created. Idempotent — calling repeatedly with the same
 * payload converges to the same final state.
 *
 * Implementation: delete-then-insert inside a transaction so partial failures
 * don't leave half-stale participant rows.
 *
 * v2 Module 1.8: passportNumber on each inserted row is encrypted; the
 * subsequent getBookingParticipants call decrypts on the way out.
 */
export async function replaceBookingParticipants(
  bookingId: number,
  participants: Omit<InsertBookingParticipant, "bookingId" | "id">[]
): Promise<BookingParticipant[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Drizzle MySQL transaction
  await db.transaction(async (tx) => {
    await tx.delete(bookingParticipants).where(eq(bookingParticipants.bookingId, bookingId));
    if (participants.length > 0) {
      const toInsert = participants.map((p) => ({
        ...p,
        bookingId,
        passportNumber: p.passportNumber ? encryptPassport(p.passportNumber) : p.passportNumber,
      }));
      await tx.insert(bookingParticipants).values(toInsert);
    }
  });

  return await getBookingParticipants(bookingId);
}

// ============================================
// Payment Management Functions
// ============================================

/**
 * Get all payments for a booking
 */
export async function getBookingPayments(bookingId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get payments: database not available");
    return [];
  }

  const result = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
  return result;
}

/**
 * Create a new payment record.
 *
 * Phase 2 (2026-05-18): accepts an optional `tx` so stripe-webhook
 * handlers can wrap createPayment + updateBooking + createAccountingEntry
 * in a single transaction. When `tx` is supplied, both the INSERT and
 * the read-back SELECT use the transaction handle so we always read
 * what we just wrote.
 */
export async function createPayment(
  payment: InsertPayment,
  tx?: DrizzleTx,
): Promise<Payment> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const writer = tx ?? db;
  const result = await writer.insert(payments).values(payment);
  const insertId = Number(result[0].insertId);

  const paymentRecords = await writer
    .select()
    .from(payments)
    .where(eq(payments.id, insertId))
    .limit(1);
  if (paymentRecords.length === 0) {
    throw new Error("Failed to retrieve created payment");
  }

  return paymentRecords[0];
}

/**
 * v70: Lookup an existing payment by Stripe Payment Intent ID.
 * Used by the webhook for idempotency — Stripe retries webhook deliveries
 * (network blips, gateway errors), and without this check we'd insert duplicate
 * payment rows + flip booking status repeatedly.
 */
export async function getPaymentByIntentId(
  stripePaymentIntentId: string,
  tx?: DrizzleTx
): Promise<Payment | null> {
  const db = await getDb();
  if (!db) return null;
  const reader = tx ?? db;
  const rows = await reader
    .select()
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, stripePaymentIntentId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Update payment status by Stripe Payment Intent ID.
 *
 * Phase 2 (2026-05-18): accepts an optional `tx` so stripe-webhook
 * handlers can wrap the status flip in a transaction. payment_intent.*
 * handlers are single-write today but the wrapper future-proofs them
 * in case additional writes are added (e.g. accounting reversal entry).
 */
export async function updatePaymentStatus(
  stripePaymentIntentId: string,
  status: string,
  paidAt?: Date,
  tx?: DrizzleTx,
): Promise<Payment> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const writer = tx ?? db;
  const updates: any = { paymentStatus: status };
  if (paidAt) {
    updates.paidAt = paidAt;
  }

  await writer
    .update(payments)
    .set(updates)
    .where(eq(payments.stripePaymentIntentId, stripePaymentIntentId));

  const paymentRecords = await writer
    .select()
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, stripePaymentIntentId))
    .limit(1);
  if (paymentRecords.length === 0) {
    throw new Error("Failed to retrieve updated payment");
  }

  return paymentRecords[0];
}
