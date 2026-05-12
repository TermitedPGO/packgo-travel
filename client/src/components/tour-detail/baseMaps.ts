/**
 * baseMaps.ts — registry of hillshade PNGs for each region.
 *
 * v333 architecture pivot: instead of AI-generated full maps (translation
 * + accuracy issues), we generate ONLY the hillshade layer once per region
 * via `scripts/fetch-hillshade.mjs`. Everything else (country borders,
 * lakes, rivers, country names, markers, routes, time pills, decorations)
 * is rendered as SVG on top — fully translatable, fully accurate.
 *
 * To add a new region:
 *   1. Add an entry to REGIONS in `scripts/fetch-hillshade.mjs`
 *   2. Run `node scripts/fetch-hillshade.mjs <slug>`
 *   3. Add an entry below with the same slug + bbox + dimensions
 *      (the script logs the dimensions on completion)
 */

export interface HillshadeEntry {
  /** Short slug, used as the PNG filename and lookup key. */
  slug: string;
  /** URL relative to the site origin. */
  url: string;
  /** PNG dimensions (must match the actual file). */
  width: number;
  height: number;
  /** Geographic bounding box of the hillshade image (Mercator). */
  bbox: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  /** Country names that should resolve to this hillshade. */
  countries: string[];
}

const SWITZERLAND: HillshadeEntry = {
  slug: "switzerland",
  url: "/hillshade/switzerland.png",
  width: 910,
  height: 599,
  bbox: {
    minLng: 5.0,
    maxLng: 15.0,
    minLat: 44.5,
    maxLat: 49.0,
  },
  countries: [
    "Switzerland",
    "瑞士",
    "Austria",
    "奧地利",
    "Liechtenstein",
    "列支敦斯登",
  ],
};

const ITALY: HillshadeEntry = {
  slug: "italy",
  url: "/hillshade/italy.png",
  width: 569,
  height: 733,
  bbox: {
    minLng: 6.0,
    maxLng: 18.5,
    minLat: 35.5,
    maxLat: 47.5,
  },
  countries: [
    "Italy",
    "義大利",
    "意大利",
  ],
};

const ICELAND: HillshadeEntry = {
  slug: "iceland",
  url: "/hillshade/iceland.png",
  width: 546,
  height: 409,
  bbox: {
    minLng: -25.0,
    maxLng: -13.0,
    minLat: 63.0,
    maxLat: 66.8,
  },
  countries: ["Iceland", "冰島"],
};

const HOKKAIDO: HillshadeEntry = {
  slug: "hokkaido",
  url: "/hillshade/hokkaido.png",
  width: 1274,
  height: 1256,
  bbox: {
    minLng: 139.0,
    maxLng: 146.0,
    minLat: 41.0,
    maxLat: 46.0,
  },
  countries: ["Japan", "日本", "Hokkaido", "北海道"],
};

const FRANCE: HillshadeEntry = {
  slug: "france",
  url: "/hillshade/france.png",
  width: 455,
  height: 535,
  bbox: { minLng: -2.0, maxLng: 8.0, minLat: 43.0, maxLat: 51.0 },
  countries: ["France", "法國"],
};

const CENTRAL_EUROPE: HillshadeEntry = {
  slug: "central_europe",
  url: "/hillshade/central_europe.png",
  width: 592,
  height: 581,
  bbox: { minLng: 12.0, maxLng: 25.0, minLat: 47.0, maxLat: 55.0 },
  countries: [
    "Czechia", "捷克",
    "Czech Republic",
    "Poland", "波蘭",
    "Slovakia", "斯洛伐克",
    "Hungary", "匈牙利",
  ],
};

const BALKANS: HillshadeEntry = {
  slug: "balkans",
  url: "/hillshade/balkans.png",
  width: 387,
  height: 318,
  bbox: { minLng: 13.0, maxLng: 30.0, minLat: 39.0, maxLat: 49.0 },
  countries: [
    "Romania", "羅馬尼亞",
    "Croatia", "克羅埃西亞",
    "Bulgaria", "保加利亞",
    "Serbia", "塞爾維亞",
    "Slovenia", "斯洛維尼亞",
    "Bosnia and Herz.", "波士尼亞",
    "Albania", "阿爾巴尼亞",
    "Montenegro", "蒙特內哥羅",
  ],
};

