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
import { createChildLogger } from "../_core/logger";
import {
  isIntakeTooLarge,
  normalizeExtractedCustomer,
  MAX_EXTRACT_TEXT_CHARS,
} from "../_core/customerIntakeExtract";
import { eq, desc, sql, and, or, inArray, isNull, type SQL } from "drizzle-orm";
import {
  type ThreadTurn,
  inquiryFirstTurn,
  inquiryReplyTurn,
  interactionTurn,
  mergeThread,
  resolveConversationThreadScope,
  includesInquiries,
} from "./adminCustomersThread";
import { isHiddenCustomer } from "./adminCustomersFilter";
import { guestDeleteGate } from "./adminCustomersGuestDelete";
import { isUnreadInbound, markCustomerSeen } from "../_core/customerUnread";
import { loadCustomerDocs } from "../_core/customerDocsLoader";
import {
  readCachedSummary,
  refreshAndStoreSummary,
} from "../_core/customerAiSummary";
import {
  inquiryDraftCard,
  escalationDraftCard,
  observationDraftCard,
  mergeDrafts,
  isDraftCurrent,
  onlyNewestDraft,
} from "./adminCustomerDrafts";

/**
 * 整合工作台 P2 — what counts as an OPEN item in a customer's inbox.
 * Bookings still active (not completed/cancelled), inquiries not yet
 * resolved/closed. Pending approval tasks linked to this customer also count.
 */
export const OPEN_BOOKING_STATUSES = ["pending", "confirmed"] as const;
export const OPEN_INQUIRY_STATUSES = ["new", "in_progress"] as const;

const extractionInflight = new Set<number>();

const log = createChildLogger({ module: "adminCustomers" });

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof db.getDb>>>;

/**
 * 護照 presence for the profile 護照 line — EXISTS-only, NEVER decrypts. We
 * check row existence / `passportNumber IS NOT NULL` on the AES-256-GCM
 * ciphertext column, so 護照 shows 已提供 / 未提供 without the number ever
 * leaving the server. Three real sources hold a customer's passport:
 *   - customerDocuments type passport/visa (a filed scan) — profileId path,
 *     covers registered + guest, and is the most customer-page-relevant signal.
 *   - bookingParticipants.passportNumber (recorded at booking) — userId path.
 *   - visaApplications.passportNumber    (recorded at visa apply) — userId OR
 *     email path (a guest / logged-out applicant keys on email).
 */
