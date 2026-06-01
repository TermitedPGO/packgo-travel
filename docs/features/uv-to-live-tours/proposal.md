# UV 全量轉 PACK&GO Live 行程 — Build-Ready Proposal

> **文件性質**：給工程 session 照著做的施工藍圖。所有事實已查證並標註對應檔案行號。Stage 1-3（proposal/design/tasks）已濃縮於此份；工程 session 進 Stage 4（coding）前先讀 §8 冷啟動任務。
> **建立日期**：2026-06-01　**作者**：design workflow（盤點 1/2/3 綜合，4 agents）
> **核心鐵律**：團費真價一律以 `getProductGroup` priceType=4（兩人一房）為準，**絕不信 flyer**（Jeff 鐵律，貫穿全文）。

---

## 1. 目標

把 UV（途風，`supplierId=2`）1,138 個 active `supplierProducts`，分階段轉成 PACK&GO `packgoplay.com` 上 `status='active'`、有真價（getProductGroup priceType=4）、有圖、有結構化每日行程的可賣 live tours，**先轉「有價+有圖+有行程」的子集，人工驗收賣相後才放量**。

---

## 2. 欄位對照表（核心）

> 圖例：**[直接]** = 來源欄位直拷貝；**[轉換]** = 需 map/推算/格式化；**[現打]** = 需即時呼叫 `getProductGroup`；**[LLM]** = 需 LLM rewrite 生成；**[fallback]** = 缺資料的退路。
> 來源優先序鐵律：**headline 與目的地欄位讀 `supplierProducts.rawProductJson`（list API 已存全欄），不讀 `getProductMain`**（盤點 3 斷點 2：`UvProductMain` interface `uvClient.ts:189-199` 根本沒有 `destinationName`/`groupLatelyPrice`/`tempImageUrl`，現行 `uvBulkImportService.ts:144-166` 從 `getProductMain` 硬 cast 這些欄位會拿到 `undefined`）。

### 2.1 `tours` 表（每產品一筆）