const PERU: HillshadeEntry = {
  slug: "peru",
  url: "/hillshade/peru.png",
  width: 319,
  height: 441,
  bbox: { minLng: -82.0, maxLng: -68.0, minLat: -19.0, maxLat: 0.0 },
  countries: ["Peru", "秘魯"],
};

const USA_WEST: HillshadeEntry = {
  slug: "usa_west",
  url: "/hillshade/usa_west.png",
  width: 500,
  height: 575,
  bbox: { minLng: -125.0, maxLng: -103.0, minLat: 31.0, maxLat: 50.0 },
  countries: [
    "United States of America", "美國",
    "USA", "U.S.A.",
    "United States",
  ],
};

const HAWAII: HillshadeEntry = {
  slug: "hawaii",
  url: "/hillshade/hawaii.png",
  width: 546,
  height: 389,
  bbox: { minLng: -160.5, maxLng: -154.5, minLat: 18.5, maxLat: 22.5 },
  countries: ["Hawaii", "夏威夷"],
};

const CANADA_WEST: HillshadeEntry = {
  slug: "canada_west",
  url: "/hillshade/canada_west.png",
  width: 410,
  height: 469,
  bbox: { minLng: -128.0, maxLng: -110.0, minLat: 48.0, maxLat: 60.0 },
  countries: ["Canada", "加拿大"],
};

const NORWAY: HillshadeEntry = {
  slug: "norway",
  url: "/hillshade/norway.png",
  width: 478,
  height: 702,
  bbox: { minLng: 4.0, maxLng: 25.0, minLat: 58.0, maxLat: 71.0 },
  countries: [
    "Norway", "挪威",
    "Sweden", "瑞典",
    "Finland", "芬蘭",
  ],
};

const NEW_ZEALAND: HillshadeEntry = {
  slug: "new_zealand",
  url: "/hillshade/new_zealand.png",
  width: 318,
  height: 424,
  bbox: { minLng: 165.0, maxLng: 179.0, minLat: -48.0, maxLat: -34.0 },
  countries: ["New Zealand", "紐西蘭"],
};

// Order matters: more-specific regions (Hokkaido / Hawaii) come BEFORE
// the general country (Japan / USA) so they win the country-name match.
//
// v341 — 13 regions active. v339 covered active tour destinations;
// v341 preemptively adds the major destinations PACK&GO is likely to
// add next (USA West / Hawaii / Canada West / Norway / NZ).
const REGISTRY: HillshadeEntry[] = [
  SWITZERLAND,
  ITALY,
  ICELAND,
  HOKKAIDO,
  HAWAII, // before USA so HI tours don't fall back to mainland
  FRANCE,
  CENTRAL_EUROPE,
  BALKANS,
  PERU,
  USA_WEST,
  CANADA_WEST,
  NORWAY,
  NEW_ZEALAND,
];

/**
 * Find the best hillshade for a tour given its country (and optionally
 * its stop coordinates as a fallback). Returns null if no hillshade
 * covers the tour's region — caller should render the SVG without a
 * hillshade layer (still has the cream parchment background and country
 * geometries, just no painted mountain texture).
 */
export function findHillshade(args: {
  destinationCountry?: string;
  stops?: Array<{ lng: number; lat: number }>;
}): HillshadeEntry | null {
  const { destinationCountry, stops = [] } = args;

  if (destinationCountry) {
    const hit = REGISTRY.find((b) =>
      b.countries.some((c) => c === destinationCountry)
    );
    if (hit) return hit;
  }

  if (stops.length > 0) {
    const cLng = stops.reduce((a, s) => a + s.lng, 0) / stops.length;
    const cLat = stops.reduce((a, s) => a + s.lat, 0) / stops.length;
    const hit = REGISTRY.find(
      (b) =>
        cLng >= b.bbox.minLng &&
        cLng <= b.bbox.maxLng &&
        cLat >= b.bbox.minLat &&
        cLat <= b.bbox.maxLat
    );
    if (hit) return hit;
  }

  return null;
}
