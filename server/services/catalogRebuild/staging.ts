/**
 * catalogRebuild/staging — 把「供應商鏡像的一筆產品」算成「一個待上架的 tour 候選」。
 *
 * 供應商無關的純核心(supplier adapter 已先把 price / 幣別 / 未來班期數算好餵進來,
 * 因為 UV / Lion 的價格欄與班期 raw 形狀不同 — 見 index.ts 的 per-supplier adapter)。
 * 這支只做三件不分供應商的事:
 *   1. hydrate:parsed 明細(itinerary / priceTerms / notices / optional / tourInfo)
 *      → tours 對客欄位(reuse `hydration.hydrateTourFromParsed`,零 LLM)。
 *   2. 組 fields:hydrate 內容 + 基本事實(title / price / 天數 / 目的地 / 圖)。
 *   3. 驗:assessTourCompleteness 上架門檻 + assertRetailOnly 紅線(成本欄不得混入)。
 *
 * 純函式、無 DB、無 fetch → 用 fixture 直接單元測。
 */

import {
  safeParseJson,
  hydrateTourFromParsed,
  type HydratedTourFields,
} from "../supplierSync/hydration";
import type {
  NormalizedItinerary,
  NormalizedPriceTerms,
  NormalizedNotices,
  NormalizedOptional,
  NormalizedTourInfo,
} from "../supplierSync/types";
import {
  assessTourCompleteness,
  type CompletenessResult,
} from "./completeness";
import { assertRetailOnly } from "./guard";

/** 供應商鏡像的產品基本欄(supplierProducts 投影)。 */
export interface MirrorProduct {
  externalProductCode: string;
  title: string;
  days: number;
  destinationCountry: string | null;
  destinationCity: string | null;
  departureCity: string | null;
  imageUrl: string | null;
  currency: string;
}

/** supplierProductDetails 的 parsed JSON 字串(可能 null = 沒抓到 / parse 失敗)。 */
export interface MirrorDetail {
  itineraryParsed: string | null;
  priceTermsParsed: string | null;
  noticesParsed: string | null;
  optionalParsed: string | null;
  tourInfoParsed: string | null;
}

/** adapter 先算好的價格 / 班期事實(UV / Lion 各自算)。 */
export interface PricingFacts {
  /** 直客起價(retail,MIN 未來可售班期)。0 = 沒有可用價 → 會被完整度門檻擋下。 */
  priceRetail: number;
  currency: string;
  /** 未來班期數(撐「最近班期 + 有沒有位」+ 完整度門檻)。 */
  futureDepartureCount: number;
}

export interface StagedTour {
  productCode: string;
  /** 要寫進 tours 的對客欄位(已過 retail-only guard)。 */
  fields: Record<string, unknown>;
  assessment: CompletenessResult;
}

/**
 * 把 parsed 明細 JSON 字串解回 hydration 吃的 NormalizedX bundle。
 */
function parseDetailBundle(detail: MirrorDetail | null): {
  itinerary: NormalizedItinerary | null;
  priceTerms: NormalizedPriceTerms | null;
  notices: NormalizedNotices | null;
  optional: NormalizedOptional | null;
  tourInfo: NormalizedTourInfo | null;
} {
  return {
    itinerary: safeParseJson<NormalizedItinerary>(detail?.itineraryParsed),
    priceTerms: safeParseJson<NormalizedPriceTerms>(detail?.priceTermsParsed),
    notices: safeParseJson<NormalizedNotices>(detail?.noticesParsed),
    optional: safeParseJson<NormalizedOptional>(detail?.optionalParsed),
    tourInfo: safeParseJson<NormalizedTourInfo>(detail?.tourInfoParsed),
  };
}

/**
 * 算一個待上架 tour 候選。回 { fields(對客新值), assessment(能不能上 + 缺什麼) }。
 *
 * fields 只含 retail 內容與事實;`assertRetailOnly` 在出口擋任何成本 / agentPrice key
 * (理論上 hydration 不會產出成本欄,這是回歸鎖)。
 */
export function buildStagedTour(
  product: MirrorProduct,
  detail: MirrorDetail | null,
  pricing: PricingFacts,
): StagedTour {
  const bundle = parseDetailBundle(detail);

  const hydrated: HydratedTourFields = hydrateTourFromParsed({
    ...bundle,
    supplierTitle: product.title,
    days: product.days,
    destinationCountry: product.destinationCountry ?? undefined,
  });

  // 對客 fields = hydrate 內容 + 基本事實。只放 retail。
  const fields: Record<string, unknown> = {
    ...hydrated,
    title: product.title.slice(0, 200),
    duration: product.days,
    destinationCountry: product.destinationCountry ?? undefined,
    destinationCity: product.destinationCity ?? undefined,
    departureCity: product.departureCity ?? undefined,
    heroImage: product.imageUrl ?? undefined,
    imageUrl: product.imageUrl ?? undefined,
    price: pricing.priceRetail,
    priceCurrency: pricing.currency,
  };
  // 去掉 undefined(別用空值蓋掉既有欄)。
  for (const k of Object.keys(fields)) {
    if (fields[k] === undefined) delete fields[k];
  }

  // 紅線:出口最後一道。任何成本欄混入 → throw,絕不上架。
  assertRetailOnly(fields);

  const assessment = assessTourCompleteness({
    title: product.title,
    destinationCountry: product.destinationCountry,
    days: product.days,
    priceRetail: pricing.priceRetail,
    itineraryDetailedJson: hydrated.itineraryDetailed ?? null,
    attractionsJson: hydrated.attractions ?? null,
    futureDepartureCount: pricing.futureDepartureCount,
    heroImage: product.imageUrl,
    imageUrl: product.imageUrl,
    galleryImagesJson: null,
  });

  return { productCode: product.externalProductCode, fields, assessment };
}
