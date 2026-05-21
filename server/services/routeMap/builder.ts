/**
 * Route-map builder — orchestrator that resolves an itinerary into
 * geocoded stops, then delegates to the renderer for the final
 * static-map URL.
 *
 * Extracted from server/routers/toursRouteMap.ts as part of v2 Wave 2
 * Module 2.13 (2026-05-21). Behavior is preserved verbatim from the
 * original 760-LOC procedure; only logging migrated from `console.*`
 * to the Pino `logger` (Wave 1 Module 1.2).
 *
 * Public surface:
 *   - buildRouteMap({ id }) — top-level entry. Loads tour, parses
 *     itinerary, resolves stops via Google → Nominatim → LLM rescue
 *     candidate chain, hands off to renderer.
 *
 * Internal pipeline:
 *   1. Tour lookup + itinerary parse  → early returns on missing data
 *   2. Per-day candidate building     → buildCandidatesForDay()
 *   3. Geocode loop (cache-aware)     → resolveStop()
 *   4. LLM rescue when all miss       → resolveWithLlm()
 *   5. Empty stops? country fallback  → buildCountryFallbackResult()
 *   6. Otherwise render               → renderRouteMap()
 */

import * as db from "../../db";
import { getAliases } from "../../_helpers/placeNameAliases";
import { normalizePlaceName } from "../../_helpers/llmPlaceNormalizer";
import { logger } from "../../_core/logger";
import {
  REGION_MAP,
  COUNTRY_EN,
  COUNTRY_ISO,
  getOuterCountryEn,
  getGoogleStatus,
  tryGoogle,
  tryNominatim,
  buildCountryFallbackResult,
  buildEmptyResult,
  type GeoCoord,
} from "./fallbacks";
import { renderRouteMap, type Stop } from "./renderer";

type Candidate = { q: string; expectedRegion: string | null };

/**
 * Extract DESTINATION (last city) from a day's title.
 *
 * Round 80.21 — previous `_extractFirstPlace` silently broke on the
 * common separator 「→」 (U+2192). For "台北 → 慕尼黑：飛越歐洲" it
 * returned the entire string → Google ZERO_RESULTS → fallback → country
 * map. Rules:
 *   1. Strip prefixes (Day N / 第 N 日)
 *   2. Strip parentheticals + colon-clauses
 *   3. Split on comprehensive separator set (→, ⇒, ↔, ⇄, >, -, etc.)
 *   4. Take the LAST chunk (day's destination)
 *   5. Prefer trailing English when bilingual ("慕尼黑Munich" → Munich)
 */
function extractDestinationPlace(raw: string): string {
  if (!raw) return "";
  let s = String(raw)
    .replace(/^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\+{2,}.*?\+{2,}/g, "")
    .trim();
  if (!s) return "";

  s = s.split(/[:：]/)[0].trim();
  if (!s) return "";

  // Comprehensive separator regex — includes → (U+2192), ⇒ (U+21D2),
  // ↔ (U+2194 bidirectional), ⇄ (U+21C4), > (ASCII), and ASCII
  // sequences "->", "=>", "<->", "<=>".
  const SEP = /\s*(?:↔|⇄|→|⇒|<->|<=>|->|=>|>|[／/、,，–—－])\s*| - | – /g;
  const chunks = s.split(SEP).map((c) => c.trim()).filter(Boolean);
  if (chunks.length === 0) return "";

  const lastChunk = chunks[chunks.length - 1];
  const englishMatch = lastChunk.match(/[A-Za-z][A-Za-z .'-]+(?:\s*[A-Za-z][A-Za-z .'-]+)*$/);
  if (englishMatch && englishMatch[0].length >= 3) {
    return englishMatch[0].trim();
  }
  return lastChunk;
}

