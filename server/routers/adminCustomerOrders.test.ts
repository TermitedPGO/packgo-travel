/**
 * adminCustomerOrders router 測試。design.md §4.1 + 紅線。
 * 蓋:procedure surface、confirm gate、缺 PDF/email reject、recordPayment 推狀態+
 * 時間戳、**supplierCost 不在 listForCustomer 投影**、send* 呼叫 email + audit。
 *
 * Mock collaborators BEFORE importing the router(vi.mock hoisted)。狀態機用真的。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getCustomOrderById: vi.fn(),
  createCustomOrder: vi.fn(),
  updateCustomOrder: vi.fn(async (_id: number, patch: any) => ({ id: _id, ...patch })),
  listCustomOrdersByProfile: vi.fn(),
  findCustomerProfileId: vi.fn(),
  ensureCustomerProfileId: vi.fn(),
  getCustomerProfileSnapshot: vi.fn(async () => ({ name: "王先生", email: "w@x.co", userId: null })),
  getCustomerLanguage: vi.fn(async () => "zh-TW"),
  generateOrderNumber: vi.fn(async () => "ORD-2026-0001"),
  createInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  // customer-projects (0104, batch-assign audit fix) — assignConversation deps.
  resolveCustomerProfileIds: vi.fn(),
  assignInteractionsToOrder: vi.fn(async () => 0),
  // Real (trivial) implementation, matches server/db/customOrder.ts exactly —
  // mirrors the existing file convention of inline-reimplementing simple
  // collaborators (see updateCustomOrder above) rather than importing the real
  // module, so this mock can never silently mask a guard regression.
  orderBelongsToProfiles: (orderProfileId: number | null, profileIds: number[]) =>
    orderProfileId != null && profileIds.includes(orderProfileId),
}));
vi.mock("../rateLimit", () => ({
  checkAdminMutationRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59 })),
}));
vi.mock("../_core/auditLog", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("../_core/paymentProvider", () => ({
  getPaymentProvider: () => ({ createPaymentLink: async () => null }),
}));
vi.mock("../email/templates/customOrder", () => ({
  sendCustomOrderQuoteEmail: vi.fn(async () => true),
  sendCustomOrderCollectionEmail: vi.fn(async () => true),
  sendCustomOrderConfirmationEmail: vi.fn(async () => true),
}));
vi.mock("../services/invoiceService", () => ({
  generateInvoiceNumber: vi.fn(async () => "INV-2026-0001"),
  generateInvoicePdf: vi.fn(async () => ({ html: "<i>x</i>", r2Url: "https://r2/inv.html" })),
}));
// order-ai-understanding (0107) — analyzeOrder delegates the LLM pipeline here;
// the router test only proves gating + passthrough (the pipeline has its own
// tests in server/_core/customerPreferenceExtractor.test.ts).
vi.mock("../_core/customerPreferenceExtractor", () => ({
  analyzeOrderAiUnderstanding: vi.fn(),
}));

import { adminCustomerOrdersRouter } from "./adminCustomerOrders";
import * as db from "../db";
import { audit } from "../_core/auditLog";
import { analyzeOrderAiUnderstanding } from "../_core/customerPreferenceExtractor";
import {
  sendCustomOrderQuoteEmail,
  sendCustomOrderCollectionEmail,
  sendCustomOrderConfirmationEmail,
} from "../email/templates/customOrder";

function adminCtx() {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    ip: "127.0.0.1",
  };
}
const caller = () => (adminCustomerOrdersRouter as any).createCaller(adminCtx());

const baseOrder = {
  id: 7,
  orderNumber: "ORD-2026-0001",
  customerProfileId: 5,
  userId: null,
  customerName: "王先生",
  customerEmail: "w@x.co",
  title: "台灣12天",
  destination: null,
  status: "arranged",
  needsQuote: 1,
  quotePdfUrl: null,
  quoteId: null,
  quoteSentAt: null,
  totalPrice: "5000.00",
  depositAmount: "1500.00",
  balanceAmount: "3500.00",
  currency: "USD",
  supplierCost: "4000.00",
  depositPaidAt: null,
  balancePaidAt: null,
  depositPaymentLink: null,
  balancePaymentLink: null,
  collectionSentAt: null,
  paymentMethod: null,
  confirmationPdfUrl: null,
  confirmedAt: null,
  recognizedAt: null,
  bookingId: null,
  notes: null,
  createdBy: 1,
  createdAt: new Date("2026-06-21"),
  updatedAt: new Date("2026-06-21"),
};

beforeEach(() => vi.clearAllMocks());

describe("surface", () => {
  it("exposes the expected procedures", () => {
    const procs = Object.keys((adminCustomerOrdersRouter as any)._def.procedures).sort();
    expect(procs).toEqual(
      [
        "analyzeOrder",
        "assignConversation",
        "attachConfirmation",
        "attachQuote",
        "cancel",
        "create",
        "createPdfUpload",
        "get",
        "listForCustomer",
        "recordPayment",
        "sendCollection",
        "sendConfirmation",
        "sendQuote",
        "update",
        "updateStatus",
        "watchdogForCustomer",
      ].sort(),
    );
  });
});

describe("watchdogForCustomer — Step 5 漏價看門狗(admin-only,只攤數字)", () => {
  it("回賠錢 / 毛利過薄的單,紅在前;成本/售價齊全才算;draft 的漏價跳過但過期報價承諾會叫", async () => {
    (db.findCustomerProfileId as any).mockResolvedValue(5);
    (db.listCustomOrdersByProfile as any).mockResolvedValue([
      { ...baseOrder, id: 1, totalPrice: "5000", supplierCost: "4500", status: "quoted" }, // 黃 10%
      { ...baseOrder, id: 2, totalPrice: "5000", supplierCost: "4000", status: "quoted" }, // 健康 20%
      { ...baseOrder, id: 3, totalPrice: "5000", supplierCost: "5600", status: "arranged" }, // 紅 loss
      // draft:漏價規則跳過(數字還在喬),但 needsQuote+10 天沒寄 → promise 黃燈
      { ...baseOrder, id: 4, totalPrice: "5000", supplierCost: "9999", status: "draft", createdAt: new Date(Date.now() - 10 * 86_400_000) },
    ]);
    const out = await caller().watchdogForCustomer({ profileId: 5 });
    expect(out.map((f: any) => f.orderId)).toEqual([3, 1, 4]);
    expect(out.map((f: any) => f.kind)).toEqual(["margin", "margin", "promise"]);
    expect(out[0].level).toBe("red");
    expect((out[0] as any).reason).toBe("loss");
    expect(out[1].level).toBe("yellow");
    expect((out[2] as any).reason).toBe("quoteUnsent");
  });

  it("promise 類(v2)走同一個 endpoint:訂金收了 5 天沒確認書 → confirmationUnsent", async () => {
    (db.findCustomerProfileId as any).mockResolvedValue(5);
    (db.listCustomOrdersByProfile as any).mockResolvedValue([
      {
        ...baseOrder,
        id: 9,
        status: "deposit_paid",
        supplierCost: null, // 漏價規則資料缺不叫,只剩 promise
        depositPaidAt: new Date(Date.now() - 5 * 86_400_000),
        confirmedAt: null,
      },
    ]);
    const out = await caller().watchdogForCustomer({ profileId: 5 });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("promise");
    expect((out[0] as any).reason).toBe("confirmationUnsent");
    expect((out[0] as any).daysWaiting).toBeGreaterThan(3);
  });

  it("找不到客人 → 空陣列(不打 DB)", async () => {
    (db.findCustomerProfileId as any).mockResolvedValue(null);
    const out = await caller().watchdogForCustomer({ userId: 999 });
    expect(out).toEqual([]);
    expect(db.listCustomOrdersByProfile).not.toHaveBeenCalled();
  });

  it("全健康 → 空陣列(不亂叫;paid 但沒 depositPaidAt = 資料缺,承諾規則也不叫)", async () => {
    (db.findCustomerProfileId as any).mockResolvedValue(5);
    (db.listCustomOrdersByProfile as any).mockResolvedValue([
      { ...baseOrder, id: 1, totalPrice: "5000", supplierCost: "4000", status: "paid" },
    ]);
    expect(await caller().watchdogForCustomer({ profileId: 5 })).toEqual([]);
  });
});

describe("listForCustomer — redline: no supplierCost in the list projection", () => {
  it("omits supplierCost and derives paymentStatus", async () => {
    (db.findCustomerProfileId as any).mockResolvedValue(5);
    (db.listCustomOrdersByProfile as any).mockResolvedValue([
      { ...baseOrder, depositPaidAt: new Date(), balancePaidAt: null },
    ]);
    const rows = await caller().listForCustomer({ profileId: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("supplierCost");
    expect(JSON.stringify(rows[0])).not.toContain("4000");
    expect(rows[0].paymentStatus).toBe("partial");
  });
  it("returns [] when the profile cannot be resolved", async () => {
    (db.findCustomerProfileId as any).mockResolvedValue(null);
    expect(await caller().listForCustomer({ userId: 9 })).toEqual([]);
  });
});

describe("create", () => {
  it("maps needsQuote, computes balance, starts at draft, audits", async () => {
    (db.ensureCustomerProfileId as any).mockResolvedValue(5);
    (db.createCustomOrder as any).mockResolvedValue({ ...baseOrder, id: 11 });
    await caller().create({
      selection: { profileId: 5 },
      title: "台灣12天",
      needsQuote: false,
      totalPrice: 5000,
      depositAmount: 1500,
    });
    const arg = (db.createCustomOrder as any).mock.calls[0][0];
    expect(arg.status).toBe("draft");
    expect(arg.needsQuote).toBe(0);
    expect(arg.balanceAmount).toBe("3500"); // 5000 - 1500
    expect(arg.orderNumber).toBe("ORD-2026-0001");
    expect(audit).toHaveBeenCalled();
  });

  it("passes category (0105 總類) through to createCustomOrder, null when omitted", async () => {
    (db.ensureCustomerProfileId as any).mockResolvedValue(5);
    (db.createCustomOrder as any).mockResolvedValue({ ...baseOrder, id: 11 });
    await caller().create({ selection: { profileId: 5 }, title: "X", category: "flight" });
    expect((db.createCustomOrder as any).mock.calls[0][0].category).toBe("flight");

    await caller().create({ selection: { profileId: 5 }, title: "Y" });
    expect((db.createCustomOrder as any).mock.calls[1][0].category).toBeNull();
  });

  it("rejects an unknown category key (zod enum)", async () => {
    (db.ensureCustomerProfileId as any).mockResolvedValue(5);
    await expect(
      caller().create({ selection: { profileId: 5 }, title: "X", category: "not-a-real-category" } as any),
    ).rejects.toBeTruthy();
  });
});

/**
 * update — audit fix (2026-06-30): had zero test coverage (only the procedure
 * surface was asserted). Covers terminal-guard, partial-patch field mapping,
 * balance recompute, and the category (0105) patch added alongside the
 * customer-projects feature.
 */
