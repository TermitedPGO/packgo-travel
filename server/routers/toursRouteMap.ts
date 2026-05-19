/**
 * Tours route-map router — geocoding + Google Static Map URL builder
 * for the daily itinerary, plus admin AI-map regeneration.
 *
 * Extracted from server/routers.ts (Phase 4A · sub-PR 1 of 5) on
 * 2026-05-18 as part of the routers.ts split (audit P0-1).
 * Source ranges (verbatim from origin):
 *   L1606-1616  regenerateAiMap (admin)
 *   L1618-2378  getRouteMap (public) — 760-LOC single procedure
 *
 * ─────────────────────────────────────────────────────────────────
 *  DOCUMENTED EXCEPTION TO THE ≤300 LOC RULE (CLAUDE.md §9.6)
 * ─────────────────────────────────────────────────────────────────
 * This file deliberately exceeds the 300-LOC ceiling because the
 * `getRouteMap` procedure alone is ~760 LOC — a single coherent unit
 * containing SVG/static-map generation, multi-tier geocoding
 * (Google + Nominatim + LLM rescue), regional fallbacks, and
 * candidate-ordering heuristics built up across rounds 80.21 v1-v11.
 *
 * Splitting it WITHIN this PR would require refactoring procedure
 * bodies, which violates the "verbatim copy" rule for Phase 4A.
 * Instead we isolate it in its own file so the rest of the codebase
 * stays ≤300 LOC.
 *
 * **v2 backlog item:** decompose `getRouteMap` into:
 *   - server/services/routeMap/queryBuilder.ts (candidate construction)
 *   - server/services/routeMap/geocoder.ts (Google / Nominatim / LLM)
 *   - server/services/routeMap/staticMapBuilder.ts (URL assembly)
 *   - server/services/routeMap/regionMap.ts (ISO/region tables)
 * Then this router thins to ~80 LOC orchestrating those services.
 */

import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { getAliases } from "../_helpers/placeNameAliases";
import { normalizePlaceName } from "../_helpers/llmPlaceNormalizer";

