// Count tours with placeholder content + recover wrongly-tagged destinationCountry
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 1) Active tours with placeholder description (LLM rewrite failed silently)
const [placeholderRows] = await conn.execute(
  `SELECT COUNT(*) AS n
   FROM tours
   WHERE status = 'active'
     AND description = '探索精彩行程，體驗難忘旅程。'`
);
console.log("ACTIVE tours with literal placeholder description:");
console.table(placeholderRows);

// 1b) Same but extended — any short/template content
const [shortRows] = await conn.execute(
  `SELECT COUNT(*) AS n
   FROM tours
   WHERE status = 'active'
     AND LENGTH(description) <= 50`
);
console.log("ACTIVE tours with descLen ≤ 50:");
console.table(shortRows);

// 2) Active "Japan" tours misclassified as 台灣/桃園 (title contains 日本 keywords but country = 台灣)
const [misclassRows] = await conn.execute(
  `SELECT id, title, destinationCountry, destinationCity, calibrationScore,
          LENGTH(description) AS descLen
   FROM tours
   WHERE status = 'active'
     AND destinationCountry = '台灣'
     AND (
       title LIKE '%日本%' OR title LIKE '%東北%' OR title LIKE '%北海道%'
       OR title LIKE '%沖繩%' OR title LIKE '%九州%' OR title LIKE '%關西%'
       OR title LIKE '%東京%' OR title LIKE '%大阪%' OR title LIKE '%京都%'
       OR title LIKE '%名古屋%' OR title LIKE '%福岡%'
       OR title LIKE '%仙台%' OR title LIKE '%青森%' OR title LIKE '%出羽%'
       OR title LIKE '%合掌村%' OR title LIKE '%五能線%' OR title LIKE '%奧入瀨%'
       OR title LIKE '%藏王%' OR title LIKE '%只見川%' OR title LIKE '%星宇%' AND title LIKE '%球%'
     )
   ORDER BY id ASC`
);
console.log("\nActive tours destination=台灣 but Japan-keyword in title:");
console.table(misclassRows);

// 3) Cross-check: poeticTitle uses template format "${city}${days}日精選之旅"
const [poeticTpl] = await conn.execute(
  `SELECT COUNT(*) AS n
   FROM tours
   WHERE status = 'active'
     AND poeticTitle REGEXP '^[一-鿿]+[0-9]+日精選之旅$'`
);
console.log("\nACTIVE tours with template poeticTitle (X日精選之旅):");
console.table(poeticTpl);

// 4) Combined — active tours that are likely broken
const [broken] = await conn.execute(
  `SELECT id, title, destinationCountry, destinationCity, calibrationScore,
          LENGTH(description) AS descLen, poeticTitle
   FROM tours
   WHERE status = 'active'
     AND (
       description = '探索精彩行程，體驗難忘旅程。'
       OR poeticTitle REGEXP '^[一-鿿]+[0-9]+日精選之旅$'
     )
   ORDER BY id DESC`
);
console.log("\nALL ACTIVE BROKEN tours (placeholder content OR template poeticTitle):");
console.table(broken);

await conn.end();
