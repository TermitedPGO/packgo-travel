/**
 * Packpoint router — Round 80.22 loyalty system: balance, history, redemption
 * estimator, admin adjust + maintenance, referrals.
 *
 * Extracted from server/routers.ts (Phase 4D · sub-PR 4 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1, P0-2 — SOLO REVIEW
 * money-path PR). Source range (verbatim from origin): L695-931.
 *
 * Procedures (7):
 *   - getStatus              (public)    – balance + expiry + tier
 *   - getHistory             (protected) – paginated transaction history
 *   - estimateRedemption     (protected) – preview discount calculation
 *   - adminAdjust            (admin)     – manual balance adjustment
 *   - adminTriggerMaintenance(admin)     – manual maintenance cron trigger
 *   - getReferralStatus      (protected) – current user referral code + counts
 *   - claimReferral          (protected) – attach referral code post-signup
 *
 * Behavioral coverage: balance arithmetic, redemption ceiling, expiry
 * logic live in server/_core/packpoint.test.ts. This Phase 4D extraction
 * is STRUCTURAL only — no procedure body changes.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { ENV } from "../_core/env";

export const packpointRouter = router({
    /**
     * Get current user's Packpoint status: balance, lifetime, last activity,
     * days until inactivity expiry. Returns null balance for guests.
     */
    getStatus: publicProcedure.query(async ({ ctx }) => {
      const user = ctx.user as any;
      if (!user) {
        return {
          balance: 0,
          lifetimeEarned: 0,
          lastActivityAt: null as Date | null,
          daysUntilExpiry: null as number | null,
          tier: "free" as const,
          isLoggedIn: false,
        };
      }

      const lastActivity = user.packpointLastActivityAt
        ? new Date(user.packpointLastActivityAt)
        : null;
      const EXPIRY_DAYS = 18 * 30;
      let daysUntilExpiry: number | null = null;
      if (lastActivity) {
        const elapsed = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
        daysUntilExpiry = Math.max(0, Math.ceil(EXPIRY_DAYS - elapsed));
      }

      return {
        balance: user.packpointBalance ?? 0,
        lifetimeEarned: user.packpointLifetimeEarned ?? 0,
        lastActivityAt: lastActivity,
        daysUntilExpiry,
        tier: (user.tier || "free") as "free" | "plus" | "concierge",
        isLoggedIn: true,
      };
    }),

    /**
     * Paginated transaction history for Profile page.
     * Most recent first; default 20 per page.
     */
    getHistory: protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(20),
          cursor: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { getDb } = await import("../db");
        const db = await getDb();
        if (!db) return { items: [], nextCursor: null };

        const { pointsTransactions } = await import("../../drizzle/schema");
        const { eq, and, lt, desc } = await import("drizzle-orm");

        const conditions = input.cursor
          ? and(
              eq(pointsTransactions.userId, ctx.user.id),
              lt(pointsTransactions.id, input.cursor)
            )
          : eq(pointsTransactions.userId, ctx.user.id);

        const rows = await db
          .select()
          .from(pointsTransactions)
          .where(conditions)
          .orderBy(desc(pointsTransactions.id))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].id : null;

        return { items, nextCursor };
      }),

    /**
     * Estimate redemption value: how much $ does X points buy, capped at
     * 50% of subtotal (policy §5)? Used by checkout UI to show preview.
     */
    estimateRedemption: protectedProcedure
      .input(
        z.object({
          points: z.number().int().min(0),
          subtotalUsd: z.number().min(0),
        })
      )
      .query(({ ctx, input }) => {
        const user = ctx.user as any;
        const balance = user.packpointBalance ?? 0;
        const MIN_POINTS = 100;
        const MAX_REDEMPTION_PCT = 0.5;

        if (input.points === 0) {
          return { discountUsd: 0, valid: true, error: null as string | null };
        }
        if (input.points < MIN_POINTS) {
          return {
            discountUsd: 0,
            valid: false,
            error: `Minimum redemption is ${MIN_POINTS} Packpoint ($1)`,
          };
        }
        if (input.points > balance) {
          return {
            discountUsd: 0,
            valid: false,
            error: `You only have ${balance} Packpoint`,
          };
        }
        const requestedDiscount = input.points / 100; // 100 pt = $1
        const maxDiscount = input.subtotalUsd * MAX_REDEMPTION_PCT;
        const discountUsd = Math.min(requestedDiscount, maxDiscount);
        return { discountUsd, valid: true, error: null };
      }),

    /**
     * Admin: manually adjust a user's Packpoint balance with a reason.
     * Use cases: customer comp (unhappy / VIP gift), missed bonus make-up,
     * fraud clawback, promotional grants. Audit-trail captured automatically
     * via pointsTransactions row with reason='admin_adjust'.
     */
    adminAdjust: adminProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          delta: z.number().int().refine((v) => v !== 0, "delta must be non-zero"),
          description: z.string().min(3).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { awardPackpoint, deductPackpoint } = await import("../_core/packpoint");
        if (input.delta > 0) {
          const newBalance = await awardPackpoint({
            userId: input.userId,
            delta: input.delta,
            reason: "signup_bonus", // closest "earn" reason; we override description
            description: `[Admin ${ctx.user.email}] ${input.description}`,
          });
          if (newBalance === null) {
            throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
          }
          return { newBalance };
        }
        const newBalance = await deductPackpoint({
          userId: input.userId,
          amount: Math.abs(input.delta),
          reason: "admin_adjust",
          description: `[Admin ${ctx.user.email}] ${input.description}`,
        });
        if (newBalance === null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        }
        return { newBalance };
      }),

    /**
     * Admin: trigger the daily Packpoint maintenance run on demand.
     * Useful for testing the auto-upgrade / expiry / birthday flows without
     * waiting for the 02:00 UTC cron.
     */
    adminTriggerMaintenance: adminProcedure.mutation(async ({ ctx }) => {
      const { triggerManualPackpointMaintenance } = await import(
        "../queues/packpointMaintenanceQueue"
      );
      const job = await triggerManualPackpointMaintenance(ctx.user.id);
      return { jobId: String(job.id) };
    }),

    /**
     * Round 80.22 Phase D: get current user's referral code.
     * Lazy-generates if missing (for users created before referrals existed).
     * Returns the code, share URL, and current count of successful referrals.
     */
    getReferralStatus: protectedProcedure.query(async ({ ctx }) => {
      const { ensureReferralCode } = await import("../_core/referral");
      const code = await ensureReferralCode(ctx.user.id);
      const baseUrl = ENV.baseUrl || "https://packgoplay.com";
      const shareUrl = code ? `${baseUrl}/?ref=${code}` : null;

      // Count successful referrals (referees who triggered a payout)
      const drizzleDb = await db.getDb();
      let successfulCount = 0;
      let pendingCount = 0;
      if (drizzleDb) {
        const { users: usersTable } = await import("../../drizzle/schema");
        const { eq, and, sql } = await import("drizzle-orm");
        const [success] = await drizzleDb
          .select({ c: sql<number>`COUNT(*)` })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.referredBy, ctx.user.id),
              eq(usersTable.referralBonusAwarded, true)
            )
          );
        const [pending] = await drizzleDb
          .select({ c: sql<number>`COUNT(*)` })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.referredBy, ctx.user.id),
              eq(usersTable.referralBonusAwarded, false)
            )
          );
        successfulCount = Number(success?.c || 0);
        pendingCount = Number(pending?.c || 0);
      }

      return {
        code,
        shareUrl,
        successfulCount,
        pendingCount,
        rewardPerReferral: 500,
      };
    }),

    /**
     * Round 80.22 Phase D: claim a referral code post-signup. UI calls this
     * once the user is logged in if a `?ref=` param was captured pre-auth.
     * No-op if user already has a referredBy.
     */
    claimReferral: protectedProcedure
      .input(z.object({ code: z.string().min(4).max(16) }))
      .mutation(async ({ ctx, input }) => {
        const { attachReferral } = await import("../_core/referral");
        const ok = await attachReferral({
          refereeUserId: ctx.user.id,
          refereeEmail: ctx.user.email,
          referralCode: input.code,
        });
        return { attached: ok };
      }),
  });
