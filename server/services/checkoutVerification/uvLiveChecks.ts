/**
 * checkoutVerification/uvLiveChecks — 訂金路的 UV live 驗證段
 * ((a) 在售 (b) 有位 (c) 價格/幣別/超收/必付)。
 *
 * 回傳 fail(原因 + checks)或 pass(checks + live 必付清單)。
 * 絕不 throw:逾時/炸收斂成 supplier_unreachable(fail-closed)。
 * 主流程與存證組裝見 ./index.ts。
 */

import { parseUvPriceTerms } from "../supplierSync/uvDetail";
import { pickDepartureAdultPrice } from "../uvBulkImportService";
import { createChildLogger } from "../../_core/logger";
import {
  classifyUvError,
  extractMandatoryFeeLines,
  localCalendarDate,
  mandatoryFeeListsEqual,
  recomputeGrossTotal,
  seatsRequested,
  withBudget,
} from "./helpers";
import type {
  BookingForVerification,
  CheckoutBlockReason,
  DepartureForVerification,
  StoredSupplierDetail,
  UvLiveApi,
  VerificationRecord,
} from "./types";

const log = createChildLogger({ module: "checkoutVerification" });

export type UvLiveChecksResult =
  | { passed: false; failReason: CheckoutBlockReason; checks: VerificationRecord["checks"] }
  | { passed: true; checks: VerificationRecord["checks"]; liveFees: string[] };

export async function runUvLiveChecks(args: {
  productCode: string;
  booking: BookingForVerification;
  departure: DepartureForVerification;
  departureCurrency: string | null;
  stored: StoredSupplierDetail;
  api: UvLiveApi;
  callBudgetMs: number;
}): Promise<UvLiveChecksResult> {
  const { productCode, booking, departure, departureCurrency, stored, api, callBudgetMs } = args;

  try {
    // (a) 商品仍在售(live)。
    try {
      await withBudget(api.getProductMain(productCode), "getProductMain", callBudgetMs);
    } catch (err) {
      return {
        passed: false,
        failReason: classifyUvError(err),
        checks: { tourActive: true, productOnSale: false },
      };
    }

    // (b) 班期仍有位(live)。
    const dateStr = localCalendarDate(departure.departureDate);
    const rows = await withBudget(
      api.getProductGroup({
        productCode,
        startTime: `${dateStr} 00:00:00`,
        endTime: `${dateStr} 23:59:59`,
      }),
      "getProductGroup",
      callBudgetMs,
    );
    const liveRow = rows.find((r) => String(r.groupDate ?? "").slice(0, 10) === dateStr);
    if (!liveRow) {
      return {
        passed: false,
        failReason: "departure_not_found",
        checks: { tourActive: true, productOnSale: true, departureFound: false },
      };
    }
    const requested = seatsRequested(booking);
    const liveStock = Number(liveRow.groupStock || 0);
    const liveSold = Number(liveRow.groupSaleStock || 0);
    const liveSpare = Math.max(0, liveStock - liveSold);
    const stockStatus = Number(liveRow.stockStatus);
    const seatsCheck = { requested, liveSpare, liveStockStatus: stockStatus };
    const base = { tourActive: true, productOnSale: true, departureFound: true };
    if (stockStatus !== 200 || liveSpare < requested) {
      return {
        passed: false,
        failReason: "insufficient_seats",
        checks: { ...base, seats: seatsCheck },
      };
    }

    // (c-1) 現價一致(同一把尺:pickDepartureAdultPrice;容差 $0)。
    const liveAdultPrice = pickDepartureAdultPrice(liveRow);
    const priceCheck = { displayedAdultPrice: departure.adultPrice, liveAdultPrice };
    if (liveAdultPrice <= 0 || liveAdultPrice !== departure.adultPrice) {
      return {
        passed: false,
        failReason: "price_changed",
        checks: { ...base, seats: seatsCheck, price: priceCheck },
      };
    }

    // (c-1b) live 幣別(有帶才驗;UV 基準 USD)。
    const liveCurrency =
      typeof liveRow.currencyNum === "string" && liveRow.currencyNum
        ? liveRow.currencyNum.toUpperCase()
        : null;
    if (liveCurrency && liveCurrency !== "USD") {
      return {
        passed: false,
        failReason: "currency_mismatch",
        checks: {
          ...base,
          seats: seatsCheck,
          price: priceCheck,
          currency: { booking: booking.currency, departure: departureCurrency, live: liveCurrency },
        },
      };
    }

    // (c-2) 超收防護:booking 總價不得高於「現行班期價 × 人數」。
    const gross = recomputeGrossTotal(booking, departure);
    const grossGuard = { bookingTotal: booking.totalPrice, recomputedGross: gross };
    if (booking.totalPrice > gross) {
      return {
        passed: false,
        failReason: "price_changed",
        checks: { ...base, seats: seatsCheck, price: priceCheck, grossGuard },
      };
    }

    // (c-3) 必付費用清單:live parse === 頁面展示(同 parseUvPriceTerms 一把尺)。
    const travel = await withBudget(
      api.getProductTravelDetail(productCode),
      "getProductTravelDetail",
      callBudgetMs,
    );
    const liveTerms = parseUvPriceTerms(travel);
    const liveFees = extractMandatoryFeeLines(liveTerms?.excluded);
    const feesCheck = { displayed: stored.mandatoryFeeLines, live: liveFees };
    if (!mandatoryFeeListsEqual(stored.mandatoryFeeLines, liveFees)) {
      return {
        passed: false,
        failReason: "mandatory_fees_changed",
        checks: { ...base, seats: seatsCheck, price: priceCheck, grossGuard, mandatoryFees: feesCheck },
      };
    }

    return {
      passed: true,
      liveFees,
      checks: {
        ...base,
        seats: seatsCheck,
        price: priceCheck,
        grossGuard,
        mandatoryFees: feesCheck,
        currency: { booking: booking.currency, departure: departureCurrency, live: liveCurrency },
      },
    };
  } catch (err) {
    // getProductGroup / getProductTravelDetail 的逾時或炸 → fail-closed。
    log.warn(
      { err: err instanceof Error ? err.message : String(err), bookingId: booking.id, productCode },
      "[checkoutVerification] live check failed — fail-closed",
    );
    return { passed: false, failReason: "supplier_unreachable", checks: { tourActive: true } };
  }
}
