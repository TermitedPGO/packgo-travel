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

import { and, asc, eq, gte } from "drizzle-orm";
import { getDb } from "../../db";
import {
  supplierDepartures as departuresTable,
  supplierProducts as productsTable,
} from "../../../drizzle/schema";
import {
  getTravelInfo,
  getPriceInfo,
  getNoticeInfo,
  getOptionalInfo,
  getTourInfo,
  type LionTravelInfo,
  type LionPriceInfo,
  type LionNoticeInfo,
  type LionOptionalInfo,
  type LionTourInfo,
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

  // Call all 5 endpoints sequentially with rate-limit between calls.
  // If any throws, the rest still run so we capture partial data.
  return {
    itinerary: await safeFetch("itinerary", () =>
      rateLimitedCall(
        () => withRetry(() => getTravelInfo(key)),
        `lion/travelinfo/${externalProductCode}`
      ).then((raw) => ok("itinerary", raw, parseLionItinerary(raw)))
    ),
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
 * Parse Lion's `travelinfojson` response into NormalizedItinerary.
 *
 * NOTE: Lion's `travelinfojson` is actually flight + tour metadata
 * (NOT day-by-day itinerary — that lives in `daytripinfojson`, an
 * untyped endpoint we don't currently call). What we DO get:
 *   - Flight info (GoAirline, BackAirline, departure/arrive times)
 *   - GroupInfo metadata (tour days, country, etc.)
 *
 * So our NormalizedItinerary for Lion will have totalDays + transportation
 * info but `days[]` may be empty until we wire daytripinfojson in Stage 2.
 */
export function parseLionItinerary(
  raw: LionTravelInfo
): NormalizedItinerary | null {
  if (!raw?.GroupInfo) return null;
  const totalDays = raw.GroupInfo.TourDays || 0;
  if (totalDays <= 0) return null;

  const transport: string[] = [];
  if (raw.GoAirline)
    transport.push(`去程: ${raw.GoAirline} ${raw.GoDepartureTime ?? ""}`.trim());
  if (raw.BackAirline)
    transport.push(`回程: ${raw.BackAirline} ${raw.BackDepartureTime ?? ""}`.trim());

  // Day 1 = departure (synthesize from flight info), Day N = return.
  // Middle days stay empty until daytripinfojson is wired.
  const days: NormalizedItinerary["days"] = [];
  if (raw.GoAirline) {
    days.push({
      dayNumber: 1,
      title: `${raw.GoDepartureAirport ?? ""} → ${raw.GoArriveAirport ?? raw.GroupInfo.Country ?? ""}`,
      attractions: [],
      hotels: [],
      meals: { breakfast: false, lunch: false, dinner: false },
      transportation: transport[0],
    });
  }
  if (raw.BackAirline && totalDays > 1) {
    days.push({
      dayNumber: totalDays,
      title: `${raw.BackDepartureAirport ?? raw.GroupInfo.Country ?? ""} → ${raw.BackArriveAirport ?? ""}`,
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
