/**
 * TourRouteMapCanvas — v357 (Czech / Austria reference: grey bg, white
 * countries, black markers, bilingual stacked city labels, gold ★).
 *
 * Visual design (Jeff's reference screenshot — Czech + Austria tour):
 *   • Background      : light grey       #e0e0e0  (off-map / non-land)
 *   • Country shapes  : pure white       #ffffff  + 0.5px #b8b8b8 stroke
 *                       (active = neighbour, no distinction)
 *   • Country labels  : NONE — cities tell the story
 *   • Day markers     : solid black      #1a1a1a, day number white inside
 *   • Marker labels   : zh-TW UI = Chinese serif on top + English sans below
 *                       en UI    = English serif only
 *   • Entry marker    : standalone black ✈ to the right of the dot
 *   • Highlight marker: standalone gold ★ above the dot (#e0b040)
 *   • Route line      : grey curved arrows per segment, arrowheads on each
 *
 * Removed over v340–v357:
 *   • Lakes / rivers / water labels (v351)
 *   • Paper grain / sepia hillshade (v351)
 *   • Corner flourishes / compass / ship (early)
 *   • World inset (v354)
 *   • Outlier banner (v356)
 *   • Country name geo-typography (v357 — reference has none)
 *   • Corner transport legend (v357 — reference has none)
 *
 * Tech: react-simple-maps + world-atlas 50m TopoJSON, 100% SVG, no Web
 * Worker, no tile fetches, no API key.
 */

import { useEffect, useMemo, useState } from "react";
import { Plane } from "lucide-react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker as GeoMarker,
} from "react-simple-maps";
import { geoContains } from "d3-geo";
import { feature as topoFeature } from "topojson-client";
// Round 80.21 v21: switched 110m → 50m. The 110m simplification was so
// aggressive that countries looked like crude polygons (Jeff feedback:
// "幾何圖形 給出來的感覺就很方方角角"). 50m gives smooth coastlines
// and rounded country borders at +650KB bundle cost — well worth it
// for a map that's the visual centrepiece of the tour detail page.
import countries110m from "world-atlas/countries-50m.json";
import { translateDestination } from "@/utils/locationMapping";
import { useLocale } from "@/contexts/LocaleContext";
import { findHillshade } from "./baseMaps";

/**
 * Convert TopoJSON → GeoJSON FeatureCollection once at module scope.
 * Used by activeCountries point-in-polygon check (geoContains) to add
 * countries the route actually traverses. Cost: ~108KB JSON parsed
 * during initial chunk load.
 */
const COUNTRIES_FC: any = topoFeature(
  countries110m as any,
  (countries110m as any).objects.countries
);

/**
 * Map common Chinese / English / alias country names → world-atlas
 * canonical name. Lets us highlight the destination regardless of how
 * the admin entered it.
 */
const COUNTRY_NAME_MAP: Record<string, string> = {
  // Europe
  "瑞士": "Switzerland",
  "Switzerland": "Switzerland",
  "義大利": "Italy",
  "意大利": "Italy",
  "Italy": "Italy",
  "法國": "France",
  "France": "France",
  "德國": "Germany",
  "Germany": "Germany",
  "奧地利": "Austria",
  "Austria": "Austria",
  "英國": "United Kingdom",
  "UK": "United Kingdom",
  "United Kingdom": "United Kingdom",
  "西班牙": "Spain",
  "Spain": "Spain",
  "葡萄牙": "Portugal",
  "Portugal": "Portugal",
  "希臘": "Greece",
  "Greece": "Greece",
  "土耳其": "Turkey",
  "Turkey": "Turkey",
  "捷克": "Czechia",
  "Czechia": "Czechia",
  "Czech Republic": "Czechia",
  "荷蘭": "Netherlands",
  "Netherlands": "Netherlands",
  "比利時": "Belgium",
  "Belgium": "Belgium",
  "丹麥": "Denmark",
  "Denmark": "Denmark",
  "瑞典": "Sweden",
  "Sweden": "Sweden",
  "挪威": "Norway",
  "Norway": "Norway",
  "芬蘭": "Finland",
  "Finland": "Finland",
  "冰島": "Iceland",
  "Iceland": "Iceland",
  "波蘭": "Poland",
  "Poland": "Poland",
  "匈牙利": "Hungary",
  "Hungary": "Hungary",
  "克羅埃西亞": "Croatia",
  "Croatia": "Croatia",
  // Asia
  "日本": "Japan",
  "Japan": "Japan",
  "韓國": "South Korea",
  "South Korea": "South Korea",
  "Korea": "South Korea",
  "中國": "China",
  "China": "China",
  "台灣": "Taiwan",
  "Taiwan": "Taiwan",
  "新加坡": "Singapore",
  "Singapore": "Singapore",
  "馬來西亞": "Malaysia",
  "Malaysia": "Malaysia",
  "泰國": "Thailand",
  "Thailand": "Thailand",
  "越南": "Vietnam",
  "Vietnam": "Vietnam",
  "印尼": "Indonesia",
  "Indonesia": "Indonesia",
  "印度": "India",
  "India": "India",
  "菲律賓": "Philippines",
  "Philippines": "Philippines",
  // Americas
  "美國": "United States of America",
  "USA": "United States of America",
  "United States": "United States of America",
  "United States of America": "United States of America",
  "夏威夷": "United States of America",
  "Hawaii": "United States of America",
  "加拿大": "Canada",
  "Canada": "Canada",
  "墨西哥": "Mexico",
  "Mexico": "Mexico",
  "巴西": "Brazil",
  "Brazil": "Brazil",
  "阿根廷": "Argentina",
  "Argentina": "Argentina",
  "秘魯": "Peru",
  "Peru": "Peru",
  // Oceania
  "澳洲": "Australia",
  "Australia": "Australia",
  "紐西蘭": "New Zealand",
  "New Zealand": "New Zealand",
};

/**
 * Display label for the country (Chinese name shown inside the map).
 * Falls back to canonical English if we don't have a Chinese mapping.
 */
const COUNTRY_DISPLAY_LABEL: Record<string, string> = {
  Switzerland: "瑞士",
  Italy: "義大利",
  France: "法國",
  Germany: "德國",
  Austria: "奧地利",
  "United Kingdom": "英國",
  Spain: "西班牙",
  Portugal: "葡萄牙",
  Greece: "希臘",
  Turkey: "土耳其",
  Czechia: "捷克",
  // v340 — Balkans / Eastern Europe additions surfaced by Balkans tour 990011
  "North Macedonia": "北馬其頓",
  "Macedonia": "北馬其頓",
  "Kosovo": "科索沃",
  "Moldova": "摩爾多瓦",
  Netherlands: "荷蘭",
  Belgium: "比利時",
  Denmark: "丹麥",
  Sweden: "瑞典",
  Norway: "挪威",
  Finland: "芬蘭",
  Iceland: "冰島",
  Poland: "波蘭",
  Hungary: "匈牙利",
  Croatia: "克羅埃西亞",
  Slovenia: "斯洛維尼亞",
  Slovakia: "斯洛伐克",
  Romania: "羅馬尼亞",
  Bulgaria: "保加利亞",
  Serbia: "塞爾維亞",
  "Bosnia and Herz.": "波士尼亞",
  Montenegro: "蒙特內哥羅",
  Albania: "阿爾巴尼亞",
  Estonia: "愛沙尼亞",
  Latvia: "拉脫維亞",
  Lithuania: "立陶宛",
  Ireland: "愛爾蘭",
  Luxembourg: "盧森堡",
  Liechtenstein: "列支敦斯登",
  Monaco: "摩納哥",
  Andorra: "安道爾",
  Russia: "俄羅斯",
  Ukraine: "烏克蘭",
  Belarus: "白俄羅斯",
  Japan: "日本",
  "South Korea": "韓國",
  "North Korea": "北韓",
  // world-atlas occasionally uses different canonical names; map both.
  "Dem. Rep. Korea": "北韓",
  "Korea": "韓國",
  China: "中國",
  Taiwan: "台灣",
  Singapore: "新加坡",
  Malaysia: "馬來西亞",
  Thailand: "泰國",
  Vietnam: "越南",
  Indonesia: "印尼",
  India: "印度",
  Philippines: "菲律賓",
  Cambodia: "柬埔寨",
  Laos: "寮國",
  Myanmar: "緬甸",
  Mongolia: "蒙古",
  Nepal: "尼泊爾",
  Bhutan: "不丹",
  "Sri Lanka": "斯里蘭卡",
  Pakistan: "巴基斯坦",
  Bangladesh: "孟加拉",
  Iran: "伊朗",
  Iraq: "伊拉克",
  Israel: "以色列",
  Jordan: "約旦",
  Egypt: "埃及",
  Morocco: "摩洛哥",
  Tunisia: "突尼西亞",
  "South Africa": "南非",
  Kenya: "肯亞",
  Tanzania: "坦尚尼亞",
  "United Arab Emirates": "阿拉伯聯合大公國",
  "Saudi Arabia": "沙烏地阿拉伯",
  "United States of America": "美國",
  // v341 — common world-atlas variants for the US
  "USA": "美國",
  "U.S.A.": "美國",
  "United States": "美國",
  Canada: "加拿大",
  Mexico: "墨西哥",
  Brazil: "巴西",
  Argentina: "阿根廷",
  Peru: "秘魯",
  Chile: "智利",
  Colombia: "哥倫比亞",
  Ecuador: "厄瓜多",
  Bolivia: "玻利維亞",
  Cuba: "古巴",
  Australia: "澳洲",
  "New Zealand": "紐西蘭",
  Fiji: "斐濟",
};