/**
 * Build the candidate-query chain for a single itinerary day.
 *
 * Output is ordered most-specific → least-specific (callers iterate and
 * break on first hit). Strategy per Round 80.21 v3:
 *   1. "{cleaned}, {country}"   — most specific, wins if exact
 *   2. "{hint3}, {country}"     — 3-char city prefix
 *   3. "{hint2}, {country}"     — 2-char city prefix
 *   4. "{cleaned}"              — raw, last resort
 * For English-bearing queries, raw comes first (Google handles English
 * place names well even without a country qualifier).
 */
function buildCandidatesForDay(args: {
  day: any;
  country: string;
  departureCity: string;
}): { day: any; q: string; candidates: Candidate[]; expectedRegion: string | null } {
  const { day: d, country, departureCity } = args;

  const isJustCountry = (c: string): boolean => c === country;

  const explicitRaw = extractDestinationPlace((d.location || d.city || "").trim());
  const explicit = isJustCountry(explicitRaw) ? "" : explicitRaw;

  const acts = Array.isArray(d.activities) ? d.activities : [];
  const lastActLoc = acts.length > 0 && acts[acts.length - 1]?.location
    ? extractDestinationPlace(String(acts[acts.length - 1].location)) : "";
  const firstActLoc = acts.length > 0 && acts[0]?.location
    ? extractDestinationPlace(String(acts[0].location)) : "";
  const activityLast = isJustCountry(lastActLoc) ? "" : lastActLoc;
  const activityFirst = isJustCountry(firstActLoc) ? "" : firstActLoc;
  const fromTitle = extractDestinationPlace(d.title || "");
  // Round 80.21 v10 — title wins over activities[0]. Day 4
  // 「伯恩 → 黃金列車 → 蒙投」: activities[0]="伯恩舊城區" (start) but
  // title lastChunk = "蒙投" (end). Title wins.
  const cleaned = explicit || fromTitle || activityLast || activityFirst;
  if (!cleaned) return { day: d, q: "", candidates: [], expectedRegion: null };

  const countryEn = COUNTRY_EN[country] || country;
  const expectedIso = COUNTRY_ISO[country] || null;
  const expectedRegion = expectedIso ? REGION_MAP[expectedIso] : null;

  // Round 80.21 v4 — home-return detection. Bug case: Day 9 of tour
  // 990014 was "巴黎 → 台北:回程啟航". lastChunk = "台北", but
  // appending ", France" then querying Google found a Chinese
  // restaurant named "台北" in Paris (lat 48.85). When lastChunk
  // matches departureCity (or first 2 chars handles "台北 TPE"),
  // SKIP the destinationCountry qualifier entirely.
  const isHomeReturn = !!departureCity && (
    cleaned === departureCity ||
    cleaned === departureCity.slice(0, 2) ||
    (cleaned.startsWith(departureCity.slice(0, 2)) && cleaned.length <= departureCity.length + 2)
  );

  const hasEnglish = /[A-Za-z]{2,}/.test(cleaned);
  const candidates: Candidate[] = [];

  if (isHomeReturn) {
    candidates.push({ q: cleaned, expectedRegion: null });
  } else if (countryEn && !cleaned.includes(countryEn)) {
    if (hasEnglish) {
      candidates.push({ q: cleaned, expectedRegion: null });
      candidates.push({ q: `${cleaned}, ${countryEn}`, expectedRegion });
    } else {
      candidates.push({ q: `${cleaned}, ${countryEn}`, expectedRegion });
      if (cleaned.length >= 4) {
        const hint3 = cleaned.slice(0, 3);
        if (hint3 !== cleaned) {
          candidates.push({ q: `${hint3}, ${countryEn}`, expectedRegion });
        }
      }
      if (cleaned.length >= 3) {
        const hint2 = cleaned.slice(0, 2);
        if (hint2 !== cleaned && !candidates.some((c) => c.q === `${hint2}, ${countryEn}`)) {
          candidates.push({ q: `${hint2}, ${countryEn}`, expectedRegion });
        }
      }
      candidates.push({ q: cleaned, expectedRegion });
    }
  } else {
    candidates.push({ q: cleaned, expectedRegion: null });
  }

  // Round 80.21 v10 — alias candidates as final-tier fallback for
  // legacy OTA non-standard names (蒙投/冰河3000/西庸古堡/...).
  const aliases = getAliases(cleaned);
  for (const alias of aliases) {
    if (alias.en && !candidates.some((c) => c.q === alias.en)) {
      candidates.push({ q: alias.en, expectedRegion });
    }
    if (alias.zh && countryEn) {
      const aliasQ = `${alias.zh}, ${countryEn}`;
      if (!candidates.some((c) => c.q === aliasQ)) {
        candidates.push({ q: aliasQ, expectedRegion });
      }
    }
  }

  return { day: d, q: cleaned, candidates, expectedRegion };
}

