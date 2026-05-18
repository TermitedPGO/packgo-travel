#!/usr/bin/env node
/**
 * Round 80.16: Inspect recently generated tours from DB.
 *
 * Pulls tours newer than ID threshold + Lion source. Outputs detailed
 * markdown report covering each: 地點 / 人數 / 報名時間 / 內容 / 飯店 / 圖片 / QA.
 */
import mysql from "mysql2/promise";
import fs from "fs/promises";
import path from "path";

const DATABASE_URL = process.env.DATABASE_URL;
const SINCE_ID = parseInt(process.env.SINCE_ID || "600003", 10); // Round 80.15 cutoff
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const conn = await mysql.createConnection(DATABASE_URL);

// Get tours newer than threshold (or specific IDs)
const tourIdArg = process.env.TOUR_IDS;
let rows;
if (tourIdArg) {
  const ids = tourIdArg.split(",").map((s) => parseInt(s.trim(), 10));
  const placeholders = ids.map(() => "?").join(",");
  [rows] = await conn.execute(
    `SELECT * FROM tours WHERE id IN (${placeholders}) ORDER BY id`,
    ids
  );
} else {
  [rows] = await conn.execute(
    `SELECT * FROM tours WHERE id >= ? AND sourceUrl LIKE '%liontravel%' ORDER BY id`,
    [SINCE_ID]
  );
}

console.log(`Inspecting ${rows.length} tour(s)...`);

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const reportPath = path.join(
  process.cwd(),
  "docs",
  `round-80.16-inspection-${ts}.md`
);

let md = `# Tour Generation Inspection — ${ts}\n\n`;
md += `**Tours inspected:** ${rows.length}\n\n---\n\n`;

