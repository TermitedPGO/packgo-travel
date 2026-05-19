/**
 * WeChat assistant router — admin paste inbound message → AI draft reply → approve / skip flow.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L4260-4355.
 *
 * Procedures (4):
 *   - draftReply   – paste inbound, return AI draft + intent
 *   - listPending  – list `ready_review` messages
 *   - approve      – approve draft → mark sent/approved
 *   - skip         – mark skipped (no reply)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

// v74 bounded string helpers — preserved from routers.ts
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const noControlChars = (s: string) => !CONTROL_CHARS.test(s);
const shortStr = z.string().max(255).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });
const mediumStr = z.string().max(5_000).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });

export const wechatAssistRouter = router({
    // Admin pastes inbound message → gets AI draft back
    draftReply: adminProcedure
      .input(
        z.object({
          inboundText: z.string().min(1).max(5000),
          source: z.enum(["wechat_oa", "manual_paste", "moments_reply"]).default("manual_paste"),
          fromDisplayName: shortStr.optional(),
          fromOpenId: shortStr.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { draftReply } = await import("../services/wechatAssistService");
        const result = await draftReply(input);
        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "wechat.draftReply",
          targetType: "wechatMessage",
          targetId: result.messageId || "n/a",
          changes: { source: input.source, intent: result.detectedIntent.join(",") },
        });
        return result;
      }),

    // List pending messages (status=ready_review)
    listPending: adminProcedure.query(async () => {
      const dbi = await db.getDb();
      if (!dbi) return [];
      const { wechatMessages } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return await dbi
        .select()
        .from(wechatMessages)
        .where(eq(wechatMessages.status, "ready_review" as any))
        .orderBy(desc(wechatMessages.receivedAt))
        .limit(50);
    }),

    // Approve / mark sent
    approve: adminProcedure
      .input(
        z.object({
          messageId: z.number().int().positive().max(2_147_483_647),
          finalText: mediumStr.min(1),
          markAsSent: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbi = await db.getDb();
        if (!dbi) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { wechatMessages } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await dbi
          .update(wechatMessages)
          .set({
            finalText: input.finalText,
            approvedAt: new Date(),
            sentAt: input.markAsSent ? new Date() : null,
            status: input.markAsSent ? "sent" : "approved",
          } as any)
          .where(eq(wechatMessages.id, input.messageId));

        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "wechat.approve",
          targetType: "wechatMessage",
          targetId: input.messageId,
          changes: { markAsSent: input.markAsSent },
        });
        return { success: true };
      }),

    // Mark as skipped (don't reply)
    skip: adminProcedure
      .input(z.object({ messageId: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        const dbi = await db.getDb();
        if (!dbi) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { wechatMessages } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await dbi
          .update(wechatMessages)
          .set({ status: "skipped" as any })
          .where(eq(wechatMessages.id, input.messageId));
        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "wechat.skip",
          targetType: "wechatMessage",
          targetId: input.messageId,
        });
        return { success: true };
      }),
  });
