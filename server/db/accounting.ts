// server/db/accounting.ts — extracted from server/db.ts in v2 Wave 2 Module 2.7
// (D2-locked 7-file split, seventh and FINAL sub-task).
//
// Owns: financial-ledger + admin-quoting + marketing-spend helpers.
//   • accountingEntries (CRUD + stats for income/expense ledger)
//   • invoices (CRUD + sequence number + bookingId lookup)
//   • recurringExpenses (CRUD for fixed monthly charges)
//   • aiQuotes (admin AI-generated prospect quotes; v78)
//   • marketingCampaigns + marketingMaterials + emailSendLogs (marketing
//     spend rolls into accounting; co-located so campaign ROI joins are
//     trivially intra-module — anticipated by Module 2.6 header comment).
//
// Out of scope (intentionally stays in db.ts residual):
//   • newsletter subscribers (createNewsletterSubscriber etc. +
//     getActiveSubscribers / getSubscriberCount used by marketingWorker)
//     — own domain, may move to its own module in v3.
//   • visaApplications + visaStatusHistory — own domain (v3).
//   • inquiries + inquiryMessages — own domain (v3).
//   • affiliateClicks — own domain (v3).
//
// Re-exported from server/db.ts via `export * from "./db/accounting"` so
// existing callers (`stripeWebhook.ts`, `financialReportService.ts`,
// `routers/marketing.ts`, `marketingWorker.ts`, `emailMarketingService.ts`,
// and the admin accounting / AI quote routers) keep importing from
// "../db" unchanged.
//
// Phase 2 (2026-05-18) money-path: `createAccountingEntry` accepts an
// optional `tx` so the Stripe webhook can co-locate the accounting income
// entry with the booking + payment writes in a single atomic transaction.

import { eq, and, gte, lte, desc, like, sql } from "drizzle-orm";
import {
  accountingEntries, AccountingEntry, InsertAccountingEntry,
  pendingExpenses, PendingExpense, InsertPendingExpense,
  invoices, Invoice, InsertInvoice,
  recurringExpenses, RecurringExpense, InsertRecurringExpense,
  aiQuotes, AiQuote, InsertAiQuote,
  marketingCampaigns, MarketingCampaign, InsertMarketingCampaign,
  marketingMaterials, MarketingMaterial, InsertMarketingMaterial,
  emailSendLogs, EmailSendLog, InsertEmailSendLog,
} from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";
import { reportFunnelError } from "../_core/errorFunnel";

// ─── Accounting Entries ────────────────────────────────────────────────────────

/**
 * Insert a row into the accounting ledger.
 *
 * Phase 2 (2026-05-18): accepts an optional `tx` so the stripe-webhook
 * booking handler can co-locate the accounting income entry with the
 * payment + booking writes in a single atomic transaction.
 */
export async function createAccountingEntry(
  data: InsertAccountingEntry,
  tx?: DrizzleTx,
): Promise<AccountingEntry | null> {
  const db = await getDb();
  if (!db) return null;
  const writer = tx ?? db;
  const [result] = await writer.insert(accountingEntries).values(data);
  const id = (result as any).insertId;
  const [entry] = await writer.select().from(accountingEntries).where(eq(accountingEntries.id, id));
  return entry || null;
}

