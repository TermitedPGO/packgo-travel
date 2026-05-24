# Supplier Deep Sync — Design

> **Vibe Coding Stage 2 / 4** — 概要+詳細設計。批准後拆 tasks/。
> 作者：Claude
> 日期：2026-05-24
> 狀態：⏳ 待 Jeff 批准 → 進 tasks/

---

## 一、模組劃分

7 個獨立模組，可平行開發：

```
M1. Schema migration (0083_supplier_product_details.sql)
       ↓
M2. shared.ts 擴充 — enrichment helpers (rate-limit, retry, parse-status)
       ↓
   ┌───────────┴───────────┐
   ↓                       ↓
M3. lionDetail.ts        M4. uvDetail.ts
   (5 endpoints × parse)   (3 endpoints × parse)
   ↓                       ↓
   └───────────┬───────────┘
               ↓
M5. supplierDetailEnrichmentWorker.ts (BullMQ)
       ↓
   ┌───────────┼───────────┐
   ↓           ↓           ↓
M6. TourDetail  M7. Inquiry  M8. Admin observability
    page render    Agent     (success rate, parse-fail)
    rich content   context    backfill kick-off
```

依賴：M1 阻擋 M2-M8；M2 阻擋 M3-M5；M3+M4 阻擋 M5；M5 阻擋 M6-M8。

---

## 二、Schema 設計（M1）

### 2.1 新表 `supplierProductDetails`

```sql
CREATE TABLE supplierProductDetails (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplierProductId INT NOT NULL,                  -- FK to supplierProducts.id
  supplierId INT NOT NULL,                          -- denormalized for fast filtering

  -- Itinerary (每日行程 + 飯店 + 餐食 — 三個合一,因為都來自同一 endpoint)
  itineraryRaw MEDIUMTEXT,                          -- raw API response
  itineraryParsed MEDIUMTEXT,                       -- normalized JSON
  itineraryFetchedAt TIMESTAMP,
  itineraryParseStatus ENUM('parsed','parse_failed','missing','stale') DEFAULT 'missing',

  -- Price terms (費用包含/不含 + 付款條件)
  priceTermsRaw MEDIUMTEXT,
  priceTermsParsed MEDIUMTEXT,
  priceTermsFetchedAt TIMESTAMP,
  priceTermsParseStatus ENUM('parsed','parse_failed','missing','stale') DEFAULT 'missing',

  -- Notices (注意事項 + 簽證 + 保險 + 行李)
  noticesRaw MEDIUMTEXT,
  noticesParsed MEDIUMTEXT,
  noticesFetchedAt TIMESTAMP,
  noticesParseStatus ENUM('parsed','parse_failed','missing','stale') DEFAULT 'missing',

  -- Optional items (自費項目)
  optionalRaw MEDIUMTEXT,
  optionalParsed MEDIUMTEXT,
  optionalFetchedAt TIMESTAMP,
  optionalParseStatus ENUM('parsed','parse_failed','missing','stale') DEFAULT 'missing',

  -- Tour info (行程細節 metadata — Lion only)
  tourInfoRaw MEDIUMTEXT,
  tourInfoParsed MEDIUMTEXT,
  tourInfoFetchedAt TIMESTAMP,
  tourInfoParseStatus ENUM('parsed','parse_failed','missing','stale') DEFAULT 'missing',

  -- Aggregate metadata
  schemaVersion INT NOT NULL DEFAULT 1,             -- API-ready: bump when we change parsed schema
  ownerType ENUM('supplier','packgo','partner') NOT NULL DEFAULT 'supplier',
  lastEnrichedAt TIMESTAMP,
  enrichmentRunCount INT DEFAULT 0,

  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uniq_product (supplierProductId),
  INDEX idx_supplier_enriched (supplierId, lastEnrichedAt),
  INDEX idx_parse_failures (itineraryParseStatus, priceTermsParseStatus, noticesParseStatus)
);
```

**設計決策**：
- **一對一 with supplierProducts**（不是一對多 by kind）——簡單，每個 product 一行就完整
- **raw + parsed 雙存**——format 變了也不會丟資料，parser bug 可以重跑
- **parseStatus enum** ——區分「沒抓過」/ 「抓了沒 parse 出來」/ 「parser fail」/ 「資料過期」
- **schemaVersion**——API-ready：將來 parsed JSON schema bump 時 consumer 知道
- **ownerType**——API-ready：將來自有產品 / partner 產品也用同一表

### 2.2 不動的舊表

