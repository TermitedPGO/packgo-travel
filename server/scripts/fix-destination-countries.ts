/**
 * Fix destination country mismatches — 2026-05-27.
 *
 * Many tours imported from Lion Travel have wrong `destinationCountry` because
 * the scraper got confused. This script scans active tours, extracts the actual
 * destination from the title using keyword matching, and fixes mismatches.
 *
 * Run (dry run — no changes):
 *   pnpm tsx server/scripts/fix-destination-countries.ts
 *
 * Run (actually update):
 *   pnpm tsx server/scripts/fix-destination-countries.ts --execute
 *
 * Or via fly:
 *   fly ssh console -a packgo-travel \
 *     -C 'node --experimental-strip-types server/scripts/fix-destination-countries.ts --execute'
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { tours } from "../../drizzle/schema";

// ─────────────────────────────────────────────────────────────
// Keyword → country mapping rules
// ─────────────────────────────────────────────────────────────

/** Each rule: [keyword in title, correct destinationCountry]. Order matters —
 *  more specific keywords must come before generic ones (e.g. 沖繩 before 日本). */
const DESTINATION_RULES: Array<[string, string]> = [
  // Japan sub-regions (these ARE Japan, so the correct country is 日本)
  ["沖繩", "日本"],
  ["北海道", "日本"],
  ["東京", "日本"],
  ["大阪", "日本"],
  ["京都", "日本"],
  ["九州", "日本"],
  ["四國", "日本"],
  ["名古屋", "日本"],
  ["福岡", "日本"],
  ["奈良", "日本"],
  ["箱根", "日本"],
  ["輕井澤", "日本"],
  ["富士", "日本"],
  ["立山黑部", "日本"],
  ["合掌村", "日本"],
  ["白川鄉", "日本"],

  // Korea
  ["首爾", "韓國"],
  ["釜山", "韓國"],
  ["濟州", "韓國"],

  // Southeast Asia
  ["曼谷", "泰國"],
  ["清邁", "泰國"],
  ["普吉", "泰國"],
  ["峇里島", "印尼"],
  ["巴里島", "印尼"],
  ["河內", "越南"],
  ["下龍灣", "越南"],
  ["胡志明", "越南"],
  ["峴港", "越南"],
  ["長灘島", "菲律賓"],
  ["宿霧", "菲律賓"],
  ["吉隆坡", "馬來西亞"],
  ["仙本那", "馬來西亞"],
  ["蘭卡威", "馬來西亞"],

  // Europe sub-checks (multi-country combos first)
  ["德瑞", "德國"],   // 德瑞 = Germany+Switzerland, first country = 德國

  // Individual European countries
  ["紐西蘭", "紐西蘭"],
  ["瑞士", "瑞士"],
  ["義大利", "義大利"],
  ["法國", "法國"],
  ["英國", "英國"],
  ["德國", "德國"],
  ["西班牙", "西班牙"],
  ["葡萄牙", "葡萄牙"],
  ["奧地利", "奧地利"],
  ["捷克", "捷克"],
  ["荷蘭", "荷蘭"],
  ["希臘", "希臘"],
  ["克羅埃西亞", "克羅埃西亞"],
  ["冰島", "冰島"],
  ["挪威", "挪威"],
  ["芬蘭", "芬蘭"],
  ["瑞典", "瑞典"],
  ["丹麥", "丹麥"],

  // Oceania
  ["澳洲", "澳洲"],

  // Other Asia
  ["新加坡", "新加坡"],
  ["馬來西亞", "馬來西亞"],
  ["帛琉", "帛琉"],

  // Middle East / Africa
  ["土耳其", "土耳其"],
  ["伊斯坦堡", "土耳其"],
  ["埃及", "埃及"],
  ["摩洛哥", "摩洛哥"],
  ["杜拜", "阿聯酋"],
  ["阿布達比", "阿聯酋"],

  // Americas
  ["美國", "美國"],
  ["加拿大", "加拿大"],

  // Generic country names last (these only match if nothing above matched)
  ["日本", "日本"],
  ["韓國", "韓國"],
  ["泰國", "泰國"],
  ["越南", "越南"],
  ["印尼", "印尼"],
  ["菲律賓", "菲律賓"],
];

/** Keywords in title that should NOT cause a destination change to 台灣 —
 *  they refer to departure airline or departure point, not destination. */
const TAIWAN_FALSE_POSITIVES = ["台灣虎航", "台灣出發", "台灣桃園", "桃園出發"];

export interface DestinationFix {
  tourId: number;
  title: string;
  currentCountry: string;
  newCountry: string;
}

/**
 * Detect the correct destination country from a tour title.
 * Returns null if no rule matches or the title is ambiguous.
 */
export function detectCountryFromTitle(title: string): string | null {
  // Strip false positives before scanning
  let cleanTitle = title;
  for (const fp of TAIWAN_FALSE_POSITIVES) {
    cleanTitle = cleanTitle.replaceAll(fp, "");
  }

  for (const [keyword, country] of DESTINATION_RULES) {
    if (cleanTitle.includes(keyword)) {
      return country;
    }
  }
  return null;
}

/**
 * Scan all active tours and identify destination country mismatches.
 * Returns a list of proposed fixes.
 */
export async function scanDestinationMismatches(): Promise<DestinationFix[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const activeTours = await db
    .select({
      id: tours.id,
      title: tours.title,
      destinationCountry: tours.destinationCountry,
    })
    .from(tours)
    .where(eq(tours.status, "active"));

  const fixes: DestinationFix[] = [];

  for (const tour of activeTours) {
    const detected = detectCountryFromTitle(tour.title);
    if (!detected) continue; // no rule matched — skip

    // Only flag if the current value is different from what the title says
    if (tour.destinationCountry !== detected) {
      fixes.push({
        tourId: tour.id,
        title: tour.title,
        currentCountry: tour.destinationCountry,
        newCountry: detected,
      });
    }
  }

  return fixes;
}

/**
 * Apply destination country fixes to the database.
 * Returns how many tours were updated.
 */
export async function applyDestinationFixes(
  fixes: DestinationFix[]
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let updated = 0;
  for (const fix of fixes) {
    await db
      .update(tours)
      .set({ destinationCountry: fix.newCountry })
      .where(eq(tours.id, fix.tourId));
    updated++;
  }
  return updated;
}

// ─────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────

async function main() {
  const execute = process.argv.includes("--execute");

  console.log(
    execute
      ? "🔧 EXECUTE mode — will update the database"
      : "👀 DRY RUN — no changes will be made (pass --execute to apply)"
  );
  console.log("");

  const fixes = await scanDestinationMismatches();

  if (fixes.length === 0) {
    console.log("✅ No destination country mismatches found.");
    process.exit(0);
  }

  console.log(`Found ${fixes.length} mismatch(es):\n`);
  for (const fix of fixes) {
    console.log(
      `  [Tour #${fix.tourId}] "${fix.title.slice(0, 60)}..."`,
    );
    console.log(
      `    ${fix.currentCountry} → ${fix.newCountry}`,
    );
    console.log("");
  }

  if (!execute) {
    console.log("Run with --execute to apply these changes.");
    process.exit(0);
  }

  const updated = await applyDestinationFixes(fixes);
  console.log(`✅ Updated ${updated} tour(s).`);
  process.exit(0);
}

// Run when executed directly (not imported)
const isDirectRun =
  process.argv[1]?.endsWith("fix-destination-countries.ts") ||
  process.argv[1]?.endsWith("fix-destination-countries.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
