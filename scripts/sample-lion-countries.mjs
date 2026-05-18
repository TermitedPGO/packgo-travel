#!/usr/bin/env node
/**
 * Sample 60 random NormGroupIDs from /tmp/lion-sample-ids.txt, verify in
 * parallel against Lion's travelinfojson endpoint, and group by country.
 * Output: country distribution + first international URL per country.
 */
import fs from "fs/promises";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const LION_BASE = "https://travel.liontravel.com";

async function verify(normGroupId) {
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
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const gi = data?.GroupInfo ?? {};
    if (!gi.GroupID || !gi.Country) return null;
    return {
      normGroupId,
      country: gi.Country,
      tourName: gi.TourName || "?",
      days: gi.TourDays || 0,
      price: gi.StraightLowestPrice || 0,
      url: `${LION_BASE}/detail?NormGroupID=${normGroupId}&GroupID=${gi.GroupID}&Platform=APP`,
    };
  } catch {
    return null;
  }
}

const ids = (await fs.readFile("/tmp/lion-sample-ids.txt", "utf-8"))
  .split("\n")
  .map((l) => l.replace("NormGroupID=", "").trim())
  .filter((l) => l.length === 36);

console.log(`Sampling ${ids.length} ids in parallel batches of 8...`);
const results = [];
for (let i = 0; i < ids.length; i += 8) {
  const batch = ids.slice(i, i + 8);
  const settled = await Promise.allSettled(batch.map(verify));
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value) results.push(s.value);
  }
  process.stdout.write(`\r  scanned ${Math.min(i + 8, ids.length)}/${ids.length} valid=${results.length}`);
}
process.stdout.write("\n");

// Group by country
const byCountry = new Map();
for (const r of results) {
  if (!byCountry.has(r.country)) byCountry.set(r.country, []);
  byCountry.get(r.country).push(r);
}

console.log("\nCountry distribution:");
const sortedCountries = [...byCountry.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [c, list] of sortedCountries) {
  console.log(`  ${c}: ${list.length} tours`);
}

// Filter against existing DB
const conn = await mysql.createConnection(DATABASE_URL);
const [rows] = await conn.execute(
  "SELECT sourceUrl FROM tours WHERE sourceUrl LIKE '%liontravel%'"
);
const existing = new Set();
for (const r of rows) {
  const m = r.sourceUrl?.match(/NormGroupID=([a-f0-9-]{36})/i);
  if (m) existing.add(m[1].toLowerCase());
}
await conn.end();

console.log("\nNew (not in DB) by country:");
const newOnly = results.filter((r) => !existing.has(r.normGroupId.toLowerCase()));
const newByCountry = new Map();
for (const r of newOnly) {
  if (!newByCountry.has(r.country)) newByCountry.set(r.country, []);
  newByCountry.get(r.country).push(r);
}

// Sample 1 from each NON-TW country
console.log("\nSample international tours (1 per country):");
for (const [c, list] of newByCountry.entries()) {
  if (c === "TW") continue;
  const first = list[0];
  console.log(`  [${c}] ${first.tourName.substring(0, 50)} (${first.days}天, ${first.price})`);
  console.log(`    ${first.url}`);
}

// Output JSON for downstream script
await fs.writeFile(
  "/tmp/lion-international-candidates.json",
  JSON.stringify(
    [...newByCountry.entries()]
      .filter(([c]) => c !== "TW")
      .map(([c, list]) => ({ country: c, ...list[0] }))
      .slice(0, 5),
    null,
    2
  )
);
console.log("\n→ saved /tmp/lion-international-candidates.json");
