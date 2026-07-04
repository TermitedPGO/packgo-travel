// server/db/customOrder.ts — 訂製單 (custom-orders) 資料層。
//
// Owns: customOrders CRUD + ORD-YYYY-NNNN 編號 + ensureCustomerProfileId 歸戶解析。
// Re-exported from server/db.ts via `export * from "./db/customOrder"` so callers
// import from "../db" unchanged. Design: docs/features/custom-orders/design.md §2.
//
// 紅線:supplierCost 是普通欄位,這層「不做」任何自動填(手動由 admin 給)。
// depositPaidAt/balancePaidAt 只記已收時間,不是營收認列(§17550)。

import { eq, desc, gte, sql, and, or, inArray } from "drizzle-orm";
import {
  customOrders,
  InsertCustomOrder,
  CustomOrder,
  customerProfiles,
  customerInteractions,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";

/**
 * Generate a unique custom-order number: ORD-YYYY-NNNN.
 * Mirrors generateQuoteNumber (aiQuoteService.ts): count this year's rows + 1.
 * No-DB fallback (local has no DATABASE_URL) returns a timestamp-suffixed id.
 */
export async function generateOrderNumber(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return `ORD-${year}-${Date.now().toString().slice(-4)}`;
  const yearStart = new Date(year, 0, 1);
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(customOrders)
    .where(gte(customOrders.createdAt, yearStart));
  const count = Number(result[0]?.count || 0) + 1;
  return `ORD-${year}-${String(count).padStart(4, "0")}`;
}

/**
 * Resolve the customer-page selection into a canonical customerProfileId.
 *   - guest selection carries a profileId → use it directly.
 *   - registered selection carries a userId → find that user's profile, or
 *     find-or-create a minimal one (uq_cp_user unique). Mirrors the upsert in
 *     adminCustomers.markNotCustomer.
 * Returns null only when there is no DB (local).
 */
export async function ensureCustomerProfileId(sel: {
  userId?: number | null;
  profileId?: number | null;
}): Promise<number | null> {
  if (sel.profileId != null) return sel.profileId;
  if (sel.userId == null) return null;
  const db = await getDb();
  if (!db) return null;
  const existing = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, sel.userId))
    .limit(1);
  if (existing[0]) return existing[0].id;
  // insertCustomerProfileSafely (2026-07-03, 任務7 對抗審查 P0) — closes the
  // race window between the `existing` SELECT above and this INSERT.
  const { insertCustomerProfileSafely } = await import("./customerProfile");
  const insertResult = await insertCustomerProfileSafely(
    db,
    { userId: sel.userId, status: "active" },
    "userId",
  );
  return insertResult.profileId;
}

/**
 * Read-only variant of ensureCustomerProfileId — never inserts. Used by list/
 * read paths (a mere customer-page view must not create a profile row).
 * Returns null when not found / no DB.
 */
export async function findCustomerProfileId(sel: {
  userId?: number | null;
  profileId?: number | null;
}): Promise<number | null> {
  if (sel.profileId != null) return sel.profileId;
  if (sel.userId == null) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, sel.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * customer-projects (0104) — resolve a selection into ALL of the customer's
 * profileIds (a registered customer can own several: their own row PLUS
 * pre-registration guest rows filed under their verified email). Mirrors the
 * identity resolution in customerConversationThread so assignment scopes to the
 * exact same rows the 歷史 tab shows. Guest selection → just that one row.
 */
export async function resolveCustomerProfileIds(sel: {
  userId?: number | null;
  profileId?: number | null;
}): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  if (sel.profileId != null) {
    const rows = await db
      .select({ id: customerProfiles.id })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, sel.profileId))
      .limit(1);
    return rows.map((r) => r.id);
  }
  if (sel.userId == null) return [];
  const [u] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, sel.userId))
    .limit(1);
  const email = u?.email ?? null;
  const rows = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(
      email
        ? or(
            eq(customerProfiles.userId, sel.userId),
            eq(customerProfiles.email, email),
          )
        : eq(customerProfiles.userId, sel.userId),
    );
  return rows.map((r) => r.id);
}

/**
 * customer-projects (0104) — true when an order's owning profileId is one of a
 * customer's resolved profileIds (no cross-customer leakage). Pure, shared by
 * every cross-customer guard that pins an order to a customer (ask-ops-stream's
 * orderId scoping AND assignConversation) so the rule is defined once and is
 * trivially testable — an audit (2026-06-30) found the ask-ops-stream guard had
 * drifted to a single-profile lookup (false-403'd a customer whose order was
 * filed under a pre-registration guest profileId) and that neither guard had a
 * direct test. This function is the one place that rule now lives.
 */
export function orderBelongsToProfiles(
  orderProfileId: number | null,
  profileIds: number[],
): boolean {
  return orderProfileId != null && profileIds.includes(orderProfileId);
}

