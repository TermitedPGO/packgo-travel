// Seed demo agentMessages so Jeff can validate ChatsTab UI
// 2026-05-17 — illustrative messages spanning all 6 message types + priorities
// Safe to run multiple times — uses TIMESTAMPDIFF guard to avoid daily dupes.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });

// Check existing recent demo seeds — skip if we already seeded in last 24h
const [existing] = await c.execute(
  `SELECT COUNT(*) AS n FROM agentMessages
   WHERE createdAt > NOW() - INTERVAL 24 HOUR
     AND title LIKE '[DEMO]%'`
);
if (existing[0].n > 0) {
  console.log(`Already have ${existing[0].n} demo messages in last 24h — skipping seed.`);
  await c.end();
  process.exit(0);
}

const messages = [
  // ─── InquiryAgent — 客戶 inquiry routing ───
  {
    agentName: "inquiry",
    messageType: "observation",
    title: "[DEMO] 已分類: 北海道團詢問 → QuoteAgent",
    body: "Email 來自 jane@example.com (24h 內第 2 次)\n關鍵字: 北海道、8月、親子\n判定為高意願 → 已轉交 QuoteAgent 出 3 個方案\n\n（這是示範訊息，可標記已讀）",
    priority: "normal",
  },
  {
    agentName: "inquiry",
    messageType: "question",
    title: "[DEMO] 客戶問素食 — 是否加 35% surcharge?",
    body: "客戶: 李太太 (Plus 會員)\n團: 8/22 沖繩慢遊 5 日\n問題: 「我先生吃全素，行程能配合嗎？」\n\nProfile 顯示李先生確實素食 (歷史記錄)。\n建議: A. 加 35% 餐費差額  B. 行程不變但餐廳調整  C. 不額外收費 (VIP 對待)",
    priority: "high",
  },

  // ─── RefundAgent — 退款場景 ───
  {
    agentName: "refund",
    messageType: "proposal",
    title: "[DEMO] 退費請求 #4521 — 規則內可自動退 $1,080",
    body: "客戶 王太太 申請取消 8/15 北海道團。\n距離出發 32 天 → 政策內 90% 退款\n原始金額: $1,200\n建議退: $1,080 (扣 10% 行政費)\n\n是否批准自動執行? Approved → Stripe API 退款 + Trust deferral 釋放 + email 客戶 + BooksAgent 記帳",
    priority: "normal",
  },
  {
    agentName: "refund",
    messageType: "escalation",
    title: "[DEMO] 規則外退費 — 客戶醫療證明，建議酌情處理",
    body: "客戶 陳先生 取消 5/30 京都團 (距出發 4 天)\n規則: 30% = $360\n客戶提供: 心臟科醫師「不適合搭機」證明\n\n建議: 改 70% = $840 (Concierge 酌情處理)\n\n如批准，OpsAgent 會釋放他的座位 + 通知領隊",
    priority: "high",
  },

  // ─── CampaignAgent (marketing) — 行銷 ───
  {
    agentName: "marketing",
    messageType: "observation",
    title: "[DEMO] Newsletter 6/15 已發送給 87 位 Plus 會員",
    body: "主題: 「夏日北海道，5 個你沒去過的秘境」\nSegment: 興趣含 '北海道' OR 'nature' 的 Plus+ 會員\nOpen rate: 待 24h 後更新\n\nposter (gpt-image-2 生): https://r2.../poster-hokkaido-summer.png",
    priority: "low",
  },

  // ─── FollowupAgent — 報價跟進 ───
  {
    agentName: "followup",
    messageType: "alert",
    title: "[DEMO] 報價 #2871 出去 7 天未付訂 — 客戶可能流失",
    body: "客戶: 黃小姐 (guest)\n行程: 沖繩 4 天豪華 $4,200\n報價時間: 5/10\n發送跟進: 24h ✓ / 3 天 ✓ / 7 天 ✓\n\n仍無回應。建議: 你是否要直接 WhatsApp 一句? 或讓 InquiryAgent 改用更積極的話術做最後一次嘗試?",
    priority: "high",
  },

  // ─── RetrospectiveAgent — 週度政策提案 ───
  {
    agentName: "self_retrospective",
    messageType: "digest",
    title: "[DEMO] 本週政策提案 (3 條)",
    body: "本週 agent 行為分析：\n\n1. 95% 的 <$500 退款你直接 approve → 建議改自動規則「< $500 + 距出發 >14 天 → 自動退」\n   預估省你每週 30 分鐘\n\n2. 北海道 keyword 客戶 conversion rate 比沖繩高 2.3 倍 → 建議下批 catalog 補貨優先北海道\n\n3. InquiryAgent 對「親子」keyword 信心 < 70% — 建議加 'kid-friendly' 標籤訓練集",
    priority: "normal",
  },
];

let inserted = 0;
for (const m of messages) {
  await c.execute(
    `INSERT INTO agentMessages (agentName, senderRole, messageType, title, body, priority, readByJeff)
     VALUES (?, 'agent', ?, ?, ?, ?, 0)`,
    [m.agentName, m.messageType, m.title, m.body, m.priority]
  );
  inserted++;
  console.log(`  + ${m.agentName} / ${m.messageType}: ${m.title.slice(0, 60)}`);
}

console.log(`\n✅ Seeded ${inserted} demo agentMessages.`);
console.log(`Open https://packgoplay.com/admin → Office → 聊天 to see them.`);
await c.end();
