#!/usr/bin/env node
/**
 * test-basemap-gen.mjs — generate a Switzerland base map via gpt-image-2
 * to compare against Jeff's reference photo.
 *
 * Usage (locally with key):
 *   OPENAI_API_KEY=sk-... node scripts/test-basemap-gen.mjs
 *
 * Usage (on Fly where the key already lives):
 *   fly ssh sftp shell <<< 'put scripts/test-basemap-gen.mjs /tmp/'
 *   fly ssh console -C 'node /tmp/test-basemap-gen.mjs'
 *   fly ssh sftp shell <<< 'get /tmp/basemap-switzerland.png'
 *
 * What it does:
 *   1. Calls openai.images.generate with a curated Switzerland base-map
 *      prompt (NO cities, NO routes, NO markers — pure base-layer art).
 *   2. Saves the b64 result as /tmp/basemap-switzerland.png.
 *   3. Logs cost + duration so we can decide if the API approach scales
 *      (one base map per "region" = ~30 base maps total at $0.07 each).
 */

import OpenAI from "openai";
import { writeFileSync } from "node:fs";

/**
 * Jeff's web-generated prompt — produced the best result so far.
 * Key insights vs the original:
 *   • Specifies country LABEL POSITIONS (top/left/bottom/right/center)
 *     so the model lays out the map predictably.
 *   • Names every lake AND river in Chinese explicitly — model paints
 *     them where they belong with correct labels.
 *   • Says "flat cream" for non-Alpine regions to suppress noise hills.
 */
const PROMPT = `
Generate a vintage illustrated travel map in 1456×1024 dimensions,
showing Switzerland and surrounding countries (Germany, France, Italy, Austria).

STYLE:
- Cream parchment background (#f5e8c8 to #e8d3a0)
- Subtle hillshade ONLY in Alpine regions (southern Switzerland)
- Northern Germany / France should be flat cream
- Soft brown country borders
- Country labels in elegant grey serif Chinese typography:
  「德國」(top), 「法國」(left), 「義大利」(bottom),
  「奧地利」(right), 「瑞士」(center, larger and more prominent)
- Light blue lakes (#cfe5f0):
  Lake Geneva (日內瓦湖), Lake Zurich (蘇黎世湖),
  Lake Constance (博登湖), Lake Lucerne (盧森湖),
  Lake Thun (圖恩湖), Lake Brienz (布里恩茨湖)
- Light blue rivers (萊茵河 going north from Switzerland,
  多瑙河 across southern Germany)
- Lake/river names in light blue serif

CRITICAL — DO NOT INCLUDE:
- NO cities or city names
- NO roads
- NO markers, dots, pins, or numbers
- NO route lines
- NO time labels
- NO travel info
- NO legend, NO inset map
- NO airport icons

This is a CLEAN base map for overlay purposes.
`.trim();

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: OPENAI_API_KEY env var not set.");
    process.exit(1);
  }

  const client = new OpenAI({ apiKey });
  const start = Date.now();

  console.log("[basemap-gen] Calling gpt-image-2 with Switzerland prompt…");
  console.log(`[basemap-gen] Prompt length: ${PROMPT.length} chars`);

  let response;
  try {
    response = await client.images.generate(
      {
        model: "gpt-image-2",
        prompt: PROMPT,
        size: "1792x1024",
        quality: "high",
        n: 1,
      },
      { timeout: 240_000 }
    );
  } catch (err) {
    console.error("[basemap-gen] API call failed:", err.message);
    if (err.status) console.error("HTTP status:", err.status);
    process.exit(1);
  }

  const item = response?.data?.[0];
  if (!item?.b64_json) {
    console.error("[basemap-gen] No image data returned (content-policy refusal?)");
    console.error("Response keys:", Object.keys(response || {}));
    process.exit(1);
  }

  const buffer = Buffer.from(item.b64_json, "base64");
  const outPath = "/tmp/basemap-switzerland-v2.png";
  writeFileSync(outPath, buffer);

  const durationMs = Date.now() - start;
  // gpt-image-2 high 1792x1024 ≈ $0.167 × 1.7 ≈ $0.28
  const estimatedCost = 0.167 * 1.7;

  console.log(`\n[basemap-gen] ✓ DONE`);
  console.log(`  saved:    ${outPath}`);
  console.log(`  size:     ${(buffer.length / 1024).toFixed(0)} KB`);
  console.log(`  duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  ~cost:    $${estimatedCost.toFixed(2)}`);
  console.log(`\nNext: compare ${outPath} side-by-side with Jeff's reference photo.`);
}

main().catch((err) => {
  console.error("[basemap-gen] Fatal:", err);
  process.exit(1);
});
