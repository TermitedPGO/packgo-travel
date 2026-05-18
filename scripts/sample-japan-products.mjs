// Sample Japan supplier products to pick a test batch
// 從 supplierProducts 撈 Lion 的 30 個 Japan tour 候選
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Find Lion supplier id
const [supRows] = await conn.execute(
  `SELECT id, code, displayName FROM suppliers WHERE code = 'lion' LIMIT 1`
);
console.log("Suppliers:", supRows);
const lionId = supRows[0]?.id;
if (!lionId) {
  console.error("Cannot find Lion supplier id");
  process.exit(1);
}
console.log(`Using Lion supplierId=${lionId}\n`);

// First: overview of available Japan products
console.log("=== Japan products available by keyword ===");
const keywords = ["沖繩", "北海道", "東京", "大阪", "京都", "九州", "東北"];
for (const kw of keywords) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS n FROM supplierProducts
     WHERE supplierId = ?
       AND title LIKE ?
       AND status = 'active'
       AND isHiddenByAdmin = 0`,
    [lionId, `%${kw}%`]
  );
  console.log(`  ${kw}: ${rows[0].n}`);
}

// Pick 30 test candidates: 10 each from 沖繩 / 北海道 / 東京
console.log("\n=== Test batch candidates (30 tours: 10 each 沖繩/北海道/東京) ===");
const candidates = [];
for (const kw of ["沖繩", "北海道", "東京"]) {
  const [rows] = await conn.execute(
    `SELECT externalProductCode, title FROM supplierProducts
     WHERE supplierId = ?
       AND title LIKE ?
       AND status = 'active'
       AND isHiddenByAdmin = 0
     ORDER BY id ASC
     LIMIT 10`,
    [lionId, `%${kw}%`]
  );
  console.log(`\n--- ${kw} ---`);
  for (const r of rows) {
    console.log(`  ${r.externalProductCode}  ${r.title?.slice(0, 70)}`);
    candidates.push(r.externalProductCode);
  }
}

console.log(`\n=== ${candidates.length} candidate IDs ===`);
console.log(JSON.stringify(candidates));

await conn.end();
