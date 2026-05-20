/**
 * Round 80.22: Packpoint loyalty system — earn / redeem / clawback helpers.
 *
 * Single entry point for all Packpoint mutations so the audit trail
 * (`pointsTransactions`) and the cached balance (`users.packpointBalance`)
 * stay in sync. Direct DB writes are forbidden — always go through these
 * functions.
 *
 * Policy reference: docs/packpoint-policy.md
 *
 * Key invariants:
 *   - balance never goes negative (clawback caps at current balance)
 *   - lifetime never decreases (only earn events bump it)
 *   - lastActivityAt updates on EARN and REDEEM (not on clawback / expire,
 *     so an inactive cancellation doesn't reset the 18-month timer)
 *   - every mutation writes a row to pointsTransactions with balanceAfter
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users, pointsTransactions, tours } from "../../drizzle/schema";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "packpoint" });

/** Tier earn-rate multiplier — applied on top of base 1 pt per $1. */
export const TIER_MULTIPLIER: Record<"free" | "plus" | "concierge", number> = {
  free: 1,
  plus: 5,
  concierge: 10,
};

/** Engagement bonus amounts — see docs/packpoint-policy.md §4. */
export const BONUS_POINTS = {
  signup: 50,
  review: 50,
  referral: 500, // both sides get this
  birthday: 100, // annual
  photo: 10, // per upload, capped per booking
} as const;

/** Maximum redemption per booking — caps at 50% of subtotal. */
export const MAX_REDEMPTION_PCT = 0.5;
/** Minimum redemption — 100 pts ($1). */
export const MIN_REDEMPTION_POINTS = 100;
/** Inactivity expiry — 18 months. */
export const EXPIRY_DAYS = 18 * 30;

export type EarnReason =
  | "booking_earn"
  | "signup_bonus"
  | "review_bonus"
  | "referral_bonus"
  | "birthday_bonus"
  | "photo_bonus";

export type DeductReason = "redemption" | "clawback" | "expiration" | "admin_adjust";

export type PacketReason = EarnReason | DeductReason;

/**
 * Calculate Packpoint earned for a booking.
 * Returns 0 if tour is excluded, user is null, or any input is invalid.
 *
 * @param subtotal Booking subtotal in USD (NOT cents — pass dollars)
 * @param userTier User's current tier (free / plus / concierge)
 * @param tourMultiplierX100 tours.pointsEarnRate (× 100, so 25 = 0.25x)
 * @param excluded tours.excludeFromPackpoint
 */
export function calculateBookingPackpoint(args: {
  subtotal: number;
  userTier: "free" | "plus" | "concierge";
  tourMultiplierX100: number;
  excluded: boolean;
  hasCoupon?: boolean;
}): number {
  if (args.excluded) return 0;
  if (args.hasCoupon) return 0; // policy §8 — no stacking
  if (args.subtotal <= 0) return 0;
  if (args.tourMultiplierX100 <= 0) return 0;

  const tierMul = TIER_MULTIPLIER[args.userTier] ?? 1;
  const tourMul = args.tourMultiplierX100 / 100;

  // Base: 1 pt per $1
  const raw = args.subtotal * 1 * tierMul * tourMul;

  // Safety cap: max 20% of booking ever (= subtotal × 20 pts/$1)
  const cap = args.subtotal * 20;

  return Math.floor(Math.min(raw, cap));
}

/**
 * Award Packpoint to a user. Atomic: writes transaction + updates balance.
 * Returns the new balance, or null if the user wasn't found.
 *
 * Use this for ALL earn events (booking, signup, review, referral, birthday).
 */
export async function awardPackpoint(args: {
  userId: number;
  delta: number;
  reason: EarnReason;
  referenceType?: string;
  referenceId?: number;
  description?: string;
}): Promise<number | null> {
  if (args.delta <= 0) {
    log.warn({ args }, "[Packpoint] awardPackpoint called with non-positive delta");
    return null;
  }
  const db = await getDb();
  if (!db) return null;

  // Use transaction so balance + log + lifetime stay consistent.
  // TiDB Cloud serverless supports transactions on InnoDB-compatible storage.
  return await db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        balance: users.packpointBalance,
        lifetime: users.packpointLifetimeEarned,
      })
      .from(users)
      .where(eq(users.id, args.userId))
      .limit(1);

    if (!user) {
      log.error({ userId: args.userId }, "[Packpoint] User not found");
      return null;
    }

    const newBalance = user.balance + args.delta;
    const newLifetime = user.lifetime + args.delta;

    await tx
      .update(users)
      .set({
        packpointBalance: newBalance,
        packpointLifetimeEarned: newLifetime,
        packpointLastActivityAt: new Date(),
      })
      .where(eq(users.id, args.userId));

    await tx.insert(pointsTransactions).values({
      userId: args.userId,
      delta: args.delta,
      reason: args.reason,
      referenceType: args.referenceType ?? null,
      referenceId: args.referenceId ?? null,
      description: args.description ?? null,
      balanceAfter: newBalance,
    });

    log.info(
      {
        delta: args.delta,
        reason: args.reason,
        userId: args.userId,
        balance: newBalance,
        lifetime: newLifetime,
      },
      "[Packpoint] award",
    );
    return newBalance;
  });
}