export async function getAccountingEntries(params: {
  entryType?: 'income' | 'expense';
  category?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: AccountingEntry[]; total: number }> {
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };
  const conditions = [];
  if (params.entryType) conditions.push(eq(accountingEntries.entryType, params.entryType));
  if (params.category) conditions.push(eq(accountingEntries.category, params.category as any));
  if (params.startDate) conditions.push(gte(accountingEntries.entryDate, params.startDate));
  if (params.endDate) conditions.push(lte(accountingEntries.entryDate, params.endDate));
  if (params.search) conditions.push(like(accountingEntries.description, `%${params.search}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(accountingEntries).where(where);
  const entries = await db.select().from(accountingEntries).where(where)
    .orderBy(desc(accountingEntries.entryDate))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0);
  return { entries, total: Number(countResult.count) };
}

export async function updateAccountingEntry(id: number, data: Partial<InsertAccountingEntry>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(accountingEntries).set({ ...data, updatedAt: new Date() }).where(eq(accountingEntries.id, id));
  return true;
}

export async function deleteAccountingEntry(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.delete(accountingEntries).where(eq(accountingEntries.id, id));
  return true;
}

// ─── Pending Expenses (email-receipt-intake, 2026-06-15) ────────────────────
// Staging rows for Gmail receipts/invoices. AI fills the extracted fields;
// Jeff confirms (→ optionally a real accountingEntries row) or rejects. The
// gmailMessageId UNIQUE constraint makes ingestion idempotent across polls.

export async function createPendingExpense(
  data: InsertPendingExpense,
): Promise<PendingExpense | null> {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(pendingExpenses).values(data);
  const id = (result as any).insertId;
  const [row] = await db
    .select()
    .from(pendingExpenses)
    .where(eq(pendingExpenses.id, id));
  return row || null;
}

/** Dedup guard — has this Gmail message already been queued? */
export async function getPendingExpenseByGmailMessageId(
  gmailMessageId: string,
): Promise<PendingExpense | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(pendingExpenses)
    .where(eq(pendingExpenses.gmailMessageId, gmailMessageId))
    .limit(1);
  return row || null;
}

export async function getPendingExpenseById(
  id: number,
): Promise<PendingExpense | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(pendingExpenses)
    .where(eq(pendingExpenses.id, id))
    .limit(1);
  return row || null;
}

export async function listPendingExpenses(params: {
  status?: "pending" | "confirmed" | "rejected";
  limit?: number;
  offset?: number;
}): Promise<{ rows: PendingExpense[]; total: number }> {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };
  const where = params.status
    ? eq(pendingExpenses.status, params.status)
    : undefined;
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(pendingExpenses)
    .where(where);
  const rows = await db
    .select()
    .from(pendingExpenses)
    .where(where)
    .orderBy(desc(pendingExpenses.createdAt))
    .limit(params.limit ?? 100)
    .offset(params.offset ?? 0);
  return { rows, total: Number(countResult.count) };
}

/** Count of rows still awaiting Jeff's decision (for the tab badge). */
export async function countPendingExpenses(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(pendingExpenses)
    .where(eq(pendingExpenses.status, "pending"));
  return Number(row?.count ?? 0);
}

export async function updatePendingExpense(
  id: number,
  data: Partial<InsertPendingExpense>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db
    .update(pendingExpenses)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(pendingExpenses.id, id));
  return true;
}

/**
 * Confirm a pending expense into the real ledger ATOMICALLY: insert the
 * accountingEntries row AND flip the pendingExpense to confirmed (with the
 * back-link) in one transaction. Either both happen or neither — this is the
 * money path, so a half-write (orphan ledger entry + still-pending card that
 * Jeff re-confirms → double entry) must be impossible.
 */
export async function confirmPendingExpenseToLedger(params: {
  pendingId: number;
  entry: InsertAccountingEntry;
  confirmFields: Partial<InsertPendingExpense>;
}): Promise<{ entry: AccountingEntry | null }> {
  const db = await getDb();
  if (!db) return { entry: null };
  return await db.transaction(async (tx) => {
    const [res] = await tx.insert(accountingEntries).values(params.entry);
    const entryId = (res as any).insertId;
    const [entry] = await tx
      .select()
      .from(accountingEntries)
      .where(eq(accountingEntries.id, entryId));
    await tx
      .update(pendingExpenses)
      .set({
        ...params.confirmFields,
        accountingEntryId: entryId,
        status: "confirmed",
        updatedAt: new Date(),
      })
      .where(eq(pendingExpenses.id, params.pendingId));
    return { entry: entry || null };
  });
}

export interface AccountingStats {
  totalIncome: number; totalExpenses: number; trustDeferredIncome: number; netProfit: number;
  prevTotalIncome: number; prevTotalExpenses: number; prevTrustDeferredIncome: number; prevNetProfit: number;
  yearIncome: number; yearExpenses: number; yearTrustDeferredIncome: number; yearNetProfit: number;
}

/**
 * Pure assembly of the stats envelope from already-summed period totals.
 *
 * Split out (PKG-C, 2026-05-30) so the trust-aware netProfit formula
 *   netProfit = income − trustDeferred − expenses        (CST §17550)
 * is unit-testable without a DB — mirrors bankPLService.foldBankPLRows.
 *
 * `totalIncome` stays GROSS so it still equals Σ(income-by-category) and the
 * topIncomeCategories percentages; the unrecognized customer-deposit (trust)
 * amount is subtracted only from netProfit and surfaced separately as
 * `trustDeferredIncome`. This is the SAME convention bankPLService uses, so
 * the ledger P&L and the Plaid P&L can never disagree on the deferred number.
 */
export function assembleAccountingStats(p: {
  ti: number; te: number; pti: number; pte: number; yi: number; ye: number;
  trustDeferred?: number; prevTrustDeferred?: number; yearTrustDeferred?: number;
}): AccountingStats {
  const d = p.trustDeferred ?? 0;
  const pd = p.prevTrustDeferred ?? 0;
  const yd = p.yearTrustDeferred ?? 0;
  return {
    totalIncome: p.ti, totalExpenses: p.te, trustDeferredIncome: d,
    netProfit: p.ti - d - p.te,
    prevTotalIncome: p.pti, prevTotalExpenses: p.pte, prevTrustDeferredIncome: pd,
    prevNetProfit: p.pti - pd - p.pte,
    yearIncome: p.yi, yearExpenses: p.ye, yearTrustDeferredIncome: yd,
    yearNetProfit: p.yi - yd - p.ye,
  };
}

const ZERO_STATS: AccountingStats = assembleAccountingStats({ ti: 0, te: 0, pti: 0, pte: 0, yi: 0, ye: 0 });

export async function getAccountingStats(params: { startDate: Date; endDate: Date }): Promise<AccountingStats> {
  const db = await getDb();
  if (!db) return { ...ZERO_STATS };
  const diff = params.endDate.getTime() - params.startDate.getTime();
  const prevStart = new Date(params.startDate.getTime() - diff);
  const prevEnd = new Date(params.endDate.getTime() - diff);
  const yearStart = new Date(params.startDate.getFullYear(), 0, 1);
  const yearEnd = new Date(params.startDate.getFullYear(), 11, 31, 23, 59, 59);
  const [curr, prev, year] = await Promise.all([
    db.select({ type: accountingEntries.entryType, total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(accountingEntries).where(and(gte(accountingEntries.entryDate, params.startDate), lte(accountingEntries.entryDate, params.endDate)))
      .groupBy(accountingEntries.entryType),
    db.select({ type: accountingEntries.entryType, total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(accountingEntries).where(and(gte(accountingEntries.entryDate, prevStart), lte(accountingEntries.entryDate, prevEnd)))
      .groupBy(accountingEntries.entryType),
    db.select({ type: accountingEntries.entryType, total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(accountingEntries).where(and(gte(accountingEntries.entryDate, yearStart), lte(accountingEntries.entryDate, yearEnd)))
      .groupBy(accountingEntries.entryType),
  ]);
  const sum = (rows: any[], type: string) => Number(rows.find(r => r.type === type)?.total ?? 0);
  const ti = sum(curr, 'income'), te = sum(curr, 'expense');
  const pti = sum(prev, 'income'), pte = sum(prev, 'expense');
  const yi = sum(year, 'income'), ye = sum(year, 'expense');

  // Trust-aware (CST §17550): customer deposits sitting in the trust account
  // are NOT revenue until departure. Subtract the unrecognized-deferred income
  // for EACH period, scoped to deposits made WITHIN that period
  // (depositSince=periodStart) so prior periods' balances don't re-eat every
  // window — the same scoping bankPLService uses (2026-05-23 fix).
  //
  // Reuses trustDeferralService.totalDeferredForUser (single source of truth
  // for the deferred number) via a DYNAMIC import — a static import would form
  // a cycle (trustDeferralService → ../db → db/accounting). Flag-gated; on any
  // error we fall back to gross (0 deferred) and never break the ledger.
  let trustDeferred = 0, prevTrustDeferred = 0, yearTrustDeferred = 0;
  try {
    const { totalDeferredForUser, isTrustDeferralEnabled } = await import("../services/trustDeferralService");
    if (isTrustDeferralEnabled()) {
      const ymd = (dt: Date) =>
        `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      [trustDeferred, prevTrustDeferred, yearTrustDeferred] = await Promise.all([
        totalDeferredForUser({ asOfDate: ymd(params.endDate), depositSince: ymd(params.startDate) }),
        totalDeferredForUser({ asOfDate: ymd(prevEnd), depositSince: ymd(prevStart) }),
        totalDeferredForUser({ asOfDate: ymd(yearEnd), depositSince: ymd(yearStart) }),
      ]);
    }
  } catch (err) {
    console.warn("[accounting] trust deferral lookup failed (returning gross):", (err as Error)?.message);
    reportFunnelError({ source: "fail-open:accounting:trustDeferralLookup", err }).catch(() => {});
  }

  return assembleAccountingStats({ ti, te, pti, pte, yi, ye, trustDeferred, prevTrustDeferred, yearTrustDeferred });
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function createInvoice(data: InsertInvoice): Promise<Invoice | null> {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(invoices).values(data);
  const id = (result as any).insertId;
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  return inv || null;
}

export async function getInvoices(params: { status?: string; limit?: number; offset?: number }): Promise<Invoice[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (params.status) conditions.push(eq(invoices.status, params.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(invoices).where(where).orderBy(desc(invoices.createdAt)).limit(params.limit ?? 50).offset(params.offset ?? 0);
}

export async function getInvoiceById(id: number): Promise<Invoice | null> {
  const db = await getDb();
  if (!db) return null;
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  return inv || null;
}

/**
 * v77: lookup an invoice by its associated booking. Used by the customer
 * "Download receipt" flow to avoid regenerating PDFs that already exist.
 * Returns the most recent invoice for that booking (in case of multiple).
 */
export async function getInvoiceByBookingId(bookingId: number): Promise<Invoice | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.bookingId, bookingId))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return rows[0] || null;
}

