/**
 * Round 80.22 Phase D: Referral system helpers.
 *
 * Code format: 8 chars, uppercase A-Z + 0-9, excluding ambiguous (0/O, 1/I/L).
 * Example: "PACK7K3M" — namespaced prefix makes it brandable + identifiable.
 *
 * Lifecycle:
 *   1. signup → generateReferralCode() persisted on users row
 *   2. referrer shares packgoplay.com/?ref=PACK7K3M
 *   3. landing page reads ?ref param → cookie "packgo_ref" (90-day TTL)
 *   4. referee signs up → cookie consumed → users.referredBy = referrer.id
 *   5. referee's FIRST paid booking → award both sides +500 (in webhook)
 *   6. referralBonusAwarded = true so renewals/repeat bookings don't re-pay
 *
 * Anti-abuse:
 *   - Same email + ref code = no-op (can't refer yourself)
 *   - Referrer not found = silent skip (don't break signup)
 *   - Referee already has referredBy set = ignore subsequent ref params
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // exclude 0/O/1/I/L
const PREFIX = "PACK";
const SUFFIX_LENGTH = 4; // PACK + 4 chars = 8 total

/** Generate a random 8-char referral code (PACK + 4 random alphanumeric). */
function generateCode(): string {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return PREFIX + suffix;
}

/**
 * Assign a unique referral code to a user (idempotent — does nothing if
 * already set). Retries on collision up to 5 times.
 *
 * Call this:
 *   - In createUserWithPassword / createUserWithGoogle right after insert
 *   - Lazily on first profile-page query for legacy users without a code
 */
export async function ensureReferralCode(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  // Check if already set
  const [user] = await db
    .select({ id: users.id, code: users.referralCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  if (user.code) return user.code;

  // Generate + persist with collision retry
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));
      console.log(`[Referral] Assigned code ${code} to user ${userId}`);
      return code;
    } catch (err: any) {
      if (err?.code === "ER_DUP_ENTRY" || /Duplicate entry/i.test(err?.message || "")) {
        continue; // retry with different code
      }
      throw err;
    }
  }
  console.error(`[Referral] Failed to generate unique code after 5 retries for user ${userId}`);
  return null;
}

/**
 * Resolve a referral code to a user id (case-insensitive, trims whitespace).
 * Returns null if code is malformed or doesn't match anyone.
 */
export async function resolveReferralCode(code: string): Promise<number | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^PACK[A-Z2-9]{4}$/.test(normalized)) return null;
  const db = await getDb();
  if (!db) return null;
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.referralCode, normalized))
    .limit(1);
  return user?.id ?? null;
}

/**
 * Apply a referral relationship to a newly-created user.
 *
 * Called from createUserWith* functions after the user row exists. Validates:
 *   - referrerCode resolves to a valid user
 *   - referrer is NOT the same user (no self-referral)
 *   - referee doesn't already have a referredBy
 *
 * Returns true if attached, false if skipped (so caller can log).
 * Does NOT award points yet — that happens on first paid booking.
 */
export async function attachReferral(args: {
  refereeUserId: number;
  refereeEmail: string;
  referralCode: string;
}): Promise<boolean> {
  const referrerId = await resolveReferralCode(args.referralCode);
  if (!referrerId) {
    console.log(`[Referral] Code ${args.referralCode} not found, skipping`);
    return false;
  }
  if (referrerId === args.refereeUserId) {
    console.warn(`[Referral] Self-referral attempt user ${args.refereeUserId}`);
    return false;
  }

  const db = await getDb();
  if (!db) return false;

  // Check if referee already has a referrer (can't change once set)
  const [referee] = await db
    .select({ existing: users.referredBy, email: users.email })
    .from(users)
    .where(eq(users.id, args.refereeUserId))
    .limit(1);
  if (!referee) return false;
  if (referee.existing) {
    console.log(
      `[Referral] User ${args.refereeUserId} already has referredBy=${referee.existing}, ignoring new code`
    );
    return false;
  }

  // Anti-fraud: detect potential same-person via shared email domain
  // (cheap heuristic; full fraud detection is out of scope here).
  const [referrer] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, referrerId))
    .limit(1);
  if (referrer && referrer.email === args.refereeEmail) {
    console.warn(
      `[Referral] Same email on both sides (${args.refereeEmail}) — likely self-referral, blocked`
    );
    return false;
  }

  await db.update(users).set({ referredBy: referrerId }).where(eq(users.id, args.refereeUserId));
  console.log(
    `[Referral] User ${args.refereeUserId} (${args.refereeEmail}) referred by user ${referrerId}`
  );
  return true;
}

/**
 * Award referral bonuses to BOTH referrer and referee on the referee's
 * first paid booking. Idempotent: checks referralBonusAwarded flag before
 * paying out.
 *
 * Called from the Stripe webhook after marking a booking 'paid'. Returns
 * the points awarded (0 if no payout happened).
 */
export async function awardReferralOnFirstBooking(args: {
  refereeUserId: number;
  bookingId: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const [referee] = await db
    .select({
      id: users.id,
      referredBy: users.referredBy,
      bonusAwarded: users.referralBonusAwarded,
    })
    .from(users)
    .where(eq(users.id, args.refereeUserId))
    .limit(1);
  if (!referee) return 0;
  if (!referee.referredBy) return 0; // no referrer
  if (referee.bonusAwarded) return 0; // already paid

  const REFERRAL_BONUS = 500;
  const { awardPackpoint } = await import("./packpoint");

  // Award referee
  await awardPackpoint({
    userId: referee.id,
    delta: REFERRAL_BONUS,
    reason: "referral_bonus",
    referenceType: "booking",
    referenceId: args.bookingId,
    description: `推薦獎勵(您透過朋友推薦完成首單)`,
  });

  // Award referrer
  await awardPackpoint({
    userId: referee.referredBy,
    delta: REFERRAL_BONUS,
    reason: "referral_bonus",
    referenceType: "user",
    referenceId: referee.id,
    description: `推薦獎勵(被推薦人完成首次付款訂單)`,
  });

  // Flip the flag so future bookings don't re-trigger
  await db
    .update(users)
    .set({ referralBonusAwarded: true })
    .where(eq(users.id, referee.id));

  console.log(
    `[Referral] ✓ Paid +${REFERRAL_BONUS} to both user ${referee.id} (referee) and user ${referee.referredBy} (referrer)`
  );
  return REFERRAL_BONUS;
}
