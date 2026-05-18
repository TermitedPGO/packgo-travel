#!/usr/bin/env node
/**
 * Round 80.16: Full AI generation pipeline test.
 *
 * 1. Connects to production DB to find existing Lion Travel sourceUrls
 * 2. Searches Lion for 5 NEW URLs not yet in our DB (across varied destinations)
 * 3. Submits each via prod tRPC API (admin auth via JWT)
 * 4. Polls each generation until done (BullMQ may serialize → ~5-10 min total)
 * 5. Reads back the generated tours
 * 6. Inspects each: 人數 / 報名時間 / 內容 / 飯店 / 地點
 * 7. Writes markdown report to docs/round-80.16-pipeline-test-{timestamp}.md
 *
 * Usage:
 *   JWT_SECRET=... DATABASE_URL=mysql://... node scripts/full-pipeline-test.mjs
 *
 * The secrets can be sourced from `flyctl ssh console -C 'printenv JWT_SECRET'`
 * etc, OR exported in the calling shell.
 */
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import fs from "fs/promises";
import path from "path";

const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.BASE_URL || "https://packgoplay.com";
const COOKIE_NAME = "app_session_id";
// Round 80.16 v2: prod admin id is 1 (Jeff). 630001 was dev convention.
const ADMIN_USER_ID = parseInt(process.env.ADMIN_USER_ID || "1", 10);

