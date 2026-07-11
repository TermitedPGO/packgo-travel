/**
 * createCheckoutSession × 即時驗證 × 揭露存證 red-green(checkout-verify 批)。
 *
 * 錨定的錢路合約(錢的碼,從嚴):
 *   1. 驗證失敗 → Session 不建、Stripe 零呼叫,且失敗存證落庫(status=
 *      verification_failed)供漏斗量測。
 *   2. 驗證通過 → 先落揭露存證(session_created,含 snapshot/verification)
 *      → 才建 Stripe Session → 回填 sessionId;metadata 帶 disclosure_id 釘死。
 *   3. 存證寫入失敗 → 不建 Session(fail-closed:沒有存證的收款不存在)。
 *   4. sessionId 回填失敗 → 不回傳付款 URL(Session 60 分鐘自然過期,無錢動)。
 *   5. 本地缺 departure → 擋(驗不了 = 擋)。
 *   6. 旗標 OFF → 全擋且連驗證都不跑(停止線語意,另見 stopline.test)。
 *
 * 全 hermetic:Stripe / db / rateLimit / env / salesTax / checkoutVerification
 * 皆 mock。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createSessionMock } = vi.hoisted(() => ({ createSessionMock: vi.fn() }));

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: createSessionMock } },
    webhooks: { constructEvent: vi.fn() },
  })),
}));

vi.mock("../db", () => ({
  getBookingById: vi.fn(),
  getTourById: vi.fn(),
  getDepartureById: vi.fn(),
  createCheckoutDisclosure: vi.fn(),
  setCheckoutDisclosureSession: vi.fn(),
}));

vi.mock("../rateLimit", () => ({
  checkCheckoutSessionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../_core/env", () => ({
  ENV: { stripeSecretKey: "sk_test_verify", baseUrl: "https://test.local" },
}));

vi.mock("../services/salesTaxService", () => ({
  calculateSalesTax: vi.fn().mockReturnValue({ amount: 0, rate: 0, jurisdiction: "" }),
}));

vi.mock("../services/checkoutVerification", () => ({
  verifyTourCheckout: vi.fn(),
}));

import { bookingsPaymentRouter } from "./bookingsPayment";
import * as db from "../db";
import { verifyTourCheckout } from "../services/checkoutVerification";

const BOOKING = {
  id: 55,
  userId: 2,
  tourId: 10,
  departureId: 3,
  customerName: "Test Customer",
  customerEmail: "test@example.com",
  customerPhone: "+1-510-000-0000",
  numberOfAdults: 2,
  numberOfChildrenWithBed: 0,
  numberOfChildrenNoBed: 0,
  numberOfInfants: 0,
  numberOfSingleRooms: 0,
  totalPrice: 2470,
  depositAmount: 494,
  remainingAmount: 1976,
  currency: "USD",
  bookingStatus: "pending",
  paymentStatus: "unpaid",
  supplierStatus: "not_placed",
};

const TOUR = {
  id: 10,
  title: "美西大峽谷七日",
  status: "active",
  sourceUrl: "https://uvbookings.toursbms.com/product/detail/P00002255",
};

const DEPARTURE = {
  id: 3,
  departureDate: new Date(2026, 8, 15, 8, 0, 0),
  adultPrice: 1235,
  currency: "USD",
};

const PASS_RESULT = {
  ok: true,
  verification: { mode: "uv_live", outcome: "passed", productCode: "P00002255" },
  snapshot: { pricing: { amountToCharge: 494 } },
};

const FAIL_RESULT = {
  ok: false,
  reason: "price_changed",
  verification: { mode: "uv_live", outcome: "failed", failReason: "price_changed" },
  snapshot: { pricing: { amountToCharge: 494 } },
};

function ctx() {
  return {
    user: { id: 2, role: "user" },
    req: { protocol: "https", headers: { origin: "https://test.local" } },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  } as any;
}

const caller = () => (bookingsPaymentRouter as any).createCaller(ctx());

describe("createCheckoutSession · 即時驗證 + 揭露存證", () => {
  beforeEach(() => {
    process.env.TOUR_INSTANT_CHECKOUT_ENABLED = "true";
    createSessionMock.mockReset();
    createSessionMock.mockResolvedValue({
      id: "cs_test_verify_1",
      url: "https://checkout.stripe.com/pay/cs_test_verify_1",
    });
    (db.getBookingById as any).mockReset().mockResolvedValue(BOOKING);
    (db.getTourById as any).mockReset().mockResolvedValue(TOUR);
    (db.getDepartureById as any).mockReset().mockResolvedValue(DEPARTURE);
    (db.createCheckoutDisclosure as any)
      .mockReset()
      .mockImplementation(async (row: any) => ({ id: 77, ...row }));
    (db.setCheckoutDisclosureSession as any).mockReset().mockResolvedValue(undefined);
    (verifyTourCheckout as any).mockReset().mockResolvedValue(PASS_RESULT);
  });

  afterEach(() => {
    delete process.env.TOUR_INSTANT_CHECKOUT_ENABLED;
  });

  it("RED · 驗證失敗 → PRECONDITION_FAILED、Stripe 零呼叫、失敗存證落庫", async () => {
    (verifyTourCheckout as any).mockResolvedValue(FAIL_RESULT);
    await expect(
      caller().createCheckoutSession({ bookingId: 55, paymentType: "deposit" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(db.setCheckoutDisclosureSession as any).not.toHaveBeenCalled();
    // 失敗也要存證(漏斗量測)
    expect(db.createCheckoutDisclosure as any).toHaveBeenCalledTimes(1);
    const row = (db.createCheckoutDisclosure as any).mock.calls[0][0];
    expect(row).toMatchObject({
      bookingId: 55,
      paymentType: "deposit",
      status: "verification_failed",
      snapshot: FAIL_RESULT.snapshot,
      verification: FAIL_RESULT.verification,
    });
    expect(row.verifiedAt).toBeInstanceOf(Date);
  });

  it("RED · 失敗存證本身寫不進去 → 照樣擋(存證失敗不掩蓋擋單)", async () => {
    (verifyTourCheckout as any).mockResolvedValue(FAIL_RESULT);
    (db.createCheckoutDisclosure as any).mockRejectedValue(new Error("db down"));
    await expect(
      caller().createCheckoutSession({ bookingId: 55, paymentType: "deposit" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("GREEN · 驗證通過 → 先落存證、再建 Session、回填 sessionId、metadata 帶 disclosure_id", async () => {
    const result = await caller().createCheckoutSession({
      bookingId: 55,
      paymentType: "deposit",
    });

    expect(result.url).toContain("checkout.stripe.com");
    // 順序:存證先於 Stripe
    const disclosureOrder = (db.createCheckoutDisclosure as any).mock
      .invocationCallOrder[0];
    const stripeOrder = createSessionMock.mock.invocationCallOrder[0];
    expect(disclosureOrder).toBeLessThan(stripeOrder);
    // 存證內容
    const row = (db.createCheckoutDisclosure as any).mock.calls[0][0];
    expect(row).toMatchObject({
      bookingId: 55,
      paymentType: "deposit",
      status: "session_created",
      snapshot: PASS_RESULT.snapshot,
      verification: PASS_RESULT.verification,
    });
    // sessionId 回填到同一列
    expect(db.setCheckoutDisclosureSession as any).toHaveBeenCalledWith(
      77,
      "cs_test_verify_1",
    );
    // metadata 釘死
    const sessionArgs = createSessionMock.mock.calls[0][0];
    expect(sessionArgs.metadata.disclosure_id).toBe("77");
    expect(sessionArgs.metadata.booking_id).toBe("55");
    // 驗證收到完整 context
    expect(verifyTourCheckout as any).toHaveBeenCalledWith(
      expect.objectContaining({
        booking: BOOKING,
        tour: TOUR,
        departure: DEPARTURE,
        paymentType: "deposit",
      }),
    );
  });

  it("RED · 驗證通過但存證寫入失敗 → 不建 Session(沒有存證的收款不存在)", async () => {
    (db.createCheckoutDisclosure as any).mockRejectedValue(new Error("db down"));
    await expect(
      caller().createCheckoutSession({ bookingId: 55, paymentType: "deposit" }),
    ).rejects.toThrow();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("RED · sessionId 回填失敗 → 不回傳付款 URL(拋錯,客人拿不到連結)", async () => {
    (db.setCheckoutDisclosureSession as any).mockRejectedValue(new Error("db down"));
    await expect(
      caller().createCheckoutSession({ bookingId: 55, paymentType: "deposit" }),
    ).rejects.toThrow();
    // Session 已建(Stripe 端 60 分鐘過期),但 URL 絕不回傳 = 無錢動
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("RED · 本地缺 departure(驗不了)→ 擋、Stripe 零呼叫、驗證不跑", async () => {
    (db.getDepartureById as any).mockResolvedValue(undefined);
    await expect(
      caller().createCheckoutSession({ bookingId: 55, paymentType: "deposit" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(verifyTourCheckout as any).not.toHaveBeenCalled();
  });

  it("RED · 旗標 OFF → 全擋,連驗證都不跑(停止線語意)", async () => {
    delete process.env.TOUR_INSTANT_CHECKOUT_ENABLED;
    await expect(
      caller().createCheckoutSession({ bookingId: 55, paymentType: "deposit" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(verifyTourCheckout as any).not.toHaveBeenCalled();
    expect(db.createCheckoutDisclosure as any).not.toHaveBeenCalled();
  });

  it("GREEN · remaining 走同一條驗證存證路(paymentType 透傳)", async () => {
    (verifyTourCheckout as any).mockResolvedValue({
      ...PASS_RESULT,
      verification: { ...PASS_RESULT.verification, mode: "balance_vendor_confirmed" },
    });
    const result = await caller().createCheckoutSession({
      bookingId: 55,
      paymentType: "remaining",
    });
    expect(result.url).toBeTruthy();
    expect(verifyTourCheckout as any).toHaveBeenCalledWith(
      expect.objectContaining({ paymentType: "remaining" }),
    );
    const row = (db.createCheckoutDisclosure as any).mock.calls[0][0];
    expect(row.paymentType).toBe("remaining");
  });
});
