/**
 * enrich-tour-ambiance.ts — batch-generate poeticTitle, heroSubtitle, colorTheme
 * for tours that are missing these "ambiance" fields.
 *
 * These fields make the tour detail page visually rich:
 *   - poeticTitle: short evocative name (e.g. "北海道雪國浪漫6日")
 *   - heroSubtitle: one-line English tagline for the hero banner
 *   - colorTheme: JSON color palette derived from the destination
 *
 * Usage:
 *   DRY RUN:  pnpm tsx server/scripts/enrich-tour-ambiance.ts
 *   EXECUTE:  pnpm tsx server/scripts/enrich-tour-ambiance.ts --execute
 *   LIMIT:    pnpm tsx server/scripts/enrich-tour-ambiance.ts --execute --limit 100
 *
 * Cost estimate: ~$0.002 per tour (Haiku), ~4,000 tours = ~$8 total.
 * 2026-05-27
 */

import { getDb } from "../db";
import { tours } from "../../drizzle/schema";
import { eq, isNull, and, sql } from "drizzle-orm";

// ── Color palettes by destination region ────────────────────────────

const COLOR_PALETTES: Record<string, object> = {
  japan: {
    primary: "#DC2626",    // torii red
    secondary: "#FDE68A",  // sakura gold
    accent: "#F472B6",     // cherry blossom pink
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#FFF7ED",
    backgroundDark: "#1C1917",
  },
  korea: {
    primary: "#2563EB",    // hanbok blue
    secondary: "#F97316",  // autumn orange
    accent: "#A78BFA",     // palace purple
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#EFF6FF",
    backgroundDark: "#1E1B4B",
  },
  europe: {
    primary: "#1D4ED8",    // royal blue
    secondary: "#D4A843",  // baroque gold
    accent: "#059669",     // vineyard green
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#F0FDF4",
    backgroundDark: "#14532D",
  },
  tropical: {
    primary: "#0D9488",    // ocean teal
    secondary: "#F59E0B",  // sunset gold
    accent: "#06B6D4",     // lagoon cyan
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#ECFDF5",
    backgroundDark: "#134E4A",
  },
  china: {
    primary: "#DC2626",    // vermillion
    secondary: "#F59E0B",  // imperial gold
    accent: "#7C3AED",     // forbidden purple
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#FEF2F2",
    backgroundDark: "#450A0A",
  },
  oceania: {
    primary: "#0284C7",    // reef blue
    secondary: "#16A34A",  // bush green
    accent: "#F97316",     // outback orange
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#F0F9FF",
    backgroundDark: "#0C4A6E",
  },
  cruise: {
    primary: "#1E40AF",    // deep navy
    secondary: "#FBBF24",  // deck gold
    accent: "#0EA5E9",     // wave sky
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#EFF6FF",
    backgroundDark: "#1E3A5F",
  },
  taiwan: {
    primary: "#059669",    // jade green
    secondary: "#F59E0B",  // temple gold
    accent: "#EC4899",     // blossom pink
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#ECFDF5",
    backgroundDark: "#064E3B",
  },
  usa: {
    primary: "#1D4ED8",    // liberty blue
    secondary: "#DC2626",  // classic red
    accent: "#F59E0B",     // golden gate
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#EFF6FF",
    backgroundDark: "#1E3A5F",
  },
  default: {
    primary: "#0D9488",    // PACK&GO teal
    secondary: "#F59E0B",
    accent: "#8B5CF6",
    text: "#1F2937",
    textLight: "#FFFFFF",
    background: "#F0FDFA",
    backgroundDark: "#134E4A",
  },
};

function getColorPalette(destCountry: string): object {
  const dest = (destCountry || "").toLowerCase();
  if (dest.includes("日本") || dest.includes("japan")) return COLOR_PALETTES.japan;
  if (dest.includes("韓國") || dest.includes("korea")) return COLOR_PALETTES.korea;
  if (dest.includes("台灣") || dest.includes("taiwan")) return COLOR_PALETTES.taiwan;
  if (dest.includes("中國") || dest.includes("china") || dest.includes("香港") || dest.includes("澳門")) return COLOR_PALETTES.china;
  if (dest.includes("美國") || dest.includes("加拿大") || dest.includes("usa")) return COLOR_PALETTES.usa;
  if (dest.includes("澳洲") || dest.includes("紐西蘭") || dest.includes("帛琉")) return COLOR_PALETTES.oceania;
  if (dest.includes("郵輪") || dest.includes("cruise")) return COLOR_PALETTES.cruise;
  if (
    dest.includes("泰國") || dest.includes("越南") || dest.includes("印尼") ||
    dest.includes("菲律賓") || dest.includes("馬來西亞") || dest.includes("新加坡") ||
    dest.includes("柬埔寨") || dest.includes("馬爾地夫") || dest.includes("斯里蘭卡")
  ) return COLOR_PALETTES.tropical;
  if (
    dest.includes("法國") || dest.includes("德國") || dest.includes("英國") ||
    dest.includes("義大利") || dest.includes("瑞士") || dest.includes("西班牙") ||
    dest.includes("葡萄牙") || dest.includes("希臘") || dest.includes("荷蘭") ||
    dest.includes("奧地利") || dest.includes("捷克") || dest.includes("匈牙利") ||
    dest.includes("北歐") || dest.includes("巴爾幹") || dest.includes("東歐") ||
    dest.includes("歐洲") || dest.includes("土耳其") || dest.includes("俄羅斯")
  ) return COLOR_PALETTES.europe;
  return COLOR_PALETTES.default;
}

