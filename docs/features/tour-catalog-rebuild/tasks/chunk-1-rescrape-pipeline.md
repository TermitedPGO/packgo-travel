# Chunk 1 — 重抓 pipeline + 紅線 guard(實作 plan,等 Jeff 拍板換批機制)

> 給 Jeff 審的完整 plan(§9.1)。決定點在 §3(換批/回滾機制)。其餘小節是不論選哪個都要做的。

## 1. 範圍

- 重抓 UV + Lion 全產品 + 每日行程 + 景點 + 直客價 + 班期 → 寫進「新一批」。
- 驗完整度(只讓夠完整的團上架)。
- 原子換上架批、舊批封存、可回滾。
- 紅線 guard + 測試:客人頁查詢一律 retail,`agentPrice` 不外洩。
- 不做:兩頁重做(chunk 3-4)、即時餘位(chunk 2)、prerender(chunk 6)、照片重做、中國美。

## 2. 現況(實際讀過)

- 鏡像:`syncLionCatalog` / `syncUvCatalog`(`supplierSync/{lion,uv}.ts`)就地 upsert `supplierProducts` + `supplierDepartures`。`supplierDepartures.retailPrice`(直客)+ `agentPrice`(= Lion IndustryLowestPrice = 同業價 = 成本)。
- 詳情:`lionDetail.ts` / `uvDetail.ts` → `supplierProductDetails`(itinerary/priceTerms/notices/optional/tourInfo 已 parse)。
- 客人團:`tours` 表。`hydration.ts`(純轉換、零 LLM)把 parsed JSON → tours 欄位;`tours.price = MIN(supplierDepartures.retailPrice)`。`tours` 靠 `productCode` + `sourceUrl`(內含 Lion NormGroupID / UV productCode)對回供應商。`tours.status` = active / inactive / soldout / draft / pending_review。
- **紅線現況:已經安全。** `agentPrice` 只在 `supplierDepartures`;`tours` 無成本欄;`tours.price` 來自 `MIN(retailPrice)`;唯一讀 `agentPrice` 的是 `suppliersRouter.marginAudit`(adminProcedure)。沒有 client 端點吐整列 departure。**所以 chunk 1 的 guard = 回歸鎖(別讓新 pipeline 破壞它)+ 測試,不是補漏。**
- **ID 穩定性是硬需求**:`tours.id` 被 bookings / favorites / tourViews / 多表 FK 參照(schema 多處 `tourId`),也是 `/tours/:id` 的 URL。換批若「建新列」會孤立所有 FK + 換掉所有 URL → 砸 SEO(SEO 是紅線)。

## 3. 決定點:換批 / 回滾機制(三選一)

「上架批」= 客人看到的 active tours。重抓 = 重新從供應商抓 → 重建 tours → 原子換上架 → 可回滾。

### 選項 A — 只用 tours.status(建新列)
新批以新 tours 列寫入(staging),驗完 → txn 內 productCode 對應翻 staging→active、舊 active→archived。
- 優:migration 最小(status enum 加 archived/staging)。
- 缺:**建新列 → tour.id 變動 → 砸 FK + URL + SEO**(見 §2 硬需求)。批界線靠 status 猜不準、回滾難。**不建議。**

### 選項 B — catalogBatches 表 + tours.batchId(建新列)
一級 batch 物件,回滾乾淨可稽核。但一樣**建新列 → id churn → 砸 SEO**;且 tours 每次重抓翻倍要清。**不建議(同 id churn 病)。**

### 選項 C — 就地更新 + 快照回滾(推薦)★
tours 列**就地更新**(id 不變、URL 不變、FK 不斷、SEO 穩)。換批的「原子」與「可回滾」用快照達成:

