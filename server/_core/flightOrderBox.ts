/**
 * flightOrderBox — 代客訂機票最小狀態機 (批2 m4, 2026-06-10 Jeff 拍板).
 *
 * Digitizes the existing manual flow (feedback_packgo_flight_booking_workflow):
 * 核件(護照拼音名)→ Trip.com 備訂 → Jeff 親自刷卡 → 出票 → 確認單。
 *
 *   prepared ──→ awaiting_payment ──→ ticketed
 *      │               │
 *      └──── cancel ───┘        (ticketed is final; never cancellable here)
 *
 * HARD LINES, by construction:
 *   - No payment execution of any kind. `bookingUrl` is a stored link the UI
 *     opens in a new tab for Jeff to pay HIMSELF. No card fields exist.
 *   - No passport numbers. `passengerNames` carries passport-SPELLING names
 *     only; this module/table deliberately has no number column, so the
 *     tokenCrypto rule can't even be violated.
 *   - markTicketed is allowed from prepared OR awaiting_payment (one-man shop:
 *     Jeff sometimes pays before recording the url) but never from cancelled
 *     or an already-ticketed row.
 *
 * Every mutation is audited (same ApprovalAuditCtx pattern as spamBox).
 */
import { eq, desc } from "drizzle-orm";
import { getDb } from "../db";
import { flightOrders, type FlightOrder } from "../../drizzle/schema";
import { audit } from "./auditLog";
import { createChildLogger } from "./logger";
import type { ApprovalAuditCtx } from "./approvalTasks";

const log = createChildLogger({ module: "flightOrderBox" });

export interface CreateFlightOrderInput {
  customerUserId: number;
  airline: string;
  flightSummary: string;
  pricePerPerson?: number;
  passengerCount?: number;
  currency?: string;
  passengerNames?: string;
  /** Present → the order starts directly at awaiting_payment (real-world
   *  entry point: Jeff records it right after opening the Trip.com page). */
  bookingUrl?: string;
  notes?: string;
}

export async function listFlightOrders(
  customerUserId: number,
): Promise<FlightOrder[]> {
  const db = await getDb();
  if (!db) {
    log.warn("[flightOrderBox] list: database not available");
    return [];
  }
  return db
    .select()
    .from(flightOrders)
    .where(eq(flightOrders.customerUserId, customerUserId))
    .orderBy(desc(flightOrders.createdAt))
    .limit(50);
}

async function getById(id: number): Promise<FlightOrder | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(flightOrders)
    .where(eq(flightOrders.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createFlightOrder(
  input: CreateFlightOrderInput,
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number; status: FlightOrder["status"] }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const status = input.bookingUrl?.trim() ? "awaiting_payment" : "prepared";
  const ins = await db.insert(flightOrders).values({
    customerUserId: input.customerUserId,
    status,
    airline: input.airline.trim(),
    flightSummary: input.flightSummary.trim(),
    pricePerPerson: input.pricePerPerson,
    passengerCount: input.passengerCount ?? 1,
    currency: input.currency ?? "USD",
    passengerNames: input.passengerNames?.trim() || null,
    bookingUrl: input.bookingUrl?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  const id = Number((ins as any)[0]?.insertId ?? 0);
  if (ctx?.user) {
    audit({
      ctx,
      action: "flightOrder.create",
      targetType: "flightOrder",
      targetId: id,
      changes: { status, airline: input.airline },
    });
  }
  log.info({ id, status }, "[flightOrderBox] created");
  return { id, status };
}

/** 備訂 → 待你刷卡: attach the Trip.com page Jeff will open HIMSELF. */
export async function markAwaitingPayment(
  id: number,
  bookingUrl: string,
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number; status: FlightOrder["status"] }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = await getById(id);
  if (!row) throw new Error(`Flight order ${id} not found`);
  if (row.status !== "prepared") {
    throw new Error(`Flight order ${id} is ${row.status} — only prepared can move to awaiting_payment`);
  }
  await db
    .update(flightOrders)
    .set({ status: "awaiting_payment", bookingUrl: bookingUrl.trim() })
    .where(eq(flightOrders.id, id));
  if (ctx?.user) {
    audit({
      ctx,
      action: "flightOrder.awaitingPayment",
      targetType: "flightOrder",
      targetId: id,
      changes: { bookingUrl: bookingUrl.slice(0, 120) },
    });
  }
  return { id, status: "awaiting_payment" };
}

/** 出票 — Jeff already paid by his own hand; we only RECORD the result. */
export async function markTicketed(
  id: number,
  fields: { pnr?: string; eticketNumbers?: string; orderRef?: string },
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number; status: FlightOrder["status"] }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = await getById(id);
  if (!row) throw new Error(`Flight order ${id} not found`);
  if (row.status === "ticketed") {
    throw new Error(`Flight order ${id} is already ticketed`);
  }
  if (row.status === "cancelled") {
    throw new Error(`Flight order ${id} is cancelled — cannot ticket`);
  }
  await db
    .update(flightOrders)
    .set({
      status: "ticketed",
      pnr: fields.pnr?.trim() || null,
      eticketNumbers: fields.eticketNumbers?.trim() || null,
      orderRef: fields.orderRef?.trim() || null,
    })
    .where(eq(flightOrders.id, id));
  if (ctx?.user) {
    audit({
      ctx,
      action: "flightOrder.ticketed",
      targetType: "flightOrder",
      targetId: id,
      changes: { pnr: fields.pnr ?? null },
    });
  }
  log.info({ id }, "[flightOrderBox] ticketed");
  return { id, status: "ticketed" };
}

/** 取消備訂/待刷卡。已出票不可在此取消(退票走真退款流程,不在 v1)。 */
export async function cancelFlightOrder(
  id: number,
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number; status: FlightOrder["status"] }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = await getById(id);
  if (!row) throw new Error(`Flight order ${id} not found`);
  if (row.status === "ticketed") {
    throw new Error(`Flight order ${id} is ticketed — refunds are a separate flow, not v1 cancel`);
  }
  if (row.status !== "cancelled") {
    await db
      .update(flightOrders)
      .set({ status: "cancelled" })
      .where(eq(flightOrders.id, id));
    if (ctx?.user) {
      audit({
        ctx,
        action: "flightOrder.cancel",
        targetType: "flightOrder",
        targetId: id,
        changes: { from: row.status },
      });
    }
  }
  return { id, status: "cancelled" };
}