// ── Poetic title + subtitle generation (no LLM — rule-based) ────────

/**
 * Generate a short poetic title from the tour title.
 * Extract the core destination + duration, strip promotional text.
 *
 * Input:  "紐西蘭旅遊｜前十名扣三千｜入住冰河區·高山觀景火車...南北島10日"
 * Output: "紐西蘭冰河觀景南北島10日"
 */
function generatePoeticTitle(title: string, dest: string, days: number | null): string {
  // Strip common promotional prefixes
  const promoPatterns = [
    /^(預購折\d+千?\|)/,
    /^(賀歲折\d+\|)/,
    /^(前\d+名扣\d+千?\|)/,
    /^(限時\w+\|)/,
    /^(好友搶購\|)/,
    /^(期間限定[.\s]*)/,
    /^(客製\|)/,
  ];

  let clean = title;
  // Remove everything after " ─ " (English translation)
  const dashIdx = clean.indexOf(" ─ ");
  if (dashIdx > 0) clean = clean.substring(0, dashIdx);

  // Split by ｜ and take parts
  const parts = clean.split("｜").map(p => p.trim());

  // Find the part that has the destination name
  let destPart = parts.find(p => p.includes(dest)) || parts[0] || "";

  // Strip promo patterns from destPart
  for (const pat of promoPatterns) {
    destPart = destPart.replace(pat, "");
  }

  // If we have a clear "X旅遊" prefix, strip it
  destPart = destPart.replace(/^(\S+旅遊)\|/, "");

  // Keep it short — max 20 chars
  if (destPart.length > 25) {
    // Try to find a good cut point
    const dayMatch = destPart.match(/(\d+)\s*(日|天|Days)/);
    if (dayMatch) {
      const dayIdx = destPart.indexOf(dayMatch[0]);
      if (dayIdx > 0 && dayIdx < 25) {
        destPart = destPart.substring(0, dayIdx + dayMatch[0].length);
      } else {
        destPart = destPart.substring(0, 22) + "...";
      }
    } else {
      destPart = destPart.substring(0, 22) + "...";
    }
  }

  // Fallback: just use dest + days
  if (!destPart || destPart.length < 3) {
    destPart = days ? `${dest} ${days}日之旅` : `${dest}精選之旅`;
  }

  return destPart.trim();
}

/**
 * Generate an English hero subtitle from the title + destination.
 */
function generateHeroSubtitle(title: string, dest: string, days: number | null): string {
  // Extract English part if present
  const dashIdx = title.indexOf(" ─ ");
  if (dashIdx > 0) {
    let eng = title.substring(dashIdx + 3).trim();
    // Strip "| PACK&GO Travel" suffix
    eng = eng.replace(/\s*\|\s*PACK&GO.*$/, "").trim();
    // Take first meaningful segment
    const segments = eng.split("|").map(s => s.trim());
    const main = segments[0] || "";
    if (main.length > 10 && main.length < 80) {
      return main;
    }
  }

  // Fallback: construct from destination
  const destMap: Record<string, string> = {
    "日本": "Japan", "韓國": "Korea", "台灣": "Taiwan", "中國": "China",
    "泰國": "Thailand", "越南": "Vietnam", "印尼": "Indonesia",
    "菲律賓": "Philippines", "馬來西亞": "Malaysia", "新加坡": "Singapore",
    "美國": "USA", "加拿大": "Canada", "墨西哥": "Mexico",
    "法國": "France", "德國": "Germany", "英國": "UK",
    "義大利": "Italy", "瑞士": "Switzerland", "西班牙": "Spain",
    "澳洲": "Australia", "紐西蘭": "New Zealand",
    "郵輪": "Cruise", "帛琉": "Palau", "土耳其": "Turkey",
    "埃及": "Egypt", "摩洛哥": "Morocco", "香港": "Hong Kong",
    "澳門": "Macau", "北歐": "Northern Europe", "巴爾幹": "Balkans",
  };

  const engDest = destMap[dest] || dest;
  if (days) {
    return `${days}-Day ${engDest} Adventure`;
  }
  return `Explore ${engDest}`;
}

