/**
 * supplierSync/lionDetail — Lion 5-endpoint detail enrichment.
 *
 * Calls all 5 Lion detail endpoints for one product and parses each
 * response into the PACK&GO Normalized* shape. Per design.md §3.2.
 *
 * Lion's detail endpoints all require `NormGroupID + GroupID`. The first
 * comes from `supplierProducts.externalProductCode`, the second from any
 * representative departure of the same product (`supplierDepartures.
 * externalDepartureCode`). We pick the nearest future departure when
 * possible, else the first by date.
 *
 * Each parser is defensive: returns null on missing/malformed data so
 * the orchestrator can mark `parseStatus='parse_failed'` without
 * crashing the whole product enrichment.
 */

import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  supplierDepartures as departuresTable,
  supplierProducts as productsTable,
} from "../../../drizzle/schema";

/**
 * Backfill helper: write country (and destination city when present) back
 * into supplierProducts after enrichment finds it in travelinfojson.
 * Lion's search API doesn't return country, so the only place to learn
 * it is from the detail call.
 */
async function updateSupplierProductMeta(
  supplierProductId: number,
  meta: { destinationCountry?: string | null; destinationCity?: string | null },
): Promise<void> {
  if (!meta.destinationCountry && !meta.destinationCity) return;
  const db = await getDb();
  if (!db) return;
  const updates: Record<string, unknown> = {};
  if (meta.destinationCountry) updates.destinationCountry = meta.destinationCountry.slice(0, 128);
  if (meta.destinationCity) updates.destinationCity = meta.destinationCity.slice(0, 128);
  if (Object.keys(updates).length === 0) return;
  try {
    await db
      .update(productsTable)
      .set(updates)
      .where(eq(productsTable.id, supplierProductId));
  } catch {
    // non-fatal — country backfill is best-effort
  }
}

// Lion's ISO-2 country code map (reused from lionTravelApiService)
const LION_COUNTRY_MAP: Record<string, string> = {
  JP: "日本", KR: "韓國", TW: "台灣", US: "美國", CA: "加拿大",
  GB: "英國", FR: "法國", DE: "德國", IT: "義大利", ES: "西班牙",
  CH: "瑞士", AT: "奧地利", NL: "荷蘭", BE: "比利時", LU: "盧森堡",
  GR: "希臘", PT: "葡萄牙", IE: "愛爾蘭", CZ: "捷克", HU: "匈牙利",
  PL: "波蘭", SK: "斯洛伐克", SI: "斯洛維尼亞", HR: "克羅埃西亞",
  RS: "塞爾維亞", BG: "保加利亞", RO: "羅馬尼亞", NO: "挪威",
  SE: "瑞典", DK: "丹麥", FI: "芬蘭", IS: "冰島", RU: "俄羅斯",
  TR: "土耳其", TH: "泰國", VN: "越南", MY: "馬來西亞", SG: "新加坡",
  ID: "印尼", PH: "菲律賓", IN: "印度", LK: "斯里蘭卡", NP: "尼泊爾",
  EG: "埃及", MA: "摩洛哥", ZA: "南非", AU: "澳洲", NZ: "紐西蘭",
  MO: "澳門", HK: "香港", CN: "中國",
};
import {
  getTravelInfo,
  getPriceInfo,
  getNoticeInfo,
  getOptionalInfo,
  getTourInfo,
  getDayTripInfo,
  type LionTravelInfo,
  type LionPriceInfo,
  type LionNoticeInfo,
  type LionOptionalInfo,
  type LionTourInfo,
  type LionDayTripInfo,
} from "../../suppliers/lionClient";
import { createChildLogger } from "../../_core/logger";
import { fail, missing, ok, rateLimitedCall, withRetry } from "./sharedDetail";
import type {
  EnrichmentResult,
  NormalizedItinerary,
  NormalizedNotices,
  NormalizedOptional,
  NormalizedPriceTerms,
  NormalizedTourInfo,
  ProductEnrichment,
} from "./types";

