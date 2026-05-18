#!/usr/bin/env node
/**
 * Scrape 5 representative Japan tours from Lion Travel for Sept 2026.
 *
 * Strategy:
 *   1. Pull Lion sitemap → child sitemap URLs → all NormGroupIDs
 *   2. POST /detail/travelinfojson for each (parallelized in batches of 10)
 *   3. Filter: country=JP AND has Sept 2026 departure
 *   4. Bucket by region keyword in tour name → pick 1 per region (5 buckets):
 *        - Tokyo+Fuji bucket: 東京 / 富士 / 箱根
 *        - Kansai bucket:     京阪 / 京都 / 大阪 / 奈良
 *        - Hokkaido bucket:   北海道 / 札幌
 *        - Kyushu bucket:     九州 / 福岡 / 由布院 / 別府 / 熊本
 *        - Alpine bucket:     立山 / 黑部 / 白川 / 高山 / 上高地
 *   5. For each bucket winner, fetch FULL day-by-day via daytripinfojson
 *   6. Save all to .audit/japan-sept-5-raw.json for the PDF renderer
 *
 * Run: node scripts/japan-sept-5-scrape.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const LION_BASE = "https://travel.liontravel.com";
const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
};

const BUCKETS = [
  {
    key: "tokyo",
    label: "Tokyo / Mt. Fuji / Hakone",
    keywords: ["東京", "富士", "箱根", "河口湖"],
  },
  {
    key: "kansai",
    label: "Kyoto / Osaka / Nara",
    keywords: ["京阪", "京都", "大阪", "奈良", "關西"],
  },
  {
    key: "hokkaido",
    label: "Hokkaido",
    keywords: ["北海道", "札幌", "函館", "小樽"],
  },
  {
    key: "kyushu",
    label: "Kyushu",
    keywords: ["九州", "福岡", "由布院", "別府", "熊本", "阿蘇"],
  },
  {
    key: "alpine",
    label: "Tateyama Kurobe Alpine + Shirakawa-go",
    keywords: ["立山", "黑部", "白川", "高山", "上高地", "黒部"],
  },
];

// Reject obvious bad fits before doing more work
const REJECT_PATTERNS = [
  /客製/, // Bespoke/custom tour — not the group-join format we want
  /高爾夫|打球|球場/, // Golf tour
  /賞芝櫻|賞櫻|賞楓限定/, // Hard-seasonal flowers (芝櫻 is May only)
  /暑假/, // Summer-only marketing
  /包車/, // Private vehicle — not "join a group" format
  /春節|跨年/, // Wrong season
];

function pickBucket(tourName) {
  if (REJECT_PATTERNS.some((re) => re.test(tourName))) return null;
  for (const b of BUCKETS) {
    for (const kw of b.keywords) {
      if (tourName.includes(kw)) return b.key;
    }
  }
  return null;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function postJson(p, body, referer) {
  const resp = await fetch(`${LION_BASE}${p}`, {
    method: "POST",
    headers: { ...HEADERS, Referer: referer ?? LION_BASE },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${p}`);
  return resp.json();
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Stage 1: sitemap → NormGroupID list ──────────────────────────────────────

console.log("[Stage 1] Pulling sitemap.xml from travel.liontravel.com…");
const indexResp = await fetch(`${LION_BASE}/sitemap.xml`, {
  headers: { "User-Agent": HEADERS["User-Agent"] },
  signal: AbortSignal.timeout(15000),
});
const indexXml = await indexResp.text();
const childSitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
console.log(`  Found ${childSitemaps.length} child sitemaps.`);

const normGroupIds = new Set();
for (const childUrl of childSitemaps.slice(0, 8)) {
  try {
    console.log(`  → ${childUrl}`);
    const r = await fetch(childUrl, {
      headers: { "User-Agent": HEADERS["User-Agent"] },
      signal: AbortSignal.timeout(25_000),
    });
    const xml = await r.text();
    for (const m of xml.matchAll(/NormGroupID=([a-f0-9-]{36})/gi)) {
      normGroupIds.add(m[1].toLowerCase());
    }
  } catch (e) {
    console.warn(`    skip (${e.message})`);
  }
}
console.log(`  Total unique NormGroupIDs across sampled sitemaps: ${normGroupIds.size}`);

// ─── Stage 2: verify in batches, keep JP + Sept-2026 candidates ───────────────

async function verifyOne(ngId) {
  try {
    const data = await postJson(
      "/detail/travelinfojson",
      { NormGroupID: ngId },
      `${LION_BASE}/detail?NormGroupID=${ngId}`
    );
    const gi = data?.GroupInfo;
    if (!gi || !gi.GroupID) return null;
    const tourName = gi.TourName || gi.NormGroup || "";
    // Quick filter: bucket-match + reject-pattern. Saves a calendar call
    // for non-Japan / bad-fit tours.
    const bucket = pickBucket(tourName);
    if (!bucket) return null;
    // Fetch Sept 2026 calendar to confirm the tour actually runs in Sept.
    let septCount = 0;
    try {
      const cal = await postJson(
        "/detail/groupcalendarjson",
        {
          NormGroupID: ngId,
          TourID: gi.TourID || "",
          GoDateStart: "2026-09-01",
          GoDateEnd: "2026-09-30",
        },
        `${LION_BASE}/detail?NormGroupID=${ngId}`
      );
      const cs = Array.isArray(cal) ? cal : [];
      septCount = cs.filter((c) => {
        const d = c.Date ?? "";
        return d.startsWith("2026-09") || d.startsWith("2026/09");
      }).length;
    } catch {}
    if (septCount === 0) return null;
    return {
      normGroupId: ngId,
      groupId: gi.GroupID,
      tourName,
      tourDays: gi.TourDays || 0,
      goDate: gi.GoDate || "",
      backDate: gi.BackDate || "",
      country: gi.Country || "",
      price: gi.StraightLowestPrice || 0,
      currencyCode: gi.CurrencyCode || "TWD",
      septCount,
      bucket,
      gi,
    };
  } catch {
    return null;
  }
}

console.log("\n[Stage 2] Verifying NormGroupIDs in batches of 8 (each call ~2 reqs)…");
const ids = [...normGroupIds];
// Shuffle so we sample diverse tours rather than the first N alphabetically
ids.sort(() => Math.random() - 0.5);
const BATCH = 8;
const MAX_TO_VERIFY = 800; // each verify = 2 Lion API calls
const chosen = {}; // bucket → best candidate (highest septCount)
let scanned = 0;

for (let i = 0; i < Math.min(ids.length, MAX_TO_VERIFY); i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(verifyOne));
  scanned += batch.length;
  for (const v of results) {
    if (!v) continue;
    const bucket = v.bucket;
    const prev = chosen[bucket];
    // Keep candidate with MORE Sept departures — that's a "real Sept tour",
    // not an edge departure. Ties broken by lower price (lowestPrice).
    if (
      !prev ||
      v.septCount > prev.septCount ||
      (v.septCount === prev.septCount && v.price < prev.price)
    ) {
      chosen[bucket] = v;
      console.log(
        `  ✓ bucket=${bucket}  sept=${v.septCount}d  ${v.tourDays}d  ${v.tourName.slice(0, 55)}`
      );
    }
  }
  // Don't stop early — keep scanning to find better candidates per bucket.
  if (scanned % 80 === 0) {
    const status = BUCKETS.map(
      (b) => `${b.key}:${chosen[b.key]?.septCount ?? "-"}`
    ).join(" ");
    console.log(`  …scanned ${scanned}/${MAX_TO_VERIFY}  [${status}]`);
  }
  // Bail once all buckets have a strong (≥3 Sept dep) candidate
  const allStrong = BUCKETS.every((b) => (chosen[b.key]?.septCount ?? 0) >= 3);
  if (allStrong) {
    console.log(`  All buckets have strong candidates (≥3 Sept dep). Stopping.`);
    break;
  }
}

console.log(`\n[Stage 2] Done. Filled ${Object.keys(chosen).length}/${BUCKETS.length} buckets after ${scanned} scans.`);

// ─── Stage 3: for each chosen, fetch full daily itinerary + calendar ──────────

console.log("\n[Stage 3] Fetching full daily itinerary + Sept 2026 calendar…");
const finalCandidates = [];
for (const bucket of BUCKETS) {
  const v = chosen[bucket.key];
  if (!v) {
    console.warn(`  ⚠ no candidate for bucket "${bucket.label}"`);
    continue;
  }
  console.log(`\n  → ${bucket.label}`);
  console.log(`     ${v.tourName.slice(0, 60)}`);
  console.log(`     NormGroupID: ${v.normGroupId}`);
  try {
    const referer = `${LION_BASE}/detail?NormGroupID=${v.normGroupId}`;
    const [daytrip, calendar] = await Promise.all([
      postJson(
        "/detail/daytripinfojson",
        { NormGroupID: v.normGroupId, GroupID: v.groupId },
        referer
      ),
      postJson(
        "/detail/groupcalendarjson",
        {
          NormGroupID: v.normGroupId,
          TourID: v.gi.TourID || "",
          GoDateStart: "2026-09-01",
          GoDateEnd: "2026-09-30",
        },
        referer
      ).catch(() => []),
    ]);

    const days = (daytrip?.DailyList ?? []).map((d) => ({
      day: d.Day ?? 0,
      travelPoint: stripHtml(d.TravelPoint ?? ""),
      summary: stripHtml(d.Summary ?? ""),
      breakfast: d.Breakfast ?? "",
      lunch: d.Lunch ?? "",
      dinner: d.Dinner ?? "",
      hotelName:
        (d.HotelList ?? [])[0]?.HotelName ?? stripHtml(d.HotelDesc ?? ""),
      attractions: (d.AttractionsList ?? []).map((a) => ({
        name: stripHtml(a.Name ?? ""),
        visitWayDesc: stripHtml(a.VisitWayDesc ?? ""),
      })),
    }));

    const sept = (Array.isArray(calendar) ? calendar : []).filter((c) => {
      const d = c.Date ?? "";
      return d.startsWith("2026-09") || d.startsWith("2026/09");
    }).map((c) => ({
      date: c.Date,
      weekDay: c.WeekDay,
      price: c.Price,
      availableSeats: c.AvailableVacancy,
      totalSeats: c.TotalVacnacy,
      status: c.Status,
    }));

    console.log(`     ${days.length} days, ${sept.length} Sept-2026 departures.`);

    finalCandidates.push({
      bucket: bucket.key,
      bucketLabel: bucket.label,
      normGroupId: v.normGroupId,
      groupId: v.groupId,
      tourName: v.tourName,
      tourId: v.gi.TourID,
      tourDays: v.tourDays,
      currencyCode: v.currencyCode,
      lowestPrice: v.price,
      detailUrl: `${LION_BASE}/detail?NormGroupID=${v.normGroupId}&GroupID=${v.groupId}`,
      days,
      septDepartures: sept,
    });
  } catch (e) {
    console.error(`     ✗ fetch failed: ${e.message}`);
  }
}

// ─── Stage 4: persist raw JSON ────────────────────────────────────────────────

const outDir = path.join(process.cwd(), ".audit");
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, "japan-sept-5-raw.json");
await writeFile(
  outFile,
  JSON.stringify({ scrapedAt: new Date().toISOString(), candidates: finalCandidates }, null, 2)
);
console.log(`\n[Done] Wrote ${finalCandidates.length} candidates to ${outFile}`);
console.log(`       (${(finalCandidates.reduce((s, c) => s + c.days.length, 0))} days total, ${finalCandidates.reduce((s, c) => s + c.septDepartures.length, 0)} Sept-2026 departures)`);
