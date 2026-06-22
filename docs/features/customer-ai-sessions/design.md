# 客戶 AI Sessions — Stage 2 Design

> 狀態:Stage 2 設計定稿(2026-06-22)。承接 `proposal.md`(Stage 1 已拍板)。
> 這份文件鎖死:模組劃分、依賴關係、prompt 設計、快取策略、schema 變更、測試計畫。
> Stage 3 拆 `tasks/`,Stage 4 寫 code + Vitest。

---

## 一、診斷結論(改寫 proposal 的猜測)

proposal §五.4 怕對話框「卡在 DB 或 LLM」。實測 prod log 推翻這個猜測:

抓到 Jenny 那次實測(`customerProfileId=2550004`,2026-06-22 22:25 UTC):

```
[ask-ops-stream] first token   ms:1283    ← 伺服器 1.28 秒就吐第一個 token
[ask-ops-stream] done          ms:8191    ← 8.2 秒整段答完
responseTime: 8438             content-encoding: br   ← 關鍵
```

- 那條 90s timeout 的 error log 沒跳。伺服器這端健康:撈 context + LLM 首 token 都在 1.3 秒內完成。
- 真因在「送達」層:SSE 回應被 Brotli 壓縮(`content-encoding: br`)。`server/_core/index.ts:63` 的 `app.use(compression())` 是全域預設,會把 `text/event-stream` 一起壓。壓縮中介層把 token 卡在 brotli 緩衝,瀏覽器整串結束(約 8 秒)前看不到任何字 → 打字後盯著空白。
- 2026-05-31 加的 `res.flush()` workaround 不可靠(brotli flush 語意 + Fly edge proxy)。已驗證 `compression@1.8.1` index.js:294-299 會在看到 `Cache-Control: no-transform` 時整段跳過壓縮 → 這是乾淨的根治法。
- 壓縮買單之外,對話框跑 Opus 4.8(`OPS_CHAT_MODEL`)+ 6 輪 agentic tool loop,整段本來就久(8 到 15 秒),被壓縮一卡空白就更長。

→ 修對話框 = (a) SSE 那條關壓縮 + (b) 客人 scope 改 Haiku(快又便宜)。兩者都不碰 DB/LLM stall,因為根本沒 stall。

---

## 二、Jeff 已拍板(全部鎖死)

| # | 決策 | 來源 |
|---|------|------|
| 1 | 摘要 = 背景算 + 快取 + 重算鈕 | proposal §五.1 |
| 2 | 文件深度 = 檔名+類型 + PDF 內容全讀 | proposal §五.2 + 本 session Q2 |
| 3 | 摘要/對話 LLM = Haiku(便宜快) | proposal §五.3 |
| 4 | 對話框先診斷(已完成,見 §一) | proposal §五.4 |
| 5 | 摘要算法 = cron 暖最近有動靜的 + 開卡補算其餘(兩者都要) | 本 session Q1 |
| 6 | 對話框 PDF = 每次都全讀(內文進 prompt) | 本 session Q2 |

---

## 三、架構總覽:一顆引擎,三個出口

```
                         ┌──────────────────────────────────────┐
                         │  buildCustomerAiContext(scope)        │
                         │  撈這位客人的真實資料(只搬運):       │
   DB (Drizzle) ────────▶│   · profile / keyFacts / preferences  │
   R2 (storage) ────────▶│   · 對話(來信+回覆)/ 訂單 / 詢問 / 報價 │
                         │   · 文件清單 + PDF 全文(抽取,不另存)│
                         └───────────────┬──────────────────────┘
                                         │  +共用經驗(Jeff 口氣 + 紅線)
                          ┌──────────────┼───────────────┐
                          ▼              ▼               ▼
                   AI 摘要+下一步     AI 對話框        (未來其他卡)
                   (Haiku, 批次)    (Haiku, SSE 串流)
                          │              │
                   存快取(只存結論)   即時串流(唯讀)
```

