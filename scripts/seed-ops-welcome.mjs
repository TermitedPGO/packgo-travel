// Seed welcome message in #ops channel
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });

const [existing] = await c.execute(
  `SELECT COUNT(*) AS n FROM agentMessages WHERE agentName = 'ops'`
);
if (existing[0].n > 0) {
  console.log(`#ops already has ${existing[0].n} messages — skipping welcome seed.`);
  await c.end();
  process.exit(0);
}

await c.execute(
  `INSERT INTO agentMessages (agentName, senderRole, messageType, title, body, priority, readByJeff)
   VALUES (?, 'agent', ?, ?, ?, ?, 1)`,
  [
    "ops",
    "observation",
    "OpsAgent 已上線 — 開始問我問題吧",
    `Hi Jeff,

我是 OpsAgent。在這個 #ops channel 上方有個輸入框,你可以用自然語言問我任何旅團運營問題,例如:

  • "李太太那團幾號出發?"
  • "6 月日本團還有位嗎?"
  • "8/22 沖繩團 leader 誰?"
  • "下週要出發的團都還沒指派領隊的有哪些?"

我會查你的:
  • tour catalog (PACK&GO 包裝的行程)
  • tourDepartures (每個團期 + 你的私人運營筆記)
  • bookings (客戶訂位)
  • customerProfiles (客戶 CRM)

每次問完,問題 + 我的回答都會留在這個 channel,你之後可以回頭翻。

⌘ + Enter 是快速送出快捷鍵。`,
    "low",
  ]
);

console.log("✅ Seeded #ops welcome message");
await c.end();
