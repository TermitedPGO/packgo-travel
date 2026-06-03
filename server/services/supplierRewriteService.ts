/**
 * supplierRewriteService — rewrite a supplier-imported DRAFT tour IN PLACE.
 *
 * WHY THIS EXISTS (2026-06-01 production fix)
 * ───────────────────────────────────────────
 * Supplier products (UV / Lion) import as DRAFT tours that ALREADY carry the
 * load-bearing facts: real price, real departures (134 of them), and a
 * structured `dailyItinerary` blob (= supplierProductDetails.itineraryParsed).
 * The old rewrite path called `generateTourFromUrlInternal(sourceUrl, …)` which
 * RE-SCRAPED the source URL and regenerated a brand-NEW tour from scratch. For
 * UV that URL is an unscrapeable JS SPA (`uvbookings.toursbms.com`), so the
 * rewrite produced garbage — price $598→$0, departures 134→0, destinationCity
 * "ToursBms-toursbms", itinerary "行程資訊缺失" — then marked the good draft
 * inactive. Net effect: a working tour replaced by a broken one.
 *
 * THE FIX
 * ───────
 * Don't re-scrape and don't create a new tour. The structured data is already
 * in the draft row. We synthesize a `rawData` object from the draft's existing
 * fields + its `dailyItinerary` blob, run the THREE prose agents on it
 * (ContentAnalyzer + DetailsSkill + ItineraryUnified — these are input-driven,
 * not URL-driven), and `updateTour` the prose fields IN PLACE.
 *
 * FACTS ARE NEVER TOUCHED: price / priceCurrency / departures /
 * destinationCountry / destinationCity / duration stay exactly as imported.
 * Those are the things the bug destroyed; preserving them is the whole point.
 *
 * On calibration reject we set status=inactive — we NEVER delete the tour or
 * its departures (deleting real departures is the bug we're fixing).
 */

import { createChildLogger } from "../_core/logger";
import { getTourById, getTourDepartures, updateTour } from "../db";
import { ContentAnalyzerAgent } from "../agents/contentAnalyzerAgent";
import { getDetailsSkill } from "../agents/_subskills/details/detailsSkill";
import { ItineraryUnifiedAgent } from "../agents/itineraryUnifiedAgent";
import { calibrateTour } from "../agents/calibrationAgent";

const log = createChildLogger({ module: "supplierRewriteService" });

export interface SupplierRewriteResult {
  success: boolean;
  tourId?: number;
  status?: string;
  error?: string;
}

