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
import { eq, desc, sql, and, or, inArray } from "drizzle-orm";

/**
 * 整合工作台 P2 — what counts as an OPEN item in a customer's inbox.
 * Bookings still active (not completed/cancelled), inquiries not yet
 * resolved/closed. Pending approval tasks linked to this customer also count.
 */
export const OPEN_BOOKING_STATUSES = ["pending", "confirmed"] as const;
export const OPEN_INQUIRY_STATUSES = ["new", "in_progress"] as const;

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

      // Total spend (批2 m1, additive) — same口徑 as customerList: sum of
      // non-cancelled bookings. The workspace customer header shows it.
      const [spendRow] = await drizzleDb
        .select({
          totalSpend: sql<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)`,
        })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.userId, input.userId),
            sql`${bookingsTable.bookingStatus} NOT IN ('cancelled')`,
          ),
        );
      const totalSpend = Number(spendRow?.totalSpend ?? 0);

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

      // Recent AI quotes (批2 m2) — matched by userId OR the user's email
      // (anonymous quotes carry only customerEmail). Read-only funnel records
      // for the per-customer timeline; tool-quote PDFs are NOT here (the
      // tools.generateQuote path stores no row — gap recorded in
      // tasks/batch-2-customers.md).
      const { aiQuotes: aiQuotesTable } = await import("../../drizzle/schema");
      const quoteConds = [eq(aiQuotesTable.userId, input.userId)];
      if (user.email) {
        quoteConds.push(eq(aiQuotesTable.customerEmail, user.email));
      }
      const recentQuotes = await drizzleDb
        .select({
          id: aiQuotesTable.id,
          quoteNumber: aiQuotesTable.quoteNumber,
          estimatedTotal: aiQuotesTable.estimatedTotal,
          currency: aiQuotesTable.currency,
          pdfUrl: aiQuotesTable.pdfUrl,
          status: aiQuotesTable.status,
          createdAt: aiQuotesTable.createdAt,
        })
        .from(aiQuotesTable)
        .where(or(...quoteConds))
        .orderBy(desc(aiQuotesTable.createdAt))
        .limit(5);

      return {
        user: { ...user, totalSpend },
        recentBookings,
        recentInquiries,
        recentPoints,
        recentQuotes,
      };
    }),

  /**
   * customerOpenItems — 整合工作台 per-customer inbox spine (P2).
   *
   * Returns this customer's OPEN items only (the worklist), unlike
   * customerDetail which returns recent-everything. Three buckets:
   *   - open bookings   (bookingStatus ∈ pending/confirmed)
   *   - open inquiries  (status ∈ new/in_progress)
   *   - pending tasks   (approvalTasks.status=pending linked to this
   *                      customer's bookings/inquiries via relatedType/Id)
   * The frontend merges these into one timeline. Never selects passport cols.
   */
  customerOpenItems: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const {
        bookings: bookingsTable,
        inquiries: inquiriesTable,
        tours: toursTable,
        approvalTasks: approvalTasksTable,
        workspaceDispositions: dispTable,
      } = await import("../../drizzle/schema");

      const openBookings = await drizzleDb
        .select({
          id: bookingsTable.id,
          tourTitle: toursTable.title,
          bookingStatus: bookingsTable.bookingStatus,
          paymentStatus: bookingsTable.paymentStatus,
          totalPrice: bookingsTable.totalPrice,
          currency: bookingsTable.currency,
          departureId: bookingsTable.departureId,
          createdAt: bookingsTable.createdAt,
        })
        .from(bookingsTable)
        .leftJoin(toursTable, eq(bookingsTable.tourId, toursTable.id))
        .where(
          and(
            eq(bookingsTable.userId, input.userId),
            inArray(bookingsTable.bookingStatus, [...OPEN_BOOKING_STATUSES]),
          ),
        )
        .orderBy(desc(bookingsTable.createdAt));

      const openInquiries = await drizzleDb
        .select({
          id: inquiriesTable.id,
          status: inquiriesTable.status,
          destination: inquiriesTable.destination,
          subject: inquiriesTable.subject,
          createdAt: inquiriesTable.createdAt,
        })
        .from(inquiriesTable)
        .where(
          and(
            eq(inquiriesTable.userId, input.userId),
            inArray(inquiriesTable.status, [...OPEN_INQUIRY_STATUSES]),
          ),
        )
        .orderBy(desc(inquiriesTable.createdAt));

      // approvalTasks link to a customer only indirectly (relatedType +
      // relatedId varchar). Resolve via this customer's booking + inquiry ids.
      const [bookingIdRows, inquiryIdRows] = await Promise.all([
        drizzleDb
          .select({ id: bookingsTable.id })
          .from(bookingsTable)
          .where(eq(bookingsTable.userId, input.userId)),
        drizzleDb
          .select({ id: inquiriesTable.id })
          .from(inquiriesTable)
          .where(eq(inquiriesTable.userId, input.userId)),
      ]);
      const bookingIds = bookingIdRows.map((r) => String(r.id));
      const inquiryIds = inquiryIdRows.map((r) => String(r.id));

      let pendingTasks: Array<{
        id: number;
        lane: string;
        taskType: string;
        riskLevel: string;
        title: string;
        summary: string | null;
        /** lane JSON (批2 m2) — quote cards render the price block from it. */
        payload: string;
        createdAt: Date;
      }> = [];
      const linkConds = [];
      if (bookingIds.length) {
        linkConds.push(
          and(
            eq(approvalTasksTable.relatedType, "booking"),
            inArray(approvalTasksTable.relatedId, bookingIds),
          ),
        );
      }
      if (inquiryIds.length) {
        linkConds.push(
          and(
            eq(approvalTasksTable.relatedType, "inquiry"),
            inArray(approvalTasksTable.relatedId, inquiryIds),
          ),
        );
      }
      if (linkConds.length) {
        pendingTasks = await drizzleDb
          .select({
            id: approvalTasksTable.id,
            lane: approvalTasksTable.lane,
            taskType: approvalTasksTable.taskType,
            riskLevel: approvalTasksTable.riskLevel,
            title: approvalTasksTable.title,
            summary: approvalTasksTable.summary,
            payload: approvalTasksTable.payload,
            createdAt: approvalTasksTable.createdAt,
          })
          .from(approvalTasksTable)
          .where(
            and(eq(approvalTasksTable.status, "pending"), or(...linkConds)),
          )
          .orderBy(desc(approvalTasksTable.createdAt));
      }

      // P3 — attach Jeff's「處理好了」disposition to each open item.
      const handled = new Set<string>();
      const dispConds = [];
      if (openBookings.length) {
        dispConds.push(
          and(
            eq(dispTable.itemKind, "booking"),
            inArray(dispTable.itemId, openBookings.map((b) => b.id)),
          ),
        );
      }
      if (openInquiries.length) {
        dispConds.push(
          and(
            eq(dispTable.itemKind, "inquiry"),
            inArray(dispTable.itemId, openInquiries.map((q) => q.id)),
          ),
        );
      }
      if (pendingTasks.length) {
        dispConds.push(
          and(
            eq(dispTable.itemKind, "task"),
            inArray(dispTable.itemId, pendingTasks.map((t) => t.id)),
          ),
        );
      }
      if (dispConds.length) {
        const drows = await drizzleDb
          .select({ k: dispTable.itemKind, i: dispTable.itemId })
          .from(dispTable)
          .where(or(...dispConds));
        for (const r of drows) handled.add(`${r.k}:${r.i}`);
      }

      return {
        counts: {
          openBookings: openBookings.length,
          openInquiries: openInquiries.length,
          pendingTasks: pendingTasks.length,
          total:
            openBookings.length + openInquiries.length + pendingTasks.length,
        },
        openBookings: openBookings.map((b) => ({
          ...b,
          handled: handled.has(`booking:${b.id}`),
        })),
        openInquiries: openInquiries.map((q) => ({
          ...q,
          handled: handled.has(`inquiry:${q.id}`),
        })),
        pendingTasks: pendingTasks.map((t) => ({
          ...t,
          handled: handled.has(`task:${t.id}`),
        })),
      };
    }),

  /**
   * customerChatList — the per-customer 對話 thread (批2 m3, 拍板獨立新表).
   * Chronological (oldest → newest) for direct render; bounded to the newest
   * `limit` turns. Writes happen only in the SSE stream handler.
   */
  customerChatList: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerChatMessages } = await import("../../drizzle/schema");
      const rows = await drizzleDb
        .select({
          id: customerChatMessages.id,
          senderRole: customerChatMessages.senderRole,
          body: customerChatMessages.body,
          // m3b — cards + suggestedActions JSON for turn extras rendering
          context: customerChatMessages.context,
          createdAt: customerChatMessages.createdAt,
        })
        .from(customerChatMessages)
        .where(eq(customerChatMessages.customerUserId, input.userId))
        .orderBy(desc(customerChatMessages.createdAt))
        .limit(input.limit ?? 50);
      return rows.reverse();
    }),
});
