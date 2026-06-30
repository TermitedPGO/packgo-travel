// server/routers/adminCustomerOrders.ts — 訂製單 (custom-orders) admin router。
//
// 全部 adminProcedure(自動 60 req/min throttle + role check;CLAUDE.md §3.2)。
// 設計 docs/features/custom-orders/design.md §4.1。一筆訂製單 = customOrders 一列,
// 客戶頁三顆按鈕(報價/催款/確認書)落在這上面。
//
// confirm gate(碰客碰錢):send* 三個動作都要 confirm:true(雙保險:UI 按鈕是
// 唯一入口 + flag),少了就 reject。排程/agent 不得呼叫 send*。
//
// 紅線:
//   - supplierCost 只在 get(單筆,admin 看 margin)回傳;listForCustomer 投影「不含」
//     成本(列表是客戶面摘要)。客人信絕不含成本(在 email template 把關)。
//   - recordPayment 是「錢的真相」(手動);depositPaidAt/balancePaidAt 不是營收認列
//     (§17550),Trust 對帳另走銀行+會計。
//   - send*/recordPayment/cancel/updateStatus 都寫 audit()。

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { audit } from "../_core/auditLog";
import { getPaymentProvider } from "../_core/paymentProvider";
import {
  assertTransition,
  statusAfterPayment,
  isTerminal,
  CUSTOM_ORDER_STATUSES,
} from "./customOrderStateMachine";
import {
  sendCustomOrderQuoteEmail,
  sendCustomOrderCollectionEmail,
  sendCustomOrderConfirmationEmail,
} from "../email/templates/customOrder";
import {
  generateInvoiceNumber,
  generateInvoicePdf,
} from "../services/invoiceService";
import {
  findOrderMarginIssues,
  WATCHDOG_MARGIN_THRESHOLD,
} from "../services/customOrderWatchdog";
import type { CustomOrder } from "../../drizzle/schema";

// ── helpers ─────────────────────────────────────────────────────────────────

/** decimal column wants string | null. */
const dec = (n?: number | null): string | null => (n == null ? null : String(n));
/** decimal column → number | null for math. */
const num = (s?: string | null): number | null => (s == null ? null : Number(s));

// customer-projects (0105) — 總類 keys. Stored as varchar so new categories need
// no migration; we still validate the known set on write. UI maps key → i18n label
// (機票 / 報價行程 / 簽證 / 一般諮詢). A coordinator like Emerald (AXT) sends many
// different kinds of cases under one inbox; the category tells them apart.
export const PROJECT_CATEGORY_KEYS = ["flight", "quote", "visa", "general"] as const;
const categorySchema = z.enum(PROJECT_CATEGORY_KEYS);

const selectionSchema = z.union([
  z.object({ userId: z.number().int().positive() }).strict(),
  z.object({ profileId: z.number().int().positive() }).strict(),
]);

function selToArgs(sel: { userId?: number } | { profileId?: number }) {
  return {
    userId: "userId" in sel ? sel.userId : undefined,
    profileId: "profileId" in sel ? sel.profileId : undefined,
  };
}

async function loadOrder(id: number): Promise<CustomOrder> {
  const o = await db.getCustomOrderById(id);
  if (!o) {
    throw new TRPCError({ code: "NOT_FOUND", message: "custom order not found" });
  }
  return o;
}

function assertNotTerminal(o: CustomOrder, what: string): void {
  if (isTerminal(o.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `cannot ${what}: order is ${o.status}`,
    });
  }
}

/**
 * Custom-order mutations change the customer's DETERMINISTIC summary facts
 * (quoteSentAt / collectionSentAt / paid timestamps / confirmedAt / status), and
 * 「做了什麼 / 給了什麼」are computed from those (server/_core/customerFacts.ts).
 * Nudge that customer's AI summary to recompute so the card reflects the action
 * immediately — otherwise it lags until the 24h TTL (the「跟進到最新進度」gap).
 * Fire-forget: a refresh hiccup must never fail the order action that succeeded.
 */
function bumpCustomerSummary(profileId: number): void {
  void import("../queue")
    .then((m) => m.enqueueCustomerSummaryRefresh(profileId))
    .catch(() => {});
}

/** Recompute balance when total/deposit are known. null when total unknown. */
function computeBalance(
  total: number | null | undefined,
  deposit: number | null | undefined,
): number | null {
  if (total == null) return null;
  return Math.max(0, total - (deposit ?? 0));
}

