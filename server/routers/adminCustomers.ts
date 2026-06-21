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
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { eq, desc, sql, and, or, inArray, type SQL } from "drizzle-orm";
import {
  type ThreadTurn,
  inquiryFirstTurn,
  inquiryReplyTurn,
  interactionTurn,
  mergeThread,
} from "./adminCustomersThread";
import { isHiddenCustomer } from "./adminCustomersFilter";
import {
  quoteDoc,
  invoiceDoc,
  uploadedDoc,
  flightOrderDoc,
  mergeDocs,
} from "./adminCustomersDocs";
import {
  inquiryDraftCard,
  escalationDraftCard,
  mergeDrafts,
} from "./adminCustomerDrafts";

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
        inquiries: inquiriesTable,
        aiQuotes: aiQuotesTable,
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
          // 需跟進 (locked 2026-06-20): open inquiry >2d unanswered OR a
          // sent/viewed quote >5d old. Correlated EXISTS by userId OR verified
          // email — read-only signal, never auto-acts. Intentionally STATUS-only
          // (a coarse sidebar nudge); the detail pane additionally subtracts
          // Jeff's「處理好了」dispositions, so a dismissed-but-still-open item can
          // show the list badge yet read clear on the detail — by design.
          needsFollowup: sql<number>`(
            EXISTS (SELECT 1 FROM ${inquiriesTable}
              WHERE (${inquiriesTable.userId} = ${usersTable.id} OR ${inquiriesTable.customerEmail} = ${usersTable.email})
                AND ${inquiriesTable.status} IN ('new','in_progress')
                AND ${inquiriesTable.createdAt} < (NOW() - INTERVAL 2 DAY))
            OR EXISTS (SELECT 1 FROM ${aiQuotesTable}
              WHERE (${aiQuotesTable.userId} = ${usersTable.id} OR ${aiQuotesTable.customerEmail} = ${usersTable.email})
                AND ${aiQuotesTable.status} IN ('sent','viewed')
                AND ${aiQuotesTable.createdAt} < (NOW() - INTERVAL 5 DAY))
          )`,
        })
        .from(usersTable)
        .leftJoin(spendSub, eq(usersTable.id, spendSub.userId))
        .leftJoin(customerProfiles, eq(customerProfiles.userId, usersTable.id))
        .where(eq(usersTable.role, "user"))
        .orderBy(desc(usersTable.lastSignedIn));

      const withFlags = rows.map(({ profileStatus, lastInteractionAt, needsFollowup, ...r }) => {
        const blocked = profileStatus === "blocked";
        const hidden = isHiddenCustomer(
          {
            bookingCount: r.bookingCount ?? 0,
            inquiryCount: r.inquiryCount ?? 0,
            lastInteractionAt: lastInteractionAt ?? null,
          },
          blocked,
        );
        return { ...r, blocked, hidden, needsFollowup: Number(needsFollowup) === 1 };
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
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles } = await import("../../drizzle/schema");
      // Guest path: the profileId IS the customerProfiles row — update directly.
      if ("profileId" in input) {
        await drizzleDb
          .update(customerProfiles)
          .set({ status: "blocked" })
          .where(eq(customerProfiles.id, input.profileId));
        return { ok: true };
      }
      // Registered path: upsert a minimal profile keyed by userId.
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
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles } = await import("../../drizzle/schema");
      await drizzleDb
        .update(customerProfiles)
        .set({ status: "active" })
        .where(
          "profileId" in input
            ? eq(customerProfiles.id, input.profileId)
            : eq(customerProfiles.userId, input.userId),
        );
      return { ok: true };
    }),

  /**
   * createManualCustomer — Jeff adds a customer by hand from the customer page
   * (phone / WeChat / referral leads that never came through the website form).
   * Stored as a guest customerProfiles row (userId NULL, source='manual') so it
   * shows in the list immediately and any future inquiry/email keyed to the same
   * address auto-attaches. Name is required; at least one of email/phone must be
   * present (Jeff's call — WeChat customers often have no email). If an email is
   * given we refuse to duplicate an existing registered account or guest profile
   * so the list never grows two cards for the same person.
   */
  createManualCustomer: adminProcedure
    .input(
      z
        .object({
          name: z.string().trim().min(1).max(255),
          email: z.string().trim().max(255).email().optional().or(z.literal("")),
          phone: z.string().trim().max(32).optional().or(z.literal("")),
        })
        .refine((v) => !!v.email || !!v.phone, {
          message: "email_or_phone_required",
        }),
    )
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles, users: usersTable } = await import(
        "../../drizzle/schema"
      );
      const name = input.name.trim();
      const email = input.email?.trim() || null;
      const phone = input.phone?.trim() || null;

      if (email) {
        const dupUser = await drizzleDb
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.email, email))
          .limit(1);
        if (dupUser[0]) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "email_exists_registered",
          });
        }
        const dupProfile = await drizzleDb
          .select({ id: customerProfiles.id })
          .from(customerProfiles)
          .where(eq(customerProfiles.email, email))
          .limit(1);
        if (dupProfile[0]) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "email_exists_guest",
          });
        }
      }

      const result = await drizzleDb.insert(customerProfiles).values({
        name,
        email,
        phone,
        source: "manual",
        status: "active",
      });
      const profileId = Number((result as any)[0]?.insertId ?? 0);
      return { ok: true, profileId };
    }),

  /**
   * 批9 m3 — email 訪客列表(Jeff 拍板:sidebar 列 註冊用戶 + email 訪客)。
   * Guest = customerProfiles row that has an email but no linked user AND
   * whose email does not belong to any registered account (those are the
   * m2 歸戶 targets — they show as users, not twice). Newest contact first.
   */
  guestList: adminProcedure
    .input(z.object({ includeHidden: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
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
          name: customerProfiles.name,
          email: customerProfiles.email,
          phone: customerProfiles.phone,
          updatedAt: customerProfiles.updatedAt,
          status: customerProfiles.status,
          // 需跟進: an unanswered inquiry (by this profile's email) older than 2d.
          needsFollowup: sql<number>`EXISTS (SELECT 1 FROM ${inquiriesTable}
            WHERE ${inquiriesTable.customerEmail} = ${customerProfiles.email}
              AND ${inquiriesTable.status} IN ('new','in_progress')
              AND ${inquiriesTable.createdAt} < (NOW() - INTERVAL 2 DAY))`,
        })
        .from(customerProfiles)
        .where(
          and(
            sql`${customerProfiles.userId} IS NULL`,
            // Contactable: at least an email OR a phone (a manual WeChat/phone
            // lead may legitimately have no email).
            sql`(
              (${customerProfiles.email} IS NOT NULL AND ${customerProfiles.email} != '')
              OR (${customerProfiles.phone} IS NOT NULL AND ${customerProfiles.phone} != '')
            )`,
            // If an email is present it must not already belong to a registered
            // account (歸戶 targets show as registered customers, not twice).
            sql`(
              ${customerProfiles.email} IS NULL OR ${customerProfiles.email} = ''
              OR NOT EXISTS (SELECT 1 FROM ${usersTable} WHERE ${usersTable.email} = ${customerProfiles.email})
            )`,
            // Earns a sidebar chip when there is real customer content (an
            // inquiry / escalation) OR Jeff added the customer by hand.
            sql`(
              ${customerProfiles.source} = 'manual'
              OR EXISTS (SELECT 1 FROM ${inquiriesTable} WHERE ${inquiriesTable.customerEmail} = ${customerProfiles.email})
              OR EXISTS (SELECT 1 FROM ${agentMessages} WHERE ${agentMessages.relatedCustomerProfileId} = ${customerProfiles.id} AND ${agentMessages.messageType} = 'escalation')
            )`,
          ),
        )
        .orderBy(desc(customerProfiles.updatedAt))
        .limit(200);
      // Manual hide reuses the same customerProfiles.status='blocked' switch as
      // registered accounts (markNotCustomer/restoreCustomer by profileId).
      // Default view drops blocked guests; the "show hidden" toggle brings them
      // back. Nothing is deleted — a mis-hide is one click to restore.
      const withFlags = rows.map(({ status, needsFollowup, ...r }) => ({
        ...r,
        blocked: status === "blocked",
        needsFollowup: Number(needsFollowup) === 1,
      }));
      return input?.includeHidden
        ? withFlags
        : withFlags.filter((r) => !r.blocked);
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
          name: customerProfiles.name,
          email: customerProfiles.email,
          phone: customerProfiles.phone,
          createdAt: customerProfiles.createdAt,
        })
        .from(customerProfiles)
        .where(eq(customerProfiles.id, input.profileId))
        .limit(1);
      const profile = profRows[0];
      if (!profile) {
        return {
          profileId: input.profileId,
          name: null,
          email: null,
          phone: null,
          inquiries: [],
          interactions: [],
        };
      }
      // Inquiries are keyed by email — a manual phone-only customer simply has
      // none yet (its identity + interactions still come back below).
      const rows = profile.email
        ? await drizzleDb
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
            .limit(20)
        : [];
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
        profileId: profile.id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
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
        users: usersTable,
        bookings: bookingsTable,
        inquiries: inquiriesTable,
        tours: toursTable,
        approvalTasks: approvalTasksTable,
        workspaceDispositions: dispTable,
      } = await import("../../drizzle/schema");

      // Resolve the account's VERIFIED email so open inquiries filed BEFORE the
      // customer registered (userId NULL, matched by email) surface here too —
      // keeping the detail follow-up consistent with the sidebar needsFollowup
      // badge, which is identity-wide. Email branch is userId-IS-NULL guarded so
      // it never claims another account's inquiry.
      const verifiedEmail =
        (
          await drizzleDb
            .select({ email: usersTable.email })
            .from(usersTable)
            .where(eq(usersTable.id, input.userId))
            .limit(1)
        )[0]?.email ?? null;
      const inquiryIdentity: SQL = verifiedEmail
        ? (or(
            eq(inquiriesTable.userId, input.userId),
            and(
              sql`${inquiriesTable.userId} IS NULL`,
              eq(inquiriesTable.customerEmail, verifiedEmail),
            ),
          ) as SQL)
        : eq(inquiriesTable.userId, input.userId);

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
            inquiryIdentity,
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
  /**
   * customerDrafts — pending AI reply drafts for ONE customer (Batch 2),
   * unified across the two existing stores so Jeff can one-click approve→send
   * from the customer page. READ-ONLY here; the actual send reuses the existing
   * audited mutations dispatched by the card's `source`:
   *   - source=inquiry → commandCenter.approve / reject ({ id: taskId })
   *   - source=email   → commandCenter.escalationReply ({ messageId })
   * Identity resolves from OUR DB exactly like customerConversationThread
   * (verified email + profileIds, userId-IS-NULL guard) so a draft never
   * surfaces under the wrong customer.
   */
  customerDrafts: adminProcedure
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const {
        users: usersTable,
        customerProfiles,
        inquiries,
        approvalTasks,
        agentMessages,
      } = await import("../../drizzle/schema");
      const isRegistered = "userId" in input;

      // Identity from OUR DB (same resolution as customerConversationThread).
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
      const fallbackEmail = verifiedEmail ?? guestEmail;

      // ── Source 1: website-inquiry drafts — approvalTasks (lane=cs,
      // taskType=inquiry_reply, status=pending) for THIS customer's inquiries.
      // status=pending is the clean not-yet-sent signal (approve flips it).
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

      let inquiryCards: ReturnType<typeof inquiryDraftCard>[] = [];
      if (inquiryWhere) {
        const myInquiryIds = (
          await drizzleDb
            .select({ id: inquiries.id })
            .from(inquiries)
            .where(inquiryWhere)
        ).map((r) => String(r.id));
        if (myInquiryIds.length > 0) {
          const taskRows = await drizzleDb
            .select({
              id: approvalTasks.id,
              payload: approvalTasks.payload,
              riskLevel: approvalTasks.riskLevel,
              createdAt: approvalTasks.createdAt,
            })
            .from(approvalTasks)
            .where(
              and(
                eq(approvalTasks.lane, "cs"),
                eq(approvalTasks.taskType, "inquiry_reply"),
                eq(approvalTasks.status, "pending"),
                eq(approvalTasks.relatedType, "inquiry"),
                inArray(approvalTasks.relatedId, myInquiryIds),
              ),
            )
            .orderBy(desc(approvalTasks.createdAt))
            .limit(50);
          inquiryCards = taskRows.map(inquiryDraftCard);
        }
      }

      // ── Source 2: Gmail escalation drafts — agentMessages (messageType=
      // escalation) keyed to this customer's profile id(s). readByJeff=0 is the
      // "still needs Jeff" proxy (acking clears it). Only rows with a draftReply
      // + gmailThreadId become actionable cards (see escalationDraftCard).
      let emailCards: ReturnType<typeof escalationDraftCard>[] = [];
      if (profileIds.length > 0) {
        const msgRows = await drizzleDb
          .select({
            id: agentMessages.id,
            context: agentMessages.context,
            createdAt: agentMessages.createdAt,
          })
          .from(agentMessages)
          .where(
            and(
              eq(agentMessages.messageType, "escalation"),
              eq(agentMessages.readByJeff, 0),
              inArray(agentMessages.relatedCustomerProfileId, profileIds),
            ),
          )
          .orderBy(desc(agentMessages.createdAt))
          .limit(50);
        emailCards = msgRows.map((r) =>
          escalationDraftCard({ ...r, fallbackEmail }),
        );
      }

      return mergeDrafts([
        inquiryCards.filter((c): c is NonNullable<typeof c> => c != null),
        emailCards.filter((c): c is NonNullable<typeof c> => c != null),
      ]);
    }),

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

  /**
   * customerDocs — the 文件 tab. Surfaces four real sources that already exist
   * but were never shown: aiQuotes (報價單), invoices (發票), customerDocuments
   * (email 附件 / 護照·簽證掃描), flightOrders (機票訂單, info-only). Same safe
   * identity resolution as customerConversationThread — quotes/invoices keyed by
   * the account's userId OR its VERIFIED email (guest: the profile's own email);
   * uploaded docs by the resolved profileId(s); flight orders by userId (guests
   * have none). PII files expose only filename + download link; the encrypted
   * passport number / DOB never leave the server.
   */
  customerDocs: adminProcedure
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const {
        users: usersTable,
        customerProfiles,
        aiQuotes: aiQuotesTable,
        invoices: invoicesTable,
        customerDocuments,
        flightOrders,
      } = await import("../../drizzle/schema");
      const isRegistered = "userId" in input;

      let email: string | null = null;
      let userId: number | null = null;
      let profileIds: number[] = [];
      if (isRegistered) {
        userId = input.userId;
        email =
          (
            await drizzleDb
              .select({ email: usersTable.email })
              .from(usersTable)
              .where(eq(usersTable.id, userId))
              .limit(1)
          )[0]?.email ?? null;
        const profs = await drizzleDb
          .select({ id: customerProfiles.id })
          .from(customerProfiles)
          .where(
            email
              ? or(eq(customerProfiles.userId, userId), eq(customerProfiles.email, email))
              : eq(customerProfiles.userId, userId),
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
        email = prof?.email ?? null;
        if (prof) profileIds = [prof.id];
      }

      // Quotes (q:) — owned by this userId, OR UNATTRIBUTED rows under the
      // verified/guest email. The email branch is guarded by userId IS NULL so a
      // quote whose customerEmail collides with this address but is OWNED by a
      // DIFFERENT account never leaks in (mirrors customerConversationThread).
      const quoteConds: SQL[] = [];
      if (userId != null) quoteConds.push(eq(aiQuotesTable.userId, userId));
      if (email)
        quoteConds.push(
          and(sql`${aiQuotesTable.userId} IS NULL`, eq(aiQuotesTable.customerEmail, email)) as SQL,
        );
      const quoteRows = quoteConds.length
        ? await drizzleDb
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
            .limit(50)
        : [];

      // Invoices (inv:) — same rule: owned by userId, or UNATTRIBUTED under the
      // email (userId IS NULL guard prevents another account's invoice leaking in).
      const invConds: SQL[] = [];
      if (userId != null) invConds.push(eq(invoicesTable.userId, userId));
      if (email)
        invConds.push(
          and(sql`${invoicesTable.userId} IS NULL`, eq(invoicesTable.customerEmail, email)) as SQL,
        );
      const invoiceRows = invConds.length
        ? await drizzleDb
            .select({
              id: invoicesTable.id,
              invoiceNumber: invoicesTable.invoiceNumber,
              totalAmount: invoicesTable.totalAmount,
              currency: invoicesTable.currency,
              pdfUrl: invoicesTable.pdfUrl,
              status: invoicesTable.status,
              createdAt: invoicesTable.createdAt,
            })
            .from(invoicesTable)
            .where(or(...invConds))
            .orderBy(desc(invoicesTable.createdAt))
            .limit(50)
        : [];

      // Uploaded docs (cd:) — email attachments / passport·visa scans, by profileId(s).
      const uploadedRows = profileIds.length
        ? await drizzleDb
            .select({
              id: customerDocuments.id,
              type: customerDocuments.type,
              fileName: customerDocuments.fileName,
              r2Url: customerDocuments.r2Url,
              uploadedAt: customerDocuments.uploadedAt,
            })
            .from(customerDocuments)
            .where(inArray(customerDocuments.customerProfileId, profileIds))
            .orderBy(desc(customerDocuments.uploadedAt))
            .limit(50)
        : [];

      // Flight orders (fo:) — registered only (keyed by users.id).
      const flightRows =
        userId != null
          ? await drizzleDb
              .select({
                id: flightOrders.id,
                airline: flightOrders.airline,
                flightSummary: flightOrders.flightSummary,
                status: flightOrders.status,
                createdAt: flightOrders.createdAt,
              })
              .from(flightOrders)
              .where(eq(flightOrders.customerUserId, userId))
              .orderBy(desc(flightOrders.createdAt))
              .limit(50)
          : [];

      return mergeDocs([
        quoteRows.map(quoteDoc),
        invoiceRows.map(invoiceDoc),
        uploadedRows.map(uploadedDoc),
        flightRows.map(flightOrderDoc),
      ]);
    }),
});
