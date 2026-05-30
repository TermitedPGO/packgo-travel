# Proposal — Runtime Bot-UA Dynamic Rendering（爬蟲預渲染）

> Stage 1 of §9.1. 換新對話進 design.md 前先讀完此檔。

## 問題（為什麼做）

packgoplay.com 是 client-side-only Vite SPA。raw HTML 只有一個空殼：
`<div id="root">` 空、`<title>` 是通用「PACK&GO 旅行社」、**0 筆 JSON-LD**、無 meta description。
所有 SEO 投資（[SEO.tsx](../../../client/src/components/SEO.tsx) 的 TravelAgency / FAQPage / TouristTrip / hreflang / OG）**全靠 react-helmet 在瀏覽器跑 JS 才注入**，進不了 raw HTML。

2026-05-29 curl 實測（`-A "Googlebot"`）：5,814 bytes 空殼、`grep -c 'ld+json'` = **0**。

**後果：** Perplexity / GPTBot / ClaudeBot 等 AI 答案引擎**不跑 JS** → 對 AEO 等於不存在。Googlebot 雖可能延遲補跑 JS，但不可靠。實測品牌詞「PACK&GO Travel」citation ~0%。

## 目標（做到什麼）

對**爬蟲與 AI bot**，在 raw HTML 直接吐出完整渲染結果（title + meta + JSON-LD + body 內容）。**真人不受影響**，照拿原本的 SPA。

## 成功標準（可量測）

部署後，以下指令對每條關鍵路由都要成立：

```bash
curl -sL -A "Googlebot" https://packgoplay.com/        | grep -c 'ld+json'   # > 0
curl -sL -A "PerplexityBot" https://packgoplay.com/about-us | grep -c 'ld+json'  # > 0
curl -sL -A "Googlebot" https://packgoplay.com/faq     | grep -i "description" # meta description 存在
curl -sL -A "Googlebot" https://packgoplay.com/tours/<id> | grep -c 'TouristTrip' # > 0（含 DB 資料）
```

外加：真人（一般瀏覽器 UA）拿到的 HTML **不變**（仍是 SPA 殼 + 客戶端 hydrate）。

## 範圍

**In：**
- bot UA 偵測 middleware（Googlebot / bingbot / PerplexityBot / ClaudeBot / GPTBot / OAI-SearchBot / Google-Extended / Applebot / Bytespider / facebookexternalhit / Twitterbot / LinkedInBot / Slackbot 等）
- 用既有 [puppeteerPool.ts](../../../server/_core/puppeteerPool.ts) 對 live server 渲染請求路由
- Redis 快取渲染結果（既有 ioredis / Upstash），TTL 24h，部署 bump 版本
- env flag 一鍵開關 + 渲染失敗 graceful fallback 到原本空殼
- Vitest 測試

**Out（非目標）：**
- 真人 SSR（不改 humans 的路徑）
- build pipeline 變更、router 遷移（不碰 Wouter）、Vike/Next/Remix
- 改 SEO.tsx / 加更多 schema（現有 schema 已寫好，渲染後自然進 HTML）

## 為什麼選這條（Option B）而非其他

| 方案 | 否決原因 |
|------|---------|
| build-time 靜態預渲染（Option A） | 不含 DB 動態 tour 頁；build 時無 DB → 動態列表渲染成空 |
| vite-react-ssg | 需要 React Router，本專案用 Wouter |
| 真 SSR / Vike | tRPC + React-Query 資料流要全改 server prefetch + dehydration，重構過大，殺雞用牛刀 |

**Option B 之所以低風險：** Chromium + CJK 字型**已在 prod Docker image**（給 PDF 用）、Redis **已在跑**（BullMQ）、browser pool（`acquirePage`/`releasePage`，並發上限 2、自動重啟、SIGTERM 已接）**已存在**。不需新增重依賴、不改 build/router。

## 已知風險（design.md 要處理）

1. **1GB VM 記憶體** — 渲染與 PDF 共用 pool 的 2 個 page slot；靠 Redis 快取讓穩態幾乎 0 次渲染。
2. **Dynamic Rendering「cloaking」觀感** — Google 官方文件認可「動態渲染」，內容一致即不罰；且這是 JS-less AI 引擎唯一能看到內容的方式。渲染同一個 URL、不改內容 → parity 成立。
3. **渲染 ready 時機** — 部分頁有輪詢（tour 生成狀態）。需可靠的「渲染完成」訊號，不能無限等 networkidle。
4. **內部渲染請求避免無限迴圈** — headless Chrome 對自己 server 發的請求 UA 不可在 bot 名單內，否則 middleware 又攔它。

## 待 Jeff 確認

無 blocker。direction 已選 Option B。下一步寫 design.md（模組劃分），再開 coding。