export async function updateInvoice(id: number, data: Partial<InsertInvoice>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(invoices).set({ ...data, updatedAt: new Date() }).where(eq(invoices.id, id));
  return true;
}

export async function getNextInvoiceSequence(year: number): Promise<number> {
  const db = await getDb();
  if (!db) return 1;
  const prefix = `INV-${year}-`;
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(like(invoices.invoiceNumber, `${prefix}%`));
  return Number(result.count) + 1;
}

export async function updateInvoiceStatus(id: number, status: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(invoices).set({ status: status as any, updatedAt: new Date() }).where(eq(invoices.id, id));
  return (result[0] as any).affectedRows > 0;
}

export async function deleteInvoice(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.delete(invoices).where(eq(invoices.id, id));
  return (result[0] as any).affectedRows > 0;
}

// ─── Recurring Expenses ───────────────────────────────────────────────────────

export async function getRecurringExpenses(): Promise<RecurringExpense[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(recurringExpenses).orderBy(desc(recurringExpenses.createdAt));
}

export async function createRecurringExpense(data: InsertRecurringExpense): Promise<RecurringExpense | null> {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(recurringExpenses).values(data);
  const id = (result as any).insertId;
  const [exp] = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id));
  return exp || null;
}

export async function updateRecurringExpense(id: number, data: Partial<InsertRecurringExpense>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(recurringExpenses).set({ ...data, updatedAt: new Date() }).where(eq(recurringExpenses.id, id));
  return true;
}

