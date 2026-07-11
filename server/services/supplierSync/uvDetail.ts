/**
 * supplierSync/uvDetail — UV (縱橫 / Universal Vision, Ctrip SOA2) detail
 * enrichment.
 *
 * UV exposes 2 useful detail endpoints:
 *   - getProductMain → product metadata (tripDay, …)
 *   - getProductTravelDetail → responseData with 4 sub-blocks:
 *       productTravel  → per-day itinerary
 *       productNotice  → notices (refund policy / booking / tips) + inclusions
 *       productCost    → optional add-ons + mandatory fees (with prices)
 *       productShop    → shopping stops (usually empty for UV US tours)
 *
 * The REAL shapes (verified live against P00002255 / P00000263, 2026-05-29):
 *
 *   productTravel.productTravelInfoList[0].dayList[] — NOT sorted; each day:
 *     { dayNumber, section ("San Francisco|||1+++Sacramento|||1+++Elko"),
 *       content: [
 *         { contentType: 100, relatedName: "【YG7-1】舊金山 - 薩克拉門托 - …" },
 *         { contentType: 8, jsonContent: <base64 JSON> }   // ← hotels live here
 *       ] }
 *     The base64 block decodes to { content: [{ hotelName, sourceType:2 }, …] };
 *     a hotelName of "similar" means 同級 (or-equivalent). UV gives NO per-day
 *     structured meals — meals are only stated globally in productNotice.
 *
 *   productCost.list[] — optional/mandatory cost items:
 *     { expIExpandName, expIExpandDesc (HTML), priceInfo: [{ expPriceName,
 *       expPriceMoney ("$215.00", USD) }] }
 *
 *   productNotice.noticeInfo[] — { matterName, noticeType, vluesTip1/2 (HTML) }:
 *     noticeType 0 = fee inclusions (含…) → priceTerms.included
 *     noticeType 1 = booking notice, 2 = travel tips, 3 = refund policy → notices
 *
 * Note: UV has no equivalent to Lion's `tourInfojson`, so `tourInfo` is always
 * `missing` for UV products. Each parser is defensive: returns null on
 * missing/malformed data.
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

  // Derive each detail kind from the travel response. `raw` carries the exact
  // sub-block each parser reads, so stored JSON matches what was parsed.
  const itinerary: EnrichmentResult = travel
    ? ok("itinerary", { productTravel: travel.productTravel }, parseUvItinerary(travel, main))
    : fail("itinerary", new Error("getProductTravelDetail returned null"));

  // R4:priceTerms 的來源現在含 productCost(必付費用)— raw 同步帶上,存的 JSON
  // 才對得上 parser 讀的東西。
  const priceTerms: EnrichmentResult = travel
    ? ok(
        "priceTerms",
        { productNotice: travel.productNotice, productCost: travel.productCost },
        parseUvPriceTerms(travel),
      )
    : fail("priceTerms", new Error("getProductTravelDetail returned null"));

  const notices: EnrichmentResult = travel
    ? ok("notices", { productNotice: travel.productNotice }, parseUvNotices(travel))
    : fail("notices", new Error("getProductTravelDetail returned null"));

  const optional: EnrichmentResult = travel
    ? ok("optional", { productCost: travel.productCost }, parseUvOptional(travel))
    : fail("optional", new Error("getProductTravelDetail returned null"));

  return {
    itinerary,
    priceTerms,
    notices,
    optional,
    tourInfo: missing("tourInfo"), // UV has no equivalent endpoint
  };
}

/* ─────────────────── Shared helpers ─────────────────── */

