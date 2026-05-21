/**
 * Route-map fallback helpers — geocoders, ISO/region tables, country-level
 * fallback result builder.
 *
 * Extracted from server/routers/toursRouteMap.ts as part of v2 Wave 2
 * Module 2.13 (2026-05-21). Behavior is preserved verbatim from the
 * original 760-LOC procedure; only logging was migrated from
 * `console.*` to the Pino `logger` (Wave 1 Module 1.2).
 *
 * Public surface:
 *   - REGION_MAP / COUNTRY_EN / COUNTRY_ISO — lookup tables
 *   - getGoogleStatus() — process-wide Google-denied flag + 60s cooldown
 *   - tryGoogle(cand, expectedRegion) — Google geocode with region validation
 *   - tryNominatim(cand, expectedRegion) — Nominatim fallback (no API key)
 *   - getOuterCountryEn(country) — country English name (subset for outer scope)
 *   - buildCountryFallbackResult(...) — country-level static map URL when
 *     no city-level coords resolve
 *   - buildEmptyResult(aiMapUrl) — shape for missing-tour / empty-itinerary
 *   - GeoCoord — shared coordinate type
 */

import { logger } from "../../_core/logger";

export type GeoCoord = { lat: number; lng: number };

/**
 * ISO 3166-1 alpha-2 → region group. Used for soft region validation
 * (Round 80.21 v7 — strict country match was too restrictive; rejected
 * legitimate neighbor-country stops like Munich on a Switzerland tour).
 */
export const REGION_MAP: Record<string, string> = {
  // Europe
  at: "EU", be: "EU", bg: "EU", ch: "EU", cz: "EU", de: "EU", dk: "EU",
  ee: "EU", es: "EU", fi: "EU", fr: "EU", gb: "EU", gr: "EU", hr: "EU",
  hu: "EU", ie: "EU", is: "EU", it: "EU", li: "EU", lt: "EU", lu: "EU",
  lv: "EU", mc: "EU", mt: "EU", nl: "EU", no: "EU", pl: "EU", pt: "EU",
  ro: "EU", se: "EU", si: "EU", sk: "EU", va: "EU", ad: "EU", sm: "EU",
  // East Asia
  cn: "EA", hk: "EA", jp: "EA", kr: "EA", mo: "EA", mn: "EA", tw: "EA", kp: "EA",
  // Southeast Asia
  bn: "SE", id: "SE", kh: "SE", la: "SE", mm: "SE", my: "SE", ph: "SE",
  sg: "SE", th: "SE", tl: "SE", vn: "SE",
  // South Asia
  af: "SA", bd: "SA", bt: "SA", in: "SA", lk: "SA", mv: "SA", np: "SA", pk: "SA",
  // Middle East / North Africa
  ae: "ME", bh: "ME", eg: "ME", il: "ME", iq: "ME", ir: "ME", jo: "ME",
  kw: "ME", lb: "ME", om: "ME", qa: "ME", sa: "ME", sy: "ME", tr: "ME",
  ye: "ME", ps: "ME",
  // Africa (sub-Saharan)
  dz: "AF", et: "AF", gh: "AF", ke: "AF", ma: "AF", ng: "AF", rw: "AF",
  sn: "AF", tn: "AF", tz: "AF", ug: "AF", za: "AF",
  // North America
  ca: "NA", mx: "NA", us: "NA",
  // Latin America
  ar: "LA", bo: "LA", br: "LA", cl: "LA", co: "LA", cu: "LA", do: "LA",
  ec: "LA", gt: "LA", hn: "LA", ni: "LA", pa: "LA", pe: "LA", py: "LA",
  sv: "LA", uy: "LA", ve: "LA", cr: "LA", jm: "LA", pr: "LA",
  // Oceania
  au: "OC", fj: "OC", nc: "OC", nz: "OC", pf: "OC", pg: "OC", to: "OC", ws: "OC",
  // CIS / Caucasus / Central Asia
  am: "CA", az: "CA", by: "CA", ge: "CA", kg: "CA", kz: "CA", md: "CA",
  ru: "CA", tj: "CA", tm: "CA", ua: "CA", uz: "CA",
};