describe("update", () => {
  it("rejects editing a terminal (completed/cancelled) order", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "completed" });
    await expect(caller().update({ orderId: 7, title: "新標題" })).rejects.toThrow(/edit/);
    expect(db.updateCustomOrder).not.toHaveBeenCalled();
  });

  it("only patches the fields actually provided (sparse patch)", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged" });
    await caller().update({ orderId: 7, title: "新標題" });
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch).toEqual({ title: "新標題" });
  });

  it("recomputes balanceAmount when totalPrice or depositAmount changes", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged", totalPrice: "5000", depositAmount: "1500" });
    await caller().update({ orderId: 7, depositAmount: 2000 });
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.balanceAmount).toBe("3000"); // existing total 5000 - new deposit 2000
  });

  it("sets category (0105 總類), including clearing it back to null", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged" });
    await caller().update({ orderId: 7, category: "visa" });
    expect((db.updateCustomOrder as any).mock.calls[0][1].category).toBe("visa");

    await caller().update({ orderId: 7, category: null });
    expect((db.updateCustomOrder as any).mock.calls[1][1].category).toBeNull();
  });

  it("rejects an unknown category key on update too", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged" });
    await expect(
      caller().update({ orderId: 7, category: "not-a-real-category" } as any),
    ).rejects.toBeTruthy();
  });

  it("audits the patch", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged" });
    await caller().update({ orderId: 7, title: "改名" });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customOrder.update", targetId: 7 }),
    );
  });
});