/** Parse a value that may be a JSON string or already an object/array. */
function safeJsonParse(raw: unknown): any {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Coerce ANY supported itinerary blob into the per-day shape the prose agents
 * read: `[{ day, title, activities: string[], accommodation, meals }]`.
 *
 * Two source shapes are supported:
 *   1. NormalizedItinerary (UV import path):
 *        { totalDays, days: [{ dayNumber, title, attractions: [{name}],
 *          hotels: [{name, type}], meals: {breakfast, lunch, dinner} }] }
 *   2. Already agent-shaped array (Lion / re-run path):
 *        [{ day, title, activities: [...], accommodation, meals }]
 *
 * Returns `[]` when nothing usable is present.
 */
function normalizeItineraryDays(blob: any): Array<{
  day: number;
  title: string;
  activities: string[];
  accommodation: string;
  meals: any;
}> {
  if (!blob) return [];

  // Shape 1: NormalizedItinerary { totalDays, days: [...] }
  const days: any[] = Array.isArray(blob)
    ? blob
    : Array.isArray(blob?.days)
      ? blob.days
      : [];
  if (days.length === 0) return [];

  return days.map((d: any, idx: number) => {
    const dayNum = Number(d?.dayNumber ?? d?.day ?? idx + 1) || idx + 1;
    const title = typeof d?.title === "string" ? d.title : `Day ${dayNum}`;

    // Activities: prefer explicit `activities` (Lion/agent shape — array of
    // strings or {name|title} objects), else fall back to NormalizedItinerary
    // `attractions[].name`.
    let activities: string[] = [];
    if (Array.isArray(d?.activities)) {
      activities = d.activities
        .map((a: any) =>
          typeof a === "string" ? a : a?.name || a?.title || ""
        )
        .filter(Boolean);
    } else if (Array.isArray(d?.attractions)) {
      activities = d.attractions
        .map((a: any) => (typeof a === "string" ? a : a?.name || a?.title || ""))
        .filter(Boolean);
    }

    // Accommodation: prefer explicit `accommodation` string, else first
    // NormalizedItinerary hotel name.
    let accommodation = "";
    if (typeof d?.accommodation === "string") {
      accommodation = d.accommodation;
    } else if (Array.isArray(d?.hotels) && d.hotels.length > 0) {
      const h = d.hotels.find((x: any) => x?.name) || d.hotels[0];
      accommodation = typeof h === "string" ? h : h?.name || "";
    }

    return {
      day: dayNum,
      title,
      activities,
      accommodation,
      meals: d?.meals ?? {},
    };
  });
}

/**
 * Build the synthetic `rawData` object the prose agents expect, from a draft
 * tour row + its (already-stored) itinerary blob.
 *
 * The exact field paths below are the ones ContentAnalyzerAgent /
 * ItineraryUnifiedAgent / DetailsSkill read (verified against each agent's
 * source). This mirrors the Lion direct-API rawData shape in
 * server/agents/_pipeline/scrape.ts.
 */
export function buildRawDataFromDraft(tour: any): any {
  const itineraryBlob = safeJsonParse(tour.dailyItinerary ?? tour.itineraryDetailed);
  const dailyItinerary = normalizeItineraryDays(itineraryBlob);

  // Unique hotel names across all days → rawData.hotels (HotelData source for
  // DetailsSkill + originalHotels snapshot for ItineraryUnified).
  const hotelNames: string[] = [];
  for (const d of dailyItinerary) {
    const acc = (d.accommodation || "").trim();
    if (acc && !hotelNames.includes(acc)) hotelNames.push(acc);
  }
  const hotels = hotelNames.map((name) => ({ name, stars: "", description: "", location: "" }));

  // Unique attraction names across all days → rawData.attractions (highlights
  // source + originalAttractions snapshot).
  const attractionNames: string[] = [];
  for (const d of dailyItinerary) {
    for (const a of d.activities) {
      const name = (a || "").trim();
      if (name && !attractionNames.includes(name)) attractionNames.push(name);
    }
  }
  const attractions = attractionNames.map((name) => ({ name }));

  // Existing tour-level highlights (if the import stored any). Fall back to the
  // first handful of attraction names so ContentAnalyzer always has seeds.
  const existingHighlights = safeJsonParse(tour.highlights);
  const highlights: string[] = Array.isArray(existingHighlights)
    ? existingHighlights
        .map((h: any) => (typeof h === "string" ? h : h?.title || h?.name || ""))
        .filter(Boolean)
    : attractionNames.slice(0, 8);

  const days = Number(tour.duration) || dailyItinerary.length || 0;
  const nights =
    typeof tour.nights === "number" && tour.nights >= 0
      ? tour.nights
      : Math.max(0, days - 1);

  return {
    basicInfo: {
      title: tour.title || "",
      subtitle: "",
      description: tour.description || "",
      productCode: tour.productCode || "",
    },
    location: {
      destinationCountry: tour.destinationCountry || "",
      destinationCity: tour.destinationCity || "",
      departureCity: tour.departureCity || "",
    },
    duration: { days, nights },
    pricing: {
      price: tour.price || 0,
      basePrice: tour.price || 0,
      currency: tour.priceCurrency || "USD",
      priceNote: "",
    },
    highlights,
    // Both keys populated — ItineraryUnified reads `itinerary || dailyItinerary`,
    // DetailsSkill reads `dailyItinerary || itinerary`.
    dailyItinerary,
    itinerary: dailyItinerary,
    attractions,
    hotels,
    accommodation: hotels,
    meals: [],
    flights: [],
    // departureCity at top-level too — ItineraryUnified reads both paths.
    departureCity: tour.departureCity || "",
    destinationCountry: tour.destinationCountry || "",
    destinationCity: tour.destinationCity || "",
    sourceUrl: tour.sourceUrl || "",
    isPdfSource: false,
  };
}

/**
 * Rewrite a supplier-imported draft tour's PROSE fields in place, preserving
 * all facts (price / departures / destination / duration).
 *
 * Returns success:false WITHOUT calling any agent when the draft is missing,
 * has zero departures, or has a non-positive price — those are facts we must
 * preserve, and their absence means this isn't a healthy supplier draft to
 * polish (regenerating them is exactly the bug being fixed).
 */

/**
 * Jeff hard rule: NO em dashes (— —— – ―) in any customer-facing text. The LLM
 * occasionally emits them in titles/descriptions/itinerary prose. Strip them
 * from every saved string, replacing with a Chinese comma (Jeff's documented
 * preference: 逗號/句號/括號 over 破折號). Safe on JSON-string fields too — an
 * em dash inside a JSON value is just a character, so substitution keeps the
 * JSON valid. Exported + pure for unit testing.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*[—–―]+\s*/g, "，") // em/en dash / horizontal bar (runs) → comma
    .replace(/，{2,}/g, "，") // collapse doubled commas
    .replace(/，(?=[。！？：；、）」』】])/g, ""); // drop comma before closing punctuation
}

