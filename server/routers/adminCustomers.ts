/**
 * adminCustomers router — Customer CRM endpoints for admin panel.
 *
 * Provides:
 *   - customerList: all registered users with cached counts + aggregated spend
 *   - customerDetail: single user + recent bookings / inquiries / packpoint
 *
 * Composed into `admin:` via spread in routers.ts.
 * 2026-05-27
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { eq, desc, sql, and } from "drizzle-orm";

export const adminCustomersRouter = router({
  /**
   * List all registered customers with aggregated stats.
   * Uses cached columns (bookingCount, inquiryCount, packpointBalance)
   * plus a subquery for totalSpend.
   */
  customerList: adminProcedure.query(async () => {
    const drizzleDb = (await db.getDb())!;
    const {
      users: usersTable,
      bookings: bookingsTable,
    } = await import("../../drizzle/schema");

    // Subquery: total spend per user (sum of non-cancelled bookings)
    const spendSub = drizzleDb
      .select({
        userId: bookingsTable.userId,
        totalSpend: sql<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)`.as("totalSpend"),
      })
      .from(bookingsTable)
      .where(
        and(
          sql`${bookingsTable.userId} IS NOT NULL`,
          sql`${bookingsTable.bookingStatus} NOT IN ('cancelled')`,
        )
      )
      .groupBy(bookingsTable.userId)
      .as("spendSub");

    const rows = await drizzleDb
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        phone: usersTable.phone,
        avatar: usersTable.avatar,
        tier: usersTable.tier,
        role: usersTable.role,
        packpointBalance: usersTable.packpointBalance,
        bookingCount: usersTable.bookingCount,
        inquiryCount: usersTable.inquiryCount,
        totalSpend: sql<number>`COALESCE(${spendSub.totalSpend}, 0)`,
        createdAt: usersTable.createdAt,
        lastSignedIn: usersTable.lastSignedIn,
      })
      .from(usersTable)
      .leftJoin(spendSub, eq(usersTable.id, spendSub.userId))
      .where(eq(usersTable.role, "user"))
      .orderBy(desc(usersTable.lastSignedIn));

    return rows;
  }),

  /**
   * Full customer detail with recent activity.
   */
  customerDetail: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const {
        users: usersTable,
        bookings: bookingsTable,
        inquiries: inquiriesTable,
        pointsTransactions,
        tours: toursTable,
      } = await import("../../drizzle/schema");

      // User profile
      const [user] = await drizzleDb
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          phone: usersTable.phone,
          avatar: usersTable.avatar,
          tier: usersTable.tier,
          packpointBalance: usersTable.packpointBalance,
          packpointLifetimeEarned: usersTable.packpointLifetimeEarned,
          bookingCount: usersTable.bookingCount,
          inquiryCount: usersTable.inquiryCount,
          referralCode: usersTable.referralCode,
          birthDate: usersTable.birthDate,
          createdAt: usersTable.createdAt,
          lastSignedIn: usersTable.lastSignedIn,
        })
        .from(usersTable)
        .where(eq(usersTable.id, input.userId))
        .limit(1);

      if (!user) return null;

      // Recent bookings (last 20)
      const recentBookings = await drizzleDb
        .select({
          id: bookingsTable.id,
          tourTitle: toursTable.title,
          bookingStatus: bookingsTable.bookingStatus,
          paymentStatus: bookingsTable.paymentStatus,
          totalPrice: bookingsTable.totalPrice,
          currency: bookingsTable.currency,
          numberOfAdults: bookingsTable.numberOfAdults,
          departureId: bookingsTable.departureId,
          createdAt: bookingsTable.createdAt,
        })
        .from(bookingsTable)
        .leftJoin(toursTable, eq(bookingsTable.tourId, toursTable.id))
        .where(eq(bookingsTable.userId, input.userId))
        .orderBy(desc(bookingsTable.createdAt))
        .limit(20);

      // Recent inquiries (last 20)
      const recentInquiries = await drizzleDb
        .select({
          id: inquiriesTable.id,
          status: inquiriesTable.status,
          destination: inquiriesTable.destination,
          subject: inquiriesTable.subject,
          message: inquiriesTable.message,
          createdAt: inquiriesTable.createdAt,
        })
        .from(inquiriesTable)
        .where(eq(inquiriesTable.userId, input.userId))
        .orderBy(desc(inquiriesTable.createdAt))
        .limit(20);

      // Recent packpoint transactions (last 20)
      const recentPoints = await drizzleDb
        .select({
          id: pointsTransactions.id,
          reason: pointsTransactions.reason,
          delta: pointsTransactions.delta,
          description: pointsTransactions.description,
          createdAt: pointsTransactions.createdAt,
        })
        .from(pointsTransactions)
        .where(eq(pointsTransactions.userId, input.userId))
        .orderBy(desc(pointsTransactions.createdAt))
        .limit(20);

      return { user, recentBookings, recentInquiries, recentPoints };
    }),
});
