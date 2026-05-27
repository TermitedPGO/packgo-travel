/**
 * server/db.ts — Drizzle DB access layer.
 *
 * Post v2 Wave 2 refactor (2026-05-21): the original 3,629-LOC monolith
 * is split into 5 domain modules under `server/db/`:
 *
 *   booking.ts     — bookings + bookingParticipants + payments CRUD (Module 2.1)
 *   tour.ts        — tours + tourDepartures + searchTours + calibration (Module 2.2)
 *   user.ts        — users + auth + favorites + browsing history (Module 2.3)
 *   search.ts      — imageLibrary + destinations + competitor + price comparisons (Module 2.6)
 *   accounting.ts  — accountingEntries + invoices + recurringExpenses + aiQuotes +
 *                    marketingCampaigns + marketingMaterials + emailSendLogs (Module 2.7)
 *
 * Modules 2.4 (payment) + 2.5 (log) were no-ops — voucher / packpoint /
 * refund helpers live in `server/_core/voucherDb.ts`/`packpointDb.ts`/
 * `refundDb.ts`; auditLog lives in `server/_core/auditLog.ts`. These
 * domains were already extracted before the v2 plan landed.
 *
 * This file (`db.ts`) keeps:
 *   1. `getDb()` lazy MySQL pool factory (entry point for the split files)
 *   2. `DrizzleTx` type export (shared transaction handle)
 *   3. Residual helpers that don't fit the 5 split domains:
 *        - newsletter subscribers (incl. getActiveSubscribers/getSubscriberCount
 *          used by marketingWorker — keep co-located with subscriber CRUD)
 *        - visa applications + visa status history (incl. passport encryption)
 *        - inquiries + inquiryMessages
 *        - affiliate click tracking
 *
 * To add a new query helper:
 *   - If it belongs to one of the 5 split domains, add it to that domain file.
 *   - If it's a brand-new domain that doesn't fit, add it here AND open a
 *     v3 backlog ticket to evaluate whether a new domain file is warranted.
 *
 * Audit ref: v2-audit-2026-05-19.md §C; D2 lock (v2-plan.md lines 139-160).
 */