- `supplierProducts`、`supplierDepartures`、`supplierSyncRuns`、`suppliers` —— 不動
- `tours`（自動生成的客人版行程）—— 不動，TourDetail 用 join 拉 detail

---

## 三、Enrichment Service（M2-M4）

### 3.1 shared.ts 新增

```ts
// server/services/supplierSync/sharedDetail.ts (新檔)

export type DetailKind = 'itinerary' | 'priceTerms' | 'notices' | 'optional' | 'tourInfo';
export type ParseStatus = 'parsed' | 'parse_failed' | 'missing' | 'stale';

export interface EnrichmentResult {
  kind: DetailKind;
  raw: string | null;        // JSON string (or null if API failed)
  parsed: object | null;     // normalized object (or null if parse failed)
  status: ParseStatus;
  fetchedAt: Date;
  errorMessage?: string;
}

// Rate limit wrapper — 2 sec interval + jitter (already exists in shared.ts)
export async function rateLimitedCall<T>(fn: () => Promise<T>, label: string): Promise<T>;

// Retry with exponential backoff for transient errors
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number = 3): Promise<T>;
```

### 3.2 lionDetail.ts（M3）

```ts
// server/services/supplierSync/lionDetail.ts (新檔)

import { getTravelInfo, getPriceInfo, getNoticeInfo, getOptionalInfo, getTourInfo }
  from '../../suppliers/lionClient';

export async function enrichLionProduct(productId: number, externalCode: string): Promise<{
  itinerary: EnrichmentResult;
  priceTerms: EnrichmentResult;
  notices: EnrichmentResult;
  optional: EnrichmentResult;
  tourInfo: EnrichmentResult;
}> {
  // Call 5 endpoints in parallel (within rate limit)
  // Parse each response into normalized shape
  // Return all 5 results (some may be parse_failed)
}

// Parse functions for each endpoint:
function parseLionItinerary(raw: LionTravelInfo): NormalizedItinerary | null;
function parseLionPriceTerms(raw: LionPriceInfo): NormalizedPriceTerms | null;
function parseLionNotices(raw: LionNoticeInfo): NormalizedNotices | null;
function parseLionOptional(raw: LionOptionalInfo): NormalizedOptional | null;
function parseLionTourInfo(raw: LionTourInfo): NormalizedTourInfo | null;
```

Lion 的 5 個 endpoints 的 schema 已經在 `server/suppliers/lionClient.ts` 定義好。Parser 把它們轉成 PACK&GO 自己的 normalized shape。

### 3.3 uvDetail.ts（M4）

```ts
// server/services/supplierSync/uvDetail.ts (新檔)

import { getProductMain, getProductTravelDetail, getProductGroup }
  from '../../suppliers/uvClient';

export async function enrichUvProduct(productId: number, externalCode: string): Promise<{
  itinerary: EnrichmentResult;  // from getProductTravelDetail
  priceTerms: EnrichmentResult; // from getProductMain
  notices: EnrichmentResult;    // from getProductMain (different field)
  optional: EnrichmentResult;   // from getProductGroup if exists
}>;
```

UV 只有 3 個 endpoints，但每個都包含多種資料 → parser 拆分後 map 到 4 種 detail kind。

### 3.4 Normalized shapes（API-ready）

```ts
// server/services/supplierSync/types.ts

export interface NormalizedItinerary {
  totalDays: number;
  days: Array<{
    dayNumber: number;
    title: string;
    attractions: Array<{ name: string; description?: string; durationHours?: number }>;
    hotels: Array<{ name: string; city: string; rating?: number; type?: '5星' | '4星' | '經濟' }>;
    meals: { breakfast: boolean | 'hotel' | 'local'; lunch: boolean | string; dinner: boolean | string };
    transportation?: string;
  }>;
}

export interface NormalizedPriceTerms {
  included: string[];        // 包含項目
  excluded: string[];        // 不含項目
  paymentTerms: string;      // 付款條件 (簽約金/尾款日)
  cancellationPolicy: Array<{ daysBeforeDeparture: number; refundPercent: number }>;
}

export interface NormalizedNotices {
  visa: string;              // 簽證需求
  insurance: string;         // 保險條款
  baggage: string;           // 行李規定
  general: string;           // 其他注意
}

export interface NormalizedOptional {
  items: Array<{
    name: string;
    description: string;
    price: number;
    currency: string;
    minParticipants?: number;
  }>;
}

export interface NormalizedTourInfo {
  highlights: string[];      // 行程亮點
  metadata: Record<string, string>;
}
```