async function hasPassportOnFile(
  drizzleDb: DrizzleDb,
  by: { userId?: number; email?: string | null; profileId?: number },
): Promise<boolean> {
  const { bookingParticipants, bookings, visaApplications, customerDocuments } =
    await import("../../drizzle/schema");
  if (by.profileId != null) {
    const [d] = await drizzleDb
      .select({ one: sql<number>`1` })
      .from(customerDocuments)
      .where(
        and(
          eq(customerDocuments.customerProfileId, by.profileId),
          inArray(customerDocuments.type, ["passport", "visa"]),
        ),
      )
      .limit(1);
    if (d) return true;
  }
  if (by.userId != null) {
    const [v] = await drizzleDb
      .select({ one: sql<number>`1` })
      .from(visaApplications)
      .where(eq(visaApplications.userId, by.userId))
      .limit(1);
    if (v) return true;
    const [p] = await drizzleDb
      .select({ one: sql<number>`1` })
      .from(bookingParticipants)
      .innerJoin(bookings, eq(bookingParticipants.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.userId, by.userId),
          sql`${bookingParticipants.passportNumber} IS NOT NULL`,
        ),
      )
      .limit(1);
    if (p) return true;
  }
  if (by.email) {
    const [v] = await drizzleDb
      .select({ one: sql<number>`1` })
      .from(visaApplications)
      .where(eq(visaApplications.email, by.email))
      .limit(1);
    if (v) return true;
  }
  return false;
}

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
        agentMessages,
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
          followUpDate: customerProfiles.followUpDate,
          // customer-unread (0108) — 來訊未讀紅點的兩根指針(NULL 當沒 profile row)。
          lastInboundAt: customerProfiles.lastInboundAt,
          jeffViewedAt: customerProfiles.jeffViewedAt,
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
          // 紅點: unread agent messages filed against this customer's profile —
          // the same readByJeff=0 signal the ops ChatsTab red dot uses. NULL when
          // a registered user has no customerProfiles row yet (COUNT → 0).
          unread: sql<number>`(SELECT COUNT(*) FROM ${agentMessages} WHERE ${agentMessages.relatedCustomerProfileId} = ${customerProfiles.id} AND ${agentMessages.readByJeff} = 0)`,
        })
        .from(usersTable)
        .leftJoin(spendSub, eq(usersTable.id, spendSub.userId))
        .leftJoin(customerProfiles, eq(customerProfiles.userId, usersTable.id))
        .where(eq(usersTable.role, "user"))
        .orderBy(desc(usersTable.lastSignedIn));

      const withFlags = rows.map(
        ({ profileStatus, lastInteractionAt, needsFollowup, unread, lastInboundAt, jeffViewedAt, ...r }) => {
          const blocked = profileStatus === "blocked";
          const hidden = isHiddenCustomer(
            {
              bookingCount: r.bookingCount ?? 0,
              inquiryCount: r.inquiryCount ?? 0,
              lastInteractionAt: lastInteractionAt ?? null,
            },
            blocked,
          );
          return {
            ...r,
            blocked,
            hidden,
            needsFollowup: Number(needsFollowup) === 1,
            unread: Number(unread),
            // customer-unread (0108) — 客人來訊 Jeff 還沒看(名字粗體 + 頭像紅點)。
            // 與既有 `unread`(agentMessages count)是兩個訊號,不合併。
            unreadInbound: isUnreadInbound(lastInboundAt ?? null, jeffViewedAt ?? null),
          };
        },
      );

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
   * markCustomerSeen (customer-unread, 0108) — Jeff opened this customer:
   * jeffViewedAt = NOW, the row's red dot goes out. Mirrors markNotCustomer's
   * upsert-by-userId / direct-by-profileId resolution (a registered customer
   * with no profile row yet gets a minimal one).
   */
  markCustomerSeen: adminProcedure
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      await markCustomerSeen(drizzleDb, input);
      return { ok: true };
    }),

  /**
   * customerUnreadCount (customer-unread, 0108) — how many customers have an
   * unseen inbound message, for the /ops nav rail badge. Applies the SAME
   * noise gates as the two lists (registered: isHiddenCustomer auto-junk +
   * blocked; guests: guestList's contactable / not-registered / real-content
   * SQL conditions + blocked), so the badge count and the visible red dots
   * can never disagree.
   */
  customerUnreadCount: adminProcedure.query(async () => {
    const drizzleDb = (await db.getDb())!;
    const {
      customerProfiles,
      users: usersTable,
      inquiries: inquiriesTable,
      agentMessages,
    } = await import("../../drizzle/schema");

    // Registered customers — profile row required (that's where the pointers
    // live); SQL prefilters lastInboundAt, TS applies the shared gates.
    const registered = await drizzleDb
      .select({
        bookingCount: usersTable.bookingCount,
        inquiryCount: usersTable.inquiryCount,
        lastInteractionAt: customerProfiles.lastInteractionAt,
        status: customerProfiles.status,
        lastInboundAt: customerProfiles.lastInboundAt,
        jeffViewedAt: customerProfiles.jeffViewedAt,
      })
      .from(usersTable)
      .innerJoin(customerProfiles, eq(customerProfiles.userId, usersTable.id))
      .where(
        and(
          eq(usersTable.role, "user"),
          sql`${customerProfiles.lastInboundAt} IS NOT NULL`,
        ),
      );
    const registeredUnread = registered.filter(
      (r) =>
        !isHiddenCustomer(
          {
            bookingCount: r.bookingCount ?? 0,
            inquiryCount: r.inquiryCount ?? 0,
            lastInteractionAt: r.lastInteractionAt ?? null,
          },
          r.status === "blocked",
        ) && isUnreadInbound(r.lastInboundAt, r.jeffViewedAt),
    ).length;

    // Guests — mirror guestList's WHERE (雜訊 profile 不算數) + unread pointers.
    const guests = await drizzleDb
      .select({
        status: customerProfiles.status,
        lastInboundAt: customerProfiles.lastInboundAt,
        jeffViewedAt: customerProfiles.jeffViewedAt,
      })
      .from(customerProfiles)
      .where(
        and(
          sql`${customerProfiles.userId} IS NULL`,
          sql`${customerProfiles.lastInboundAt} IS NOT NULL`,
          sql`(
            (${customerProfiles.email} IS NOT NULL AND ${customerProfiles.email} != '')
            OR (${customerProfiles.phone} IS NOT NULL AND ${customerProfiles.phone} != '')
          )`,
          sql`(
            ${customerProfiles.email} IS NULL OR ${customerProfiles.email} = ''
            OR NOT EXISTS (SELECT 1 FROM ${usersTable} WHERE ${usersTable.email} = ${customerProfiles.email})
          )`,
          sql`(
            ${customerProfiles.source} = 'manual'
            OR EXISTS (SELECT 1 FROM ${inquiriesTable} WHERE ${inquiriesTable.customerEmail} = ${customerProfiles.email})
            OR EXISTS (SELECT 1 FROM ${agentMessages} WHERE ${agentMessages.relatedCustomerProfileId} = ${customerProfiles.id} AND ${agentMessages.messageType} = 'escalation')
          )`,
        ),
      );
    const guestUnread = guests.filter(
      (g) =>
        g.status !== "blocked" &&
        isUnreadInbound(g.lastInboundAt, g.jeffViewedAt),
    ).length;

    return { count: registeredUnread + guestUnread };
  }),

  /**
   * deleteGuestCustomer (customer-cockpit, 2026-07-01) — Jeff:「不只是隱藏 也可
   * 以選擇刪除」。HARD delete of a pure-noise GUEST profile + its interactions /
   * chat / documents (R2 files best-effort). Gated by guestDeleteGate (pure,
   * unit-tested): guests only (registered accounts must use hide), and any
   * business trace (customOrders / totalSpend / bookingCount) refuses — those
   * histories are irreversible, hide instead. Audited like update_booking_status.
   */
  deleteGuestCustomer: adminProcedure
    .input(z.object({ profileId: z.number().int().positive() }).strict())
    .mutation(async ({ ctx, input }) => {
      const drizzleDb = (await db.getDb())!;
      const {
        customerProfiles,
        customOrders,
        customerInteractions,
        customerChatMessages,
        customerDocuments,
      } = await import("../../drizzle/schema");

      const [profile] = await drizzleDb
        .select({
          id: customerProfiles.id,
          userId: customerProfiles.userId,
          email: customerProfiles.email,
          phone: customerProfiles.phone,
          name: customerProfiles.name,
          totalSpend: customerProfiles.totalSpend,
          bookingCount: customerProfiles.bookingCount,
        })
        .from(customerProfiles)
        .where(eq(customerProfiles.id, input.profileId))
        .limit(1);

      const [orderCountRow] = await drizzleDb
        .select({ n: sql<number>`COUNT(*)` })
        .from(customOrders)
        .where(eq(customOrders.customerProfileId, input.profileId));

      const verdict = guestDeleteGate(
        profile ?? null,
        Number(orderCountRow?.n ?? 0),
      );
      if (!verdict.ok) {
        throw new TRPCError({ code: verdict.code, message: verdict.message });
      }

      // Documents first: collect R2 refs, best-effort delete the bytes (a
      // storage failure must never leave the DB half-deleted — warn + continue).
      const docs = await drizzleDb
        .select({ id: customerDocuments.id, r2Url: customerDocuments.r2Url })
        .from(customerDocuments)
        .where(eq(customerDocuments.customerProfileId, input.profileId));
      for (const doc of docs) {
        if (!doc.r2Url) continue;
        try {
          const { storageDelete, extractR2KeyFromUrl } = await import("../storage");
          const key = /^https?:\/\//i.test(doc.r2Url)
            ? extractR2KeyFromUrl(doc.r2Url)
            : doc.r2Url;
          if (key) {
            await storageDelete(key);
          } else {
            log.warn(
              { docId: doc.id, profileId: input.profileId },
              "[deleteGuestCustomer] cannot derive R2 key from r2Url, skipping bytes",
            );
          }
        } catch (err) {
          log.warn(
            { err, docId: doc.id, profileId: input.profileId },
            "[deleteGuestCustomer] R2 delete failed, continuing with DB delete",
          );
        }
      }

      // Count rows for the audit trail BEFORE deleting.
      const [interactionCountRow] = await drizzleDb
        .select({ n: sql<number>`COUNT(*)` })
        .from(customerInteractions)
        .where(eq(customerInteractions.customerProfileId, input.profileId));
      const [chatCountRow] = await drizzleDb
        .select({ n: sql<number>`COUNT(*)` })
        .from(customerChatMessages)
        .where(eq(customerChatMessages.customerProfileId, input.profileId));

      await drizzleDb
        .delete(customerInteractions)
        .where(eq(customerInteractions.customerProfileId, input.profileId));
      await drizzleDb
        .delete(customerChatMessages)
        .where(eq(customerChatMessages.customerProfileId, input.profileId));
      await drizzleDb
        .delete(customerDocuments)
        .where(eq(customerDocuments.customerProfileId, input.profileId));
      await drizzleDb
        .delete(customerProfiles)
        .where(eq(customerProfiles.id, input.profileId));

      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "admin.customers.deleteGuest",
        targetType: "customerProfile",
        targetId: input.profileId,
        changes: {
          email: profile?.email ?? null,
          phone: profile?.phone ?? null,
          name: profile?.name ?? null,
          interactions: Number(interactionCountRow?.n ?? 0),
          chatMessages: Number(chatCountRow?.n ?? 0),
          documents: docs.length,
        },
      });

      return { ok: true };
    }),

  /**
   * setFollowUpDate (Q4-A) — set OR clear a customer's manual follow-up date.
   * `followUpDate` is a "YYYY-MM-DD" calendar day (null = clear). When set and
   * due (<= today, America/Los_Angeles) the cockpit raises「今天該跟進」. Mirrors
   * markNotCustomer's upsert-by-userId / direct-by-profileId resolution so a
   * registered customer with no profile row yet gets one created.
   */
  setFollowUpDate: adminProcedure
    .input(
      z.union([
        z
          .object({
            userId: z.number().int().positive(),
            followUpDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .nullable(),
          })
          .strict(),
        z
          .object({
            profileId: z.number().int().positive(),
            followUpDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .nullable(),
          })
          .strict(),
      ]),
    )
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles } = await import("../../drizzle/schema");
      const value = input.followUpDate; // string | null
      // Guest path: the profileId IS the customerProfiles row — update directly.
      if ("profileId" in input) {
        await drizzleDb
          .update(customerProfiles)
          .set({ followUpDate: value })
          .where(eq(customerProfiles.id, input.profileId));
        return { ok: true, followUpDate: value };
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
          .set({ followUpDate: value })
          .where(eq(customerProfiles.id, existing[0].id));
      } else {
        await drizzleDb
          .insert(customerProfiles)
          .values({ userId: input.userId, followUpDate: value });
      }
      return { ok: true, followUpDate: value };
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
   * extractCustomerFromFile — Jeff drops a PDF / image / text file (a name card,
   * a forwarded itinerary, a WeChat screenshot) and we「搬運」the customer's
   * name / email / phone out of it so the add-customer modal pre-fills. This is
   * EXTRACTION ONLY — it never writes a customer row (the modal still confirms
   * and calls createManualCustomer). Per the admin AI boundary: AI only carries
   * facts that are literally in the document, never invents.
   *
   * Pipeline: base64 → Buffer (size-guarded) → parseAttachment (the existing
   * PDF/OCR/xlsx/docx/… parser, NOT reimplemented) → Haiku extraction with an
   * anti-fabrication system prompt + structured output. Never throws on a bad
   * file: every failure path returns { ok:false, reason } so the modal can show
   * a clean message and let Jeff type the fields by hand.
   */
  extractCustomerFromFile: adminProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        mimeType: z.string().max(200),
        dataBase64: z.string().min(1),
      }),
    )
    .mutation(
      async ({
        input,
      }): Promise<
        | {
            ok: true;
            extracted: { name: string; email: string | null; phone: string | null };
            sourceText: string;
            parseStatus: string;
          }
        | { ok: false; reason: string }
      > => {
        // 1. Decode + size guard (never throw on a bad/huge file).
        let buffer: Buffer;
        try {
          buffer = Buffer.from(input.dataBase64, "base64");
        } catch {
          return { ok: false, reason: "decode_failed" };
        }
        if (isIntakeTooLarge(buffer.length)) {
          return { ok: false, reason: "too_large" };
        }

        // 2. Parse to text via the EXISTING attachment parser (PDF + scanned-PDF
        //    vision fallback, image OCR, text/csv/json/html/xlsx/docx). We do not
        //    reimplement any of it.
        let parsed: Awaited<
          ReturnType<typeof import("../_core/attachmentParser").parseAttachment>
        >;
        try {
          const { parseAttachment } = await import("../_core/attachmentParser");
          parsed = await parseAttachment(input.filename, input.mimeType, buffer);
        } catch (err) {
          log.warn(
            { err, filename: input.filename },
            "extractCustomerFromFile: parse threw",
          );
          return { ok: false, reason: "parse_error" };
        }

        const text = parsed.text ?? "";
        // 3. Bounce anything not cleanly readable (unsupported / empty / errored /
        //    whitespace-only) — there is nothing to extract from.
        if (
          (parsed.parseStatus !== "ok" && parsed.parseStatus !== "ok_truncated") ||
          text.trim().length === 0
        ) {
          return { ok: false, reason: parsed.parseStatus };
        }

        // An unreadable image still comes back as parseStatus:"ok" carrying a
        // placeholder sentinel (attachmentParser falls back rather than bounce
        // on OCR failure). Treat that as unreadable so the user gets the
        // friendly "讀不出這個檔案" notice instead of three silently-empty fields.
        if (text.startsWith("[圖片附件 / image attachment:")) {
          return { ok: false, reason: "parse_error" };
        }

        // 4. Extract fields via Haiku (cheap). The system prompt is anti-
        //    fabrication: 只「搬運」文件裡真的有的,沒有就留空,絕不編造。
        //    invokeLLM param-name gotcha (see customerPreferenceExtractor): the
        //    system prompt MUST be a role:"system" message inside `messages`
        //    (a top-level `system`/`_system` field is ignored), model goes in
        //    `model`, structured output in `outputSchema:{name,schema}`.
        const EXTRACT_SYSTEM = `你從文件文字中「搬運」出客人的姓名、email、電話。

【絕對鐵律 — 不可編造】
- 只抄文件裡真的有的;文件沒有的就留空字串,絕對不要編造、推測或填入範例值。
- 姓名可能是中文或英文,逐字照抄文件裡寫的。
- email 與電話要逐字照抄,不要改格式、不要補區碼、不要猜。
- 找不到某個欄位就把它留成空字串 ""。寧可少寫,不可亂寫。

只輸出這三個欄位:name、email、phone。`;

        const userMessage = `以下是文件文字,請從中搬運客人的姓名、email、電話(沒有的留空字串):

${text.slice(0, MAX_EXTRACT_TEXT_CHARS)}`;

        let raw: { name?: string; email?: string; phone?: string };
        try {
          const { invokeLLM } = await import("../_core/llm");
          const result = await invokeLLM({
            model: "claude-haiku-4-5",
            messages: [
              { role: "system", content: EXTRACT_SYSTEM },
              { role: "user", content: userMessage },
            ],
            maxTokens: 500,
            outputSchema: {
              name: "extracted_customer",
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  email: { type: "string" },
                  phone: { type: "string" },
                },
                required: ["name"],
              },
            },
          });
          const content =
            result.choices?.[0]?.message?.content ??
            result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ??
            "";
          raw =
            typeof content === "string" && content
              ? JSON.parse(content)
              : (content as { name?: string; email?: string; phone?: string });
        } catch (err) {
          log.warn(
            { err, filename: input.filename },
            "extractCustomerFromFile: LLM extraction failed",
          );
          return { ok: false, reason: "extract_failed" };
        }

        // 5. Normalize (trim; empty email/phone → null; missing name → "").
        const extracted = normalizeExtractedCustomer(raw);
        return {
          ok: true,
          extracted,
          sourceText: text.slice(0, 4000),
          parseStatus: parsed.parseStatus,
        };
      },
    ),

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
          // customer-unread (0108) — 來訊未讀紅點的兩根指針。
          lastInboundAt: customerProfiles.lastInboundAt,
          jeffViewedAt: customerProfiles.jeffViewedAt,
          // 需跟進: an unanswered inquiry (by this profile's email) older than 2d.
          needsFollowup: sql<number>`EXISTS (SELECT 1 FROM ${inquiriesTable}
            WHERE ${inquiriesTable.customerEmail} = ${customerProfiles.email}
              AND ${inquiriesTable.status} IN ('new','in_progress')
              AND ${inquiriesTable.createdAt} < (NOW() - INTERVAL 2 DAY))`,
          // 紅點: unread agent messages filed against this guest's profile (the
          // profileId IS the customerProfiles row), same readByJeff=0 signal.
          unread: sql<number>`(SELECT COUNT(*) FROM ${agentMessages} WHERE ${agentMessages.relatedCustomerProfileId} = ${customerProfiles.id} AND ${agentMessages.readByJeff} = 0)`,
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
      const withFlags = rows.map(
        ({ status, needsFollowup, unread, lastInboundAt, jeffViewedAt, ...r }) => ({
          ...r,
          blocked: status === "blocked",
          needsFollowup: Number(needsFollowup) === 1,
          unread: Number(unread),
          // customer-unread (0108) — 客人來訊 Jeff 還沒看(名字粗體 + 頭像紅點)。
          unreadInbound: isUnreadInbound(lastInboundAt ?? null, jeffViewedAt ?? null),
        }),
      );
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
          source: customerProfiles.source,
          followUpDate: customerProfiles.followUpDate,
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
          source: null,
          followUpDate: null,
          hasPassport: false,
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
      const hasPassport = await hasPassportOnFile(drizzleDb, {
        profileId: profile.id,
        email: profile.email,
      });
      return {
        profileId: profile.id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        source: profile.source,
        followUpDate: profile.followUpDate,
        hasPassport,
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
        customerProfiles,
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

      // Q4-A — the customer's manual follow-up date (customerProfiles, 1:1 by
      // userId). "YYYY-MM-DD" string (date mode) or null when none set / no profile.
      const [profileRow] = await drizzleDb
        .select({ followUpDate: customerProfiles.followUpDate })
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, input.userId))
        .limit(1);

      return {
        user: { ...user, totalSpend },
        followUpDate: profileRow?.followUpDate ?? null,
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
            // customer-projects (0104) — scope to one project; omitted → the
            //「未分類」basket (customOrderId IS NULL).
            orderId: z.number().int().positive().optional(),
          })
          .strict(),
        z
          .object({
            profileId: z.number().int().positive(),
            limit: z.number().int().min(1).max(200).optional(),
            orderId: z.number().int().positive().optional(),
          })
          .strict(),
      ]),
    )
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerChatMessages } = await import("../../drizzle/schema");
      const customerScope =
        "userId" in input
          ? eq(customerChatMessages.customerUserId, input.userId)
          : eq(customerChatMessages.customerProfileId, input.profileId);
      const where = and(
        customerScope,
        input.orderId !== undefined
          ? eq(customerChatMessages.customOrderId, input.orderId)
          : isNull(customerChatMessages.customOrderId),
      );
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
        // id tiebreak: jeff+agent of one turn now co-persist in the same
        // createdAt second (orphan-fix), so order by id too to keep jeff-before
        // -agent deterministically (else a same-second tie could invert them).
        .orderBy(desc(customerChatMessages.createdAt), desc(customerChatMessages.id))
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
        customerInteractions,
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

      // Newest real message in this customer's conversation. A draft older than
      // this is STALE (Jeff replied, or the customer wrote again) and must be
      // hidden — see isDraftCurrent. Email channel only (the actual back-and-forth).
      let latestMsgAt: Date | null = null;
      if (profileIds.length > 0) {
        const [row] = await drizzleDb
          .select({ m: sql<string | null>`max(${customerInteractions.createdAt})` })
          .from(customerInteractions)
          .where(
            and(
              inArray(customerInteractions.customerProfileId, profileIds),
              eq(customerInteractions.channel, "email"),
            ),
          );
        latestMsgAt = row?.m ? new Date(row.m) : null;
      }

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

      // ── Source 3: Gmail NON-escalated drafts — agentMessages (messageType=
      // observation). This is where the pipeline stores "AI 準備發、還沒發" replies
      // (sendOutcome would_auto_send / plain draft); observationDraftCard drops
      // the already-sent (auto_replied) ones. Same customer key + send path as
      // escalation. (Was missing in Batch 2 — only escalations were surfaced.)
      let obsCards: ReturnType<typeof observationDraftCard>[] = [];
      if (profileIds.length > 0) {
        const obsRows = await drizzleDb
          .select({
            id: agentMessages.id,
            context: agentMessages.context,
            createdAt: agentMessages.createdAt,
          })
          .from(agentMessages)
          .where(
            and(
              eq(agentMessages.messageType, "observation"),
              eq(agentMessages.readByJeff, 0),
              inArray(agentMessages.relatedCustomerProfileId, profileIds),
            ),
          )
          .orderBy(desc(agentMessages.createdAt))
          .limit(50);
        obsCards = obsRows.map((r) =>
          observationDraftCard({ ...r, fallbackEmail }),
        );
      }

      // 一個客人同時只留最新一張草稿卡(2026-07-02 leslie 疊卡 repro)。
      return onlyNewestDraft(
        mergeDrafts([
          inquiryCards.filter((c): c is NonNullable<typeof c> => c != null),
          emailCards.filter((c): c is NonNullable<typeof c> => c != null),
          obsCards.filter((c): c is NonNullable<typeof c> => c != null),
        ]).filter((c) => isDraftCurrent(c.createdAt, latestMsgAt)),
      );
    }),

  customerConversationThread: adminProcedure
    .input(
      z.union([
        z
          .object({
            userId: z.number().int().positive(),
            limit: z.number().int().min(1).max(200).optional(),
            // customer-projects (0104) — three views:
            //   orderId set     → that project only (inquiries hidden, they
            //                     predate any order).
            //   unfiledOnly     → the「未分類」basket (customOrderId IS NULL) +
            //                     inquiries.
            //   neither         → customer-wide ALL (every interaction +
            //                     inquiries) — Overview / 真相條 / followup read
            //                     this, so it must stay whole.
            orderId: z.number().int().positive().optional(),
            unfiledOnly: z.boolean().optional(),
          })
          .strict(),
        z
          .object({
            profileId: z.number().int().positive(),
            limit: z.number().int().min(1).max(200).optional(),
            orderId: z.number().int().positive().optional(),
            unfiledOnly: z.boolean().optional(),
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
      // customer-projects (0104) — which of the three views applies (pure,
      // unit-tested in adminCustomersThread.ts).
      const scope = resolveConversationThreadScope(input);

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
      // Skipped entirely in a project-scoped view (first contact isn't an order).
      const inquiryWhere = !includesInquiries(scope)
        ? null
        : isRegistered
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
        // customer-projects (0104) — three views (see input schema):
        //   project (orderId) → that order; 未分類 (unfiledOnly) → IS NULL;
        //   neither → no customOrderId filter (customer-wide ALL).
        const conds = [
          inArray(customerInteractions.customerProfileId, profileIds),
          sql`NOT (COALESCE(${customerInteractions.classification}, '') = 'spam' AND COALESCE(${customerInteractions.spamVerdict}, '') != 'rescued')`,
        ];
        if (scope.mode === "project") {
          conds.push(eq(customerInteractions.customOrderId, scope.orderId));
        } else if (scope.mode === "unfiled") {
          conds.push(isNull(customerInteractions.customOrderId));
        }
        const interactions = await drizzleDb
          .select({
            id: customerInteractions.id,
            direction: customerInteractions.direction,
            content: customerInteractions.content,
            createdAt: customerInteractions.createdAt,
            gmailThreadId: customerInteractions.gmailThreadId,
            customOrderId: customerInteractions.customOrderId,
          })
          .from(customerInteractions)
          .where(and(...conds))
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
          // 來源 — only 'manual' (Jeff hand-added) is ever stored; else NULL.
          source: customerProfiles.source,
          // Resolve-only (stripped before return) — feed the passport presence
          // check by profileId + email so a scan / logged-out visa app counts.
          _profileId: customerProfiles.id,
          _email: customerProfiles.email,
        })
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, input.userId))
        .limit(1);
      if (!row) return null;
      const { _profileId, _email, ...profile } = row;
      const hasPassport = await hasPassportOnFile(drizzleDb, {
        userId: input.userId,
        profileId: _profileId,
        email: _email,
      });
      return { ...profile, hasPassport };
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
      // Assembly + identity-resolution + leak guards live in the shared loader
      // (server/_core/customerDocsLoader.ts) so the customer-AI engine reads the
      // exact same documents. signUrls=true → uploaded docs get a signed
      // download link for the browser list.
      return loadCustomerDocs(input, { signUrls: true });
    }),

  /**
   * customerAiSummary (批3 m3) — read the cached AI summary for the card. Fast
   * (no LLM): returns the four-field business summary + when it was generated +
   * whether it's stale (never computed / >24h / newer activity since). The card
   * shows the cache instantly and lazily triggers a refresh when stale.
   */
  customerAiSummary: adminProcedure
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .query(async ({ input }) => {
      return readCachedSummary(input);
    }),

  /**
   * refreshCustomerAiSummary (批3 m3) — the 重新整理 button + lazy-on-open. Runs
   * the Haiku engine over this customer's real data and stores the result. Read-
   * only w.r.t. the customer (only writes the summary cache). adminProcedure auto
   * rate-limits (60/min/admin), so a refresh-spam can't burn LLM credit.
   */
  refreshCustomerAiSummary: adminProcedure
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .mutation(async ({ input }) => {
      return refreshAndStoreSummary(input);
    }),

  customerLearnedPreferences: adminProcedure
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles, customerInteractions } = await import(
        "../../drizzle/schema"
      );
      const pidCond =
        "userId" in input
          ? eq(customerProfiles.userId, input.userId)
          : eq(customerProfiles.id, input.profileId);
      const [row] = await drizzleDb
        .select({
          id: customerProfiles.id,
          aiNotes: customerProfiles.aiNotes,
          keyFacts: customerProfiles.keyFacts,
          preferences: customerProfiles.preferences,
        })
        .from(customerProfiles)
        .where(pidCond)
        .limit(1);
      if (!row) return { aiNotes: null, keyFacts: null, preferences: null, extracting: false };

      const hasData = row.aiNotes || row.keyFacts || row.preferences;
      if (hasData) {
        return {
          aiNotes: row.aiNotes as string | null,
          keyFacts: row.keyFacts as string | null,
          preferences: row.preferences as Record<string, unknown> | null,
          extracting: false,
        };
      }

      if (extractionInflight.has(row.id)) {
        return { aiNotes: null, keyFacts: null, preferences: null, extracting: true };
      }

      const [countRow] = await drizzleDb
        .select({ c: sql<number>`count(*)` })
        .from(customerInteractions)
        .where(eq(customerInteractions.customerProfileId, row.id));
      const interactionCount = Number(countRow?.c ?? 0);
      if (interactionCount === 0) {
        return { aiNotes: null, keyFacts: null, preferences: null, extracting: false };
      }

      extractionInflight.add(row.id);
      import("../_core/customerPreferenceExtractor")
        .then(({ extractAfterReply }) => extractAfterReply(row.id))
        .catch(() => {})
        .finally(() => extractionInflight.delete(row.id));

      return { aiNotes: null, keyFacts: null, preferences: null, extracting: true };
    }),

  // customer-projects — per-project 客人理解 for 報價/訂製/包團 (category='quote').
  // On-the-fly, NO storage (Jeff「一人後台要簡單」): compute the understanding for
  // THIS trip from its filed conversation and return it directly; the client caches
  // it (staleTime) so a re-open doesn't recompute. We re-check category='quote'
  // here so a non-quote orderId can never spend an Opus call even if mis-asked, and
  // extractProjectUnderstanding itself returns null (no LLM) when the project has no
  // filed conversation yet.
  customerProjectUnderstanding: adminProcedure
    .input(z.object({ orderId: z.number().int().positive() }).strict())
    .query(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return { aiNotes: null, keyFacts: null, preferences: null };
      const { customOrders } = await import("../../drizzle/schema");
      const [order] = await drizzleDb
        .select({ category: customOrders.category })
        .from(customOrders)
        .where(eq(customOrders.id, input.orderId))
        .limit(1);
      if (!order || order.category !== "quote") {
        return { aiNotes: null, keyFacts: null, preferences: null };
      }
      const { extractProjectUnderstanding } = await import(
        "../_core/customerPreferenceExtractor"
      );
      const r = await extractProjectUnderstanding(input.orderId);
      return {
        aiNotes: r?.aiNotes || null,
        keyFacts: r?.keyFacts || null,
        preferences: (r?.preferences ?? null) as Record<string, unknown> | null,
      };
    }),

  triggerPreferenceExtraction: adminProcedure
    .input(
      z.union([
        z.object({ userId: z.number().int().positive() }).strict(),
        z.object({ profileId: z.number().int().positive() }).strict(),
      ]),
    )
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { customerProfiles } = await import("../../drizzle/schema");
      const pidCond =
        "userId" in input
          ? eq(customerProfiles.userId, input.userId)
          : eq(customerProfiles.id, input.profileId);
      const [row] = await drizzleDb
        .select({ id: customerProfiles.id })
        .from(customerProfiles)
        .where(pidCond)
        .limit(1);
      if (!row) return { triggered: false };
      const { extractAfterReply } = await import(
        "../_core/customerPreferenceExtractor"
      );
      await extractAfterReply(row.id);
      return { triggered: true };
    }),
});