describe("sendQuote — confirm gate + preconditions", () => {
  it("rejects without confirm:true (zod literal)", async () => {
    await expect(caller().sendQuote({ orderId: 7 } as any)).rejects.toBeTruthy();
  });
  it("rejects when no quote PDF attached", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "draft", quotePdfUrl: null });
    await expect(caller().sendQuote({ orderId: 7, confirm: true })).rejects.toThrow(/quote PDF/);
  });
  it("sends email + advances draft→quoted + sets quoteSentAt", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "draft", quotePdfUrl: "https://x/q.pdf" });
    await caller().sendQuote({ orderId: 7, confirm: true });
    expect(sendCustomOrderQuoteEmail).toHaveBeenCalledTimes(1);
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.status).toBe("quoted");
    expect(patch.quoteSentAt).toBeInstanceOf(Date);
  });
  it("re-send while past draft keeps status, still emails", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged", quotePdfUrl: "https://x/q.pdf" });
    await caller().sendQuote({ orderId: 7, confirm: true });
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.status).toBeUndefined();
    expect(sendCustomOrderQuoteEmail).toHaveBeenCalled();
  });
});

describe("sendCollection", () => {
  it("emails the deposit ask with the manual paste link, stores link + collectionSentAt", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder });
    const r = await caller().sendCollection({ orderId: 7, kind: "deposit", paymentLink: "https://sq/pay/abc", confirm: true });
    expect(sendCustomOrderCollectionEmail).toHaveBeenCalledTimes(1);
    const emailArg = (sendCustomOrderCollectionEmail as any).mock.calls[0][0];
    expect(emailArg.amount).toBe(1500);
    expect(emailArg.paymentLink).toBe("https://sq/pay/abc");
    expect(r.paymentLink).toBe("https://sq/pay/abc");
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.depositPaymentLink).toBe("https://sq/pay/abc");
    expect(patch.collectionSentAt).toBeInstanceOf(Date);
  });
  it("rejects when the amount is missing", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, depositAmount: null });
    await expect(caller().sendCollection({ orderId: 7, kind: "deposit", confirm: true })).rejects.toThrow(/amount/);
  });
  it("rejects when no payment link is provided (manual provider returns null)", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder });
    await expect(caller().sendCollection({ orderId: 7, kind: "deposit", confirm: true })).rejects.toThrow(/payment link/);
    expect(sendCustomOrderCollectionEmail).not.toHaveBeenCalled();
  });
});

