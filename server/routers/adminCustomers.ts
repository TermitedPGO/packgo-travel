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
import {
  type ThreadTurn,
  inquiryFirstTurn,
  inquiryReplyTurn,
  interactionTurn,
  mergeThread,
} from "./adminCustomersThread";
import { isHiddenCustomer } from "./adminCustomersFilter";

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
  customerList: adminProcedure
    .input(z.object({ includeHidden: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const {
        users: usersTable,
        bookings: bookingsTable,
        customerProfiles,
      } = await import("../../drizzle/schema");

      // Subquery: total spend per user (sum of non-cancelled bookings).
      // Alias must NOT be `totalSpend`: once we leftJoin customerProfiles (which
      // has its OWN totalSpend column), a bare `COALESCE(totalSpend,0)` in the
      // outer select becomes ambiguous and MySQL rejects the whole query.
      const spendSub = drizzleDb
        .select({
          userId: bookingsTable.userId,
          bookingSpendSum: sql<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)`.as("bookingSpendSum"),
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

      // leftJoin customerProfiles (1:1 via unique uq_cp_user) for the manual
      // 'blocked' status + lastInteractionAt signal the auto-junk rule needs.
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
          totalSpend: sql<number>`COALESCE(${spendSub.bookingSpendSum}, 0)`,
          createdAt: usersTable.createdAt,
          lastSignedIn: usersTable.lastSignedIn,
          profileStatus: customerProfiles.status,
          lastInteractionAt: customerProfiles.lastInteractionAt,
        })
        .from(usersTable)
        .leftJoin(spendSub, eq(usersTable.id, spendSub.userId))
        .leftJoin(customerProfiles, eq(customerProfiles.userId, usersTable.id))
        .where(eq(usersTable.role, "user"))
        .orderBy(desc(usersTable.lastSignedIn));

      const withFlags = rows.map(({ profileStatus, lastInteractionAt, ...r }) => {
        const blocked = profileStatus === "blocked";
        const hidden = isHiddenCustomer(
          {
            bookingCount: r.bookingCount ?? 0,
            inquiryCount: r.inquiryCount ?? 0,
            lastInteractionAt: lastInteractionAt ?? null,
          },
          blocked,
        );
        return { ...r, blocked, hidden };
      });

      return input?.includeHidden ? withFlags : withFlags.filter((r) => !r.hidden);
    }),

  /**
   * markNotCustomer — hide a registered account from the default customer list
   * by setting its customerProfiles.status to 'blocked'. Reversible
   * (restoreCustomer) and non-destructive: no row is deleted, all history and
   * conversation stay intact. Upserts a minimal profile if none exists yet.
   */
  markNotCustomer: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles } = await import("../../drizzle/schema");
      const existing = await drizzleDb
        .select({ id: customerProfiles.id })
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, input.userId))
        .limit(1);
      if (existing[0]) {
        await drizzleDb
          .update(customerProfiles)
          .set({ status: "blocked" })
          .where(eq(customerProfiles.id, existing[0].id));
      } else {
        await drizzleDb
          .insert(customerProfiles)
          .values({ userId: input.userId, status: "blocked" });
      }
      return { ok: true };
    }),

  /** restoreCustomer — undo markNotCustomer (status back to 'active'). */
  restoreCustomer: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles } = await import("../../drizzle/schema");
      await drizzleDb
        .update(customerProfiles)
        .set({ status: "active" })
        .where(eq(customerProfiles.userId, input.userId));
      return { ok: true };
    }),

  /**
   * 批9 m3 — email 訪客列表(Jeff 拍板:sidebar 列 註冊用戶 + email 訪客)。
   * Guest = customerProfiles row that has an email but no linked user AND
   * whose email does not belong to any registered account (those are the
   * m2 歸戶 targets — they show as users, not twice). Newest contact first.
   */
  guestList: adminProcedure.query(async () => {
    const drizzleDb = (await db.getDb())!;
    const {
      customerProfiles,
      users: usersTable,
      inquiries: inquiriesTable,
      agentMessages,
    } = await import("../../drizzle/schema");
    // 訪客門檻 (v694 hotfix): 123 historical profiles were mostly noise
    // senders (bank alerts / marketing blasts) profiled before the
    // pipeline's noise filter existed. A guest only earns a sidebar chip
    // when there is actual CUSTOMER content behind it — an inquiry row or
    // an escalation — otherwise the customer list drowns in junk.
    const rows = await drizzleDb
      .select({
        profileId: customerProfiles.id,
        email: customerProfiles.email,
        updatedAt: customerProfiles.updatedAt,
      })
      .from(customerProfiles)
      .where(
        and(
          sql`${customerProfiles.userId} IS NULL`,
          sql`${customerProfiles.email} IS NOT NULL AND ${customerProfiles.email} != ''`,
          sql`NOT EXISTS (SELECT 1 FROM ${usersTable} WHERE ${usersTable.email} = ${customerProfiles.email})`,
          sql`(
            EXISTS (SELECT 1 FROM ${inquiriesTable} WHERE ${inquiriesTable.customerEmail} = ${customerProfiles.email})
            OR EXISTS (SELECT 1 FROM ${agentMessages} WHERE ${agentMessages.relatedCustomerProfileId} = ${customerProfiles.id} AND ${agentMessages.messageType} = 'escalation')
          )`,
        ),
      )
      .orderBy(desc(customerProfiles.updatedAt))
      .limit(200);
    return rows;
  }),

  /**
   * 批9 m3 — 訪客的詢問記錄(唯讀)。Keyed by the profile's email so the
   * whole history stays visible even before/after 歸戶. Open statuses
   * first, then the rest, newest first.
   */
  guestOpenItems: adminProcedure
    .input(z.object({ profileId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const {
        customerProfiles,
        inquiries: inquiriesTable,
        customerInteractions,
      } = await import("../../drizzle/schema");
      const profRows = await drizzleDb
        .select({
          id: customerProfiles.id,
          email: customerProfiles.email,
          createdAt: customerProfiles.createdAt,
        })
        .from(customerProfiles)
        .where(eq(customerProfiles.id, input.profileId))
        .limit(1);
      const profile = profRows[0];
      if (!profile?.email) {
        return { email: null, inquiries: [], interactions: [] };
      }
      const rows = await drizzleDb
        .select({
          id: inquiriesTable.id,
          inquiryType: inquiriesTable.inquiryType,
          subject: inquiriesTable.subject,
          message: inquiriesTable.message,
          status: inquiriesTable.status,
          createdAt: inquiriesTable.createdAt,
        })
        .from(inquiriesTable)
        .where(eq(inquiriesTable.customerEmail, profile.email))
        .orderBy(desc(inquiriesTable.createdAt))
        .limit(20);
      // Gmail-originated history lives in customerInteractions, NOT
      // inquiries (the pipeline never writes that table) — v695 親驗抓到
      // 訪客記錄頁空白的根因. Spam-classified rows stay hidden unless
      // Jeff rescued them (spam 永不靜默丟,但也不該污染客人記錄頁).
      const interactions = await drizzleDb
        .select({
          id: customerInteractions.id,
          direction: customerInteractions.direction,
          channel: customerInteractions.channel,
          content: customerInteractions.content,
          contentSummary: customerInteractions.contentSummary,
          classification: customerInteractions.classification,
          createdAt: customerInteractions.createdAt,
        })
        .from(customerInteractions)
        .where(
          and(
            eq(customerInteractions.customerProfileId, profile.id),
            // NULL-safe: outbound replies have no classification (→ NULL).
            // Without COALESCE, `NULL = 'spam'` is UNKNOWN → `NOT (…)` UNKNOWN →
            // the row is dropped, hiding every reply we sent from the pane.
            sql`NOT (COALESCE(${customerInteractions.classification}, '') = 'spam' AND COALESCE(${customerInteractions.spamVerdict}, '') != 'rescued')`,
          ),
        )
        .orderBy(desc(customerInteractions.createdAt))
        .limit(20);
      return {
        email: profile.email,
        firstSeenAt: profile.createdAt,
        inquiries: rows,
        interactions: interactions.map((i) => ({
          ...i,
          // full raw email (with From/Subject preamble) stays server-side;
          // the pane needs a readable snippet only
          content: (i.content ?? "").slice(0, 500),
        })),
      };
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

      // batch 6 m4 — visa applications for this customer
      const { visaApplications: visaTable } = await import("../../drizzle/schema");
      const ACTIVE_VISA = ["draft", "submitted", "paid", "documents_received", "processing"] as const;
      const openVisas = await drizzleDb
        .select({
          id: visaTable.id,
          visaType: visaTable.visaType,
          applicationStatus: visaTable.applicationStatus,
          firstName: visaTable.firstName,
          lastName: visaTable.lastName,
          trackingNumber: visaTable.trackingNumber,
          adminNotes: visaTable.adminNotes,
          uploadedDocuments: visaTable.uploadedDocuments,
          createdAt: visaTable.createdAt,
        })
        .from(visaTable)
        .where(
          and(
            eq(visaTable.userId, input.userId),
            inArray(visaTable.applicationStatus, [...ACTIVE_VISA]),
          ),
        )
        .orderBy(desc(visaTable.createdAt));

      return {
        counts: {
          openBookings: openBookings.length,
          openInquiries: openInquiries.length,
          pendingTasks: pendingTasks.length,
          openVisas: openVisas.length,
          total:
            openBookings.length + openInquiries.length + pendingTasks.length + openVisas.length,
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
        openVisas,
      };
    }),

  /**
   * customerChatList — the per-customer 對話 thread (批2 m3, 拍板獨立新表).
   * Chronological (oldest → newest) for direct render; bounded to the newest
   * `limit` turns. Writes happen only in the SSE stream handler.
   *
   * Keyed by `userId` (registered customer) OR `profileId` (email guest,
   * guest-customer-chat 2026-06-15) — exactly one. Both scope to the same
   * customerChatMessages table via different columns.
   */
  customerChatList: adminProcedure
    .input(
      z.union([
        z
          .object({
            userId: z.number().int().positive(),
            limit: z.number().int().min(1).max(200).optional(),
          })
          .strict(),
        z
          .object({
            profileId: z.number().int().positive(),
            limit: z.number().int().min(1).max(200).optional(),
          })
          .strict(),
      ]),
    )
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerChatMessages } = await import("../../drizzle/schema");
      const where =
        "userId" in input
          ? eq(customerChatMessages.customerUserId, input.userId)
          : eq(customerChatMessages.customerProfileId, input.profileId);
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
        .where(where)
        .orderBy(desc(customerChatMessages.createdAt))
        .limit(input.limit ?? 50);
      return rows.reverse();
    }),

  /**
   * customerConversationThread — the REAL conversation WITH the customer, for
   * the customer page's history view. Distinct from customerChatList (which is
   * Jeff ↔ AI-ops-agent chat). Merges three sources, newest-`limit` per source,
   * normalized to senderRole 'customer' | 'jeff', then chronological:
   *   1. inquiries.message       — the customer's original first message
   *   2. inquiryMessages         — website inquiry thread replies
   *   3. customerInteractions    — Gmail / email / multi-channel (spam-filtered)
   *
   * Cross-customer-leakage rules (adversarially verified, do NOT relax):
   *   - REGISTERED: keyed by inquiries.userId, PLUS the account's own pre-login
   *     history matched by the user's VERIFIED users.email (not client input,
   *     not the inquiry's free-text field) restricted to userId IS NULL rows.
   *     This is safe — a verified account email is unique to that person, and
   *     we only pull unclaimed (guest-filed) rows under it. Most real customers
   *     emailed / inquired BEFORE registering, so userId-only returns nothing.
   *   - GUEST inquiries use customerEmail AND userId IS NULL, email read from
   *     OUR customerProfiles row (not from client input).
   *   - customerInteractions is keyed by integer customerProfileId(s) resolved
   *     from OUR DB (userId match OR verified-email match), never by raw input.
   *   - WeChat is intentionally out of scope here (M2).
   *
   * Returns string ids namespaced by source (`inq:` / `im:` / `ci:`) so React
   * keys stay unique across tables. `truncated` flags that an older slice was
   * dropped by the per-source cap.
   */
  customerConversationThread: adminProcedure
    .input(
      z.union([
        z
          .object({
            userId: z.number().int().positive(),
            limit: z.number().int().min(1).max(200).optional(),
          })
          .strict(),
        z
          .object({
            profileId: z.number().int().positive(),
            limit: z.number().int().min(1).max(200).optional(),
          })
          .strict(),
      ]),
    )
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const {
        users: usersTable,
        customerProfiles,
        inquiries,
        inquiryMessages,
        customerInteractions,
      } = await import("../../drizzle/schema");
      const lim = input.limit ?? 50;
      const isRegistered = "userId" in input;

      // Resolve identity from OUR DB. For a registered user we also resolve the
      // VERIFIED account email (users.email) so their pre-login, email-filed
      // history (guest inquiries / email threads under that address) surfaces —
      // most customers contacted us before registering. For a guest, the input
      // profileId IS the row; its email comes from our profile, never input.
      let verifiedEmail: string | null = null;
      let guestEmail: string | null = null;
      let profileIds: number[] = [];

      if (isRegistered) {
        verifiedEmail =
          (
            await drizzleDb
              .select({ email: usersTable.email })
              .from(usersTable)
              .where(eq(usersTable.id, input.userId))
              .limit(1)
          )[0]?.email ?? null;
        const profs = await drizzleDb
          .select({ id: customerProfiles.id })
          .from(customerProfiles)
          .where(
            verifiedEmail
              ? or(
                  eq(customerProfiles.userId, input.userId),
                  eq(customerProfiles.email, verifiedEmail),
                )
              : eq(customerProfiles.userId, input.userId),
          );
        profileIds = profs.map((p) => p.id);
      } else {
        const prof = (
          await drizzleDb
            .select({ id: customerProfiles.id, email: customerProfiles.email })
            .from(customerProfiles)
            .where(eq(customerProfiles.id, input.profileId))
            .limit(1)
        )[0];
        guestEmail = prof?.email ?? null;
        if (prof) profileIds = [prof.id];
      }

      // ── Source 1+2: inquiries (original message) + inquiryMessages (replies)
      const inquiryWhere = isRegistered
        ? verifiedEmail
          ? or(
              eq(inquiries.userId, input.userId),
              and(
                sql`${inquiries.userId} IS NULL`,
                eq(inquiries.customerEmail, verifiedEmail),
              ),
            )
          : eq(inquiries.userId, input.userId)
        : guestEmail
          ? and(
              sql`${inquiries.userId} IS NULL`,
              eq(inquiries.customerEmail, guestEmail),
            )
          : null;

      let inquiryIdRows: Array<{ id: number; message: string; createdAt: Date }> =
        [];
      if (inquiryWhere) {
        inquiryIdRows = await drizzleDb
          .select({
            id: inquiries.id,
            message: inquiries.message,
            createdAt: inquiries.createdAt,
          })
          .from(inquiries)
          .where(inquiryWhere)
          .orderBy(desc(inquiries.createdAt))
          .limit(lim);
      }

      const inquiryFirstTurns = inquiryIdRows.map(inquiryFirstTurn);

      let inquiryReplyTurns: ThreadTurn[] = [];
      const inquiryIds = inquiryIdRows.map((r) => r.id);
      if (inquiryIds.length > 0) {
        const replies = await drizzleDb
          .select({
            id: inquiryMessages.id,
            senderType: inquiryMessages.senderType,
            message: inquiryMessages.message,
            createdAt: inquiryMessages.createdAt,
          })
          .from(inquiryMessages)
          .where(inArray(inquiryMessages.inquiryId, inquiryIds))
          .orderBy(desc(inquiryMessages.createdAt))
          .limit(lim);
        inquiryReplyTurns = replies.map(inquiryReplyTurn);
      }

      // ── Source 3: customerInteractions (Gmail / email / multi-channel).
      // Keyed by the resolved profileId(s). Spam predicate is byte-for-byte the
      // same as guestOpenItems — confirmed/unreviewed spam stays hidden, rescued
      // shows, outbound (classification NULL) is never hidden.
      let interactionTurns: ThreadTurn[] = [];
      if (profileIds.length > 0) {
        const interactions = await drizzleDb
          .select({
            id: customerInteractions.id,
            direction: customerInteractions.direction,
            content: customerInteractions.content,
            createdAt: customerInteractions.createdAt,
          })
          .from(customerInteractions)
          .where(
            and(
              inArray(customerInteractions.customerProfileId, profileIds),
              sql`NOT (COALESCE(${customerInteractions.classification}, '') = 'spam' AND COALESCE(${customerInteractions.spamVerdict}, '') != 'rescued')`,
            ),
          )
          .orderBy(desc(customerInteractions.createdAt))
          .limit(lim);
        interactionTurns = interactions.map(interactionTurn);
      }

      return mergeThread(
        [inquiryFirstTurns, inquiryReplyTurns, interactionTurns],
        lim,
      );
    }),

  customerProfileData: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles } = await import("../../drizzle/schema");
      const [row] = await drizzleDb
        .select({
          preferredLanguage: customerProfiles.preferredLanguage,
          communicationStyle: customerProfiles.communicationStyle,
          preferences: customerProfiles.preferences,
          keyFacts: customerProfiles.keyFacts,
          vipScore: customerProfiles.vipScore,
          totalSpend: customerProfiles.totalSpend,
          bookingCount: customerProfiles.bookingCount,
          status: customerProfiles.status,
          familyContext: customerProfiles.familyContext,
          budgetTier: customerProfiles.budgetTier,
        })
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, input.userId))
        .limit(1);
      return row ?? null;
    }),
});