| PACK&GO `tours` 欄位 | 必填 | UV 來源 | 處理類別 | 說明 / fallback |
|---|---|---|---|---|
| `title` | ✅ | `supplierProducts.title`（= UV `productName`，英文） | [直接] `.slice(0,200)` | 100% 完整。LLM rewrite 會改寫成中文主標 |
| `productCode` | — | `supplierProducts.externalProductCode` | [直接] `.slice(0,100)` | 如 `P00002885` |
| `description` | ✅ | 無 | [LLM] | import 階段填 `''`（草稿故意留空）；**上架前必補**（OverviewSection 直接渲染，空＝開天窗） |
| `departureCountry` | — | 固定 | [轉換] 寫 `"美國"` | UV 全是美國出發團 |
| `departureCity` | — | `rawProductJson.departCityName` | [直接] | 100% 完整。fallback `"Los Angeles"` |
| `departureAirportCode` | — | `departCityName` | [轉換] `deriveAirportCode()`（`uvBulkImportService.ts:91-108`，已有 map） | 未命中回 `''`，LLM 補 |
| `destinationCountry` | ✅ | `rawProductJson.destinationName` | [轉換] `inferDestinationCountry()`（`uvBulkImportService.ts:65-83`，已有 regex map） | UV sync 寫死 NULL（11 個缺）。未命中時 fallback 回 `destinationName` 原值，標 warning 待人工/LLM 修。**這是 hero 國家 badge + 主題色 key + 國家頁過濾的依據，務必正確** |
| `destinationCity` | ✅ | `rawProductJson.destinationName` | [直接] | UV 的 destinationName 其實是 city。fallback 用 `destinationCountry` |
| `duration` | ✅ | `supplierProducts.days`（= UV `tripDay`） | [直接] | 100% 完整 |
| `nights` | — | `rawProductJson.nightDay` | [直接] | fallback `max(0, days-1)` |
| `price`（headline 起價） | ✅ | **[現打] `getProductGroup`** → 最低出發日的 priceType=4 | [現打][轉換] | **不讀 `groupLatelyPrice`**（盤點 3 斷點 2，cast 不到）。取所有未來出發日 priceType=4 的**最小值**當 headline（`從 $X 起`）。`Math.round()`。0 → hero 顯示「請洽詢」＝不可上架 |
| `priceCurrency` | ✅ | 固定 | [轉換] 寫 `"USD"` | 不可吃預設 TWD（影響 hero 雙幣顯示邏輯） |
| `imageUrl` | — (賣相必填) | `supplierProducts.imageUrl`（= UV `tempImageUrl`） | [直接] | 單張。**缺 50 個** → 缺則走既有 Unsplash gallery hydration 或標待補 |
| `heroImage` | — (賣相必填) | 同 `imageUrl` | [直接] | 空則 fallback imageUrl→Unsplash 通用圖（賣相破功） |
| `dailyItinerary` | — (實質必填) | `supplierProductDetails.itineraryParsed` | [LLM] | import 暫存原始 blob；**LLM rewrite 後與 `itineraryDetailed` 雙寫鏡像**（`updateTour` 自動處理） |
| `itineraryDetailed` | — (實質必填) | `supplierProductDetails.itineraryParsed`（NormalizedItinerary） | [LLM] | **行程詳情頁真正渲染的欄位**。UV 來源每天只有可信的 `dayNumber`/`title`/`attractions[].name`/`hotels[].name`；**逐日餐食永遠空、景點描述空、逐日交通空** → LLM 補結構成 `[{day,title,activities:[{time,title,description,transportation,location}],meals,accommodation}]` |
| `costExplanation` | — (賣相重要) | `supplierProductDetails.priceTermsParsed.included[]` + `noticesParsed` | [LLM][轉換] | `{included,excluded,additionalCosts,notes}`。UV `excluded=[]`/`cancellationPolicy=[]` **永遠空** → 含項從 included 文字抽，排除項靠 LLM 從 notices 推 |
| `noticeDetailed` | — (賣相重要) | `supplierProductDetails.noticesParsed`（`{visa,insurance,baggage,general}`） | [LLM][轉換] | `{preparation,documents,health,emergency,terms}`。空則 NotesSection 顯示「洽詢顧問」placeholder |
| `hotels`（JSON 複數） | — (賣相重要) | `itineraryParsed.days[].hotels[].name` | [LLM][轉換] | `[{name,stars,description,image,imageAlt}]`。**HotelsSection 真正渲染這個**（非單一 `hotelName` 欄位群）。UV 不給星級（type 永遠「未指定」）→ stars 留空或 enrich。空則整段 return null |
| `highlights` / `poeticTitle` / `poeticContent` / `keyFeatures` / `heroSubtitle` | — | 無（`tourInfoParsed` 永遠 missing） | [LLM] | 全行銷文案 LLM 生成。空則 hero/Overview 對應元素靜默不顯示（乾淨但單薄） |
| `attractions`（JSON） | — | `itineraryParsed.days[].attractions[].name` | [LLM] | `[{name,description,image,imageAlt}]`。UI 會過濾「景點1」placeholder |
| `flights`（JSON） | — | 無（UV storefront 不出航段） | [fallback] | 留空或標「機票另詢」。`type`=`待確認` 會被 hero 隱藏（乾淨） |
| `category` | ✅ | 固定 | [轉換] 寫 `"group"` | UV 跟團 |
| `status` | ✅ | — | [轉換] | import=`"draft"`；**LLM rewrite 成功後翻 `"active"`（唯一可賣狀態）** |
| `featured` | ✅ default 0 | — | [直接] | 0 |
| `sourceUrl` | — (強烈建議) | 拼 productCode | [轉換] `https://uvbookings.toursbms.com/en/product/detail/{productCode}` | **NotesSection 靠它 `detectSupplier()` 顯示供應商揭露**；dedup `NOT EXISTS` 也靠它（見 §4） |
| `createdBy` | ✅ | — | [轉換] | import 預設 `ctx.user.id`（手動）或 `1`（批次） |
| `pointsEarnRate` / `excludeFromPackpoint` | ✅ default | — | [直接] | 用 default（25 / false） |

> **不要寫的欄位（盤點 2 §0 會咬人的事實）**：`qaStatus`/`qaScore`/`qaIssues`/`sourceProvider`/`isFeatured` **schema 不存在**，現行 `uvBulkImportService.ts:198-208` 的 `as any` 硬塞會被 Drizzle 靜默丟棄。真實品質欄位是 `calibrationScore/Verdict/Report`；供應商揭露靠 `sourceUrl` regex 不靠 `sourceProvider`。修正 import service 時應移除這些幽靈欄位。
> **`colorTheme` 不用填**：Round 80.8 已強制統一黑金主題，UI 忽略此欄。

