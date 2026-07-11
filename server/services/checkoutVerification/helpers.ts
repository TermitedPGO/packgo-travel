/**
 * checkoutVerification/helpers — 純函式與小工具(可直接單元測,不碰網路/DB)。
 * 主流程見 ./index.ts,型別見 ./types.ts。
 */

import type { BookingForVerification, DepartureForVerification } from "./types";

/**
 * 從 tours.sourceUrl / tours.productCode 解出 UV productCode(P00…)。
 * 鏡射 catalogRebuild.extractUvProductCode 的規則(host 判定 + /detail/<code>);
 * 不 import catalogRebuild/index.ts 以免把整個重建依賴圖拖進錢路。
 * 非 UV(含 Lion、手工團、無 sourceUrl)→ null = unsupported_supplier。
 */
export function resolveUvProductCode(
  sourceUrl: string | null | undefined,
  productCode?: string | null,
): string | null {
  if (!sourceUrl || !sourceUrl.includes("uvbookings.toursbms.com")) return null;
  const m = sourceUrl.match(/\/detail\/([^/?#]+)/);
  if (m?.[1]) return m[1];
  // 早期匯入可能只有 productCode 欄乾淨(sourceUrl 帶 host 但路徑異形)。
  if (productCode && /^P\d+/.test(productCode)) return productCode;
  return null;
}

/** 以「本地曆日」格式化(班期 Date 是本環境以 local 8:00 建構的;禁 toISOString 以免時區飄日)。 */
export function localCalendarDate(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 訂位占位人數(嬰兒不佔位 — 與 bookings.create / 退款釋位同一口徑)。 */
export function seatsRequested(b: BookingForVerification): number {
  return (
    (b.numberOfAdults || 0) +
    (b.numberOfChildrenWithBed || 0) +
    (b.numberOfChildrenNoBed || 0)
  );
}

/**
 * 以「現行班期價 × 本單人數」複算 gross(與 bookings.create 同公式)。
 * 防超收:booking.totalPrice 大於現行基準 → 擋。
 * (小於現行基準可能是 Packpoint 折抵或供應商漲價後的舊單 —— 不擋但記錄,
 * 見 VerificationRecord.checks.grossGuard;已知限制,報告申報。)
 */
export function recomputeGrossTotal(
  b: BookingForVerification,
  d: DepartureForVerification,
): number {
  const adultPrice = d.adultPrice;
  const childWithBedPrice = d.childPriceWithBed ?? adultPrice;
  const childNoBedPrice = d.childPriceNoBed ?? Math.floor(adultPrice * 0.7);
  const infantPrice = d.infantPrice ?? 0;
  const singleSupplement = d.singleRoomSupplement ?? 0;
  return (
    (b.numberOfAdults || 0) * adultPrice +
    (b.numberOfChildrenWithBed || 0) * childWithBedPrice +
    (b.numberOfChildrenNoBed || 0) * childNoBedPrice +
    (b.numberOfInfants || 0) * infantPrice +
    (b.numberOfSingleRooms || 0) * singleSupplement
  );
}

/** 必付清單多重集合比較(順序無關;重複項計數)。 */
export function mandatoryFeeListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const count = new Map<string, number>();
  for (const s of a) count.set(s, (count.get(s) ?? 0) + 1);
  for (const s of b) {
    const c = count.get(s);
    if (!c) return false;
    count.set(s, c - 1);
  }
  return true;
}

/** parseUvPriceTerms.excluded 中的必付行(R4 起以 `必付:` 前綴落格式)。 */
export function extractMandatoryFeeLines(excluded: string[] | null | undefined): string[] {
  return (excluded ?? []).filter((s) => typeof s === "string" && s.startsWith("必付:"));
}

export class VerificationTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`checkout verification timed out after ${ms}ms at ${label}`);
    this.name = "VerificationTimeoutError";
  }
}

/** 逐呼叫預算(fail-closed:逾時 = supplier_unreachable,絕不等到 uvClient 的 60s)。 */
export function withBudget<T>(p: Promise<T>, label: string, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new VerificationTimeoutError(label, ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * 供應商端「明確說不」vs「通道壞了」的分類:uvClient 對 responseResult 非 200
 * 的軟失敗丟含 "responseResult" 的 SupplierApiError;網路/HTTP 層則是
 * "network error" / "HTTP 5xx"。兩者都擋,只差觀測歸因。
 */
export function classifyUvError(err: unknown): "product_not_on_sale" | "supplier_unreachable" {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("responseResult") ? "product_not_on_sale" : "supplier_unreachable";
}

export const toIsoOrNull = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