1. 開一個 batch run(reuse `supplierSyncRuns` 或新增極小的 `catalogBatches` 只記 id+scope+status+counts+時間)。
2. 重抓供應商 → 重建每個 tour 的「新值」,但**先不蓋上線那批**:寫進暫存(見下 3.1)。
3. 驗完整度(§4)。夠完整才會上;不夠的維持舊值、標記回報。
4. **promote(單一 DB transaction)**:把通過的 tour 列「舊值快照進 `toursCatalogArchive`(batchId 標記)」→ 再寫入新值 → 設 active。一個 txn 內完成,中途失敗整批 rollback,客人永遠看到一致狀態(無空窗)。
5. 回滾 = `revertBatch(batchId)`:從 `toursCatalogArchive` 把該批快照寫回 tours,當前值再快照成新封存批。一個指令、可稽核。

- 優:**id / URL / FK / SEO 全穩**;真原子(txn);回滾是還原快照、明確。
- 缺:要一張 `toursCatalogArchive` 快照表 + 一支 promote/revert;比就地 upsert 多一層。
- 取捨:多這層正是 Jeff 要的「封存可回滾、出事能退」,且不砸 SEO。

#### 3.1 暫存怎麼放(C 的子決定)
- C1:重抓先只更新供應商鏡像(`supplierProducts/Departures/Details`,本來就獨立於 tours),tours 完全不動;promote 時才一次從鏡像 hydrate 進 tours(快照舊值→寫新值→active)。**推薦**:tours 在 promote 前零變動,最乾淨。
- C2:加 `tours.stagingJson` 暫存欄,promote 時 stagingJson→正式欄。較髒,不推薦。

> **請 Jeff 選:A / B / C(+ C1 或 C2)。我推薦 C + C1。** 下面各節以 C+C1 寫;選別的我改對應段落。

## 4. 完整度驗收(上架門檻 — 直接解「不夠完整」)

一個 tour 要進 live 批,必須(全中才 active,缺項 → 不上、回報):
- `price > 0`(來自 `MIN(retailPrice)`,直客)。
- ≥ 1 個未來班期(`supplierDepartures.departureDate >= today`)→ 撐「最近班期 + 有沒有位」。
- `itineraryDetailed` 非空且天數 ≥ `tours.days`(每日行程齊)。
- `attractions` 非空(有景點)。
- 有圖(heroImage 或 galleryImages;暫用供應商圖當佔位,chunk 照片重做前不擋上架,但記旗標)。
- title / destination / days 齊。

純函式 `assessTourCompleteness(tour, departures): { ok, missing[] }`,易測。回報數字寫進 batch run(完整 N / 不完整 M + 各缺什麼),Jeff 一眼看重抓補了多少。

## 5. promote transaction(C+C1)

```
beginTx:
  for each product 通過驗收 in 新批:
    找到對應 tour(productCode/sourceUrl)
    snapshot 舊 tour 關鍵欄 → toursCatalogArchive(batchId, tourId, json, archivedAt)
    update tours set <hydrated 新值>, price=MIN(retail), status='active', batchId, lastBatchAt
  把這批沒對到、且上一批是 active 的 tour → status='inactive'(供應商已下架)
  catalogBatches: 新批 status='live'、上一 live 批 status='archived'
commit
```
- 全程只碰 retail;`agentPrice` 永不進 tours(guard §6 鎖)。
- txn 失敗 → 整批回滾,客人看舊批(無空窗)。

## 6. 紅線 guard + 測試(回歸鎖)

- `assertRetailOnly(tourPayload)`:防呆 helper,若 tour 對客 payload 帶任何成本欄/`agentPrice` key → throw。放進 hydrate→tours 與 promote 出口。
- **測試(vitest)**:
  1. hydrate / promote 產出的 tour 物件不含 `agentPrice`、不含 `supplierDepartures` 整列。
  2. `tours.price` 一律 = `MIN(retailPrice)`,永不等於 `agentPrice`(造一筆 retail≠agent 的 departure 驗證)。
  3. 客人向 departure 端點(自己跑一遍確認:`departures.*` 用 `tourDepartures` 非 `supplierDepartures`;`toursRead.*` 只回 tours 欄)→ 序列化結果不含 `agentPrice` key。
  4. 完整度驗收門檻 truth table。
  5. promote 原子性:txn 中途丟錯 → tours 維持舊批(mock db)。
  6. revertBatch 還原快照正確。

## 7. 重建流程(reuse 既有,不重造)

