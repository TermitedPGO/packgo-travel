/**
 * supplierSync/uvDetail — UV (縱橫) detail enrichment.
 *
 * UV exposes 2 useful detail endpoints (per design.md §3.3):
 *   - getProductMain → product metadata
 *   - getProductTravelDetail → contains 4 sub-blocks:
 *       productTravel (per-day itinerary)
 *       productNotice (notices + visa + safety)
 *       productCost   (included / excluded / cancellation policy)
 *       productShop   (optional add-ons / shopping)
 *
 * Note: UV has no equivalent to Lion's `tourInfojson` (date range
 * metadata), so the `tourInfo` slot is always `missing` for UV products.
 *
 * Each parser is defensive: returns null on missing/malformed data.
 */

import {
  getProductMain,
  getProductTravelDetail,
  type UvProductMain,
  type UvProductTravelDetail,
} from "../../suppliers/uvClient";
import { createChildLogger } from "../../_core/logger";
import { fail, missing, ok, rateLimitedCall, withRetry } from "./sharedDetail";
import type {
  EnrichmentResult,
  NormalizedItinerary,
  NormalizedNotices,
  NormalizedOptional,
  NormalizedPriceTerms,
  ProductEnrichment,
} from "./types";

const log = createChildLogger({ module: "supplierSync/uvDetail" });

/* ─────────────────── Orchestrator ─────────────────── */

/**
 * Enrich one UV product. Fires both detail endpoints sequentially with
 * rate-limit between, then derives 4 detail kinds from the responses.
 *
 * Returns `missing` for tourInfo (UV has no equivalent).
 */
export async function enrichUvProduct(
  _supplierProductId: number,
  externalProductCode: string
): Promise<ProductEnrichment> {
  let main: UvProductMain | null = null;
  let travel: UvProductTravelDetail | null = null;

  try {
    main = await rateLimitedCall(
      () => withRetry(() => getProductMain(externalProductCode)),
      `uv/getProductMain/${externalProductCode}`
    );
  } catch (err) {
    log.warn(
      { externalProductCode, err: err instanceof Error ? err.message : err },
      "getProductMain failed"
    );
  }

  try {
    travel = await rateLimitedCall(
      () => withRetry(() => getProductTravelDetail(externalProductCode)),
      `uv/getProductTravelDetail/${externalProductCode}`
    );
  } catch (err) {
    log.warn(
      { externalProductCode, err: err instanceof Error ? err.message : err },
      "getProductTravelDetail failed"
    );
  }

  // Derive each detail kind from the 2 endpoint responses
  const itinerary: EnrichmentResult = travel
    ? ok("itinerary", { productTravel: travel.productTravel, main }, parseUvItinerary(travel, main))
    : fail("itinerary", new Error("getProductTravelDetail returned null"));

  const priceTerms: EnrichmentResult = travel
    ? ok("priceTerms", { productCost: travel.productCost }, parseUvPriceTerms(travel))
    : fail("priceTerms", new Error("getProductTravelDetail returned null"));

  const notices: EnrichmentResult = travel
    ? ok("notices", { productNotice: travel.productNotice }, parseUvNotices(travel))
    : fail("notices", new Error("getProductTravelDetail returned null"));

  const optional: EnrichmentResult = travel
    ? ok("optional", { productShop: travel.productShop }, parseUvOptional(travel))
    : fail("optional", new Error("getProductTravelDetail returned null"));

  return {
    itinerary,
    priceTerms,
    notices,
    optional,
    tourInfo: missing("tourInfo"), // UV has no equivalent endpoint
  };
}

/* ─────────────────── Parsers ─────────────────── */

/**
 * Parse UV's `productTravel` block into NormalizedItinerary.
 *
 * UV's productTravel is typically an array of day objects:
 *   [{ dayNo: 1, dayTitle: "...", attractions: [...], hotels: [...], meals: {...} }, ...]
 * but exact shape varies per product. We use defensive `any` access.
 */
