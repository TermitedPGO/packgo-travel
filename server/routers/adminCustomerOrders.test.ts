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
      ].sort(),
    );
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