export async function deleteRecurringExpense(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.delete(recurringExpenses).where(eq(recurringExpenses.id, id));
  return true;
}

export async function getRecurringExpenseById(id: number): Promise<RecurringExpense | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).limit(1);
  return rows[0] ?? null;
}

// ── v78: AI Quotes ──────────────────────────────────────────────────────────

export async function createAiQuote(data: InsertAiQuote): Promise<AiQuote | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(aiQuotes).values(data);
  const insertId = Number((result[0] as any).insertId);
  const rows = await db.select().from(aiQuotes).where(eq(aiQuotes.id, insertId)).limit(1);
  return rows[0] ?? null;
}

export async function listAiQuotes(params: { status?: string; limit?: number; offset?: number }): Promise<AiQuote[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (params.status) conditions.push(eq(aiQuotes.status, params.status as any));
  const query = db.select().from(aiQuotes);
  const finalQuery = conditions.length > 0
    ? query.where(and(...conditions))
    : query;
  return await finalQuery
    .orderBy(desc(aiQuotes.createdAt))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0);
}

export async function updateAiQuote(id: number, data: Partial<InsertAiQuote>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(aiQuotes).set(data).where(eq(aiQuotes.id, id));
  return (result[0] as any).affectedRows > 0;
}

export async function getAiQuoteById(id: number): Promise<AiQuote | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(aiQuotes).where(eq(aiQuotes.id, id)).limit(1);
  return rows[0] ?? null;
}