const log = createChildLogger({ module: "supplierSync/lionDetail" });

/* ─────────────────── Orchestrator ─────────────────── */

/**
 * Enrich one Lion product. Looks up the representative `groupId` first,
 * then calls all 5 detail endpoints sequentially (each with rate-limit
 * sleep). Returns a `ProductEnrichment` ready for `upsertProductDetail`.
 */
export async function enrichLionProduct(
  supplierProductId: number,
  externalProductCode: string
): Promise<ProductEnrichment> {
  const groupId = await resolveLionGroupId(supplierProductId);
  if (!groupId) {
    log.warn(
      { supplierProductId, externalProductCode },
      "no groupId — product has no departures, marking all detail kinds missing"
    );
    return {
      itinerary: missing("itinerary"),
      priceTerms: missing("priceTerms"),
      notices: missing("notices"),
      optional: missing("optional"),
      tourInfo: missing("tourInfo"),
    };
  }

  const key = { normGroupId: externalProductCode, groupId };

  // Call all 6 endpoints sequentially with rate-limit between calls.
  // If any throws, the rest still run so we capture partial data.
  // Itinerary merges travelinfojson (flight info) + daytripinfojson
  // (full day-by-day plan) — 2026-05-25.
  return {
    itinerary: await safeFetch("itinerary", async () => {
      const travelRaw = await rateLimitedCall(
        () => withRetry(() => getTravelInfo(key)),
        `lion/travelinfo/${externalProductCode}`
      );
      // daytripinfojson is optional — if it fails, fall back to flight-info only
      let dayTripRaw: LionDayTripInfo | null = null;
      try {
        dayTripRaw = await rateLimitedCall(
          () => withRetry(() => getDayTripInfo(key)),
          `lion/daytripinfo/${externalProductCode}`
        );
      } catch (err) {
        log.warn(
          { externalProductCode, err: err instanceof Error ? err.message : err },
          "daytripinfojson fetch failed, using flight-info fallback",
        );
      }
      // 2026-05-25: backfill destination country to supplierProducts so
      // downstream tour imports get the country field populated. Lion's
      // search API doesn't return country — only the detail call does.
      const country = (travelRaw as any)?.GroupInfo?.Country;
      if (typeof country === "string") {
        const mapped = LION_COUNTRY_MAP[country.toUpperCase()] || country;
        await updateSupplierProductMeta(supplierProductId, {
          destinationCountry: mapped,
        });
      }
      return ok(
        "itinerary",
        { travelInfo: travelRaw, dayTripInfo: dayTripRaw },
        parseLionItinerary(travelRaw, dayTripRaw)
      );
    }),
    priceTerms: await safeFetch("priceTerms", () =>
      rateLimitedCall(
        () => withRetry(() => getPriceInfo(key)),
        `lion/priceinfo/${externalProductCode}`
      ).then((raw) => ok("priceTerms", raw, parseLionPriceTerms(raw)))
    ),
    notices: await safeFetch("notices", () =>
      rateLimitedCall(
        () => withRetry(() => getNoticeInfo(key)),
        `lion/noticeinfo/${externalProductCode}`
      ).then((raw) => ok("notices", raw, parseLionNotices(raw)))
    ),
    optional: await safeFetch("optional", () =>
      rateLimitedCall(
        () => withRetry(() => getOptionalInfo(key)),
        `lion/optionalinfo/${externalProductCode}`
      ).then((raw) => ok("optional", raw, parseLionOptional(raw)))
    ),
    tourInfo: await safeFetch("tourInfo", () =>
      rateLimitedCall(
        () => withRetry(() => getTourInfo(key)),
        `lion/tourinfo/${externalProductCode}`
      ).then((raw) => ok("tourInfo", raw, parseLionTourInfo(raw)))
    ),
  };
}

