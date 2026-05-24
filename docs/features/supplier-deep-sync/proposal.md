# Supplier Deep Sync — Proposal

> **Vibe Coding Stage 1 / 4** — 提案。批准後進 design.md。
> 作者：Claude (with Jeff)
> 日期：2026-05-24
> 狀態：✅ Jeff 已批准 scope + 預設 5 決策（2026-05-24 對話）

---

## 🎯 戰略 context（2026-05-24 Jeff 補充）

這個 Stage 1 不只是「擴充商品」這麼簡單。它是更大計畫的 **API platform foundation**：

- **PACK&GO 未來 = 自有 API platform**，類似 Shopify app ecosystem
- **API 消費者**：solo developer / startup（幫 PACK&GO 建工具的人，**不是**競爭對手）
- **資料原則**：Lion/UV 等供應商資料**只給 PACK&GO 自己用**（不 resale）
  - API 開放範圍 = PACK&GO 自有資料 + 開發者建工具所需的內部介面
  - 將來可能的工具：領隊 mobile app、會計師 dashboard、VIP 客戶 self-service、AI bot、partner 平台
- **本 Stage 1 設計原則**：schema + tRPC 從 day 1 就 **"API-ready"**
  - 將來加 REST adapter 套在 tRPC 上即可對外，不用重構
  - 欄位命名、版本欄、ownerType 都按 public API 標準設計
  - 不在本階段 ship 對外 API，但結構準備好

---

## 一、為什麼做（Why）

### 1.1 現況痛點

PACK&GO 已經接到 **Lion 雄獅 (4807 個產品)** + **UV 縱橫 (1148 個產品)** 的 list API，但**只有殼**：
- ✅ 有：標題、天數、出發城市、出發日、價格、可訂位
- ❌ 沒：每日行程、飯店、餐食、機票、付款條件、退費政策、注意事項、自費項目

→ Jeff 報價、AI 回答、客人在站上 browse 時，**還是要連回供應商網站看詳細**。
→ TourDetail 頁面 80% 內容靠 LLM「腦補」（從 title + days 生成假行程）。
→ InquiryAgent 客人問「9 月東京 5 天有沒有早餐？」AI 不知道 → 升給 Jeff。

### 1.2 目標收益

- **客人 UX**：TourDetail 頁面有完整真實行程，不需要外連
- **Jeff 報價**：本地查全部 detail，1 秒出 PDF（不用上 Lion 後台）
- **AI agent**：InquiryAgent / FollowupAgent / OpsAgent 看得到完整 catalog
- **SEO**：5728 個 detail-rich tour 頁面被 Google index
- **成本**：每次客人問問題不用重打 LLM 腦補 → cache hit
- **資料主權**：供應商哪天 API 改格式或漲價，我們手上有歷史快照

---

## 二、做什麼（What）

### 2.1 範圍

✅ **In scope**
- Lion 雄獅：跑 5 個 detail endpoint × 4590 active = 22,950 calls
  - `travelinfojson` — 每日行程（Day 1-N + 景點 + 飯店 + 餐食）
  - `priceinfojson` — 費用包含/不含、付款條件
  - `noticeinfojson` — 注意事項（簽證、保險、行李）
  - `optionalinfojson` — 自費項目
  - `tourinfojson` — 行程細節 metadata
- UV 縱橫：跑 2-3 個 detail endpoint × 1138 active = ~3,400 calls
  - `getProductMain` — 主要資訊
  - `getProductTravelDetail` — 每日行程
  - `getProductGroup` — 團體細節
- 新表 `supplierProductDetails`：每個 product 一份完整 detail JSON + parsed columns
- BullMQ `supplierDetailEnrichmentQueue`：rate-limited enrichment worker
- 首次 backfill：5728 個產品全跑（夜間執行）
- 日常 cron：每天追新增/更新的產品
- 失敗重試 + observability（per-supplier success rate）
- `client/src/pages/TourDetailPeony.tsx` 增加 rich content 區塊
- InquiryAgent / OpsAgent 讀取 deep detail（system prompt 加 context）

❌ **Out of scope (留下一階段)**
- 新供應商（喜鴻 / 燦星 / KKday）—— Stage 2
- 跨供應商 unified search —— Stage 3
- LLM-based 內容標準化（把 Lion 跟 UV 不同格式的飯店欄位統一）—— Stage 3
- 多語化（繁中→簡中/英文翻譯）—— Stage 3

### 2.2 容量與成本

| 項目 | 估算 |
|------|------|
| API calls (one-off backfill) | ~26,400 |
| API calls (daily ongoing) | ~200-500（新增/變更產品） |
| 儲存大小 | ~573MB（每 product detail 平均 100KB JSON）|
| TiDB 容量影響 | 可接受（目前用 < 5%）|
| Backfill 執行時間（rate-limit 2s/call, 5 workers concurrent）| ~3-4 小時 |
| LLM 成本影響 | 預期 **下降** — 客人問問題不再 brain-storm，從 catalog 直答 |