function resolveActiveCountries(input: string | undefined): Set<string> {
  if (!input) return new Set();
  const tokens = input
    .split(/[、,，/／]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const result = new Set<string>();
  for (const t of tokens) {
    const canonical = COUNTRY_NAME_MAP[t];
    if (canonical) result.add(canonical);
  }
  return result;
}

/**
 * Pull the destination city out of an itinerary day name.
 *   "台北 → 慕尼黑：飛越歐洲"            → "慕尼黑"
 *   "蘇黎世 → 伊瑟爾特瓦爾德 → 菲斯特 → 伯恩" → "伯恩"
 *   "盧森 → 林島 → 慕尼黑"               → "慕尼黑"
 */
function extractDestinationCity(name: string): string {
  if (!name) return "";
  const cleaned = name.replace(
    /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
    ""
  );
  const beforeColon = cleaned.split(/[:：]/)[0].trim();
  const parts = beforeColon.split(/\s*(?:→|⇒|↔|⇄|->|=>|>|、|,)\s*/);
  const last = parts[parts.length - 1]?.trim() || beforeColon;
  return last;
}

interface Stop {
  day: number;
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  stops: Stop[];
  themeColor: { primary: string; secondary?: string };
  outliers?: Stop[];
  staticMapUrl?: string | null;
  departureCity?: string;
  tourTitle?: string;
  destinationCountry?: string;
  /** v315: two-way link with day chips below the map. */
  highlightedDay?: number | null;
  onMarkerHover?: (day: number | null) => void;
}

/* ─────────────────── projection helpers ─────────────────── */

// Round 80.21 v22: bumped from 1200x500 (aspect 12:5 / 2.4:1, very wide
// and short — Jeff said "地圖不夠大") to 1200x800 (aspect 3:2 / 1.5:1,
// 60% taller). Gives countries breathing room and lets the route
// content feel like a proper map, not a strip banner.
const MAP_WIDTH = 1200;
const MAP_HEIGHT = 800;

interface MapDimensions {
  width: number;
  height: number;
  center: [number, number];
  scale: number;
}

/**
 * Compute the bounding box of a GeoJSON feature (Polygon /
 * MultiPolygon) by walking its rings and finding lng/lat extrema.
 * Returns null for unsupported geometries.
 */
function featureBbox(
  feature: any
): { minLng: number; maxLng: number; minLat: number; maxLat: number } | null {
  const g = feature?.geometry;
  if (!g) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const walkRing = (ring: number[][]) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  if (g.type === "Polygon") {
    for (const ring of g.coordinates) walkRing(ring);
  } else if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates) for (const ring of poly) walkRing(ring);
  } else {
    return null;
  }
  if (!isFinite(minLng)) return null;
  return { minLng, maxLng, minLat, maxLat };
}

function computeProjectionConfig(
  stops: Stop[],
  activeCountryNames: Set<string>
) {
  if (stops.length === 0) {
    return { center: [10, 47] as [number, number], scale: 200 };
  }
  let minLng = Math.min(...stops.map((s) => s.lng));
  let maxLng = Math.max(...stops.map((s) => s.lng));
  let minLat = Math.min(...stops.map((s) => s.lat));
  let maxLat = Math.max(...stops.map((s) => s.lat));
  // Round 80.21 v24: REVERTED the country-centroid expansion. Jeff:
  // "整張地圖不需要這麼大 需要縮放到地圖去的地方" — fit tight to
  // the actual route. Country labels (e.g. 德國) are placed via the
  // clamp-to-viewport logic below so they still show inside their
  // visible country territory even when the centroid is offscreen.
  // (Suppress unused warning — kept import for future polygon work.)
  void activeCountryNames;
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  // Round 80.21 v31: asymmetric padding. Latitude stays tight (1.08×)
  // because vertical labels rarely extend further than the marker
  // dot. Longitude needs MORE breathing room (1.20×) — entry/exit
  // markers carry a wide "起點/終點" gold chip that can extend ~110px
  // past the marker, easily falling off the right edge on tours
  // where the entry city is near maxLng (e.g. Munich for a
  // Switzerland tour).
  const spanLng = Math.max(0.5, maxLng - minLng) * 1.2;
  // v344 polish: bump vertical padding 1.08 → 1.18. The top-edge entry
  // marker (e.g. Munich for Switzerland tours) was sitting right at the
  // viewport edge, with its gold halo + ✈ glyph clipped. Extra 10%
  // latitude headroom gives breathing space without zooming out
  // noticeably (it just shifts the cluster a hair lower in the frame).
  const spanLat = Math.max(0.5, maxLat - minLat) * 1.18;
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  // Round 80.21 v28: FIXED Mercator scale math.
  //   Mercator scale = pixels per radian. For longitude, 1° = scale ·
  //   π/180 px (NO cos(lat) — Mercator preserves longitude pixel
  //   width across all latitudes; that's why Greenland looks huge).
  //   The earlier cos(lat) factor was a leftover from real-distance
  //   thinking, which made the lng scale ~1.47× too large at 47°N
  //   and let the projection zoom out vertically to compensate —
  //   visible result: half the map was empty German plains.
  const scaleByLng = (MAP_WIDTH * 57.3) / spanLng;
  // Latitude DOES use sec(lat) stretching, hence cos(lat) factor.
  const scaleByLat = (MAP_HEIGHT * cosLat * 57.3) / spanLat;
  // Round 80.21 v29: bumped the upper cap 4000 → 60000. The old 4000
  // was a leftover safety from a different scale convention; with
  // d3-geoMercator's "pixels-per-radian" scale, ANY tour zoomed to
  // a city-region (e.g. Switzerland-only) needs scale 10–20K. The
  // 4000 cap was silently zooming the map out 3× too far, which
  // is what caused the "整張地圖塞進半個歐洲" complaint.
  const scale = Math.min(scaleByLng, scaleByLat, 60000);
  return {
    center: [centerLng, centerLat] as [number, number],
    scale: Math.max(120, scale),
  };
}

function projectPoint(
  lng: number,
  lat: number,
  dims: MapDimensions
): [number, number] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const mercY = (l: number) => Math.log(Math.tan(Math.PI / 4 + toRad(l) / 2));
  const x =
    dims.width / 2 + dims.scale * (toRad(lng) - toRad(dims.center[0]));
  const y =
    dims.height / 2 - dims.scale * (mercY(lat) - mercY(dims.center[1]));
  return [x, y];
}

/**
 * Build a smooth quadratic-bezier path connecting consecutive stops.
 * Each segment bows slightly (perpendicular offset = 12% of length) so
 * the route reads as an arc rather than a straight line — like the
 * India reference where every leg is a curved arrow.
 */
function buildCurvedPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  const segments: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    // Alternate the curve direction so consecutive segments don't all
    // bow the same way (visually like the looping route in the
    // India reference).
    const sign = i % 2 === 0 ? 1 : -1;
    const offsetMag = Math.min(len * 0.12, 50);
    const cx = midX + ((-dy / len) * offsetMag) * sign;
    const cy = midY + ((dx / len) * offsetMag) * sign;
    segments.push(
      i === 0
        ? `M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`
        : `M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`
    );
  }
  return segments.join(" ");
}

