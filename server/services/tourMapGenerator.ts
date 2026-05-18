/**
 * tourMapGenerator.ts — v331 (Phase A — admin-driven generation).
 *
 * Generates a vintage illustrated travel map for a tour by:
 *   1. Reading the tour's stops + transport segments
 *   2. Composing a region-aware prompt for gpt-image-2
 *   3. Calling `generateImage()` from `_core/imageGen.ts`
 *   4. Uploading the resulting PNG to R2 via `storagePut`
 *   5. Saving the public URL to `tours.aiMapUrl`
 *
 * Caller contract:
 *   const { url, cost, durationMs } = await generateTourMap({ tourId });
 *
 * Cost: ~$0.28 per call (gpt-image-2 high 1792×1024).
 * Duration: ~135-160s.
 */

import { getDb, getTourById } from "../db";
import { tours } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { generateImage } from "../_core/imageGen";
import { storagePut } from "../storage";

interface Stop {
  day: number;
  name: string;
  lat: number;
  lng: number;
}

interface TourMapResult {
  url: string;
  prompt: string;
  cost: number;
  durationMs: number;
}

/**
 * Pull the destination city out of an itinerary day name.
 * Mirrors the logic in TourRouteMapCanvas.tsx — used to label markers.
 */
function extractDestinationCity(name: string): string {
  if (!name) return "";
  const cleaned = name.replace(
    /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
    ""
  );
  const beforeColon = cleaned.split(/[:：]/)[0].trim();
  const parts = beforeColon.split(/\s*(?:→|⇒|↔|⇄|->|=>|>|、|,)\s*/);
  return parts[parts.length - 1]?.trim() || beforeColon;
}

/**
 * Pick a transport mode for a leg based on great-circle distance.
 *   <120 km → bus
 *   120–600 km → train
 *   ≥600 km → plane
 * Same heuristic as TourRouteMapCanvas's transport-segment logic.
 */
function pickTransportMode(km: number): "plane" | "train" | "bus" {
  if (km >= 600) return "plane";
  if (km >= 120) return "train";
  return "bus";
}

function haversineKm(a: Stop, b: Stop): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function estimateDurationText(km: number, mode: "plane" | "train" | "bus"): string {
  const speed = mode === "plane" ? 750 : mode === "train" ? 100 : 60;
  const overhead = mode === "plane" ? 1.5 : 0;
  const baseH = km / speed + overhead;
  const lower = Math.max(0.5, Math.round((baseH - 0.25) * 2) / 2);
  const upper = Math.max(lower + 0.5, Math.round((baseH + 0.25) * 2) / 2);
  const fmt = (h: number) => (h % 1 === 0 ? `${h}` : `${h}`);
  return upper === lower ? `約 ${fmt(lower)} 小時` : `約 ${fmt(lower)}-${fmt(upper)} 小時`;
}

/**
 * Detect which "region" the tour falls into so we can use a base-style
 * prompt tuned for that part of the world. For now we hand-write a few
 * regions — over time this expands as more tours go through the
 * pipeline.
 */
function detectRegion(stops: Stop[], destinationCountry: string): string {
  const country = destinationCountry || "";
  if (
    country.includes("瑞士") ||
    country.includes("Switzerland") ||
    country.includes("奧地利") ||
    country.includes("Austria")
  ) {
    return "alpine_europe";
  }
  if (country.includes("冰島") || country.includes("Iceland")) return "iceland";
  if (
    country.includes("義大利") ||
    country.includes("意大利") ||
    country.includes("Italy")
  ) {
    return "italy";
  }
  if (country.includes("日本") || country.includes("Japan")) return "japan";
  if (country.includes("北海道") || country.includes("Hokkaido")) {
    return "japan_hokkaido";
  }
  return "generic";
}

/**
 * Build the gpt-image-2 prompt for a given region. Each region gets a
 * tailored "BASE MAP STYLE" block; the markers + routes + decorations
 * blocks are filled in by `composeFullPrompt` from the tour data.
 */