import { eq, and, gte, desc, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql2 from "mysql2";
import {
  inquiries, InsertInquiry, Inquiry,
  inquiryMessages, InsertInquiryMessage, InquiryMessage,
  newsletterSubscribers, InsertNewsletterSubscriber, NewsletterSubscriber,
  visaApplications, VisaApplication, InsertVisaApplication,
  visaStatusHistory, VisaStatusHistory,
  affiliateClicks, AffiliateClick, InsertAffiliateClick,
} from "../drizzle/schema";
import { decryptVisaApplicationRow, encryptPassport } from './_core/passportEncryption';

// ─── Passport-at-rest encryption (v2 Wave 1 · Module 1.8) ────────────────
// `passportNumber` on `bookingParticipants` + `visaApplications` is
// encrypted before insert/update and decrypted on read so a hypothetical
// DB dump no longer exposes raw passport numbers. Uses the same
// AES-256-GCM envelope as Gmail + Plaid tokens via
// server/_core/tokenCrypto.ts. `decryptToken` returns plaintext as-is
// when the `enc:v1:` prefix is absent, so legacy rows keep working
// until server/scripts/backfill-passport-encryption.ts re-encrypts them.
//
// CRITICAL: every read/write touching `passportNumber` in this file MUST
// flow through helpers from server/_core/passportEncryption.ts. Direct
// `db.insert(...).values({passportNumber})` or returning a row without
// `decryptParticipantRow` / `decryptVisaApplicationRow` leaks plaintext.

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Drizzle transaction handle.
 *
 * Phase 2 (2026-05-18): money-path helpers (createPayment, updateBooking,
 * updatePaymentStatus, createAccountingEntry) now accept an optional `tx`
 * so the stripe-webhook handlers can wrap multi-write sequences in a
 * single `db.transaction(async (tx) => …)` for atomicity.
 *
 * The exported type is intentionally Parameters<…>[0] of the transaction
 * callback so call sites stay forward-compatible with Drizzle internals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleTx = any;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // Use mysql2 pool with explicit timeouts to prevent hanging queries
      const pool = mysql2.createPool({
        uri: process.env.DATABASE_URL,
        connectionLimit: 10,
        connectTimeout: 10000,       // 10s to establish connection
        waitForConnections: true,
        queueLimit: 20,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _db = drizzle(pool.promise() as any);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// === v2 Wave 2 — domain extractions (D2-locked 5-file split) ===
// See server/db/booking.ts (Module 2.1, 13 fns), server/db/tour.ts
// (Module 2.2, 22 exports), server/db/user.ts (Module 2.3, 26 fns),
// server/db/search.ts (Module 2.6, 39 fns: imageLibrary + homepageContent
// + destinations + competitor monitoring + tour price comparisons),
// and server/db/accounting.ts (Module 2.7, 33 fns: accountingEntries +
// invoices + recurringExpenses + aiQuotes + marketingCampaigns +
// marketingMaterials + emailSendLogs).
// Modules 2.4 (payment) + 2.5 (log) were no-ops because voucher /
// packpoint / refund / auditLog already lived in server/_core/.
// These shims re-export the extracted helpers so existing
// `import { createBooking } from "../db"` call sites across ~40
// routers + agents + services keep working unchanged.
export * from "./db/booking";
export * from "./db/tour";
export * from "./db/user";
export * from "./db/search";
export * from "./db/accounting";

// ============================================
// Inquiry Management Functions (residual — own domain)
// ============================================

/**
 * Get all inquiries with optional filtering
 */
export async function getAllInquiries(filters?: {
  status?: string;
  inquiryType?: string;
  assignedTo?: number;
  userId?: number;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get inquiries: database not available");
    return [];
  }

  let query = db.select().from(inquiries);
  
  // Apply userId filter if provided
  if (filters?.userId) {
    query = query.where(eq(inquiries.userId, filters.userId)) as any;
  }
  
  const result = await query;
  return result;
}

/**
 * Get a single inquiry by ID
 */
export async function getInquiryById(id: number): Promise<Inquiry | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get inquiry: database not available");
    return undefined;
  }

  const result = await db.select().from(inquiries).where(eq(inquiries.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new inquiry
 */
export async function createInquiry(inquiry: InsertInquiry): Promise<Inquiry> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(inquiries).values(inquiry);
  const insertId = Number(result[0].insertId);
  
  const newInquiry = await getInquiryById(insertId);
  if (!newInquiry) {
    throw new Error("Failed to retrieve created inquiry");
  }
  
  return newInquiry;
}

/**
 * Update an existing inquiry
 */
export async function updateInquiry(id: number, updates: Partial<InsertInquiry>): Promise<Inquiry> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(inquiries).set(updates).where(eq(inquiries.id, id));
  
  const updatedInquiry = await getInquiryById(id);
  if (!updatedInquiry) {
    throw new Error("Failed to retrieve updated inquiry");
  }
  
  return updatedInquiry;
}

/**
 * Get all messages for an inquiry
 */
export async function getInquiryMessages(inquiryId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get inquiry messages: database not available");
    return [];
  }

  const result = await db.select().from(inquiryMessages).where(eq(inquiryMessages.inquiryId, inquiryId));
  return result;
}

/**
 * Create a new inquiry message
 */
export async function createInquiryMessage(message: InsertInquiryMessage): Promise<InquiryMessage> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(inquiryMessages).values(message);
  const insertId = Number(result[0].insertId);
  
  const messages = await db.select().from(inquiryMessages).where(eq(inquiryMessages.id, insertId)).limit(1);
  if (messages.length === 0) {
    throw new Error("Failed to retrieve created message");
  }
  
  return messages[0];
}

// ============================================================================
// Newsletter Subscribers (residual — own domain)
// ============================================================================

