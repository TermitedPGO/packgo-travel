// server/db/customOrder.ts — 訂製單 (custom-orders) 資料層。
//
// Owns: customOrders CRUD + ORD-YYYY-NNNN 編號 + ensureCustomerProfileId 歸戶解析。
// Re-exported from server/db.ts via `export * from "./db/customOrder"` so callers
// import from "../db" unchanged. Design: docs/features/custom-orders/design.md §2.
//
// 紅線:supplierCost 是普通欄位,這層「不做」任何自動填(手動由 admin 給)。
// depositPaidAt/balancePaidAt 只記已收時間,不是營收認列(§17550)。

import { eq, desc, gte, sql } from "drizzle-orm";
import {
  customOrders,
  InsertCustomOrder,
  CustomOrder,
  customerProfiles,
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
  const [res] = await db
    .insert(customerProfiles)
    .values({ userId: sel.userId, status: "active" });
  return Number((res as any).insertId);
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

/** All of a customer's orders, newest first. */
export async function listCustomOrdersByProfile(
  customerProfileId: number,
): Promise<CustomOrder[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(customOrders)
    .where(eq(customOrders.customerProfileId, customerProfileId))
    .orderBy(desc(customOrders.createdAt));
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