function regionStylePrompt(region: string): string {
  switch (region) {
    case "alpine_europe":
      return `
═══════════════════════════════════════════════════
BASE MAP STYLE (the painted background)
═══════════════════════════════════════════════════
- Cream parchment background (#f5e8c8 to #e8d3a0), subtle paper grain
- Country borders soft brown ink, slightly dashed/imperfect feel
- Subtle hand-drawn hillshade ONLY in the Alpine region (southern
  Switzerland, Austria, northern Italy). Northern lowlands stay flat cream.
- Light blue lakes (#cfe5f0): Lake Geneva (日內瓦湖), Lake Zurich (蘇黎世湖),
  Lake Constance (博登湖), Lake Lucerne (盧森湖), Lake Thun (圖恩湖),
  Lake Brienz (布里恩茨湖). Lake names in light blue serif.
- Light blue rivers: Rhine (萊茵河) flowing north, Danube (多瑙河) east-west.
- Country labels in elegant grey-brown serif Traditional Chinese:
  「德國」(top), 「法國」(left), 「義大利」(bottom),
  「奧地利」(right), 「瑞士」(center, larger and most prominent).`.trim();

    case "italy":
      return `
═══════════════════════════════════════════════════
BASE MAP STYLE (the painted background)
═══════════════════════════════════════════════════
- Cream parchment background (#f5e8c8 to #e8d3a0), subtle paper grain
- Country borders soft brown ink, slightly dashed
- Subtle hillshade in the Apennine mountains running down the spine of
  Italy and the Alps in the north. Coastal lowlands stay flat cream.
- Light blue Mediterranean / Adriatic / Tyrrhenian seas surround Italy.
- Major lakes: Lake Como (科莫湖), Lake Garda (加爾達湖),
  Lake Maggiore (馬吉奧雷湖). Light blue.
- Major rivers: Po (波河) east-west across the north, Tiber (台伯河)
  through Rome, Arno (阿諾河) through Tuscany.
- Country labels in elegant grey-brown serif Traditional Chinese:
  「義大利」(center, large and prominent), 「法國」(top-left),
  「瑞士」(top), 「奧地利」(top-right), 「斯洛維尼亞」(top-right-corner).`.trim();

    case "iceland":
      return `
═══════════════════════════════════════════════════
BASE MAP STYLE (the painted background)
═══════════════════════════════════════════════════
- Cream parchment background (#f5e8c8 to #e8d3a0), subtle paper grain
- Country border around Iceland soft brown ink.
- Bold hillshade across central Iceland (highlands + glaciers — Vatnajökull,
  Langjökull, Hofsjökull). Subtle volcanic shading.
- North Atlantic Ocean (light blue) surrounds the island on all sides.
- Country label「冰島」in elegant grey-brown serif Traditional Chinese,
  centered prominently. No neighboring countries needed (it's an island).
- A small distance scale and a ring road hint (Route 1) are OK but not required.`.trim();

    case "japan":
    case "japan_hokkaido":
      return `
═══════════════════════════════════════════════════
BASE MAP STYLE (the painted background)
═══════════════════════════════════════════════════
- Cream parchment background (#f5e8c8 to #e8d3a0), subtle paper grain
- Coastline soft brown ink, slightly hand-drawn imperfection.
- Subtle hillshade along the spine of each island (Japanese Alps,
  Hakkoda, Daisetsuzan). Coastal plains flat cream.
- Light blue surrounding seas (太平洋 Pacific east, 日本海 Sea of Japan
  west). Minimal lake/river labels — too small at country scale.
- Country label「日本」in elegant grey-brown serif Traditional Chinese,
  prominently centered. If Hokkaido tour, add「北海道」label as well.`.trim();

    default:
      return `
═══════════════════════════════════════════════════
BASE MAP STYLE (the painted background)
═══════════════════════════════════════════════════
- Cream parchment background (#f5e8c8 to #e8d3a0), subtle paper grain
- Country borders soft brown ink, slightly dashed.
- Subtle hillshade in mountainous regions, flat cream in lowlands.
- Light blue water bodies (seas / lakes / major rivers).
- Country labels in elegant grey-brown serif Traditional Chinese,
  prominent for the destination country and lighter for neighbors.`.trim();
  }
}

/**
 * Compose the full prompt: base style + day markers + transport
 * segments + decorative elements.
 */