這些 shape 就是將來 REST API `/api/v1/tours/:id/detail` 直接 expose 的格式。

---

## 四、BullMQ Worker（M5）

### 4.1 Queue

```ts
// server/queue.ts 加入
export const supplierDetailEnrichmentQueue = new Queue<SupplierEnrichmentJobData>(
  'supplier-detail-enrichment',
  {
    connection: redisBullMQ,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 }, // 1min, 2min, 4min
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  }
);

export interface SupplierEnrichmentJobData {
  supplierProductId: number;
  supplierCode: 'lion' | 'uv';
  externalProductCode: string;
  triggeredBy: 'backfill' | 'daily-cron' | 'manual';
}
```

### 4.2 Worker

```ts
// server/supplierDetailEnrichmentWorker.ts (新檔)

new Worker<SupplierEnrichmentJobData>(
  'supplier-detail-enrichment',
  async (job) => {
    const { supplierCode, supplierProductId, externalProductCode } = job.data;

    let results;
    if (supplierCode === 'lion') {
      results = await enrichLionProduct(supplierProductId, externalProductCode);
    } else if (supplierCode === 'uv') {
      results = await enrichUvProduct(supplierProductId, externalProductCode);
    }

    // Upsert into supplierProductDetails
    await upsertProductDetail(supplierProductId, results);

    return { ...metrics };
  },
  { connection: redisBullMQ, concurrency: 5 } // 5 concurrent workers
);
```

### 4.3 Backfill kick-off script

```ts
// server/scripts/backfill-supplier-details.ts (新檔)

// 1. Query all active supplierProducts WHERE id NOT IN (
//      SELECT supplierProductId FROM supplierProductDetails
//      WHERE lastEnrichedAt > NOW() - INTERVAL 7 DAY
//    )
// 2. For each, enqueue supplierDetailEnrichmentQueue.add(...)
// 3. Print progress every 100 jobs queued
// 4. Estimate completion time based on queue depth
```

執行方式：`fly ssh console -a packgo-travel -C 'node server/scripts/backfill-supplier-details.ts'`

### 4.4 Daily cron

```ts
// 加到 server/queue.ts 既有的 cron 設定
await supplierDetailEnrichmentQueue.add(
  'daily-refresh',
  { triggeredBy: 'daily-cron' },
  { repeat: { pattern: '0 3 * * *' } } // 03:00 UTC 每天
);
```

Daily cron job 內部邏輯：
- 找出 24h 內新增的 supplierProducts（沒 detail 的）→ enqueue
- 找出 supplierProducts.updatedAt > supplierProductDetails.lastEnrichedAt（detail 過期）→ enqueue
- 找出 lastEnrichedAt > 30 天的（即使沒變也 refresh 一下）→ enqueue

---

## 五、UI 渲染（M6）

### 5.1 TourDetailPeony.tsx 新區塊

現有頁面結構：
```
<TourHero />
<TourOverview />
<TourItinerary />    ← 既有,LLM 腦補的
<TourMap />
<TourBooking />
```

改成：
```
<TourHero />
<TourOverview />

{detail?.itineraryParseStatus === 'parsed' && (
  <RealItineraryDays days={detail.itineraryParsed.days} />  // ← 真實逐日行程
)}

{detail?.priceTermsParsed && (
  <PriceTermsSection terms={detail.priceTermsParsed} />     // ← 費用包含/不含 + 付款
)}

{detail?.noticesParsed && (
  <NoticesSection notices={detail.noticesParsed} />          // ← 簽證/保險/行李
)}

{detail?.optionalParsed && detail.optionalParsed.items.length > 0 && (
  <OptionalItemsSection items={detail.optionalParsed.items} />  // ← 自費項目
)}

<TourMap />
<TourBooking />
```

**Fallback**：如果 `parseStatus !== 'parsed'`，回退到既有 LLM 腦補版（不破壞現有 page）。

### 5.2 新 tRPC procedure

```ts
// server/routers/toursRouter.ts 加入
getSupplierDetail: publicProcedure
  .input(z.object({ supplierProductId: z.number() }))
  .query(async ({ input }) => {
    return getSupplierProductDetail(input.supplierProductId);
  })
```

---

## 六、InquiryAgent context wire（M7）

現有 InquiryAgent system prompt 加入：