describe("recordPayment — money truth + forward status nudge", () => {
  it("deposit sets depositPaidAt + depositPaidAmount, never overwrites the owed depositAmount", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged" });
    await caller().recordPayment({ orderId: 7, kind: "deposit" });
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.depositPaidAt).toBeInstanceOf(Date);
    expect(patch.depositPaidAmount).toBe("1500"); // received defaults to owed
    expect(patch.depositAmount).toBeUndefined(); // contract figure untouched
    expect(patch.status).toBe("deposit_paid");
    expect(audit).toHaveBeenCalled();
  });
  it("balance after confirmation keeps confirmed but records balancePaidAt", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "confirmed" });
    await caller().recordPayment({ orderId: 7, kind: "balance" });
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.balancePaidAt).toBeInstanceOf(Date);
    expect(patch.status).toBe("confirmed");
  });
});

describe("sendConfirmation", () => {
  it("rejects without a confirmation PDF", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, confirmationPdfUrl: null });
    await expect(caller().sendConfirmation({ orderId: 7, confirm: true })).rejects.toThrow(/confirmation PDF/);
  });
  it("emails + advances to confirmed", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "deposit_paid", confirmationPdfUrl: "https://x/c.pdf" });
    await caller().sendConfirmation({ orderId: 7, confirm: true });
    expect(sendCustomOrderConfirmationEmail).toHaveBeenCalledTimes(1);
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.status).toBe("confirmed");
    expect(patch.confirmedAt).toBeInstanceOf(Date);
  });
  it("re-send on a departed order keeps status (does not throw departed→confirmed)", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "departed", confirmationPdfUrl: "https://x/c.pdf" });
    await caller().sendConfirmation({ orderId: 7, confirm: true });
    expect(sendCustomOrderConfirmationEmail).toHaveBeenCalledTimes(1);
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.status).toBeUndefined();
    expect(patch.confirmedAt).toBeInstanceOf(Date);
  });
  it("rejects on a draft order (must arrange/pay before confirming)", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "draft", confirmationPdfUrl: "https://x/c.pdf" });
    await expect(caller().sendConfirmation({ orderId: 7, confirm: true })).rejects.toThrow(/illegal/);
  });
  it("rejects on a terminal (cancelled) order", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "cancelled", confirmationPdfUrl: "https://x/c.pdf" });
    await expect(caller().sendConfirmation({ orderId: 7, confirm: true })).rejects.toThrow(/cancelled/);
  });
});