### 2.2 `tourDepartures` 表（每出發日一筆）

| PACK&GO 欄位 | 必填 | UV 來源（getProductGroup `UvDepartureRow`） | 處理類別 | 說明 |
|---|---|---|---|---|
| `tourId` | ✅ | — | [轉換] | FK → 上一步建的 tours.id |
| `departureDate` | ✅ | `groupDate.slice(0,10)` | [轉換] | 設當日 `08:00`（**用 `.slice(0,10)` 切，不要 reformat → 避免時區漂移**，`uvClient.ts:243-246` 已警示） |
| `returnDate` | ✅ | `groupDate` + `(days-1)` | [轉換] | `@20:00` |
| **`adultPrice`** | ✅ | **priceType=4（兩人一房）`groupPrice`** | [現打] | **★ Jeff 鐵律核心**。`dep.groupPrice.find(p=>p.priceType===4)?.groupPrice`；fallback `groupPrice[0]`。`Math.round()`。**priceType=3（單人入住）會高估 30-37%，絕不可當基準**。現行 `uvBulkImportService.ts:237-240` 已正確 |
| `childPriceWithBed` | — | **無結構化** | [fallback] **留 null** | UV priceType 全是房型佔床，**拿不到童價**（盤點 1 §3）。童價只埋在 notices 自由文字 → MVP 階段一律 null，booking 端各價型自行判斷。Phase 3 才考慮 LLM 抽文字或上 BMS 後台 |
| `childPriceNoBed` | — | 無 | [fallback] **留 null** | 同上 |
| `infantPrice` | — | 無 | [fallback] **留 null** | 同上 |
| `singleRoomSupplement` | — | priceType=3 − priceType=4 | [轉換] 可推算 | UV 沒明列；MVP 可留 null，或填差額（標註「推算值」） |
| `totalSlots` | ✅ | `groupStock` | [直接] | `>0` 取真值，否則 fallback `20`（現行 `:248`） |
| `bookedSlots` | ✅ default 0 | `groupSaleStock` | [直接] | 剩餘 = total − booked，calendar 擋滿/booking 擋超賣靠這 |
| `status` | ✅ | `groupStock`/`groupSaleStock` 推 | [轉換] | `total-sold<=0` → `full`，否則 `open`（現行 `:241-242`） |
| `currency` | ✅ | 固定 | [轉換] 寫 `"USD"` | 不可吃預設 TWD |
| `notes` | — | `productCode` + `stockStatus` | [轉換] | 內部追蹤（現行 `:252`） |
| `opsStatus` | ✅ default | — | [直接] | `planning` |

> **童價/嬰兒價/單人房差最終策略**：MVP 全 null。理由：UV 結構化資料真的沒有（盤點 1/2 一致），硬從文字 LLM 抽會引入錯價風險，違反「價以後台真價為準」鐵律。寧可 null（booking 端處理）也不出錯價。列入 Phase 3 backlog。

---

## 3. 轉換步驟（Pipeline）

每個 productCode 的處理鏈。**標明可重用 vs 要新寫**。

```
[每產品]
 1. 讀 supplierProducts row（rawProductJson）        ← 新寫（取 headline/目的地來源,修斷點2）
 2. 讀 supplierProductDetails（itineraryParsed 等）    ← 新寫（現行完全沒讀,grep 證實 NONE）
 3. 現打 getProductGroup → 未來 180 天出發日+真價      ← 可重用 getDeparturesNext180Days（uvClient.ts:274）
 4. 組 tours row（status=draft, description='',
    headline=min(priceType4), dailyItinerary=blob）   ← 改寫 importOneUvProduct（修來源+拔幽靈欄位）
 5. createTour                                        ← 可重用（server/db tour.ts）
 6. 逐出發日組 tourDepartures（adultPrice=priceType4） ← 可重用 createDeparture（tour.ts:423-438）
 7. enqueue LLM rewrite（sourceDraftTourId=tourId）   ← 可重用 queueRewriteForImportedUvTours
                                                         （uvBulkImportService.ts:321-361）
[LLM rewrite job 完成後]
 8. masterAgent 補 description/itineraryDetailed/
    hotels/costExplanation/noticeDetailed/文案
    + 把 status 翻 active（靠 sourceDraftTourId 機制）  ← 可重用 worker.ts/queue.ts 既有路徑
 9. 人工驗收賣相 → 確認真價真庫存 → 確認 active        ← 人工（QA gate,§6）
```

