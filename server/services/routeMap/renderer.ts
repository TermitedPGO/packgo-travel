/**
 * Route-map renderer — server-side cluster filter, brand-styled Google
 * Static Maps URL builder, and multi-stop directions URL.
 *
 * Extracted from server/routers/toursRouteMap.ts as part of v2 Wave 2
 * Module 2.13 (2026-05-21). Behavior is preserved verbatim from the
 * original.
 *
 * Public surface:
 *   - renderRouteMap(stops) — returns { staticMapUrl, primaryStops,
 *     outlierStops, directionsUrl }
 *   - haversineKm(lat1, lng1, lat2, lng2) — kept exported for tests
 *
 * Why server-side cluster filter (Round 80.21 v5):
 *   - Maplibre + vector tiles was too slow loading from Asia
 *     (Jeff: "載入時間太慢了"). Reverted to Google Static Maps API
 *     for instant single-image render with two upgrades:
 *     1. Server-side cluster filter (haversine-3000km) so the static
 *        map URL only contains primary-cluster stops.
 *     2. Branded B&W styling (strip Google's colorful default theme)
 *        matching PACK&GO's clean architectural-diagram aesthetic.
 */

export type Stop = { day: number; name: string; lat: number; lng: number };

export type RenderedRouteMap = {
  staticMapUrl: string;
  primaryStops: Stop[];
  outlierStops: Stop[];
  directionsUrl: string;
};

/** Great-circle distance in kilometers between two lat/lng pairs. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Brand styles for Google Static Maps — strips the colorful default
 * theme and produces a clean B&W minimal map.
 *
 * Round 80.21 v9 (5/6 00:30): Jeff confirmed map base should be plain
 * B&W gray (「黑白灰為配色」). Gold is reserved as an ACCENT on the
 * SVG decorations (title bar, compass rose), NOT on the map itself.
 * The result reads like a clean architectural diagram rather than a
 * decorated treasure map.
 */
