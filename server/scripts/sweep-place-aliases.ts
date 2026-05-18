/**
 * sweep-place-aliases.ts — Round 80.21 v11.
 *
 * One-time scan over existing tours' itineraryDetailed to find Chinese
 * place names that are NOT in the static alias dictionary, then call
 * Claude Haiku to normalize each. Results go into the Redis cache that
 * `llmPlaceNormalizer.normalizePlaceName` uses, so future getRouteMap
 * calls hit cache instead of paying the LLM cost per tour.
 *
 * Cost: ~$0.001 per unique name. Typical PACK&GO library has ~30 tours
 * with ~150-300 unique non-standard place names, so ~$0.15-0.30 total.
 *
 * Usage (locally):
 *   tsx server/scripts/sweep-place-aliases.ts
 *
 * Usage (on fly):
 *   fly ssh console -a packgo-travel -C "node /app/dist/scripts/sweep-place-aliases.js"
 *   (after adding to dist via pnpm build)
 *
 * Output: console summary + persisted to Redis (30-day TTL via llmPlaceNormalizer).
 */

import { getDb } from "../db";
import { tours } from "../../drizzle/schema";
import { PLACE_ALIASES } from "../_helpers/placeNameAliases";
import { normalizePlaceName } from "../_helpers/llmPlaceNormalizer";

// Same separator regex as routers.ts _extractDestinationPlace
const SEP = /\s*(?:↔|⇄|→|⇒|<->|<=>|->|=>|>|[／/、,，–—－])\s*| - | – /g;

function extractAllPlaceTokens(text: string): string[] {
  if (!text) return [];
  const stripped = String(text)
    .replace(/^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\+{2,}.*?\+{2,}/g, "")
    .trim()
    .split(/[:：]/)[0]
    .trim();
  if (!stripped) return [];
  return stripped.split(SEP).map((s) => s.trim()).filter(Boolean);
}

function isStaticAlias(name: string): boolean {
  if (PLACE_ALIASES[name]) return true;
  // prefix match — same logic as getAliases
  for (const key of Object.keys(PLACE_ALIASES)) {
    if (name.startsWith(key) && name.length <= key.length + 4) return true;
  }
  return false;
}

function isPureCJK(s: string): boolean {
  return /^[一-鿿]+$/.test(s);
}

function isLikelyPlace(s: string): boolean {
  // Heuristics to skip non-place tokens:
  // - Pure CJK 2-8 chars (city names typically 2-5)
  // - Skip activity verbs / themes ("自由日", "返程啟航", "回程")
  if (s.length < 2 || s.length > 8) return false;
  if (!isPureCJK(s)) return false;
  const blacklist = [
    "自由日", "返程", "回程", "啟航", "啟程", "返國", "歸鄉", "市區",
    "舊城區", "市中心", "古城", "古鎮", "車站", "機場", "公園",
  ];
  for (const b of blacklist) if (s.includes(b)) return false;
  return true;
}

async function main() {
  console.log("[sweep-place-aliases] starting scan...");
  const db = await getDb();
  if (!db) {
    console.error("DB not available");
    process.exit(1);
  }

  // Read all tours
  const all = await db.select().from(tours);
  console.log(`[sweep-place-aliases] scanning ${all.length} tours`);

  // Collect unique (place, country) pairs
  const seen = new Map<string, { country: string; sources: number }>();
  for (const tour of all as any[]) {
    const country = tour.destinationCountry || "";
    const itin = tour.itineraryDetailed;
    if (!itin) continue;
    let parsed: any[] = [];
    try {
      parsed = typeof itin === "string" ? JSON.parse(itin) : itin;
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const day of parsed) {
      // Title tokens
      for (const t of extractAllPlaceTokens(day.title || "")) {
        if (!isLikelyPlace(t)) continue;
        if (isStaticAlias(t)) continue;
        const key = `${country}::${t}`;
        const cur = seen.get(key) ?? { country, sources: 0 };
        cur.sources++;
        seen.set(key, cur);
      }
      // Activities
      const acts = Array.isArray(day.activities) ? day.activities : [];
      for (const a of acts) {
        for (const t of extractAllPlaceTokens(a.location || "")) {
          if (!isLikelyPlace(t)) continue;
          if (isStaticAlias(t)) continue;
          const key = `${country}::${t}`;
          const cur = seen.get(key) ?? { country, sources: 0 };
          cur.sources++;
          seen.set(key, cur);
        }
      }
    }
  }

  console.log(`[sweep-place-aliases] found ${seen.size} unique (country, place) pairs not in static dict`);

  // Call LLM for each (sequential to be polite + cache contention)
  let resolved = 0;
  let unknown = 0;
  let failed = 0;
  let i = 0;
  const entries = Array.from(seen.entries());
  for (const [key, { country }] of entries) {
    i++;
    const place = key.split("::")[1];
    try {
      const alias = await normalizePlaceName(place, country);
      if (alias && (alias.en || alias.zh)) {
        resolved++;
        console.log(`  [${i}/${seen.size}] ✓ ${place} (${country}) → en=${alias.en} zh=${alias.zh}`);
      } else {
        unknown++;
        console.log(`  [${i}/${seen.size}] ? ${place} (${country}) → no LLM answer (cached negative)`);
      }
    } catch (err) {
      failed++;
      console.warn(`  [${i}/${seen.size}] ✗ ${place} (${country}) → error:`, (err as Error).message);
    }
  }

  console.log(`\n[sweep-place-aliases] done. resolved=${resolved} unknown=${unknown} failed=${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