/**
 * Deduct Packpoint from a user. Used for redemption / clawback / expiration.
 * Caps at current balance (never goes negative). Returns the new balance.
 *
 * For redemption, pass `reason='redemption'` and updates lastActivityAt.
 * For clawback / expiration, lastActivityAt is NOT touched.
 */
export async function deductPackpoint(args: {
  userId: number;
  amount: number;
  reason: DeductReason;
  referenceType?: string;
  referenceId?: number;
  description?: string;
}): Promise<number | null> {
  if (args.amount <= 0) {
    log.warn({ args }, "[Packpoint] deductPackpoint called with non-positive amount");
    return null;
  }
  const db = await getDb();
  if (!db) return null;

  return await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, balance: users.packpointBalance })
      .from(users)
      .where(eq(users.id, args.userId))
      .limit(1);

    if (!user) {
      log.error({ userId: args.userId }, "[Packpoint] User not found");
      return null;
    }

    // Cap deduction at current balance (no negative balance allowed).
    const actualDeduct = Math.min(args.amount, user.balance);
    const newBalance = user.balance - actualDeduct;

    const updateSet: any = { packpointBalance: newBalance };
    // Redemption is user-driven activity; clawback/expire/admin are not.
    if (args.reason === "redemption") {
      updateSet.packpointLastActivityAt = new Date();
    }

    await tx.update(users).set(updateSet).where(eq(users.id, args.userId));

    await tx.insert(pointsTransactions).values({
      userId: args.userId,
      delta: -actualDeduct,
      reason: args.reason,
      referenceType: args.referenceType ?? null,
      referenceId: args.referenceId ?? null,
      description: args.description ?? null,
      balanceAfter: newBalance,
    });

    log.info(
      {
        deducted: actualDeduct,
        reason: args.reason,
        userId: args.userId,
        balance: newBalance,
      },
      "[Packpoint] deduct",
    );
    return newBalance;
  });
}

/**
 * Award Packpoint for a paid booking. Looks up tour multiplier + user tier
 * and applies the policy formula. Idempotent via referenceId — won't double
 * award if called twice for same booking.
 */
export async function awardBookingPackpoint(args: {
  userId: number;
  bookingId: number;
  tourId: number;
  subtotalUsd: number;
  hasCoupon?: boolean;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Check idempotency: any existing booking_earn row for this bookingId?
  const existing = await db
    .select({ id: pointsTransactions.id })
    .from(pointsTransactions)
    .where(
      sql`${pointsTransactions.referenceType} = 'booking' AND ${pointsTransactions.referenceId} = ${args.bookingId} AND ${pointsTransactions.reason} = 'booking_earn'`
    )
    .limit(1);

  if (existing.length > 0) {
    log.info({ bookingId: args.bookingId }, "[Packpoint] Booking already awarded, skipping");
    return 0;
  }

  // Fetch tour + user in parallel
  const [tourRows, userRows] = await Promise.all([
    db
      .select({
        rate: tours.pointsEarnRate,
        excluded: tours.excludeFromPackpoint,
      })
      .from(tours)
      .where(eq(tours.id, args.tourId))
      .limit(1),
    db
      .select({ tier: users.tier })
      .from(users)
      .where(eq(users.id, args.userId))
      .limit(1),
  ]);

  const tour = tourRows[0];
  const user = userRows[0];
  if (!tour || !user) {
    log.warn({ args }, "[Packpoint] Missing tour or user for booking");
    return 0;
  }

  const points = calculateBookingPackpoint({
    subtotal: args.subtotalUsd,
    userTier: user.tier as "free" | "plus" | "concierge",
    tourMultiplierX100: tour.rate,
    excluded: tour.excluded,
    hasCoupon: args.hasCoupon,
  });

  if (points === 0) {
    log.info(
      { bookingId: args.bookingId },
      "[Packpoint] Booking → 0 pts (excluded/coupon/zero rate)",
    );
    return 0;
  }

  await awardPackpoint({
    userId: args.userId,
    delta: points,
    reason: "booking_earn",
    referenceType: "booking",
    referenceId: args.bookingId,
    description: `Booking #${args.bookingId} ($${args.subtotalUsd}, ${user.tier}×${tour.rate / 100}x)`,
  });

  return points;
}