// ── Main scan + apply ───────────────────────────────────────────────

export interface AmbianceFix {
  tourId: number;
  title: string;
  updates: {
    poeticTitle?: string;
    heroSubtitle?: string;
    colorTheme?: string;
  };
}

export async function scanMissingAmbiance(limit?: number): Promise<AmbianceFix[]> {
  const db = (await getDb())!;
  if (!db) throw new Error("Database not available");

  // Find active tours missing ANY of the three fields
  const rows = await db
    .select({
      id: tours.id,
      title: tours.title,
      destinationCountry: tours.destinationCountry,
      duration: tours.duration,
      poeticTitle: tours.poeticTitle,
      heroSubtitle: tours.heroSubtitle,
      colorTheme: tours.colorTheme,
    })
    .from(tours)
    .where(
      and(
        eq(tours.status, "active"),
        sql`(${tours.poeticTitle} IS NULL OR ${tours.heroSubtitle} IS NULL OR ${tours.colorTheme} IS NULL)`,
      )
    )
    .orderBy(tours.id)
    .limit(limit || 99999);

  const fixes: AmbianceFix[] = [];

  for (const row of rows) {
    const dest = row.destinationCountry || "";
    const days = row.duration;
    const updates: AmbianceFix["updates"] = {};

    if (!row.poeticTitle) {
      updates.poeticTitle = generatePoeticTitle(row.title || "", dest, days);
    }
    if (!row.heroSubtitle) {
      updates.heroSubtitle = generateHeroSubtitle(row.title || "", dest, days);
    }
    if (!row.colorTheme) {
      updates.colorTheme = JSON.stringify(getColorPalette(dest));
    }

    if (Object.keys(updates).length > 0) {
      fixes.push({ tourId: row.id, title: (row.title || "").substring(0, 60), updates });
    }
  }

  return fixes;
}

export async function applyAmbianceFixes(fixes: AmbianceFix[]): Promise<number> {
  const { updateTour } = await import("../db/tour");
  let applied = 0;

  for (const fix of fixes) {
    try {
      await updateTour(fix.tourId, fix.updates as any);
      applied++;
      if (applied % 200 === 0) {
        console.log(`[enrich-ambiance] applied ${applied}/${fixes.length}`);
      }
    } catch (err) {
      console.error(`[enrich-ambiance] failed tour ${fix.tourId}:`, err);
    }
  }

  return applied;
}

// ── CLI entry point (only runs when executed directly, NOT when imported) ──

const isCLI = process.argv[1]?.includes("enrich-tour-ambiance");

if (isCLI) {
  (async () => {
    const args = process.argv.slice(2);
    const execute = args.includes("--execute");
    const limitArg = args.find(a => a.startsWith("--limit"));
    const limit = limitArg ? parseInt(limitArg.split("=")[1] || args[args.indexOf("--limit") + 1] || "99999") : undefined;

    console.log(`[enrich-ambiance] scanning tours missing poeticTitle/heroSubtitle/colorTheme...`);
    const fixes = await scanMissingAmbiance(limit);
    console.log(`[enrich-ambiance] found ${fixes.length} tours to enrich`);

    // Show samples
    fixes.slice(0, 5).forEach(f => {
      console.log(`  tour ${f.tourId}: ${f.title}`);
      if (f.updates.poeticTitle) console.log(`    poeticTitle: ${f.updates.poeticTitle}`);
      if (f.updates.heroSubtitle) console.log(`    heroSubtitle: ${f.updates.heroSubtitle}`);
      if (f.updates.colorTheme) console.log(`    colorTheme: (palette assigned)`);
    });

    if (!execute) {
      console.log(`\n[enrich-ambiance] DRY RUN — pass --execute to apply changes`);
      process.exit(0);
    }

    console.log(`\n[enrich-ambiance] applying ${fixes.length} fixes...`);
    const applied = await applyAmbianceFixes(fixes);
    console.log(`[enrich-ambiance] done — ${applied}/${fixes.length} applied`);
    process.exit(0);
  })().catch(err => {
    console.error("[enrich-ambiance] fatal:", err);
    process.exit(1);
  });
}
