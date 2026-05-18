#!/usr/bin/env node
/**
 * fetch-hillshade.mjs — generate a sepia-tinted hillshade PNG for a region.
 *
 * Source: Esri World Hillshade — public XYZ tile service used by ArcGIS
 * Online. Pure terrain shading, no labels, no roads, no political layers
 * — perfect as a background underneath our SVG country/lake/marker stack.
 *
 * Strategy:
 *   1. Convert region bbox → XYZ tile range at the chosen zoom
 *   2. Fetch each tile (256×256 PNG) in parallel
 *   3. Stitch with sharp into one big PNG
 *   4. Crop to the exact bbox pixel rectangle
 *   5. Apply sepia/parchment tint (warm overlay + saturation boost)
 *   6. Save to client/public/hillshade/{slug}.png
 *
 * Usage:
 *   node scripts/fetch-hillshade.mjs switzerland
 *   node scripts/fetch-hillshade.mjs italy 6.5,35.0,18.5,47.5 7
 */

import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

/**
 * Built-in regions. Each entry has a slug, bbox [minLng, minLat, maxLng,
 * maxLat], chosen zoom, and per-region contrast tuning. Zoom 7 covers
 * ~3-7° regions cleanly. For tiny regions (Switzerland-sized), zoom 8
 * gives more terrain detail.
 *
 * v337: each region can override the linear stretch to match Esri's
 * locally-rendered relief intensity. High-relief Alpine areas (e.g.
 * Switzerland) come back from Esri darker by default and don't need
 * aggressive contrast. Low-relief or volcanic regions (Hokkaido,
 * Iceland) come back near-white at zoom 7 — they need strong stretch
 * to surface the mountain shadows.
 */
/**
 * Per-region tone curve config. We empirically sample what L value Esri
 * tiles return for "flat lowland / ocean" (FLAT_L, almost always cream
 * we want to disappear) and the deepest mountain shadow (SHADOW_L).
 * Then we linearly stretch the SHADOW_L..FLAT_L range to 0..225 so:
 *   - peak shadows → deep brown
 *   - flat areas   → ≥225, which snap-to-cream maps to the parchment
 *
 * Sample per-region values come from `curl <tile>` + sharp histogram.
 */
const REGIONS = {
  switzerland: {
    bbox: [5.0, 44.5, 15.0, 49.0],
    zoom: 7,
    tone: { shadowL: 130, flatL: 250 },
  },
  italy: {
    bbox: [6.0, 35.5, 18.5, 47.5],
    zoom: 6,
    tone: { shadowL: 150, flatL: 250 },
  },
  iceland: {
    bbox: [-25.0, 63.0, -13.0, 66.8],
    zoom: 6,
    tone: { shadowL: 170, flatL: 250 },
  },
  japan: {
    bbox: [128.0, 30.0, 146.0, 46.0],
    zoom: 5,
    tone: { shadowL: 180, flatL: 250 },
  },
  hokkaido: {
    bbox: [139.0, 41.0, 146.0, 46.0],
    zoom: 8,
    tone: { shadowL: 197, flatL: 250 },
  },
  // France (Paris + Loire Valley + nearby). Mostly low-relief plains
  // with some hill action near Massif Central — narrow tone band.
  france: {
    bbox: [-2.0, 43.0, 8.0, 51.0],
    zoom: 6,
    tone: { shadowL: 180, flatL: 250 },
  },
  // Central Europe — covers Czechia, Poland, eastern Germany, Slovakia.
  // Carpathian / Sudetes / Tatra mountain ranges.
  central_europe: {
    bbox: [12.0, 47.0, 25.0, 55.0],
    zoom: 6,
    tone: { shadowL: 165, flatL: 250 },
  },
  // Romania + Croatia + ex-Yugoslavia — Carpathians + Dinaric Alps
  balkans: {
    bbox: [13.0, 39.0, 30.0, 49.0],
    zoom: 5,
    tone: { shadowL: 160, flatL: 250 },
  },
  // Peru (Andes + coast). High-relief Andes need shallow shadowL.
  peru: {
    bbox: [-82.0, -19.0, -68.0, 0.0],
    zoom: 5,
    tone: { shadowL: 130, flatL: 250 },
  },
  // PACK&GO is a US-based agency — preemptive coverage of US/Canada/HI
  // for future domestic tours.
  //
  // USA West — Sierra Nevada + Rockies + desert SW. Covers Yosemite,
  // Yellowstone, Grand Canyon, Bryce, Zion, Vegas, LA, SF, Seattle.
  usa_west: {
    bbox: [-125.0, 31.0, -103.0, 50.0],
    zoom: 5,
    tone: { shadowL: 130, flatL: 250 },
  },
  // Hawaii — 4 main islands. Volcanic, lots of relief.
  hawaii: {
    bbox: [-160.5, 18.5, -154.5, 22.5],
    zoom: 7,
    tone: { shadowL: 145, flatL: 250 },
  },
  // Canada West — Rockies (Banff / Jasper / Lake Louise) + BC coast.
  canada_west: {
    bbox: [-128.0, 48.0, -110.0, 60.0],
    zoom: 5,
    tone: { shadowL: 145, flatL: 250 },
  },
  // Norway — fjords + western mountains. High relief.
  norway: {
    bbox: [4.0, 58.0, 25.0, 71.0],
    zoom: 5,
    tone: { shadowL: 150, flatL: 250 },
  },
  // New Zealand — Southern Alps + 2 islands.
  new_zealand: {
    bbox: [165.0, -48.0, 179.0, -34.0],
    zoom: 5,
    tone: { shadowL: 150, flatL: 250 },
  },
};