describe("cancel / updateStatus guards", () => {
  it("cancel sets cancelled + audits", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged" });
    await caller().cancel({ orderId: 7, reason: "客人改期" });
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.status).toBe("cancelled");
    expect(audit).toHaveBeenCalled();
  });
  it("cancel on a terminal order rejects", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "completed" });
    await expect(caller().cancel({ orderId: 7 })).rejects.toThrow(/completed/);
  });
  it("updateStatus rejects an illegal lifecycle jump", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "draft" });
    await expect(caller().updateStatus({ orderId: 7, status: "confirmed" })).rejects.toThrow(/illegal/);
  });
  it("updateStatus same-status is a no-op (no write, no audit row)", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged" });
    await caller().updateStatus({ orderId: 7, status: "arranged" });
    expect(db.updateCustomOrder).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("sendQuote — terminal guard", () => {
  it("rejects sending a quote on a cancelled order", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "cancelled", quotePdfUrl: "https://x/q.pdf" });
    await expect(caller().sendQuote({ orderId: 7, confirm: true })).rejects.toThrow(/cancelled/);
    expect(sendCustomOrderQuoteEmail).not.toHaveBeenCalled();
  });
});

/**
 * customer-projects (0104, batch-assign audit fix) — assignConversation had
 * ZERO test coverage before this (an audit on 2026-06-30 flagged it: a
 * cross-customer FORBIDDEN guard and a missing terminal guard, both unverified).
 * Covers: input validation, 未分類 (orderId null), cross-customer FORBIDDEN,
 * the cancelled-vs-completed terminal split (deliberately narrower than
 * assertNotTerminal — see the router's own comment), and batch arrays.
 */
describe("assignConversation", () => {
  it("rejects when neither gmailThreadIds nor interactionIds is given", async () => {
    await expect(
      caller().assignConversation({ selection: { userId: 9 }, orderId: null }),
    ).rejects.toThrow();
  });

  it("PRECONDITION_FAILED when the customer cannot be resolved (no DB)", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([]);
    await expect(
      caller().assignConversation({
        selection: { userId: 9 },
        orderId: null,
        interactionIds: [1],
      }),
    ).rejects.toThrow();
  });

  it("files into 未分類 (orderId null) without checking order ownership", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.assignInteractionsToOrder as any).mockResolvedValue(1);
    const res = await caller().assignConversation({
      selection: { userId: 9 },
      orderId: null,
      interactionIds: [101],
    });
    expect(res.updated).toBe(1);
    expect(db.getCustomOrderById).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalled();
  });

  it("files into an order that belongs to the customer", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, customerProfileId: 5, status: "arranged" });
    (db.assignInteractionsToOrder as any).mockResolvedValue(3);
    const res = await caller().assignConversation({
      selection: { userId: 9 },
      orderId: 7,
      gmailThreadIds: ["thread-a"],
    });
    expect(res.updated).toBe(3);
  });

  it("FORBIDDEN when the order belongs to a DIFFERENT customer (cross-customer guard)", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, customerProfileId: 999, status: "arranged" });
    await expect(
      caller().assignConversation({
        selection: { userId: 9 },
        orderId: 7,
        interactionIds: [101],
      }),
    ).rejects.toThrow(/belong/);
    expect(db.assignInteractionsToOrder).not.toHaveBeenCalled();
  });

  it("a customer with TWO profileIds (registered + pre-registration guest) can still file into an order owned by either", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5, 9]);
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, customerProfileId: 5, status: "arranged" });
    (db.assignInteractionsToOrder as any).mockResolvedValue(1);
    const res = await caller().assignConversation({
      selection: { userId: 9 },
      orderId: 7,
      interactionIds: [101],
    });
    expect(res.updated).toBe(1);
  });

  it("rejects filing into a CANCELLED order", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, customerProfileId: 5, status: "cancelled" });
    await expect(
      caller().assignConversation({
        selection: { userId: 9 },
        orderId: 7,
        interactionIds: [101],
      }),
    ).rejects.toThrow(/cancelled/);
    expect(db.assignInteractionsToOrder).not.toHaveBeenCalled();
  });

  it("ALLOWS filing into a COMPLETED order (deliberately narrower than assertNotTerminal — post-trip correspondence is legitimate)", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, customerProfileId: 5, status: "completed" });
    (db.assignInteractionsToOrder as any).mockResolvedValue(1);
    const res = await caller().assignConversation({
      selection: { userId: 9 },
      orderId: 7,
      interactionIds: [101],
    });
    expect(res.updated).toBe(1);
  });

  it("batch: passes both gmailThreadIds and interactionIds arrays through in one call", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.assignInteractionsToOrder as any).mockResolvedValue(4);
    await caller().assignConversation({
      selection: { userId: 9 },
      orderId: null,
      gmailThreadIds: ["t1", "t2"],
      interactionIds: [201],
    });
    const args = (db.assignInteractionsToOrder as any).mock.calls[0][0];
    expect(args.gmailThreadIds).toEqual(["t1", "t2"]);
    expect(args.interactionIds).toEqual([201]);
    expect(args.profileIds).toEqual([5]);
  });

  it("退回未分類 (orderId: null) is accepted by the schema (nullable, not optional)", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.assignInteractionsToOrder as any).mockResolvedValue(1);
    await expect(
      caller().assignConversation({
        selection: { profileId: 5 },
        orderId: null,
        interactionIds: [101],
      }),
    ).resolves.toEqual({ updated: 1 });
  });
});