// ============================================
// Marketing Automation — Campaigns
// ============================================

export async function createMarketingCampaign(data: InsertMarketingCampaign): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(marketingCampaigns).values(data);
  return (result[0] as { insertId: number }).insertId;
}

export async function getMarketingCampaigns(filters?: {
  type?: "social_post" | "email_newsletter" | "poster";
  status?: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  limit?: number;
}): Promise<MarketingCampaign[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.type) conditions.push(eq(marketingCampaigns.type, filters.type));
  if (filters?.status) conditions.push(eq(marketingCampaigns.status, filters.status));
  const query = db.select().from(marketingCampaigns);
  if (conditions.length > 0) query.where(and(...conditions));
  query.orderBy(desc(marketingCampaigns.createdAt));
  if (filters?.limit) query.limit(filters.limit);
  return query;
}

export async function getMarketingCampaignById(id: number): Promise<MarketingCampaign | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateMarketingCampaign(id: number, data: Partial<InsertMarketingCampaign>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(marketingCampaigns).set(data).where(eq(marketingCampaigns.id, id));
}

export async function deleteMarketingCampaign(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
}

// ============================================
// Marketing Automation — Materials
// ============================================

export async function saveMarketingMaterial(data: InsertMarketingMaterial): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(marketingMaterials).values(data);
  return (result[0] as { insertId: number }).insertId;
}

export async function getMarketingMaterials(filters?: {
  tourId?: number;
  type?: string;
  campaignId?: number;
  limit?: number;
}): Promise<MarketingMaterial[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.tourId) conditions.push(eq(marketingMaterials.tourId, filters.tourId));
  if (filters?.campaignId) conditions.push(eq(marketingMaterials.campaignId, filters.campaignId));
  if (filters?.type) conditions.push(eq(marketingMaterials.type, filters.type as MarketingMaterial["type"]));
  const query = db.select().from(marketingMaterials);
  if (conditions.length > 0) query.where(and(...conditions));
  query.orderBy(desc(marketingMaterials.createdAt));
  if (filters?.limit) query.limit(filters.limit);
  return query;
}

export async function deleteMarketingMaterial(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(marketingMaterials).where(eq(marketingMaterials.id, id));
}

// ============================================
// Marketing Automation — Email Send Logs
// ============================================

export async function createEmailSendLog(data: InsertEmailSendLog): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(emailSendLogs).values(data);
}

export async function updateEmailSendLog(id: number, data: Partial<InsertEmailSendLog>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(emailSendLogs).set(data).where(eq(emailSendLogs.id, id));
}

export async function getEmailSendLogs(campaignId: number): Promise<EmailSendLog[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailSendLogs)
    .where(eq(emailSendLogs.campaignId, campaignId))
    .orderBy(desc(emailSendLogs.sentAt));
}