### 3.1 可直接重用（已寫好、已接線、已測）
- `getProductGroup` / `getDeparturesNext180Days`（`uvClient.ts:248-285`）— USD、`stockStatus:200`、datetime padding 都對。
- `createTour` / `createDeparture`（`server/db` → `tour.ts:423-438` insert `tourDepartures`）。
- `bulkImportFromUv` 的 batch 框架（concurrency=4 loop，`uvBulkImportService.ts:288-315`）。
- `queueRewriteForImportedUvTours` + `sourceDraftTourId` 翻 active 機制（`:321-361`；handler 在 `queue.ts`/`worker.ts`/`priorityRewriteCron.ts`）。
- tRPC `bulkImport`（`suppliersRouter.ts:290-395`，含 `NOT EXISTS` dedup `:327-331`）+ `importProduct` + `SuppliersTab` 按鈕（`client/src/components/admin/SuppliersTab.tsx:119,305`）。

### 3.2 要新寫 / 要改
| 項目 | 動作 | 檔案 |
|---|---|---|
| **修斷點 2（headline/目的地讀錯來源）** | `importOneUvProduct` 改從 `supplierProducts.rawProductJson` 取 `destinationName`/`departCityName`/`tempImageUrl`/`tripDay`/`nightDay`，headline 改從 `getProductGroup` priceType=4 最小值取，**不從 `getProductMain` cast 不存在的欄位** | `server/services/uvBulkImportService.ts:144-166` |
| **讀 supplierProductDetails** | 新增讀取 `itineraryParsed`/`priceTermsParsed`/`noticesParsed`，餵進 dailyItinerary blob（取代純 travelDetail blob，提供 LLM 更乾淨輸入） | `uvBulkImportService.ts:170-180` |
| **拔幽靈欄位** | 移除 `qaStatus`/`qaScore`/`qaIssues`/`sourceProvider`/`isFeatured` 與 `as any`；用真實欄位 | `uvBulkImportService.ts:198-212` |
| **批次自動觸發** | 新增一支「掃 supplierProducts 尚未匯入者、分批跑到完」的 admin action（包現有 `NOT EXISTS` dedup loop），取代純手動 200/次 | 新 `server/services/uvBulkImportRunner.ts` 或 `suppliersRouter` 新 procedure |
| **idempotency 加固** | `tours` 補 unique index 或在 runner 層強制 productCode 去重（現行只靠 router `NOT EXISTS`，批次中斷重跑會產生重複 draft） | `drizzle/schema.ts` migration + runner |
| **draft→active 把關驗證** | 驗證 LLM rewrite job 真的會把 UV draft 翻 active（task #60 標 completed 但 165 live 全手動 = 對 UV 沒生效，需實測一個 proof 確認 queue 跑完翻 active） | 驗證為主，必要時修 `sourceDraftTourId` handler |
| **`console.*` 改 logger** | 現行 `uvBulkImportService.ts:276,310` 用 `console.*`；建議統一改 `logger` | `uvBulkImportService.ts` |
| **Vitest** | 新增 `uvBulkImportService.test.ts`：mock getProductGroup 回 priceType 3/4/5/6，斷言 adultPrice 取 4、headline 取 min(4)、童價 null、currency USD、status open/full 邊界 | 新 `server/services/uvBulkImportService.test.ts` |

---

## 4. 批次 / 規模策略（1,138 個）

| 維度 | 策略 |
|---|---|
| **分批** | concurrency=4（既有 `bulkImportFromUv` 慣例）。runner 每批 50，批間留間隔。**絕不一次 enqueue 1,138 個 rewrite job**（會打爆 LLM quota + Redis） |
| **idempotency** | productCode 去重：現有 `NOT EXISTS`（`suppliersRouter.ts:327-331`）比對 `tours.sourceUrl LIKE '%/product/detail/{code}%'`，已對 UV 生效。**批次前先補 `tours` unique index**，否則中斷重跑產生重複 draft |
| **失敗重試** | `importOneUvProduct` NEVER throw、回 `success:false+error`（`:116,267-281`）。runner 收集 failed list，**單獨重跑失敗者**。逐出發日失敗也已隔離（`:254-256`） |
| **速率** | UV gateway 免登入 GUEST，但**禮貌限速**：批間 sleep。`getProductGroup` 每產品一次，1,138 次分散在數小時內 |
| **進度可視** | runner 寫進度（已匯入/失敗/待處理）到 log 或 admin 可查 |

