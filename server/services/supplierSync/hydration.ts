/**
 * Tour-hydration helpers.
 *
 * 2026-05-25 — close the gap between supplierProductDetails (fully parsed:
 * 5770 rows, 99.9% itinerary, 100% optional, 80% notices) and the tours
 * table (4057 of 4191 active tours have NO dailyItinerary / hotels /
 * meals / etc.). `rewriteAllImportedTours` only updated 9 basic fields;
 * everything else stayed empty. Result: customers click into a tour and
 * see a title + image + price but no day-by-day content.
 *
 * This module takes the parsed supplier JSON and emits PACK&GO tour
 * column values. Zero LLM cost — pure transformation. The shape we emit
 * is the **supplier-derived shape** (preserves dayNumber, supplier-style
 * meals object). TourDetailPeony already renders both this shape AND the
 * "real" AI-enriched shape (134 tours have the latter), so leaving the
 * 4057 hydrated rows in supplier shape doesn't break the detail page.
 *
 * Pure functions — no DB, no fetch, no logging. Easy to test.
 */

import type {
  NormalizedItinerary,
  NormalizedPriceTerms,
  NormalizedNotices,
  NormalizedOptional,
  NormalizedTourInfo,
} from "./types";

/**
 * The 12 columns we hydrate on the tours table. All are TEXT columns
 * holding either JSON or plain text. `undefined` means "don't update
 * this column" (caller spreads into a Drizzle .set()).
 */
export interface HydratedTourFields {
  description?: string;
  dailyItinerary?: string;
  itineraryDetailed?: string;
  hotels?: string;
  meals?: string;
  flights?: string;
  highlights?: string;
  attractions?: string;
  optionalTours?: string;
  costExplanation?: string;
  noticeDetailed?: string;
  keyFeatures?: string;
  extractedDepartures?: string;
  specialReminders?: string;
}

/**
 * Input bundle — parsed JSON from supplierProductDetails. Each parsed
 * value can be `null` / undefined (supplier didn't return that detail,
 * parser failed, etc.). We hydrate whatever's available.
 */
export interface HydrationInput {
  itinerary?: NormalizedItinerary | null;
  priceTerms?: NormalizedPriceTerms | null;
  notices?: NormalizedNotices | null;
  optional?: NormalizedOptional | null;
  tourInfo?: NormalizedTourInfo | null;
  /** Supplier product title (fallback when itinerary is empty). */
  supplierTitle?: string;
  /** Total trip days (for description fallback). */
  days?: number;
  /** Destination country (for description fallback). */
  destinationCountry?: string;
}

/**
 * Render all hydratable fields from the parsed bundle. Only emits a key
 * when we have non-empty content for it — caller can spread into Drizzle
 * .set() and won't clobber existing data with empty strings.
 */
