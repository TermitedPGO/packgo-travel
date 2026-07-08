/**
 * packpointMaintenanceQueue.ts — Round 80.22 Phase C.
 *
 * Daily maintenance for the Packpoint loyalty system. Runs three independent
 * sweeps under a single cron job so we can debug them as one task:
 *
 *   1. Auto-upgrade tier
 *      Free  → Plus      when rolling 12mo spend ≥ $5,000
 *      Plus  → Concierge when rolling 12mo spend ≥ $20,000
 *      Idempotent: tier already matches OR within paid-tier window? skip.
 *
 *   2. 18-month inactivity expiry
 *      Any user with packpointBalance > 0 AND lastActivityAt < 18mo ago →
 *      zero balance, log 'expiration' transaction.
 *
 *   3. Birthday bonus (+100 Packpoint)
 *      Any user whose birthDate matches today's MM-DD AND hasn't received a
 *      birthday bonus this calendar year → award 100 pts.
 *
 * Schedule: daily at 02:00 UTC (10:00 Taipei, 19:00 PT prev day) — chosen
 * to be off-peak, after the 01:00 trip reminder scan.
 *
 * Idempotency: BullMQ jobId pinned to today's date. If the worker dies
 * mid-run, retry picks up where it left off (each user-level mutation has
 * its own idempotency check).
 */

import { Queue, Worker, Job } from "bullmq";
import { redisBullMQ } from "../redis";
import { getDb } from "../db";
import { users, bookings, pointsTransactions } from "../../drizzle/schema";
import { and, eq, gte, lt, sql, isNotNull, isNull, or } from "drizzle-orm";
import { awardPackpoint, deductPackpoint } from "../_core/packpoint";
import { notifyOwner } from "../_core/notification";
import { wireWorkerFunnel } from "../_core/errorFunnel";

const QUEUE_NAME = "packpoint-maintenance";

const PLUS_THRESHOLD_USD = 5_000;
const CONCIERGE_THRESHOLD_USD = 20_000;
const ROLLING_WINDOW_DAYS = 365;
const EXPIRY_DAYS = 18 * 30; // 18 months
const BIRTHDAY_BONUS_POINTS = 100;

export interface PackpointMaintenanceJobData {
  triggeredBy: "schedule" | "manual";
  date?: string; // ISO date for the run
}

export interface PackpointMaintenanceJobResult {
  upgraded: { userId: number; from: string; to: string }[];
  expired: { userId: number; pointsCleared: number }[];
  birthdayAwarded: { userId: number; points: number }[];
  errors: number;
}

export const packpointMaintenanceQueue = new Queue<PackpointMaintenanceJobData, PackpointMaintenanceJobResult>(
  QUEUE_NAME,
  {
    connection: redisBullMQ,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 30 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 30 },
    },
  }
);

/**
 * Schedule the daily Packpoint maintenance run at 02:00 UTC (10:00 Taipei).
 * Idempotent — removes any prior repeating job before re-adding.
 */
export async function scheduleDailyPackpointMaintenance() {
  const repeatableJobs = await packpointMaintenanceQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "daily-packpoint-maintenance") {
      await packpointMaintenanceQueue.removeRepeatableByKey(job.key);
    }
  }
  await packpointMaintenanceQueue.add(
    "daily-packpoint-maintenance",
    { triggeredBy: "schedule" },
    {
      repeat: { pattern: "0 2 * * *" }, // daily 02:00 UTC = 10:00 Taipei
      jobId: "daily-packpoint-maintenance-scheduled",
    }
  );
  console.log("✅ Packpoint maintenance scheduled daily at 10:00 Taipei (02:00 UTC)");
}

/**
 * Manual trigger (admin debug button).
 */
export async function triggerManualPackpointMaintenance(triggeredByUserId?: number) {
  const jobId = `packpoint-manual-${Date.now()}`;
  return await packpointMaintenanceQueue.add(
    "manual-packpoint-maintenance",
    { triggeredBy: "manual", date: new Date().toISOString() } as any,
    { jobId }
  );
}

/* ─────────────────────────── Worker ─────────────────────────── */

let _worker: Worker<PackpointMaintenanceJobData, PackpointMaintenanceJobResult> | null = null;