// Create newsletter subscriber
export async function createNewsletterSubscriber(
  data: InsertNewsletterSubscriber
): Promise<NewsletterSubscriber> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const [result] = await db
    .insert(newsletterSubscribers)
    .values(data);

  const [subscriber] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.id, Number(result.insertId)))
    .limit(1);

  return subscriber;
}

// Get all newsletter subscribers (active only — used by public endpoints)
export async function getAllNewsletterSubscribers(): Promise<NewsletterSubscriber[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  return await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, "active"))
    .orderBy(desc(newsletterSubscribers.subscribedAt));
}

// Get all newsletter subscribers including unsubscribed (admin use)
export async function getAllNewsletterSubscribersIncludingUnsubscribed(): Promise<NewsletterSubscriber[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  return await db
    .select()
    .from(newsletterSubscribers)
    .orderBy(desc(newsletterSubscribers.subscribedAt));
}

// Unsubscribe from newsletter
export async function unsubscribeNewsletter(email: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(newsletterSubscribers)
    .set({
      status: "unsubscribed",
      unsubscribedAt: new Date(),
    })
    .where(eq(newsletterSubscribers.email, email));
}


// Get newsletter subscriber by email
export async function getNewsletterSubscriberByEmail(email: string): Promise<NewsletterSubscriber | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [subscriber] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1);
  return subscriber ?? null;
}

// Re-subscribe a previously unsubscribed email
export async function resubscribeNewsletter(email: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(newsletterSubscribers)
    .set({ status: "active", unsubscribedAt: null })
    .where(eq(newsletterSubscribers.email, email));
}

// ── Newsletter Subscribers — read helpers used by marketingWorker ────

export async function getActiveSubscribers(): Promise<{ email: string }[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ email: newsletterSubscribers.email })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, 'active'));
}

export async function getSubscriberCount(): Promise<{ total: number; active: number }> {
  const db = await getDb();
  if (!db) return { total: 0, active: 0 };
  const [totalResult, activeResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(newsletterSubscribers),
    db.select({ count: sql<number>`count(*)` }).from(newsletterSubscribers).where(eq(newsletterSubscribers.status, 'active')),
  ]);
  return {
    total: Number(totalResult[0]?.count ?? 0),
    active: Number(activeResult[0]?.count ?? 0),
  };
}

// ══════════════════════════════════════════════════════════════
// PHASE 6: 中國簽證代辦 DB 函數
// ══════════════════════════════════════════════════════════════

// ── 建立申請 ──────────────────────────────────────────────────
export async function createVisaApplication(
  data: InsertVisaApplication
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // v2 Module 1.8: encrypt passportNumber before insert. visaApplications
  // .passportNumber is NOT NULL, so we always have a value to encrypt.
  const toInsert: InsertVisaApplication = {
    ...data,
    passportNumber: encryptPassport(data.passportNumber),
  };
  const result = await db.insert(visaApplications).values(toInsert);
  return (result[0] as { insertId: number }).insertId;
}

// ── 查詢單筆申請 ──────────────────────────────────────────────
/**
 * Phase 2 (2026-05-18): accepts an optional `tx` so visa-payment webhook
 * handlers can read the application row inside the same transaction that
 * later writes payment info, status, and the accounting entry. Reading
 * via the tx handle guarantees the row hasn't been mutated by another
 * concurrent writer between READ and WRITE inside the same tx scope.
 */
export async function getVisaApplicationById(
  id: number,
  tx?: DrizzleTx,
): Promise<VisaApplication | null> {
  const db = await getDb();
  if (!db) return null;
  const reader = tx ?? db;
  const result = await reader
    .select()
    .from(visaApplications)
    .where(eq(visaApplications.id, id))
    .limit(1);
  // v2 Module 1.8: decrypt passportNumber on the way out so admin UI,
  // visa email service, Stripe webhook, and applicant status page all
  // see plaintext transparently.
  return result[0] ? decryptVisaApplicationRow(result[0]) : null;
}