```ts
// server/agents/InquiryAgent/buildSystemPrompt.ts

if (matchedSupplierProducts.length > 0) {
  for (const product of matchedSupplierProducts.slice(0, 3)) {  // 限 3 個避免 token 爆
    const detail = await getSupplierProductDetail(product.id);
    if (detail?.itineraryParsed) {
      prompt += `\n\n## 候選行程 ${product.title}\n`;
      prompt += `每日行程：${JSON.stringify(detail.itineraryParsed.days.map(d => ({
        day: d.dayNumber,
        title: d.title,
        hotels: d.hotels.map(h => h.name),
        meals: d.meals,
      })))}`;
      if (detail.priceTermsParsed) {
        prompt += `\n費用包含：${detail.priceTermsParsed.included.join(', ')}`;
        prompt += `\n費用不含：${detail.priceTermsParsed.excluded.join(', ')}`;
      }
    }
  }
}
```

→ 將來客人問「9 月東京 5 天 hotel 什麼牌子？」AI 直接看 detail.itineraryParsed.days[*].hotels[*].name 回答。

---

## 七、Admin observability（M8）

### 7.1 BankLedger-style admin tab

新 tab `SupplierEnrichmentTab.tsx` 在「系統」domain 下：
- 顯示 each supplier × parseStatus matrix
- 例：`Lion: 4590 products | itinerary parsed 4123 (89.8%) | parse_failed 145 | missing 322`
- 「Re-enrich now」按鈕 → 把 missing + parse_failed 重新 enqueue
- Recent enrichment runs 表（last 20）

### 7.2 健康檢查

`/health` deep check 新增 supplier enrichment queue depth + last successful enrichment timestamp。如果 queue depth > 10000 或 last run > 48h 前，回 degraded。

---

## 八、預設決策（D1-D5）

以下 5 個決策因 Jeff「全部一次到位」+「先 Stage 1」表態，採推薦預設。**Jeff 看到 design 後可改任一項。**

| # | 預設 | 改動成本 |
|---|------|---------|
| D1 | 今晚 UTC 23:00 一次跑完 backfill | 改分批：tasks.md 加 cron config 即可 |
| D2 | 每天 03:00 UTC daily sync | 改頻率：queue.ts repeat pattern 一行 |
| D3 | 2 sec/call, 5 workers concurrent | 改 rate：sharedDetail.ts 兩個常數 |
| D4 | TourDetail 加 4 區塊（行程/飯店餐食/政策/注意）| 改成摺疊：TourDetailPeony.tsx 結構不同 |
| D5 | InquiryAgent system prompt inject 整個 detail JSON (限 top 3 候選) | 改 RAG：需多寫 embedding + retrieval module，3-5 天工作 |

---

## 九、測試策略

| 模組 | Vitest 覆蓋 |
|------|-------------|
| M1 schema | migration up/down test |
| M2 sharedDetail | rate limit + retry + parse status enum |
| M3 lionDetail | 用 fixtures 測 5 個 parser；包含 happy path + format-變動 + 部分欄位 missing |
| M4 uvDetail | 同上 × 3 endpoints |
| M5 worker | mock enrichLion/Uv → assert DB upsert + job retry behavior |
| M6 TourDetail render | RTL test：parseStatus 各 enum → 對的 fallback / 對的 component |
| M7 InquiryAgent | snapshot test system prompt 含 supplier detail |
| M8 admin tab | RTL test：matrix render + re-enrich button trigger mutation |

每個 PR 必須 tsc clean + vitest pass + i18n parity（如果加新文案）。

---

## 十、待辦

- ⏳ Jeff 看 design.md 後 approve 或要求改 D1-D5 / schema / API shape
- ⏳ Approved 後寫 tasks/M1-M8.md（每個模組獨立 checklist）
- ⏳ 然後 coding（按 task 順序，每 PR 跑 tsc + Vitest）

---

## 十一、API-ready check（將來 Stage 3 用得到）

以下這些設計都在為 Stage 3 公開 API 預留：

- ✅ `schemaVersion` 欄位 → consumer 知道 parsed shape 版本
- ✅ `ownerType` enum (supplier|packgo|partner) → 將來自有產品 / partner 產品同表
- ✅ `parseStatus` enum → API consumer 知道每個欄位的 reliability
- ✅ Normalized shapes 是 PACK&GO 自己的格式，不是 Lion/UV 的 → 將來 swap 供應商不破壞 API contract
- ✅ tRPC procedure (`getSupplierDetail`) 是純讀，將來 REST adapter 套上去就是 GET /api/v1/products/:id/detail
- ✅ 每個 raw response 都存 → 將來 audit / debug consumer 投訴有依據