if (!JWT_SECRET || !DATABASE_URL) {
  console.error(
    "[FATAL] Missing required env: JWT_SECRET / DATABASE_URL.\n" +
      "  Run:  JWT_SECRET=... DATABASE_URL=... node scripts/full-pipeline-test.mjs"
  );
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function adminToken() {
  return jwt.sign(
    {
      userId: ADMIN_USER_ID,
      email: "jeffhsieh09@gmail.com",
      role: "admin",
      name: "Jeff Hsieh",
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

async function trpcMutate(procedure, input, token) {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({ json: input }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`tRPC mutate ${procedure}: ${JSON.stringify(data.error)}`);
  return data.result?.data?.json;
}

async function trpcQuery(procedure, input, token) {
  const url = `${BASE_URL}/api/trpc/${procedure}?input=${encodeURIComponent(
    JSON.stringify({ json: input })
  )}`;
  const resp = await fetch(url, {
    headers: token ? { Cookie: `${COOKIE_NAME}=${token}` } : {},
  });
  const data = await resp.json();
  if (data.error) throw new Error(`tRPC query ${procedure}: ${JSON.stringify(data.error)}`);
  return data.result?.data?.json;
}

const LION_BASE = "https://travel.liontravel.com";

async function fetchLionSitemapNormGroupIds() {
  const sitemapResp = await fetch(`${LION_BASE}/sitemap.xml`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15000),
  });
  const indexXml = await sitemapResp.text();
  const childUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
  const allIds = new Set();
  for (const childUrl of childUrls.slice(0, 5)) {
    try {
      const r = await fetch(childUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(20000),
      });
      const xml = await r.text();
      for (const m of xml.matchAll(/NormGroupID=([a-f0-9-]{36})/gi)) {
        allIds.add(m[1].toLowerCase());
      }
    } catch {}
  }
  return [...allIds];
}

async function verifyAndDescribe(normGroupId) {
  try {
    const resp = await fetch(`${LION_BASE}/detail/travelinfojson`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
        Referer: `${LION_BASE}/detail?NormGroupID=${normGroupId}`,
      },
      body: new URLSearchParams({ NormGroupID: normGroupId }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const gi = data?.GroupInfo ?? {};
    if (!gi.GroupID) return null;
    return {
      normGroupId,
      groupId: gi.GroupID,
      tourName: gi.TourName || gi.NormGroup || "Unknown",
      days: gi.TourDays || 0,
      goDate: gi.GoDate || "",
      backDate: gi.BackDate || "",
      price: gi.StraightLowestPrice || 0,
      currency: gi.CurrencyCode || "TWD",
      country: gi.Country || "",
      totalSeats: gi.TotalSeats || 0,
      spareSeats: gi.SpareSeats || 0,
      url: `${LION_BASE}/detail?NormGroupID=${normGroupId}&GroupID=${gi.GroupID}&Platform=APP`,
    };
  } catch {
    return null;
  }
}

// ── Stage 1: Find existing source URLs in our DB ─────────────────────────────

console.log("[Stage 1] Connecting to production DB...");
const conn = await mysql.createConnection(DATABASE_URL);
const [rows] = await conn.execute(
  "SELECT id, sourceUrl, destinationCountry FROM tours WHERE sourceUrl LIKE '%liontravel%'"
);
const existingNormGroupIds = new Set();
for (const r of rows) {
  const m = r.sourceUrl?.match(/NormGroupID=([a-f0-9-]{36})/i);
  if (m) existingNormGroupIds.add(m[1].toLowerCase());
}
console.log(
  `[Stage 1] DB has ${rows.length} liontravel tours, ${existingNormGroupIds.size} unique NormGroupIDs.`
);
await conn.end();

// ── Stage 2: Find 5 NEW Lion URLs from sitemap, varied destinations ──────────

console.log("\n[Stage 2] Pulling Lion sitemap to find new URLs...");
const allLionIds = await fetchLionSitemapNormGroupIds();
console.log(`  sitemap exposed ${allLionIds.length} NormGroupIDs total`);
const newIds = allLionIds.filter((id) => !existingNormGroupIds.has(id));
console.log(`  ${newIds.length} are NEW (not in our DB)`);

// Shuffle for variety, then verify in order. Round 80.16 v2: relaxed dedupe
// — sitemap is heavily TW-skewed, so capping at 2/country lets us still get 5
// candidates while preserving some variety.
const shuffled = newIds.slice().sort(() => Math.random() - 0.5);
const candidates = [];
const countryCount = new Map();
const MAX_PER_COUNTRY = parseInt(process.env.MAX_PER_COUNTRY || "2", 10);
let scanned = 0;
const SCAN_LIMIT = 200;
for (const ngId of shuffled) {
  if (candidates.length >= 5) break;
  if (scanned > SCAN_LIMIT) break;
  scanned++;
  const desc = await verifyAndDescribe(ngId);
  if (!desc) continue;
  const c = desc.country || "??";
  if ((countryCount.get(c) || 0) >= MAX_PER_COUNTRY) continue;
  countryCount.set(c, (countryCount.get(c) || 0) + 1);
  candidates.push({ ...desc, label: c });
  console.log(
    `  ✓ candidate ${candidates.length}/5: [${c}] ${desc.tourName.substring(0, 50)} (${desc.days}天)`
  );
  await new Promise((r) => setTimeout(r, 200));
}

if (candidates.length < 5) {
  console.warn(
    `[Stage 2] WARNING: only found ${candidates.length} new candidates after ${scanned} scans. Continuing.`
  );
}

console.log("\n[Stage 2] Selected:");
candidates.forEach((c, i) =>
  console.log(
    `  ${i + 1}. [${c.label}] ${c.tourName.substring(0, 50)}... (${c.days}天, ${c.price} ${c.currency})`
  )
);

// ── Stage 3: Submit + poll generations ───────────────────────────────────────

console.log("\n[Stage 3] Submitting AI generations + polling...");
const token = adminToken();
const generationResults = [];

for (let i = 0; i < candidates.length; i++) {
  const cand = candidates[i];
  console.log(`\n[Gen ${i + 1}/${candidates.length}] Submitting: ${cand.url}`);
  const t0 = Date.now();
  let jobId;
  try {
    const submitResult = await trpcMutate(
      "tours.submitAsyncGeneration",
      // Round 80.16 v3: isPdf defaults to true in the schema. We're feeding
      // Lion detail page URLs (not PDFs) → must pass isPdf: false explicitly,
      // otherwise the worker tries to parse the URL as a PDF and fails with
      // "Failed to analyze PDF with LLM".
      { url: cand.url, forceRegenerate: false, isPdf: false },
      token
    );
    jobId = submitResult?.jobId;
    if (!jobId) {
      console.error(`  ✗ submit returned no jobId:`, submitResult);
      generationResults.push({ ...cand, error: "no jobId returned" });
      continue;
    }
    console.log(`  → jobId: ${jobId}`);
  } catch (err) {
    console.error(`  ✗ submit threw:`, err.message);
    generationResults.push({ ...cand, error: err.message });
    continue;
  }

  // Poll
  let status;
  let polls = 0;
  const maxPolls = 60; // 60 × 5s = 5 min per gen
  while (polls < maxPolls) {
    await new Promise((r) => setTimeout(r, 5000));
    polls++;
    try {
      status = await trpcQuery(
        "tours.getGenerationStatus",
        { jobId },
        token
      );
      // Round 80.16 v3: actual response shape is `{ status, progress, result, ... }`
      // — not `{ state, currentPhase }`. Fixed field names so we don't poll
      // forever when the job has already completed.
      const jobStatus = status?.status || "unknown";
      const progress = status?.progress ?? 0;
      const phase = status?.progressDetails?.step || jobStatus;
      process.stdout.write(`\r  poll ${polls}/${maxPolls}: status=${jobStatus} phase=${phase} progress=${progress}%`);
      if (jobStatus === "completed" || jobStatus === "failed") {
        process.stdout.write("\n");
        break;
      }
    } catch (err) {
      process.stdout.write("\n");
      console.warn(`  poll error: ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  // Round 80.16 v3: status field is `status` (not `state`); job's actual
  // success/failure lives in `status.result.success` (because the worker
  // returns { success, savedTourId, error } even when the BullMQ job state
  // is "completed").
  const jobOk = status?.status === "completed" && status?.result?.success;
  if (jobOk) {
    console.log(`  ✓ generation completed in ${elapsed}s — savedTourId=${status.result?.tourId}`);
    generationResults.push({
      ...cand,
      jobId,
      savedTourId: status.result?.tourId,
      elapsedSec: parseFloat(elapsed),
      phase: "completed",
    });
  } else {
    const err = status?.result?.error || status?.failedReason || status?.status || "timeout";
    console.log(`  ✗ generation failed (${err}) after ${elapsed}s`);
    generationResults.push({
      ...cand,
      jobId,
      elapsedSec: parseFloat(elapsed),
      error: err,
      phase: status?.progressDetails?.step,
    });
  }
}

// ── Stage 4: Inspect generated tours ─────────────────────────────────────────

console.log("\n[Stage 4] Inspecting generated tours from DB...");
const conn2 = await mysql.createConnection(DATABASE_URL);
const inspection = [];

for (const g of generationResults) {
  if (!g.savedTourId) {
    inspection.push({ ...g, missing: true });
    continue;
  }
  const [tourRows] = await conn2.execute(
    `SELECT id, title, destinationCountry, destinationCity,
            departureCountry, departureCity, departureAirportCode,
            destinationAirportCode, productCode, duration, nights,
            price, basePrice, currency, maxParticipants,
            highlights, includes, excludes, notices, sourceUrl,
            status, featured, isAutoGenerated,
            calibrationVerdict, calibrationScore,
            heroImage, imageUrl, itineraryDetailed, costExplanation,
            startDate, endDate, createdAt
     FROM tours WHERE id = ?`,
    [g.savedTourId]
  );
  const tour = tourRows[0];

  // Departures
  const [depRows] = await conn2.execute(
    `SELECT departureDate, returnDate, totalSeats, availableSeats, price, status
     FROM tourDepartures WHERE tourId = ? ORDER BY departureDate LIMIT 10`,
    [g.savedTourId]
  );

  // Hotels (if hotelInfo column exists — fall back gracefully)
  let hotels = [];
  try {
    const [hotelRows] = await conn2.execute(
      "SELECT name, city, day FROM tourHotels WHERE tourId = ? ORDER BY day LIMIT 20",
      [g.savedTourId]
    );
    hotels = hotelRows;
  } catch {
    // table may not exist, try alternative
    if (tour?.itineraryDetailed) {
      try {
        const itinerary = JSON.parse(tour.itineraryDetailed);
        hotels = itinerary
          .filter((d) => d.accommodation || d.hotelName)
          .map((d) => ({ day: d.day, name: d.accommodation || d.hotelName }));
      } catch {}
    }
  }

  // Itinerary details
  let itinerarySummary = "[]";
  let itineraryDayCount = 0;
  if (tour?.itineraryDetailed) {
    try {
      const it = JSON.parse(tour.itineraryDetailed);
      itineraryDayCount = it.length;
      itinerarySummary = it
        .slice(0, 3)
        .map(
          (d) =>
            `Day ${d.day}: ${(d.title || d.travelPoint || d.description || "").substring(0, 60)}`
        )
        .join(" | ");
    } catch {}
  }

  // Cost details
  let costSummary = { included: 0, excluded: 0 };
  if (tour?.costExplanation) {
    try {
      const cost = JSON.parse(tour.costExplanation);
      costSummary = {
        included: (cost.includes || []).length,
        excluded: (cost.excludes || []).length,
      };
    } catch {}
  }

  inspection.push({
    ...g,
    tour,
    departures: depRows,
    hotels,
    itinerarySummary,
    itineraryDayCount,
    costSummary,
  });
}
await conn2.end();

// ── Stage 5: Write markdown report ───────────────────────────────────────────

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const reportPath = path.join(
  process.cwd(),
  "docs",
  `round-80.16-pipeline-test-${ts}.md`
);

let md = `# Full Pipeline Test — ${ts}

**Total candidates:** ${candidates.length}
**Successfully generated:** ${inspection.filter((i) => !i.missing && !i.error).length}
**Failed / missing:** ${inspection.filter((i) => i.missing || i.error).length}

---

`;

for (let i = 0; i < inspection.length; i++) {
  const r = inspection[i];
  md += `## ${i + 1}. ${r.tourName || "(unknown)"} — [${r.label || "?"}]\n\n`;
  md += `- **Source URL:** ${r.url}\n`;
  md += `- **Lion 原始**: ${r.days}天, NT$ ${r.price}, ${r.totalSeats} 座(剩 ${r.spareSeats}), ${r.goDate} → ${r.backDate}\n`;

  if (r.error) {
    md += `\n### ❌ FAILED\n- Error: ${r.error}\n- Last phase: ${r.phase || "?"}\n- Elapsed: ${r.elapsedSec || "?"}s\n\n---\n\n`;
    continue;
  }

  if (!r.tour) {
    md += `\n### ❌ MISSING from DB despite jobId ${r.jobId}\n\n---\n\n`;
    continue;
  }

  md += `- **Generated tour ID:** ${r.tour.id}\n`;
  md += `- **Generation time:** ${r.elapsedSec}s\n\n`;

  // === Inspection sections ===
  md += "### 📍 地點 / 出發\n";
  md += `- destinationCountry: ${r.tour.destinationCountry || "❌ EMPTY"}\n`;
  md += `- destinationCity: ${r.tour.destinationCity || "❌ EMPTY"}\n`;
  md += `- departureCountry: ${r.tour.departureCountry || "—"}\n`;
  md += `- departureCity: ${r.tour.departureCity || "—"}\n`;
  md += `- departureAirport: ${r.tour.departureAirportCode || "—"} → ${r.tour.destinationAirportCode || "—"}\n\n`;

  md += "### 👥 人數\n";
  md += `- maxParticipants: ${r.tour.maxParticipants || "❌ EMPTY"}\n`;
  md += `- totalSeats (Lion): ${r.totalSeats}, spareSeats: ${r.spareSeats}\n\n`;

  md += "### 📅 報名時間 / 出發日\n";
  md += `- startDate: ${r.tour.startDate || "—"}\n`;
  md += `- endDate: ${r.tour.endDate || "—"}\n`;
  md += `- duration: ${r.tour.duration} 天 / ${r.tour.nights} 夜\n`;
  md += `- 出發日數量(tourDepartures table): ${r.departures.length}\n`;
  if (r.departures.length > 0) {
    md += "  ```\n";
    for (const d of r.departures.slice(0, 5)) {
      md += `  ${d.departureDate} → ${d.returnDate} | ${d.availableSeats}/${d.totalSeats} | NT$ ${d.price} | ${d.status}\n`;
    }
    if (r.departures.length > 5) md += `  ... ${r.departures.length - 5} more\n`;
    md += "  ```\n";
  }
  md += "\n";

  md += "### 💰 價格\n";
  md += `- price: NT$ ${r.tour.price} (basePrice: NT$ ${r.tour.basePrice}) ${r.tour.currency}\n`;
  md += `- 費用包含: ${r.costSummary.included} 項, 不含: ${r.costSummary.excluded} 項\n\n`;

  md += "### 📝 內容\n";
  md += `- title: ${r.tour.title}\n`;
  md += `- productCode: ${r.tour.productCode || "—"}\n`;
  md += `- highlights length: ${(r.tour.highlights || "").length} 字\n`;
  md += `- includes length: ${(r.tour.includes || "").length} 字\n`;
  md += `- notices length: ${(r.tour.notices || "").length} 字\n`;
  md += `- 行程天數(itineraryDetailed): ${r.itineraryDayCount}\n`;
  md += `- 行程預覽: ${r.itinerarySummary}\n\n`;

  md += "### 🏨 飯店\n";
  md += `- 飯店記錄數: ${r.hotels.length}\n`;
  if (r.hotels.length > 0) {
    md += "  ```\n";
    for (const h of r.hotels.slice(0, 7)) {
      md += `  Day ${h.day || "?"}: ${h.name || "(no name)"}${h.city ? ` (${h.city})` : ""}\n`;
    }
    if (r.hotels.length > 7) md += `  ... ${r.hotels.length - 7} more\n`;
    md += "  ```\n";
  }
  md += "\n";

  md += "### 🖼️ 圖片\n";
  md += `- heroImage: ${r.tour.heroImage ? "✓ " + r.tour.heroImage.substring(0, 80) + "..." : "❌ EMPTY"}\n`;
  md += `- imageUrl: ${r.tour.imageUrl ? "✓ " + r.tour.imageUrl.substring(0, 80) + "..." : "❌ EMPTY"}\n\n`;

  md += "### ✅ QA / Calibration\n";
  md += `- isAutoGenerated: ${r.tour.isAutoGenerated}\n`;
  md += `- calibrationVerdict: ${r.tour.calibrationVerdict || "—"}\n`;
  md += `- calibrationScore: ${r.tour.calibrationScore || "—"}\n`;
  md += `- status: ${r.tour.status}, featured: ${r.tour.featured}\n\n`;

  md += "---\n\n";
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, md, "utf-8");

console.log(`\n[Stage 5] Report written to: ${reportPath}`);
console.log("\n=== DONE ===");

// Print summary table
console.log("\nSummary:");
console.log("Idx | 地點 | 結果 | 城市 | 飯店# | 出發日# | 行程天 | QA");
console.log("----+------+------+------+-------+---------+--------+----");
for (let i = 0; i < inspection.length; i++) {
  const r = inspection[i];
  if (r.error || r.missing) {
    console.log(`  ${i + 1} | ${r.label?.padEnd(6) || "?"} | ❌ ${r.error || "missing"}`);
    continue;
  }
  console.log(
    `  ${i + 1} | ${r.label?.padEnd(6) || "?"} | ✓ | ${
      (r.tour.destinationCity || r.tour.destinationCountry || "?").padEnd(6)
    } | ${String(r.hotels.length).padEnd(5)} | ${String(r.departures.length).padEnd(7)} | ${String(r.itineraryDayCount).padEnd(6)} | ${r.tour.calibrationVerdict || "—"}/${r.tour.calibrationScore || "—"}`
  );
}
