/**
 * Affiliate (Trip.com) router — admin stats + price-comparison data only.
 *
 * Phase 1 is homepage-only clickout. The public link generation and click tracking
 * that used to live here were removed: redirect + best-effort telemetry now happen in
 * ONE first-party server endpoint, GET /go/trip/:source (see server/services/tripRedirect
 * and _core/index.ts). There is deliberately no public generateAffiliateLink query and
 * no public trackClick mutation — nothing lets the browser rebuild a target URL or
 * supply a raw referrer/route/city/tourId.
 *
 * Remaining procedures (6):
 *   - getStats                – admin: aggregate stats over N days
 *   - getClicks               – admin: paginated raw redirect-telemetry feed
 *   - upsertPriceComparison   – admin: tour price comparison row write
 *   - getPriceComparisons     – admin: list all price comparisons
 *   - deletePriceComparison   – admin: remove a price comparison row
 *   - getPriceComparison      – public: per-tour comparison fetch
 */

import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const affiliateRouter = router({
    getStats: adminProcedure
      .input(z.object({ days: z.number().default(30) }))
      .query(async ({ input }) => {
        return db.getAffiliateStats(input.days);
      }),

    getClicks: adminProcedure
      .input(z.object({
        platform: z.string().optional(),
        limit: z.number().default(100),
      }))
      .query(async ({ input }) => {
        return db.getAffiliateClicks({ platform: input.platform, limit: input.limit });
      }),

    upsertPriceComparison: adminProcedure
      .input(z.object({
        tourId: z.number(),
        flightEstimate: z.number().optional(),
        hotelEstimate: z.number().optional(),
        activityEstimate: z.number().optional(),
        mealEstimate: z.number().optional(),
        transportEstimate: z.number().optional(),
        otherEstimate: z.number().optional(),
        flightSource: z.string().optional(),
        hotelSource: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const total = (input.flightEstimate ?? 0)
          + (input.hotelEstimate ?? 0)
          + (input.activityEstimate ?? 0)
          + (input.mealEstimate ?? 0)
          + (input.transportEstimate ?? 0)
          + (input.otherEstimate ?? 0);
        await db.upsertTourPriceComparison({
          ...input,
          totalSelfBook: total > 0 ? total : null,
          updatedBy: ctx.user.id,
        });
        return { success: true };
      }),

    getPriceComparisons: adminProcedure
      .query(async () => {
        return db.getAllPriceComparisons();
      }),

    deletePriceComparison: adminProcedure
      .input(z.object({ tourId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteTourPriceComparison(input.tourId);
        return { success: true };
      }),

    getPriceComparison: publicProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        return db.getTourPriceComparison(input.tourId);
      }),
  });