export const toursRouteMapRouter = router({
  /**
   * Admin: regenerate the per-tour AI travel map via gpt-image-2.
   * Reads the tour's stops + transport segments, builds a region-aware
   * prompt, calls OpenAI, uploads the PNG to R2, and saves the URL to
   * `tours.aiMapUrl`. Cost: ~$0.28 per call. Duration: ~135-160s.
   *
   * v331 Phase A — synchronous; admin UI shows a spinner and waits.
   * Phase B will move this to a BullMQ job for non-blocking generation.
   */
  regenerateAiMap: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { generateTourMap } = await import("../services/tourMapGenerator");
      const result = await generateTourMap({ tourId: input.id });
      return {
        aiMapUrl: result.url,
        cost: result.cost,
        durationMs: result.durationMs,
      };
    }),

  /**
   * v78o Sprint 7: Tour route map — server-side geocoding + Google Static
   * Map URL for the daily itinerary. We do this server-side because the
   * client-side Forge proxy isn't available in production.
   *
   * Returns: { staticMapUrl, stops: [{day, name, lat, lng}] }
   * The static map URL is signed once with our GOOGLE_API_KEY (server-only),
   * so the frontend just renders it as <img>. Cached in-memory for 24h.
   */
  getRouteMap: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const tour = await db.getTourById(input.id);
      if (!tour) {
        return {
          staticMapUrl: null,
          stops: [],
          directionsUrl: null,
          aiMapUrl: null,
        };
      }

      // v331 — surface the AI tour-map URL so the client can render
      // the painted PNG instead of the SVG canvas when it's available.
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
        return {
          staticMapUrl: null,
          stops: [],
          directionsUrl: null,
          aiMapUrl,
        };
      }

      // Build geocode queries — itinerary titles are like "慕尼黑Munich－258km－聖加侖St.Gallen"
      // Strategy: split on multi-city separators, take first chunk, extract trailing English
      // (bilingual format: "ChineseEnglish" with no space — English is more reliable for geocoding)
      const country = (tour as any).destinationCountry || "";

      // Round 80.21 — extract DESTINATION (last city) from a day's title.
      // The previous version (`_extractFirstPlace`) silently broke on the
      // most common separator in PACK&GO-formatted itineraries: 「→」
      // (U+2192). For "台北 → 慕尼黑：飛越歐洲" it returned the entire
      // string as the first chunk, then appended ", Switzerland" → Google
      // ZERO_RESULTS, fallback triggered, country-level map shown.
      //
      // New rules:
      // 1. Strip prefixes (Day N / 第 N 日)
      // 2. Strip parentheticals + colon-clauses (「飛越歐洲」 description)
      // 3. Split on a comprehensive separator set (now includes →,>,⇒)
      // 4. Take the LAST chunk — that's where the traveler ends the day
      //    (e.g. "台北 → 慕尼黑" → "慕尼黑"; geocode result is more useful
      //    for the destination than the start).
      // 5. Prefer trailing English when bilingual ("慕尼黑Munich" → Munich)
      const _extractDestinationPlace = (raw: string): string => {
        if (!raw) return "";
        let s = String(raw)
          .replace(/^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i, "")
          .replace(/[（(].*?[）)]/g, "")  // strip parentheticals
          .replace(/\+{2,}.*?\+{2,}/g, "") // strip "+++接駁..." asides
          .trim();
        if (!s) return "";

        // Strip everything after a colon — that's typically the day's
        // theme/description, not a location ("飛越歐洲" / "返程啟航").
        // The space before ":" is preserved if present.
        s = s.split(/[:：]/)[0].trim();
        if (!s) return "";

        // Comprehensive separator regex — adds → (U+2192), ⇒ (U+21D2),
        // ↔ (U+2194 bidirectional), ⇄ (U+21C4), > (ASCII), and ASCII
        // sequences "->", "=>", "<->", "<=>". Round 80.21 follow-up:
        // the ↔ char actually appears in some itineraries as a
        // bidirectional flight indicator ("台北 ↔ 巴黎") — without
        // splitting on it, geocoding queries the entire string and
        // gets ZERO_RESULTS.
        const SEP = /\s*(?:↔|⇄|→|⇒|<->|<=>|->|=>|>|[／/、,，–—－])\s*| - | – /g;
        const chunks = s.split(SEP).map(c => c.trim()).filter(Boolean);
        if (chunks.length === 0) return "";

        // Take the LAST chunk — the day's destination.
        const lastChunk = chunks[chunks.length - 1];

        // Prefer trailing English when bilingual ("慕尼黑Munich" → Munich)
        const englishMatch = lastChunk.match(/[A-Za-z][A-Za-z .'-]+(?:\s*[A-Za-z][A-Za-z .'-]+)*$/);
        if (englishMatch && englishMatch[0].length >= 3) {
          return englishMatch[0].trim();
        }
        return lastChunk;
      };
      // Backwards-compat alias (kept in case other code paths reference it)
      const _extractFirstPlace = _extractDestinationPlace;

      // Region map — moved out of the queries.map callback so tryGoogle
      // and tryNominatim (defined later, in a sibling scope) can use it.
      const _region: Record<string, string> = {
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

      const queries: { day: any; q: string }[] = itinerary.map((d: any) => {
        // Prefer explicit location/city, then activities[0].location, then parsed title.
        // Round 80.21 v4 — bug fix: activities[0].location was used RAW
        // ("巴黎 ↔ 台北") which broke isHomeReturn detection (cleaned
        // didn't equal departureCity). Now we run it through the same
        // _extractDestinationPlace as titles, so all three sources
        // produce a clean lastChunk consistently.
        //
        // v9 — additional bug fix: activities[0].location is sometimes
        // formatted "{city},{country}" (full-width comma). After
        // splitting, lastChunk = country name (「瑞士」), which would
        // get rejected as a country-fallback by tryGoogle. We must
        // skip extraction results that match the destinationCountry
        // and fall through to the title path instead.
        //
        // Only compares against Chinese country name (`country`) here
        // — `countryEn` isn't computed yet at this point in the loop.
        const _isJustCountry = (c: string): boolean => {
          return c === country;
        };
        const explicitRaw = _extractDestinationPlace((d.location || d.city || "").trim());
        const explicit = _isJustCountry(explicitRaw) ? "" : explicitRaw;
        // Round 80.21 v10 — prefer title's lastChunk over activities[0].
        // activities[0] is the FIRST activity of the day (typically the
        // morning stop or starting point), but for the route map we
        // want the day's DESTINATION (where the traveler ends the day).
        // Day 4 「伯恩 → 黃金列車 → 蒙投」 has activities[0]="伯恩舊城區"
        // (start) but title lastChunk is "蒙投" (end). Title wins.
        //
        // Fallback to activities.last() if title parsing yields empty;
        // gives a real city for days where title is just a theme like
        // "自由日". Final fallback to activities[0].
        const acts = Array.isArray(d.activities) ? d.activities : [];
        const lastActLoc = acts.length > 0 && acts[acts.length - 1]?.location
          ? _extractDestinationPlace(String(acts[acts.length - 1].location)) : "";
        const firstActLoc = acts.length > 0 && acts[0]?.location
          ? _extractDestinationPlace(String(acts[0].location)) : "";
        const activityLast = _isJustCountry(lastActLoc) ? "" : lastActLoc;
        const activityFirst = _isJustCountry(firstActLoc) ? "" : firstActLoc;
        const fromTitle = _extractDestinationPlace(d.title || "");
        const cleaned = explicit || fromTitle || activityLast || activityFirst;
        if (!cleaned) return { day: d, q: "" };

        // Translate country to English for Google's geocoder (which handles
        // both, but English is more reliable). Reuse client locationMapping.
        const _countryEn: Record<string, string> = {
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
          // Middle East + Africa — added for Dubai/Cairo, Egypt, Israel etc.
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
        // ISO 3166-1 alpha-2 lower-case country codes for result-validation.
        // Used to reject geocoder results in the wrong REGION (Round 80.21
        // v7 — strict country match was too restrictive; rejected Munich
        // for Switzerland tours since Munich is in Germany. Now we
        // validate by REGION group so Schengen Europe results are mutually
        // acceptable, East Asia mutually, etc.).
        const _countryIso: Record<string, string> = {
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
        const countryEn = _countryEn[country] || country;
        const expectedIso = _countryIso[country] || null;
        // Round 80.21 v7 — soft region validation (vs strict ISO match)
        const expectedRegion = expectedIso ? _region[expectedIso] : null;
        // Round 80.21 v4 — home-return detection.
        // Bug case: Day 9 of tour 990014 was "巴黎 → 台北:回程啟航".
        // lastChunk = "台北", but appending ", France" then querying
        // Google found a Chinese restaurant named "台北" in Paris
        // (lat 48.85). The first candidate succeeded with WRONG country.
        //
        // Fix: when lastChunk matches the tour's departureCity (or first
        // 2 chars of it — handles "台北 TPE" departure formats),
        // SKIP the destinationCountry qualifier entirely. Google's
        // raw "台北" resolves to Taipei correctly.
        const departureCity = ((tour as any).departureCity || "").trim();
        const isHomeReturn = !!departureCity && (
          cleaned === departureCity ||
          cleaned === departureCity.slice(0, 2) ||
          cleaned.startsWith(departureCity.slice(0, 2)) && cleaned.length <= departureCity.length + 2
        );
        // Round 80.21 v3 — Multi-tier candidate strategy.
        //
        // Bugs in v2:
        //   - Day 8 "巴黎自由日" → "巴黎自由日, France" fails → fallback to
        //     bare "巴黎自由日" → Google returns a Brunei result, coord set,
        //     done with WRONG location.
        //   - Days 3,5,6,7 with titles like "巴黎左岸文藝風情" both
        //     candidates fail → 0 stops returned for that day.
        //
        // Fix: insert a CITY HINT candidate (first 2-3 Chinese chars) BETWEEN
        // the specific query and the raw fallback. So order becomes:
        //   1. "{cleaned}, {country}"   — most specific, wins if exact
        //   2. "{hint3}, {country}"     — 3-char city prefix (蘇黎世/蒙特勒)
        //   3. "{hint2}, {country}"     — 2-char city prefix (巴黎/東京)
        //   4. "{cleaned}"              — raw, last resort
        //
        // For Day 8 "巴黎自由日": (1) fails, (2) "巴黎自" fails, (3) "巴黎,
        // France" → Paris ✓, break before raw "巴黎自由日" → Brunei.
        //
        // English-bearing queries keep raw-first (Google handles English
        // place names well even without country qualifier).
        const hasEnglish = /[A-Za-z]{2,}/.test(cleaned);
        // Round 80.21 v6 — Chinese-only candidates ALL validated against
        // expectedIso (including raw fallback). Without this, when both
        // "瓦萊州, Switzerland" and "瓦萊, Switzerland" failed via
        // Nominatim, raw "瓦萊州" was tried with expectedIso=null and
        // accepted Vietnam's Lai Châu (lat 22, lng 103) — completely
        // wrong country. Now raw fallback also rejects wrong-country
        // results; the day silently drops off the map (legend below
        // still lists it) which is much better than a wrong pin.
        //
        // English-bearing and home-return queries keep expectedIso=null:
        //   - English: Google handles disambiguation well even without
        //     country qualifier (Munich → Germany without "Germany")
        //   - Home-return: lastChunk = departureCity, must match TW or
        //     home country, NOT destinationCountry (which is the trip's
        //     foreign destination).
        // Round 80.21 v7 — candidates carry expectedRegion (not iso)
        // for soft same-region validation (EU accepts EU, EA accepts EA, etc.)
        const candidates: { q: string; expectedRegion: string | null }[] = [];
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
        // Round 80.21 v10 — append alias candidates as final-tier fallback.
        // For known OTA non-standard names (蒙投/冰河3000/西庸古堡/...),
        // inject the standard English / canonical Chinese forms. New
        // tours SHOULD use standard names per skill rules, but this
        // rescues legacy tour data + edge cases.
        // See server/_helpers/placeNameAliases.ts.
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
      });

      // Geocode each unique query (server-side, with simple in-process cache).
      // Round 80.21 v2 — cache key prefixed with version "v2". When we
      // bumped the candidate ordering logic, old "巴黎"→Taipei negative
      // cache entries needed to be invalidated without restarting the
      // process. Using a versioned prefix means all old keys become
      // unreachable, effectively clearing the cache. Future logic
      // changes can bump to v3, v4, etc.
      const CACHE_VERSION = "v13"; // bump on candidate ordering changes
      const _cache = (globalThis as any).__packgoGeocodeCache ||
        ((globalThis as any).__packgoGeocodeCache = new Map<string, { lat: number; lng: number } | null>());
      const cacheKey = (cand: string) => `${CACHE_VERSION}:${country}:${cand}`;

      const { makeRequest } = await import("../_core/map");

      // Round 80.21 follow-up — Nominatim fallback.
      //
      // Discovered via fly logs: GOOGLE_API_KEY in prod returns
      // REQUEST_DENIED ("This API project was not found... You may need
      // to enable the API"). When that happens, ALL Google geocode
      // calls fail and getRouteMap returns 0 stops, triggering the
      // RouteFlowFallback chip view instead of the SVG map.
      //
      // OpenStreetMap's Nominatim is free, no API key, accurate at
      // city level (uses real OSM data). Rate limit is 1 req/sec but
      // we respect that with sequential per-query awaits + the
      // existing 24h in-process cache. We track the "google denied"
      // signal in a process-wide flag so we don't burn 13 failed calls
      // before falling back.
      const _googleStatus = (globalThis as any).__packgoGoogleStatus ||
        ((globalThis as any).__packgoGoogleStatus = { denied: false, deniedSince: 0 });
      // Round 80.21 v4 — Google retry after 60s cooldown. Without this,
      // a single REQUEST_DENIED locks us into Nominatim forever (until
      // process restart / deploy). Now we re-try Google every 60s — if
      // Jeff fixes the GCP key, the next batch picks it up automatically.
      const GOOGLE_RETRY_COOLDOWN_MS = 60_000;
      if (_googleStatus.denied && Date.now() - _googleStatus.deniedSince > GOOGLE_RETRY_COOLDOWN_MS) {
        _googleStatus.denied = false;
      }

      // Round 80.21 v7 — region-based validation (was strict ISO match).
      // Strict country match rejected legitimate neighbor-country stops
      // like Munich (de) on a Switzerland (ch) tour. Now we accept any
      // result whose country is in the same region group (EU, EA, SE,
      // ME, NA, LA, OC, CA, AF, SA). Wrong-region results still get
      // rejected — Lai Châu (vn, region SE) is correctly rejected for a
      // Switzerland (ch, region EU) destination.
      const tryGoogle = async (
        cand: string,
        expRegion: string | null
      ): Promise<{ lat: number; lng: number } | null> => {
        try {
          const resp = await makeRequest<any>("/maps/api/geocode/json", { address: cand });
          if (resp?.status === "REQUEST_DENIED") {
            if (!_googleStatus.denied) {
              console.warn(`[getRouteMap] Google REQUEST_DENIED — switching to Nominatim fallback for the rest of this request batch. Reason: ${resp.error_message || "no message"}`);
              _googleStatus.denied = true;
              _googleStatus.deniedSince = Date.now();
            }
            return null;
          }
          if (resp?.status && resp.status !== "OK" && resp.status !== "ZERO_RESULTS") {
            console.warn(`[getRouteMap] geocode "${cand}" returned status=${resp.status}: ${resp.error_message || ""}`);
          }
          const result = resp?.results?.[0];
          const loc = result?.geometry?.location;
          if (!loc?.lat || !loc?.lng) return null;
          // Round 80.21 v9 — reject country-level fallback results.
          // When Google can't find a specific city (e.g. "慕尼黑,
          // Switzerland" — Munich isn't in CH), it returns the country
          // CENTER. types = ["country", "political"]. Multiple days
          // then resolve to the same uninformative coord (46.82, 8.23
          // = geometric center of Switzerland).
          const resTypes: string[] = Array.isArray(result?.types) ? result.types : [];
          const isCountryFallback = resTypes.includes("country") &&
            !resTypes.some((t) => ["locality", "sublocality", "neighborhood", "administrative_area_level_2", "administrative_area_level_3", "tourist_attraction", "point_of_interest", "establishment"].includes(t));
          if (isCountryFallback) {
            console.log(`[getRouteMap] Google "${cand}" returned country-level result (types=${resTypes.join(",")}) — rejecting, will try next candidate`);
            return null;
          }
          // Region validation (v7)
          if (expRegion) {
            const resCountry = result?.address_components?.find(
              (c: any) => c?.types?.includes("country")
            )?.short_name?.toLowerCase();
            const resRegion = resCountry ? _region[resCountry] : null;
            if (resRegion && resRegion !== expRegion) {
              console.log(`[getRouteMap] Google "${cand}" region mismatch: expected ${expRegion}, got ${resRegion} (${resCountry}) — rejecting`);
              return null;
            }
          }
          return { lat: loc.lat, lng: loc.lng };
        } catch (err) {
          console.warn(`[getRouteMap] Google geocode failed for "${cand}":`, (err as Error).message);
          return null;
        }
      };

      const tryNominatim = async (
        cand: string,
        expRegion: string | null
      ): Promise<{ lat: number; lng: number } | null> => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&accept-language=en,zh-TW&q=${encodeURIComponent(cand)}`;
          const resp = await fetch(url, {
            headers: {
              "User-Agent": "PACK&GO Travel (Newark CA) +https://packgoplay.com",
            },
            signal: AbortSignal.timeout(8000),
          });
          if (!resp.ok) {
            console.warn(`[getRouteMap] Nominatim "${cand}" returned ${resp.status}`);
            return null;
          }
          const data = (await resp.json()) as any[];
          const first = data?.[0];
          if (!first?.lat || !first?.lon) return null;
          // Region validation (v7)
          if (expRegion) {
            const resCountry = (first?.address?.country_code || "").toLowerCase();
            const resRegion = resCountry ? _region[resCountry] : null;
            if (resRegion && resRegion !== expRegion) {
              console.log(`[getRouteMap] Nominatim "${cand}" region mismatch: expected ${expRegion}, got ${resRegion} (${resCountry}) — rejecting`);
              return null;
            }
          }
          return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
        } catch (err) {
          console.warn(`[getRouteMap] Nominatim failed for "${cand}":`, (err as Error).message);
          return null;
        }
      };

      // Country English name + ISO region — same logic as inside
      // queries.map; pulled up here so the LLM fallback (after the
      // candidate loop) can use them.
      const _outerCountryEn = (() => {
        const map: Record<string, string> = {
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
        return map[country] || country;
      })();

      const stops: Array<{ day: number; name: string; lat: number; lng: number }> = [];
      for (let i = 0; i < queries.length; i++) {
        const { day, q, candidates, expectedRegion: outerExpRegion } = queries[i] as any;
        if (!q) continue;
        let coord: { lat: number; lng: number } | null = null;
        for (const c of (candidates as { q: string; expectedRegion: string | null }[])) {
          const cand = c.q;
          const expRegion = c.expectedRegion;
          // Cache hit (positive) — use it
          const cached = _cache.get(cacheKey(cand));
          if (cached) { coord = cached; break; }
          // Cache hit (negative) — skip, try next candidate
          if (_cache.has(cacheKey(cand))) continue;

          // Try Google first (when not previously denied)
          if (!_googleStatus.denied) {
            const g = await tryGoogle(cand, expRegion);
            if (g) {
              coord = g;
              _cache.set(cacheKey(cand), coord);
              break;
            }
            if (!_googleStatus.denied) {
              _cache.set(cacheKey(cand), null);
              continue;
            }
            // fall through to Nominatim
          }

          // Nominatim fallback (free, no key)
          const n = await tryNominatim(cand, expRegion);
          if (n) {
            coord = n;
            _cache.set(cacheKey(cand), coord);
            break;
          }
          _cache.set(cacheKey(cand), null);
          // Nominatim has a 1 req/sec etiquette rule — sleep 1s between
          // candidate attempts that hit the actual API. Cache hits don't
          // sleep (most production calls will be 100% cache after warm-up).
          await new Promise((r) => setTimeout(r, 1100));
        }
        // Round 80.21 v11 — LLM fallback when all candidates failed.
        // After both static aliases and direct geocoding miss, ask
        // Claude Haiku to normalize the place name. Result cached in
        // Redis (30-day TTL) so subsequent requests hit cache.
        if (!coord && q) {
          const llmAlias = await normalizePlaceName(q, country);
          if (llmAlias && (llmAlias.en || llmAlias.zh)) {
            const llmCandidates: { q: string; expectedRegion: string | null }[] = [];
            if (llmAlias.en) llmCandidates.push({ q: llmAlias.en, expectedRegion: outerExpRegion });
            if (llmAlias.zh && _outerCountryEn) {
              llmCandidates.push({ q: `${llmAlias.zh}, ${_outerCountryEn}`, expectedRegion: outerExpRegion });
            }
            for (const c of llmCandidates) {
              const cand = c.q;
              const cached = _cache.get(cacheKey(cand));
              if (cached) { coord = cached; break; }
              if (_cache.has(cacheKey(cand))) continue;
              if (!_googleStatus.denied) {
                const g = await tryGoogle(cand, c.expectedRegion);
                if (g) {
                  coord = g;
                  _cache.set(cacheKey(cand), coord);
                  console.log(`[getRouteMap] LLM rescue: "${q}" → "${cand}" (${coord.lat.toFixed(2)},${coord.lng.toFixed(2)})`);
                  break;
                }
                _cache.set(cacheKey(cand), null);
                continue;
              }
              const n = await tryNominatim(cand, c.expectedRegion);
              if (n) {
                coord = n;
                _cache.set(cacheKey(cand), coord);
                console.log(`[getRouteMap] LLM rescue (Nominatim): "${q}" → "${cand}" (${coord.lat.toFixed(2)},${coord.lng.toFixed(2)})`);
                break;
              }
              _cache.set(cacheKey(cand), null);
              await new Promise((r) => setTimeout(r, 1100));
            }
          }
        }
        if (coord) {
          stops.push({
            day: i + 1,
            name: (day.title || day.location || day.city || q).replace(/^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i, ""),
            lat: coord.lat,
            lng: coord.lng,
          });
        }
      }

      // v78o: Country-level fallback when geocoding can't resolve specific cities.
      // Uses Static Maps (different API surface than Geocoding) — works as long
      // as Static Maps is enabled even if Geocoding isn't.
      // v80.23: when geocoding fails, surface the itinerary place names as
      // "raw stops" so the legend isn't empty even without lat/lng.
      if (stops.length === 0) {
        const countryEnFallback: Record<string, string> = {
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
        // Even without geocoding, show the itinerary place names in the legend
        // so users see "Day 1 · 杜拜" instead of "0 個地點".
        const rawStops = queries
          .filter((q) => q.q)
          .slice(0, 26)
          .map((q, i) => ({
            day: i + 1,
            name: (q.day.title || q.day.location || q.day.city || q.q).replace(
              /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
              ""
            ),
            lat: 0,
            lng: 0,
          }));

        const countryNameForMap = countryEnFallback[country] || country;
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

      // Round 80.21 v5 — server-side cluster filter + branded static map.
      //
      // Why: Maplibre with vector tiles was too slow loading from Asia
      // (Jeff: 「載入時間太慢了」). Reverting to Google Static Maps API
      // for instant single-image render, but with two upgrades:
      //   1. CLUSTER FILTER — same haversine-3000km logic from the
      //      previous client-side attempt, now done server-side so
      //      the static map URL only contains primary-cluster stops.
      //   2. BRANDED STYLING — `style=` parameters strip Google's
      //      colorful default theme and produce a clean B&W minimal
      //      map matching PACK&GO's brand (similar to Carto Positron).
      //
      // Output: { staticMapUrl, stops (primary), outliers, ... }

      // Cluster filter — separate primary stops from outliers
      const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
        const R = 6371;
        const toRad = (d: number) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      let primaryStops = stops;
      let outlierStops: typeof stops = [];
      if (stops.length > 4) {
        const lats = [...stops.map(s => s.lat)].sort((a, b) => a - b);
        const lngs = [...stops.map(s => s.lng)].sort((a, b) => a - b);
        const medLat = lats[Math.floor(lats.length / 2)];
        const medLng = lngs[Math.floor(lngs.length / 2)];
        const RADIUS_KM = 3000;
        const inCluster = stops.filter(s => haversineKm(s.lat, s.lng, medLat, medLng) <= RADIUS_KM);
        const outside = stops.filter(s => haversineKm(s.lat, s.lng, medLat, medLng) > RADIUS_KM);
        // Only filter when it actually helps (cluster has >= half of stops)
        if (inCluster.length >= Math.max(3, Math.floor(stops.length * 0.5))) {
          primaryStops = inCluster;
          outlierStops = outside;
        }
      }

      const apiKey = process.env.GOOGLE_API_KEY || "";
      const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
      const params = new URLSearchParams();
      params.set("size", "640x270"); // 12:5 aspect; 640 is Static Maps free limit
      params.set("scale", "2"); // retina → effective 1280x540
      params.set("maptype", "roadmap");
      // Round 80.21 v9 — Jeff updated direction (5/6 00:30): map base
      // should be plain B&W gray (「黑白灰為配色」). Cleaner, simpler,
      // matches PACK&GO baseline. Gold reserved as ACCENT only on the
      // SVG decorations (title bar, compass rose) — not on the map
      // itself. The map looks like a clean architectural diagram, not
      // a decorated treasure map.
      const brandStyles = [
        // Water — soft pale gray (sea)
        "feature:water|element:geometry|color:0xeef0f3",
        "feature:water|element:labels|visibility:off",
        // Land — slightly darker gray than water for differentiation
        "feature:landscape|element:geometry|color:0xf7f7f6",
        "feature:landscape.natural|color:0xf2f2f0",
        "feature:landscape.natural.terrain|color:0xebebe8",
        // Roads — hidden for clean canvas
        "feature:road|element:geometry|visibility:off",
        "feature:road|element:labels|visibility:off",
        // POI — hidden
        "feature:poi|visibility:off",
        "feature:transit|visibility:off",
        // Country borders — soft black for clean B&W look
        "feature:administrative.country|element:geometry.stroke|color:0x111111|weight:1.0",
        // Province/state borders — subtle gray
        "feature:administrative.province|element:geometry.stroke|color:0x9ca3af|weight:0.4",
        // Country labels — soft black with white halo for legibility
        "feature:administrative.country|element:labels.text.fill|color:0x1f2937",
        "feature:administrative.country|element:labels.text.stroke|color:0xffffff|weight:3",
        // Locality (city) labels — neutral gray
        "feature:administrative.locality|element:labels.text.fill|color:0x4b5563",
        "feature:administrative.locality|element:labels.text.stroke|color:0xffffff|weight:2.5",
        "feature:administrative.province|element:labels|visibility:off",
      ];
      for (const s of brandStyles) params.append("style", s);
      // Markers: solid black pin with white day number (1-9 numbers,
      // 10+ letters since Google Static labels are single-char only)
      primaryStops.slice(0, 26).forEach((s, i) => {
        const label = i < 9 ? String(i + 1) : String.fromCharCode(65 + i - 9);
        // Soft black for B&W aesthetic
        params.append("markers", `color:0x111111|label:${label}|${s.lat},${s.lng}`);
      });
      // Path polyline — soft black solid line, weight 3
      if (primaryStops.length >= 2) {
        const path = primaryStops.map((s) => `${s.lat},${s.lng}`).join("|");
        params.append("path", `color:0x111111dd|weight:3|${path}`);
      }
      params.set("key", apiKey);
      const staticMapUrl = `${baseUrl}?${params.toString()}`;

      // Build "Open in Google Maps" multi-stop URL (uses ALL stops incl outliers)
      const directionsUrl =
        stops.length >= 2
          ? `https://www.google.com/maps/dir/?api=1&origin=${stops[0].lat},${stops[0].lng}&destination=${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}` +
            (stops.length > 2
              ? `&waypoints=${stops.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join("|")}`
              : "")
          : `https://www.google.com/maps/search/?api=1&query=${stops[0].lat},${stops[0].lng}`;

      return {
        staticMapUrl,
        stops: primaryStops,
        outliers: outlierStops,
        directionsUrl,
        aiMapUrl,
      };
    }),
});