export function parseUvItinerary(
  travel: UvProductTravelDetail,
  main: UvProductMain | null
): NormalizedItinerary | null {
  const totalDays = main?.tripDay ?? 0;
  const productTravel = (travel as any)?.productTravel;
  if (!productTravel) return null;

  // productTravel is sometimes an array, sometimes an object with `dayList`
  const dayArr: any[] = Array.isArray(productTravel)
    ? productTravel
    : Array.isArray(productTravel?.dayList)
    ? productTravel.dayList
    : Array.isArray(productTravel?.list)
    ? productTravel.list
    : [];

  if (dayArr.length === 0 && totalDays === 0) return null;

  const days = dayArr.map((d: any, idx: number) => {
    const dayNumber = Number(d?.dayNo ?? d?.dayNum ?? idx + 1) || idx + 1;
    const title =
      typeof d?.dayTitle === "string"
        ? d.dayTitle
        : typeof d?.title === "string"
        ? d.title
        : `Day ${dayNumber}`;

    const attractions: NormalizedItinerary["days"][0]["attractions"] = Array.isArray(
      d?.attractions
    )
      ? d.attractions
          .filter((a: any) => typeof a?.name === "string" || typeof a?.attractionName === "string")
          .map((a: any) => ({
            name: a.name ?? a.attractionName,
            description: typeof a?.description === "string" ? a.description : undefined,
          }))
      : [];

    const hotels: NormalizedItinerary["days"][0]["hotels"] = Array.isArray(d?.hotels)
      ? d.hotels
          .filter((h: any) => typeof h?.name === "string" || typeof h?.hotelName === "string")
          .map((h: any) => ({
            name: h.name ?? h.hotelName,
            city: typeof h?.city === "string" ? h.city : undefined,
            rating: typeof h?.rating === "number" ? h.rating : undefined,
            type: classifyHotelType(h?.type ?? h?.hotelType ?? h?.rating),
          }))
      : [];

    const mealsObj = d?.meals ?? {};
    const meals = {
      breakfast: parseMealField(mealsObj?.breakfast),
      lunch: parseMealField(mealsObj?.lunch),
      dinner: parseMealField(mealsObj?.dinner),
    };

    const transportation = typeof d?.transportation === "string" ? d.transportation : undefined;

    return { dayNumber, title, attractions, hotels, meals, transportation };
  });

  return { totalDays: totalDays || days.length, days };
}

function parseMealField(v: unknown): boolean | string {
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && v.trim() !== "") return v;
  return false;
}

function classifyHotelType(v: unknown): NormalizedItinerary["days"][0]["hotels"][0]["type"] {
  if (typeof v === "number") {
    if (v >= 5) return "5星";
    if (v >= 4) return "4星";
    if (v >= 3) return "3星";
    return "經濟";
  }
  if (typeof v === "string") {
    if (/5\s*星|5\s*star/i.test(v)) return "5星";
    if (/4\s*星|4\s*star/i.test(v)) return "4星";
    if (/3\s*星|3\s*star/i.test(v)) return "3星";
    if (/民宿/.test(v)) return "民宿";
    if (/經濟/.test(v)) return "經濟";
  }
  return "未指定";
}

/**
 * Parse UV's `productCost` block into NormalizedPriceTerms.
 *
 * Typical shape: { includedList: [...], excludedList: [...], cancellationPolicy: [...] }
 */