export async function rewriteSupplierTourInPlace(
  draftTourId: number
): Promise<SupplierRewriteResult> {
  log.info({ event: "rewrite_start", draftTourId }, "supplier rewrite-in-place start");

  const tour = await getTourById(draftTourId);
  if (!tour) {
    log.warn({ event: "rewrite_no_tour", draftTourId }, "tour not found — abort");
    return { success: false, error: `Tour ${draftTourId} not found` };
  }

  // Guard: facts must already be present. We refuse to "rewrite" a draft that
  // is missing the price/departures we're supposed to preserve.
  const departures = await getTourDepartures(draftTourId);
  if (departures.length === 0) {
    log.warn(
      { event: "rewrite_no_departures", draftTourId },
      "0 departures — refusing to rewrite (facts must be preserved, not regenerated)"
    );
    return { success: false, tourId: draftTourId, error: "tour has 0 departures" };
  }
  if (!(Number(tour.price) > 0)) {
    log.warn(
      { event: "rewrite_no_price", draftTourId, price: tour.price },
      "price<=0 — refusing to rewrite (facts must be preserved, not regenerated)"
    );
    return { success: false, tourId: draftTourId, error: "tour has non-positive price" };
  }

  // ── Synthesize rawData from existing draft fields + stored itinerary blob ──
  const rawData = buildRawDataFromDraft(tour);

  // ── Run the three prose agents on the synthetic rawData (reused as-is) ──
  let analyzed: any = null;
  let details: any = null;
  let itinerary: any = null;
  try {
    const contentAgent = new ContentAnalyzerAgent();
    const detailsSkill = getDetailsSkill();
    const itineraryAgent = new ItineraryUnifiedAgent();

    [analyzed, details, itinerary] = await Promise.all([
      contentAgent.execute(rawData),
      detailsSkill.executeAllCombined(rawData),
      itineraryAgent.execute(rawData),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ event: "rewrite_agent_error", draftTourId, err: msg }, "prose agents failed");
    return { success: false, tourId: draftTourId, error: msg };
  }

  if (!analyzed?.success || !analyzed.data) {
    log.error(
      { event: "rewrite_content_failed", draftTourId, err: analyzed?.error },
      "ContentAnalyzer returned no data"
    );
    return { success: false, tourId: draftTourId, error: analyzed?.error || "content analysis failed" };
  }

  const content = analyzed.data;
  const detailData = details?.data || {};

  // ── Assemble prose fields (all stored as JSON-string text columns) ──
  // FACTS DELIBERATELY OMITTED from this payload: price, priceCurrency,
  // departures, destinationCountry, destinationCity, duration, nights.
  const polishedItineraries = Array.isArray(itinerary?.data?.polishedItineraries)
    ? itinerary.data.polishedItineraries
    : [];

  const proseFields: Record<string, unknown> = {
    title: content.title || tour.title,
    description: content.description || tour.description,
    heroSubtitle: content.heroSubtitle ?? null,
    highlights: JSON.stringify(content.highlights ?? []),
    keyFeatures: JSON.stringify(content.keyFeatures ?? []),
    poeticTitle: content.poeticTitle ?? null,
    poeticContent: JSON.stringify(content.poeticContent ?? {}),
    poeticSubtitle: content.poeticSubtitle ?? null,
    costExplanation: JSON.stringify(detailData.costs ?? {}),
    noticeDetailed: JSON.stringify(detailData.notices ?? {}),
    hotels: JSON.stringify(detailData.hotels ?? []),
    meals: JSON.stringify(detailData.meals ?? []),
  };

  // Only overwrite itineraryDetailed when the agent actually produced days —
  // otherwise keep the imported blob (don't wipe real structure to empty).
  // updateTour auto-dual-writes itineraryDetailed↔dailyItinerary.
  if (polishedItineraries.length > 0) {
    proseFields.itineraryDetailed = JSON.stringify(polishedItineraries);
  }

  // Enforce the no-em-dash rule on every prose field (plain + JSON-string).
  for (const k of Object.keys(proseFields)) {
    const v = proseFields[k];
    if (typeof v === "string") proseFields[k] = stripEmDashes(v);
  }

  await updateTour(draftTourId, proseFields as any);
  log.info(
    {
      event: "rewrite_prose_saved",
      draftTourId,
      days: polishedItineraries.length,
      hotels: Array.isArray(detailData.hotels) ? detailData.hotels.length : 0,
      meals: Array.isArray(detailData.meals) ? detailData.meals.length : 0,
    },
    "prose fields updated in place"
  );

  // ── Calibrate the updated tour, then set status from the verdict ──
  // Re-read so calibration sees the merged row (facts + fresh prose).
  const updatedTour = await getTourById(draftTourId);
  let verdict: "approved" | "review" | "rejected" = "review";
  let totalScore = 0;
  try {
    const report = await calibrateTour(updatedTour);
    verdict = report.verdict;
    totalScore = report.totalScore;
  } catch (err) {
    // Calibration failure shouldn't lose the rewrite — fall back to review so
    // Jeff eyeballs it rather than auto-publishing or hiding.
    log.warn(
      { event: "rewrite_calibration_error", draftTourId, err: err instanceof Error ? err.message : String(err) },
      "calibration threw — defaulting verdict to review"
    );
    verdict = "review";
  }

  // approved → active, review → pending_review, rejected → inactive.
  // NEVER delete the tour or its departures on reject — losing real departures
  // is the exact bug this service fixes.
  const status =
    verdict === "approved" ? "active" : verdict === "rejected" ? "inactive" : "pending_review";

  await updateTour(draftTourId, { status: status as any });
  log.info(
    { event: "rewrite_done", draftTourId, verdict, totalScore, status },
    "supplier rewrite-in-place complete"
  );

  // Queue the EN translation for tours that will be visible (active /
  // pending_review). The old re-scrape path queued this from tourGenerator;
  // preserve that behavior here so rewritten supplier tours keep EN coverage.
  // Non-blocking + never throws — a translation hiccup must not fail the
  // rewrite. Skip for inactive (rejected) tours — no point translating hidden
  // rows.
  if (status !== "inactive") {
    try {
      const { addTourTranslationJob } = await import("../queue");
      await addTourTranslationJob({
        tourId: draftTourId,
        targetLanguages: ["en"],
        sourceLanguage: "zh-TW",
        userId: Number((tour as any).createdBy) || 1,
      });
    } catch (err) {
      log.warn(
        { event: "rewrite_translation_queue_failed", draftTourId, err: err instanceof Error ? err.message : String(err) },
        "failed to queue EN translation (non-fatal)"
      );
    }
  }

  return { success: true, tourId: draftTourId, status };
}
