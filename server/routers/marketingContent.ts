/**
 * Marketing AI content router — generates weekly social posts.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L4362-4392.
 *
 * Procedures (1):
 *   - generateWeekly  – v78n Sprint 6B: fanout top-N tours → IG/FB/RED drafts
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";

export const marketingContentRouter = router({
    generateWeekly: adminProcedure
      .input(
        z.object({
          topN: z.number().int().min(1).max(5).default(3),
          language: z.enum(["zh-TW", "en"]).default("zh-TW"),
          platforms: z
            .array(z.enum(["instagram", "facebook", "xiaohongshu"]))
            .default(["instagram", "facebook", "xiaohongshu"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { generateWeeklySocialPosts } = await import(
          "../services/marketingContentService"
        );
        const drafts = await generateWeeklySocialPosts(
          input.topN,
          input.language,
          input.platforms
        );
        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "marketing.generateWeekly",
          targetType: "system",
          targetId: 0,
          changes: { drafts: drafts.length, language: input.language },
        });
        return { drafts };
      }),
  });
