/**
 * AI Travel Advisor router — quota check, skill-enhanced chat,
 * feedback + conversion tracking.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (4):
 *   - getQuota          – check current tier quota without consuming
 *   - chat              – skill-enhanced AI chat with rate limit + paywall
 *   - recordFeedback    – capture thumbs up/down (session-or-user gated)
 *   - recordConversion  – capture booking/inquiry/favorite/share conversion
 *
 * Includes the security helper `assertOwnsUsageLogs` (SECURITY_AUDIT_2026_05_14
 * P2-5): verifies every passed-in skillUsageLog id belongs to the caller
 * (either same userId, or same sessionId). Throws FORBIDDEN if mismatch.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import {
  checkAiChatRateLimit,
  checkAiChatDailyLimit,
  checkAiChatGlobalAnonymousLimit,
  checkAiChatUserDailyLimit,
} from "../rateLimit";

// v74 bounded string helpers
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const noControlChars = (s: string) => !CONTROL_CHARS.test(s);
const mediumStr = z.string().max(5_000).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });

/**
 * SECURITY_AUDIT_2026_05_14 P2-5 helper: verify every passed-in skillUsageLog
 * id belongs to the caller (either same userId, or same sessionId). Throws
 * FORBIDDEN if any id doesn't match — preventing anonymous tampering with
 * skill-performance feedback / conversion analytics.
 */
async function assertOwnsUsageLogs(
  usageLogIds: number[],
  caller: { userId?: number; sessionId?: string }
): Promise<void> {
  if (usageLogIds.length === 0) return;
  if (!caller.userId && !caller.sessionId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Provide a sessionId or sign in to record feedback.",
    });
  }
  const { skillUsageLog } = await import("../../drizzle/schema");
  const { and, inArray, or, eq } = await import("drizzle-orm");
  const { getDb } = await import("../db");
  const dbInst = await getDb();
  if (!dbInst) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  }
  const ownClauses = [
    caller.userId ? eq(skillUsageLog.userId, caller.userId) : null,
    caller.sessionId ? eq(skillUsageLog.sessionId, caller.sessionId) : null,
  ].filter(Boolean) as any[];
  const ownership = ownClauses.length === 1 ? ownClauses[0] : or(...ownClauses);
  const rows = await dbInst
    .select({ id: skillUsageLog.id })
    .from(skillUsageLog)
    .where(and(inArray(skillUsageLog.id, usageLogIds), ownership));
  if (rows.length !== usageLogIds.length) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "One or more usage-log ids do not belong to this session.",
    });
  }
}