const BRAND_STYLES = [
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

/**
 * Separate primary stops from outliers using a TWO-TIER cluster filter:
 *
 * Tier 1 — Median + 3000km (long-haul like TPE→ZRH→ZRH→TPE):
 *   Drops stops more than 3000km from the cluster median. Catches the
 *   departure/return airport on trans-continent tours.
 *
 * Tier 2 — Nearest-neighbour isolation (2026-05-22 fix):
 *   For each stop, compute distance to its nearest other stop. Any stop
 *   whose nearest neighbour is >3x the cluster's median nearest-neighbour
 *   distance is geographically isolated and gets pulled into outliers
 *   too. Catches the regional-haul case the median test missed:
 *   高雄→大阪 (1,800km, within Tier-1 threshold but obviously isolated
 *   from the Japan stops which cluster within ~300km of each other).
 *
 * Result: the rendered map zooms tight to the actual tour cluster;
 * outliers shown as a separate inset / banner / chip.
 */
// Exported for renderer tests. Internal to the route-map module otherwise.
export function clusterStops(stops: Stop[]): { primary: Stop[]; outliers: Stop[] } {
  if (stops.length <= 4) return { primary: stops, outliers: [] };

  // ── Tier 1: median + 3000km ─────────────────────────────────────────
  const lats = [...stops.map((s) => s.lat)].sort((a, b) => a - b);
  const lngs = [...stops.map((s) => s.lng)].sort((a, b) => a - b);
  const medLat = lats[Math.floor(lats.length / 2)];
  const medLng = lngs[Math.floor(lngs.length / 2)];
  const TIER1_RADIUS_KM = 3000;
  let inCluster = stops.filter(
    (s) => haversineKm(s.lat, s.lng, medLat, medLng) <= TIER1_RADIUS_KM,
  );
  let outside = stops.filter(
    (s) => haversineKm(s.lat, s.lng, medLat, medLng) > TIER1_RADIUS_KM,
  );
  if (inCluster.length < Math.max(3, Math.floor(stops.length * 0.5))) {
    // Tier 1 didn't help (cluster too small) — keep all as primary
    inCluster = stops;
    outside = [];
  }

  // ── Tier 2: nearest-neighbour isolation ────────────────────────────
  // Within the Tier-1-filtered cluster, find stops whose nearest neighbour
  // is much further than the typical inter-stop distance. These are
  // "geographically detached" even though they fit the wide Tier-1 radius.
  if (inCluster.length >= 5) {
    const nnDistances = inCluster.map((s) => {
      let min = Infinity;
      for (const other of inCluster) {
        if (other === s) continue;
        const d = haversineKm(s.lat, s.lng, other.lat, other.lng);
        if (d < min) min = d;
      }
      return { stop: s, nn: min };
    });
    const sortedNn = [...nnDistances]
      .map((x) => x.nn)
      .sort((a, b) => a - b);
    const medianNn = sortedNn[Math.floor(sortedNn.length / 2)];
    // Stops with NN distance > 3× median NN are isolated. Clamp absolute
    // threshold to >=500km so we don't flag stops in tight clusters
    // (e.g. a city tour where everyone is <50km apart).
    const isolationThreshold = Math.max(500, medianNn * 3);
    const isolated = nnDistances
      .filter((x) => x.nn > isolationThreshold)
      .map((x) => x.stop);
    if (isolated.length > 0 && isolated.length < inCluster.length - 2) {
      // Move isolated stops into outliers IF removing them leaves at
      // least 3 primary stops (avoid eviscerating short tours).
      const isolatedSet = new Set(isolated);
      const newPrimary = inCluster.filter((s) => !isolatedSet.has(s));
      const newOutside = [...outside, ...isolated];
      return { primary: newPrimary, outliers: newOutside };
    }
  }

  return { primary: inCluster, outliers: outside };
}

/**
 * Build the branded Google Static Maps URL from primary stops.
 *
 * - Size: 640x270 (12:5 aspect; 640 is Static Maps free limit)
 * - Scale: 2 (retina → effective 1280x540)
 * - Markers: soft black pin with white day number (1-9 numeric,
 *   10+ alpha A-Q since Static Maps labels are single-char only)
 * - Path: soft black solid polyline weight 3
 */
function buildStaticMapUrl(primaryStops: Stop[]): string {
  const apiKey = process.env.GOOGLE_API_KEY || "";
  const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
  const params = new URLSearchParams();
  params.set("size", "640x270");
  params.set("scale", "2");
  params.set("maptype", "roadmap");
  for (const s of BRAND_STYLES) params.append("style", s);

  primaryStops.slice(0, 26).forEach((s, i) => {
    const label = i < 9 ? String(i + 1) : String.fromCharCode(65 + i - 9);
    params.append("markers", `color:0x111111|label:${label}|${s.lat},${s.lng}`);
  });
  if (primaryStops.length >= 2) {
    const path = primaryStops.map((s) => `${s.lat},${s.lng}`).join("|");
    params.append("path", `color:0x111111dd|weight:3|${path}`);
  }
  params.set("key", apiKey);
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Build "Open in Google Maps" multi-stop URL (uses ALL stops incl.
 * outliers — the user gets to see the full trip in the Google Maps
 * app, even if the inline preview only renders the primary cluster).
 */
function buildDirectionsUrl(stops: Stop[]): string {
  if (stops.length < 2) {
    return `https://www.google.com/maps/search/?api=1&query=${stops[0].lat},${stops[0].lng}`;
  }
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}`;
  if (stops.length > 2) {
    const waypoints = stops.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join("|");
    url += `&waypoints=${waypoints}`;
  }
  return url;
}

/**
 * Render route map outputs from resolved stops: separates primary
 * cluster from outliers, builds branded static map URL for primaries,
 * and builds directions URL using ALL stops (incl. outliers).
 *
 * Precondition: stops.length >= 1. Callers must handle empty-stops
 * upstream via buildCountryFallbackResult() in fallbacks.ts.
 */
export function renderRouteMap(stops: Stop[]): RenderedRouteMap {
  const { primary, outliers } = clusterStops(stops);
  const staticMapUrl = buildStaticMapUrl(primary);
  const directionsUrl = buildDirectionsUrl(stops);
  return {
    staticMapUrl,
    primaryStops: primary,
    outlierStops: outliers,
    directionsUrl,
  };
}