async function safeFetch<K extends keyof ProductEnrichment>(
  kind: K,
  fn: () => Promise<EnrichmentResult>
): Promise<EnrichmentResult> {
  try {
    return await fn();
  } catch (err) {
    log.warn({ kind, err: err instanceof Error ? err.message : err }, "fetch failed");
    return fail(kind as never, err);
  }
}

/**
 * Find a representative `groupId` (Lion's TeamGroupCode) for a product.
 * Prefers the nearest upcoming departure; falls back to earliest if all
 * are in the past.
 */
async function resolveLionGroupId(
  supplierProductId: number
): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  // Nearest future departure
  const today = new Date();
  const [futureRow] = await db
    .select({ code: departuresTable.externalDepartureCode })
    .from(departuresTable)
    .where(
      and(
        eq(departuresTable.supplierProductId, supplierProductId),
        gte(departuresTable.departureDate, today)
      )
    )
    .orderBy(asc(departuresTable.departureDate))
    .limit(1);

  if (futureRow?.code) return futureRow.code;

  // Fallback: earliest known
  const [anyRow] = await db
    .select({ code: departuresTable.externalDepartureCode })
    .from(departuresTable)
    .where(eq(departuresTable.supplierProductId, supplierProductId))
    .orderBy(asc(departuresTable.departureDate))
    .limit(1);

  return anyRow?.code ?? null;
}

/* ─────────────────── Parsers ─────────────────── */

/**
 * Strip simple HTML tags from a Lion API string (Lion returns HTML-escaped
 * paragraphs in many fields). Lightweight — not a full sanitizer.
 */
