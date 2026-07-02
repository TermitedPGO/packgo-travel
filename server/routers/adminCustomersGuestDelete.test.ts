/**
 * guestDeleteGate — 訪客刪除的三重拒絕閘 (customer-cockpit, 2026-07-01)。
 *
 * Jeff:「不只是隱藏 也可以選擇刪除」。刪除不可逆,所以 gate 順序照 router:
 *   1. profile 不存在 → NOT_FOUND
 *   2. 註冊會員(userId 非 NULL)→ 拒絕,只能隱藏
 *   3. 有生意痕跡(customOrders / totalSpend>0 / bookingCount>0)→ 拒絕,請用隱藏
 * 全過 → ok。純函式,adminCustomersFilter.test.ts 同款 pattern。
 */

import { describe, it, expect } from "vitest";
import { guestDeleteGate } from "./adminCustomersGuestDelete";

const cleanGuest = { userId: null, totalSpend: 0, bookingCount: 0 };

describe("guestDeleteGate — 三重拒絕閘", () => {
  it("profile missing → NOT_FOUND", () => {
    const v = guestDeleteGate(null, 0);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("NOT_FOUND");
  });

  it("registered account (userId set) → refused, message says hide only", () => {
    const v = guestDeleteGate({ ...cleanGuest, userId: 42 }, 0);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("BAD_REQUEST");
      expect(v.message).toContain("隱藏");
      expect(v.message).toContain("註冊");
    }
  });

  it("has customOrders → refused (訂單歷史不可逆)", () => {
    const v = guestDeleteGate(cleanGuest, 2);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("BAD_REQUEST");
      expect(v.message).toContain("隱藏");
    }
  });

  it("totalSpend > 0 → refused", () => {
    expect(guestDeleteGate({ ...cleanGuest, totalSpend: 500 }, 0).ok).toBe(false);
  });

  it("bookingCount > 0 → refused", () => {
    expect(guestDeleteGate({ ...cleanGuest, bookingCount: 1 }, 0).ok).toBe(false);
  });

  it("registered check wins over records check (never leaks a wrong reason)", () => {
    const v = guestDeleteGate({ userId: 42, totalSpend: 900, bookingCount: 3 }, 5);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toContain("註冊");
  });

  it("pure-noise guest (no user, no orders, no spend, no bookings) → ok", () => {
    expect(guestDeleteGate(cleanGuest, 0)).toEqual({ ok: true });
  });

  it("error messages carry no em dash (客人訊息鐵律 applies to UI-facing copy)", () => {
    for (const v of [
      guestDeleteGate(null, 0),
      guestDeleteGate({ ...cleanGuest, userId: 1 }, 0),
      guestDeleteGate(cleanGuest, 1),
    ]) {
      if (!v.ok) expect(v.message).not.toContain("—");
    }
  });
});
