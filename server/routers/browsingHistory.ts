/**
 * Browsing history router — recent tour views per logged-in user.
 *
 * Extracted from server/routers.ts (Phase 4A · sub-PR 1 of 5) on
 * 2026-05-18 as part of the routers.ts split (audit P0-1).
 * All procedures verbatim from the source range L1528-1551.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const browsingHistoryRouter = router({
  // Get user's browsing history
  list: protectedProcedure
    .input(z.object({ limit: z.number().optional().default(20) }).optional())
    .query(async ({ ctx, input }) => {
      return await db.getUserBrowsingHistory(ctx.user.id, input?.limit);
    }),

  // Record a tour view
  record: protectedProcedure
    .input(z.object({ tourId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.recordBrowsingHistory(ctx.user.id, input.tourId);
      return { success: true };
    }),

  // Clear browsing history
  clear: protectedProcedure.mutation(async ({ ctx }) => {
    await db.clearBrowsingHistory(ctx.user.id);
    return { success: true };
  }),
});
