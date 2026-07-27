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
    // 2026-07-25 Jeff 裁定:AI 顧問對所有人免費,不再用會員等級決定額度。
    // 原話:「我們的價格也不能比 chatgpt 或者 claude 貴」「也是免費好了」。
    // 成本實算(haiku,每則輸入約 2000 + 輸出約 500 token)約 0.004 美元,
    // 為此設會員門檻擋掉的生意遠大於省下的成本。
    //
    // 移除的只有「會員等級閘」。防濫用限流仍在 chat 內保留(IP 每小時、
    // IP 每日、全站匿名每日;2026-07-26 R2 更正:先前誤寫 per-session),
    // 那是成本天花板不是會員門檻,不得一併移除。
    // 本 procedure 現在回傳 cap: -1(無上限),前端據此不再顯示額度膠囊與付費牆。
    getQuota: publicProcedure.query(async () => {
      return { tier: "free" as const, used: 0, cap: -1, windowDays: 30 };
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

        // 2026-07-25 Jeff 裁定:AI 顧問對所有人免費,無會員等級額度。
        // 原話:「我們的價格也不能比 chatgpt 或者 claude 貴」「也是免費好了」。
        // 上方的多層防濫用限流(IP 每小時、IP 每日、全站匿名每日/使用者每日)
        // 是成本天花板,
        // 與會員無關,保留不動。使用記錄照寫,供分析與濫用偵測。
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
                tier: "free", // 2026-07-25 起無付費等級,一律 free

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
            // 2026-07-25 起 AI 顧問免額度,quota 固定 null,前端不再顯示計數膠囊。
            quota: null,
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
