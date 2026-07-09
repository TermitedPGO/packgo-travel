/**
 * Smoke test for Phase 4C · bookings sub-router extraction (post-4D).
 *
 * Phase 4C extracted 10 procedures from routers.ts L2714-3662. Phase 4D
 * (2026-05-19) moved the 2 money-path procedures (createCheckoutSession,
 * adminRefund) into ./bookingsPayment.ts. The two slimmed routers are
 * spread-composed back under the `bookings:` key in routers.ts so client
 * paths are unchanged.
 *
 * Phases 1.1 / 1.5 / 2.5 (supplier fulfillment) later added 3 admin
 * procedures — setSupplierStatus, getOrderPacket, setSupplierCost — bringing
 * the non-payment set to 11.
 *
 * Wave1 收尾補丁 (2026-07): added behavioral coverage for 3 fail-open wiring
 * points added to this router — each swallowed catch now also reports to the
 * error funnel (server/_core/errorFunnel.ts) so Jeff actually sees it instead
 * of the failure dying silently:
 *   - create: Packpoint discount USD-reconversion fallback (~line 253)
 *   - create: abandonment-recovery scheduling failure (~line 418)
 *   - getOrderPacket: supplier order-packet departure lookup failure (~line 781)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock collaborators BEFORE importing the router so the router picks up the
// mocked modules at construction time (same pattern as inquiries.test.ts).
vi.mock("../db", () => ({
  getTourById: vi.fn(),
  getDepartureById: vi.fn(),
  tryReserveDepartureSlots: vi.fn(),
  releaseDepartureSlots: vi.fn(),
  createBooking: vi.fn(),
  getBookingById: vi.fn(),
  getBookingParticipants: vi.fn(),
}));
vi.mock("../email", () => ({
  sendBookingConfirmationEmail: vi.fn(() => Promise.resolve()),
}));
vi.mock("../agents/exchangeRateAgent", () => ({
  convertCurrency: vi.fn(),
}));
vi.mock("../rateLimit", () => ({
  checkBookingCreateRateLimit: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 9, resetAt: 0 }),
  ),
  checkAdminMutationRateLimit: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 99, resetAt: 0 }),
  ),
}));
vi.mock("../_core/auditLog", () => ({
  audit: vi.fn(() => Promise.resolve()),
}));
vi.mock("../_core/packpoint", () => ({
  awardPackpoint: vi.fn(() => Promise.resolve()),
  deductPackpoint: vi.fn(() => Promise.resolve()),
}));
vi.mock("../queue", () => ({
  bookingFollowupQueue: { add: vi.fn(() => Promise.resolve()) },
}));
vi.mock("../queues/abandonmentRecoveryQueue", () => ({
  scheduleAbandonmentRecovery: vi.fn(() => Promise.resolve()),
  scheduleSeatExpiry: vi.fn(() => Promise.resolve()),
}));
vi.mock("../_core/errorFunnel", () => ({
  reportFunnelError: vi.fn(() => Promise.resolve()),
}));

import { bookingsRouter } from "./bookings";
import * as db from "../db";
import { convertCurrency } from "../agents/exchangeRateAgent";
import { bookingFollowupQueue } from "../queue";
import { scheduleAbandonmentRecovery, scheduleSeatExpiry } from "../queues/abandonmentRecoveryQueue";
import { reportFunnelError } from "../_core/errorFunnel";
import { deductPackpoint } from "../_core/packpoint";

describe("bookingsRouter (Phase 4C extraction, post-4D split)", () => {
  it("exposes the 12 non-payment procedures (2 moved to bookingsPayment)", () => {
    const procs = Object.keys((bookingsRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "create",
        "list",
        "listParticipants",
        "saveParticipants",
        "getById",
        "cancel",
        "adminList",
        "adminGetDetail",
        "adminUpdateStatus",
        // Phase 1.1 / 1.5 / 2.5 supplier-fulfillment admin procedures
        "setSupplierStatus",
        "getOrderPacket",
        "setSupplierCost",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// create — fail-open wiring points (Wave1 收尾補丁)
// ---------------------------------------------------------------------------
describe("bookingsRouter.create — fail-open wiring points", () => {
  function makeUserContext(overrides: { id?: number; packpointBalance?: number } = {}) {
    return {
      req: { headers: {}, socket: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
      user: {
        id: overrides.id ?? 1,
        role: "user",
        email: "buyer@example.com",
        packpointBalance: overrides.packpointBalance ?? 100_000,
      },
      ip: "127.0.0.1",
    };
  }

  const baseTour = {
    id: 500,
    title: "北海道親子賞雪 5 日",
    priceCurrency: "TWD",
    sourceVendor: "UV",
  };
  const futureDeparture = {
    id: 900,
    tourId: 500,
    departureDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    returnDate: new Date(Date.now() + 35 * 24 * 3600 * 1000),
    status: "open",
    adultPrice: 30_000,
    childPriceWithBed: 27_000,
    childPriceNoBed: 21_000,
    infantPrice: 3_000,
    singleRoomSupplement: 5_000,
    currency: "TWD",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (db.getTourById as any).mockResolvedValue({ ...baseTour });
    (db.getDepartureById as any).mockResolvedValue({ ...futureDeparture });
    (db.tryReserveDepartureSlots as any).mockResolvedValue({ reserved: true, available: 10 });
    (db.releaseDepartureSlots as any).mockResolvedValue(undefined);
    (db.createBooking as any).mockResolvedValue({ id: 4242, tourId: 500, departureId: 900 });
    (bookingFollowupQueue.add as any).mockResolvedValue(undefined);
    (scheduleAbandonmentRecovery as any).mockResolvedValue(undefined);
    (scheduleSeatExpiry as any).mockResolvedValue(undefined);
  });

  // 接線點 3/5: Packpoint 折扣換算 USD 備援 (~L253)
  it("discount USD-reconversion failure: reports to the error funnel with source 'fail-open:bookings:discountReconversionFallback', falls back to the requested USD amount, booking still succeeds", async () => {
    // First call: requestedDiscountUsd(5) USD → TWD, succeeds (150 TWD).
    // Second call: that 150 TWD back → USD (for the points-consumed math),
    // rejects — this is the reconversion catch under test.
    (convertCurrency as any)
      .mockResolvedValueOnce(150)
      .mockRejectedValueOnce(new Error("FX service down"));

    const caller = (bookingsRouter as any).createCaller(makeUserContext());
    const result = await caller.create({
      tourId: 500,
      departureId: 900,
      numberOfAdults: 2,
      contactName: "王小明",
      contactPhone: "+886-912-345-678",
      pointsToRedeem: 500, // requestedDiscountUsd = 5
    });

    // Original behavior unchanged: booking creation still completes, using
    // the safe fallback (requestedDiscountUsd) for the points-consumed math
    // instead of throwing / corrupting the booking.
    expect(result).toEqual({ id: 4242, tourId: 500, departureId: 900 });
    // grossTotalPrice = 2 * 30000 = 60000; finalDiscount = min(150, 50%*60000) = 150
    // → totalPrice = 60000 - 150 = 59850 (proves the discount math still ran).
    expect((db.createBooking as any).mock.calls[0][0].totalPrice).toBe(59_850);
    expect(reportFunnelError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:bookings:discountReconversionFallback",
        context: { departureCurrency: "TWD" },
      }),
    );
    // 2026-07 審查二 P0 修復:上面三個斷言(result / totalPrice / funnel)全部
    // 不受 fallback 值本身影響 —— totalPrice 在 catch 之前就算好了。真正吃到
    // fallback 值的是 pointsRedeemed = Math.floor(finalDiscountUsd * 100),
    // 這裡 finalDiscountUsd 因為重轉失敗而 fallback 回 requestedDiscountUsd(5),
    // 所以 pointsRedeemed 必須是 500(= 5 * 100),不是用 finalDiscount(150,
    // 單位是 TWD 不是 USD)算出來的 15000,也不是 0。鎖進 deductPackpoint 的
    // 呼叫參數,才能真的抓到「fallback 值有沒有流進折扣計算」這個回歸。
    expect(deductPackpoint).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500 }),
    );
  });

  // 接線點 4/5: 棄單挽回排程失敗 (~L418)
  it("abandonment-recovery scheduling failure: warns + reports to the error funnel with source 'fail-open:bookings:abandonmentRecoveryScheduleFailed', booking mutation still resolves", async () => {
    (scheduleAbandonmentRecovery as any).mockRejectedValueOnce(new Error("redis down"));
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const caller = (bookingsRouter as any).createCaller(makeUserContext());
    const result = await caller.create({
      tourId: 500,
      departureId: 900,
      numberOfAdults: 2,
      contactName: "王小明",
      contactPhone: "+886-912-345-678",
    });

    // Original behavior unchanged: the customer-facing mutation still
    // resolves with the booking — scheduling failure never blocks checkout.
    expect(result).toEqual({ id: 4242, tourId: 500, departureId: 900 });
    // Original console.warn logging is preserved alongside the new funnel report.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[bookings.create] Failed to schedule abandonment recovery:",
      expect.any(String),
    );
    expect(reportFunnelError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:bookings:abandonmentRecoveryScheduleFailed",
        context: { bookingId: 4242 },
      }),
    );

    consoleWarnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getOrderPacket — fail-open wiring point (Wave1 收尾補丁)
// ---------------------------------------------------------------------------
describe("bookingsRouter.getOrderPacket — fail-open wiring point (departure lookup)", () => {
  function makeAdminContext() {
    return {
      req: { headers: {}, socket: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
      user: { id: 1, role: "admin" },
      ip: "127.0.0.1",
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 接線點 5/5: 供應商訂單包 departure 查詢失敗 (~L781)
  it("departure lookup failure: reports to the error funnel with source 'fail-open:bookings:getOrderPacket:departure', packet still returns (departureDate=null) instead of throwing", async () => {
    (db.getBookingById as any).mockResolvedValue({
      id: 77,
      tourId: 500,
      departureId: 900,
      customerName: "王小明",
      customerEmail: "ming@example.com",
      customerPhone: "+886-912-345-678",
      numberOfAdults: 2,
      numberOfChildrenWithBed: 0,
      numberOfChildrenNoBed: 0,
      numberOfInfants: 0,
      supplierBookingRef: null,
    });
    (db.getTourById as any).mockResolvedValue({
      id: 500,
      title: "北海道親子賞雪 5 日",
      sourceVendor: "UV",
    });
    (db.getDepartureById as any).mockRejectedValue(new Error("connection reset"));
    (db.getBookingParticipants as any).mockResolvedValue([]);

    const caller = (bookingsRouter as any).createCaller(makeAdminContext());
    const packet = await caller.getOrderPacket({ id: 77 });

    // Original behavior unchanged: the packet still assembles — a failed
    // departure lookup degrades to null instead of failing the whole packet
    // (which would block Jeff from placing the supplier order at all).
    expect(packet.bookingId).toBe(77);
    expect(packet.departureDate).toBeNull();
    expect(reportFunnelError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:bookings:getOrderPacket:departure",
        context: { bookingId: 77, departureId: 900 },
      }),
    );
  });
});