/**
 * order-ai-understanding (0107) — analyzeOrder. 歸屬驗證(cross-customer
 * FORBIDDEN)+ 素材傳遞(supplierCost 絕不進 pipeline input)+ 素材為空 →
 * analyzed:false(不炸、不假裝成功)。LLM 管線本身在
 * customerPreferenceExtractor.test.ts 蓋。
 */
describe("analyzeOrder — 本專案客人理解(手動重新分析,絕不自動燒 LLM)", () => {
  it("PRECONDITION_FAILED when the customer cannot be resolved", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([]);
    await expect(
      caller().analyzeOrder({ selection: { userId: 9 }, orderId: 7 }),
    ).rejects.toThrow();
    expect(analyzeOrderAiUnderstanding).not.toHaveBeenCalled();
  });

  it("FORBIDDEN when the order belongs to a DIFFERENT customer (歸屬驗證)", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, customerProfileId: 999 });
    await expect(
      caller().analyzeOrder({ selection: { userId: 9 }, orderId: 7 }),
    ).rejects.toThrow(/belong/);
    expect(analyzeOrderAiUnderstanding).not.toHaveBeenCalled();
  });

  it("NOT_FOUND when the order does not exist", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderById as any).mockResolvedValue(undefined);
    await expect(
      caller().analyzeOrder({ selection: { profileId: 5 }, orderId: 404 }),
    ).rejects.toThrow(/not found/);
  });

  it("passes ONLY the safe deterministic fields to the pipeline — supplierCost never leaves the router", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderById as any).mockResolvedValue({
      ...baseOrder,
      category: "quote",
      departureDate: "2026-12-20",
      returnDate: "2027-01-02",
    });
    (analyzeOrderAiUnderstanding as any).mockResolvedValue({
      aiUnderstanding: "客人想帶家人去台灣,在意步調。\n\n・預算未提及",
      aiUnderstandingAt: new Date("2026-07-01T18:00:00Z"),
    });
    const r = await caller().analyzeOrder({ selection: { profileId: 5 }, orderId: 7 });
    expect(r.analyzed).toBe(true);
    expect(r.aiUnderstanding).toContain("台灣");
    const arg = (analyzeOrderAiUnderstanding as any).mock.calls[0][0];
    expect(arg).toEqual({
      id: 7,
      title: "台灣12天",
      category: "quote",
      status: "arranged",
      departureDate: "2026-12-20",
      returnDate: "2027-01-02",
      totalPrice: "5000.00",
      currency: "USD",
      notes: null,
    });
    // 紅線:成本(4000)絕不進 pipeline input。
    expect(JSON.stringify(arg)).not.toContain("4000");
    expect(arg).not.toHaveProperty("supplierCost");
  });

  it("素材為空(pipeline 回 null)→ analyzed:false,誠實不假裝", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder });
    (analyzeOrderAiUnderstanding as any).mockResolvedValue(null);
    const r = await caller().analyzeOrder({ selection: { profileId: 5 }, orderId: 7 });
    expect(r).toEqual({ analyzed: false, aiUnderstanding: null, aiUnderstandingAt: null });
  });
});
