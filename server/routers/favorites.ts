/**
 * Favorites router — saved tours per logged-in user.
 *
 * Extracted from server/routers.ts (Phase 4A · sub-PR 1 of 5) on
 * 2026-05-18 as part of the routers.ts split (audit P0-1).
 * All procedures verbatim from the source range L1486-1527.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const favoritesRouter = router({
  // Get user's favorite tour IDs (for quick checking)
  getIds: protectedProcedure.query(async ({ ctx }) => {
    return await db.getUserFavoriteIds(ctx.user.id);
  }),

  // Get user's favorite tours with details
  list: protectedProcedure.query(async ({ ctx }) => {
    return await db.getUserFavorites(ctx.user.id);
  }),

  // Add a tour to favorites
  add: protectedProcedure
    .input(z.object({ tourId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.addFavorite(ctx.user.id, input.tourId);
      return { success: true };
    }),

  // Remove a tour from favorites
  remove: protectedProcedure
    .input(z.object({ tourId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.removeFavorite(ctx.user.id, input.tourId);
      return { success: true };
    }),

  // Toggle favorite status
  toggle: protectedProcedure
    .input(z.object({ tourId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const isFav = await db.isFavorite(ctx.user.id, input.tourId);
      if (isFav) {
        await db.removeFavorite(ctx.user.id, input.tourId);
        return { isFavorite: false };
      } else {
        await db.addFavorite(ctx.user.id, input.tourId);
        return { isFavorite: true };
      }
    }),
});
