/**
 * 臨時停止線 red-green — tour 類即時結帳 fail-closed 擋 (2026-07-10, Jeff 裁決).
 *
 * 錢的碼從嚴:證明
 *   (紅) 旗標 OFF (預設) → createCheckoutSession 對 tour booking 拋
 *        PRECONDITION_FAILED,且「絕不打 Stripe」(sessions.create 零呼叫,
 *        連 booking 查詢都不發生 —— 擋在最前面)。
 *   (綠) 旗標 ON → 擋被繞過,流程正常走到 Stripe 並回傳 url(證明擋是
 *        旗標閘控、可逆,退場時即時驗證邏輯直接接手這個位置)。
 *
 * 全 hermetic:Stripe / db / rateLimit / env / salesTax 皆 mock,不碰真實
 * 網路、DB 或 Stripe。visa / membership 走各自 router,不經此 procedure,
 * 故不受此旗標影響(見 business-logic.test.ts 的既有覆蓋)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stripe session-create spy shared into the hoisted vi.mock factory.
const { createSessionMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: createSessionMock } },
    webhooks: { constructEvent: vi.fn() },
  })),
}));

vi.mock("../db", () => ({
  getBookingById: vi.fn(),
  getTourById: vi.fn(),
}));

vi.mock("../rateLimit", () => ({
  checkCheckoutSessionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../_core/env", () => ({
  ENV: { stripeSecretKey: "sk_test_stopline", baseUrl: "https://test.local" },
}));

vi.mock("../services/salesTaxService", () => ({
  calculateSalesTax: vi.fn().mockReturnValue({ amount: 0, rate: 0, jurisdiction: "" }),
}));

import { bookingsPaymentRouter } from "./bookingsPayment";
import * as db from "../db";

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
  totalPrice: 2000,
  depositAmount: 400,
  remainingAmount: 1600,
  currency: "USD",
  bookingStatus: "pending",
  paymentStatus: "unpaid",
};

function ctx() {
  return {
    user: { id: 2, role: "user" },
    req: { protocol: "https", headers: { origin: "https://test.local" } },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  } as any;
}

describe("createCheckoutSession · 臨時停止線 (tour instant checkout)", () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    createSessionMock.mockResolvedValue({
      id: "cs_test_stopline",
      url: "https://checkout.stripe.com/pay/cs_test_stopline",
    });
    (db.getBookingById as any).mockReset();
    (db.getBookingById as any).mockResolvedValue(BOOKING);
    (db.getTourById as any).mockReset();
    (db.getTourById as any).mockResolvedValue({ id: 10, title: "Test Tour" });
    delete process.env.TOUR_INSTANT_CHECKOUT_ENABLED;
  });

  afterEach(() => {
    delete process.env.TOUR_INSTANT_CHECKOUT_ENABLED;
  });

  it("RED · flag OFF (default): blocks with PRECONDITION_FAILED and never calls Stripe", async () => {
    const caller = (bookingsPaymentRouter as any).createCaller(ctx());
    await expect(
      caller.createCheckoutSession({ bookingId: 55, paymentType: "deposit" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // 絕不打 Stripe —— 一分錢也擋。擋在最前面,連 booking 查詢都沒發生。
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(db.getBookingById as any).not.toHaveBeenCalled();
  });

  it("GREEN · flag ON: block is bypassed, flow reaches Stripe and returns a url", async () => {
    process.env.TOUR_INSTANT_CHECKOUT_ENABLED = "true";
    const caller = (bookingsPaymentRouter as any).createCaller(ctx());
    const result = await caller.createCheckoutSession({
      bookingId: 55,
      paymentType: "deposit",
    });

    expect(result).toHaveProperty("url");
    expect(typeof result.url).toBe("string");
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });
});
