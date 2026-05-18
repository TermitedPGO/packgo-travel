/**
 * Central Stripe webhook idempotency helper.
 *
 * One pattern, used at the top of handleStripeWebhook:
 *
 *   const claim = await claimStripeEvent(event);
 *   if (claim.alreadyProcessed) return res.json({ received: true });
 *   try {
 *     // ...existing dispatch switch...
 *     await markStripeEventSucceeded(claim.rowId);
 *   } catch (err) {
 *     await markStripeEventFailed(claim.rowId, err);
 *     throw err;  // surface to outer 500 handler so Stripe retries
 *   }
 */

import { getDb } from "../db";
import { stripeWebhookEvents } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export type ClaimResult =
  | { alreadyProcessed: true; existingStatus: "processing" | "succeeded" | "failed" }
  | { alreadyProcessed: false; rowId: number };

const ERROR_MESSAGE_MAX = 1024;

/** MySQL duplicate-key error code (mysql2 surfaces this on UNIQUE collision). */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: string; errno?: number };
  return anyErr.code === "ER_DUP_ENTRY" || anyErr.errno === 1062;
}

function truncateError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  return raw.length > ERROR_MESSAGE_MAX ? raw.slice(0, ERROR_MESSAGE_MAX) : raw;
}

/**
 * Attempt to insert a `processing` row for this event.id.
 * On UNIQUE collision the event was already received — return alreadyProcessed.
 */
export async function claimStripeEvent(
  event: { id: string; type: string }
): Promise<ClaimResult> {
  const db = await getDb();
  if (!db) throw new Error("[stripeWebhookIdempotency] Database not available");

  try {
    const result = await db.insert(stripeWebhookEvents).values({
      eventId: event.id,
      eventType: event.type,
      status: "processing",
    });
    // mysql2 result shape via drizzle: [{ insertId, affectedRows, ... }, ...]
    const insertId = Number((result as any)[0]?.insertId ?? (result as any).insertId ?? 0);
    return { alreadyProcessed: false, rowId: insertId };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;

    // UNIQUE collision: look up existing status.
    const existing = await db
      .select({ status: stripeWebhookEvents.status })
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.eventId, event.id))
      .limit(1);
    const status = existing[0]?.status ?? "processing";
    return { alreadyProcessed: true, existingStatus: status };
  }
}

export async function markStripeEventSucceeded(rowId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("[stripeWebhookIdempotency] Database not available");

  await db
    .update(stripeWebhookEvents)
    .set({ status: "succeeded", processedAt: new Date() })
    .where(eq(stripeWebhookEvents.id, rowId));
}

export async function markStripeEventFailed(
  rowId: number,
  err: unknown
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("[stripeWebhookIdempotency] Database not available");

  await db
    .update(stripeWebhookEvents)
    .set({
      status: "failed",
      errorMessage: truncateError(err),
      processedAt: new Date(),
    })
    .where(eq(stripeWebhookEvents.id, rowId));
}

/** Test-only helper: clear the table (used by Vitest fixtures). */
export async function _clearStripeWebhookEvents_forTests(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(stripeWebhookEvents);
}