function stripHtml(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map Lion's `Stars` (1-5 integer) into our type classification.
 */
function classifyLionHotelType(
  stars: number | undefined,
): NormalizedItinerary["days"][0]["hotels"][0]["type"] {
  if (typeof stars !== "number") return "未指定";
  if (stars >= 5) return "5星";
  if (stars >= 4) return "4星";
  if (stars >= 3) return "3星";
  return "經濟";
}

/**
 * Parse Lion's `travelinfojson` + `daytripinfojson` into NormalizedItinerary.
 *
 * 2026-05-25: Now merges TWO endpoints:
 *   - travelinfojson → flight info + tour metadata (totalDays, country)
 *   - daytripinfojson → DailyList[] with per-day attractions/hotels/meals
 *
 * If daytripinfojson is null (call failed) or DailyList empty, falls back
 * to synthesizing Day 1 + Day N from flight info (the original behavior).
 *
 * If travelinfojson missing/bad, returns null so caller marks parse_failed.
 */
export function parseLionItinerary(
  travel: LionTravelInfo,
  dayTrip?: LionDayTripInfo | null,
): NormalizedItinerary | null {
  if (!travel?.GroupInfo) return null;
  const totalDays = travel.GroupInfo.TourDays || 0;
  if (totalDays <= 0) return null;

  const transport: string[] = [];
  if (travel.GoAirline)
    transport.push(
      `去程: ${travel.GoAirline} ${travel.GoDepartureTime ?? ""}`.trim(),
    );
  if (travel.BackAirline)
    transport.push(
      `回程: ${travel.BackAirline} ${travel.BackDepartureTime ?? ""}`.trim(),
    );

  const dailyList = dayTrip?.DailyList ?? [];

  if (dailyList.length > 0) {
    // Rich path: build days from daytripinfojson, augment Day 1 / Day N
    // with flight info from travelinfojson.
    const days: NormalizedItinerary["days"] = dailyList.map((d) => {
      const dayNum = d.Day ?? 0;
      const isFirst = dayNum === 1;
      const isLast = dayNum === totalDays;

      const attractions: NormalizedItinerary["days"][0]["attractions"] = (
        d.AttractionsList ?? []
      )
        .map((a) => {
          const name = stripHtml(a.Name);
          if (!name) return null;
          return {
            name,
            description: stripHtml(a.VisitWayDesc) || undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const hotels: NormalizedItinerary["days"][0]["hotels"] = (
        d.HotelList ?? []
      )
        .map((h) => {
          const name = stripHtml(h.HotelName);
          if (!name) return null;
          return {
            name,
            type: classifyLionHotelType(h.Stars),
            rating: typeof h.Stars === "number" ? h.Stars : undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      // Fallback: if HotelList empty but HotelDesc has text, parse it as one hotel
      if (hotels.length === 0 && d.HotelDesc) {
        const desc = stripHtml(d.HotelDesc);
        if (desc) hotels.push({ name: desc, type: "未指定" });
      }

      const mealOrFalse = (s: string | undefined): boolean | string => {
        const v = stripHtml(s);
        if (!v) return false;
        if (/敬請自理|自理|XXX|×/.test(v)) return false;
        return v;
      };

      const transportation =
        isFirst && transport[0]
          ? transport[0]
          : isLast && transport[1]
            ? transport[1]
            : undefined;

      return {
        dayNumber: dayNum || 0,
        title: stripHtml(d.TravelPoint) || `Day ${dayNum}`,
        attractions,
        hotels,
        meals: {
          breakfast: mealOrFalse(d.Breakfast),
          lunch: mealOrFalse(d.Lunch),
          dinner: mealOrFalse(d.Dinner),
        },
        transportation,
      };
    });

    return { totalDays, days };
  }

  // Fallback path: no daytripinfojson — synthesize Day 1 + Day N from
  // flight info (original 2026-05-24 behavior).
  const days: NormalizedItinerary["days"] = [];
  if (travel.GoAirline) {
    days.push({
      dayNumber: 1,
      title: `${travel.GoDepartureAirport ?? ""} → ${travel.GoArriveAirport ?? travel.GroupInfo.Country ?? ""}`,
      attractions: [],
      hotels: [],
      meals: { breakfast: false, lunch: false, dinner: false },
      transportation: transport[0],
    });
  }
  if (travel.BackAirline && totalDays > 1) {
    days.push({
      dayNumber: totalDays,
      title: `${travel.BackDepartureAirport ?? travel.GroupInfo.Country ?? ""} → ${travel.BackArriveAirport ?? ""}`,
      attractions: [],
      hotels: [],
      meals: { breakfast: false, lunch: false, dinner: false },
      transportation: transport[1],
    });
  }
  return { totalDays, days };
}

/**
 * Parse Lion's `priceinfojson` into NormalizedPriceTerms. Lion exposes
 * `Meals[]` (which kinds included) but doesn't have a clean included/
 * excluded list — we derive what we can.
 */
export function parseLionPriceTerms(
  raw: LionPriceInfo
): NormalizedPriceTerms | null {
  if (!raw?.OrderPrice && raw?.OrderPrice !== 0) return null;

  const included: string[] = [];
  const excluded: string[] = [];

  if (raw.VisaPrice && raw.VisaPrice.Cost > 0) {
    excluded.push(`簽證費 ${raw.VisaPrice.CostDesc} ${raw.VisaPrice.Cost}`);
  } else {
    included.push("簽證費");
  }
  if (raw.AirportPrice && raw.AirportPrice.Cost > 0) {
    excluded.push(`機場稅 ${raw.AirportPrice.CostDesc} ${raw.AirportPrice.Cost}`);
  } else {
    included.push("機場稅");
  }
  if (Array.isArray(raw.Meals) && raw.Meals.length > 0) {
    included.push(`餐食 (${raw.Meals.length} 餐)`);
  }

  return {
    included,
    excluded,
    paymentTerms: raw.IsFullPay
      ? "報名時全額付款"
      : "報名時付訂金、出發前 14 天付尾款（依雄獅標準條款）",
    cancellationPolicy: [], // Lion doesn't expose policy in priceinfojson
  };
}

/**
 * Parse Lion's `noticeinfojson` into NormalizedNotices.
 *
 * Structure: NoteList = array of { Title, Content } objects. Common
 * titles: 簽證須知, 行李規定, 保險, 旅遊安全, 國定假日 etc.
 */
export function parseLionNotices(
  raw: LionNoticeInfo
): NormalizedNotices | null {
  if (!raw) return null;

  const noteList = Array.isArray(raw.NoteList) ? raw.NoteList : [];
  const bucket = (re: RegExp): string => {
    const matches = noteList
      .filter((n: any) => typeof n?.Title === "string" && re.test(n.Title))
      .map((n: any) => (typeof n?.Content === "string" ? n.Content : ""))
      .filter(Boolean);
    return matches.join("\n\n").slice(0, 5000);
  };

  const visa = bucket(/簽證|visa/i);
  const insurance = bucket(/保險|insurance/i) + (raw.SafeReg ? `\n\n${raw.SafeReg}` : "");
  const baggage = bucket(/行李|baggage|baggage/i);
  // Everything not matched above goes to general
  const matched = new Set<string>();
  noteList.forEach((n: any) => {
    if (typeof n?.Title === "string" && /簽證|visa|保險|insurance|行李|baggage/i.test(n.Title)) {
      matched.add(n.Title);
    }
  });
  const general = noteList
    .filter((n: any) => typeof n?.Title === "string" && !matched.has(n.Title))
    .map((n: any) => `${n.Title}: ${typeof n?.Content === "string" ? n.Content : ""}`)
    .join("\n\n")
    .slice(0, 5000);

  // If everything is empty, return null so status=parse_failed
  if (!visa && !insurance.trim() && !baggage && !general) {
    return null;
  }

  return { visa, insurance: insurance.trim(), baggage, general };
}

/**
 * Parse Lion's `optionalinfojson` into NormalizedOptional.
 *
 * Structure: OptionalInfoList = array of { Name, Description, Price,
 * Currency, ... }
 */
export function parseLionOptional(
  raw: LionOptionalInfo
): NormalizedOptional | null {
  if (!raw) return null;

  const list = [
    ...(Array.isArray(raw.OptionalInfoList) ? raw.OptionalInfoList : []),
    ...(Array.isArray(raw.SelfSelectedList) ? raw.SelfSelectedList : []),
  ];
  if (list.length === 0) return { items: [] };

  const items = list
    .map((o: any) => {
      const name = typeof o?.Name === "string" ? o.Name : null;
      const price = Number(o?.Price ?? 0);
      if (!name || !Number.isFinite(price)) return null;
      return {
        name,
        description: typeof o?.Description === "string" ? o.Description : "",
        price,
        currency: typeof o?.Currency === "string" ? o.Currency : "TWD",
        minParticipants: o?.MinParticipants ? Number(o.MinParticipants) : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return { items };
}

/**
 * Parse Lion's `tourinfojson` into NormalizedTourInfo.
 *
 * Structure: TourIDList = array of { TourID, MinGoDate, MaxGoDate } +
 * overall date range.
 */
export function parseLionTourInfo(
  raw: LionTourInfo
): NormalizedTourInfo | null {
  if (!raw) return null;

  const highlights: string[] = [];
  if (raw.AllMinGoDate && raw.AllMaxGoDate) {
    highlights.push(`可出發期間: ${raw.AllMinGoDate} ~ ${raw.AllMaxGoDate}`);
  }

  const metadata: Record<string, string> = {};
  if (Array.isArray(raw.TourIDList)) {
    metadata.tourIdCount = String(raw.TourIDList.length);
  }
  if (raw.AllMinGoDate) metadata.minDate = raw.AllMinGoDate;
  if (raw.AllMaxGoDate) metadata.maxDate = raw.AllMaxGoDate;

  if (highlights.length === 0 && Object.keys(metadata).length === 0) {
    return null;
  }
  return { highlights, metadata };
}
