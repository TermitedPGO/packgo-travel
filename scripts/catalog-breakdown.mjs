// Breakdown of supplier catalog — how many tours per category
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== Total catalog (active, not hidden) ===");
const [tot] = await conn.execute(
  `SELECT s.code, COUNT(*) AS n
   FROM supplierProducts p
   JOIN suppliers s ON s.id = p.supplierId
   WHERE p.status = 'active' AND p.isHiddenByAdmin = 0
   GROUP BY s.code`
);
console.table(tot);

console.log("\n=== Lion catalog by destinationCountry ===");
const [byCountry] = await conn.execute(
  `SELECT destinationCountry, COUNT(*) AS n
   FROM supplierProducts p
   JOIN suppliers s ON s.id = p.supplierId
   WHERE s.code = 'lion' AND p.status='active' AND p.isHiddenByAdmin = 0
   GROUP BY destinationCountry
   ORDER BY n DESC
   LIMIT 30`
);
console.table(byCountry);

console.log("\n=== Lion: estimated total by keyword (overlaps possible) ===");
const buckets = [
  { label: "日本",   pattern: ["日本", "沖繩", "北海道", "東京", "大阪", "京都", "九州", "東北", "關西", "名古屋", "福岡", "仙台"] },
  { label: "韓國",   pattern: ["韓國", "首爾", "釜山", "濟州"] },
  { label: "東南亞", pattern: ["泰國", "曼谷", "越南", "印尼", "峇里", "新加坡", "馬來西亞", "菲律賓"] },
  { label: "歐洲",   pattern: ["歐洲", "英國", "法國", "義大利", "德國", "西班牙", "瑞士", "希臘", "土耳其", "北歐", "東歐", "西歐", "南歐"] },
  { label: "美洲",   pattern: ["美國", "美西", "美東", "加拿大", "紐約", "洛杉磯", "夏威夷", "墨西哥"] },
  { label: "中東/非洲", pattern: ["杜拜", "埃及", "摩洛哥", "南非", "肯亞"] },
  { label: "大洋洲", pattern: ["澳洲", "紐西蘭"] },
  { label: "中港澳", pattern: ["中國", "香港", "澳門"] },
  { label: "台灣國旅", pattern: ["台灣", "花蓮", "墾丁", "阿里山", "日月潭", "澎湖"] },
];
for (const b of buckets) {
  const where = b.pattern.map((p) => `title LIKE '%${p}%'`).join(" OR ");
  const [r] = await conn.execute(
    `SELECT COUNT(DISTINCT p.id) AS n FROM supplierProducts p
     JOIN suppliers s ON s.id = p.supplierId
     WHERE s.code='lion' AND p.status='active' AND p.isHiddenByAdmin=0
       AND (${where})`
  );
  console.log(`  ${b.label}: ${r[0].n}`);
}

await conn.end();