export function initPackpointMaintenanceWorker() {
  if (_worker) return _worker;
  _worker = new Worker<PackpointMaintenanceJobData, PackpointMaintenanceJobResult>(
    QUEUE_NAME,
    async (job) => {
      const result: PackpointMaintenanceJobResult = {
        upgraded: [],
        expired: [],
        birthdayAwarded: [],
        errors: 0,
      };
      console.log(`[PackpointMaintenance] Run started (${job.data.triggeredBy})`);

      try {
        await runAutoUpgrade(result);
      } catch (err) {
        console.error("[PackpointMaintenance] auto-upgrade failed:", err);
        result.errors++;
      }
      try {
        await runExpirySweep(result);
      } catch (err) {
        console.error("[PackpointMaintenance] expiry sweep failed:", err);
        result.errors++;
      }
      try {
        await runBirthdayBonus(result);
      } catch (err) {
        console.error("[PackpointMaintenance] birthday bonus failed:", err);
        result.errors++;
      }
      // Round 80.22 Phase F: also sweep expired vouchers in same daily run.
      try {
        const { sweepExpiredVouchers } = await import("../_core/vouchers");
        const sweep = await sweepExpiredVouchers();
        if (sweep.swept > 0) {
          console.log(`[PackpointMaintenance] Voucher sweep: ${sweep.swept} expired`);
        }
      } catch (err) {
        console.error("[PackpointMaintenance] voucher sweep failed:", err);
        result.errors++;
      }

      console.log(
        `[PackpointMaintenance] ✅ Done — upgrade=${result.upgraded.length}, expire=${result.expired.length}, birthday=${result.birthdayAwarded.length}, errors=${result.errors}`
      );
      return result;
    },
    {
      connection: redisBullMQ,
      concurrency: 1, // serial — these touch all users, parallelism gives nothing
    }
  );

  _worker.on("failed", (job, err) => {
    console.error(`[PackpointMaintenance] Job ${job?.id} FAILED:`, err.message);
    notifyOwner({
      title: `[PackpointMaintenance] Job ${job?.id ?? "?"} failed`,
      content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
    }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
  });

  wireWorkerFunnel(_worker, QUEUE_NAME);

  console.log("✅ Packpoint maintenance worker initialized");
  return _worker;
}

/* ─────────────────────── Auto-upgrade ─────────────────────── */

async function runAutoUpgrade(result: PackpointMaintenanceJobResult) {
  const db = await getDb();
  if (!db) return;

  const since = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // For each user, sum their PAID bookings in rolling window. We sum on the
  // server in one query for efficiency. Bookings need to be paid (paid status)
  // to count — pending/cancelled don't.
  const spendRows = await db
    .select({
      userId: bookings.userId,
      totalSpend: sql<number>`COALESCE(SUM(${bookings.totalPrice}), 0)`,
    })
    .from(bookings)
    .where(
      and(
        isNotNull(bookings.userId),
        gte(bookings.createdAt, since),
        eq(bookings.paymentStatus, "paid")
      )
    )
    .groupBy(bookings.userId);

  for (const row of spendRows) {
    if (!row.userId) continue;
    const spend = Number(row.totalSpend);

    // Determine target tier by spend
    let targetTier: "free" | "plus" | "concierge" = "free";
    if (spend >= CONCIERGE_THRESHOLD_USD) targetTier = "concierge";
    else if (spend >= PLUS_THRESHOLD_USD) targetTier = "plus";

    if (targetTier === "free") continue;

    // Get current user state
    const [user] = await db
      .select({
        id: users.id,
        tier: users.tier,
        tierExpiresAt: users.tierExpiresAt,
        stripeSubscriptionId: users.stripeSubscriptionId,
      })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!user) continue;

    // Skip if user is already at this tier or higher
    const tierRank = { free: 0, plus: 1, concierge: 2 };
    const currentRank = tierRank[user.tier as "free" | "plus" | "concierge"] ?? 0;
    const targetRank = tierRank[targetTier];
    if (currentRank >= targetRank) continue;

    // Skip if user has active paid subscription — they're already paying for
    // tier benefits, no need to override. Only auto-upgrade when no active sub.
    if (user.stripeSubscriptionId) continue;

    // Upgrade: set tier + 12-month grace period as tierExpiresAt
    const newExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await db
      .update(users)
      .set({
        tier: targetTier,
        tierExpiresAt: newExpiresAt,
      })
      .where(eq(users.id, user.id));

    // Audit trail via pointsTransactions (admin_adjust with description)
    try {
      await db.insert(pointsTransactions).values({
        userId: user.id,
        delta: 0,
        reason: "admin_adjust",
        referenceType: "auto_upgrade",
        description: `Auto-upgrade ${user.tier} → ${targetTier} (12mo spend $${spend})`,
        balanceAfter: 0, // unchanged for tier upgrade
      });
    } catch (err) {
      // Non-critical — log but don't fail
      console.warn(`[PackpointMaintenance] audit log failed for user ${user.id}:`, err);
    }

    result.upgraded.push({ userId: user.id, from: user.tier as string, to: targetTier });
    console.log(
      `[PackpointMaintenance] ✓ Auto-upgraded user ${user.id}: ${user.tier} → ${targetTier} (spend $${spend})`
    );
  }
}