export const aiRouter = router({
    // Round 80.19: query current quota status without consuming a message.
    // Used by dialog open to show the counter pill + paywall preview.
    getQuota: publicProcedure.query(async ({ ctx }) => {
      const userTier = (ctx.user as any)?.tier || "free";
      const isPaidTier = userTier === "plus" || userTier === "concierge";
      if (isPaidTier) {
        return { tier: userTier as "plus" | "concierge", used: 0, cap: -1, windowDays: 30 };
      }
      const FREE_TIER_LIMIT = 5;
      const FREE_TIER_WINDOW_DAYS = 30;
      const ip = ctx.ip;
      const { createHash } = await import("crypto");
      const ipHashKey = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 64) : null;
      const userIdKey = ctx.user?.id ?? null;
      const { aiAdvisorUsage } = await import("../../drizzle/schema");
      const { sql, and, gt, eq } = await import("drizzle-orm");
      const { getDb } = await import("../db");
      const db = await getDb();
      let usage = 0;
      if (db) {
        const since = new Date(Date.now() - FREE_TIER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const conditions = userIdKey
          ? and(eq(aiAdvisorUsage.userId, userIdKey), gt(aiAdvisorUsage.createdAt, since))
          : ipHashKey
          ? and(eq(aiAdvisorUsage.ipHash, ipHashKey), gt(aiAdvisorUsage.createdAt, since))
          : null;
        if (conditions) {
          const rows = await db
            .select({ c: sql<number>`COUNT(*)` })
            .from(aiAdvisorUsage)
            .where(conditions);
          usage = Number(rows[0]?.c || 0);
        }
      }
      return {
        tier: "free" as const,
        used: usage,
        cap: FREE_TIER_LIMIT,
        windowDays: FREE_TIER_WINDOW_DAYS,
      };
    }),

    // Skill-enhanced AI chat with performance tracking.
    // Code-review 2026-05-09: bounded message + history to prevent DoS
    // (single 100MB request could stall LLM and rack up cost). 5000 chars
    // is plenty for natural-language travel inquiries; 50 history items
    // covers any realistic conversation turn.
    chat: publicProcedure
      .input(
        z.object({
          message: z.string().max(5000),
          conversationHistory: z.array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(5000),
            })
          ).max(50).optional(),
          sessionId: z.string().max(200).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Round 72: Multi-layered rate limit for AI chat.
        // Prior state: (ctx as any).ip was ALWAYS undefined because TrpcContext
        // didn't expose ip, so the per-IP hourly bucket was effectively global.
        // Now ctx.ip is populated by getClientIp() in context.ts (Fly-Client-IP
        // → X-Forwarded-For → socket → "unknown"), and we layer three caps:
        //   1. Per-IP hourly (60/hr) — slows single-IP burst abuse
        //   2. Per-IP daily  (200/day) — catches persistent low-burst abuse
        //   3. Global anonymous daily (5000/day) — caps total $ cost ceiling
        // Logged-in users get their own user-scoped daily cap (500/day) and
        // bypass the global anonymous bucket.
        const ip = ctx.ip;
        const isAuthenticated = !!ctx.user?.id;

        // Per-IP hourly cap always applies.
        const hourlyLimit = await checkAiChatRateLimit(ip);
        if (!hourlyLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "AI 對話請求過於頻繁，請稍後再試",
          });
        }

        // Per-IP daily cap always applies.
        const dailyLimit = await checkAiChatDailyLimit(ip);
        if (!dailyLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "今日 AI 對話配額已達上限，請明日再試或登入取得更高配額",
          });
        }

        if (isAuthenticated) {
          // Authenticated users: per-user daily cap (more generous).
          const userDailyLimit = await checkAiChatUserDailyLimit(ctx.user!.id);
          if (!userDailyLimit.allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "今日 AI 對話配額已達上限（500 則 / 日），明日重置",
            });
          }
        } else {
          // Anonymous users: also counted against global anon bucket (cost ceiling).
          const globalAnon = await checkAiChatGlobalAnonymousLimit();
          if (!globalAnon.allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "AI 助理今日流量已達上限，請登入或稍後再試",
            });
          }
        }

        // Round 80.19: AI Advisor Phase 1 — tier-based rate limit.
        // Free / anonymous users: 5 messages / rolling 30-day window.
        // Plus / Concierge members: unlimited (still logged for abuse cap).
        // We check BEFORE calling the LLM so users hitting the limit get
        // an immediate paywall response instead of paying for one more
        // turn.
        const userTier = (ctx.user as any)?.tier || "free";
        const isPaidTier = userTier === "plus" || userTier === "concierge";
        const FREE_TIER_LIMIT = 5;
        const FREE_TIER_WINDOW_DAYS = 30;

        let usageBefore = 0;
        if (!isPaidTier) {
          // Compute identity key for rate limit: userId for logged-in,
          // sha256(ip) for anonymous.
          const { createHash } = await import("crypto");
          const ipHashKey = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 64) : null;
          const userIdKey = ctx.user?.id ?? null;

          // Count messages in the rolling 30-day window. Use raw SQL because
          // Drizzle's count() doesn't support `gt` on timestamps cleanly here.
          const { aiAdvisorUsage } = await import("../../drizzle/schema");
          const { sql, and, gt, eq } = await import("drizzle-orm");
          const { getDb } = await import("../db");
          const db = await getDb();
          if (db) {
            const since = new Date(Date.now() - FREE_TIER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
            const conditions = userIdKey
              ? and(eq(aiAdvisorUsage.userId, userIdKey), gt(aiAdvisorUsage.createdAt, since))
              : ipHashKey
              ? and(eq(aiAdvisorUsage.ipHash, ipHashKey), gt(aiAdvisorUsage.createdAt, since))
              : null;
            if (conditions) {
              const rows = await db
                .select({ c: sql<number>`COUNT(*)` })
                .from(aiAdvisorUsage)
                .where(conditions);
              usageBefore = Number(rows[0]?.c || 0);
            }
          }

          if (usageBefore >= FREE_TIER_LIMIT) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: JSON.stringify({
                kind: "QUOTA_EXCEEDED",
                tier: "free",
                used: usageBefore,
                cap: FREE_TIER_LIMIT,
                windowDays: FREE_TIER_WINDOW_DAYS,
                upgradeUrl: "/membership",
              }),
            });
          }
        }

        const { message, conversationHistory = [], sessionId } = input;
        const { processMessageWithSkills } = await import("../services/aiChatSkillService");

        try {
          // Process message with skill integration
          const result = await processMessageWithSkills({
            message,
            conversationHistory,
            userId: ctx.user?.id,
            sessionId: sessionId || `session_${Date.now()}`,
          });

          // Round 80.19: log usage (regardless of tier, for analytics + abuse).
          try {
            const { aiAdvisorUsage } = await import("../../drizzle/schema");
            const { getDb } = await import("../db");
            const db = await getDb();
            if (db) {
              const { createHash } = await import("crypto");
              const ipHashKey = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 64) : null;
              await db.insert(aiAdvisorUsage).values({
                ipHash: ctx.user?.id ? null : ipHashKey,
                userId: ctx.user?.id ?? null,
                sessionId: sessionId || null,
                messagePreview: message.slice(0, 500),
                tokenCount: 0, // could be filled from result if exposed
                tier: userTier,
              });
            }
          } catch (logErr) {
            console.warn("[AI Chat] Usage log failed (non-fatal):", logErr);
          }

          return {
            response: result.response,
            triggeredSkills: result.triggeredSkills.map(s => ({
              skillId: s.skillId,
              skillName: s.skillName,
              confidence: s.confidence,
            })),
            usageLogIds: result.usageLogIds,
            // Round 80.19: surface remaining quota so the UI can show a counter.
            quota: isPaidTier
              ? null
              : {
                  used: usageBefore + 1, // we just consumed one
                  cap: FREE_TIER_LIMIT,
                  windowDays: FREE_TIER_WINDOW_DAYS,
                  tier: "free" as const,
                },
          };
        } catch (error) {
          console.error("[AI Chat] Error:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "無法連接到 AI 服務，請稍後再試。",
          });
        }
      }),

    // Record user feedback for AI chat response.
    //
    // SECURITY_AUDIT_2026_05_14 P2-5: was an unauthenticated publicProcedure
    // accepting any usageLogIds — anyone could pollute skill-performance
    // analytics. Now requires either:
    //   (a) `sessionId` matching the chat session that produced the logs, OR
    //   (b) authenticated user whose own logs are being annotated.
    // Server checks every passed-in id and rejects if any of them doesn't
    // belong to the caller. Tighter than the audit's two suggested options
    // ("session token" or "protectedProcedure") because it accepts both,
    // which preserves anonymous-chat feedback while still gating writes.
    recordFeedback: publicProcedure
      .input(
        z.object({
          sessionId: z.string().min(1).max(200).optional(),
          usageLogIds: z.array(z.number().int().positive()).max(100),
          feedback: z.enum(["positive", "negative"]),
          comment: mediumStr.optional(), // v73: bound 5KB max
        })
      )
      .mutation(async ({ input, ctx }) => {
        await assertOwnsUsageLogs(input.usageLogIds, {
          userId: ctx.user?.id,
          sessionId: input.sessionId,
        });
        const { recordChatFeedback } = await import("../services/aiChatSkillService");
        await recordChatFeedback(input.usageLogIds, input.feedback, input.comment);
        return { success: true };
      }),

    // Record conversion from AI chat session.
    //
    // SECURITY_AUDIT_2026_05_14 P2-5: same session-or-user gate as
    // recordFeedback above. Conversion writes feed the skill-performance
    // training loop, so anonymous tampering would poison future skill
    // matching.
    recordConversion: publicProcedure
      .input(
        z.object({
          sessionId: z.string().min(1).max(200).optional(),
          usageLogIds: z.array(z.number().int().positive()).max(100),
          conversionType: z.enum(["booking", "inquiry", "favorite", "share"]),
          conversionId: z.number().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await assertOwnsUsageLogs(input.usageLogIds, {
          userId: ctx.user?.id,
          sessionId: input.sessionId,
        });
        const { recordChatConversion } = await import("../services/aiChatSkillService");
        await recordChatConversion(input.usageLogIds, input.conversionType, input.conversionId);
        return { success: true };
      }),
  });