/**
 * Customer-page LIST projection. Intentionally OMITS supplierCost (cost never
 * belongs in a list view) and derives a payment badge from the paid-at
 * timestamps. The single-order `get` returns the full admin row (with cost).
 */
function toListItem(o: CustomOrder) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    title: o.title,
    category: o.category,
    destination: o.destination,
    status: o.status,
    needsQuote: o.needsQuote === 1,
    currency: o.currency,
    totalPrice: o.totalPrice,
    depositAmount: o.depositAmount,
    balanceAmount: o.balanceAmount,
    depositPaidAt: o.depositPaidAt,
    balancePaidAt: o.balancePaidAt,
    departureDate: o.departureDate,
    returnDate: o.returnDate,
    quotePdfUrl: o.quotePdfUrl,
    confirmationPdfUrl: o.confirmationPdfUrl,
    quoteSentAt: o.quoteSentAt,
    confirmedAt: o.confirmedAt,
    collectionSentAt: o.collectionSentAt,
    createdAt: o.createdAt,
    paymentStatus: o.balancePaidAt ? "paid" : o.depositPaidAt ? "partial" : "unpaid",
  };
}

// ── router ──────────────────────────────────────────────────────────────────

export const adminCustomerOrdersRouter = router({
  /** All of a customer's orders (lean projection, no supplierCost). */
  listForCustomer: adminProcedure
    .input(selectionSchema)
    .query(async ({ input }) => {
      const profileId = await db.findCustomerProfileId(selToArgs(input));
      if (profileId == null) return [];
      const rows = await db.listCustomOrdersByProfile(profileId);
      return rows.map(toListItem);
    }),

  /** Single order, full admin detail (includes supplierCost for margin). */
  get: adminProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ input }) => loadOrder(input.orderId)),

  /**
   * 看門狗(Step 5):這個客人所有訂製單裡售價對不上後台成本(賠錢 / 毛利過薄)的那幾張。
   * admin-only(adminProcedure),內部把售價/成本/毛利三個數字攤給 Jeff —— 供應商成本
   * 絕不上客人文件,這支不投影到任何客戶面查詢。純 deterministic 規則,不改不送。
   * 規則見 server/services/customOrderWatchdog.ts。
   */
  watchdogForCustomer: adminProcedure
    .input(selectionSchema)
    .query(async ({ input }) => {
      const profileId = await db.findCustomerProfileId(selToArgs(input));
      if (profileId == null) return [];
      const rows = await db.listCustomOrdersByProfile(profileId);
      return findOrderMarginIssues(rows, WATCHDOG_MARGIN_THRESHOLD);
    }),

  create: adminProcedure
    .input(
      z.object({
        selection: selectionSchema,
        title: z.string().trim().min(1).max(200),
        category: categorySchema.optional(),
        destination: z.string().trim().max(200).optional(),
        needsQuote: z.boolean().default(true),
        totalPrice: z.number().nonnegative().max(99_999_999).optional(),
        depositAmount: z.number().nonnegative().max(99_999_999).optional(),
        currency: z.string().trim().length(3).default("USD"),
        departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        supplierCost: z.number().nonnegative().max(99_999_999).optional(),
        customerName: z.string().trim().max(200).optional(),
        customerEmail: z.string().trim().email().max(320).optional(),
        notes: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const profileId = await db.ensureCustomerProfileId(selToArgs(input.selection));
      if (profileId == null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "cannot resolve customer (no database?)",
        });
      }
      const snap = await db.getCustomerProfileSnapshot(profileId);
      const name = input.customerName || snap.name || snap.email || "客戶";
      const email = input.customerEmail || snap.email || null;
      const userId =
        "userId" in input.selection ? input.selection.userId : snap.userId;

      const orderNumber = await db.generateOrderNumber();
      const order = await db.createCustomOrder({
        orderNumber,
        customerProfileId: profileId,
        userId: userId ?? null,
        customerName: name,
        customerEmail: email,
        title: input.title,
        category: input.category ?? null,
        destination: input.destination ?? null,
        needsQuote: input.needsQuote ? 1 : 0,
        status: "draft",
        currency: input.currency,
        totalPrice: dec(input.totalPrice),
        depositAmount: dec(input.depositAmount),
        balanceAmount: dec(computeBalance(input.totalPrice, input.depositAmount)),
        supplierCost: dec(input.supplierCost),
        departureDate: input.departureDate ?? null,
        returnDate: input.returnDate ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      await audit({
        ctx,
        action: "customOrder.create",
        targetType: "customOrder",
        targetId: order?.id,
        changes: { orderNumber, title: input.title, needsQuote: input.needsQuote },
      });
      bumpCustomerSummary(profileId);
      return order;
    }),

  update: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        title: z.string().trim().min(1).max(200).optional(),
        category: categorySchema.nullable().optional(),
        destination: z.string().trim().max(200).nullable().optional(),
        needsQuote: z.boolean().optional(),
        totalPrice: z.number().nonnegative().max(99_999_999).nullable().optional(),
        depositAmount: z.number().nonnegative().max(99_999_999).nullable().optional(),
        currency: z.string().trim().length(3).optional(),
        departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        supplierCost: z.number().nonnegative().max(99_999_999).nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const o = await loadOrder(input.orderId);
      assertNotTerminal(o, "edit");
      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.category !== undefined) patch.category = input.category;
      if (input.destination !== undefined) patch.destination = input.destination;
      if (input.needsQuote !== undefined) patch.needsQuote = input.needsQuote ? 1 : 0;
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.departureDate !== undefined) patch.departureDate = input.departureDate;
      if (input.returnDate !== undefined) patch.returnDate = input.returnDate;
      if (input.supplierCost !== undefined) patch.supplierCost = dec(input.supplierCost);
      if (input.notes !== undefined) patch.notes = input.notes;
      // recompute balance when total or deposit moves
      const totalChanged = input.totalPrice !== undefined;
      const depositChanged = input.depositAmount !== undefined;
      if (totalChanged) patch.totalPrice = dec(input.totalPrice);
      if (depositChanged) patch.depositAmount = dec(input.depositAmount);
      if (totalChanged || depositChanged) {
        const total = totalChanged ? input.totalPrice ?? null : num(o.totalPrice);
        const deposit = depositChanged ? input.depositAmount ?? null : num(o.depositAmount);
        patch.balanceAmount = dec(computeBalance(total, deposit));
      }
      const updated = await db.updateCustomOrder(input.orderId, patch);
      await audit({
        ctx,
        action: "customOrder.update",
        targetType: "customOrder",
        targetId: input.orderId,
        changes: patch,
      });
      return updated;
    }),

  /**
   * customer-projects (0104, batch-assign audit fix) — file real-conversation
   * turns (Gmail/email) under a project, or send them back to 未分類
   * (orderId: null). Whole-thread by gmailThreadId (the natural unit) and/or
   * individual interaction rows, BOTH as arrays so the 歷史 tab can multi-select
   * and assign everything in one call instead of one row at a time (a customer
   * like Emerald can have 20+ unsorted historical turns — one-by-one doesn't
   * scale). Cross-customer guard: scoped to the selection's profileIds via the
   * shared orderBelongsToProfiles rule; when filing INTO an order, the order
   * must belong to the same customer. New mail keeps landing in 未分類
   * (threadFiling.ts unchanged) — this is the manual assignment Jeff drives.
   *
   * Terminal-status rule: blocks filing into a CANCELLED order (a dead order —
   * Jeff almost certainly meant a different one) but deliberately ALLOWS a
   * COMPLETED order (post-trip correspondence, e.g. thank-you notes or photo
   * shares, legitimately belongs on a finished project's record). This is
   * narrower than assertNotTerminal (which also blocks completed) on purpose —
   * filing a conversation reference doesn't mutate the order's facts the way
   * `update` does, so the same lockdown doesn't apply.
   */
  assignConversation: adminProcedure
    .input(
      z
        .object({
          selection: selectionSchema,
          orderId: z.number().int().positive().nullable(),
          gmailThreadIds: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
          interactionIds: z.array(z.number().int().positive()).max(200).optional(),
        })
        .refine(
          (v) => (v.gmailThreadIds?.length ?? 0) + (v.interactionIds?.length ?? 0) > 0,
          { message: "pass gmailThreadIds or interactionIds" },
        ),
    )
    .mutation(async ({ input, ctx }) => {
      const profileIds = await db.resolveCustomerProfileIds(
        selToArgs(input.selection),
      );
      if (profileIds.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "cannot resolve customer (no database?)",
        });
      }
      // Filing INTO an order: it must belong to THIS customer (no cross-customer),
      // and must not be cancelled (dead order).
      if (input.orderId !== null) {
        const order = await loadOrder(input.orderId);
        if (!db.orderBelongsToProfiles(order.customerProfileId, profileIds)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "order does not belong to this customer",
          });
        }
        if (order.status === "cancelled") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "cannot file a conversation into a cancelled order",
          });
        }
      }
      const updated = await db.assignInteractionsToOrder({
        profileIds,
        orderId: input.orderId,
        gmailThreadIds: input.gmailThreadIds,
        interactionIds: input.interactionIds,
      });
      await audit({
        ctx,
        action: "customOrder.assignConversation",
        targetType: "customOrder",
        targetId: input.orderId ?? undefined,
        changes: {
          orderId: input.orderId,
          gmailThreadIds: input.gmailThreadIds,
          interactionIds: input.interactionIds,
          updated,
        },
      });
      return { updated };
    }),

  // ── PDF 上傳(拖曳)──────────────────────────────────────────────────────
  // Presign a browser→R2 DIRECT PUT for a quote / confirmation PDF (big files
  // skip the Express body limit). Client PUTs the file to putUrl, then calls
  // attachQuote / attachConfirmation with fileUrl. PDF-only. Mirrors the
  // reply-attachment upload pattern. R2 bucket needs CORS (PUT) for the admin
  // origin. fileUrl is the durable read URL (public base when configured).
  createPdfUpload: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        kind: z.enum(["quote", "confirmation"]),
        filename: z.string().trim().min(1).max(255),
        size: z.number().int().positive().max(25 * 1024 * 1024),
      }),
    )
    .mutation(async ({ input }) => {
      await loadOrder(input.orderId);
      const { storageCreatePresignedPut, storageGet } = await import("../storage");
      const safe = input.filename.replace(/[^\w.\-]+/g, "_").slice(-80);
      const key = `custom-orders/${input.orderId}/${input.kind}-${Date.now()}-${safe}`;
      const { key: storedKey, putUrl } = await storageCreatePresignedPut(key, "application/pdf");
      const { url: fileUrl } = await storageGet(storedKey);
      return { putUrl, fileUrl };
    }),

  // ── 報價 ──────────────────────────────────────────────────────────────────
  attachQuote: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        quotePdfUrl: z.string().url().max(1024),
        quoteId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await loadOrder(input.orderId);
      const updated = await db.updateCustomOrder(input.orderId, {
        quotePdfUrl: input.quotePdfUrl,
        quoteId: input.quoteId ?? null,
      });
      await audit({
        ctx,
        action: "customOrder.attachQuote",
        targetType: "customOrder",
        targetId: input.orderId,
      });
      return updated;
    }),

  sendQuote: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        confirm: z.literal(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const o = await loadOrder(input.orderId);
      // never send a customer-facing email on a cancelled/completed order
      assertNotTerminal(o, "send quote");
      if (!o.quotePdfUrl) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "attach a quote PDF before sending",
        });
      }
      if (!o.customerEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "customer has no email on file",
        });
      }
      const advance = o.status === "draft";
      if (advance) assertTransition(o.status, "quoted");
      const language = await db.getCustomerLanguage(o.customerProfileId);
      await sendCustomOrderQuoteEmail({
        customerEmail: o.customerEmail,
        customerName: o.customerName,
        orderNumber: o.orderNumber,
        title: o.title,
        currency: o.currency,
        language,
        quotePdfUrl: o.quotePdfUrl,
      });
      // audit the (irreversible) send first, then persist state, so a DB blip
      // after the email still leaves a traceable record of the send.
      await audit({
        ctx,
        action: "customOrder.sendQuote",
        targetType: "customOrder",
        targetId: input.orderId,
      });
      const updated = await db.updateCustomOrder(input.orderId, {
        quoteSentAt: new Date(),
        ...(advance ? { status: "quoted" as const } : {}),
      });
      bumpCustomerSummary(o.customerProfileId);
      return updated;
    }),

  // ── 催款(送 ask)+ 記已收(money truth) ───────────────────────────────────
  sendCollection: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        kind: z.enum(["deposit", "balance"]),
        paymentLink: z.string().url().max(2048).optional(),
        createInvoice: z.boolean().default(false),
        confirm: z.literal(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const o = await loadOrder(input.orderId);
      assertNotTerminal(o, "collect");
      if (!o.customerEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "customer has no email on file",
        });
      }
      const amount = input.kind === "deposit" ? num(o.depositAmount) : num(o.balanceAmount);
      if (!amount || amount <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `set the ${input.kind} amount before collecting`,
        });
      }
      // payment-provider seam: Manual returns null this batch → use手貼 link.
      const auto = await getPaymentProvider()
        .createPaymentLink({
          amountCents: Math.round(amount * 100),
          currency: o.currency,
          orderNumber: o.orderNumber,
          description: `${o.title} ${input.kind}`,
        })
        .catch((err) => {
          console.warn(`[customOrder] createPaymentLink failed for ${o.orderNumber}:`, err);
          return null;
        });
      const link = auto?.url ?? input.paymentLink ?? null;
      // The collection email says "pay using the link below". Refuse to send a
      // money ask with no way to pay (mirrors the quote/confirmation PDF guards).
      if (!link) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "attach a payment link before collecting",
        });
      }

      // optional linked invoice (best-effort — failure never blocks the send)
      let invoiceUrl: string | null = null;
      if (input.createInvoice) {
        invoiceUrl = await createOrderInvoice(o, input.kind, amount, ctx.user.id).catch(
          (err) => {
            console.warn(`[customOrder] createOrderInvoice failed for ${o.orderNumber}:`, err);
            return null;
          },
        );
      }

      const language = await db.getCustomerLanguage(o.customerProfileId);
      await sendCustomOrderCollectionEmail({
        customerEmail: o.customerEmail,
        customerName: o.customerName,
        orderNumber: o.orderNumber,
        title: o.title,
        currency: o.currency,
        language,
        kind: input.kind,
        amount,
        paymentLink: link,
      });

      // audit the send first, then persist (DB blip after the email stays traceable).
      await audit({
        ctx,
        action: "customOrder.sendCollection",
        targetType: "customOrder",
        targetId: input.orderId,
        changes: { kind: input.kind, amount, hasLink: !!link, invoiced: !!invoiceUrl },
      });
      const updated = await db.updateCustomOrder(input.orderId, {
        collectionSentAt: new Date(),
        ...(input.kind === "deposit"
          ? { depositPaymentLink: link }
          : { balancePaymentLink: link }),
      });
      bumpCustomerSummary(o.customerProfileId);
      return { order: updated, paymentLink: link, invoiceUrl };
    }),

  /** 記已收(訂金/尾款)— 錢的真相,手動。設時間戳 + 順手推狀態(只進不退)。 */
  recordPayment: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        kind: z.enum(["deposit", "balance"]),
        amount: z.number().positive().max(99_999_999).optional(),
        paidAt: z.coerce.date().optional(),
        method: z.string().trim().max(20).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const o = await loadOrder(input.orderId);
      assertNotTerminal(o, "record payment");
      const when = input.paidAt ?? new Date();
      const newStatus = statusAfterPayment(o.status, input.kind);
      // received amount = what was actually collected. Defaults to the owed
      // figure when not given. Stored in the dedicated *PaidAmount columns —
      // NEVER overwrite depositAmount/balanceAmount (those are the契約應收價,
      // 決策 A). Money-truth and amount-owed must not share a column.
      const received =
        input.amount ??
        (input.kind === "deposit" ? num(o.depositAmount) : num(o.balanceAmount));
      const patch: Record<string, unknown> = {
        status: newStatus,
        paymentMethod: input.method ?? o.paymentMethod ?? "square",
        ...(input.kind === "deposit"
          ? { depositPaidAt: when, depositPaidAmount: dec(received) }
          : { balancePaidAt: when, balancePaidAmount: dec(received) }),
      };
      await audit({
        ctx,
        action: "customOrder.recordPayment",
        targetType: "customOrder",
        targetId: input.orderId,
        changes: { kind: input.kind, amount: received, paidAt: when },
      });
      const updated = await db.updateCustomOrder(input.orderId, patch);
      bumpCustomerSummary(o.customerProfileId);
      return updated;
    }),

  // ── 確認書 ────────────────────────────────────────────────────────────────
  attachConfirmation: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        confirmationPdfUrl: z.string().url().max(1024),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await loadOrder(input.orderId);
      const updated = await db.updateCustomOrder(input.orderId, {
        confirmationPdfUrl: input.confirmationPdfUrl,
      });
      await audit({
        ctx,
        action: "customOrder.attachConfirmation",
        targetType: "customOrder",
        targetId: input.orderId,
      });
      return updated;
    }),

  sendConfirmation: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        confirm: z.literal(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const o = await loadOrder(input.orderId);
      assertNotTerminal(o, "send confirmation");
      if (!o.confirmationPdfUrl) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "attach a confirmation PDF before sending",
        });
      }
      if (!o.customerEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "customer has no email on file",
        });
      }
      // confirmed / departed → re-send, keep status (idempotent). Pre-confirmed
      // states (arranged/deposit_paid/paid) → advance to confirmed. draft/quoted
      // → assertTransition throws (must arrange/pay before confirming).
      const advance = o.status !== "confirmed" && o.status !== "departed";
      if (advance) assertTransition(o.status, "confirmed");
      const language = await db.getCustomerLanguage(o.customerProfileId);
      await sendCustomOrderConfirmationEmail({
        customerEmail: o.customerEmail,
        customerName: o.customerName,
        orderNumber: o.orderNumber,
        title: o.title,
        currency: o.currency,
        language,
        confirmationPdfUrl: o.confirmationPdfUrl,
        departureDate: o.departureDate,
      });
      await audit({
        ctx,
        action: "customOrder.sendConfirmation",
        targetType: "customOrder",
        targetId: input.orderId,
      });
      const updated = await db.updateCustomOrder(input.orderId, {
        confirmedAt: new Date(),
        ...(advance ? { status: "confirmed" as const } : {}),
      });
      bumpCustomerSummary(o.customerProfileId);
      return updated;
    }),

  // ── lifecycle 手動覆寫 + 取消 ────────────────────────────────────────────
  updateStatus: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        status: z.enum(CUSTOM_ORDER_STATUSES),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const o = await loadOrder(input.orderId);
      // same-status no-op: don't write or pollute the tamper-evident audit chain.
      if (input.status === o.status) return o;
      assertTransition(o.status, input.status);
      const updated = await db.updateCustomOrder(input.orderId, {
        status: input.status,
      });
      await audit({
        ctx,
        action: "customOrder.updateStatus",
        targetType: "customOrder",
        targetId: input.orderId,
        changes: { from: o.status, to: input.status },
        reason: input.reason,
      });
      bumpCustomerSummary(o.customerProfileId);
      return updated;
    }),

  cancel: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const o = await loadOrder(input.orderId);
      assertNotTerminal(o, "cancel");
      assertTransition(o.status, "cancelled");
      const note = input.reason
        ? `${o.notes ? o.notes + "\n" : ""}[cancelled] ${input.reason}`
        : o.notes;
      const updated = await db.updateCustomOrder(input.orderId, {
        status: "cancelled",
        notes: note,
      });
      await audit({
        ctx,
        action: "customOrder.cancel",
        targetType: "customOrder",
        targetId: input.orderId,
        reason: input.reason,
      });
      bumpCustomerSummary(o.customerProfileId);
      return updated;
    }),
});