> **規模分階段（強制，§6/§7 紅線）**：proof(1) → 小批(10-20) 人工驗 → 中批(100) → 全量。**不可一次全發。**

---

## 5. 資料品質門檻（可上架 vs 跳過/待補）

**先上「有價+有圖+有行程」三齊的子集。**

### 5.1 硬門檻（缺任一 → 不翻 active，留 draft 待補）
- [ ] `status='active'`
- [ ] `price > 0` 且 `priceCurrency='USD'`，且**真價來自 getProductGroup priceType=4**（非 flyer）
- [ ] **≥1 筆 tourDepartures：`departureDate >= now` 且 `status != 'cancelled'` 且 `adultPrice > 0` 且 `totalSlots > bookedSlots`**
- [ ] `heroImage` 或 `imageUrl` ≥1 個
- [ ] `itineraryDetailed`（或鏡像 dailyItinerary）非空 JSON 陣列（**LLM rewrite 後才算數**）
- [ ] `description` 非空
- [ ] NOT NULL 齊全：`title`/`destinationCountry`/`destinationCity`/`duration`/`createdBy`

### 5.2 分桶處理
| 桶 | 條件 | 動作 |
|---|---|---|
| **A 可上架** | getProductGroup 有未來真價 + 有圖 + itineraryParsed 成功（99% 是這桶） | 進 LLM rewrite → 人工驗 → active |
| **B 待補圖** | 有價有行程，缺圖（50 個） | Unsplash gallery hydration 補圖後進 A |
| **C 待補國家** | destinationName 未命中 map（11 個缺國家） | warning flag，LLM/人工補後進 A |
| **D 跳過** | getProductGroup 回空（無未來出發日）或 price=0 | **不建 active**，記 log |

---

## 6. QA + 上架策略

```
階段 0  Proof（1 個）
  挑 P00002885（已實測 133 個出發日）
  → 跑完整 pipeline → LLM rewrite → 翻 active
  → 人工開 TourDetailPeony 頁逐項驗（hero/行程/價格/calendar/圓角/i18n）
  → 確認 booking flow 能選日、能下單、價格=priceType4
  GATE: 賣相過 + 真價對 + 0 直角 + 中文無硬編碼 → 才進階段 1

階段 1  小批（10-20 個）跨不同目的地 → 人工抽驗每一個
階段 2  中批（100 個）→ 抽驗 10%
階段 3  全量（剩餘桶 A + 補完的 B/C）→ 桶 D 跳過
```

**QA 驗收清單（每個 active 前過）**：
- 價格 = getProductGroup priceType=4（現打核對，非 flyer，非鏡像）
- hero/行程/calendar 三區無 placeholder 開天窗
- 圓角合規（卡片圖 `rounded-xl`、按鈕 `rounded-lg`）
- 無硬編碼中文
- 供應商揭露區塊出現（sourceUrl 指向 uvbookings）

---

## 7. 風險 / 紅線

- **不可一次全發**：proof→小批→中批→全量。
- **不可用 flyer 價**：`adultPrice` 與 headline 一律 getProductGroup priceType=4。priceType=3 高估 30-37%。上架前現打核。
- **童價不可瞎填**：UV 無結構化童價 → MVP 一律 null。
- **CLAUDE.md**：圓角 / i18n / 繁中 / tsc 0 error / Vitest 必有 / 不碰財務檔。
- **draft→active 把關**：必須驗證 LLM rewrite 真的翻 active（task #60 對 UV 未生效之嫌）。絕不手動繞過 QA 直接 UPDATE status=active。
- **idempotency**：補 unique index 前批次中斷重跑會產生重複 draft。

---

## 8. 第一步具體任務（給工程 session 的冷啟動，§9.2 四段）

> 換新對話貼這段。這是**階段 0 Proof + 修斷點 2**，不含批次放量。