/** Chinese country name → English (for Google geocoder qualifier). */
export const COUNTRY_EN: Record<string, string> = {
  "瑞士": "Switzerland", "德國": "Germany", "奧地利": "Austria",
  "法國": "France", "義大利": "Italy", "英國": "United Kingdom",
  "西班牙": "Spain", "葡萄牙": "Portugal", "荷蘭": "Netherlands",
  "比利時": "Belgium", "希臘": "Greece", "捷克": "Czech Republic",
  "美國": "USA", "加拿大": "Canada", "墨西哥": "Mexico",
  "日本": "Japan", "韓國": "South Korea", "中國": "China",
  "泰國": "Thailand", "越南": "Vietnam", "新加坡": "Singapore",
  "馬來西亞": "Malaysia", "印尼": "Indonesia", "菲律賓": "Philippines",
  "澳洲": "Australia", "紐西蘭": "New Zealand", "土耳其": "Turkey",
  "波蘭": "Poland", "蒙古": "Mongolia", "俄羅斯": "Russia",
  // Middle East + Africa
  "阿聯": "United Arab Emirates", "阿拉伯聯合大公國": "United Arab Emirates",
  "杜拜": "Dubai, United Arab Emirates", "埃及": "Egypt",
  "以色列": "Israel", "約旦": "Jordan", "摩洛哥": "Morocco",
  "南非": "South Africa", "肯亞": "Kenya", "坦尚尼亞": "Tanzania",
  // Latin America
  "巴西": "Brazil", "阿根廷": "Argentina", "智利": "Chile", "秘魯": "Peru",
  // South Asia
  "印度": "India", "尼泊爾": "Nepal", "斯里蘭卡": "Sri Lanka",
  "不丹": "Bhutan", "馬爾地夫": "Maldives",
  // CIS / Caucasus
  "喬治亞": "Georgia", "亞美尼亞": "Armenia", "亞塞拜然": "Azerbaijan",
  "哈薩克": "Kazakhstan", "烏茲別克": "Uzbekistan",
};

/** Chinese country name → ISO 3166-1 alpha-2 (for region lookup). */
export const COUNTRY_ISO: Record<string, string> = {
  "瑞士": "ch", "德國": "de", "奧地利": "at",
  "法國": "fr", "義大利": "it", "英國": "gb",
  "西班牙": "es", "葡萄牙": "pt", "荷蘭": "nl",
  "比利時": "be", "希臘": "gr", "捷克": "cz",
  "美國": "us", "加拿大": "ca", "墨西哥": "mx",
  "日本": "jp", "韓國": "kr", "中國": "cn",
  "泰國": "th", "越南": "vn", "新加坡": "sg",
  "馬來西亞": "my", "印尼": "id", "菲律賓": "ph",
  "澳洲": "au", "紐西蘭": "nz", "土耳其": "tr",
  "波蘭": "pl", "蒙古": "mn", "俄羅斯": "ru",
  "阿聯": "ae", "阿拉伯聯合大公國": "ae",
  "杜拜": "ae", "埃及": "eg",
  "以色列": "il", "約旦": "jo", "摩洛哥": "ma",
  "南非": "za", "肯亞": "ke", "坦尚尼亞": "tz",
  "巴西": "br", "阿根廷": "ar", "智利": "cl", "秘魯": "pe",
  "印度": "in", "尼泊爾": "np", "斯里蘭卡": "lk",
  "不丹": "bt", "馬爾地夫": "mv",
  "喬治亞": "ge", "亞美尼亞": "am", "亞塞拜然": "az",
  "哈薩克": "kz", "烏茲別克": "uz",
  "台灣": "tw", "香港": "hk",
};

/**
 * Subset of COUNTRY_EN used by the outer-scope LLM rescue path
 * (preserved verbatim from the original — has slightly fewer
 * entries than the inner-loop map, which is intentional per
 * pre-extraction behavior).
 */
const OUTER_COUNTRY_EN: Record<string, string> = {
  "瑞士": "Switzerland", "德國": "Germany", "奧地利": "Austria",
  "法國": "France", "義大利": "Italy", "英國": "United Kingdom",
  "西班牙": "Spain", "葡萄牙": "Portugal", "荷蘭": "Netherlands",
  "比利時": "Belgium", "希臘": "Greece", "捷克": "Czech Republic",
  "美國": "USA", "加拿大": "Canada", "墨西哥": "Mexico",
  "日本": "Japan", "韓國": "South Korea", "中國": "China",
  "泰國": "Thailand", "越南": "Vietnam", "新加坡": "Singapore",
  "馬來西亞": "Malaysia", "印尼": "Indonesia", "菲律賓": "Philippines",
  "澳洲": "Australia", "紐西蘭": "New Zealand", "土耳其": "Turkey",
  "阿聯": "United Arab Emirates", "杜拜": "Dubai, United Arab Emirates",
  "埃及": "Egypt", "以色列": "Israel", "摩洛哥": "Morocco",
  "南非": "South Africa", "肯亞": "Kenya",
  "印度": "India", "尼泊爾": "Nepal", "斯里蘭卡": "Sri Lanka",
  "台灣": "Taiwan", "香港": "Hong Kong",
};

export function getOuterCountryEn(country: string): string {
  return OUTER_COUNTRY_EN[country] || country;
}

