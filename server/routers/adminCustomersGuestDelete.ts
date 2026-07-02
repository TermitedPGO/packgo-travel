/**
 * Pure gate for deleteGuestCustomer (customer-cockpit, 2026-07-01).
 *
 * Jeff:「不只是隱藏 也可以選擇刪除」— 但刪除是不可逆的,所以先過三重閘:
 *   1. profile 必須存在(NOT_FOUND)。
 *   2. 只有訪客能刪(userId IS NULL)。註冊會員刪 profile 會斷 users row 的
 *      歸戶鏈 → 只能隱藏(markNotCustomer)。
 *   3. 有任何生意痕跡(customOrders / totalSpend>0 / bookingCount>0)不准刪 —
 *      財務與訂單歷史不可逆,想收就用隱藏。
 *
 * 通過三閘的才是「純雜訊訪客」:刪 interactions / chat / documents(R2
 * best-effort)/ profile。純函式 + exhaustively unit-tested,router 只是執行。
 *
 * 錯誤訊息是給 Jeff(admin 後台)看的 server-side message,繁中,無破折號。
 */

export type GuestDeleteProfile = {
  userId: number | null;
  totalSpend: number;
  bookingCount: number;
} | null;

export type GuestDeleteVerdict =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "BAD_REQUEST"; message: string };

export function guestDeleteGate(
  profile: GuestDeleteProfile,
  customOrderCount: number,
): GuestDeleteVerdict {
  if (!profile) {
    return { ok: false, code: "NOT_FOUND", message: "找不到這位訪客" };
  }
  if (profile.userId != null) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "註冊會員不能刪除,只能隱藏",
    };
  }
  if (
    customOrderCount > 0 ||
    profile.totalSpend > 0 ||
    profile.bookingCount > 0
  ) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "這位客人有訂單或消費紀錄,不能刪除,請用隱藏",
    };
  }
  return { ok: true };
}