### 目標（Goal）
修好 `importOneUvProduct` 的資料來源斷點，然後把 **1 個 UV 產品（`P00002885`）**完整轉成 PACK&GO live tour（draft → LLM rewrite → 人工驗收 → active），證明 pipeline 端到端可行、價格 = getProductGroup priceType=4、賣相合格。**不放量。**

### 輸入（Input）
- 改的主檔：`server/services/uvBulkImportService.ts`
  - 斷點 2 在 `:144-166`（headline/目的地讀錯 `getProductMain`，該欄位只在 `UvProductListItem`，不在 `UvProductMain` interface `uvClient.ts:189-199`）
  - 幽靈欄位在 `:198-212`（`qaStatus`/`qaScore`/`qaIssues`/`sourceProvider`/`isFeatured` schema 不存在）
- 可重用：`getDeparturesNext180Days`（`uvClient.ts:274`，內含 getProductGroup priceType=4）、`createTour`/`createDeparture`（`server/db` → `tour.ts:423-438`）、`queueRewriteForImportedUvTours`（`:321-361`）、tRPC `importProduct`（`suppliersRouter.ts:211`）
- 來源欄位真相：headline/目的地/圖/天數讀 `supplierProducts.rawProductJson`（list API 已存全欄，`uv.ts:51` 寫入）；每日行程讀 `supplierProductDetails.itineraryParsed`
- 鐵律：`adultPrice` 與 headline = getProductGroup priceType=4（兩人一房）；童價/嬰兒價 null；currency USD
- 約束：CLAUDE.md（圓角/i18n/繁中/tsc 0 error/Vitest 必有/不碰財務檔）

### 輸出（Output）
1. 改好的 `uvBulkImportService.ts`：headline 改 priceType=4 最小值、目的地/圖/天數改讀 `rawProductJson`、讀 `supplierProductDetails.itineraryParsed`、移除幽靈欄位與 `as any`、`console.*` 改 logger
2. 新 `server/services/uvBulkImportService.test.ts`：mock getProductGroup 回 priceType 3/4/5/6，斷言 ① adultPrice=priceType4 ② headline=min(priceType4) ③ priceType3 不被選 ④ 童價/嬰兒 null ⑤ currency='USD' ⑥ status open/full 邊界 ⑦ groupDate 用 slice 不 reformat
3. P00002885 跑完回報：tourId、出發日數、headline 價、抽 3 個出發日的 adultPrice（對照 priceType4）、LLM rewrite 後 status 是否翻 active、TourDetailPeony 賣相驗收逐項
4. `tsc --noEmit` 0 error + Vitest 綠

### 步驟（Process）
1. **先讀** `supplierProducts` 與 `supplierProductDetails` 對 `P00002885` 的實際 row，再動手
2. 改 `importOneUvProduct`：來源切到 rawProductJson + supplierProductDetails，headline 改 priceType4 min，拔幽靈欄位
3. 寫 Vitest，先紅後綠
4. `tsc --noEmit`（OOM 用 `NODE_OPTIONS="--max-old-space-size=6144"`）
5. 透過 tRPC `importProduct` 跑 P00002885 → 確認建出 draft tour + tourDepartures
6. **現打 getProductGroup 核對** 抽 3 個出發日的 adultPrice = priceType4（Jeff 鐵律，不信鏡像）
7. 確認 LLM rewrite job enqueue + 跑完翻 active（**task #60 對 UV 未生效的疑點，重點驗**）；若沒翻，回報 `sourceDraftTourId` handler 斷在哪
8. 人工開 TourDetailPeony 頁驗賣相
9. **任何不確定必須回報發問，不要猜測腦補繞過**

> **本任務不做**：批次放量（階段 1+）、unique index migration、童價文字抽取、BMS 後台。proof 過 GATE 後另開對話接階段 1。

---

## 附：Vibe Coding 文件骨架（§9.1）

- `proposal.md`（本文件）
- `design.md`（pipeline 模組劃分、idempotency 設計、runner 架構 — 階段 1 前補）
- `tasks/stage-0-proof.md`（= §8）/ `tasks/stage-1-smallbatch.md` / `tasks/stage-2-3-scale.md`
- `progress.md`（監工 agent 看；**鐵律：監工不信文件自我宣稱，獨立驗證每個 active**）
