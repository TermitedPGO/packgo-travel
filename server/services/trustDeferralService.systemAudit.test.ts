/**
 * F2 塊A — 接線測試(trustDeferralService 兩處)。
 *
 * 釘死 deferStripeBookingIncome 與 reverseDeferral 兩條財務動作各發一筆
 * systemAudit,actor/action/金額正確。這兩處都是 fire-and-forget
 * (`void systemAudit(...).catch()`),reverseDeferral 更是在 await 過一次
 * db.select 之後才發 —— 依 T2 地雷 #6 一律 vi.waitFor 輪詢正向斷言,禁固定等待;
 * 本檔連跑 5 次證穩(見完工報告)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const systemAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("../_core/auditLog", () => ({ systemAudit: (...a: unknown[]) => systemAudit(...a) }));

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));

import { deferStripeBookingIncome, reverseDeferral } from "./trustDeferralService";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deferStripeBookingIncome → systemAudit(trust.defer)", () => {
  it("建立遞延成功後發稽核:actor=system:trustDeferral、action=trust.defer、target=bookingId、金額齊全", async () => {
    // tx.insert(...).values(...) 回傳 [{ insertId }]
    const tx = {
      insert: () => ({ values: () => Promise.resolve([{ insertId: 999 }]) }),
    };

    await deferStripeBookingIncome(
      {
        paymentId: 5,
        bookingId: 77,
        amount: 1234.56,
        isoCurrencyCode: "USD",
        depositDate: new Date("2026-07-01T12:00:00Z"),
        departureDate: "2026-09-01",
      },
      tx as never,
    );

    await vi.waitFor(() => {
      expect(systemAudit).toHaveBeenCalledWith(
        "system:trustDeferral",
        "trust.defer",
        77,
        expect.objectContaining({ amount: 1234.56, paymentId: 5, deferredId: 999 }),
      );
    });
  });
});

describe("reverseDeferral → systemAudit(trust.reverse)", () => {
  it("撤銷後讀回金額並發稽核:actor/action 正確、金額來自遞延列", async () => {
    const db = {
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ amount: "500.00", bookingId: 77 }]) }),
        }),
      }),
    };
    getDb.mockResolvedValue(db);

    const res = await reverseDeferral({ deferredId: 12, reason: "客人取消,全額退款" });
    expect(res).toEqual({ success: true });

    // fire-and-forget:systemAudit 在 await db.select 之後才發,必 vi.waitFor
    await vi.waitFor(() => {
      expect(systemAudit).toHaveBeenCalledWith(
        "system:trustDeferral",
        "trust.reverse",
        12,
        expect.objectContaining({ amount: "500.00", bookingId: 77, reason: "客人取消,全額退款" }),
      );
    });
  });
});
