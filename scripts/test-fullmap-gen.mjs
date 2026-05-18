#!/usr/bin/env node
/**
 * test-fullmap-gen.mjs — generate a COMPLETE tour map (base + markers
 * + routes + transport icons + time labels) via gpt-image-2 in ONE
 * call. Per Jeff's direction: AI does the whole map, no SVG overlay.
 *
 * Tests with tour 990015 — Switzerland 8-day with Munich entry/exit.
 *
 * Usage on Fly:
 *   sftp put scripts/test-fullmap-gen.mjs /app/scripts/
 *   fly ssh console -C "/usr/bin/env sh -c 'cd /app && node scripts/test-fullmap-gen.mjs'"
 *   sftp get /tmp/fullmap-switzerland.png
 */

import OpenAI from "openai";
import { writeFileSync } from "node:fs";

const PROMPT = `
Generate a vintage illustrated travel map for an 8-day Switzerland tour.

═══════════════════════════════════════════════════
BASE MAP STYLE (this is the painted background)
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
  「奧地利」(right), 「瑞士」(center, larger and most prominent).

═══════════════════════════════════════════════════
DAY MARKERS — red circles with white day numbers, ONE per stop
═══════════════════════════════════════════════════
Place a small red circle (#c1272d, 28-32px diameter) with a white serif
number inside, at each city's location. Below the marker, write the
city name in bold black serif Traditional Chinese with a thin white
text-outline for legibility:

  Day 1 — 慕尼黑 (Munich, Germany — eastern part of map, 48.13°N, 11.58°E)
  Day 2 — 蘇黎世 (Zurich, Switzerland — north, 47.38°N, 8.54°E)
  Day 3 — 伯恩 (Bern, Switzerland — west-center, 46.95°N, 7.45°E)
  Day 4 — 蒙投 (Montreux, Switzerland — southwest near Lake Geneva, 46.43°N, 6.91°E)
  Day 5 — 冰河3000 (Glacier 3000, Switzerland — south, 46.35°N, 7.21°E)
  Day 6 — 策馬特 (Zermatt, Switzerland — south, 46.19°N, 7.54°E)
  Day 7 — 盧森 (Lucerne, Switzerland — central, 47.05°N, 8.31°E)
  Day 8 — back to 慕尼黑 (same as Day 1)

The Day 1 marker gets a subtle gold halo ring around it (entry point).

═══════════════════════════════════════════════════
ROUTE LINES — warm sepia brown connecting markers in day order
═══════════════════════════════════════════════════
Draw curved brown ink lines (#6b3f1d, ~2px, slightly hand-drawn feel)
connecting Day 1→2→3→4→5→6→7→8 (back to Munich). Lines should bow
gently like vintage travel-magazine route paths, NOT straight.
The final segment (Day 8) gets a small arrowhead on its tail.

═══════════════════════════════════════════════════
TRANSPORT ICONS + TIME LABELS at each segment midpoint
═══════════════════════════════════════════════════
At the midpoint of each route segment, draw a small white-cream circle
(20px) containing a tiny brown glyph for the transport mode, plus a
small white rounded rectangle next to it with the duration:

  D1→D2 (Munich→Zurich):       train icon, "1→2 天 · 約 2-2.5 小時"
  D2→D3 (Zurich→Bern):         train icon, "2→3 天 · 約 1.5-2 小時"
  D3→D4 (Bern→Montreux):       train icon, "3→4 天 · 約 1-1.5 小時"
  D4→D5 (Montreux→Glacier):    bus icon,   "4→5 天 · 約 0.5-1 小時"
  D5→D6 (Glacier→Zermatt):     bus icon,   "5→6 天 · 約 0.5-1 小時"
  D6→D7 (Zermatt→Lucerne):     train icon, "6→7 天 · 約 1.5-2 小時"
  D7→D8 (Lucerne→Munich):      train icon, "7→8 天 · 約 2.5-3 小時"

Time labels in tiny black serif Traditional Chinese inside the white pill.

═══════════════════════════════════════════════════
DECORATIVE ELEMENTS — match vintage travel-map convention
═══════════════════════════════════════════════════
- BOTTOM-LEFT corner: tiny legend with two rows:
    🚂 火車路線
    🚌 巴士路線
  In a small white rounded box with brown border.
- BOTTOM-CENTER under map: italic gray small print:
    "* 行車時間為概估,實際依班次、季節與交通狀況而定。"
- BOTTOM-RIGHT corner: tiny world inset (60×40px) with Switzerland
  highlighted as a small red dot, in a thin-bordered white box.
- BOTTOM-LEFT under map: small note "✈ 第 9 天 慕尼黑→台北 · 第 10 天 台北"

═══════════════════════════════════════════════════
CRITICAL DO-NOT
═══════════════════════════════════════════════════
- NO English city names — Traditional Chinese only.
- NO arbitrary cities other than the 8 listed above.
- NO duplicated markers (Munich appears at Day 1 AND Day 8 — same dot,
  show "1/8" inside the circle).
- NO scale bar, NO compass rose, NO ornamental frame.
- NO simplified Chinese.

DIMENSIONS: 1792×1024 landscape, magazine-illustration quality.
`.trim();

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: OPENAI_API_KEY env var not set.");
    process.exit(1);
  }

  const client = new OpenAI({ apiKey });
  const start = Date.now();

  console.log("[fullmap-gen] Calling gpt-image-2 with FULL tour prompt…");
  console.log(`[fullmap-gen] Prompt length: ${PROMPT.length} chars`);

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
    console.error("[fullmap-gen] API call failed:", err.message);
    if (err.status) console.error("HTTP status:", err.status);
    process.exit(1);
  }

  const item = response?.data?.[0];
  if (!item?.b64_json) {
    console.error("[fullmap-gen] No image data returned");
    console.error("Response keys:", Object.keys(response || {}));
    process.exit(1);
  }

  const buffer = Buffer.from(item.b64_json, "base64");
  const outPath = "/tmp/fullmap-switzerland.png";
  writeFileSync(outPath, buffer);

  const durationMs = Date.now() - start;
  const estimatedCost = 0.167 * 1.7;

  console.log(`\n[fullmap-gen] ✓ DONE`);
  console.log(`  saved:    ${outPath}`);
  console.log(`  size:     ${(buffer.length / 1024).toFixed(0)} KB`);
  console.log(`  duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  ~cost:    $${estimatedCost.toFixed(2)}`);
}

main().catch((err) => {
  console.error("[fullmap-gen] Fatal:", err);
  process.exit(1);
});