/**
 * In-process geocode cache (24h effective via process lifetime).
 *
 * Round 80.21 v2 — cache key prefixed with CACHE_VERSION so logic
 * changes can invalidate stale negative entries without a restart.
 * Bump CACHE_VERSION on candidate-ordering changes.
 */
const CACHE_VERSION = "v13";
function getCache(): Map<string, GeoCoord | null> {
  let c = (globalThis as any).__packgoGeocodeCache as Map<string, GeoCoord | null> | undefined;
  if (!c) {
    c = new Map<string, GeoCoord | null>();
    (globalThis as any).__packgoGeocodeCache = c;
  }
  return c;
}
function cacheKey(country: string, cand: string): string {
  return `${CACHE_VERSION}:${country}:${cand}`;
}

/**
 * Try resolving a single candidate chain (cache → Google → Nominatim).
 * Mutates the cache as it goes. Returns the first successful coord or
 * null if all candidates miss.
 */
async function resolveCandidateChain(
  country: string,
  candidates: Candidate[],
): Promise<GeoCoord | null> {
  const cache = getCache();
  for (const c of candidates) {
    const cand = c.q;
    const expRegion = c.expectedRegion;
    const key = cacheKey(country, cand);

    // Cache hit (positive)
    const cached = cache.get(key);
    if (cached) return cached;
    // Cache hit (negative)
    if (cache.has(key)) continue;

    const status = getGoogleStatus();
    if (!status.denied) {
      const g = await tryGoogle(cand, expRegion);
      if (g) {
        cache.set(key, g);
        return g;
      }
      // Re-check denied: tryGoogle may have just flipped the flag
      if (!getGoogleStatus().denied) {
        cache.set(key, null);
        continue;
      }
      // fall through to Nominatim
    }

    const n = await tryNominatim(cand, expRegion);
    if (n) {
      cache.set(key, n);
      return n;
    }
    cache.set(key, null);
    // Nominatim 1 req/sec etiquette (only on actual API calls; cache hits skip)
    await new Promise((r) => setTimeout(r, 1100));
  }
  return null;
}

/**
 * LLM rescue when both alias chain and direct geocoding miss.
 *
 * Round 80.21 v11 — asks Claude Haiku to normalize the place name;
 * result cached in Redis (30-day TTL) so subsequent requests hit cache.
 */