核心:`buildCustomerAiContext` 是唯一的「讀客人」入口。摘要引擎、對話框 context 都吃它。寫一次,三個積木一起活。

「scope」= 註冊客人(userId)或訪客(customerProfileId)。Jenny 是訪客(profileId 2550004)。引擎內部把兩種 scope 都解析到同一份 context shape。

---

## 四、模組劃分 + 依賴

| 模組 | 名稱 | 產出 | 依賴 | 可獨立做? |
|------|------|------|------|-----------|
| **M0** | SSE 關壓縮 | 對話框立刻復活 | 無 | ✅ 先做,最快見效 |
| **M1** | 文件全文抽取 helper | `buildCustomerDocsText(docs)` | attachmentParser, storage | ✅ |
| **M2** | 客人 AI context 引擎 | `buildCustomerAiContext(scope)` | M1 + DB | M1 |
| **M3** | AI 摘要生成 + 快取 + cron | schema 欄、engine、tRPC query/mutation、cron+worker | M2, llm(Haiku) | M2 |
| **M4** | 對話框讀文件 + Haiku | 改 `customerChatContext` 注入 doc 全文;客人 scope 走 Haiku | M1, M0 | M0+M1 |
| **M5** | 前端點亮 | 摘要讀快取、下一步 render、重算鈕、stale 指示、i18n | M3 | M3 |

關鍵順序:**M0 先上**(一行,救對話框,可單獨 commit/ship)。M1→M2→M3→M5 是摘要主線。M4 接在 M0+M1 後。

---

## 五、各模組詳細設計

### M0 — SSE 關壓縮(對話框復活)

改 `server/_core/index.ts` ask-ops-stream 的 SSE header:

```ts
// 現在(line ~455)
res.setHeader("Cache-Control", "no-cache");
// 改成 — no-transform 讓 compression@1.8.1 整段跳過壓縮(已驗 index.js:298)
res.setHeader("Cache-Control", "no-cache, no-transform");
```

零風險:SSE 是小量增量事件,壓縮無收益。其他路由不受影響(只改這條回應的 header)。

測試:`server/_core/sseCompression.test.ts` — 用 supertest 打 ask-ops-stream(或抽一個 pure helper 驗 header 含 `no-transform`)。最低限度驗 header 設定正確。

### M1 — 文件全文抽取 helper

新檔 `server/_core/customerDocsText.ts`:

```ts
export interface DocRef { kind: string; name: string; url: string | null }
export interface DocsTextResult {
  list: string;        // 給 prompt 的「文件清單」一段(檔名+類型+金額)
  fullText: string;    // 所有 PDF 抽出的內文(capped),只進 prompt 不另存
  readCount: number;   // 成功讀到內文的份數
}
export async function buildCustomerDocsText(docs: DocRef[]): Promise<DocsTextResult>
```

行為:
- 對每份有 `url`、且副檔名/類型可抽文字的文件(pdf/xlsx/docx/...),平行 `storageGet(key)` → `parseAttachment(name, mime, buf)`(已含 PDF text + 掃描件 OCR fallback)。
- url 可能是 R2 key 或完整 http(s);沿用 `signDocUrl`/storage 的判斷把 key 解析成可讀位元組。http 外連走 fetch。
- 上限:單檔沿用 `attachmentParser` 的 `MAX_TEXT_CHARS`(50KB);整體再加總上限(預設 60KB,放 const `MAX_DOCS_TOTAL_CHARS`),超過截斷並標記。
- **PII 鐵則**:回傳值只用於組 prompt,呼叫端絕不寫 DB / 檔案。helper 自己不碰 DB。

純函式可測部分:格式化「文件清單」字串、總長截斷邏輯(注入假 parser 結果)。IO 部分(storage+parse)整合測試或 mock。

### M2 — 客人 AI context 引擎

新檔 `server/_core/customerAiContext.ts`:

