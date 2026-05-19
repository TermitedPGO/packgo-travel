/**
 * Photos router — Round 80.22 Phase F: trip photos + +10 Packpoint per photo.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (3):
 *   - upload    – upload photo URL, +10 Packpoint (cap 10/booking)
 *   - myPhotos  – list current user's photos
 *   - delete    – delete photo (points NOT clawed back)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const photosRouter = router({
    /** Upload a photo URL (from S3 / pre-signed upload). */
    upload: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive(),
          photoUrl: z.string().url().max(1024),
          caption: z.string().max(500).optional(),
          isPublic: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        if ((booking as any).userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        if (booking.bookingStatus !== "completed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "只能上傳已完成行程的照片",
          });
        }

        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tripPhotos } = await import("../../drizzle/schema");
        const { eq, sql } = await import("drizzle-orm");

        // Count existing photos for THIS booking — cap at 10 with bonus pt
        // (per policy §4 — photo bonus is +10 each, max 100 pts per booking).
        const [countRow] = await drizzleDb
          .select({ c: sql<number>`COUNT(*)` })
          .from(tripPhotos)
          .where(eq(tripPhotos.bookingId, input.bookingId));
        const existingCount = Number(countRow?.c || 0);
        const eligibleForBonus = existingCount < 10;

        // Insert the photo
        const result = await drizzleDb.insert(tripPhotos).values({
          userId: ctx.user.id,
          bookingId: input.bookingId,
          photoUrl: input.photoUrl,
          caption: input.caption || null,
          isPublic: input.isPublic,
          pointsAwarded: false, // updated below if eligible
        });
        const photoId = (result as any)[0]?.insertId ?? 0;

        // Award +10 if eligible
        let pointsEarned = 0;
        if (eligibleForBonus) {
          try {
            const { awardPackpoint } = await import("../_core/packpoint");
            await awardPackpoint({
              userId: ctx.user.id,
              delta: 10,
              reason: "photo_bonus",
              referenceType: "photo",
              referenceId: photoId,
              description: `上傳行程照片 (booking #${input.bookingId})`,
            });
            await drizzleDb
              .update(tripPhotos)
              .set({ pointsAwarded: true })
              .where(eq(tripPhotos.id, photoId));
            pointsEarned = 10;
          } catch (err) {
            console.error("[Photos] Bonus award failed:", err);
          }
        }

        return { photoId, pointsEarned, capReached: !eligibleForBonus };
      }),

    /** List user's own photos (optionally for one booking). */
    myPhotos: protectedProcedure
      .input(z.object({ bookingId: z.number().int().positive().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const { tripPhotos } = await import("../../drizzle/schema");
        const { eq, and, desc } = await import("drizzle-orm");
        const conditions = input?.bookingId
          ? and(eq(tripPhotos.userId, ctx.user.id), eq(tripPhotos.bookingId, input.bookingId))
          : eq(tripPhotos.userId, ctx.user.id);
        return await drizzleDb
          .select()
          .from(tripPhotos)
          .where(conditions)
          .orderBy(desc(tripPhotos.id));
      }),

    /** Delete a photo (soft delete via removal — points are NOT clawed back). */
    delete: protectedProcedure
      .input(z.object({ photoId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tripPhotos } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        await drizzleDb
          .delete(tripPhotos)
          .where(and(eq(tripPhotos.id, input.photoId), eq(tripPhotos.userId, ctx.user.id)));
        return { ok: true };
      }),
  });