/**
 * Process-wide Google REQUEST_DENIED tracker. When prod returned
 * REQUEST_DENIED ("project not found"), all geocode calls failed and
 * getRouteMap returned 0 stops, triggering the chip-fallback view.
 * Now: track the denial, fall through to Nominatim, retry Google after
 * 60s cooldown (so a key fix is picked up automatically).
 */
type GoogleStatus = { denied: boolean; deniedSince: number };
const GOOGLE_RETRY_COOLDOWN_MS = 60_000;

export function getGoogleStatus(): GoogleStatus {
  const g = (globalThis as any).__packgoGoogleStatus as GoogleStatus | undefined;
  if (!g) {
    const fresh: GoogleStatus = { denied: false, deniedSince: 0 };
    (globalThis as any).__packgoGoogleStatus = fresh;
    return fresh;
  }
  // Auto-clear denied flag after cooldown
  if (g.denied && Date.now() - g.deniedSince > GOOGLE_RETRY_COOLDOWN_MS) {
    g.denied = false;
  }
  return g;
}

/**
 * Google geocode with region validation. Returns null on:
 *   - REQUEST_DENIED (sets process-wide denied flag)
 *   - ZERO_RESULTS / other non-OK
 *   - Country-level fallback (types includes "country" with no
 *     locality/sublocality/POI siblings) — rejects coarse fallback
 *     so the next candidate is tried
 *   - Region mismatch (e.g. Lai Châu (VN, SE) returned for a CH/EU query)
 */
export async function tryGoogle(
  cand: string,
  expRegion: string | null,
): Promise<GeoCoord | null> {
  try {
    const { makeRequest } = await import("../../_core/map");
    const resp = await makeRequest<any>("/maps/api/geocode/json", { address: cand });
    if (resp?.status === "REQUEST_DENIED") {
      const status = getGoogleStatus();
      if (!status.denied) {
        logger.warn(
          { event: "route_map.google.request_denied", cand, reason: resp.error_message || "no message" },
          "[getRouteMap] Google REQUEST_DENIED — switching to Nominatim fallback for the rest of this request batch.",
        );
        status.denied = true;
        status.deniedSince = Date.now();
      }
      return null;
    }
    if (resp?.status && resp.status !== "OK" && resp.status !== "ZERO_RESULTS") {
      logger.warn(
        { event: "route_map.google.bad_status", cand, status: resp.status, error: resp.error_message || "" },
        `[getRouteMap] geocode "${cand}" returned status=${resp.status}`,
      );
    }
    const result = resp?.results?.[0];
    const loc = result?.geometry?.location;
    if (!loc?.lat || !loc?.lng) return null;
    // Reject country-level fallback (Google returns country center when
    // the city isn't found in the given country). Identified by types=
    // ["country", "political"] with no locality/POI siblings.
    const resTypes: string[] = Array.isArray(result?.types) ? result.types : [];
    const isCountryFallback = resTypes.includes("country") &&
      !resTypes.some((t) => [
        "locality", "sublocality", "neighborhood",
        "administrative_area_level_2", "administrative_area_level_3",
        "tourist_attraction", "point_of_interest", "establishment",
      ].includes(t));
    if (isCountryFallback) {
      logger.info(
        { event: "route_map.google.country_fallback_rejected", cand, types: resTypes },
        `[getRouteMap] Google "${cand}" returned country-level result — rejecting, will try next candidate`,
      );
      return null;
    }
    // Region validation
    if (expRegion) {
      const resCountry = result?.address_components?.find(
        (c: any) => c?.types?.includes("country"),
      )?.short_name?.toLowerCase();
      const resRegion = resCountry ? REGION_MAP[resCountry] : null;
      if (resRegion && resRegion !== expRegion) {
        logger.info(
          { event: "route_map.google.region_mismatch", cand, expected: expRegion, got: resRegion, country: resCountry },
          `[getRouteMap] Google "${cand}" region mismatch — rejecting`,
        );
        return null;
      }
    }
    return { lat: loc.lat, lng: loc.lng };
  } catch (err) {
    logger.warn(
      { event: "route_map.google.error", cand, err: (err as Error).message },
      `[getRouteMap] Google geocode failed for "${cand}"`,
    );
    return null;
  }
}

/**
 * Nominatim (OpenStreetMap) geocode fallback. No API key required.
 * Rate limit: 1 req/sec (enforced by callers via sleep). 8s timeout.
 */
