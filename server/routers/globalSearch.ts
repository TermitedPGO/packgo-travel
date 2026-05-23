/**
 * Global mobile search — Mobile Phase 3 (2026-05-22).
 *
 * Single tRPC procedure for the mobile floating search FAB. Searches:
 *   - tours (title + destination + product code)
 *   - customerProfiles (email + phone + wechat/line ID)
 *   - bookings (id exact + customer name/email/phone)
 *
 * All sub-queries run in parallel. p95 < 200ms target.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { eq, or, sql, desc, like } from "drizzle-orm";
import { tours, bookings, customerProfiles } from "../../drizzle/schema";

const QUERY_LIMIT = 8;

export const globalSearchRouter = router({
  search: adminProcedure
    .input(z.object({ q: z.string().max(120) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { tours: [], customers: [], bookings: [] };

      const q = input.q.trim();
      if (q.length === 0) return { tours: [], customers: [], bookings: [] };

      const like_ = `%${q}%`;
      const digitsOnly = q.replace(/\D/g, "");
      const phoneLike = digitsOnly.length >= 3 ? `%${digitsOnly}%` : null;
      const numericId = /^\d+$/.test(q) ? Number(q) : null;

      const [tourRows, customerRows, bookingRows] = await Promise.all([
        db
          .select({
            id: tours.id,
            title: tours.title,
            destinationCountry: tours.destinationCountry,
            destinationCity: tours.destinationCity,
            duration: tours.duration,
            price: tours.price,
            originalityScore: tours.originalityScore,
          })
          .from(tours)
          .where(
            or(
              like(tours.title, like_),
              like(tours.destinationCountry, like_),
              like(tours.destinationCity, like_),
            ),
          )
          .orderBy(desc(tours.originalityScore))
          .limit(QUERY_LIMIT),

        db
          .select({
            id: customerProfiles.id,
            email: customerProfiles.email,
            phone: customerProfiles.phone,
            wechatId: customerProfiles.wechatId,
            preferredLanguage: customerProfiles.preferredLanguage,
            lastInteractionAt: customerProfiles.lastInteractionAt,
            vipScore: customerProfiles.vipScore,
          })
          .from(customerProfiles)
          .where(
            or(
              like(customerProfiles.email, like_),
              like(customerProfiles.wechatId, like_),
              like(customerProfiles.lineId, like_),
              phoneLike
                ? sql`REPLACE(REPLACE(REPLACE(REPLACE(${customerProfiles.phone}, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ${phoneLike}`
                : sql`1=0`,
            ),
          )
          .orderBy(desc(customerProfiles.lastInteractionAt))
          .limit(QUERY_LIMIT),

        db
          .select({
            id: bookings.id,
            customerName: bookings.customerName,
            customerEmail: bookings.customerEmail,
            customerPhone: bookings.customerPhone,
            tourId: bookings.tourId,
            totalPrice: bookings.totalPrice,
            bookingStatus: bookings.bookingStatus,
            createdAt: bookings.createdAt,
          })
          .from(bookings)
          .where(
            or(
              numericId !== null ? eq(bookings.id, numericId) : sql`1=0`,
              like(bookings.customerName, like_),
              like(bookings.customerEmail, like_),
              phoneLike
                ? sql`REPLACE(REPLACE(REPLACE(REPLACE(${bookings.customerPhone}, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ${phoneLike}`
                : sql`1=0`,
            ),
          )
          .orderBy(desc(bookings.createdAt))
          .limit(QUERY_LIMIT),
      ]);

      return { tours: tourRows, customers: customerRows, bookings: bookingRows };
    }),

  recentContacts: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return db
      .select({
        id: customerProfiles.id,
        email: customerProfiles.email,
        phone: customerProfiles.phone,
        wechatId: customerProfiles.wechatId,
        preferredLanguage: customerProfiles.preferredLanguage,
        lastInteractionAt: customerProfiles.lastInteractionAt,
      })
      .from(customerProfiles)
      .where(sql`${customerProfiles.lastInteractionAt} >= ${sevenDaysAgo}`)
      .orderBy(desc(customerProfiles.lastInteractionAt))
      .limit(10);
  }),
});
