/**
 * adminCustomerOrders router 測試。design.md §4.1 + 紅線。
 * 蓋:procedure surface、confirm gate、缺 PDF/email reject、recordPayment 推狀態+
 * 時間戳、**supplierCost 不在 listForCustomer 投影**、send* 呼叫 email + audit。
 *
 * Mock collaborators BEFORE importing the router(vi.mock hoisted)。狀態機用真的。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

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
  resolveCustomerProfileIds: vi.fn(),
  getCustomOrderProfileId: vi.fn(),
  assignInteractionsToOrder: vi.fn(async () => 0),
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

import { adminCustomerOrdersRouter } from "./adminCustomerOrders";
import * as db from "../db";
import { audit } from "../_core/auditLog";
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
  it("回賠錢 / 毛利過薄的單,紅在前;成本/售價齊全才算", async () => {
    (db.findCustomerProfileId as any).mockResolvedValue(5);
    (db.listCustomOrdersByProfile as any).mockResolvedValue([
      { ...baseOrder, id: 1, totalPrice: "5000", supplierCost: "4500", status: "quoted" }, // 黃 10%
      { ...baseOrder, id: 2, totalPrice: "5000", supplierCost: "4000", status: "quoted" }, // 健康 20%
      { ...baseOrder, id: 3, totalPrice: "5000", supplierCost: "5600", status: "arranged" }, // 紅 loss
      { ...baseOrder, id: 4, totalPrice: "5000", supplierCost: "9999", status: "draft" }, // draft 跳過
    ]);
    const out = await caller().watchdogForCustomer({ profileId: 5 });
    expect(out.map((f: any) => f.orderId)).toEqual([3, 1]);
    expect(out[0].level).toBe("red");
    expect(out[0].reason).toBe("loss");
    expect(out[1].level).toBe("yellow");
  });

  it("找不到客人 → 空陣列(不打 DB)", async () => {
    (db.findCustomerProfileId as any).mockResolvedValue(null);
    const out = await caller().watchdogForCustomer({ userId: 999 });
    expect(out).toEqual([]);
    expect(db.listCustomOrdersByProfile).not.toHaveBeenCalled();
  });

  it("全健康 → 空陣列(不亂叫)", async () => {
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

describe("assignConversation — customer-projects (0104) design.md §5.2", () => {
  it("跨客人擋下:orderId 的 owner profileId 不在呼叫者 selection 解析出的 profileIds 內 → FORBIDDEN", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5, 6]); // 王先生的所有 profileIds
    (db.getCustomOrderProfileId as any).mockResolvedValue(99); // 訂單其實屬於別的客人
    const err = await caller()
      .assignConversation({
        selection: { profileId: 5 },
        orderId: 7,
        gmailThreadId: "thread-abc",
      })
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    expect(db.assignInteractionsToOrder).not.toHaveBeenCalled();
  });

  it("orderId 解析不到 owner(null)也視為跨客人 → FORBIDDEN", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderProfileId as any).mockResolvedValue(null);
    const err = await caller()
      .assignConversation({ selection: { profileId: 5 }, orderId: 7, interactionId: 1 })
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    expect(db.assignInteractionsToOrder).not.toHaveBeenCalled();
  });

  it("gmailThreadId 給了 → 整串一起指派,assignInteractionsToOrder 收到正確參數", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5, 6]);
    (db.getCustomOrderProfileId as any).mockResolvedValue(5); // 訂單屬於同一個客人
    (db.assignInteractionsToOrder as any).mockResolvedValue(3);
    const out = await caller().assignConversation({
      selection: { profileId: 5 },
      orderId: 7,
      gmailThreadId: "thread-abc",
    });
    expect(db.assignInteractionsToOrder).toHaveBeenCalledWith({
      profileIds: [5, 6],
      orderId: 7,
      gmailThreadId: "thread-abc",
      interactionId: null,
    });
    expect(out).toEqual({ updated: 3 });
  });

  it("沒給 gmailThreadId、給了 interactionId → 單列退路", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.getCustomOrderProfileId as any).mockResolvedValue(5);
    (db.assignInteractionsToOrder as any).mockResolvedValue(1);
    await caller().assignConversation({
      selection: { profileId: 5 },
      orderId: 7,
      interactionId: 42,
    });
    expect(db.assignInteractionsToOrder).toHaveBeenCalledWith({
      profileIds: [5],
      orderId: 7,
      gmailThreadId: null,
      interactionId: 42,
    });
  });

  it("orderId 給 null → 退回未分類(跳過 owner 比對,直接指派)", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.assignInteractionsToOrder as any).mockResolvedValue(1);
    await caller().assignConversation({
      selection: { profileId: 5 },
      orderId: null,
      gmailThreadId: "thread-abc",
    });
    expect(db.getCustomOrderProfileId).not.toHaveBeenCalled();
    expect(db.assignInteractionsToOrder).toHaveBeenCalledWith({
      profileIds: [5],
      orderId: null,
      gmailThreadId: "thread-abc",
      interactionId: null,
    });
  });

  it("成功路徑寫 audit()", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([5]);
    (db.assignInteractionsToOrder as any).mockResolvedValue(1);
    await caller().assignConversation({
      selection: { profileId: 5 },
      orderId: null,
      gmailThreadId: "thread-abc",
    });
    expect(audit).toHaveBeenCalled();
    const call = (audit as any).mock.calls[0][0];
    expect(call.action).toBe("customOrder.assignConversation");
  });

  it("selection 解析不到客人(無 DB)→ PRECONDITION_FAILED,不打 assignInteractionsToOrder", async () => {
    (db.resolveCustomerProfileIds as any).mockResolvedValue([]);
    const err = await caller()
      .assignConversation({ selection: { profileId: 5 }, orderId: null, gmailThreadId: "t" })
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("PRECONDITION_FAILED");
    expect(db.assignInteractionsToOrder).not.toHaveBeenCalled();
  });
});

describe("update — rename (customer-projects 0104)", () => {
  it("title 傳空字串 → zod min(1) 擋下(invalid input)", async () => {
    const err = await caller()
      .update({ orderId: 7, title: "" })
      .catch((e: any) => e);
    expect(err).toBeTruthy();
    expect(db.getCustomOrderById).not.toHaveBeenCalled();
    expect(db.updateCustomOrder).not.toHaveBeenCalled();
  });

  it("title 傳純空白字串 → trim 後同樣被 min(1) 擋下", async () => {
    const err = await caller()
      .update({ orderId: 7, title: "   " })
      .catch((e: any) => e);
    expect(err).toBeTruthy();
    expect(db.updateCustomOrder).not.toHaveBeenCalled();
  });

  it("terminal 單(cancelled)呼叫 update 改 title → assertNotTerminal 擋下", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "cancelled" });
    await expect(caller().update({ orderId: 7, title: "新名字" })).rejects.toThrow(/cancelled/);
    expect(db.updateCustomOrder).not.toHaveBeenCalled();
  });

  it("terminal 單(completed)呼叫 update 改 title → assertNotTerminal 擋下", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "completed" });
    await expect(caller().update({ orderId: 7, title: "新名字" })).rejects.toThrow(/completed/);
    expect(db.updateCustomOrder).not.toHaveBeenCalled();
  });

  it("非 terminal 單成功改名,patch 帶新 title", async () => {
    (db.getCustomOrderById as any).mockResolvedValue({ ...baseOrder, status: "arranged" });
    await caller().update({ orderId: 7, title: "新名字" });
    const patch = (db.updateCustomOrder as any).mock.calls[0][1];
    expect(patch.title).toBe("新名字");
  });
});