export function parseUvPriceTerms(
  travel: UvProductTravelDetail
): NormalizedPriceTerms | null {
  const cost = (travel as any)?.productCost;
  if (!cost) return null;

  const included: string[] = Array.isArray(cost?.includedList)
    ? cost.includedList
        .map((x: any) => (typeof x === "string" ? x : x?.name ?? x?.description ?? ""))
        .filter(Boolean)
    : [];

  const excluded: string[] = Array.isArray(cost?.excludedList)
    ? cost.excludedList
        .map((x: any) => (typeof x === "string" ? x : x?.name ?? x?.description ?? ""))
        .filter(Boolean)
    : [];

  const paymentTerms =
    typeof cost?.paymentTerms === "string"
      ? cost.paymentTerms
      : "報名時付訂金、出發前 14 天付尾款（依縱橫標準條款）";

  const cancellationPolicy: NormalizedPriceTerms["cancellationPolicy"] = Array.isArray(
    cost?.cancellationPolicy
  )
    ? cost.cancellationPolicy
        .map((p: any) => {
          const days = Number(p?.daysBeforeDeparture ?? p?.days ?? 0);
          const refund = Number(p?.refundPercent ?? p?.refund ?? 0);
          if (!Number.isFinite(days) || !Number.isFinite(refund)) return null;
          return {
            daysBeforeDeparture: days,
            refundPercent: refund,
            note: typeof p?.note === "string" ? p.note : undefined,
          };
        })
        .filter((x: any): x is NonNullable<typeof x> => x !== null)
        .sort(
          (a: any, b: any) => b.daysBeforeDeparture - a.daysBeforeDeparture
        )
    : [];

  if (included.length === 0 && excluded.length === 0 && cancellationPolicy.length === 0) {
    return null;
  }
  return { included, excluded, paymentTerms, cancellationPolicy };
}

/**
 * Parse UV's `productNotice` block into NormalizedNotices.
 */
export function parseUvNotices(
  travel: UvProductTravelDetail
): NormalizedNotices | null {
  const notice = (travel as any)?.productNotice;
  if (!notice) return null;

  const noticeList = Array.isArray(notice) ? notice : Array.isArray(notice?.list) ? notice.list : [];

  const bucket = (re: RegExp): string =>
    noticeList
      .filter((n: any) => typeof n?.title === "string" && re.test(n.title))
      .map((n: any) => (typeof n?.content === "string" ? n.content : ""))
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 5000);

  const visa = bucket(/簽證|visa/i);
  const insurance = bucket(/保險|insurance/i);
  const baggage = bucket(/行李|baggage/i);

  const matchedTitles = new Set<string>();
  noticeList.forEach((n: any) => {
    if (typeof n?.title === "string" && /簽證|visa|保險|insurance|行李|baggage/i.test(n.title)) {
      matchedTitles.add(n.title);
    }
  });
  const general = noticeList
    .filter((n: any) => typeof n?.title === "string" && !matchedTitles.has(n.title))
    .map((n: any) => `${n.title}: ${typeof n?.content === "string" ? n.content : ""}`)
    .join("\n\n")
    .slice(0, 5000);

  if (!visa && !insurance && !baggage && !general) return null;
  return { visa, insurance, baggage, general };
}

/**
 * Parse UV's `productShop` block into NormalizedOptional.
 *
 * UV's productShop lists "shopping stops" (購物站) which we treat as
 * optional add-ons. Plus any explicit optionalList.
 */
export function parseUvOptional(
  travel: UvProductTravelDetail
): NormalizedOptional | null {
  const shop = (travel as any)?.productShop;
  const optionalList = (travel as any)?.optionalList;

  const items: NormalizedOptional["items"] = [];

  if (Array.isArray(shop)) {
    shop.forEach((s: any) => {
      const name = typeof s?.shopName === "string" ? s.shopName : typeof s?.name === "string" ? s.name : null;
      if (name) {
        items.push({
          name,
          description: typeof s?.description === "string" ? s.description : "購物站",
          price: 0, // shopping stops are free to enter
          currency: "TWD",
        });
      }
    });
  }

  if (Array.isArray(optionalList)) {
    optionalList.forEach((o: any) => {
      const name = typeof o?.name === "string" ? o.name : null;
      if (!name) return;
      const price = Number(o?.price ?? 0);
      items.push({
        name,
        description: typeof o?.description === "string" ? o.description : "",
        price: Number.isFinite(price) ? price : 0,
        currency: typeof o?.currency === "string" ? o.currency : "TWD",
      });
    });
  }

  return { items };
}