### 2.3 風險

1. **供應商 ban / 限流**
   - Mitigation: 2 sec interval per call + jitter + 5 workers max + exponential backoff
   - Lion / UV 過去都沒有 strict rate limit policy，但保守設計

2. **API response format 變動**
   - Mitigation: 永遠存 `rawJson`（不丟資料），parsed columns 解析失敗也不爆 — 用 `parseStatus` enum (parsed / parse_failed / missing)

3. **Detail JSON 太肥**
   - Worst case: 某產品 detail 500KB+
   - Mitigation: `mediumtext` MySQL column 上限 16MB，沒問題。但 admin UI 別一次 load 全部 — paginate

4. **過時資料**
   - Detail 一天 sync 一次。如果供應商當天改價/改行程，本地 24h 內可能 stale
   - Mitigation: `lastSyncedAt` 顯示在 TourDetail，客人 booking 流程前 check `getDeparturesNext180Days` 即時座位

---

## 三、不做什麼（Won't）

- **不改現有 list sync**（Lion search + UV list）— 跑得好好的別動
- **不做即時 sync**（webhook from supplier）— 沒有這個 API
- **不爬蟲**（HTML scraping）— Lion / UV 都有 JSON API
- **不換供應商**（不接 Trip.com / KKday / Klook 來替代）— 那是 Stage 2 議題
- **不做客戶可購買** — TourDetail 還是現有的詢價/聯絡流程，不改

---

## 四、成功標準（Done = ）

- [ ] Migration 0083_supplier_product_details.sql 跑通
- [ ] BullMQ worker `supplierDetailEnrichmentWorker.ts` 啟動 + healthcheck OK
- [ ] First backfill 跑完，5728 個產品 100% 有 row in `supplierProductDetails`
  - 容忍 ~5% parse_failed（hand-fix or schedule retry）
- [ ] TourDetail 頁面（Lion 跟 UV 各挑一個產品）顯示完整 itinerary + hotels + meals + policy
- [ ] InquiryAgent demo：客人問「Lion 東京 5 天 hotel 是什麼？」直接答出來，不升 Jeff
- [ ] Daily cron 跑通：每天 03:00 (UTC) 撈新增/變更產品 enrichment
- [ ] Vitest cover: detail sync service + parse + worker
- [ ] tsc + pre-commit lint 過

---

## 五、預計時程

3-4 個工作天（Boil the lake，一次到位）：

- **Day 1**：design.md + tasks/*.md + 寫 schema migration + shared enrichment helper
- **Day 2**：Lion detail enrichment（5 endpoints × parse + store）+ Vitest
- **Day 3**：UV detail enrichment（3 endpoints）+ Vitest + BullMQ worker
- **Day 4**：TourDetail render + InquiryAgent context wire + backfill kick-off

---

## 六、批准項目（Decisions Needed）

請 Jeff 確認以下 5 個決策：

| # | Decision | 預設選項（推薦）| 替代方案 |
|---|----------|----------------|---------|
| D1 | Backfill 何時跑 | 今晚 UTC 23:00（PST 16:00）一次跑完 | 分批，每天跑 1000 個 |
| D2 | Sync 頻率 | 每天 03:00 UTC 抓 24h 內新增/變更 | 每週一次 / 每 6 小時 |
| D3 | Rate limit | 2 sec/call, 5 workers concurrent | 1 sec/call (快 2x 但風險高)|
| D4 | TourDetail 頁面改動範圍 | 加 4 個新區塊：行程 / 飯店 / 餐食 / 注意事項 | 只加 1 個「完整詳情」摺疊區 |
| D5 | InquiryAgent 看 detail 的方式 | system prompt inject 整個 detail JSON | RAG / vector search 摘要 |

---

## 七、Stage 2-4 預告（不在此次 scope）

| Stage | 內容 |
|-------|------|
| 2 | 加 3 個新供應商：喜鴻 / 燦星 / KKday |
| 3 | 跨供應商 unified search（客人搜尋一次回多家報價）|
| 4 | Local-first：報價/agent 思考 100% 本地，API 退到只 daily cron + booking-time 即時座位 check |

---

## 待辦

- ⏳ Jeff 看完後在 5 個 decision 留意見（或直接 approve all defaults）
- ⏳ 批准後：寫 design.md（含 schema 詳細欄位、tRPC 介面、worker pseudocode）
- ⏳ 然後 tasks/*.md（每個模組獨立 checklist）
- ⏳ 最後 coding（按 task 順序，每完成一個跑 tsc + Vitest）
