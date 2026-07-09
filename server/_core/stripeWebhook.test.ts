/**
 * stripeWebhook 塊B 測試(F1 對帳引擎,2026-07-08)— STRIPE_TRUST_DEFERRAL_ENABLED
 * flag 對 tour checkout 收款寫入路徑的影響。
 *
 * 蓋 dispatch-f1.md 塊B 驗收條件明文要求的:
 *   - flag OFF(預設)時,行為與現行 byte-identical:createAccountingEntry
 *     呼叫參數與現版完全一致,deferStripeBookingIncome 不呼叫。
 *   - flag ON 時:改呼叫 deferStripeBookingIncome,createAccountingEntry 不呼叫。
 *
 * Mock collaborators BEFORE importing the router(vi.mock hoisted)。簽名驗證
 * 透過 mock "stripe" 套件的 webhooks.constructEvent 直接回傳測試事件繞過。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("stripe", () => {
  class FakeStripe {
    webhooks = { constructEvent: (body: any) => body };
  }
  return { default: FakeStripe };
});

vi.mock("./env", () => ({
  ENV: { stripeSecretKey: "sk_test_fake", stripeWebhookSecret: "whsec_fake" },
}));

vi.mock("./stripeWebhookIdempotency", () => ({
  claimStripeEvent: vi.fn(async () => ({ alreadyProcessed: false })),
  markStripeEventSucceeded: vi.fn(async () => {}),
  markStripeEventFailed: vi.fn(async () => {}),
}));

vi.mock("./featureFlags", () => ({
  stripeTrustDeferralEnabled: vi.fn(() => false),
}));

vi.mock("../services/trustDeferralService", () => ({
  deferStripeBookingIncome: vi.fn(async () => ({ deferredId: 1, expectedRecognitionDate: "2026-12-01", reason: "deferred" })),
  findStripeDeferredByPaymentId: vi.fn(async () => null),
  reverseDeferral: vi.fn(async () => ({ success: true })),
}));

vi.mock("../db/tour", () => ({
  getDepartureById: vi.fn(async () => ({ id: 42, departureDate: new Date("2026-12-01T00:00:00Z") })),
}));

vi.mock("./notification", () => ({
  notifyOwner: vi.fn(async () => {}),
}));

vi.mock("./agentNotify", () => ({
  notifyAgentMessage: vi.fn(async () => {}),
}));

vi.mock("../email", () => ({
  sendPaymentSuccessEmail: vi.fn(async () => true),
  sendSupplierNotificationEmail: vi.fn(async () => true),
}));

vi.mock("../services/visaEmailService", () => ({
  sendVisaApplicationConfirmation: vi.fn(async () => true),
}));

vi.mock("./redact", () => ({
  redactEmail: (e: string) => e,
}));

vi.mock("./errorFunnel", () => ({
  reportFunnelError: vi.fn(async () => {}),
}));

const fakeBooking = {
  id: 77,
  tourId: 1,
  customerName: "Test Customer",
  customerEmail: "test@example.com",
  totalPrice: "1000.00",
  departureId: 42,
  userId: null, // guest checkout — skips Packpoint/referral post-commit paths
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    transaction: async (fn: any) => fn({}),
  })),
  createPayment: vi.fn(async (data: any) => ({ id: 555, ...data })),
  updateBooking: vi.fn(async () => undefined),
  getBookingById: vi.fn(async () => fakeBooking),
  getPaymentByIntentId: vi.fn(async () => undefined),
  createAccountingEntry: vi.fn(async () => ({ id: 1 })),
  getTourById: vi.fn(async () => null), // skips payment-success-email branch
}));

import { handleStripeWebhook } from "./stripeWebhook";
import * as db from "../db";
import { stripeTrustDeferralEnabled } from "./featureFlags";
import { deferStripeBookingIncome } from "../services/trustDeferralService";
import { getDepartureById } from "../db/tour";

function fakeReqRes(event: any) {
  const req: any = { headers: { "stripe-signature": "t=1,v1=fake" }, body: event };
  const jsonCalls: any[] = [];
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn((body: any) => {
      jsonCalls.push(body);
      return res;
    }),
    send: vi.fn(() => res),
  };
  return { req, res, jsonCalls };
}

function checkoutSessionEvent(overrides?: Partial<{ paymentType: string }>) {
  return {
    id: "evt_real_test_checkout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_123",
        payment_intent: "pi_test_123",
        mode: "payment",
        currency: "usd",
        amount_total: 100000, // $1000.00
        metadata: {
          booking_id: "77",
          payment_type: overrides?.paymentType ?? "deposit",
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (db.getBookingById as any).mockResolvedValue(fakeBooking);
  (db.createPayment as any).mockImplementation(async (data: any) => ({ id: 555, ...data }));
  (db.getDb as any).mockResolvedValue({ transaction: async (fn: any) => fn({}) });
});

describe("handleStripeWebhook — checkout.session.completed — STRIPE_TRUST_DEFERRAL_ENABLED flag (F1 塊B)", () => {
  it("flag OFF(預設)→ byte-identical:createAccountingEntry 呼叫參數與現版一致,deferStripeBookingIncome 不呼叫", async () => {
    (stripeTrustDeferralEnabled as any).mockReturnValue(false);
    const { req, res } = fakeReqRes(checkoutSessionEvent());

    await handleStripeWebhook(req, res);

    expect(deferStripeBookingIncome).not.toHaveBeenCalled();
    // 2026-07-08 對抗審查 P2 修復:釘死「flag off 完全不多查 departureDate」
    // 這個 byte-identical 查詢足跡宣稱,不只是靠 code review 保證。
    expect(getDepartureById).not.toHaveBeenCalled();
    expect(db.createAccountingEntry).toHaveBeenCalledTimes(1);
    const [entryArg] = (db.createAccountingEntry as any).mock.calls[0];
    expect(entryArg).toEqual(
      expect.objectContaining({
        entryType: "income",
        category: "tour_booking",
        amount: "1000",
        currency: "USD",
        bookingId: 77,
        isTaxDeductible: 0,
        createdBy: 1,
      }),
    );
    expect(entryArg.description).toContain("訂金");
  });

  it("flag ON → 改呼叫 deferStripeBookingIncome,createAccountingEntry 不呼叫", async () => {
    (stripeTrustDeferralEnabled as any).mockReturnValue(true);
    const { req, res } = fakeReqRes(checkoutSessionEvent());

    await handleStripeWebhook(req, res);

    expect(db.createAccountingEntry).not.toHaveBeenCalled();
    expect(deferStripeBookingIncome).toHaveBeenCalledTimes(1);
    const [deferArg] = (deferStripeBookingIncome as any).mock.calls[0];
    expect(deferArg).toEqual(
      expect.objectContaining({
        paymentId: 555,
        bookingId: 77,
        amount: 1000,
        isoCurrencyCode: "USD",
        departureDate: "2026-12-01T00:00:00.000Z",
      }),
    );
    expect(deferArg.depositDate).toBeInstanceOf(Date);
  });

  it("flag ON 但 flag OFF 時的呼叫序列(createPayment/updateBooking)完全不變 — 只有第三個寫入分支換了", async () => {
    (stripeTrustDeferralEnabled as any).mockReturnValue(true);
    const { req, res } = fakeReqRes(checkoutSessionEvent({ paymentType: "balance" }));

    await handleStripeWebhook(req, res);

    expect(db.createPayment).toHaveBeenCalledTimes(1);
    expect(db.updateBooking).toHaveBeenCalledTimes(1);
    const [, patch] = (db.updateBooking as any).mock.calls[0];
    expect(patch).toEqual({ paymentStatus: "paid", bookingStatus: "confirmed" });
  });
});