for (const t of rows) {
  // Departures
  const [depRows] = await conn.execute(
    `SELECT departureDate, returnDate, totalSlots, bookedSlots, adultPrice, status
     FROM tourDepartures WHERE tourId = ? ORDER BY departureDate LIMIT 10`,
    [t.id]
  );

  // Itinerary
  let itineraryDays = [];
  if (t.itineraryDetailed) {
    try {
      itineraryDays = JSON.parse(t.itineraryDetailed);
    } catch {}
  }

  // Hotels (extract from itinerary)
  const hotels = itineraryDays
    .filter((d) => d.accommodation || d.hotelName)
    .map((d) => ({ day: d.day, name: d.accommodation || d.hotelName }));

  // Cost — Round 80.16: actual JSON field names are `included` / `excluded` /
  // `additionalCosts` (singular forms), NOT `includes` / `excludes`.
  let costData = null;
  if (t.costExplanation) {
    try {
      const raw = JSON.parse(t.costExplanation);
      costData = {
        includes: raw.included || raw.includes || [],
        excludes: raw.excluded || raw.excludes || [],
        additionalCosts: raw.additionalCosts || [],
      };
    } catch {}
  }

  md += `## Tour #${t.id}: ${t.title}\n\n`;
  md += `> Source: ${t.sourceUrl}\n\n`;
  md += `> Created: ${t.createdAt}\n\n`;

  // 📍 LOCATION
  md += `### 📍 地點 / 出發\n\n`;
  md += `| 欄位 | 值 |\n|------|------|\n`;
  md += `| destinationCountry | ${t.destinationCountry || "❌ EMPTY"} |\n`;
  md += `| destinationCity | ${t.destinationCity || "❌ EMPTY"} |\n`;
  md += `| destinationRegion | ${t.destinationRegion || "—"} |\n`;
  md += `| departureCountry | ${t.departureCountry || "—"} |\n`;
  md += `| departureCity | ${t.departureCity || "—"} |\n`;
  md += `| departureAirport | ${t.departureAirportCode || "—"} ${t.departureAirportName || ""} |\n`;
  md += `| destinationAirport | ${t.destinationAirportCode || "—"} ${t.destinationAirportName || ""} |\n\n`;

  // 👥 PARTICIPANTS
  md += `### 👥 人數\n\n`;
  md += `| 欄位 | 值 |\n|------|------|\n`;
  md += `| maxParticipants | ${t.maxParticipants ?? "❌ NULL"} |\n\n`;

  // 📅 DATES
  md += `### 📅 報名時間 / 出發日\n\n`;
  md += `- **duration:** ${t.duration} 天 / ${t.nights ?? "?"} 夜\n`;
  md += `- **startDate:** ${t.startDate || "—"}\n`;
  md += `- **endDate:** ${t.endDate || "—"}\n`;
  md += `- **出發日表:** ${depRows.length} 筆\n\n`;
  if (depRows.length > 0) {
    md += "| 出發日 | 回程 | 座位(剩/共) | 價格 | 狀態 |\n|--------|------|------|------|------|\n";
    for (const d of depRows.slice(0, 5)) {
      const remaining = d.totalSlots - (d.bookedSlots || 0);
      md += `| ${d.departureDate} | ${d.returnDate} | ${remaining}/${d.totalSlots} | NT$ ${d.adultPrice} | ${d.status} |\n`;
    }
    if (depRows.length > 5) md += `| ... | ${depRows.length - 5} more | | | |\n`;
    md += "\n";
  }

  // 💰 PRICE
  md += `### 💰 價格\n\n`;
  md += `- price: **NT$ ${(t.price || 0).toLocaleString()}** ${t.currency || "TWD"}\n`;
  md += `- basePrice: NT$ ${(t.basePrice || 0).toLocaleString()}\n`;
  md += `- 費用包含: ${costData?.includes?.length ?? "—"} 項\n`;
  md += `- 費用不含: ${costData?.excludes?.length ?? "—"} 項\n`;
  if (costData?.includes?.length) {
    md += "\n包含項前 3 項:\n";
    for (const inc of costData.includes.slice(0, 3)) {
      md += `  - ${typeof inc === "string" ? inc : inc.title || JSON.stringify(inc).substring(0, 80)}\n`;
    }
  }
  md += "\n";

  // 📝 CONTENT
  md += `### 📝 內容\n\n`;
  md += `- title: ${t.title}\n`;
  md += `- productCode: ${t.productCode || "—"}\n`;
  md += `- description length: ${(t.description || "").length} 字\n`;
  md += `- highlights length: ${(t.highlights || "").length} 字\n`;
  md += `- includes length: ${(t.includes || "").length} 字\n`;
  md += `- excludes length: ${(t.excludes || "").length} 字\n`;
  md += `- notices length: ${(t.notices || "").length} 字\n`;
  md += `- promotionText: ${t.promotionText || "—"}\n\n`;
  md += `- **行程天數 (itineraryDetailed):** ${itineraryDays.length}\n\n`;
  if (itineraryDays.length > 0) {
    md += "前 3 天預覽:\n";
    for (const d of itineraryDays.slice(0, 3)) {
      const desc = (d.description || d.summary || "").substring(0, 80);
      md += `  - **Day ${d.day}**: ${(d.title || d.travelPoint || "?").substring(0, 60)}\n`;
      if (desc) md += `    ${desc}...\n`;
      if (d.meals) {
        const meals = Array.isArray(d.meals) ? d.meals.join(" / ") : (typeof d.meals === "string" ? d.meals : JSON.stringify(d.meals));
        md += `    🍽️ ${meals.substring(0, 100)}\n`;
      }
    }
    md += "\n";
  }

  // 🏨 HOTELS
  md += `### 🏨 飯店\n\n`;
  md += `- 飯店記錄數: **${hotels.length}**\n`;
  if (hotels.length > 0) {
    md += "\n";
    for (const h of hotels.slice(0, 7)) {
      md += `  - **Day ${h.day || "?"}**: ${h.name || "(無名)"}\n`;
    }
    if (hotels.length > 7) md += `  - ... ${hotels.length - 7} more\n`;
    md += "\n";
  }

  // 🖼️ IMAGES
  md += `### 🖼️ 圖片\n\n`;
  md += `- heroImage: ${t.heroImage ? "✅ " + t.heroImage.substring(0, 100) : "❌ EMPTY"}\n`;
  md += `- imageUrl: ${t.imageUrl ? "✅ " + t.imageUrl.substring(0, 100) : "❌ EMPTY"}\n\n`;

  // 🎨 THEME
  md += `### 🎨 配色\n\n`;
  if (t.colorTheme) {
    try {
      const ct = JSON.parse(t.colorTheme);
      md += `- primary: ${ct.primary || "—"}\n`;
      md += `- secondary: ${ct.secondary || "—"}\n`;
      md += `- accent: ${ct.accent || "—"}\n`;
    } catch {
      md += `- (parse failed)\n`;
    }
  } else {
    md += `- ❌ EMPTY\n`;
  }
  md += "\n";

  // ✅ QA
  md += `### ✅ QA / Calibration\n\n`;
  md += `- isAutoGenerated: ${t.isAutoGenerated}\n`;
  md += `- calibrationVerdict: **${t.calibrationVerdict || "—"}**\n`;
  md += `- calibrationScore: **${t.calibrationScore ?? "—"}**\n`;
  md += `- status: ${t.status}\n`;
  md += `- featured: ${t.featured}\n\n`;

  // CRITICAL FIELDS SUMMARY
  md += `### 🔍 完整性 Summary\n\n`;
  const issues = [];
  if (!t.destinationCountry) issues.push("❌ destinationCountry 空");
  if (!t.destinationCity) issues.push("❌ destinationCity 空");
  if (!t.maxParticipants) issues.push("⚠️ maxParticipants null (可選但有用)");
  if (depRows.length === 0) issues.push("❌ 沒有出發日");
  if (!t.heroImage) issues.push("❌ heroImage 空");
  if (itineraryDays.length === 0) issues.push("❌ 沒有行程資料");
  if (hotels.length === 0 && itineraryDays.length > 0) issues.push("⚠️ 行程沒對應飯店");
  if (!costData?.includes || costData.includes.length === 0) issues.push("⚠️ 沒費用包含項");
  if (!t.notices) issues.push("⚠️ 沒注意事項");

  if (issues.length === 0) {
    md += "🎉 **所有關鍵欄位都正確抓到!**\n\n";
  } else {
    md += `**發現 ${issues.length} 個問題:**\n\n`;
    for (const i of issues) md += `- ${i}\n`;
    md += "\n";
  }

  md += "---\n\n";
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, md, "utf-8");
console.log(`\n✅ Report: ${reportPath}`);

// Console summary
console.log("\n=== Quick Summary ===");
console.log("ID    | Country | City | 出發日# | 飯店# | 行程天 | QA | heroImage");
console.log("------+---------+------+---------+-------+--------+----+----------");
for (const t of rows) {
  const [d] = await conn.execute(
    "SELECT COUNT(*) as c FROM tourDepartures WHERE tourId = ?",
    [t.id]
  );
  let it = [];
  try { it = JSON.parse(t.itineraryDetailed || "[]"); } catch {}
  const hotels = it.filter((d) => d.accommodation || d.hotelName);
  console.log(
    `${t.id} | ${(t.destinationCountry || "?").padEnd(7)} | ${(t.destinationCity || "?").padEnd(4)} | ${String(d[0].c).padEnd(7)} | ${String(hotels.length).padEnd(5)} | ${String(it.length).padEnd(6)} | ${(t.calibrationVerdict || "?").padEnd(6)}/${t.calibrationScore || "?"} | ${t.heroImage ? "✅" : "❌"}`
  );
}

await conn.end();