/**
 * Build a linked invoice for a collection. Reuses invoiceService exactly like
 * invoices.create, then persists with customOrderId so it surfaces in the
 * customer docs list. Direct-sell amount only — never any supplier cost.
 * Returns the viewable URL, or throws (caller treats failure as best-effort).
 */
async function createOrderInvoice(
  o: CustomOrder,
  kind: "deposit" | "balance",
  amount: number,
  createdBy: number,
): Promise<string | null> {
  const invoiceNumber = await generateInvoiceNumber();
  const labelZh = kind === "deposit" ? "訂金" : "尾款";
  const invoiceData = {
    invoiceNumber,
    issueDate: new Date(),
    status: "draft" as const,
    customerName: o.customerName,
    customerEmail: o.customerEmail ?? undefined,
    lineItems: [
      { description: `${o.title} ${labelZh}`, quantity: 1, unitPrice: amount, amount },
    ],
    subtotal: amount,
    taxRate: 0,
    taxAmount: 0,
    totalAmount: amount,
    currency: o.currency,
  };
  const { html, r2Url } = await generateInvoicePdf(invoiceData);
  const invoice = await db.createInvoice({
    ...invoiceData,
    customOrderId: o.id,
    lineItems: JSON.stringify(invoiceData.lineItems),
    subtotal: String(amount),
    taxRate: "0",
    taxAmount: "0",
    totalAmount: String(amount),
    pdfUrl: r2Url ?? undefined,
    pdfHtml: html,
    createdBy,
  } as any);
  if (!invoice?.id) return r2Url ?? null;
  if (!r2Url) {
    const { ENV } = await import("../_core/env");
    const base = (ENV.baseUrl || "https://packgo-travel.fly.dev").replace(/\/+$/, "");
    const viewUrl = `${base}/api/invoices/${invoice.id}/view`;
    await db.updateInvoice(invoice.id, { pdfUrl: viewUrl } as any).catch(() => {});
    return viewUrl;
  }
  return r2Url;
}