```ts
export type CustomerScope = { userId: number } | { profileId: number }
export interface CustomerAiContext {
  header: string;          // 客人是誰(訪客/註冊)
  conversation: string;    // 近 N 則來信+回覆(摘要或片段)
  structured: string;      // 訂單/詢問/報價(只搬運事實)
  keyFacts: string;        // profile.keyFacts + preferences 摘要
  docsList: string;        // 文件清單
  docsFullText: string;    // PDF 全文(M1,不另存)
}
export async function buildCustomerAiContext(scope: CustomerScope): Promise<CustomerAiContext | null>
```

- 重用既有 `customerChatContext.ts` 的撈法(那邊已有 registered + guest 兩條 query 路徑),抽共用,避免兩套。
- 解析 scope:userId → 找 profile(沒有就視為純 user,docs 走 userId docs 來源);profileId → guest。文件來源沿用 `customerDocs` 那 5 個來源的撈法(aiQuotes/invoices/customerDocuments/flightOrders/customOrders)。
- DB 掛了 → 回 null(呼叫端降級,絕不讓引擎掛掉整個請求,沿用既有 degrade-to-null 模式)。

### M3 — AI 摘要生成 + 快取 + cron

**Schema(migration)**:`customerProfiles` 加兩欄
```ts
aiSummary: json("aiSummary"),        // { wants, actions, delivered, nextStep, model, error? }
aiSummaryAt: timestamp("aiSummaryAt"), // 算的時間;null=從沒算過
```
> 不複用 `aiNotes`(那欄是 CustomerProfileExtractor 的觀察,語意不同)。
> **快取只存「結論」(business 摘要),不存 PDF 原文/PII。** prompt 明令輸出不得含護照號/DOB。

**Engine** `server/_core/customerAiSummary.ts`:
```ts
export interface AiSummary { wants: string; actions: string; delivered: string; nextStep: string }
export async function generateCustomerAiSummary(scope): Promise<AiSummary>  // 跑 LLM
export async function refreshAndStoreSummary(scope): Promise<AiSummary>     // 跑+寫快取(ensure profile)
```
- `generate`:`buildCustomerAiContext` → 組 prompt(§六) → `invokeLLM({ model: HAIKU, ... })` structured output(四欄)→ 回 AiSummary。
- `refreshAndStore`:跑 generate,寫 `aiSummary`+`aiSummaryAt`。註冊客人若無 profile row 先 ensure 建一筆(by userId)。

**tRPC**(`server/routers/adminCustomers.ts`,用 `adminProcedure`):
- `customerAiSummary({ userId? | profileId? })` query → 讀快取 `{ summary | null, generatedAt, stale }`。`stale` = `aiSummaryAt` 為 null 或早於該客人最近一次活動(lastInteractionAt / 最新 booking/quote/doc),或超過 24h。
- `refreshCustomerAiSummary({ userId? | profileId? })` mutation → `refreshAndStoreSummary` → 回新 summary。受 adminProcedure 60/min throttle 保護。

**Cron**(沿用 `server/queue.ts` BullMQ 模式,如 `scheduleDailyTripReminders`):
- `scheduleDailyCustomerSummaries()` 每日一次(挑離峰,如 02:00 UTC)。
- worker 找「活躍 + stale」客人:`lastInteractionAt` 在近 N 天(預設 30)內、且(`aiSummaryAt` 為 null 或 早於最近活動)。逐一 `refreshAndStoreSummary`,限流 + try/catch 單筆失敗不炸整批。
- 這就是 Q1 的「cron 暖最近有動靜的」;開卡補算(M5 lazy)補「其餘」。只 recompute 真的變動過的客人 → cron 成本有界(不會每晚重讀沒變的 PDF)。

### M4 — 對話框讀文件 + 客人 scope 走 Haiku

