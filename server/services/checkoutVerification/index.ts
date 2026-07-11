/**
 * checkoutVerification — 結帳前即時驗位驗價 + 付款前揭露快照組裝
 * (checkout-verify 批, 2026-07-11;外部顧問第二輪審計 §二/§三 模式一「即時驗證後請款」)。
 *
 * 在建立 Stripe Checkout Session 之前,伺服器用既有 uvClient(免登入)對 UV 商品
 * 重新驗證:
 *   (a) 商品仍在售        — tours.status active + live getProductMain 成功
 *   (b) 所選班期仍有位    — live getProductGroup 該日 stockStatus=200 且餘位 >= 本單人數
 *   (c) 現價(含必付)一致 — live pt4/pt1 成人價 === tourDepartures.adultPrice(容差 $0,
 *                            同一把尺:pickDepartureAdultPrice,與匯入管線同函式);
 *                            live 必付費用清單 === 頁面展示的必付清單(supplierProductDetails
 *                            priceTermsParsed,同 parseUvPriceTerms 產生);
 *                            並複算「以現行班期價 × 本單人數」防超收
 *   (d) 供應商資料新鮮度  — 記錄 lastSyncedAt / priceTermsFetchedAt / liveCheckedAt
 *
 * 任一失敗、API 逾時或炸 → fail-closed(絕不 fail-open 收錢)。
 * 非 UV 商品(暫無即時 API 可驗)一律擋 —— 外部顧問與指揮一致的硬邊界。
 *
 * 尾款(remaining)特例:座位已由供應商確認(bookings.supplierStatus =
 * vendor_confirmed)才放行,且不重驗 live 位價(價格是成約價、位子是自己的);
 * 未經供應商確認的尾款一律擋。
 *
 * 所有結果(過/不過)由 caller 落 checkoutDisclosures 存證;本模組同時發
 * 結構化 log(event=checkout_verification)供漏斗量測(失敗率、擋單原因分佈)。
 *
 * 模組劃分(300 行紅線):types.ts 型別 / helpers.ts 純函式 / snapshot.ts
 * 頁面側載入+快照組裝 / uvLiveChecks.ts live 驗證段 / 本檔主流程。
 */

import {
  getProductMain,
  getProductGroup,
  getProductTravelDetail,
} from "../../suppliers/uvClient";
import { createChildLogger } from "../../_core/logger";
import { resolveUvProductCode, toIsoOrNull } from "./helpers";
import { buildDisclosureSnapshot, loadStoredSupplierDetail } from "./snapshot";
import { runUvLiveChecks } from "./uvLiveChecks";
import {
  EMPTY_STORED_DETAIL,
  type BookingForVerification,
  type CheckoutBlockReason,
  type DepartureForVerification,
  type StoredSupplierDetail,
  type TourForVerification,
  type UvLiveApi,
  type VerificationRecord,
  type VerifyResult,
} from "./types";

// Re-exports:router / 測試的單一入口(路徑 "../services/checkoutVerification" 不變)。
export * from "./types";
export {
  resolveUvProductCode,
  localCalendarDate,
  seatsRequested,
  recomputeGrossTotal,
  mandatoryFeeListsEqual,
  extractMandatoryFeeLines,
} from "./helpers";
export { loadStoredSupplierDetail, buildDisclosureSnapshot } from "./snapshot";

const log = createChildLogger({ module: "checkoutVerification" });

const DEFAULT_CALL_BUDGET_MS = 12_000;

const defaultApi: UvLiveApi = {
  getProductMain,
  getProductGroup,
  getProductTravelDetail,
};

/**
 * 結帳前驗證主入口。回傳 ok / reason + 完整 verification 與 snapshot
 * (兩者不論過/不過都齊,caller 直接落 checkoutDisclosures)。
 * 絕不 throw(所有失敗路徑收斂成 fail-closed 的 reason)。
 */