- 抓:`syncLionCatalog` / `syncUvCatalog`(產品+班期)+ `lionDetail`/`uvDetail`(詳情)— 既有,先確認跑全量、補齊 active 的 17% 缺每日行程 / 32% 缺景點。
- 轉:`hydration.hydrateTourFromParsed`(既有純函式)。
- 新增:`server/services/catalogRebuild/{batch,promote,completeness,guard}.ts` + orchestrator `rebuildCatalog(scope: 'lion'|'uv'|'both')`。
- 觸發:admin 手動(suppliersRouter 加 adminProcedure mutation)先,排程之後。

## 8. 檔案異動

新增:
- `drizzle/schema.ts` + migration:`toursCatalogArchive`(+ `catalogBatches` 小表;+ `tours.batchId`、`tours.lastBatchAt`)。
- `server/services/catalogRebuild/completeness.ts`(+ test)
- `server/services/catalogRebuild/guard.ts`(+ test)
- `server/services/catalogRebuild/promote.ts`(+ test)
- `server/services/catalogRebuild/index.ts`(orchestrator,+ test)

改:
- `server/routers/suppliersRouter.ts`:加 `rebuildCatalog` / `revertCatalogBatch` adminProcedure。
- 確認 `departures.ts` / `toursRead.ts` 客人端點(加回歸測試,必要時加 `assertRetailOnly`)。

## 9. 測試 + 出檢

每塊 vitest;`tsc --noEmit` 0 錯(OOM:`NODE_OPTIONS=--max-old-space-size=6144`);全測試綠 → `pnpm ship`(Jeff token,§4.3,我不自部署)。

## 10. Jeff 已拍板(2026-06-16)

1. **換批機制:C + C1**(就地更新 + 快照回滾;id/URL/SEO 穩 + 真原子 + 可退)。
2. **缺圖不擋上架**。圖片方向:之後重新設計**高清專業自家版**為主,真的做不出才退而求其次抓供應商圖。chunk 1 完整度門檻不把圖列硬條件。
3. **先 UV**(量小、近完整)當樣板,再 Lion。
4. **不做觸發 UI、不做排程**。Claude 直接寫 pipeline + 一次性執行:把 UV 整批抓進來、驗完整度、原子換上架(快照可退),一次到位。完成後 tsc + 測試綠 → Jeff 按 `pnpm ship`。

> 對線上客人目錄的實際大寫入(換 UV 批)會在程式 + 測試就緒、真要跑的那一刻先跟 Jeff 講一聲(快照可退),不悶著做。

## 11. 進度(2026-06-16)

已完成(committed,tsc + 測試綠):
- `completeness.ts` + test(上架門檻,15 測試)。commit 36a80a0。
- `guard.ts` + test(retail-only 紅線回歸鎖,10 測試)。commit 36a80a0。
- migration `0097_catalog_rebuild.sql` + journal entry + schema.ts(`catalogBatches`、
  `toursCatalogArchive`、`tours.batchId/lastBatchAt`)。**hand-written 慣例**(idempotent
  INFORMATION_SCHEMA guards;drizzle-kit generate 在本 repo 不用、會卡互動 prompt)。

剩(handoff,接著做):
- `promote.ts`:transactional promote(§5)+ `revertBatch`(用 `replacedBatchId` 翻回 live)。
  + test(mock DrizzleTx:快照→更新→active 原子性、retire 舊團、revert 還原)。
- `index.ts` orchestrator:`rebuildCatalog('uv')` = 跑 `syncUvCatalog` + `uvDetail` 補完整
  → hydrate(`hydration.hydrateTourFromParsed`)成 staging → `assessTourCompleteness` 篩
  → `promoteBatch`。每團 hydrate 出口過 `assertRetailOnly`。
- 客人 departure 端點回歸測試(`departures.*` 用 tourDepartures;`toursRead.*` 只回 tours 欄)。
- **實際跑 UV**(對線上大寫入,快照可退)→ 跑前知會 Jeff。
- tsc 0 錯 + 全測試綠 → Jeff `pnpm ship`。