// ── 依 Stripe Session 查詢 ────────────────────────────────────
export async function getVisaApplicationByStripeSession(
  sessionId: string
): Promise<VisaApplication | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(visaApplications)
    .where(eq(visaApplications.stripeCheckoutSessionId, sessionId))
    .limit(1);
  // v2 Module 1.8: decrypt passportNumber on the way out.
  return result[0] ? decryptVisaApplicationRow(result[0]) : null;
}

// ── 查詢所有申請（Admin）────────────────────────────────────
export async function getAllVisaApplications(filters?: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ applications: VisaApplication[]; total: number }> {
  const db = await getDb();
  if (!db) return { applications: [], total: 0 };

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(visaApplications.applicationStatus, filters.status as VisaApplication["applicationStatus"]));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [applications, countResult] = await Promise.all([
    db
      .select()
      .from(visaApplications)
      .where(whereClause)
      .orderBy(desc(visaApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(visaApplications)
      .where(whereClause),
  ]);

  return {
    // v2 Module 1.8: decrypt passportNumber on the way out for every row.
    applications: applications.map((row) => decryptVisaApplicationRow(row)),
    total: Number(countResult[0]?.count ?? 0),
  };
}

// ── 更新申請狀態 ──────────────────────────────────────────────
/**
 * Phase 2 (2026-05-18): accepts an optional `tx`. When supplied, both the
 * status UPDATE and the `visaStatusHistory` INSERT run inside the same
 * transaction so a status flip without an audit-history row is impossible.
 * The current-status read also flows through the tx handle to see any
 * uncommitted writes made earlier inside the same transaction.
 */
export async function updateVisaApplicationStatus(
  id: number,
  newStatus: VisaApplication["applicationStatus"],
  changedBy?: number,
  note?: string,
  tx?: DrizzleTx,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const writer = tx ?? db;
  const current = await getVisaApplicationById(id, tx);
  const fromStatus = current?.applicationStatus ?? null;

  await writer
    .update(visaApplications)
    .set({ applicationStatus: newStatus })
    .where(eq(visaApplications.id, id));

  // 記錄狀態歷程
  await writer.insert(visaStatusHistory).values({
    applicationId: id,
    fromStatus: fromStatus ?? undefined,
    toStatus: newStatus,
    changedBy,
    note,
  });
}

// ── 更新付款資訊 ──────────────────────────────────────────────
/**
 * Phase 2 (2026-05-18): accepts an optional `tx` so the visa-payment
 * webhook handler can co-locate this UPDATE with the application-status
 * flip and the accounting income entry under a single atomic transaction.
 */
export async function updateVisaPaymentInfo(
  id: number,
  data: {
    paymentStatus: VisaApplication["paymentStatus"];
    stripePaymentIntentId?: string;
    stripeCheckoutSessionId?: string;
    paidAt?: Date;
  },
  tx?: DrizzleTx,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const writer = tx ?? db;
  await writer
    .update(visaApplications)
    .set(data)
    .where(eq(visaApplications.id, id));
}

// ── 更新 Admin 備註 ───────────────────────────────────────────
export async function updateVisaAdminNotes(
  id: number,
  adminNotes: string,
  trackingNumber?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(visaApplications)
    .set({ adminNotes, ...(trackingNumber ? { trackingNumber } : {}) })
    .where(eq(visaApplications.id, id));
}

// ── 查詢狀態歷程 ──────────────────────────────────────────────
export async function getVisaStatusHistory(
  applicationId: number
): Promise<VisaStatusHistory[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(visaStatusHistory)
    .where(eq(visaStatusHistory.applicationId, applicationId))
    .orderBy(desc(visaStatusHistory.createdAt));
}

// ── 統計資料（Admin Dashboard）────────────────────────────────
export async function getVisaStats(): Promise<{
  total: number;
  pending: number;
  processing: number;
  approved: number;
  rejected: number;
  totalRevenue: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, pending: 0, processing: 0, approved: 0, rejected: 0, totalRevenue: 0 };

  const [totalResult, pendingResult, processingResult, approvedResult, rejectedResult, revenueResult] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(visaApplications),
      db
        .select({ count: sql<number>`count(*)` })
        .from(visaApplications)
        .where(inArray(visaApplications.applicationStatus, ["submitted", "paid", "documents_received"])),
      db
        .select({ count: sql<number>`count(*)` })
        .from(visaApplications)
        .where(eq(visaApplications.applicationStatus, "processing")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(visaApplications)
        .where(inArray(visaApplications.applicationStatus, ["approved", "completed"])),
      db
        .select({ count: sql<number>`count(*)` })
        .from(visaApplications)
        .where(eq(visaApplications.applicationStatus, "rejected")),
      db
        .select({ total: sql<number>`sum(totalAmount)` })
        .from(visaApplications)
        .where(eq(visaApplications.paymentStatus, "paid")),
    ]);

  return {
    total: Number(totalResult[0]?.count ?? 0),
    pending: Number(pendingResult[0]?.count ?? 0),
    processing: Number(processingResult[0]?.count ?? 0),
    approved: Number(approvedResult[0]?.count ?? 0),
    rejected: Number(rejectedResult[0]?.count ?? 0),
    totalRevenue: Number(revenueResult[0]?.total ?? 0),
  };
}

