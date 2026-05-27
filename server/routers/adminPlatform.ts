/**
 * Admin platform router — read-only platform overview procedures.
 *
 * Extracted from server/routers.ts (Phase 4B · sub-PR 2 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 * Source range (verbatim from origin): L4148-4361 inside `admin:` block.
 *
 * Procedures:
 *   - lookupUserByEmail  – Packpoint admin user lookup helper
 *   - getStats           – platform overview stats (users, bookings, revenue)
 *                          with 60s Redis cache
 *   - getRiskMetrics     – booking risk dashboard (capacity, unpaid, stale)
 *   - getAnalytics       – time-series analytics for chart rendering
 *
 * Composed back into `admin:` via spread in server/routers.ts so existing
 * client trpc.admin.* paths resolve unchanged.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { redis } from "../redis";

export const adminPlatformRouter = router({
  /**
   * Round 80.22 Phase C: lookup user by exact email for the Packpoint
   * admin tab. Returns minimal info needed for the adjust form (id, email,
   * name, tier, balance, lifetime). Returns null if not found rather than
   * 404 so the UI can show a friendly toast.
   */
  lookupUserByEmail: adminProcedure
    .input(z.object({ email: z.string().email().max(320) }))
    .query(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return null;
      const { users: usersTable } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [user] = await drizzleDb
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          tier: usersTable.tier,
          balance: usersTable.packpointBalance,
          lifetime: usersTable.packpointLifetimeEarned,
        })
        .from(usersTable)
        .where(eq(usersTable.email, input.email))
        .limit(1);
      return user ?? null;
    }),

  // Get dashboard statistics (real data).
  // QA audit 2026-05-11 Phase 2 P0 fix: this procedure was running 11
  // sequential SELECTs (~150-300ms each) every time someone opened the
  // admin home, with zero caching. Now wrapped in a 60s Redis cache so
  // multiple admin tabs in the same minute share one DB pass.
  //
  // 60s TTL chosen because: (a) the UI shows daily/monthly aggregates
  // where 1-min staleness is invisible, (b) Stripe webhook /
  // booking.create cache-bust would be a bigger refactor — Jeff can
  // hard-refresh if he wants a real-time read after a payment lands.
  getStats: adminProcedure.query(async () => {
    const CACHE_KEY = "admin:stats:v1";
    const CACHE_TTL = 60; // seconds
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      console.warn("[admin.getStats] cache read failed:", err);
    }

    const { tours: toursTable, bookings: bookingsTable, inquiries: inquiriesTable, users: usersTable, newsletterSubscribers: newsletterTable, tourReviews: tourReviewsTable, marketingMaterials: marketingMaterialsTable, affiliateClicks: affiliateClicksTable } = await import('../../drizzle/schema');
    const { sql: sqlFn, eq: eqFn, gte: gteFn, count: countFn } = await import('drizzle-orm');
    const drizzleDb = await db.getDb();
    if (!drizzleDb) {
      return { totalTours: 0, totalBookings: 0, totalRevenue: 0, totalInquiries: 0, activeTours: 0, pendingInquiries: 0, thisMonthRevenue: 0, revenueGrowth: 0, todayBookings: 0, totalUsers: 0, totalSubscribers: 0 };
    }
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    // Run the 11 stat queries in parallel — previously they were sequential
    // (cumulative ~1.5-3s on a cold cache). Parallel + Promise.all drops
    // cold-path latency to ~max(individual query time) ≈ 300ms.
    const [
      totalToursRow,
      activeToursRow,
      totalBookingsRow,
      todayBookingsRow,
      totalRevenueRow,
      thisMonthRevenueRow,
      lastMonthRevenueRow,
      totalInquiriesRow,
      pendingInquiriesRow,
      totalUsersRow,
      totalSubscribersRow,
      // Landing KPI extras (review, poster, affiliate counts)
      totalReviewsRow,
      pendingReviewsRow,
      totalPostersRow,
      totalAffClicksRow,
    ] = await Promise.all([
      drizzleDb.select({ count: countFn() }).from(toursTable).then((r) => r[0]),
      drizzleDb.select({ count: countFn() }).from(toursTable).where(eqFn(toursTable.status, 'active')).then((r) => r[0]),
      drizzleDb.select({ count: countFn() }).from(bookingsTable).then((r) => r[0]),
      drizzleDb.select({ count: countFn() }).from(bookingsTable).where(gteFn(bookingsTable.createdAt, startOfToday)).then((r) => r[0]),
      drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed')`).then((r) => r[0]),
      drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed') AND ${bookingsTable.createdAt} >= ${startOfThisMonth}`).then((r) => r[0]),
      drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed') AND ${bookingsTable.createdAt} >= ${startOfLastMonth} AND ${bookingsTable.createdAt} <= ${endOfLastMonth}`).then((r) => r[0]),
      drizzleDb.select({ count: countFn() }).from(inquiriesTable).then((r) => r[0]),
      drizzleDb.select({ count: countFn() }).from(inquiriesTable).where(sqlFn`${inquiriesTable.status} IN ('new', 'in_progress')`).then((r) => r[0]),
      drizzleDb.select({ count: countFn() }).from(usersTable).then((r) => r[0]),
      drizzleDb.select({ count: countFn() }).from(newsletterTable).where(eqFn(newsletterTable.status, 'active')).then((r) => r[0]),
      // Reviews: total approved
      drizzleDb.select({ count: countFn() }).from(tourReviewsTable).where(eqFn(tourReviewsTable.status, 'approved')).then((r) => r[0]),
      // Reviews: pending moderation
      drizzleDb.select({ count: countFn() }).from(tourReviewsTable).where(eqFn(tourReviewsTable.status, 'pending')).then((r) => r[0]),
      // Posters this month
      drizzleDb.select({ count: countFn() }).from(marketingMaterialsTable).where(sqlFn`${marketingMaterialsTable.type} LIKE 'poster%' AND ${marketingMaterialsTable.createdAt} >= ${startOfThisMonth}`).then((r) => r[0]),
      // Affiliate clicks total
      drizzleDb.select({ count: countFn() }).from(affiliateClicksTable).then((r) => r[0]),
    ]);
    const thisMonthRevenue = Number(thisMonthRevenueRow?.total ?? 0);
    const lastMonthRevenue = Number(lastMonthRevenueRow?.total ?? 0);
    const revenueGrowth = lastMonthRevenue > 0 ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : (thisMonthRevenue > 0 ? 100 : 0);
    const result = {
      totalTours: Number(totalToursRow?.count ?? 0),
      activeTours: Number(activeToursRow?.count ?? 0),
      totalBookings: Number(totalBookingsRow?.count ?? 0),
      todayBookings: Number(todayBookingsRow?.count ?? 0),
      totalRevenue: Number(totalRevenueRow?.total ?? 0),
      thisMonthRevenue,
      revenueGrowth: Math.round(revenueGrowth * 10) / 10,
      totalInquiries: Number(totalInquiriesRow?.count ?? 0),
      pendingInquiries: Number(pendingInquiriesRow?.count ?? 0),
      totalUsers: Number(totalUsersRow?.count ?? 0),
      totalSubscribers: Number(totalSubscribersRow?.count ?? 0),
      // Landing KPI extras
      totalReviews: Number(totalReviewsRow?.count ?? 0),
      pendingReviews: Number(pendingReviewsRow?.count ?? 0),
      postersThisMonth: Number(totalPostersRow?.count ?? 0),
      totalAffiliateClicks: Number(totalAffClicksRow?.count ?? 0),
    };
    try {
      await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      console.warn("[admin.getStats] cache write failed:", err);
    }
    return result;
  }),

  // v78z-z3 Sprint 10 (C4): booking risk metrics — 3 actionable warning
  // signals for solo founder. Each metric also returns sample IDs so the
  // dashboard card can deep-link admin into the relevant detail view.
  getRiskMetrics: adminProcedure.query(async () => {
    const { tours: _toursTable, bookings: bookingsTable, tourDepartures: departuresTable } = await import('../../drizzle/schema');
    const { sql: sqlFn } = await import('drizzle-orm');
    const drizzleDb = await db.getDb();
    if (!drizzleDb) {
      return { lowCapacity: { count: 0, departureIds: [] }, unpaidBalance: { count: 0, bookingIds: [] }, staleTours: { count: 0, tourIds: [] } };
    }
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sinceFourteenDays = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const sinceThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. Low capacity: open departures within 30 days with < 50% booked.
    const lowCapacityRows = await drizzleDb.select({
      id: departuresTable.id,
    }).from(departuresTable).where(
      sqlFn`${departuresTable.status} = 'open'
        AND ${departuresTable.departureDate} >= ${now}
        AND ${departuresTable.departureDate} <= ${in30Days}
        AND ${departuresTable.totalSlots} > 0
        AND (${departuresTable.bookedSlots} * 1.0 / ${departuresTable.totalSlots}) < 0.5`
    ).limit(20);

    // 2. Unpaid balance: bookings with deposit_paid for >14 days (stuck).
    const unpaidRows = await drizzleDb.select({
      id: bookingsTable.id,
    }).from(bookingsTable).where(
      sqlFn`${bookingsTable.paymentStatus} = 'deposit_paid'
        AND ${bookingsTable.bookingStatus} IN ('confirmed','pending')
        AND ${bookingsTable.createdAt} <= ${sinceFourteenDays}`
    ).limit(20);

    // 3. Stale tours: active tours with NO bookings in last 30 days.
    const staleRows = await drizzleDb.execute(
      sqlFn`SELECT t.id FROM tours t
        WHERE t.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.tourId = t.id AND b.createdAt >= ${sinceThirtyDays}
          )
        LIMIT 20`
    ) as any;
    const staleRowsArr: any[] = Array.isArray(staleRows[0]) ? staleRows[0] : staleRows;

    return {
      lowCapacity: {
        count: lowCapacityRows.length,
        departureIds: lowCapacityRows.map((r: any) => Number(r.id)),
      },
      unpaidBalance: {
        count: unpaidRows.length,
        bookingIds: unpaidRows.map((r: any) => Number(r.id)),
      },
      staleTours: {
        count: staleRowsArr.length,
        tourIds: staleRowsArr.map((r: any) => Number(r.id)),
      },
    };
  }),

  // Get detailed analytics data for charts
  getAnalytics: adminProcedure
    .input(z.object({ days: z.number().min(7).max(180).default(30) }))
    .query(async ({ input }) => {
      const { sql: sqlFn2, inArray: inArrayFn } = await import('drizzle-orm');
      const { tours: toursTable } = await import('../../drizzle/schema');
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return { bookingTrend: [], tourCategoryDist: [], inquiryStatusDist: [], topTours: [] };
      const since = new Date();
      since.setDate(since.getDate() - input.days);
      since.setHours(0, 0, 0, 0);
      // Use ISO string to avoid TiDB drizzle Date serialization bug (drizzle converts Date to invalid format)
      const sinceStr = since.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      // Use drizzle execute() with raw sql() to bypass parameter type coercion
      const bookingTrendRaw = await drizzleDb.execute(
        sqlFn2`SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date, COUNT(*) as bookings, COALESCE(SUM(CASE WHEN bookingStatus IN ('confirmed', 'completed') THEN totalPrice ELSE 0 END), 0) as revenue FROM bookings WHERE createdAt >= ${sinceStr} GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d') ORDER BY DATE_FORMAT(createdAt, '%Y-%m-%d')`
      ) as any;
      const tourCategoryRaw = await drizzleDb.execute(
        sqlFn2`SELECT category, COUNT(*) as count FROM tours GROUP BY category`
      ) as any;
      const inquiryStatusRaw = await drizzleDb.execute(
        sqlFn2`SELECT status, COUNT(*) as count FROM inquiries GROUP BY status`
      ) as any;
      const topToursRaw = await drizzleDb.execute(
        sqlFn2`SELECT tourId, COUNT(*) as bookingCount, COALESCE(SUM(totalPrice), 0) as revenue FROM bookings GROUP BY tourId ORDER BY COUNT(*) DESC LIMIT 10`
      ) as any;
      // drizzle execute() returns [rows, fields] for mysql2
      const bookingTrendRows: any[] = Array.isArray(bookingTrendRaw[0]) ? bookingTrendRaw[0] : bookingTrendRaw;
      const tourCategoryRows: any[] = Array.isArray(tourCategoryRaw[0]) ? tourCategoryRaw[0] : tourCategoryRaw;
      const inquiryStatusRows: any[] = Array.isArray(inquiryStatusRaw[0]) ? inquiryStatusRaw[0] : inquiryStatusRaw;
      const topToursRows: any[] = Array.isArray(topToursRaw[0]) ? topToursRaw[0] : topToursRaw;
      let topTourTitles: Record<number, string> = {};
      if (topToursRows.length > 0) {
        const topTourIds = topToursRows.map((t: any) => Number(t.tourId));
        const tourRows = await drizzleDb.select({ id: toursTable.id, title: toursTable.title }).from(toursTable).where(inArrayFn(toursTable.id, topTourIds));
        topTourTitles = Object.fromEntries(tourRows.map((t: any) => [t.id, t.title]));
      }
      const categoryLabels: Record<string, string> = { group: '團體旅遊', custom: '客製旅遊', package: '包團旅遊', cruise: '郵輪旅遊', theme: '主題旅遊' };
      const statusLabels: Record<string, string> = { new: '新諮詢', in_progress: '處理中', replied: '已回覆', resolved: '已解決', closed: '已關閉' };
      return {
        bookingTrend: bookingTrendRows.map((r: any) => ({ date: String(r.date ?? '').slice(5), bookings: Number(r.bookings), revenue: Number(r.revenue) })),
        tourCategoryDist: tourCategoryRows.map((r: any) => ({ name: categoryLabels[r.category] ?? r.category, value: Number(r.count) })),
        inquiryStatusDist: inquiryStatusRows.map((r: any) => ({ name: statusLabels[r.status] ?? r.status, value: Number(r.count) })),
        topTours: topToursRows.map((r: any) => ({ tourId: Number(r.tourId), title: topTourTitles[Number(r.tourId)] ?? `行程 #${r.tourId}`, bookingCount: Number(r.bookingCount), revenue: Number(r.revenue) })),
      };
    }),
});