async function resolveWithLlm(args: {
  q: string;
  country: string;
  expectedRegion: string | null;
}): Promise<GeoCoord | null> {
  const { q, country, expectedRegion } = args;
  const llmAlias = await normalizePlaceName(q, country);
  if (!llmAlias || (!llmAlias.en && !llmAlias.zh)) return null;

  const outerCountryEn = getOuterCountryEn(country);
  const llmCandidates: Candidate[] = [];
  if (llmAlias.en) llmCandidates.push({ q: llmAlias.en, expectedRegion });
  if (llmAlias.zh && outerCountryEn) {
    llmCandidates.push({ q: `${llmAlias.zh}, ${outerCountryEn}`, expectedRegion });
  }

  const cache = getCache();
  for (const c of llmCandidates) {
    const cand = c.q;
    const key = cacheKey(country, cand);
    const cached = cache.get(key);
    if (cached) return cached;
    if (cache.has(key)) continue;

    const status = getGoogleStatus();
    if (!status.denied) {
      const g = await tryGoogle(cand, c.expectedRegion);
      if (g) {
        cache.set(key, g);
        logger.info(
          { event: "route_map.llm_rescue.google_hit", original: q, alias: cand, lat: g.lat, lng: g.lng },
          `[getRouteMap] LLM rescue: "${q}" → "${cand}" (${g.lat.toFixed(2)},${g.lng.toFixed(2)})`,
        );
        return g;
      }
      cache.set(key, null);
      continue;
    }
    const n = await tryNominatim(cand, c.expectedRegion);
    if (n) {
      cache.set(key, n);
      logger.info(
        { event: "route_map.llm_rescue.nominatim_hit", original: q, alias: cand, lat: n.lat, lng: n.lng },
        `[getRouteMap] LLM rescue (Nominatim): "${q}" → "${cand}" (${n.lat.toFixed(2)},${n.lng.toFixed(2)})`,
      );
      return n;
    }
    cache.set(key, null);
    await new Promise((r) => setTimeout(r, 1100));
  }
  return null;
}

/**
 * Strip "Day N / 第 N 日" prefixes from the human-readable stop name
 * we surface to the client legend.
 */
function cleanStopName(d: any, q: string): string {
  return (d.title || d.location || d.city || q).replace(
    /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
    "",
  );
}

export type RouteMapResult = {
  staticMapUrl: string | null;
  stops: Stop[];
  outliers?: Stop[];
  directionsUrl: string | null;
  aiMapUrl: string | null;
  fallbackMode?: "country" | "names_only";
};

/**
 * Build the full route-map payload for a tour. Returns the same shape
 * that `trpc.tours.getRouteMap` has always returned — client consumers
 * (TourRouteMapSvg.tsx) need no changes.
 */
export async function buildRouteMap(args: { id: number }): Promise<RouteMapResult> {
  const tour = await db.getTourById(args.id);
  if (!tour) {
    return buildEmptyResult(null);
  }

  const aiMapUrl = (tour as any).aiMapUrl ?? null;

  // Parse itinerary
  let itinerary: any[] = [];
  try {
    itinerary = typeof (tour as any).itineraryDetailed === "string"
      ? JSON.parse((tour as any).itineraryDetailed)
      : (tour as any).itineraryDetailed || [];
  } catch {
    itinerary = [];
  }
  if (!Array.isArray(itinerary) || itinerary.length === 0) {
    return buildEmptyResult(aiMapUrl);
  }

  const country = (tour as any).destinationCountry || "";
  const departureCity = ((tour as any).departureCity || "").trim();

  // Build per-day candidate chains
  const queries = itinerary.map((d: any) =>
    buildCandidatesForDay({ day: d, country, departureCity }),
  );

  // Resolve each day
  const stops: Stop[] = [];
  for (let i = 0; i < queries.length; i++) {
    const { day, q, candidates, expectedRegion } = queries[i];
    if (!q) continue;

    let coord = await resolveCandidateChain(country, candidates);
    if (!coord && q) {
      coord = await resolveWithLlm({ q, country, expectedRegion });
    }
    if (coord) {
      stops.push({
        day: i + 1,
        name: cleanStopName(day, q),
        lat: coord.lat,
        lng: coord.lng,
      });
    }
  }

  // No city-level coords resolved → country-level fallback
  if (stops.length === 0) {
    return buildCountryFallbackResult({
      country,
      queries: queries.map((q) => ({ q: q.q, day: q.day })),
      aiMapUrl,
    });
  }

  // Render with cluster filter + branded static map
  const rendered = renderRouteMap(stops);
  return {
    staticMapUrl: rendered.staticMapUrl,
    stops: rendered.primaryStops,
    outliers: rendered.outlierStops,
    directionsUrl: rendered.directionsUrl,
    aiMapUrl,
  };
}