/**
 * customer-projects (0104, batch-assign audit fix) — file real-conversation
 * turns under a project (or back to 未分類 when orderId is null). Scoped to the
 * given profileIds so a turn can NEVER be moved across customers. Targets whole
 * Gmail threads (the natural unit) and/or individual interaction rows in ONE
 * call — the 歷史 tab's multi-select bulk-assign passes both arrays at once
 * instead of one row at a time. Returns the number of rows updated. No-op (0)
 * on no DB / empty scope / nothing to target.
 */
export async function assignInteractionsToOrder(args: {
  profileIds: number[];
  orderId: number | null;
  gmailThreadIds?: string[];
  interactionIds?: number[];
}): Promise<number> {
  const db = await getDb();
  if (!db || args.profileIds.length === 0) return 0;
  const threadIds = args.gmailThreadIds ?? [];
  const rowIds = args.interactionIds ?? [];
  const targets = [
    threadIds.length > 0 ? inArray(customerInteractions.gmailThreadId, threadIds) : null,
    rowIds.length > 0 ? inArray(customerInteractions.id, rowIds) : null,
  ].filter((c): c is NonNullable<typeof c> => c != null);
  if (targets.length === 0) return 0;
  const target = targets.length === 1 ? targets[0] : or(...targets);
  const res = await db
    .update(customerInteractions)
    .set({ customOrderId: args.orderId })
    .where(
      and(
        inArray(customerInteractions.customerProfileId, args.profileIds),
        target,
      ),
    );
  // mysql2 returns affectedRows on the result header.
  return Number((res as any)?.[0]?.affectedRows ?? (res as any)?.affectedRows ?? 0);
}

/** Customer's preferred email language for the three sends. Defaults zh-TW. */
export async function getCustomerLanguage(
  profileId: number,
): Promise<"zh-TW" | "en"> {
  const db = await getDb();
  if (!db) return "zh-TW";
  const [p] = await db
    .select({ lang: customerProfiles.preferredLanguage })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, profileId))
    .limit(1);
  return (p?.lang || "").toLowerCase().startsWith("en") ? "en" : "zh-TW";
}

/**
 * Snapshot the customer's name/email/userId for a new order (so the order is
 * self-describing even if the profile later changes). Falls back to the linked
 * user row when the profile has no name (guests derived from email).
 */
export async function getCustomerProfileSnapshot(profileId: number): Promise<{
  name: string | null;
  email: string | null;
  userId: number | null;
}> {
  const db = await getDb();
  if (!db) return { name: null, email: null, userId: null };
  const [p] = await db
    .select({
      name: customerProfiles.name,
      email: customerProfiles.email,
      userId: customerProfiles.userId,
    })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, profileId))
    .limit(1);
  if (!p) return { name: null, email: null, userId: null };
  if ((p.name && p.email) || p.userId == null) return p;
  // fill gaps from the linked user
  const { users } = await import("../../drizzle/schema");
  const [u] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, p.userId))
    .limit(1);
  return {
    name: p.name ?? u?.name ?? null,
    email: p.email ?? u?.email ?? null,
    userId: p.userId,
  };
}

export async function createCustomOrder(
  data: InsertCustomOrder,
): Promise<CustomOrder | null> {
  const db = await getDb();
  if (!db) return null;
  const [res] = await db.insert(customOrders).values(data);
  const id = Number((res as any).insertId);
  const [row] = await db.select().from(customOrders).where(eq(customOrders.id, id));
  return row || null;
}

export async function getCustomOrderById(id: number): Promise<CustomOrder | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(customOrders).where(eq(customOrders.id, id));
  return row || null;
}

/**
 * All of a customer's orders, newest first. `excludeTerminal` (customer-cockpit
 * Phase6 B1) filters out completed/cancelled — used by the auto-assignment
 * "exactly one in-progress order" rule so a closed case never silently
 * absorbs a new, unrelated inbound email. Defaults to false (unchanged
 * behavior) so existing callers (customer-page 專案 list) keep seeing
 * everything including history.
 */
export async function listCustomOrdersByProfile(
  customerProfileId: number,
  opts?: { excludeTerminal?: boolean },
): Promise<CustomOrder[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(customOrders)
    .where(eq(customOrders.customerProfileId, customerProfileId))
    .orderBy(desc(customOrders.createdAt));
  if (!opts?.excludeTerminal) return rows;
  return rows.filter((r) => r.status !== "completed" && r.status !== "cancelled");
}

export async function updateCustomOrder(
  id: number,
  patch: Partial<InsertCustomOrder>,
): Promise<CustomOrder | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .update(customOrders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(customOrders.id, id));
  return getCustomOrderById(id);
}

/** Used by the invoice-link path (sendCollection createInvoice). */
export async function listInvoicesForCustomOrder(customOrderId: number) {
  const db = await getDb();
  if (!db) return [];
  const { invoices } = await import("../../drizzle/schema");
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.customOrderId, customOrderId))
    .orderBy(desc(invoices.createdAt));
}