// ============================================
// Affiliate Click Tracking Functions (residual — own domain)
// ============================================

export async function createAffiliateClick(data: InsertAffiliateClick): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create affiliate click: database not available");
    return;
  }
  await db.insert(affiliateClicks).values(data);
}

export async function getAffiliateClicks(filters?: {
  platform?: string;
  limit?: number;
}): Promise<AffiliateClick[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.platform) {
    conditions.push(eq(affiliateClicks.platform, filters.platform as AffiliateClick["platform"]));
  }

  const query = db.select().from(affiliateClicks);
  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(affiliateClicks.createdAt)).limit(filters?.limit ?? 100);
  }
  return query.orderBy(desc(affiliateClicks.createdAt)).limit(filters?.limit ?? 100);
}

export async function getAffiliateStats(days: number): Promise<{
  totalClicks: number;
  byPlatform: Record<string, number>;
  byDay: Array<{ date: string; clicks: number }>;
  topReferrers: Array<{ page: string; clicks: number }>;
}> {
  const db = await getDb();
  if (!db) return { totalClicks: 0, byPlatform: {}, byDay: [], topReferrers: [] };

  const since = new Date();
  since.setDate(since.getDate() - days);

  const [totalResult, platformResult, dayResult, referrerResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(affiliateClicks)
      .where(gte(affiliateClicks.createdAt, since)),
    db.select({
      platform: affiliateClicks.platform,
      count: sql<number>`count(*)`,
    })
      .from(affiliateClicks)
      .where(gte(affiliateClicks.createdAt, since))
      .groupBy(affiliateClicks.platform),
    db.select({
      date: sql<string>`DATE(createdAt)`,
      clicks: sql<number>`count(*)`,
    })
      .from(affiliateClicks)
      .where(gte(affiliateClicks.createdAt, since))
      .groupBy(sql`DATE(createdAt)`)
      .orderBy(sql`DATE(createdAt)`),
    db.select({
      page: affiliateClicks.referrerPage,
      clicks: sql<number>`count(*)`,
    })
      .from(affiliateClicks)
      .where(and(gte(affiliateClicks.createdAt, since), sql`referrerPage IS NOT NULL`))
      .groupBy(affiliateClicks.referrerPage)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const byPlatform: Record<string, number> = {};
  for (const row of platformResult) {
    byPlatform[row.platform] = Number(row.count);
  }

  return {
    totalClicks: Number(totalResult[0]?.count ?? 0),
    byPlatform,
    byDay: dayResult.map(r => ({ date: r.date, clicks: Number(r.clicks) })),
    topReferrers: referrerResult
      .filter(r => r.page)
      .map(r => ({ page: r.page!, clicks: Number(r.clicks) })),
  };
}

