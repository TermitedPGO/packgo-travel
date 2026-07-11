/**
 * checkoutVerification/snapshot — 頁面展示側明細載入 + 揭露快照組裝。
 * 主流程見 ./index.ts,型別見 ./types.ts。
 *
 * coverage.test.ts 紀律:只用 drizzle query builder,無 raw sql`` 出現點。
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { extractMandatoryFeeLines, localCalendarDate, toIsoOrNull } from "./helpers";
import {
  EMPTY_STORED_DETAIL,
  type BookingForVerification,
  type DepartureForVerification,
  type DisclosureSnapshot,
  type StoredSupplierDetail,
  type TourForVerification,
} from "./types";

/**
 * 載入頁面展示側的供應商明細(必付清單、條款文字、新鮮度)。
 * 路徑同 toursRead.getSupplierDetail:externalProductCode → supplierProducts →
 * supplierProductDetails。查無明細 → 空清單(頁面本來就沒展示必付;live 若有
 * 必付則構成 mandatory_fees_changed → 擋,fail-closed 方向正確)。
 */
export async function loadStoredSupplierDetail(
  externalProductCode: string,
): Promise<StoredSupplierDetail> {
  const db = await getDb();
  if (!db) return EMPTY_STORED_DETAIL;
  const { supplierProducts, supplierProductDetails } = await import("../../../drizzle/schema");
  const [product] = await db
    .select({ id: supplierProducts.id, lastSyncedAt: supplierProducts.lastSyncedAt })
    .from(supplierProducts)
    .where(eq(supplierProducts.externalProductCode, externalProductCode))
    .limit(1);
  if (!product) return EMPTY_STORED_DETAIL;
  const [detail] = await db
    .select({
      priceTermsParsed: supplierProductDetails.priceTermsParsed,
      priceTermsFetchedAt: supplierProductDetails.priceTermsFetchedAt,
    })
    .from(supplierProductDetails)
    .where(eq(supplierProductDetails.supplierProductId, product.id))
    .limit(1);
  let parsed: {
    included?: string[];
    excluded?: string[];
    paymentTerms?: string;
    cancellationPolicy?: string[];
  } | null = null;
  if (detail?.priceTermsParsed) {
    try {
      parsed = JSON.parse(detail.priceTermsParsed);
    } catch {
      parsed = null;
    }
  }
  return {
    mandatoryFeeLines: extractMandatoryFeeLines(parsed?.excluded),
    paymentTerms: typeof parsed?.paymentTerms === "string" ? parsed.paymentTerms : null,
    cancellationPolicy: Array.isArray(parsed?.cancellationPolicy)
      ? parsed.cancellationPolicy.filter((s): s is string => typeof s === "string")
      : [],
    priceTermsFetchedAt: detail?.priceTermsFetchedAt ?? null,
    supplierLastSyncedAt: product.lastSyncedAt ?? null,
  };
}

/** 組裝「客戶即將同意的版本」快照(落 checkoutDisclosures.snapshot)。純函式。 */
export function buildDisclosureSnapshot(args: {
  booking: BookingForVerification;
  tour: TourForVerification;
  departure: DepartureForVerification;
  paymentType: "deposit" | "remaining";
  productCode: string | null;
  mandatoryFees: string[];
  stored: StoredSupplierDetail;
}): DisclosureSnapshot {
  const { booking, tour, departure, paymentType, productCode, mandatoryFees, stored } = args;
  return {
    tour: {
      id: tour.id,
      title: tour.title,
      productCode,
      sourceUrl: tour.sourceUrl ?? null,
    },
    departure: {
      id: departure.id,
      date: localCalendarDate(departure.departureDate),
      returnDate: departure.returnDate ? localCalendarDate(departure.returnDate) : null,
    },
    pricing: {
      currency: booking.currency,
      adultPrice: departure.adultPrice,
      childPriceWithBed: departure.childPriceWithBed ?? null,
      childPriceNoBed: departure.childPriceNoBed ?? null,
      infantPrice: departure.infantPrice ?? null,
      singleRoomSupplement: departure.singleRoomSupplement ?? null,
      counts: {
        adults: booking.numberOfAdults || 0,
        childrenWithBed: booking.numberOfChildrenWithBed || 0,
        childrenNoBed: booking.numberOfChildrenNoBed || 0,
        infants: booking.numberOfInfants || 0,
        singleRooms: booking.numberOfSingleRooms || 0,
      },
      totalPrice: booking.totalPrice,
      depositAmount: booking.depositAmount,
      remainingAmount: booking.remainingAmount,
      paymentType,
      amountToCharge: paymentType === "deposit" ? booking.depositAmount : booking.remainingAmount,
    },
    mandatoryFees,
    policy: {
      paymentTerms: stored.paymentTerms,
      cancellationPolicy: stored.cancellationPolicy,
      disclaimerVersion: booking.disclaimerVersion ?? null,
      disclaimerAcceptedAt: toIsoOrNull(booking.disclaimerAcceptedAt),
    },
    displayedDataTimestamps: {
      priceTermsFetchedAt: toIsoOrNull(stored.priceTermsFetchedAt),
      supplierLastSyncedAt: toIsoOrNull(stored.supplierLastSyncedAt),
    },
  };
}