// Esri's regular "World_Hillshade" — neutral grey-on-white hillshade,
// ocean / flat lowlands render near-white (~245) while mountain shadows
// are darker (~150-180). The Dark variant we tried before INVERTED this
// for ocean (rendered ocean grey too), which broke our "L=255 = lowland"
// LERP assumption.
const TILE_BASE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile";

function lngLatToTile(lng, lat, z) {
  const x = ((lng + 180) / 360) * Math.pow(2, z);
  const y =
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
    Math.pow(2, z);
  return { x, y };
}

/**
 * Inverse — given a tile XY, return the bbox of that tile in lng/lat.
 * Lets us crop the stitched canvas to the exact requested bbox.
 */
function tileToLngLat(x, y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  const lng = (x / Math.pow(2, z)) * 360 - 180;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lng, lat };
}

async function fetchTile(z, x, y) {
  const url = `${TILE_BASE}/${z}/${y}/${x}`;
  const r = await fetch(url, {
    headers: {
      // Some Esri endpoints reject requests without a user agent.
      "User-Agent": "PACK&GO Hillshade Fetcher (jeff@packgo09.com)",
    },
  });
  if (!r.ok) {
    throw new Error(`Tile ${z}/${x}/${y}: HTTP ${r.status}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return buf;
}

async function main() {
  const slug = process.argv[2] || "switzerland";
  const region = REGIONS[slug];
  if (!region) {
    console.error(
      `Unknown region "${slug}". Available: ${Object.keys(REGIONS).join(", ")}`
    );
    process.exit(1);
  }
  const [minLng, minLat, maxLng, maxLat] = region.bbox;
  const zoom = region.zoom;

  console.log(
    `[hillshade] Region "${slug}" bbox=${region.bbox.join(",")} zoom=${zoom}`
  );

  // 1. Compute tile range. We OVER-fetch by 1 tile in each direction so the
  //    final cropped image has clean edges (no gradient cut-off).
  const tlFrac = lngLatToTile(minLng, maxLat, zoom);
  const brFrac = lngLatToTile(maxLng, minLat, zoom);
  const tlX = Math.floor(tlFrac.x);
  const tlY = Math.floor(tlFrac.y);
  const brX = Math.floor(brFrac.x);
  const brY = Math.floor(brFrac.y);
  const tileCols = brX - tlX + 1;
  const tileRows = brY - tlY + 1;
  console.log(
    `[hillshade] Fetching ${tileCols}×${tileRows} = ${tileCols * tileRows} tiles…`
  );

  // 2. Parallel-fetch every tile.
  const tasks = [];
  for (let y = tlY; y <= brY; y++) {
    for (let x = tlX; x <= brX; x++) {
      tasks.push({ x, y });
    }
  }
  const buffers = await Promise.all(
    tasks.map(({ x, y }) =>
      fetchTile(zoom, x, y)
        .then((buf) => ({ x, y, buf }))
        .catch((err) => {
          console.error(
            `[hillshade] Failed ${zoom}/${x}/${y}: ${err.message}`
          );
          // Substitute a neutral grey tile so stitching doesn't break.
          return {
            x,
            y,
            buf: null,
          };
        })
    )
  );

  // 3. Stitch with sharp.
  const tileSize = 256;
  const stitchedW = tileCols * tileSize;
  const stitchedH = tileRows * tileSize;
  const composites = buffers
    .filter((b) => b.buf)
    .map(({ x, y, buf }) => ({
      input: buf,
      top: (y - tlY) * tileSize,
      left: (x - tlX) * tileSize,
    }));
  console.log(
    `[hillshade] Stitching ${composites.length} valid tiles into ${stitchedW}×${stitchedH}…`
  );

  const stitched = await sharp({
    create: {
      width: stitchedW,
      height: stitchedH,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  // 4. Crop to the exact bbox. Compute pixel offsets from the
  //    fractional tile coordinates we computed earlier.
  const cropLeft = Math.round((tlFrac.x - tlX) * tileSize);
  const cropTop = Math.round((tlFrac.y - tlY) * tileSize);
  const cropRight = Math.round((brFrac.x - tlX) * tileSize);
  const cropBottom = Math.round((brFrac.y - tlY) * tileSize);
  const cropW = cropRight - cropLeft;
  const cropH = cropBottom - cropTop;

  console.log(
    `[hillshade] Cropping to ${cropW}×${cropH} (offset ${cropLeft},${cropTop})…`
  );

  const cropped = await sharp(stitched)
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .toBuffer();

  // 5. Light cleanup only — keep PNG as plain greyscale + alpha. The
  //    SVG layer applies the sepia/cream tint via CSS filter so we can
  //    iterate visually without re-running this script.
  //
  //    Pipeline:
  //      a) Greyscale (Esri tiles are slightly blue-grey)
  //      b) Lift shadows so dark valleys don't punch through (linear
  //         slope < 1.0 + small intercept)
  //      c) Tiny blur to soften digital edges
  console.log(`[hillshade] Producing cream-toned hillshade PNG (for SVG multiply)…`);

  // Pipeline (v337b — cream-tinted greyscale, no per-pixel alpha):
  //   a) Greyscale Esri's blue-grey tiles
  //   b) Normalize → per-region linear stretch (config above)
  //   c) Tint as cream-to-brown LERP via per-channel offset (R/G/B)
  //   d) Save as solid RGB. SVG composites with mixBlendMode: multiply
  //      so cream pixels (lowlands & ocean) effectively become "no-op"
  //      against the cream parchment background, while mountain shadows
  //      darken proportionally.
  //
  //  LERP map (greyscale L 0..255 → RGB):
  //    L=0   (peak)    → warm brown #7a5e2e (122,  94,  46)
  //    L=255 (lowland) → cream      #f5e8c8 (245, 232, 200)
  // v338 — per-region tone curve. Linearly map the empirically-sampled
  // SHADOW_L..FLAT_L range to 0..225 (just above the snap threshold).
  // No `.normalize()` — Esri's regular World_Hillshade has a narrow
  // band, and normalize stretches even cream-flat tones into mid-grey,
  // breaking the cream-snap.
  const tone = region.tone || { shadowL: 150, flatL: 250 };
  const TARGET_LOW = 0;
  const TARGET_HIGH = 225;
  const slope = (TARGET_HIGH - TARGET_LOW) / (tone.flatL - tone.shadowL);
  const intercept = TARGET_LOW - slope * tone.shadowL;
  console.log(
    `[hillshade] Tone curve: ${tone.shadowL}→${TARGET_LOW}, ${tone.flatL}→${TARGET_HIGH} (slope=${slope.toFixed(2)}, intercept=${intercept.toFixed(0)})`
  );
  const grey = await sharp(cropped)
    .removeAlpha()
    .greyscale()
    .linear(slope, intercept)
    .blur(0.4)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: gw, height: gh } = grey.info;

  // Per-channel slopes:
  //   R = 122 + (245-122) * L/255 → slope 0.4824, intercept 122
  //   G =  94 + (232- 94) * L/255 → slope 0.5412, intercept  94
  //   B =  46 + (200- 46) * L/255 → slope 0.6039, intercept  46
  //
  //  v337d — snap-to-cream for ocean / flat lowlands. Esri's normalize
  //  pipeline can leave bright pixels at L~210 instead of L=255, which
  //  LERPs to a slightly-tan colour (~234, 207, 173) rather than the
  //  exact cream (#f5e8c8 = 245, 232, 200) of the SVG background. With
  //  normal opacity blending, that mismatch shows as a darker brown
  //  rectangle over ocean. Snap any L ≥ SNAP_THRESHOLD to pure cream
  //  so ocean / flat lowlands become a perfect colour match.
  //
  //  v338: SNAP_THRESHOLD must be just below the new tone-curve
  //  TARGET_HIGH (225). Setting it to 220 means the very brightest
  //  ~30 grades of input map to cream, while 0..219 stay as terrain.
  const SNAP_THRESHOLD = 220;
  const rgb = Buffer.alloc(gw * gh * 3);
  for (let i = 0; i < gw * gh; i++) {
    const L = grey.data[i];
    if (L >= SNAP_THRESHOLD) {
      rgb[i * 3] = 245;
      rgb[i * 3 + 1] = 232;
      rgb[i * 3 + 2] = 200;
    } else {
      rgb[i * 3] = Math.round(122 + 0.4824 * L);
      rgb[i * 3 + 1] = Math.round(94 + 0.5412 * L);
      rgb[i * 3 + 2] = Math.round(46 + 0.6039 * L);
    }
  }

  const tinted = await sharp(rgb, {
    raw: { width: gw, height: gh, channels: 3 },
  })
    .png({ quality: 92, compressionLevel: 9 })
    .toBuffer();

  // 6. Save.
  const outDir = join(PROJECT_ROOT, "client/public/hillshade");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${slug}.png`);
  writeFileSync(outPath, tinted);

  console.log(
    `[hillshade] ✓ Saved ${outPath} (${(tinted.length / 1024).toFixed(0)} KB, ${cropW}×${cropH})`
  );
  console.log(
    `[hillshade] Use bbox in baseMaps.ts: { minLng:${minLng}, maxLng:${maxLng}, minLat:${minLat}, maxLat:${maxLat} }`
  );
}

main().catch((err) => {
  console.error("[hillshade] FATAL:", err);
  process.exit(1);
});