export function hydrateTourFromParsed(
  input: HydrationInput
): HydratedTourFields {
  const out: HydratedTourFields = {};

  // ── dailyItinerary + itineraryDetailed + per-day-derived collections
  if (input.itinerary && Array.isArray(input.itinerary.days) && input.itinerary.days.length > 0) {
    out.dailyItinerary = JSON.stringify(input.itinerary);
    // itineraryDetailed must be a JSON array matching the shape DayCard.tsx expects:
    //   { day, title, description, activities[], meals{}, accommodation }
    out.itineraryDetailed = JSON.stringify(
      buildItineraryDetailedForFrontend(input.itinerary)
    );

    const hotels = buildHotelsList(input.itinerary);
    if (hotels.length > 0) out.hotels = JSON.stringify(hotels);

    const meals = buildMealsList(input.itinerary);
    if (meals.length > 0) out.meals = JSON.stringify(meals);

    const attractions = buildAttractionsList(input.itinerary);
    if (attractions.length > 0) out.attractions = JSON.stringify(attractions);

    const flights = buildFlightsFromItinerary(input.itinerary);
    if (flights) out.flights = JSON.stringify(flights);
  }

  // ── highlights + keyFeatures from tourInfo
  if (input.tourInfo?.highlights && input.tourInfo.highlights.length > 0) {
    const hl = input.tourInfo.highlights.map((title) => ({
      title,
      subtitle: "",
      description: "",
    }));
    out.highlights = JSON.stringify(hl);

    const keyFeatures = input.tourInfo.highlights.slice(0, 5).map((h) => ({
      keyword: h.slice(0, 30),
      keywordStyle: "horizontal" as const,
    }));
    out.keyFeatures = JSON.stringify(keyFeatures);
  }

  // ── costExplanation from priceTerms
  if (input.priceTerms) {
    const hasContent =
      (input.priceTerms.included?.length ?? 0) > 0 ||
      (input.priceTerms.excluded?.length ?? 0) > 0 ||
      !!input.priceTerms.paymentTerms ||
      (input.priceTerms.cancellationPolicy?.length ?? 0) > 0;
    if (hasContent) out.costExplanation = JSON.stringify(input.priceTerms);
  }

  // ── noticeDetailed from notices (skip if all empty strings)
  if (input.notices) {
    const hasContent =
      (input.notices.visa?.trim().length ?? 0) > 0 ||
      (input.notices.insurance?.trim().length ?? 0) > 0 ||
      (input.notices.baggage?.trim().length ?? 0) > 0 ||
      (input.notices.general?.trim().length ?? 0) > 0;
    if (hasContent) out.noticeDetailed = JSON.stringify(input.notices);
  }

  // ── optionalTours from optional.items
  if (input.optional?.items && input.optional.items.length > 0) {
    out.optionalTours = JSON.stringify(input.optional.items);
  }

  // ── extractedDepartures from tourInfo.metadata if minDate/maxDate present
  const meta = input.tourInfo?.metadata;
  if (meta && meta.minDate && meta.maxDate) {
    out.extractedDepartures = JSON.stringify([
      { startDate: meta.minDate, endDate: meta.maxDate },
    ]);
  }

  // ── description — build from highlights or day titles if nothing better.
  // Threshold: 30 chars in JS string length. CJK is 3 bytes/char in UTF-8,
  // so this comfortably clears the audit's MySQL `LENGTH() < 50` byte check
  // for any all-CJK description (~17 chars), and ASCII-heavy descriptions
  // still need to be substantive (30 ASCII chars ≈ 30 bytes).
  const desc = buildDescription(input);
  if (desc && desc.length >= 30) out.description = desc;

  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Sub-renderers
// ────────────────────────────────────────────────────────────────────────

/**
 * Transform NormalizedItinerary → JSON array matching TourDetailPeony/DayCard.tsx props.
 *
 * DayCard reads: { day, title, description, activities[], meals{}, accommodation, image }
 * Supplier has: { dayNumber, title, attractions[], hotels[], meals{}, transportation }
 */
function buildItineraryDetailedForFrontend(
  itin: NormalizedItinerary
): Array<Record<string, unknown>> {
  return itin.days.map((d) => ({
    day: d.dayNumber,
    title: d.title,
    description: d.transportation ? `交通：${d.transportation}` : "",
    activities: (d.attractions ?? []).map((a) => ({
      name: a.name,
      title: a.name,
      description: a.description ?? "",
      duration: a.durationHours ? `${a.durationHours} 小時` : undefined,
    })),
    meals: {
      breakfast: mealToDisplayString(d.meals?.breakfast),
      lunch: mealToDisplayString(d.meals?.lunch),
      dinner: mealToDisplayString(d.meals?.dinner),
    },
    accommodation: (d.hotels ?? []).map((h) => h.name).join(" 或 ") || undefined,
  }));
}

/** Convert supplier meal value (boolean|string) to DayCard display string. */
function mealToDisplayString(m: boolean | string | undefined): string {
  if (m === undefined || m === null || m === false) return "自理";
  if (m === true) return "飯店內";
  return m;
}

function renderItineraryAsText(itin: NormalizedItinerary): string {
  // Human-readable bullet list. Each day:
  //   Day 1 — 桃園 → 東京 機場接送
  //     景點: 索利歐私人保護區 / 阿布黛爾國家公園
  //     住宿: Treetops Lodge 或 The Ark Lodge 或同級
  //     餐食: 早 機上簡餐 / 午 飯店 / 晚 飯店
  //     交通: 去程 國泰航空 13:20
  const lines: string[] = [];
  for (const d of itin.days) {
    lines.push(`Day ${d.dayNumber} — ${d.title}`);
    if (d.attractions && d.attractions.length > 0) {
      const names = d.attractions.map((a) => a.name).filter(Boolean);
      if (names.length > 0) lines.push(`  景點: ${names.join(" / ")}`);
    }
    if (d.hotels && d.hotels.length > 0) {
      const names = d.hotels.map((h) => h.name).filter(Boolean);
      if (names.length > 0) lines.push(`  住宿: ${names.join(" / ")}`);
    }
    if (d.meals) {
      const mealParts: string[] = [];
      if (d.meals.breakfast) mealParts.push(`早 ${mealText(d.meals.breakfast)}`);
      if (d.meals.lunch) mealParts.push(`午 ${mealText(d.meals.lunch)}`);
      if (d.meals.dinner) mealParts.push(`晚 ${mealText(d.meals.dinner)}`);
      if (mealParts.length > 0) lines.push(`  餐食: ${mealParts.join(" / ")}`);
    }
    if (d.transportation) lines.push(`  交通: ${d.transportation}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function mealText(m: boolean | string): string {
  if (m === true) return "含";
  if (m === false) return "自理";
  return m;
}

function buildHotelsList(itin: NormalizedItinerary): Array<{
  name: string;
  city: string;
  stars: string;
  type: string;
  description: string;
}> {
  // Dedupe by name (alternatives like "A 或 B 或同級" stay together as one entry).
  const seen = new Set<string>();
  const out: Array<{ name: string; city: string; stars: string; type: string; description: string }> = [];
  for (const d of itin.days) {
    for (const h of d.hotels ?? []) {
      const key = h.name.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: key,
        city: h.city ?? "",
        stars: h.rating != null ? String(h.rating) : "",
        type: h.type ?? "未指定",
        description: "",
      });
    }
  }
  return out;
}

function buildMealsList(itin: NormalizedItinerary): Array<{
  dayNumber: number;
  breakfast: string;
  lunch: string;
  dinner: string;
}> {
  return itin.days
    .filter((d) => d.meals)
    .map((d) => ({
      dayNumber: d.dayNumber,
      breakfast: String(mealText(d.meals.breakfast)),
      lunch: String(mealText(d.meals.lunch)),
      dinner: String(mealText(d.meals.dinner)),
    }));
}

function buildAttractionsList(itin: NormalizedItinerary): Array<{
  name: string;
  description: string;
  dayNumber: number;
}> {
  const seen = new Set<string>();
  const out: Array<{ name: string; description: string; dayNumber: number }> = [];
  for (const d of itin.days) {
    for (const a of d.attractions ?? []) {
      const key = a.name.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: key,
        description: a.description ?? "",
        dayNumber: d.dayNumber,
      });
    }
  }
  return out;
}

/**
 * Lion's day-1 / last-day transportation often holds outbound/inbound
 * flight info, e.g. "去程: 國泰航空 13:20" / "回程: 國泰航空 18:15".
 * We pull these into the `flights` column so the tour card can show
 * airline info without a full LLM rewrite.
 */
function buildFlightsFromItinerary(itin: NormalizedItinerary): {
  type: string;
  outbound: { description: string };
  inbound: { description: string };
} | null {
  if (itin.days.length === 0) return null;
  const first = itin.days[0];
  const last = itin.days[itin.days.length - 1];

  const outbound = first.transportation ?? "";
  const inbound = last.transportation ?? "";

  // Only emit if at least one looks like flight info (contains 航空/飛機/Air/Flight)
  const hasFlight = (s: string) =>
    /(航空|飛機|Air|Airline|Flight|機場|班機|航班)/i.test(s);
  if (!hasFlight(outbound) && !hasFlight(inbound)) return null;

  return {
    type: "FLIGHT",
    outbound: { description: outbound },
    inbound: { description: inbound },
  };
}

function buildDescription(input: HydrationInput): string {
  // Priority:
  //   1. First 2-3 highlights joined → if substantive
  //   2. Day titles 1-3 joined → if itinerary available
  //   3. supplier title + country + days → final fallback
  const parts: string[] = [];

  if (input.tourInfo?.highlights && input.tourInfo.highlights.length > 0) {
    const hls = input.tourInfo.highlights
      .filter((h) => h && h.length > 5)
      .slice(0, 3);
    if (hls.length > 0) {
      const joined = hls.join("、");
      if (joined.length >= 50) return joined;
      parts.push(joined);
    }
  }

  if (input.itinerary?.days && input.itinerary.days.length > 0) {
    const titles = input.itinerary.days
      .slice(0, 3)
      .map((d) => d.title)
      .filter(Boolean);
    if (titles.length > 0) {
      const text = `行程涵蓋:${titles.join(" → ")}`;
      parts.push(text);
    }
  }

  if (parts.length === 0 && input.supplierTitle) {
    // Final fallback — use supplier title + country/days as a stem.
    const stem = `${input.supplierTitle}`;
    const tail =
      input.destinationCountry && input.days
        ? ` (${input.days} 天 ${input.destinationCountry} 行程)`
        : "";
    parts.push(stem + tail);
  }

  return parts.join("。");
}

// ────────────────────────────────────────────────────────────────────────
// Safe-parse helper — callers pass DB text columns through this to get
// typed values back (or null on garbage).
// ────────────────────────────────────────────────────────────────────────

export function safeParseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
