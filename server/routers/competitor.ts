/**
 * Competitor monitoring router — admin-only price-watch on rival tours.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L3568-3710.
 *
 * Procedures (11):
 *   - list                 – competitor tour list with filters
 *   - getById              – single competitor tour + recent departures
 *   - create               – register a new competitor tour to monitor
 *   - update               – edit metadata / scrape frequency
 *   - delete               – remove from monitoring
 *   - triggerScrape        – queue manual scrape job
 *   - priceHistory         – price-history time-series query
 *   - alerts               – paginated alert list with filters
 *   - unreadAlertCount     – unread badge counter
 *   - markAlertRead        – mark one alert read
 *   - markAllAlertsRead    – mark all alerts read
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const competitorRouter = router({
    // Get all competitor tours with filters
    list: adminProcedure
      .input(z.object({
        competitor: z.string().optional(),
        scrapeStatus: z.string().optional(),
        search: z.string().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.getCompetitorTours(input ?? {});
      }),

    // Get a single competitor tour by ID with departures
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const tour = await db.getCompetitorTourById(input.id);
        if (!tour) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor tour not found" });
        const departures = await db.getLatestDepartures(input.id);
        return { tour, departures };
      }),

    // Add a new competitor tour to monitor
    create: adminProcedure
      .input(z.object({
        competitor: z.enum(["liontravel", "colatour", "settour"]),
        tourUrl: z.string().url(),
        normGroupId: z.string().optional(),
        tourTitle: z.string().optional(),
        destination: z.string().optional(),
        duration: z.number().optional(),
        basePrice: z.number().optional(),
        scrapeFrequency: z.enum(["6h", "12h", "daily", "weekly"]).optional(),
        matchedTourId: z.number().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const tour = await db.createCompetitorTour({
          ...input,
          normGroupId: input.normGroupId ?? null,
          tourTitle: input.tourTitle ?? null,
          destination: input.destination ?? null,
          duration: input.duration ?? null,
          basePrice: input.basePrice ?? null,
          scrapeFrequency: input.scrapeFrequency ?? "daily",
          matchedTourId: input.matchedTourId ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        });
        return tour;
      }),

    // Update a competitor tour
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        tourTitle: z.string().optional(),
        destination: z.string().optional(),
        duration: z.number().optional(),
        basePrice: z.number().optional(),
        scrapeFrequency: z.enum(["6h", "12h", "daily", "weekly"]).optional(),
        scrapeStatus: z.enum(["active", "paused", "error"]).optional(),
        matchedTourId: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return db.updateCompetitorTour(id, data);
      }),

    // Delete a competitor tour
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteCompetitorTour(input.id);
        return { success: true };
      }),

    // Trigger manual scrape for a competitor tour
    triggerScrape: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const tour = await db.getCompetitorTourById(input.id);
        if (!tour) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor tour not found" });

        const { addCompetitorMonitorJob } = await import("../queue");
        await addCompetitorMonitorJob({
          competitorTourId: tour.id,
          tourUrl: tour.tourUrl,
          competitor: tour.competitor,
          triggeredBy: "manual",
        });
        return { success: true, message: "Scrape job queued" };
      }),

    // Get price history for a competitor tour
    priceHistory: adminProcedure
      .input(z.object({
        competitorTourId: z.number(),
        departureDate: z.string().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return db.getPriceHistory(input.competitorTourId, input.departureDate, input.limit);
      }),

    // Get alerts with filters
    alerts: adminProcedure
      .input(z.object({
        competitorTourId: z.number().optional(),
        alertType: z.string().optional(),
        severity: z.string().optional(),
        isRead: z.boolean().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.getCompetitorAlerts(input ?? {});
      }),

    // Get unread alert count (for badge)
    unreadAlertCount: adminProcedure
      .query(async () => {
        return db.getUnreadAlertCount();
      }),

    // Mark alert as read
    markAlertRead: adminProcedure
      .input(z.object({ alertId: z.number() }))
      .mutation(async ({ input }) => {
        await db.markAlertAsRead(input.alertId);
        return { success: true };
      }),

    // Mark all alerts as read
    markAllAlertsRead: adminProcedure
      .mutation(async () => {
        await db.markAllAlertsAsRead();
        return { success: true };
      }),
  });
