/**
 * Reviews router — public/customer review submission + admin moderation
 * (Round 80.7 + 80.25).
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (8):
 *   - listVerified    – public: approved reviews (FTC 16 CFR §465 verified)
 *   - myReviews       – authenticated: caller's own reviews
 *   - create          – authenticated: submit review for a completed booking
 *   - createPublic    – authenticated: open commenting (Round 80.25)
 *   - adminList       – admin: paginated review moderation queue
 *   - adminApprove    – admin: approve + idempotent +50 Packpoint award
 *   - adminReject     – admin: reject with reason
 *   - adminHide       – admin: hide approved review post-publish
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const reviewsRouter = router({
    /**
     * Public list of approved reviews for a given tour (or all tours if
     * tourId is omitted). Used by TourDetail page + TestimonialsCarousel
     * on Home. Hidden / pending / rejected never surface here.
     */
    listVerified: publicProcedure
      .input(
        z
          .object({
            tourId: z.number().int().positive().optional(),
            limit: z.number().int().positive().max(50).default(10),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const { tourReviews, users: usersTable, tours: toursTable } = await import(
          "../../drizzle/schema"
        );
        const { eq, and, desc } = await import("drizzle-orm");

        const conditions = input?.tourId
          ? and(eq(tourReviews.status, "approved"), eq(tourReviews.tourId, input.tourId))
          : eq(tourReviews.status, "approved");

        const rows = await drizzleDb
          .select({
            id: tourReviews.id,
            tourId: tourReviews.tourId,
            tourTitle: toursTable.title,
            rating: tourReviews.rating,
            title: tourReviews.title,
            content: tourReviews.content,
            photos: tourReviews.photos,
            language: tourReviews.language,
            publishedAt: tourReviews.publishedAt,
            authorName: usersTable.name,
            authorAvatar: usersTable.avatar,
          })
          .from(tourReviews)
          .leftJoin(usersTable, eq(tourReviews.userId, usersTable.id))
          .leftJoin(toursTable, eq(tourReviews.tourId, toursTable.id))
          .where(conditions)
          .orderBy(desc(tourReviews.publishedAt))
          .limit(input?.limit ?? 10);

        return rows;
      }),

    /**
     * List the current user's own reviews — surfaces draft/pending status
     * so they know what's awaiting moderation.
     */
    myReviews: protectedProcedure.query(async ({ ctx }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return [];
      const { tourReviews, tours: toursTable } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return await drizzleDb
        .select({
          id: tourReviews.id,
          tourId: tourReviews.tourId,
          tourTitle: toursTable.title,
          bookingId: tourReviews.bookingId,
          rating: tourReviews.rating,
          title: tourReviews.title,
          content: tourReviews.content,
          status: tourReviews.status,
          rejectionReason: tourReviews.rejectionReason,
          createdAt: tourReviews.createdAt,
          publishedAt: tourReviews.publishedAt,
        })
        .from(tourReviews)
        .leftJoin(toursTable, eq(tourReviews.tourId, toursTable.id))
        .where(eq(tourReviews.userId, ctx.user.id))
        .orderBy(desc(tourReviews.createdAt));
    }),

    /**
     * Submit a review for a completed booking. Server validates:
     *   - Booking belongs to the user
     *   - Booking is 'completed' (not pending/cancelled)
     *   - No existing review for this booking (UNIQUE constraint backs this)
     * The review enters the moderation queue; +50 Packpoint is paid out
     * when the admin approves.
     */
    create: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive(),
          rating: z.number().int().min(1).max(5),
          title: z.string().trim().min(3).max(200),
          content: z.string().trim().min(10).max(5000),
          photos: z.array(z.string().url()).max(10).optional(),
          language: z.enum(["zh-TW", "en"]).default("zh-TW"),
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
            message: "您只能在行程完成後才能評論此筆訂單",
          });
        }

        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../../drizzle/schema");

        try {
          await drizzleDb.insert(tourReviews).values({
            userId: ctx.user.id,
            tourId: booking.tourId,
            bookingId: input.bookingId,
            rating: input.rating,
            title: input.title,
            content: input.content,
            photos: input.photos ? JSON.stringify(input.photos) : null,
            language: input.language,
            status: "pending",
          });
          return { ok: true, status: "pending" as const };
        } catch (err: any) {
          if (/Duplicate entry/i.test(err?.message || "")) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "您已經評論過此行程 / You already reviewed this tour",
            });
          }
          throw err;
        }
      }),

    /**
     * Round 80.25 — open commenting on tour reviews.
     * Logged-in users can submit reviews/comments without a prior booking.
     * The compound UNIQUE on (userId, tourId) prevents one user from
     * spam-flooding a single tour. All entries enter the moderation queue
     * and only surface on TourDetail after admin approval.
     */
    createPublic: protectedProcedure
      .input(
        z.object({
          tourId: z.number().int().positive(),
          rating: z.number().int().min(1).max(5),
          title: z.string().trim().min(3).max(200),
          content: z.string().trim().min(10).max(5000),
          photos: z.array(z.string().url()).max(10).optional(),
          language: z.enum(["zh-TW", "en"]).default("zh-TW"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const tour = await db.getTourById(input.tourId);
        if (!tour) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tour not found" });
        }
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../../drizzle/schema");
        try {
          await drizzleDb.insert(tourReviews).values({
            userId: ctx.user.id,
            tourId: input.tourId,
            bookingId: null,
            rating: input.rating,
            title: input.title,
            content: input.content,
            photos: input.photos ? JSON.stringify(input.photos) : null,
            language: input.language,
            status: "pending",
          });
          return { ok: true, status: "pending" as const };
        } catch (err: any) {
          if (/Duplicate entry/i.test(err?.message || "")) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "您已經評論過此行程 / You already reviewed this tour",
            });
          }
          throw err;
        }
      }),

    /**
     * Admin: paginated review queue with filter by status.
     */
    adminList: adminProcedure
      .input(
        z.object({
          status: z.enum(["pending", "approved", "rejected", "hidden", "all"]).default("all"),
          limit: z.number().int().positive().max(100).default(50),
          cursor: z.number().int().optional(),
        })
      )
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { items: [], nextCursor: null };
        const { tourReviews, users: usersTable, tours: toursTable } = await import(
          "../../drizzle/schema"
        );
        const { eq, and, lt, desc } = await import("drizzle-orm");

        const filters = [];
        if (input.status !== "all") filters.push(eq(tourReviews.status, input.status));
        if (input.cursor) filters.push(lt(tourReviews.id, input.cursor));
        const whereClause = filters.length ? and(...filters) : undefined;

        const rows = await drizzleDb
          .select({
            id: tourReviews.id,
            userId: tourReviews.userId,
            authorName: usersTable.name,
            authorEmail: usersTable.email,
            tourId: tourReviews.tourId,
            tourTitle: toursTable.title,
            bookingId: tourReviews.bookingId,
            rating: tourReviews.rating,
            title: tourReviews.title,
            content: tourReviews.content,
            photos: tourReviews.photos,
            language: tourReviews.language,
            status: tourReviews.status,
            rejectionReason: tourReviews.rejectionReason,
            createdAt: tourReviews.createdAt,
            publishedAt: tourReviews.publishedAt,
          })
          .from(tourReviews)
          .leftJoin(usersTable, eq(tourReviews.userId, usersTable.id))
          .leftJoin(toursTable, eq(tourReviews.tourId, toursTable.id))
          .where(whereClause)
          .orderBy(desc(tourReviews.id))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].id : null;
        return { items, nextCursor };
      }),

    /**
     * Admin: approve a review. Awards +50 Packpoint to the author IFF
     * this is the first time we approved it (idempotent via status check).
     */
    adminApprove: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [review] = await drizzleDb
          .select()
          .from(tourReviews)
          .where(eq(tourReviews.id, input.id))
          .limit(1);
        if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
        const wasAlreadyApproved = review.status === "approved";

        await drizzleDb
          .update(tourReviews)
          .set({
            status: "approved",
            moderatedAt: new Date(),
            moderatedBy: ctx.user.id,
            publishedAt: review.publishedAt ?? new Date(),
            rejectionReason: null,
          })
          .where(eq(tourReviews.id, input.id));

        // Idempotent +50 Packpoint: only on first approval, not re-approve
        // after un-hide.
        if (!wasAlreadyApproved) {
          try {
            const { awardPackpoint } = await import("../_core/packpoint");
            await awardPackpoint({
              userId: review.userId,
              delta: 50,
              reason: "review_bonus",
              referenceType: "review",
              referenceId: review.id,
              description: `行程評論獎勵(已通過審核)`,
            });
          } catch (err) {
            console.error(`[Reviews] Packpoint award failed for review ${review.id}:`, err);
            // Don't fail the approval — admin retry / manual adjust available
          }
        }

        return { ok: true, awarded: !wasAlreadyApproved ? 50 : 0 };
      }),

    /**
     * Admin: reject a review with a customer-visible reason.
     */
    adminReject: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          reason: z.string().trim().min(3).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await drizzleDb
          .update(tourReviews)
          .set({
            status: "rejected",
            moderatedAt: new Date(),
            moderatedBy: ctx.user.id,
            rejectionReason: input.reason,
            publishedAt: null,
          })
          .where(eq(tourReviews.id, input.id));

        return { ok: true };
      }),

    /**
     * Admin: hide an approved review (e.g. policy violation discovered later).
     * Doesn't claw back the +50 Packpoint already paid.
     */
    adminHide: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await drizzleDb
          .update(tourReviews)
          .set({
            status: "hidden",
            moderatedAt: new Date(),
            moderatedBy: ctx.user.id,
          })
          .where(eq(tourReviews.id, input.id));
        return { ok: true };
      }),
  });