export default function TourRouteMapCanvas({
  stops,
  outliers = [],
  destinationCountry,
  highlightedDay = null,
  onMarkerHover,
  // departureCity, tourTitle, themeColor, staticMapUrl intentionally
  // unused — the new design moves these into the page header above
  // the map and the day-chip list below it. Decorative title bars
  // inside the map cluttered Jeff's clean illustrated look.
}: Props) {
  const { language } = useLocale();
  const [hovered, setHovered] = useState<number | null>(null);
  // v317: transport icon hover for distance + duration tooltip
  const [transportHover, setTransportHover] = useState<number | null>(null);

  /**
   * v333 — pre-rendered sepia hillshade PNG for this region (if available).
   * Generated once per region by `scripts/fetch-hillshade.mjs`. The PNG
   * sits as a `<image>` layer ABOVE country fills but BELOW lakes/rivers
   * so the painted Alpine terrain shows through the cream parchment of
   * the surrounding lowlands.
   */
  const hillshade = useMemo(
    () => findHillshade({ destinationCountry, stops }),
    [destinationCountry, stops]
  );

  /**
   * Mobile font-scale: SVG content scales with viewBox so on a 390px-
   * wide phone everything renders 32% of viewBox px size — way too
   * small for serif country labels and city names.
   *
   * v341: piecewise scale that grows as the viewport shrinks. The
   * old binary "<768 → 1.7×" left fonts at ~6px on a 360px phone
   * (12 base × 1.7 scale × 0.30 viewport ratio). New curve maps:
   *   ≥768  → 1.0×  (desktop)
   *    600  → 1.6×
   *    480  → 2.2×
   *    360  → 2.8×  (~10px effective on a 360px phone)
   */
  const [fontScale, setFontScale] = useState(1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      const w = window.innerWidth;
      let s = 1;
      if (w < 768) {
        // Linear interpolation from 1.0 @ 768 to 2.8 @ 360.
        const clamped = Math.max(360, Math.min(768, w));
        s = 1 + ((768 - clamped) / (768 - 360)) * 1.8;
      }
      setFontScale(s);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Translate a city/place name to English when the UI language is en.
  // For zh-TW we keep the original Chinese name as-is.
  const tCity = (s: string) => translateDestination(s, language);

  /**
   * Active countries set — combines TWO signals so multi-country tours
   * highlight every country the route actually touches:
   *
   *   1. `destinationCountry` from the tour record (e.g. "瑞士") — the
   *      primary marketing destination.
   *   2. Geographic point-in-polygon check on every stop. If Day 1's
   *      "慕尼黑" sits inside Germany's polygon, Germany joins the
   *      highlighted set even if the admin only entered "瑞士" as the
   *      destination. Fixes Jeff's feedback: "明明也有到德國為什麼
   *      不寫上去".
   */
  const activeCountries = useMemo(() => {
    const set = resolveActiveCountries(destinationCountry);
    // Walk every stop and find which country polygon contains it.
    // We break on first match (countries don't overlap).
    for (const stop of stops) {
      if (!isFinite(stop.lng) || !isFinite(stop.lat)) continue;
      const point: [number, number] = [stop.lng, stop.lat];
      for (const f of COUNTRIES_FC.features as any[]) {
        try {
          if (geoContains(f as any, point)) {
            const cname = f.properties?.name;
            if (cname) set.add(cname);
            break;
          }
        } catch {
          /* malformed geometry — ignore */
        }
      }
    }
    return set;
  }, [destinationCountry, stops]);

  const projection = useMemo(
    () => computeProjectionConfig(stops, activeCountries),
    [stops, activeCountries]
  );

  const dims: MapDimensions = useMemo(
    () => ({
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      center: projection.center,
      scale: projection.scale,
    }),
    [projection]
  );

  // Pre-project all stops to SVG coords for the route polyline.
  const projectedStops = useMemo(
    () => stops.map((s) => ({ stop: s, xy: projectPoint(s.lng, s.lat, dims) })),
    [stops, dims]
  );

  // Deduplicate stops by (lat, lng) so a city visited on multiple days
  // only renders ONE marker — the route line still passes through it
  // multiple times, matching the India-reference behaviour where
  // Delhi/Jaipur appear once even though the route returns to them.
  // Each unique entry tracks ALL day numbers it represents (e.g.
  // Munich → [1, 8] for a tour that arrives and departs there).
  //
  // Round 80.21 v28: when 2+ markers fall within 24px on screen we
  // FAN them out radially around their centroid by ~16px each. The
  // dots are conceptually "city pins" — slight visual displacement
  // is acceptable and prevents the 蒙投/冰河3000/瓦萊州 cluster from
  // becoming a single red blob.
  const uniqueStops = useMemo(() => {
    type Entry = {
      stop: Stop;
      xy: [number, number];
      days: number[];
    };
    const map = new Map<string, Entry>();
    for (const p of projectedStops) {
      const key = `${p.stop.lng.toFixed(4)},${p.stop.lat.toFixed(4)}`;
      const existing = map.get(key);
      if (existing) {
        existing.days.push(p.stop.day);
      } else {
        map.set(key, { stop: p.stop, xy: p.xy, days: [p.stop.day] });
      }
    }
    const arr = Array.from(map.values());

    // v318: better fan-out for tight clusters (e.g. Hokkaido tour
    // where Day 1/5, 2, 3, 4 are all within 50px of each other in
    // southern Hokkaido). Old logic with fixed 18px push only
    // partially un-stacked them; bus icons and chevrons still
    // overlapped Day 3 and Day 4.
    //
    // New approach:
    //   1. Build cluster groups via union-find (any markers within
    //      CLUSTER_THRESHOLD of each other → same cluster)
    //   2. For clusters of size ≥ 2, lay out in a ring around the
    //      cluster centroid, with radius scaled to cluster size
    //      so labels and dots all have breathing room.
    const CLUSTER_THRESHOLD = 48;
    const parent: number[] = arr.map((_, i) => i);
    const find = (x: number): number =>
      parent[x] === x ? x : (parent[x] = find(parent[x]));
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const dist = Math.hypot(
          arr[i].xy[0] - arr[j].xy[0],
          arr[i].xy[1] - arr[j].xy[1]
        );
        if (dist < CLUSTER_THRESHOLD) union(i, j);
      }
    }
    // Group indices by root
    const groups = new Map<number, number[]>();
    for (let i = 0; i < arr.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(i);
    }
    // For each cluster of size ≥ 2, lay out in a ring around the
    // centroid. Sort cluster members by day so the ring is in
    // chronological order for clearer reading.
    for (const members of Array.from(groups.values())) {
      if (members.length < 2) continue;
      const sorted = [...members].sort(
        (a, b) =>
          Math.min(...arr[a].days) - Math.min(...arr[b].days)
      );
      const cx =
        sorted.reduce((s, idx) => s + arr[idx].xy[0], 0) / sorted.length;
      const cy =
        sorted.reduce((s, idx) => s + arr[idx].xy[1], 0) / sorted.length;
      // Ring radius scales: 2 markers → 28, 3 → 38, 4 → 46, 5 → 52
      const ringR = 18 + sorted.length * 8;
      sorted.forEach((idx, i) => {
        // Start the first marker at the top (-π/2) so day order
        // reads clockwise from 12 o'clock.
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / sorted.length;
        arr[idx] = {
          ...arr[idx],
          xy: [cx + Math.cos(angle) * ringR, cy + Math.sin(angle) * ringR],
        };
      });
    }
    return arr;
  }, [projectedStops]);

  // Build a stop→fanned-xy lookup so the route polyline and the
  // transport icons sit on the SAME positions as the marker dots
  // (after fan-out). Without this the route line would still connect
  // un-fanned centroids, leaving dots floating beside the path.
  const stopXyByKey = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const u of uniqueStops) {
      const k = `${u.stop.lng.toFixed(4)},${u.stop.lat.toFixed(4)}`;
      m.set(k, u.xy);
    }
    return m;
  }, [uniqueStops]);

  const fannedRouteXys = useMemo(
    () =>
      projectedStops.map((p) => {
        const k = `${p.stop.lng.toFixed(4)},${p.stop.lat.toFixed(4)}`;
        return stopXyByKey.get(k) ?? p.xy;
      }),
    [projectedStops, stopXyByKey]
  );

  /**
   * Transport segments — for each consecutive pair of stops, compute
   * the midpoint of their bezier curve and pick a transport icon based
   * on great-circle distance:
   *   <120 km  → bus / car (short hop, e.g. Bern → Montreux)
   *   120–600 km → train (regional, e.g. Munich → Zürich)
   *   ≥ 600 km → plane (international or transcontinental)
   *
   * Same bezier math as `buildCurvedPath` so the icon sits exactly on
   * the curve, not on the chord.
   */
  const transportSegments = useMemo(() => {
    const haversineKm = (
      a: [number, number],
      b: [number, number]
    ): number => {
      // a, b are [lng, lat] in degrees
      const R = 6371;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b[1] - a[1]);
      const dLng = toRad(b[0] - a[0]);
      const lat1 = toRad(a[1]);
      const lat2 = toRad(b[1]);
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
    };
    /**
     * v333 — scenic-train override table. Many Switzerland / Japan tours
     * include named scenic train rides that are MUCH slower than direct
     * SBB-style point-to-point services because they wind through
     * mountain passes for sightseeing. Detect these by name in the
     * stop title and override the duration with the published time.
     *
     * Match is case-insensitive and pattern-based; if either the
     * from-day's name OR the to-day's name contains the trigger
     * string, we treat that segment as the scenic train.
     */
    const SCENIC_TRAIN_OVERRIDES: Array<{
      patterns: string[];
      hours: { lo: number; hi: number };
      enLabel: string;
      zhLabel: string;
    }> = [
      // Glacier Express: Zermatt ↔ St. Moritz, ~8h scenic ride
      {
        patterns: ["冰河列車", "Glacier Express", "glacier express"],
        hours: { lo: 7, hi: 8 },
        enLabel: "Glacier Express",
        zhLabel: "冰河列車",
      },
      // GoldenPass Line: Lucerne / Interlaken / Montreux, ~3h panoramic
      {
        patterns: ["黃金列車", "黄金列车", "GoldenPass", "Golden Pass"],
        hours: { lo: 2.5, hi: 3 },
        enLabel: "GoldenPass Line",
        zhLabel: "黃金列車",
      },
      // Bernina Express: Chur ↔ Tirano, ~4h crossing the Alps
      {
        patterns: ["伯連納快線", "伯爾尼納", "Bernina Express", "bernina express"],
        hours: { lo: 4, hi: 4.5 },
        enLabel: "Bernina Express",
        zhLabel: "伯連納快線",
      },
      // Gotthard Panorama: Lucerne ↔ Lugano, ~5.5h boat + train combo
      {
        patterns: ["哥達快線", "Gotthard Panorama"],
        hours: { lo: 5, hi: 6 },
        enLabel: "Gotthard Panorama",
        zhLabel: "哥達快線",
      },
      // v337 — Japanese scenic / themed trains
      // Resort Shirakami: Akita ↔ Aomori coastal scenic, ~5h
      {
        patterns: ["Resort Shirakami", "リゾートしらかみ", "白神號"],
        hours: { lo: 4.5, hi: 5 },
        enLabel: "Resort Shirakami",
        zhLabel: "白神號",
      },
      // Tateyama Kurobe Alpine Route: 6h cross-Alps cable / bus / trolley
      {
        patterns: ["立山黑部", "立山黒部", "Tateyama Kurobe"],
        hours: { lo: 5, hi: 7 },
        enLabel: "Tateyama Kurobe Route",
        zhLabel: "立山黑部",
      },
      // SL Hitoyoshi (Kyushu steam): Kumamoto ↔ Hitoyoshi, ~2.5h
      {
        patterns: ["SL人吉", "SL Hitoyoshi"],
        hours: { lo: 2.5, hi: 3 },
        enLabel: "SL Hitoyoshi",
        zhLabel: "SL人吉",
      },
      // Yufuin no Mori: Hakata ↔ Yufuin, ~2h panoramic
      {
        patterns: ["由布院之森", "ゆふいんの森", "Yufuin no Mori"],
        hours: { lo: 2, hi: 2.5 },
        enLabel: "Yufuin no Mori",
        zhLabel: "由布院之森",
      },
      // v343 — South America
      // PeruRail Vistadome: Cusco / Ollantaytambo ↔ Machu Picchu, ~3.5h
      {
        patterns: ["PeruRail", "Vistadome", "印加列車", "馬丘比丘列車"],
        hours: { lo: 3, hi: 3.5 },
        enLabel: "PeruRail Vistadome",
        zhLabel: "印加列車",
      },
      // Hiram Bingham Belmond: luxury Cusco ↔ Machu Picchu, ~3.5h
      {
        patterns: ["Hiram Bingham", "希拉姆賓漢"],
        hours: { lo: 3, hi: 3.5 },
        enLabel: "Hiram Bingham",
        zhLabel: "希拉姆賓漢",
      },
      // v343 — Norway
      // Bergen Line / Bergensbanen: Oslo ↔ Bergen, ~7h Hardangervidda
      {
        patterns: ["Bergensbanen", "Bergen Line", "卑爾根鐵路", "卑爾根線"],
        hours: { lo: 6.5, hi: 7 },
        enLabel: "Bergen Line",
        zhLabel: "卑爾根鐵路",
      },
      // Flåm Railway / Flåmsbana: Myrdal ↔ Flåm, ~1h steepest
      {
        patterns: ["Flåmsbana", "Flam Railway", "Flåm", "弗洛姆鐵路"],
        hours: { lo: 0.75, hi: 1 },
        enLabel: "Flåm Railway",
        zhLabel: "弗洛姆鐵路",
      },
      // v343 — North America
      // California Zephyr: Chicago ↔ SF, partial scenic Denver↔SF ~16h
      {
        patterns: ["California Zephyr", "加州微風"],
        hours: { lo: 14, hi: 16 },
        enLabel: "California Zephyr",
        zhLabel: "加州微風",
      },
      // Coast Starlight: Seattle ↔ LA scenic Pacific coast
      {
        patterns: ["Coast Starlight", "海岸星光"],
        hours: { lo: 12, hi: 14 },
        enLabel: "Coast Starlight",
        zhLabel: "海岸星光",
      },
      // Rocky Mountaineer: Vancouver ↔ Banff/Jasper, 2-day with overnight
      {
        patterns: ["Rocky Mountaineer", "洛磯山登山者", "洛磯登山者"],
        hours: { lo: 8, hi: 10 },
        enLabel: "Rocky Mountaineer",
        zhLabel: "洛磯山登山者",
      },
      // v343 — Europe
      // TGV Méditerranée scenic: Paris ↔ Marseille, ~3h
      {
        patterns: ["TGV", "高速火車"],
        hours: { lo: 2.5, hi: 3 },
        enLabel: "TGV",
        zhLabel: "TGV 高速火車",
      },
      // Trans-Siberian: Moscow ↔ Vladivostok, multi-day
      {
        patterns: ["Trans-Siberian", "Trans Siberian", "西伯利亞鐵路"],
        hours: { lo: 144, hi: 168 }, // 6-7 days
        enLabel: "Trans-Siberian Railway",
        zhLabel: "西伯利亞鐵路",
      },
      // Venice Simplon-Orient-Express
      {
        patterns: ["Orient Express", "東方快車", "東方特快車"],
        hours: { lo: 24, hi: 36 },
        enLabel: "Orient Express",
        zhLabel: "東方快車",
      },
    ];

    const segments: Array<{
      mid: [number, number];
      icon: "plane" | "train" | "bus";
      angle: number;
      km: number;
      fromDay: number;
      toDay: number;
      /** v333: scenic-train override (matched name + published duration). */
      scenicOverride?: {
        hours: { lo: number; hi: number };
        enLabel: string;
        zhLabel: string;
      };
    }> = [];
    for (let i = 0; i < projectedStops.length - 1; i++) {
      const a = projectedStops[i];
      const b = projectedStops[i + 1];
      // Skip if same exact position (Day N → Day N+1 same city)
      if (
        Math.abs(a.stop.lng - b.stop.lng) < 0.001 &&
        Math.abs(a.stop.lat - b.stop.lat) < 0.001
      ) {
        continue;
      }
      const km = haversineKm(
        [a.stop.lng, a.stop.lat],
        [b.stop.lng, b.stop.lat]
      );
      // v333 — train threshold dropped from 120 km to 50 km. The old
      // threshold marked Zurich→Bern (95 km) and Bern→Montreux (75 km)
      // as "bus" when they're actually scenic train rides. In Europe /
      // Japan inter-city trips ≥50 km are almost always rail.
      const icon: "plane" | "train" | "bus" =
        km >= 600 ? "plane" : km >= 50 ? "train" : "bus";
      // Bezier midpoint: use the FANNED positions (so transport
      // icons sit exactly on the visible route polyline) — same
      // offset rule as buildCurvedPath.
      const [x1, y1] = fannedRouteXys[i] ?? a.xy;
      const [x2, y2] = fannedRouteXys[i + 1] ?? b.xy;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const sign = i % 2 === 0 ? 1 : -1;
      const offsetMag = Math.min(len * 0.12, 50);
      const cx = midX + ((-dy / len) * offsetMag) * sign;
      const cy = midY + ((dx / len) * offsetMag) * sign;
      // Quadratic bezier at t=0.5 = (P0 + 2*C + P2) / 4
      const tx = (x1 + 2 * cx + x2) / 4;
      const ty = (y1 + 2 * cy + y2) / 4;
      // Tangent at t=0.5 for icon orientation
      const tdx = x1 + 2 * (cx - x1) - 2 * (cx - tx);
      const tdy = y1 + 2 * (cy - y1) - 2 * (cy - ty);
      const angle = (Math.atan2(tdy, tdx) * 180) / Math.PI;
      // v357 — SKIP transport icons in tight clusters. Three checks:
      //   1. Total straight-line screen distance < 80px → too tight
      //      to fit an icon + pill without overlapping adjacent
      //      markers' day badges or city labels.
      //   2. Midpoint within 32px of either endpoint marker.
      //   3. v358c — midpoint within 36px of any NON-endpoint marker
      //      (Croatia 990010 had pill 3→4 colliding with Day 5
      //      marker / Zadar city label that wasn't an endpoint).
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      if (segLen < 80) continue;
      const distToA = Math.hypot(tx - x1, ty - y1);
      const distToB = Math.hypot(tx - x2, ty - y2);
      const ICON_MARKER_MIN_GAP = 32;
      if (
        distToA < ICON_MARKER_MIN_GAP ||
        distToB < ICON_MARKER_MIN_GAP
      ) {
        continue;
      }
      const NEARBY_OTHER_GAP = 36;
      let collidesWithOther = false;
      for (let k = 0; k < projectedStops.length; k++) {
        if (k === i || k === i + 1) continue; // skip endpoints
        const [ox, oy] = projectedStops[k].xy;
        if (Math.hypot(tx - ox, ty - oy) < NEARBY_OTHER_GAP) {
          collidesWithOther = true;
          break;
        }
      }
      if (collidesWithOther) continue;
      // v333 — detect scenic-train overrides from the TO-day's name.
      // PACK&GO itinerary convention: each day's title describes how
      // you reached that day's destination (e.g. Day 4 "伯恩 → 黃金列車
      // → 蒙投" means the GoldenPass ride brought the group from Bern
      // to Montreux). So the train belongs to the leg ENDING on that
      // day, i.e. Day (n-1) → Day n. We check only the TO-day's name
      // to avoid double-matching the next leg.
      const toName = b.stop.name || "";
      const scenicOverride = SCENIC_TRAIN_OVERRIDES.find((s) =>
        s.patterns.some((p) => toName.includes(p))
      );
      const finalIcon: "plane" | "train" | "bus" = scenicOverride
        ? "train"
        : icon;

      segments.push({
        mid: [tx, ty],
        icon: finalIcon,
        angle,
        km,
        fromDay: a.stop.day,
        toDay: b.stop.day,
        scenicOverride: scenicOverride
          ? {
              hours: scenicOverride.hours,
              enLabel: scenicOverride.enLabel,
              zhLabel: scenicOverride.zhLabel,
            }
          : undefined,
      });
    }
    return segments;
  }, [projectedStops, fannedRouteXys]);

  /**
   * Round 80.21 v26: complete rewrite of label placement.
   *
   * Strategy:
   *   1. Each marker shows its DAY NUMBER INSIDE the red dot (white
   *      text). City name is the only OUTSIDE label.
   *   2. For "lonely" markers (no neighbour within CLUSTER_RADIUS),
   *      use 4-direction least-crowded placement (existing logic).
   *   3. For "clustered" markers (≥1 neighbour close), place the
   *      label RADIALLY OUTWARD from the cluster centroid by ~55px
   *      and draw a thin LEADER LINE from marker to label so users
   *      can still tell which label belongs to which dot.
   *   4. After initial placement, run a few force iterations to
   *      push overlapping labels apart further.
   */
  const labelPlacements = useMemo(() => {
    // v359 — scale layout distances with fontScale so mobile (1.7×–2.8×
    // text) gets correspondingly larger label spacing. On Switzerland
    // 990015 mobile viewport, 蒙投 and 冰河3000 labels were colliding
    // because the fan-out radius stayed at 60 while text grew to 25px.
    const CLUSTER_RADIUS = 70;
    const RADIAL_LENGTH = 60 * Math.max(1, Math.sqrt(fontScale));
    const SHORT_GAP = 11 * Math.max(1, Math.sqrt(fontScale));

    // Pre-compute neighbour list per marker.
    const neighboursOf = uniqueStops.map((p, idx) => {
      const [x, y] = p.xy;
      const list: { idx: number; xy: [number, number] }[] = [];
      uniqueStops.forEach((q, qIdx) => {
        if (qIdx === idx) return;
        if (Math.hypot(q.xy[0] - x, q.xy[1] - y) <= CLUSTER_RADIUS) {
          list.push({ idx: qIdx, xy: q.xy });
        }
      });
      return list;
    });

    // v358 — same-city dedup. France tour 990014 had 3 Paris-area stops
    // with admin-set descriptive names (巴黎 / 巴黎經典左岸 / 巴黎高地與鐵塔)
    // all clustering in the same screen area, producing overlapping
    // city labels. When stops share a Chinese prefix (one is a prefix
    // of the other), they're treated as the same city — the canonical
    // label is the SHORTEST prefix, and only the first marker per
    // canonical city shows the label. Other markers show only their
    // day-number dot (still hover-tooltip-able for the full name).
    const rawCities = uniqueStops.map((p) =>
      tCity(extractDestinationCity(p.stop.name))
    );
    const canonicalCity = (idx: number): string => {
      const me = rawCities[idx];
      let best = me;
      for (let i = 0; i < rawCities.length; i++) {
        if (i === idx) continue;
        const other = rawCities[i];
        if (!other || !me) continue;
        // Match if either is a prefix of the other AND both have ≥2 CJK chars.
        const cjkPrefix = /^[一-鿿]{2,}/.test(me) && /^[一-鿿]{2,}/.test(other);
        if (!cjkPrefix) continue;
        if (me.startsWith(other) || other.startsWith(me)) {
          // Pick the shorter of the two as the canonical
          if (other.length < best.length) best = other;
        }
      }
      return best;
    };
    const labeledCanonical = new Set<string>();

    return uniqueStops.map((p, idx) => {
      const [x, y] = p.xy;
      const neigh = neighboursOf[idx];
      const rawCity = rawCities[idx];
      const canonical = canonicalCity(idx);
      let cityName: string;
      if (rawCity !== canonical) {
        // This stop's name is the longer descriptive form; suppress the
        // label (canonical is shown by an earlier marker).
        cityName = labeledCanonical.has(canonical) ? "" : canonical;
        labeledCanonical.add(canonical);
      } else if (labeledCanonical.has(canonical)) {
        // First-time short label that's already been printed — suppress.
        cityName = "";
      } else {
        cityName = canonical;
        labeledCanonical.add(canonical);
      }
      const sortedDays = [...p.days].sort((a, b) => a - b);
      const dayLabel =
        language === "en"
          ? `Day ${sortedDays.join("/")}`
          : `第 ${sortedDays.join("/")} 天`;

      let dx = 0;
      let dy = 0;
      let textAnchor: "start" | "end" | "middle" = "start";
      let useLeader = false;

      if (neigh.length >= 2) {
        // CLUSTERED — push label radially outward from neighbour
        // centroid. Two collinear neighbours can produce a zero
        // direction; in that case we fall back to a slot index.
        const cx =
          neigh.reduce((s, n) => s + n.xy[0], 0) / neigh.length;
        const cy =
          neigh.reduce((s, n) => s + n.xy[1], 0) / neigh.length;
        let ax = x - cx;
        let ay = y - cy;
        let mag = Math.hypot(ax, ay);
        if (mag < 1) {
          // Marker IS the cluster centre — pick a slot based on idx
          const slotAngle = (idx * Math.PI * 2) / uniqueStops.length;
          ax = Math.cos(slotAngle);
          ay = Math.sin(slotAngle);
          mag = 1;
        }
        dx = (ax / mag) * RADIAL_LENGTH;
        dy = (ay / mag) * RADIAL_LENGTH;
        if (Math.abs(ax) > Math.abs(ay) * 0.7) {
          textAnchor = ax > 0 ? "start" : "end";
        } else {
          textAnchor = "middle";
        }
        useLeader = true;
      } else if (neigh.length === 1) {
        // v359 — true continuous-angle "directly opposite the neighbour"
        // placement. The old 4-cardinal least-crowded picker had a bug:
        // when neighbours sat at SE / NW (ddx ≠ 0 and ddy ≠ 0 with
        // |ddx| > |ddy|), only counts.right (or .left) got incremented,
        // so 3 of the 4 directions tied at 0 and stable-sort always
        // picked "top". Result: BOTH Day 4 蒙投 (neighbour SE) and Day 5
        // 冰河3000 (neighbour NW) ended up with labels above their
        // marker, colliding with each other on mobile. Now we use the
        // exact opposite vector (continuous angle), then nudge to one
        // of 8 quadrants for consistent text-anchor placement.
        const [qx, qy] = neigh[0].xy;
        const ax = x - qx;
        const ay = y - qy;
        const mag = Math.hypot(ax, ay) || 1;
        let nx = ax / mag;
        let ny = ay / mag;
        // Edge-bias: pull AWAY from the nearest viewport edge so the
        // label doesn't get clipped. Add a vector pointing inward.
        const EDGE_FRAC = 0.18;
        if (x > MAP_WIDTH * (1 - EDGE_FRAC)) nx -= 0.6;
        if (x < MAP_WIDTH * EDGE_FRAC) nx += 0.6;
        if (y > MAP_HEIGHT * (1 - EDGE_FRAC)) ny -= 0.6;
        if (y < MAP_HEIGHT * EDGE_FRAC) ny += 0.6;
        const m = Math.hypot(nx, ny) || 1;
        nx /= m;
        ny /= m;
        const dist = SHORT_GAP + 4;
        dx = nx * dist;
        dy = ny * dist;
        // Anchor: if label is to the right of marker centre, anchor
        // start; left → end; mostly above/below → middle.
        if (Math.abs(nx) > 0.5) {
          textAnchor = nx > 0 ? "start" : "end";
        } else {
          textAnchor = "middle";
        }
      } else {
        // No neighbour — default to right-side label, but flip to
        // left-side if the marker is in the right edge zone so the
        // city label + START/END chip don't get clipped. v309: this
        // branch was edge-blind, which is why "Munich" + "✈ START /
        // END" got cropped against the right border in EN mode.
        const EDGE_FRAC = 0.18;
        if (x > MAP_WIDTH * (1 - EDGE_FRAC)) {
          dx = -SHORT_GAP;
          dy = 4;
          textAnchor = "end";
        } else if (x < MAP_WIDTH * EDGE_FRAC) {
          dx = SHORT_GAP;
          dy = 4;
          textAnchor = "start";
        } else if (y < MAP_HEIGHT * EDGE_FRAC) {
          dx = 0;
          dy = SHORT_GAP + 14;
          textAnchor = "middle";
        } else {
          dx = SHORT_GAP;
          dy = 4;
          textAnchor = "start";
        }
      }

      return {
        dx,
        dy,
        textAnchor,
        cityName,
        dayLabel,
        days: sortedDays,
        useLeader,
      };
    });
  }, [uniqueStops, language, fontScale]);

  const routePath = useMemo(
    () => buildCurvedPath(fannedRouteXys),
    [fannedRouteXys]
  );

  /**
   * v313: per-segment path strings with their transport mode, so we
   * can render plane segments dashed (like flight paths) and ground
   * segments solid. Each segment uses the same bezier math as
   * `buildCurvedPath` so visually they overlap perfectly with the
   * computed transport-icon midpoints.
   */
  const routeSegmentPaths = useMemo(() => {
    const out: Array<{ d: string; mode: "plane" | "train" | "bus" }> = [];
    for (let i = 0; i < fannedRouteXys.length - 1; i++) {
      const [x1, y1] = fannedRouteXys[i];
      const [x2, y2] = fannedRouteXys[i + 1];
      // Skip identical-position pairs (Day N → Day N+1 same city)
      if (Math.hypot(x2 - x1, y2 - y1) < 0.5) continue;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const sign = i % 2 === 0 ? 1 : -1;
      const offsetMag = Math.min(len * 0.12, 50);
      const cx = midX + ((-dy / len) * offsetMag) * sign;
      const cy = midY + ((dx / len) * offsetMag) * sign;
      const d = `M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
      // Mode comes from transportSegments which uses the same i index.
      const mode = transportSegments[out.length]?.icon ?? "bus";
      out.push({ d, mode });
    }
    return out;
  }, [fannedRouteXys, transportSegments]);

  return (
    <div
      className="aspect-[3/2] relative bg-[#e0e0e0] overflow-hidden"
      role="img"
      aria-label="行程路線地圖"
    >
      <ComposableMap
        projection="geoMercator"
        projectionConfig={projection}
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        {/* Arrowhead + drop-shadow filter for active country */}
        <defs>
          <marker
            id="route-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            {/* v349 — grey arrowhead matches the elegant grey route line
                (was sepia brown; reference image uses neutral grey). */}
            <path d="M0,0 L10,5 L0,10 Z" fill="#5a5550" />
          </marker>
          <filter
            id="active-country-shadow"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur stdDeviation="1.5" />
            <feOffset dx="0" dy="1" result="offset" />
            <feFlood floodColor="#000000" floodOpacity="0.15" />
            <feComposite in2="offset" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* v333 — sepia tint filter for the pre-rendered greyscale
              hillshade PNG. Linear-LERPs greyscale pixels to:
                L=0 (peak)     → warm brown #7a5e2e (122, 94, 46)
                L=255 (lowland)→ cream      #f5e8c8 (245,232,200)
              The matrix per row is [R G B A offset], where offsets
              are 0..1 (so 122/255 = 0.478, 94/255 = 0.369, etc).
              Slopes are (target_high - target_low) / 255 — see
              `scripts/fetch-hillshade.mjs` comment for derivation. */}
          <filter id="hillshade-sepia">
            <feColorMatrix
              type="matrix"
              values={[
                "0.482 0 0 0 0.478",
                "0 0.541 0 0 0.369",
                "0 0 0.604 0 0.180",
                "0 0 0 1 0",
              ].join(" ")}
            />
          </filter>
          {/* v329 priority #6: paper-grain texture overlay applied
              to the entire map. Adds the subtle vintage-print feel
              of Jeff's reference image — like the paper has tiny
              fibers and slight color variations across its surface. */}
          <pattern
            id="paper-grain"
            x="0"
            y="0"
            width="200"
            height="200"
            patternUnits="userSpaceOnUse"
          >
            <rect width="200" height="200" fill="#f5e8c8" />
            <filter id="grain-noise">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves="2"
                seed="5"
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0.5  0 0 0 0 0.4  0 0 0 0 0.25  0 0 0 0.06 0"
              />
            </filter>
            <rect
              width="200"
              height="200"
              fill="white"
              filter="url(#grain-noise)"
            />
          </pattern>
          {/* v306: cinematic marker entrance animation. Each marker
              fades + scales in, staggered by index so the route
              "draws itself" in chronological order. Uses
              prefers-reduced-motion to skip animation for users
              who request it. */}
          <style>
            {`
              @keyframes pg-marker-pop {
                0% { opacity: 0; transform: scale(0.4); }
                70% { opacity: 1; transform: scale(1.08); }
                100% { opacity: 1; transform: scale(1); }
              }
              .pg-marker {
                opacity: 0;
                transform-origin: center;
                transform-box: fill-box;
                animation: pg-marker-pop 480ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
              }
              @keyframes pg-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              .pg-fade {
                opacity: 0;
                animation: pg-fade-in 380ms ease-out forwards;
              }
              @media (prefers-reduced-motion: reduce) {
                .pg-marker, .pg-fade {
                  animation: none;
                  opacity: 1;
                }
              }
              /* v312: keyboard focus ring for tab-through markers */
              .pg-marker:focus-visible {
                outline: none;
              }
              .pg-marker:focus-visible circle:nth-of-type(1) {
                stroke: #0d9488 !important;
                stroke-width: 3 !important;
                filter: drop-shadow(0 0 6px rgba(13,148,136,0.6));
              }
              /* v315: chip-hover-driven highlight ring around the
                 currently "lit" marker. Drawn on the OUTERMOST
                 circle so it doesn't fight the white border. */
              .pg-marker-lit circle[fill="#c1272d"] {
                filter: drop-shadow(0 0 6px rgba(193,39,45,0.55));
              }
              @keyframes pg-marker-ring {
                0% { r: 11; opacity: 0.7; }
                100% { r: 24; opacity: 0; }
              }
              /* v312: print friendly — no animations, full opacity,
                 hidden cursor:pointer, slightly thicker route line. */
              @media print {
                .pg-marker, .pg-fade {
                  animation: none !important;
                  opacity: 1 !important;
                }
              }
            `}
          </style>
        </defs>

        {/* v357 — Jeff's Czech / Austria reference:
            • Background = light grey (#e0e0e0). This reads as the
              "off-map / non-land" ambient.
            • Every country = pure white fill, hairline grey border.
              The contrast against the grey background is what defines
              country silhouettes. Active vs neighbour are visually
              equal (the reference makes no distinction). */}
        <rect
          x={0}
          y={0}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          fill="#e0e0e0"
          style={{ pointerEvents: "none" }}
        />

        <Geographies geography={countries110m as any}>
          {({ geographies }: { geographies: any[] }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#ffffff"
                stroke="#b8b8b8"
                strokeWidth={0.5}
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>
        {/* v357 — country name labels (瑞士 / 義大利 etc.) REMOVED.
            Reference has none — the cities and arrows tell the story;
            country silhouettes are pure white space. Cleaner read. */}

        {/* Per-segment route paths — v313: plane segments are dashed
            (like flight paths in airline maps), train + bus are solid
            (continuous ground transport). Each segment also fades in
            on its own staggered timeline so the route "draws itself"
            in chronological order. */}
        {routeSegmentPaths.map((seg, i) => {
          const isPlane = seg.mode === "plane";
          // Last segment gets the arrowhead so users see direction
          // overall, but each segment gets its own anyway.
          return (
            <path
              key={`route-${i}`}
              className="pg-fade"
              d={seg.d}
              fill="none"
              // v330: warm sepia-brown matches the vintage travel-map
              // reference. Was #1a1a1a (near-black) — reference shows
              // route lines drawn in warm brown ink, not black.
              stroke="#5a5550"
              strokeWidth={1.7}
              strokeOpacity={0.92}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={isPlane ? "5 4" : undefined}
              // v349 — arrowhead on EVERY segment (not just the last).
              // Per Jeff's reference image: customer reads the route
              // direction at every leg, not just at journey end.
              markerEnd="url(#route-arrow)"
              style={{ animationDelay: `${120 + i * 80}ms` }}
            />
          );
        })}

        {/* Transport icons at segment midpoints. v353 — SKIP icon +
            pill entirely on very short segments (<40 km). On clustered
            tour stops (Day 4→5 Montreux→Glacier3000, ~30 km), the
            transport icon and time pill end up landing right on top of
            adjacent markers and their city labels. Hiding them on short
            segments is the only clean fix — the route line itself is
            enough to tell customers "next day, short hop" and the day
            chips below the map carry the time info. */}
        {transportSegments.map((seg, i) => {
          if (seg.km < 40) return null;
          const colors =
            seg.icon === "plane"
              ? { bg: "#dbe9f4", stroke: "#3b6e9b" }
              : seg.icon === "train"
                ? { bg: "#f0e4cc", stroke: "#7a6240" }
                : { bg: "#e8e8e8", stroke: "#5a5a5a" };
          // v317: hoverable transport icon with distance + duration
          // tooltip. Approx duration estimates by mode:
          //   bus: 60 km/h average (highway + city stops)
          //   train: 100 km/h average (regional rail)
          //   plane: 750 km/h cruise + 90 min terminal overhead
          const isHovered = transportHover === i;
          const durationMin =
            seg.icon === "plane"
              ? Math.round((seg.km / 750) * 60 + 90)
              : seg.icon === "train"
                ? Math.round((seg.km / 100) * 60)
                : Math.round((seg.km / 60) * 60);
          const formatDuration = (mins: number) => {
            if (mins < 60) return `${mins} min`;
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            return m === 0
              ? `${h}h`
              : `${h}h ${m}min`;
          };
          const distanceText = `${Math.round(seg.km)} km · ${formatDuration(durationMin)}`;
          const modeLabel =
            language === "en"
              ? seg.icon === "plane"
                ? "Flight"
                : seg.icon === "train"
                  ? "Train"
                  : "Coach"
              : seg.icon === "plane"
                ? "飛機"
                : seg.icon === "train"
                  ? "火車"
                  : "巴士";
          const dayLink =
            language === "en"
              ? `Day ${seg.fromDay}→${seg.toDay}`
              : `第${seg.fromDay}→${seg.toDay}天`;
          const tipText = `${dayLink} · ${modeLabel} · ${distanceText}`;
          const tipW = tipText.length * 7 + 16;
          return (
            <g
              key={`tx-${i}`}
              className="pg-fade"
              transform={`translate(${seg.mid[0]}, ${seg.mid[1]})`}
              onMouseEnter={() => setTransportHover(i)}
              onMouseLeave={() => setTransportHover(null)}
              style={{
                pointerEvents: "auto",
                cursor: "help",
                // Transport icons fade in just AFTER the two adjacent
                // markers have popped, so the eye reads city → city
                // → connecting transport.
                animationDelay: `${(i + 1) * 80 + 200}ms`,
              }}
            >
              <circle
                r={14}
                fill={colors.bg}
                stroke={colors.stroke}
                strokeWidth={isHovered ? 2 : 1.4}
              />
              {seg.icon === "plane" && <PlaneIcon stroke={colors.stroke} />}
              {seg.icon === "train" && <TrainIcon stroke={colors.stroke} />}
              {seg.icon === "bus" && <BusIcon stroke={colors.stroke} />}
              {/* v328: always-on time label next to icon (matches
                  reference). Range like "約 1.5-2 小時" or "約 1 小時".
                  v333 — scenic-train segments use the published duration
                  from the override table, plus prepend the train's
                  branded name (e.g. "Glacier Express · 7-8h"). */}
              {(() => {
                const fmt = (h: number) => (h % 1 === 0 ? `${h}` : `${h}`);
                let lower: number;
                let upper: number;
                let prefixLabel: string | null = null;
                if (seg.scenicOverride) {
                  lower = seg.scenicOverride.hours.lo;
                  upper = seg.scenicOverride.hours.hi;
                  prefixLabel =
                    language === "en"
                      ? seg.scenicOverride.enLabel
                      : seg.scenicOverride.zhLabel;
                } else {
                  const km = seg.km;
                  const speedKmh =
                    seg.icon === "plane"
                      ? 750
                      : seg.icon === "train"
                        ? 100
                        : 60;
                  const overheadMin = seg.icon === "plane" ? 90 : 0;
                  const baseH = ((km / speedKmh) * 60 + overheadMin) / 60;
                  lower = Math.max(0.5, Math.round((baseH - 0.25) * 2) / 2);
                  upper = Math.max(
                    lower + 0.5,
                    Math.round((baseH + 0.25) * 2) / 2
                  );
                }
                // v347 — drop "約" prefix from Chinese durations and
                // tighten unit ("小時" → "h"). Customers already know
                // these are estimates from the disclaimer; the prefix
                // burned 2 characters that made pills overlap on
                // adjacent short segments. "約 2.5-3 小時" → "2.5-3h".
                const durationText =
                  upper === lower
                    ? `${fmt(lower)}h`
                    : `${fmt(lower)}-${fmt(upper)}h`;
                // v329 priority #1: prepend "Day X→Y" so customers
                // immediately see WHICH segment this duration belongs
                // to. v347b: SKIP day prefix on very short segments
                // (<40 km) because pill ends up colliding with marker
                // labels. Customer can still tell which segment from
                // the icon position. Short segments: just durationText
                // (or scenicLabel + duration if a named train).
                const isShortSeg = seg.km < 40;
                const dayRange =
                  language === "en"
                    ? `D${seg.fromDay}→${seg.toDay}`
                    : `${seg.fromDay}→${seg.toDay} 天`;
                let timeText: string;
                if (isShortSeg) {
                  timeText = prefixLabel
                    ? `${prefixLabel} · ${durationText}`
                    : durationText;
                } else {
                  timeText = prefixLabel
                    ? `${dayRange} · ${prefixLabel} · ${durationText}`
                    : `${dayRange} · ${durationText}`;
                }
                const charW = language === "en" ? 6 : 10;
                const timeW = timeText.length * charW + 14;
                // v346/v347 — alternate above/below per i%2 for
                // adjacent-pill anti-collision. v358b tried bumping
                // 22/-31 → 28/-37 but pushed pills INTO non-endpoint
                // markers (Day 5 in Croatia 990010). Reverted.
                const pillOffset = i % 2 === 0 ? 22 : -31;
                return (
                  <g
                    style={{ pointerEvents: "none" }}
                    transform={`translate(${-timeW / 2}, ${pillOffset})`}
                  >
                    <rect
                      x={0}
                      y={-9}
                      width={timeW}
                      height={18}
                      rx={9}
                      // v352 — softer almost-frameless pill, per Jeff's
                      // 雄獅 reference simplicity. Subtle grey border
                      // and very faint shadow so it reads as floating
                      // info without competing visually.
                      fill="rgba(255,255,255,0.94)"
                      stroke="rgba(90, 85, 80, 0.18)"
                      strokeWidth={0.7}
                      style={{
                        filter: "drop-shadow(0 0.5px 1px rgba(0,0,0,0.06))",
                      }}
                    />
                    <text
                      x={timeW / 2}
                      y={4}
                      textAnchor="middle"
                      fontSize={10.5 * fontScale}
                      fontWeight={500}
                      fill="#5a4530"
                      fontFamily="'Noto Serif TC', serif"
                      letterSpacing="0.04em"
                    >
                      {timeText}
                    </text>
                  </g>
                );
              })()}
              {isHovered && (
                <g style={{ pointerEvents: "none" }}>
                  <rect
                    x={-tipW / 2}
                    y={-36}
                    width={tipW}
                    height={20}
                    rx={4}
                    fill="#0a0a0a"
                    fillOpacity={0.92}
                  />
                  <text
                    x={0}
                    y={-22}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={500}
                    fill="#ffffff"
                    fontFamily="'Noto Sans TC', sans-serif"
                  >
                    {tipText}
                  </text>
                  <path
                    d={`M -4 -16 L 0 -12 L 4 -16 Z`}
                    fill="#0a0a0a"
                    fillOpacity={0.92}
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* v348 — REMOVED per-segment chevrons. Jeff's feedback:
            "意義不明的線 ... 箭頭都不知道去哪裡". Mid-segment chevrons
            sat near transport icons but pointed in the segment-tangent
            direction, causing customers to wonder "where is this arrow
            pointing?" without context. Direction is already conveyed
            by:
              • Day numbers inside markers (1, 2, 3 ... → flow obvious)
              • The single arrowhead at the END of the last segment
                (route-arrow marker on path)
              • Numbered day chips below the map
            Removing the chevrons declutters the map. */}

        {/* v347 — Water labels (this late-render block is now disabled).
            Lakes render BEFORE pills (back to v345 order) but with
            smaller, lighter atmospheric styling so a pill covering them
            doesn't lose critical info. The label render block above is
            the active one. */}

        {/* v350 — highlight keywords. Per Jeff's reference image: gold
            ★ marks "特色景點" (signature stops). We detect them by
            scanning each day's name for landmark / scenic-train /
            historical-site keywords. The keyword list is intentionally
            conservative (only iconic Swiss + common European landmarks
            for now) — we'd rather miss a star than star every stop. */}
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        {/* City markers — red dot + city label adjacent. We render
            ONE marker per unique geographic position so a city visited
            multiple times (e.g. Munich on day 1 and day 8) doesn't
            stack two overlapping labels. Label position is chosen
            per-marker by `labelPlacements` to avoid neighbour overlap. */}
        {uniqueStops.map(({ stop, days }, i) => {
          const placement = labelPlacements[i];
          const isEntry = days.includes(1);
          // v350 — detect highlight stops by scanning day names for
          // signature attractions / scenic train experiences. Returns
          // true if any of the user's days at this marker mentions a
          // landmark keyword.
          const HIGHLIGHT_KEYWORDS = [
            // Switzerland
            "馬特洪峰",
            "Matterhorn",
            "冰河3000",
            "Glacier 3000",
            "黃金列車",
            "GoldenPass",
            "Golden Pass",
            "冰河列車",
            "Glacier Express",
            "西庸古堡",
            "Chillon",
            "First Cliff Walk",
            "懸崖步道",
            "馬特宏峰",
            // Italy / France iconic spots
            "羅浮宮",
            "Louvre",
            "凱旋門",
            "Arc de Triomphe",
            "艾菲爾",
            "鐵塔",
            "Eiffel",
            "蒙馬特",
            "Montmartre",
            "聖母院",
            "Notre",
            // Japan iconic
            "富士山",
            "Mt. Fuji",
            "立山黑部",
            // Peru
            "馬丘比丘",
            "Machu Picchu",
            // Generic indicators of "highlight" stops
            "古堡",
          ];
          const isHighlight = days.some((d) => {
            const dayName = stops.find((s) => s.day === d)?.name || "";
            return HIGHLIGHT_KEYWORDS.some((k) => dayName.includes(k));
          });
          // Multi-day cities (Day 1/8 etc.) need wider dots to fit "1/8"
          const dayBadgeText = days.join("/");
          const wide = dayBadgeText.length > 1;
          // v352 — slightly smaller dots per 雄獅 reference simplicity:
          // 13/11 → 11/9. Day numbers still readable, markers stop
          // dominating the map.
          const dotR = wide ? 11 : 9;
          // v312: accessibility — descriptive aria-label spells out
          // the day(s), city, and full theme so screen readers can
          // announce each marker without users having to hover.
          const fullDayName =
            days
              .map((d) => stops.find((s) => s.day === d)?.name || "")
              .filter(Boolean)
              .join(" · ") || "";
          const cleanedTheme = fullDayName.replace(
            /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
            ""
          );
          const dayLabel =
            language === "en"
              ? `Day ${days.join(" and ")}`
              : `第 ${days.join("、")} 天`;
          const ariaLabel = `${dayLabel}: ${placement.cityName}${
            cleanedTheme ? ` · ${cleanedTheme}` : ""
          }`;
          // v315: marker is "lit" if either the user is hovering the
          // dot itself OR a chip below the map matching one of this
          // marker's days is hovered.
          const externallyHighlighted =
            highlightedDay != null && days.includes(highlightedDay);
          const isLit = hovered === i || externallyHighlighted;
          // v318: render at the FANNED xy from uniqueStops instead of
          // re-projecting via GeoMarker. The cluster fan-out modifies
          // xy to break vertical stacking — using GeoMarker would
          // re-project from raw lng/lat and undo our fan-out.
          const [markerX, markerY] = uniqueStops[i].xy;
          return (
            <g
              key={i}
              transform={`translate(${markerX}, ${markerY})`}
            >
              <g
                className={`pg-marker${isLit ? " pg-marker-lit" : ""}`}
                onMouseEnter={() => {
                  setHovered(i);
                  onMarkerHover?.(days[0]);
                }}
                onMouseLeave={() => {
                  setHovered(null);
                  onMarkerHover?.(null);
                }}
                onFocus={() => {
                  setHovered(i);
                  onMarkerHover?.(days[0]);
                }}
                onBlur={() => {
                  setHovered(null);
                  onMarkerHover?.(null);
                }}
                tabIndex={0}
                role="img"
                aria-label={ariaLabel}
                style={{
                  cursor: "pointer",
                  // Stagger marker entrance: each subsequent marker
                  // appears 80ms after the previous, in day order.
                  animationDelay: `${i * 80}ms`,
                  outline: "none",
                }}
              >
                {/* Leader line: marker → label position when label is
                    pushed outward in a cluster. Drawn first so it
                    sits behind the marker and label. */}
                {placement.useLeader && (
                  <line
                    x1={0}
                    y1={0}
                    x2={placement.dx -
                      (placement.textAnchor === "end"
                        ? -3
                        : placement.textAnchor === "start"
                          ? 3
                          : 0)}
                    y2={placement.dy - 4}
                    stroke="#7a6240"
                    strokeWidth={0.9}
                    strokeOpacity={0.55}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {/* v357 — entry marker: just a standalone black ✈ glyph
                    to the right of the dot, no gold ring, no white
                    circle. Matches Jeff's 雄獅 reference (Vienna shows
                    only a tiny plane silhouette next to the city). */}
                {isEntry && (
                  <g
                    transform={`translate(${dotR + 14}, -2)`}
                    style={{ pointerEvents: "none" }}
                  >
                    <path
                      d="M 0,0 L 18,-6 L 16,-4 L 12,-2 L 14,0 L 12,2 L 16,4 L 18,6 Z"
                      fill="#1a1a1a"
                    />
                  </g>
                )}
                {/* v357 — highlight stops show a standalone gold ★
                    glyph above the marker (reverted from v356's halo
                    ring). Matches reference's discrete star marking
                    signature attractions (e.g. 鹽湖區 star). */}
                {isHighlight && !isEntry && (
                  <text
                    x={0}
                    y={-dotR - 6}
                    textAnchor="middle"
                    fontSize={18 * fontScale}
                    fill="#e0b040"
                    style={{
                      pointerEvents: "none",
                      paintOrder: "stroke fill",
                      stroke: "#ffffff",
                      strokeWidth: 2,
                      strokeLinejoin: "round",
                    }}
                  >
                    ★
                  </text>
                )}
                {/* v357 — black marker dot. Reference uses solid black
                    circles with no white border. Day number sits inside
                    in white. */}
                <circle
                  r={isLit ? dotR + 1 : dotR}
                  fill="#1a1a1a"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  style={{
                    transition: "r 150ms ease",
                  }}
                />
                <text
                  x={0}
                  y={4 * Math.sqrt(fontScale)}
                  textAnchor="middle"
                  fontSize={(wide ? 10 : 12) * fontScale}
                  fontWeight={800}
                  fill="#ffffff"
                  fontFamily="'Noto Sans TC', sans-serif"
                  style={{ pointerEvents: "none", letterSpacing: "0.02em" }}
                >
                  {dayBadgeText}
                </text>
                {/* v357 — bilingual stacked label per Jeff's 雄獅
                    reference: zh name large on top + en small below.
                    For en UI, zh subscript doesn't help so just show
                    the English line. v353's single-language rule was
                    reverted because the reference clearly stacks both. */}
                {(() => {
                  const isZh = language !== "en";
                  const primary = placement.cityName;
                  const altRaw = isZh
                    ? translateDestination(primary, "en")
                    : "";
                  const showAlt = isZh && altRaw && altRaw !== primary;
                  return (
                    <>
                      <text
                        x={placement.dx}
                        y={placement.dy}
                        fontSize={(isEntry ? 17 : 15) * fontScale}
                        fontWeight={isEntry ? 800 : 700}
                        fill="#1a1a1a"
                        fontFamily="'Noto Serif TC', serif"
                        textAnchor={placement.textAnchor}
                        letterSpacing="0.04em"
                        style={{
                          paintOrder: "stroke fill",
                          stroke: "#ffffff",
                          strokeWidth: 5,
                          strokeLinejoin: "round",
                          pointerEvents: "none",
                        }}
                      >
                        {primary}
                      </text>
                      {showAlt && (
                        <text
                          x={placement.dx}
                          y={placement.dy + (isEntry ? 14 : 12) * fontScale}
                          fontSize={(isEntry ? 11 : 10) * fontScale}
                          fontWeight={500}
                          fill="#4a4a4a"
                          fontFamily="'Inter', sans-serif"
                          textAnchor={placement.textAnchor}
                          letterSpacing="0.02em"
                          style={{
                            paintOrder: "stroke fill",
                            stroke: "#ffffff",
                            strokeWidth: 3.5,
                            strokeLinejoin: "round",
                            pointerEvents: "none",
                          }}
                        >
                          {altRaw}
                        </text>
                      )}
                    </>
                  );
                })()}
                {/* "起點 / 終點" chip below the entry city — gold
                    rounded-pill background so it reads as a distinct
                    badge instead of dim faded text. */}
                {/* Hover tooltip — shows the FULL day name (with theme,
                    e.g. "第 1 天 · 台北 → 慕尼黑：飛越歐洲") so users
                    can preview each day without leaving the map.
                    Round 80.21 v33. */}
                {isLit && (() => {
                  const fullName =
                    days
                      .map(
                        (d) =>
                          stops.find((s) => s.day === d)?.name || ""
                      )
                      .filter(Boolean)
                      .join(" · ") || "";
                  const display = fullName.replace(
                    /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
                    ""
                  );
                  const truncated =
                    display.length > 28
                      ? display.slice(0, 28) + "…"
                      : display;
                  const tipText = `${
                    language === "en"
                      ? `Day ${days.join("/")}`
                      : `第 ${days.join("/")} 天`
                  } · ${truncated}`;
                  const charW = 9;
                  const tipW = tipText.length * charW + 16;
                  return (
                    <g style={{ pointerEvents: "none" }}>
                      <rect
                        x={-tipW / 2}
                        y={-dotR - 32}
                        width={tipW}
                        height={22}
                        rx={4}
                        fill="#0a0a0a"
                        fillOpacity={0.92}
                      />
                      <text
                        x={0}
                        y={-dotR - 17}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={500}
                        fill="#ffffff"
                        fontFamily="'Noto Sans TC', sans-serif"
                      >
                        {tipText}
                      </text>
                      {/* Tooltip pointer triangle */}
                      <path
                        d={`M -5 ${-dotR - 10} L 0 ${-dotR - 4} L 5 ${-dotR - 10} Z`}
                        fill="#0a0a0a"
                        fillOpacity={0.92}
                      />
                    </g>
                  );
                })()}
                {/* v329 priority #2: removed the gold "✈ START / END"
                    pill below entry markers. The reference image
                    uses ONLY the small ✈ glyph at the airport,
                    keeping the entry city label clean. The plane
                    glyph is already rendered above (next to the
                    Day 1/8 dot via the gold halo + airport badge). */}
              </g>
            </g>
          );
        })}
      </ComposableMap>

      {/* v354 — REMOVED world inset. Per Jeff's reference (雄獅) +
          simplification preference: country labels (瑞士/德國/etc.)
          already give geographic context, the inset added clutter
          without proportional value. Bottom-right corner now empty,
          letting the legend breathe. */}

      {/* v357 — corner transport legend REMOVED. Jeff's 雄獅 reference
          has no legend; the transport icons on the route + ★ on
          highlight stops are self-explanatory. Cleaner map frame. */}

      {/* v356 — outlier banner removed. Jeff: "下面這部分很沒有用".
          The TPE departure/return info lives in the day-by-day
          itinerary section below the map; surfacing it on the
          regional map added clutter without value. */}
      <span
        className="absolute top-2 right-3 text-[9px] md:text-[10px] pointer-events-none"
        style={{
          fontFamily: "'Noto Sans TC', sans-serif",
          color: "rgba(90, 69, 48, 0.7)",
          fontStyle: "italic",
          letterSpacing: "0.02em",
        }}
      >
        {language === "en"
          ? "* Travel times are estimates"
          : "* 行車時間為概估"}
      </span>
    </div>
  );
}

/* ─────────────── transport icons (small, ~10x10 viewBox) ─────────────── */

/** ✈ — used on flight segments (≥600 km). Stylised airplane silhouette. */
function PlaneIcon({ stroke = "#1a1a1a" }: { stroke?: string }) {
  return (
    <g
      transform="translate(-9, -9) scale(0.75)"
      fill={stroke}
      style={{ pointerEvents: "none" }}
    >
      {/* Path adapted from feather-icons "send" / paper-plane silhouette */}
      <path d="M21.95 5.59a1 1 0 0 0-1.32-1.32L2.27 11.05a1 1 0 0 0 .07 1.87l5.84 1.83 1.83 5.84a1 1 0 0 0 1.87.07l6.79-18.36a1 1 0 0 0 .03-.05zM10.34 14.83l-3.74-1.17 11.06-4.09-7.32 5.26zm.67 2.14l5.26-7.32-4.09 11.06-1.17-3.74z" />
    </g>
  );
}

/** 🚆 — used on train segments (120–600 km). Compact train silhouette. */
function TrainIcon({ stroke = "#1a1a1a" }: { stroke?: string }) {
  return (
    <g
      transform="translate(-9, -9) scale(0.75)"
      fill={stroke}
      style={{ pointerEvents: "none" }}
    >
      <path d="M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-1.59l1.3 1.3a1 1 0 0 1-1.42 1.4L15.59 19H8.41l-1.7 1.7a1 1 0 0 1-1.42-1.4L6.59 18H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm1 4v3h5V8H6zm7 0v3h5V8h-5zM7 14a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm10 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    </g>
  );
}

/** 🚌 — used on short hops (<120 km). Bus / coach silhouette. */
function BusIcon({ stroke = "#1a1a1a" }: { stroke?: string }) {
  return (
    <g
      transform="translate(-9, -9) scale(0.75)"
      fill={stroke}
      style={{ pointerEvents: "none" }}
    >
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2v1a1 1 0 0 1-2 0v-1H8v1a1 1 0 0 1-2 0v-1a2 2 0 0 1-2-2V6zm2 0v5h12V6H6zm2 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    </g>
  );
}

