/**
 * checkoutVerification/types — 結帳前即時驗證與揭露快照的型別
 * (checkout-verify 批, 2026-07-11)。主流程見 ./index.ts。
 */

import type { UvDepartureRow, UvProductTravelDetail } from "../../suppliers/uvClient";

/** 擋單原因(結構化,進 log + verification JSON 供漏斗量測)。 */
export type CheckoutBlockReason =
  | "unsupported_supplier" // 非 UV 商品 — 無即時 API 可驗,fail-closed
  | "tour_not_active" // 本站商品已下架
  | "product_not_on_sale" // 供應商端商品已不存在/不可售
  | "departure_not_found" // 該出發日在供應商端已消失
  | "insufficient_seats" // 供應商端餘位不足(或該團期已關閉)
  | "price_changed" // 現價與頁面展示價不一致(含超收防護)
  | "mandatory_fees_changed" // 必付費用清單與頁面展示不一致
  | "currency_mismatch" // 幣別基準對不上(UV 基準 USD)
  | "supplier_unreachable" // UV API 逾時/炸 — fail-closed
  | "balance_without_vendor_confirmation"; // 尾款但供應商尚未確認座位

export interface BookingForVerification {
  id: number;
  tourId: number;
  departureId: number;
  currency: string;
  numberOfAdults: number;
  numberOfChildrenWithBed: number;
  numberOfChildrenNoBed: number;
  numberOfInfants: number;
  numberOfSingleRooms: number;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
  supplierStatus?: string | null;
  disclaimerVersion?: string | null;
  disclaimerAcceptedAt?: Date | string | null;
}

export interface TourForVerification {
  id: number;
  title: string;
  status: string;
  sourceUrl?: string | null;
  productCode?: string | null;
}

export interface DepartureForVerification {
  id: number;
  departureDate: Date | string;
  returnDate?: Date | string | null;
  adultPrice: number;
  childPriceWithBed?: number | null;
  childPriceNoBed?: number | null;
  infantPrice?: number | null;
  singleRoomSupplement?: number | null;
  currency?: string | null;
}

/** 注入點:live UV API(測試用 stub;預設接 repo 既有 uvClient)。 */
export interface UvLiveApi {
  getProductMain(productCode: string): Promise<unknown>;
  getProductGroup(input: {
    productCode: string;
    startTime: string;
    endTime: string;
  }): Promise<UvDepartureRow[]>;
  getProductTravelDetail(productCode: string): Promise<UvProductTravelDetail>;
}

/** 頁面展示側的存量明細(supplierProductDetails 的必付清單 + 條款文字 + 新鮮度)。 */
export interface StoredSupplierDetail {
  mandatoryFeeLines: string[];
  paymentTerms: string | null;
  cancellationPolicy: string[];
  priceTermsFetchedAt: Date | string | null;
  supplierLastSyncedAt: Date | string | null;
}

/** 驗證結果與時間戳(落 checkoutDisclosures.verification)。 */
export interface VerificationRecord {
  mode: "uv_live" | "balance_vendor_confirmed" | "blocked";
  outcome: "passed" | "failed";
  failReason?: CheckoutBlockReason;
  productCode: string | null;
  checks: {
    tourActive?: boolean;
    productOnSale?: boolean;
    departureFound?: boolean;
    seats?: { requested: number; liveSpare: number | null; liveStockStatus: number | null };
    price?: { displayedAdultPrice: number; liveAdultPrice: number | null };
    grossGuard?: { bookingTotal: number; recomputedGross: number };
    mandatoryFees?: { displayed: string[]; live: string[] | null };
    currency?: { booking: string; departure: string | null; live: string | null };
  };
  supplierFreshness: {
    supplierLastSyncedAt: string | null;
    priceTermsFetchedAt: string | null;
    liveCheckedAt: string;
  };
  elapsedMs: number;
}

/** 客戶即將同意的版本快照(落 checkoutDisclosures.snapshot)。 */
export interface DisclosureSnapshot {
  tour: { id: number; title: string; productCode: string | null; sourceUrl: string | null };
  departure: { id: number; date: string; returnDate: string | null };
  pricing: {
    currency: string;
    adultPrice: number;
    childPriceWithBed: number | null;
    childPriceNoBed: number | null;
    infantPrice: number | null;
    singleRoomSupplement: number | null;
    counts: {
      adults: number;
      childrenWithBed: number;
      childrenNoBed: number;
      infants: number;
      singleRooms: number;
    };
    totalPrice: number;
    depositAmount: number;
    remainingAmount: number;
    paymentType: "deposit" | "remaining";
    amountToCharge: number;
  };
  mandatoryFees: string[];
  policy: {
    paymentTerms: string | null;
    cancellationPolicy: string[];
    disclaimerVersion: string | null;
    disclaimerAcceptedAt: string | null;
  };
  displayedDataTimestamps: {
    priceTermsFetchedAt: string | null;
    supplierLastSyncedAt: string | null;
  };
}

export interface VerifyResult {
  ok: boolean;
  reason?: CheckoutBlockReason;
  verification: VerificationRecord;
  snapshot: DisclosureSnapshot;
}

export const EMPTY_STORED_DETAIL: StoredSupplierDetail = {
  mandatoryFeeLines: [],
  paymentTerms: null,
  cancellationPolicy: [],
  priceTermsFetchedAt: null,
  supplierLastSyncedAt: null,
};