1. **讀文件**:`customerChatContext.ts` 的 `buildCustomerChatContext` / `buildGuestChatContext` 末尾接 M1 的 doc 全文,把 `docsList` + `docsFullText` 併進回傳的 block(就是 ask-ops-stream 的 `extraSystem`)。`extraSystem` 已落在 opsAgentStream 的 **cached system block**(`cache_control: ephemeral`),所以同一段對話內重複 turn 的 doc tokens 走 prompt cache(約 90% 便宜)→ 抵銷「每次全讀」的成本,首 turn 付全額。
   - block 上限要放大(現 `BLOCK_CAP=2400` 太小裝不下 PDF 全文);doc 全文另開上限(沿用 M1 的 60KB),與既有 2400 的「pin 區塊」分開拼。
2. **Haiku for customer scope**:`runOpsAgentStream` 多收一個 `model?` 參數;ask-ops-stream 在 `customerId`/`customerProfileId` 非空時傳 Haiku,全域 #ops 維持 `OPS_CHAT_MODEL`(Opus)。客人對話多是「搬運這位客人的事實」,Haiku 夠用且快。tool loop 保留(Haiku 支援 tool use),但 context 已 pin,通常零 tool round。

### M5 — 前端點亮

- `types.ts`:`aiSummary` 加 `nextStep: string`;加 `aiSummaryMeta?: { generatedAt: Date | null; stale: boolean; generating: boolean }`。
- `useCustomerData.ts`:加 `trpc.admin.customerAiSummary.useQuery`。有快取 → 用快取(秒開);`stale` 或 null → 顯示舊值/規則 fallback 並背景觸發 `refreshCustomerAiSummary`(lazy on-open),算完 invalidate 重讀。`deriveAiSummary`(規則版)保留為 fallback(快取還沒算好 / LLM 失敗時顯示)。
- `DetailTabs.tsx`:
  - line 46-48 的 wants/actions/delivered 改吃快取 summary(fallback 規則版)。
  - line 96-97 的「下一步」placeholder 換成 `aiSummary.nextStep`。
  - 摘要區加「重新整理」按鈕(rounded-lg,圖示 RefreshCw)→ 呼 refresh mutation;算的時候轉圈;旁邊小字標 generatedAt(如「3 小時前更新」)。
- i18n:`zh-TW.ts` / `en.ts` 加 refresh 按鈕、generating、updatedAgo、stale 文案;`aiPending` placeholder 退役(或留作 LLM 失敗 fallback)。

---

## 六、Prompt 設計

共用 system(摘要 + 對話都注入,= proposal 的「共用經驗」):

```
你是 PACK&GO(Jeff 的美國旅行社)後台助理,只服務 Jeff 本人(admin 內部)。
鐵則:
1. 只搬運下面提供的這位客人的真實資料,不杜撰價格/日期/事實。查無 → 說查無,不腦補。
2. 文字走 Jeff 口氣:口語、自然、簡短;不用破折號、不用打勾符號、不官方腔。
3. 訂金 ≠ 營收(CST §17550):出發前的訂金是 Trust 代管,不是已實現營收;要談錢據此判斷,不自己改規則。
4. 供應商成本/同業價是內部數字,絕不寫進任何「給客人看」的草稿。
5. 護照號、生日等 PII 絕不出現在摘要輸出裡。
（下面是這位客人的資料……）
```

**摘要**(structured output,四欄,各一兩句):
- `wants` 客人現在要什麼(從對話/詢問/開著的單推斷)
- `actions` 我們做了什麼(已寄報價/已回信/已訂…)
- `delivered` 給了什麼(已交付的報價/行程/確認書)
- `nextStep` 下一步該做什麼(一句可執行,例:「補寄 12 月台灣團含早鳥價」)

**對話**:沿用既有 ops agent system + tools,額外注入這位客人的 context block(含 doc 全文)。維持唯讀:對話框只答/只擬,不代寄不代改(suggest_action chip 仍要 Jeff 點+二次確認)。

---

## 七、紅線檢查表(設計層先擋)