export async function tryNominatim(
  cand: string,
  expRegion: string | null,
): Promise<GeoCoord | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&accept-language=en,zh-TW&q=${encodeURIComponent(cand)}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "PACK&GO Travel (Newark CA) +https://packgoplay.com",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      logger.warn(
        { event: "route_map.nominatim.bad_status", cand, status: resp.status },
        `[getRouteMap] Nominatim "${cand}" returned ${resp.status}`,
      );
      return null;
    }
    const data = (await resp.json()) as any[];
    const first = data?.[0];
    if (!first?.lat || !first?.lon) return null;
    // Region validation
    if (expRegion) {
      const resCountry = (first?.address?.country_code || "").toLowerCase();
      const resRegion = resCountry ? REGION_MAP[resCountry] : null;
      if (resRegion && resRegion !== expRegion) {
        logger.info(
          { event: "route_map.nominatim.region_mismatch", cand, expected: expRegion, got: resRegion, country: resCountry },
          `[getRouteMap] Nominatim "${cand}" region mismatch — rejecting`,
        );
        return null;
      }
    }
    return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
  } catch (err) {
    logger.warn(
      { event: "route_map.nominatim.error", cand, err: (err as Error).message },
      `[getRouteMap] Nominatim failed for "${cand}"`,
    );
    return null;
  }
}

/**
 * Shape returned when the tour exists but no city-level coords resolved
 * AND we have a recognized country to center on. Built using the
 * Static Maps API (different surface than Geocoding — works even when
 * Geocoding's REQUEST_DENIED locks us out).
 */
export function buildCountryFallbackResult(args: {
  country: string;
  queries: { q: string; day: any }[];
  aiMapUrl: string | null;
}): {
  staticMapUrl: string | null;
  stops: { day: number; name: string; lat: number; lng: number }[];
  directionsUrl: string | null;
  fallbackMode: "country" | "names_only";
  aiMapUrl: string | null;
} {
  const { country, queries, aiMapUrl } = args;
  const COUNTRY_EN_FALLBACK: Record<string, string> = {
    "瑞士": "Switzerland", "德國": "Germany", "奧地利": "Austria",
    "法國": "France", "義大利": "Italy", "英國": "United Kingdom",
    "美國": "USA", "日本": "Japan", "韓國": "South Korea",
    "馬來西亞": "Malaysia", "泰國": "Thailand", "新加坡": "Singapore",
    "杜拜": "Dubai, United Arab Emirates", "阿聯": "United Arab Emirates",
    "阿拉伯聯合大公國": "United Arab Emirates",
    "埃及": "Egypt", "以色列": "Israel", "約旦": "Jordan",
    "摩洛哥": "Morocco", "土耳其": "Turkey",
    "印度": "India", "尼泊爾": "Nepal", "斯里蘭卡": "Sri Lanka",
    "馬爾地夫": "Maldives", "中國": "China", "越南": "Vietnam",
    "印尼": "Indonesia", "菲律賓": "Philippines", "澳洲": "Australia",
    "紐西蘭": "New Zealand", "加拿大": "Canada", "墨西哥": "Mexico",
    "巴西": "Brazil", "南非": "South Africa", "肯亞": "Kenya",
    "西班牙": "Spain", "葡萄牙": "Portugal",
    "希臘": "Greece", "荷蘭": "Netherlands", "比利時": "Belgium",
    "捷克": "Czech Republic", "波蘭": "Poland", "俄羅斯": "Russia",
  };

  // Even without geocoding, show itinerary place names in the legend
  const rawStops = queries
    .filter((q) => q.q)
    .slice(0, 26)
    .map((q, i) => ({
      day: i + 1,
      name: (q.day.title || q.day.location || q.day.city || q.q).replace(
        /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
        "",
      ),
      lat: 0,
      lng: 0,
    }));

  const countryNameForMap = COUNTRY_EN_FALLBACK[country] || country;
  if (countryNameForMap) {
    const apiKey = process.env.GOOGLE_API_KEY || "";
    const params = new URLSearchParams();
    params.set("size", "1200x520");
    params.set("scale", "2");
    params.set("maptype", "roadmap");
    params.set("center", countryNameForMap);
    params.set("zoom", country.includes("杜拜") ? "9" : "5");
    params.set("key", apiKey);
    const fallbackUrl = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
    const directionsFallback = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(countryNameForMap)}`;
    return {
      staticMapUrl: fallbackUrl,
      stops: rawStops,
      directionsUrl: directionsFallback,
      fallbackMode: "country" as const,
      aiMapUrl,
    };
  }
  return {
    staticMapUrl: null,
    stops: rawStops,
    directionsUrl: null,
    fallbackMode: "names_only" as const,
    aiMapUrl,
  };
}

/** Shape returned when the tour is missing or itinerary is empty. */
export function buildEmptyResult(aiMapUrl: string | null) {
  return {
    staticMapUrl: null,
    stops: [],
    directionsUrl: null,
    aiMapUrl,
  };
}