/* ─────────────────── 18-month expiry sweep ─────────────────── */

async function runExpirySweep(result: PackpointMaintenanceJobResult) {
  const db = await getDb();
  if (!db) return;

  const cutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const expiringUsers = await db
    .select({
      id: users.id,
      balance: users.packpointBalance,
      lastActivity: users.packpointLastActivityAt,
    })
    .from(users)
    .where(
      and(
        sql`${users.packpointBalance} > 0`,
        or(
          // No activity ever AND has balance (engagement bonus from signup)
          isNull(users.packpointLastActivityAt),
          // OR last activity > 18mo ago
          lt(users.packpointLastActivityAt, cutoff)
        )!
      )
    );

  for (const u of expiringUsers) {
    if (u.balance <= 0) continue;
    // Use deductPackpoint so audit trail is automatic. reason='expiration'
    // does NOT update lastActivityAt (so an expiry event doesn't reset
    // the timer indefinitely).
    await deductPackpoint({
      userId: u.id,
      amount: u.balance,
      reason: "expiration",
      description: `18-month inactivity expiry (last activity: ${u.lastActivity?.toISOString() || "never"})`,
    });
    result.expired.push({ userId: u.id, pointsCleared: u.balance });
    console.log(
      `[PackpointMaintenance] ✓ Expired ${u.balance} pts from user ${u.id} (inactive 18mo+)`
    );
  }
}

/* ──────────────────────── Birthday ──────────────────────── */

async function runBirthdayBonus(result: PackpointMaintenanceJobResult) {
  const db = await getDb();
  if (!db) return;

  const today = new Date();
  const todayMonth = today.getUTCMonth() + 1; // 1-12
  const todayDay = today.getUTCDate(); // 1-31
  const yearStart = new Date(today.getUTCFullYear(), 0, 1);

  // Find users whose birthDate's MM-DD matches today
  const birthdayUsers = await db
    .select({
      id: users.id,
      birthDate: users.birthDate,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.birthDate),
        sql`MONTH(${users.birthDate}) = ${todayMonth}`,
        sql`DAY(${users.birthDate}) = ${todayDay}`
      )
    );

  for (const u of birthdayUsers) {
    // Idempotency: did we already give birthday bonus this calendar year?
    const existing = await db
      .select({ id: pointsTransactions.id })
      .from(pointsTransactions)
      .where(
        and(
          eq(pointsTransactions.userId, u.id),
          eq(pointsTransactions.reason, "birthday_bonus"),
          gte(pointsTransactions.createdAt, yearStart)
        )
      )
      .limit(1);

    if (existing.length > 0) continue; // already got this year

    await awardPackpoint({
      userId: u.id,
      delta: BIRTHDAY_BONUS_POINTS,
      reason: "birthday_bonus",
      description: `🎂 ${today.getUTCFullYear()} 生日獎勵`,
    });
    result.birthdayAwarded.push({ userId: u.id, points: BIRTHDAY_BONUS_POINTS });
    console.log(`[PackpointMaintenance] ✓ Birthday +${BIRTHDAY_BONUS_POINTS} for user ${u.id}`);
  }
}