/** Strip HTML tags, decode common entities, collapse whitespace. */
function stripHtml(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Decode a UV day-content block's `jsonContent`. contentType 100 is plain
 * JSON; everything else (notably 8) is base64-encoded JSON.
 */
function decodeContentJson(jsonContent: unknown, contentType: unknown): any {
  if (typeof jsonContent !== "string" || jsonContent === "") return null;
  const tryParse = (s: string): any => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  if (String(contentType) === "100") return tryParse(jsonContent);
  try {
    return tryParse(Buffer.from(jsonContent, "base64").toString("utf-8"));
  } catch {
    return tryParse(jsonContent);
  }
}

/** Parse a UV money value ("$215.00", "NT$1,200", or a number) → amount + currency. */
function parseMoney(v: unknown): { amount: number; currency: string } {
  if (typeof v === "number") {
    return { amount: Number.isFinite(v) ? v : 0, currency: "USD" };
  }
  if (typeof v !== "string") return { amount: 0, currency: "USD" };
  const isTwd = /NT\$|TWD|台幣|新台幣/i.test(v);
  const amount = Number(v.replace(/[^0-9.]/g, "")) || 0;
  return { amount, currency: isTwd ? "TWD" : "USD" };
}

/** Strip UV's 【product-code】 prefix from a day title. */
function cleanDayTitle(s: string): string {
  return s.replace(/^\s*【[^】]*】\s*/, "").trim();
}

/** Split a route chain "A - B - C" into individual stops. */
function splitRoute(s: string): string[] {
  return s
    .split(/\s*[-－—–]\s*/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * Build a fallback title from UV's pipe-encoded `section`
 * ("San Francisco|||1+++Sacramento|||1+++Elko" → "San Francisco - Sacramento - Elko").
 */
function sectionToTitle(section: unknown): string {
  if (typeof section !== "string" || section.trim() === "") return "";
  return section
    .split("+++")
    .map((seg) => seg.split("|||")[0].trim())
    .filter(Boolean)
    .join(" - ");
}

/* ─────────────────── Parsers ─────────────────── */

/**
 * 名稱式必付判別(R4 2026-07-10,Jeff 點出:必付留白/誤標自費 = 低報總價)。
 *
 * 探真(10 團 live 實測,progress.md R4 附錄)證實 UV cost item **沒有結構性
 * flag**:必付與自費的欄位完全同構(editType=1 / resourceType=0 / expenseCode=EM*),
 * 唯一可辨識訊號是名稱(實例 "JP-NTF3 Mandatory fee"、fixture "YG Mandatory Fee")。
 * 故用名稱 pattern 分類;只比對**名稱**不比對描述(描述常含 "Include service fee"
 * 這類字樣會誤傷純自費項)。pattern 保守收斂:寧漏(漏的仍列自費、金額可見)
 * 勿錯殺(把自費硬標必付=高報)。
 */
const MANDATORY_FEE_NAME =
  /mandatory|required\s*fee|必付|必須費|必须费|必要費|必要费|服務費|服务费|小費|小费|resort\s*fee|燃油|資源費|资源费|雜費|杂费|city\s*tax|城市稅|城市税/i;

/** 一個 productCost.list 項目名稱是否為「必付費用」(非自費)。純函式。 */
export function isUvMandatoryCostItem(name: unknown): boolean {
  return typeof name === "string" && MANDATORY_FEE_NAME.test(name);
}

/**
 * Parse UV's `productTravel` block into NormalizedItinerary.
 *
 * Real path: productTravel.productTravelInfoList[<source>].dayList[]. Days
 * arrive UNSORTED — we sort by dayNumber. Title comes from the contentType-100
 * block's `relatedName`; hotels from the base64 contentType-8 block's
 * `content[].hotelName`. UV exposes no per-day meals → left unspecified ("")
 * so the frontend hides the meals block instead of falsely claiming 自理.
 */
export function parseUvItinerary(
  travel: UvProductTravelDetail,
  main: UvProductMain | null
): NormalizedItinerary | null {
  const pt = (travel as any)?.productTravel;
  if (!pt || typeof pt !== "object") return null;

  const infoList: any[] = Array.isArray(pt.productTravelInfoList)
    ? pt.productTravelInfoList
    : [];
  // Prefer the source-language track; fall back to the first with a dayList.
  const info =
    infoList.find((i) => i?.isSource && Array.isArray(i?.dayList)) ??
    infoList.find((i) => Array.isArray(i?.dayList)) ??
    null;
  const rawDays: any[] = Array.isArray(info?.dayList) ? info.dayList : [];
  if (rawDays.length === 0) return null;

  const sorted = [...rawDays].sort(
    (a, b) => (Number(a?.dayNumber) || 0) - (Number(b?.dayNumber) || 0)
  );

  const days = sorted.map((d: any, idx: number) => {
    const dayNumber = Number(d?.dayNumber) || idx + 1;
    const blocks: any[] = Array.isArray(d?.content) ? d.content : [];

    // Title — the contentType-100 block's relatedName holds the route.
    const metaBlock = blocks.find((b) => String(b?.contentType) === "100");
    const rawTitle =
      typeof metaBlock?.relatedName === "string" ? metaBlock.relatedName : "";
    const title =
      cleanDayTitle(rawTitle) || sectionToTitle(d?.section) || `Day ${dayNumber}`;

    // Attractions — the route chain split into individual stops.
    const attractions: NormalizedItinerary["days"][0]["attractions"] = splitRoute(
      title
    ).map((name) => ({ name }));

    // Hotels — base64 contentType-8 block's content[].hotelName.
    const hotelNames: string[] = [];
    let hasSimilar = false;
    for (const b of blocks) {
      if (String(b?.contentType) === "100") continue;
      const decoded = decodeContentJson(b?.jsonContent, b?.contentType);
      const arr = Array.isArray(decoded?.content) ? decoded.content : [];
      for (const c of arr) {
        const hn = typeof c?.hotelName === "string" ? c.hotelName.trim() : "";
        if (!hn) continue;
        if (/^(similar|same|同級|同级)$/i.test(hn)) {
          hasSimilar = true;
          continue;
        }
        if (!hotelNames.includes(hn)) hotelNames.push(hn);
      }
    }
    const hotels: NormalizedItinerary["days"][0]["hotels"] = hotelNames.map(
      (name) => ({ name, type: "未指定" as const })
    );
    if (hasSimilar && hotels.length > 0) {
      hotels.push({ name: "同級旅館", type: "未指定" });
    }

    return {
      dayNumber,
      title,
      attractions,
      hotels,
      // UV gives no per-day meal structure — leave unspecified, not 自理.
      meals: { breakfast: "", lunch: "", dinner: "" },
    };
  });

  const totalDays =
    Number(main?.tripDay) || Number((pt as any)?.productDay) || days.length;
  return { totalDays, days };
}

/**
 * Parse UV's price terms. UV states what the tour price INCLUDES via
 * productNotice items with noticeType 0 (the 含 notices); their vluesTip1/2
 * carry the inclusion prose (transport, meals, …).
 *
 * R4 (2026-07-10):`excluded` 現在承載「必付費用」— productCost.list 中名稱命中
 * isUvMandatoryCostItem 的項目(帶名稱 + 各價階金額)。必付 = 不含在團費但一定
 * 要繳,漏列 = 低報總價(與價格紅線同性質,Jeff 點出)。金額**只進文字清單、
 * 絕不加進售價欄**(tours.price 一律來自班期 pricing facts,staging 測試釘住)。
 * UV 無結構化退款表(HTML table → notices),cancellationPolicy 維持空。
 */
export function parseUvPriceTerms(
  travel: UvProductTravelDetail
): NormalizedPriceTerms | null {
  const notice = (travel as any)?.productNotice;
  const noticeInfo: any[] = Array.isArray(notice?.noticeInfo)
    ? notice.noticeInfo
    : [];

  const included: string[] = [];
  for (const n of noticeInfo) {
    if (String(n?.noticeType) !== "0") continue;
    for (const tip of [n?.vluesTip1, n?.vluesTip2]) {
      const text = stripHtml(tip);
      if (text && !included.includes(text)) included.push(text);
    }
  }

  // 必付費用 → excluded(團費不含、必繳)。每項:必付:名稱 — 價階1 / 價階2。
  const cost = (travel as any)?.productCost;
  const costList: any[] = Array.isArray(cost?.list) ? cost.list : [];
  const excluded: string[] = [];
  for (const it of costList) {
    const name =
      typeof it?.expIExpandName === "string" ? it.expIExpandName.trim() : "";
    if (!name || !isUvMandatoryCostItem(name)) continue;
    const priceInfo: any[] = Array.isArray(it?.priceInfo) ? it.priceInfo : [];
    const tiers = priceInfo
      .map((p) => {
        const tierName = stripHtml(p?.expPriceName).replace(/[:：]\s*$/, "");
        const money = typeof p?.expPriceMoney === "string" ? p.expPriceMoney.trim() : "";
        if (!money) return "";
        return tierName ? `${tierName} ${money}` : money;
      })
      .filter(Boolean)
      .join(" / ");
    excluded.push(`必付:${name}${tiers ? ` — ${tiers}` : ""}`);
  }

  if (included.length === 0 && excluded.length === 0) return null;

  return {
    included,
    excluded,
    paymentTerms: "報名時付訂金、出發前依縱橫標準條款付尾款",
    cancellationPolicy: [],
  };
}

/**
 * Parse UV's notices. productNotice.noticeInfo items with noticeType 1
 * (booking notice), 2 (travel tips), 3 (refund policy) are bucketed by keyword
 * into visa / insurance / baggage / general. noticeType 0 (inclusions) is
 * handled by parseUvPriceTerms and skipped here.
 */
export function parseUvNotices(
  travel: UvProductTravelDetail
): NormalizedNotices | null {
  const notice = (travel as any)?.productNotice;
  const noticeInfo: any[] = Array.isArray(notice?.noticeInfo)
    ? notice.noticeInfo
    : [];

  const visaParts: string[] = [];
  const insuranceParts: string[] = [];
  const baggageParts: string[] = [];
  const generalParts: string[] = [];

  for (const n of noticeInfo) {
    if (String(n?.noticeType) === "0") continue; // inclusions → priceTerms
    const title = typeof n?.matterName === "string" ? n.matterName.trim() : "";
    const body = stripHtml(n?.vluesTip1) || stripHtml(n?.vluesTip2);
    if (!title && !body) continue;
    const entry = title ? `${title}\n${body}`.trim() : body;
    const hay = `${title} ${body}`;
    if (/簽證|签证|visa/i.test(hay)) visaParts.push(entry);
    else if (/保險|保险|insurance/i.test(hay)) insuranceParts.push(entry);
    else if (/行李|baggage|luggage/i.test(hay)) baggageParts.push(entry);
    else generalParts.push(entry);
  }

  const cap = (s: string) => s.slice(0, 5000);
  const visa = cap(visaParts.join("\n\n"));
  const insurance = cap(insuranceParts.join("\n\n"));
  const baggage = cap(baggageParts.join("\n\n"));
  const general = cap(generalParts.join("\n\n"));

  if (!visa && !insurance && !baggage && !general) return null;
  return { visa, insurance, baggage, general };
}

/**
 * Parse UV's optional add-ons. The real source is productCost.list[] (mandatory
 * fee + optional activities/shows), each with an HTML description and a
 * priceInfo[] tier list in USD. Day-level optionalProductList is merged when
 * present (rare).
 *
 * R4 (2026-07-10):名稱命中 isUvMandatoryCostItem 的項目**不再列自費** — 它們是
 * 必付費用,歸 parseUvPriceTerms 的 excluded(舊行為把 "Mandatory fee" 混進自費
 * = 客人把必繳費用當可跳過,低報總價)。
 */
export function parseUvOptional(
  travel: UvProductTravelDetail
): NormalizedOptional | null {
  const cost = (travel as any)?.productCost;
  const list: any[] = Array.isArray(cost?.list) ? cost.list : [];

  const items: NormalizedOptional["items"] = [];

  for (const it of list) {
    const name =
      typeof it?.expIExpandName === "string" ? it.expIExpandName.trim() : "";
    if (!name || isUvMandatoryCostItem(name)) continue; // 必付 → priceTerms.excluded
    const priceInfo: any[] = Array.isArray(it?.priceInfo) ? it.priceInfo : [];
    // Prefer an adult / everyone tier; else the first listed.
    const tier =
      priceInfo.find((p) =>
        /adult|everyone|成人|大人/i.test(String(p?.expPriceName))
      ) ?? priceInfo[0];
    const { amount, currency } = parseMoney(tier?.expPriceMoney);
    items.push({
      name,
      description: stripHtml(it?.expIExpandDesc),
      price: amount,
      currency,
    });
  }

  // Day-level optionalProductList (defensive — usually null for UV).
  const pt = (travel as any)?.productTravel;
  const infoList: any[] = Array.isArray(pt?.productTravelInfoList)
    ? pt.productTravelInfoList
    : [];
  for (const info of infoList) {
    const dl: any[] = Array.isArray(info?.dayList) ? info.dayList : [];
    for (const d of dl) {
      const opl: any[] = Array.isArray(d?.optionalProductList)
        ? d.optionalProductList
        : [];
      for (const o of opl) {
        const name = typeof o?.name === "string" ? o.name.trim() : "";
        if (!name || items.some((x) => x.name === name)) continue;
        const { amount, currency } = parseMoney(o?.price);
        items.push({
          name,
          description: stripHtml(o?.description),
          price: amount,
          currency,
        });
      }
    }
  }

  if (items.length === 0) return null;
  return { items };
}
