/**
 * Departures router — public departure lookup + admin CRUD on a tour's
 * scheduled departure dates / per-passenger pricing / seat capacity.
 *
 * Extracted from server/routers.ts (Phase 4C · sub-PR 3 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 * Source range (verbatim from origin): L3665-3847.
 *
 * Procedures (8):
 *   getNext       – public: next upcoming departure for a single tour
 *   getUpcoming   – public: top-N upcoming for tour list cards (lean fields)
 *   getNextBatch  – public: batch lookup for multiple tours
 *   list          – public: all departures for a tour
 *   listByTour    – public: alias for list (backward compat)
 *   getById       – public: single departure
 *   create        – admin: create new departure with audit
 *   update        – admin: partial update with field-level diff audit
 *   delete        – admin: v75 — rejects delete if active bookings exist
 *                  (prevents orphan bookings), audits before-snapshot
 *
 * Security notes (preserved from origin):
 *   - admin mutations always audit
 *   - delete is "safe-delete": blocks when activeBookings.length > 0
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

// v74 bounded string helpers — kept in sync with originals in routers.ts.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const noControlChars = (s: string) => !CONTROL_CHARS.test(s);
const shortStr = z.string().max(255).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });
const mediumStr = z.string().max(5_000).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });

export const departuresRouter = router({
    // Get next upcoming departure for a single tour
    getNext: publicProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        const allDepartures = await db.getTourDepartures(input.tourId);
        const now = new Date();
        const upcoming = (allDepartures as any[])
          .filter((d: any) => d.status !== 'cancelled' && new Date(d.departureDate) > now)
          .sort((a: any, b: any) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
        return upcoming[0] || null;
      }),
    // v78s: Top-N upcoming departures for tour list cards (Lion Travel chip pattern)
    // Returns lean fields only — id, date, status, adultPrice — to keep payload small
    getUpcoming: publicProcedure
      .input(z.object({ tourId: z.number(), limit: z.number().min(1).max(10).default(3) }))
      .query(async ({ input }) => {
        const allDepartures = await db.getTourDepartures(input.tourId);
        const now = new Date();
        const upcoming = (allDepartures as any[])
          .filter((d: any) => d.status !== 'cancelled' && new Date(d.departureDate) > now)
          .sort((a: any, b: any) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime())
          .slice(0, input.limit)
          .map((d: any) => ({
            id: d.id,
            departureDate: d.departureDate,
            status: d.status, // 'open' | 'confirmed' | 'full' | 'waitlist'
            adultPrice: d.adultPrice ?? null,
            currency: d.currency ?? null,
            // Round 79: schema uses totalSlots/bookedSlots, not maxParticipants/currentParticipants.
            // Old code mapped non-existent fields → frontends saw undefined and seat-count UI never rendered.
            bookedSlots: d.bookedSlots ?? 0,
            totalSlots: d.totalSlots ?? null,
          }));
        return upcoming;
      }),
    // Get next upcoming departure for multiple tours (batch)
    getNextBatch: publicProcedure
      .input(z.object({ tourIds: z.array(z.number()) }))
      .query(async ({ input }) => {
        const result: Record<number, any> = {};
        const now = new Date();
        await Promise.all(input.tourIds.map(async (tourId) => {
          const allDepartures = await db.getTourDepartures(tourId);
          const upcoming = (allDepartures as any[])
            .filter((d: any) => d.status !== 'cancelled' && new Date(d.departureDate) > now)
            .sort((a: any, b: any) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
          result[tourId] = upcoming[0] || null;
        }));
        return result;
      }),
    // Get all departures for a tour
    list: publicProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        return await db.getTourDepartures(input.tourId);
      }),

    // Alias for list (for backward compatibility)
    listByTour: publicProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        return await db.getTourDepartures(input.tourId);
      }),

    // Get single departure
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getDepartureById(input.id);
      }),

    // Create new departure (admin only)
    create: adminProcedure
      .input(
        z.object({
          tourId: z.number(),
          departureDate: z.date(),
          returnDate: z.date(),
          totalSlots: z.number().min(1, "座位數至少為 1"),
          adultPrice: z.number().min(1, "成人價格至少為 1"),
          childPriceWithBed: z.number().optional(),
          childPriceNoBed: z.number().optional(),
          infantPrice: z.number().optional(),
          singleRoomSupplement: z.number().optional(),
          status: z.enum(["open", "full", "cancelled"]).optional(),
          currency: z.string().optional(),
          notes: z.string().optional(),
        }).refine(
          (data) => data.returnDate >= data.departureDate,
          { message: "回程日期必須在出發日期之後", path: ["returnDate"] }
        )
      )
      .mutation(async ({ ctx, input }) => {
        const created = await db.createDeparture(input);
        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "departure.create",
          targetType: "departure",
          targetId: created.id,
          changes: {
            tourId: input.tourId,
            departureDate: input.departureDate,
            adultPrice: input.adultPrice,
            totalSlots: input.totalSlots,
          },
        });
        return created;
      }),

    // Update departure (admin only)
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().max(2_147_483_647),
          departureDate: z.date().optional(),
          returnDate: z.date().optional(),
          totalSlots: z.number().int().min(0).max(10_000).optional(),
          adultPrice: z.number().int().min(0).max(100_000_000).optional(),
          childPriceWithBed: z.number().int().min(0).max(100_000_000).optional(),
          childPriceNoBed: z.number().int().min(0).max(100_000_000).optional(),
          infantPrice: z.number().int().min(0).max(100_000_000).optional(),
          singleRoomSupplement: z.number().int().min(0).max(100_000_000).optional(),
          status: z.enum(["open", "full", "cancelled", "confirmed"]).optional(),
          currency: shortStr.optional(),
          notes: mediumStr.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        const before = await db.getDepartureById(id).catch(() => null);
        const result = await db.updateDeparture(id, updates);
        const { audit, diffFields } = await import("../_core/auditLog");
        const diff = diffFields(before as any, updates as any);
        audit({
          ctx,
          action: "departure.update",
          targetType: "departure",
          targetId: id,
          changes: { fields: diff.fields, before: diff.before, after: diff.after },
        });
        return result;
      }),

    // Delete departure (admin only)
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        // v75: snapshot + reject delete if any active bookings reference it.
        // Otherwise we'd orphan customer bookings to a non-existent departure.
        const before = await db.getDepartureById(input.id).catch(() => null);
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Departure not found" });
        }
        const activeBookings = await db.getActiveBookingsByDepartureId(input.id).catch(() => [] as any[]);
        if (activeBookings.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `此出發日有 ${activeBookings.length} 筆有效訂單，無法刪除。請先取消相關訂單。`,
          });
        }
        await db.deleteDeparture(input.id);

        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "departure.delete",
          targetType: "departure",
          targetId: input.id,
          changes: {
            before: {
              tourId: before.tourId,
              departureDate: before.departureDate,
              adultPrice: before.adultPrice,
              totalSlots: before.totalSlots,
              bookedSlots: before.bookedSlots,
            },
          },
        });
        return { success: true };
      }),
  });