export async function verifyTourCheckout(args: {
  booking: BookingForVerification;
  tour: TourForVerification;
  departure: DepartureForVerification;
  paymentType: "deposit" | "remaining";
  api?: UvLiveApi;
  loadStoredDetail?: (externalProductCode: string) => Promise<StoredSupplierDetail>;
  callBudgetMs?: number;
  now?: Date;
}): Promise<VerifyResult> {
  const {
    booking,
    tour,
    departure,
    paymentType,
    api = defaultApi,
    loadStoredDetail = loadStoredSupplierDetail,
    callBudgetMs = DEFAULT_CALL_BUDGET_MS,
    now = new Date(),
  } = args;

  const startedAt = Date.now();
  const productCode = resolveUvProductCode(tour.sourceUrl, tour.productCode);

  const finish = (
    outcome: "passed" | "failed",
    mode: VerificationRecord["mode"],
    reason: CheckoutBlockReason | undefined,
    checks: VerificationRecord["checks"],
    stored: StoredSupplierDetail,
    mandatoryFees: string[],
  ): VerifyResult => {
    const verification: VerificationRecord = {
      mode,
      outcome,
      ...(reason ? { failReason: reason } : {}),
      productCode,
      checks,
      supplierFreshness: {
        supplierLastSyncedAt: toIsoOrNull(stored.supplierLastSyncedAt),
        priceTermsFetchedAt: toIsoOrNull(stored.priceTermsFetchedAt),
        liveCheckedAt: now.toISOString(),
      },
      elapsedMs: Date.now() - startedAt,
    };
    const snapshot = buildDisclosureSnapshot({
      booking,
      tour,
      departure,
      paymentType,
      productCode,
      mandatoryFees,
      stored,
    });
    // 觀測:失敗率與擋單原因分佈都靠這行(結構化,pino JSON)。
    log.info(
      {
        event: "checkout_verification",
        outcome,
        reason: reason ?? null,
        mode,
        bookingId: booking.id,
        tourId: tour.id,
        departureId: departure.id,
        paymentType,
        productCode,
        elapsedMs: verification.elapsedMs,
      },
      `[checkoutVerification] ${outcome}${reason ? ` (${reason})` : ""}`,
    );
    return { ok: outcome === "passed", reason, verification, snapshot };
  };

  // ── 尾款:供應商已確認座位才放行,不重驗 live(成約價 + 位子已是自己的)──
  if (paymentType === "remaining") {
    const vendorConfirmed = booking.supplierStatus === "vendor_confirmed";
    const stored = productCode
      ? await loadStoredDetail(productCode).catch(() => EMPTY_STORED_DETAIL)
      : EMPTY_STORED_DETAIL;
    return finish(
      vendorConfirmed ? "passed" : "failed",
      vendorConfirmed ? "balance_vendor_confirmed" : "blocked",
      vendorConfirmed ? undefined : "balance_without_vendor_confirmation",
      { tourActive: tour.status === "active" },
      stored,
      stored.mandatoryFeeLines,
    );
  }

  // ── 訂金(首次請款):完整即時驗證 ──────────────────────────────
  // 非 UV:無即時 API 可驗 → 一律擋(硬邊界)。
  if (!productCode) {
    return finish("failed", "blocked", "unsupported_supplier", {}, EMPTY_STORED_DETAIL, []);
  }

  // 本站商品必須在售。
  if (tour.status !== "active") {
    return finish(
      "failed",
      "blocked",
      "tour_not_active",
      { tourActive: false },
      EMPTY_STORED_DETAIL,
      [],
    );
  }

  // 幣別基準:UV 一律 USD(pickDepartureAdultPrice 的尺就是 USD)。
  const departureCurrency = (departure.currency ?? "").toUpperCase() || null;
  if (booking.currency.toUpperCase() !== "USD" || departureCurrency !== "USD") {
    return finish(
      "failed",
      "blocked",
      "currency_mismatch",
      { currency: { booking: booking.currency, departure: departureCurrency, live: null } },
      EMPTY_STORED_DETAIL,
      [],
    );
  }

  const stored = await loadStoredDetail(productCode).catch(() => EMPTY_STORED_DETAIL);

  const live = await runUvLiveChecks({
    productCode,
    booking,
    departure,
    departureCurrency,
    stored,
    api,
    callBudgetMs,
  });

  if (!live.passed) {
    return finish("failed", "uv_live", live.failReason, live.checks, stored, stored.mandatoryFeeLines);
  }

  // 全數通過。快照的必付清單 = live(客戶此刻同意的版本 = 已驗證與頁面一致)。
  return finish("passed", "uv_live", undefined, live.checks, stored, live.liveFees);
}
