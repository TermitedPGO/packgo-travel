/**
 * Affiliate (Trip.com) router — public link generation + click tracking +
 * admin stats + price-comparison data.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L4113-4248.
 *
 * Procedures (8):
 *   - generateAffiliateLink   – public: build Trip.com flights/hotels/home link
 *   - trackClick              – public: log click into affiliate_clicks
 *   - getStats                – admin: aggregate stats over N days
 *   - getClicks               – admin: paginated raw click feed
 *   - upsertPriceComparison   – admin: tour price comparison row write
 *   - getPriceComparisons     – admin: list all price comparisons
 *   - deletePriceComparison   – admin: remove a price comparison row
 *   - getPriceComparison      – public: per-tour comparison fetch
 */

import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  generateFlightLink,
  generateHotelLink,
  generateHomepageLink,
  trackAffiliateClick,
} from "../services/affiliateLinkService";

export const affiliateRouter = router({
    generateAffiliateLink: publicProcedure
      .input(z.object({
        type: z.enum(["flights", "hotels", "homepage"]),
        // Flight params
        origin: z.string().optional(),
        destination: z.string().optional(),
        departDate: z.string().optional(),
        returnDate: z.string().optional(),
        adults: z.number().min(1).max(9).optional(),
        children: z.number().min(0).max(9).optional(),
        infants: z.number().min(0).max(9).optional(),
        cabinClass: z.enum(['economy', 'premiumEconomy', 'business', 'first']).optional(),
        // Hotel params
        city: z.string().optional(),
        checkIn: z.string().optional(),
        checkOut: z.string().optional(),
        rooms: z.number().min(1).max(8).optional(),
        hotelAdults: z.number().min(1).max(6).optional(),
        hotelChildren: z.number().min(0).max(4).optional(),
        // Common
        ouid: z.string().optional(),
      }))
      .query(({ input }) => {
        let url: string;
        if (input.type === "flights") {
          url = generateFlightLink({
            origin: input.origin,
            destination: input.destination,
            departDate: input.departDate,
            returnDate: input.returnDate,
            ouid: input.ouid,
            adults: input.adults,
            children: input.children,
            infants: input.infants,
            cabinClass: input.cabinClass,
          });
        } else if (input.type === "hotels") {
          url = generateHotelLink({
            city: input.city,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            ouid: input.ouid,
            rooms: input.rooms,
            adults: input.hotelAdults,
            children: input.hotelChildren,
          });
        } else {
          url = generateHomepageLink(input.ouid);
        }
        return { url };
      }),

    trackClick: publicProcedure
      .input(z.object({
        platform: z.enum(["trip_flights", "trip_hotels", "trip_homepage"]),
        targetUrl: z.string(),
        referrerPage: z.string().optional(),
        tourId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const req = (ctx as any).req;
        const ipAddress = req?.ip ?? req?.headers?.["x-forwarded-for"] ?? null;
        const userAgent = req?.headers?.["user-agent"] ?? null;
        await trackAffiliateClick({
          userId: ctx.user?.id,
          platform: input.platform,
          targetUrl: input.targetUrl,
          referrerPage: input.referrerPage,
          tourId: input.tourId,
          ipAddress: typeof ipAddress === "string" ? ipAddress : undefined,
          userAgent: typeof userAgent === "string" ? userAgent : undefined,
        });
        return { success: true };
      }),

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