function composeFullPrompt(args: {
  duration: number;
  destinationCountry: string;
  stops: Stop[];
  outliers: Stop[];
}): string {
  const { duration, destinationCountry, stops, outliers } = args;
  const region = detectRegion(stops, destinationCountry);
  const baseStyle = regionStylePrompt(region);

  // De-duplicate same-coord stops so Day 1/8 gets one combined dot
  // (matching how the SVG renderer handles repeats).
  const uniq: Array<{ days: number[]; stop: Stop }> = [];
  for (const s of stops) {
    const hit = uniq.find(
      (u) => Math.abs(u.stop.lat - s.lat) < 0.05 && Math.abs(u.stop.lng - s.lng) < 0.05
    );
    if (hit) hit.days.push(s.day);
    else uniq.push({ days: [s.day], stop: s });
  }

  const markerLines = uniq.map(({ days, stop }) => {
    const city = extractDestinationCity(stop.name);
    const dayLabel = days.length === 1 ? `Day ${days[0]}` : `Day ${days.join("/")}`;
    return `  ${dayLabel} — ${city} (${stop.lat.toFixed(2)}°N, ${stop.lng.toFixed(2)}°E)`;
  });

  const segLines: string[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (from.lat === to.lat && from.lng === to.lng) continue;
    const km = haversineKm(from, to);
    const mode = pickTransportMode(km);
    const modeLabel = mode === "plane" ? "plane icon ✈" : mode === "train" ? "train icon 🚂" : "bus icon 🚌";
    const durationText = estimateDurationText(km, mode);
    segLines.push(
      `  D${from.day}→D${to.day}: ${modeLabel}, "${from.day}→${to.day} 天 · ${durationText}"`
    );
  }

  const outlierFooter = outliers
    .map((o) => {
      const city = extractDestinationCity(o.name);
      return `第 ${o.day} 天 ${city}`;
    })
    .join(" · ");

  return `
Generate a vintage illustrated travel map for a ${duration}-day ${destinationCountry} tour.

${baseStyle}

═══════════════════════════════════════════════════
DAY MARKERS — red circles with white day numbers, ONE per stop
═══════════════════════════════════════════════════
Place a small red circle (#c1272d, 28-32px diameter) with a white serif
number inside, at each city's location. Below the marker, write the
city name in bold black serif Traditional Chinese with a thin white
text-outline for legibility:

${markerLines.join("\n")}

The Day 1 marker gets a subtle gold halo ring around it (entry point).
Multi-day cities (e.g. "Day 1/8") show "1/8" inside the same circle.

═══════════════════════════════════════════════════
ROUTE LINES — warm sepia brown connecting markers in day order
═══════════════════════════════════════════════════
Draw curved brown ink lines (#6b3f1d, ~2px, slightly hand-drawn feel)
connecting each consecutive day. Lines should bow gently like vintage
travel-magazine route paths, NOT straight. The final segment gets a
small arrowhead on its tail.

═══════════════════════════════════════════════════
TRANSPORT ICONS + TIME LABELS at each segment midpoint
═══════════════════════════════════════════════════
At the midpoint of each route segment, draw a small white-cream circle
(20px) containing a tiny brown glyph for the transport mode, plus a
small white rounded rectangle next to it with the duration:

${segLines.join("\n")}

Time labels in tiny black serif Traditional Chinese inside the white pill.

═══════════════════════════════════════════════════
DECORATIVE ELEMENTS — match vintage travel-map convention
═══════════════════════════════════════════════════
- BOTTOM-LEFT corner: tiny legend with two rows in a small white
  rounded box with brown border:
    🚂 火車路線
    🚌 巴士路線
- BOTTOM-CENTER under map: italic gray small print:
    "* 行車時間為概估,實際依班次、季節與交通狀況而定。"
- BOTTOM-RIGHT corner: tiny world inset (60×40px) with the destination
  highlighted as a small red dot, in a thin-bordered white box.${
    outlierFooter
      ? `\n- BOTTOM-LEFT under map: small note "✈ ${outlierFooter}"`
      : ""
  }

═══════════════════════════════════════════════════
CRITICAL DO-NOT
═══════════════════════════════════════════════════
- NO English city names — Traditional Chinese only.
- NO arbitrary cities other than the days listed above.
- NO scale bar, NO compass rose, NO ornamental frame.
- NO simplified Chinese.

DIMENSIONS: 1792×1024 landscape, magazine-illustration quality.
`.trim();
}

/**
 * Main entry — generate (or regenerate) a tour map.
 *
 * @param tourId  primary key in `tours` table
 * @returns       new public URL + prompt + cost + duration
 */
export async function generateTourMap(args: {
  tourId: number;
}): Promise<TourMapResult> {
  const { tourId } = args;

  // 1. Load tour from DB.
  const tour = await getTourById(tourId);
  if (!tour) {
    throw new Error(`Tour ${tourId} not found`);
  }

  // 2. Pull stops + outliers via the existing tRPC `tours.getRouteMap`
  //    endpoint — that already does Google/Nominatim geocoding plus the
  //    outlier-cluster split logic, so we don't have to re-implement
  //    any of it here.
  const { appRouter } = await import("../routers");
  const caller = appRouter.createCaller({
    req: {} as any,
    res: {} as any,
    user: null,
    ip: "internal",
  } as any);
  const routeData = await caller.tours.getRouteMap({ id: tourId });
  const stops = (routeData?.stops ?? []) as Stop[];
  const outliers = ((routeData as any)?.outliers ?? []) as Stop[];

  if (stops.length < 2) {
    throw new Error(
      `Tour ${tourId} has only ${stops.length} mapped stops — at least 2 needed`
    );
  }

  // 3. Compose the prompt.
  const prompt = composeFullPrompt({
    duration: tour.duration,
    destinationCountry: tour.destinationCountry || "",
    stops,
    outliers,
  });

  // 4. Call gpt-image-2.
  console.log(
    `[tourMapGen] Generating map for tour ${tourId} (${tour.duration}-day ${tour.destinationCountry})…`
  );
  const result = await generateImage({
    prompt,
    size: "1792x1024",
    quality: "high",
    timeoutMs: 240_000,
  });

  // 5. Upload to R2.
  const fileName = `tour-maps/tour-${tourId}-${Date.now()}.png`;
  const { url } = await storagePut(fileName, result.imageBuffer, "image/png");

  // 6. Persist the URL + prompt + timestamp.
  const db = await getDb();
  await db
    .update(tours)
    .set({
      aiMapUrl: url,
      aiMapPrompt: prompt,
      aiMapGeneratedAt: new Date(),
    })
    .where(eq(tours.id, tourId));

  console.log(
    `[tourMapGen] ✓ Tour ${tourId} map saved: ${url} (${result.durationMs}ms, $${result.cost.toFixed(3)})`
  );

  return {
    url,
    prompt,
    cost: result.cost,
    durationMs: result.durationMs,
  };
}