| 紅線 | 本設計怎麼守 |
|------|-------------|
| 成本不外洩 | summary/chat 是 admin 內部;system prompt 明令成本不進客人面草稿;供應商價是內部數字 |
| 訂金 ≠ 營收(§17550) | 不靠 AI 腦補,靠 DB 既有欄位;prompt 載明規則只供判斷不供改寫 |
| 對話框唯讀 | 不新增寫入路徑;suggest_action 仍需點擊+二次確認(現況不變) |
| PII 不另存 | PDF 抽出的全文只進 prompt(M1/M4),呼叫端絕不寫 DB/檔;快取只存 business 結論,prompt 明令輸出無 PII |
| 不破折號 | system prompt 明列;摘要/草稿輸出檢查 |
| i18n | 前端新字串一律進 zh-TW/en,不硬編碼中文 |
| adminProcedure | 新 tRPC query/mutation 用 `adminProcedure`(自動 60/min throttle + role) |
| logger 非 console | server/_core 新檔用 `logger`/`createChildLogger` |

---

## 八、測試計畫(每模組對應 Vitest,§9.5 強制)

| 模組 | 測試檔 | 重點 |
|------|--------|------|
| M0 | `sseCompression.test.ts` | SSE header 含 `no-transform`(或 pure helper) |
| M1 | `customerDocsText.test.ts` | 清單格式化、總長截斷、注入假 parser 結果、空清單、無 url 跳過 |
| M2 | `customerAiContext.test.ts` | scope 解析(user/guest)、degrade-to-null、context 組裝(mock DB) |
| M3 | `customerAiSummary.test.ts` | prompt 組裝(注入 fake context)、structured output 解析、stale 判斷邏輯(pure)、cron 篩選條件(pure) |
| M3 | `customerAiSummary.prompt.test.ts` | 紅線:輸出無破折號/無成本/無 PII(對 fake LLM 回應做 assert,或驗 prompt 含規則) |
| M4 | `customerChatContext.test.ts`(擴充) | doc 全文有併進 block、上限、guest vs registered |
| M5 | (adapters)`adapters.test.ts` 擴充 | 快取存在用快取、null 用規則 fallback、nextStep 帶出 |

不插真實資料進 DB(§七)。LLM 用 mock/stub,不打真 API。

---

## 九、Schema 變更 + Migration

`drizzle/schema.ts` `customerProfiles` 加:
```ts
aiSummary: json("aiSummary"),
aiSummaryAt: timestamp("aiSummaryAt"),
```
新 migration `drizzle/NNNN_customer_ai_summary.sql`:`ALTER TABLE customerProfiles ADD COLUMN aiSummary JSON NULL, ADD COLUMN aiSummaryAt TIMESTAMP NULL;`(沿用既有 migration 編號慣例)。本地無 DB(memory),migration 在 prod/Fly 跑(`pnpm ship` 會列出本次 migration)。

---

## 十、風險 + 回滾

| 風險 | 緩解 |
|------|------|
| Haiku 摘要品質不如 Opus | 摘要是「搬運」型任務,Haiku 夠;不夠再升 model 常數一行可換 |
| 「每次全讀」首 turn 慢(掃描件 OCR) | 平行抽取 + 文字 PDF(Jeff 出的報價/行程是 text layer)直接抽不走 OCR;prompt cache 抵銷重複 turn |
| cron 讀 PDF 成本 | 只算「活躍+變動過」客人,不重讀沒變的 |
| 快取誤存 PII | prompt 明令 + 快取只存四欄結論;raw text 永不落地 |
| M0 沒效(若 brotli flush 其實有作用) | no-transform 直接不壓,是上位修法;同時 Haiku 縮短整段時間,雙保險 |

回滾:M0 是單行 header;M3/M5 點燈失敗可回 `deriveAiSummary` 規則版(fallback 一直在)。各模組獨立 commit,壞哪個回哪個。

---

## 十一、交接給 Stage 3

拆 `tasks/`:`m0-sse.md`、`m1-docs-text.md`、`m2-context.md`、`m3-summary.md`、`m4-chat-docs.md`、`m5-frontend.md`,各帶獨立 checklist + 該模組的輸入(看哪些檔)+ 輸出(改哪些檔 + 測試)。`progress.md` 總覽。
