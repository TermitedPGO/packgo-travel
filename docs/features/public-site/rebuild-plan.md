# 災後目錄重建計畫（catalogRebuild，日本/UV 先行）

> 偵察產出，2026-07-10。唯讀規劃，零 code 改動、零 prod 寫入。給 Jeff 拍板用。
> 事故背景：`incident-20260617-tours-wipe.md`（tours 等七表 2026-06-17 被清空）。現況盤點：`audit.md`（賣場 active=0）。設計來源：`docs/features/tour-catalog-rebuild/design.md`。
> 管線程式碼：`server/services/catalogRebuild/`（index / staging / completeness / guard / promote），觸發點 `server/routers/suppliersRouter.ts:2843`（`rebuildCatalog`）+ `:2890`（`revertCatalogBatch`）。

---

## 摘要（五節各兩三句）

1. 管線解讀：重建是「純搬運 + 純函式門檻」，全程零 LLM。輸入直接餵供應商鏡像（`supplierProducts` + `supplierProductDetails` 的 parsed JSON），經 `hydrateTourFromParsed`（零 LLM）算成待上架 tour，過完整度硬門檻，最後在單一 transaction 內原子換批（快照可回滾）。改寫 / 翻譯 / 校準是重建之後的另一層 async LLM，不在此管線內。
2. 成本估算：重建本體 LLM 成本 = $0（只花供應商 API + DB 寫入 + 算力）。要花錢的是選配的潤稿層（Haiku 4.5 改寫 + 英譯 + 校準，冷快取約 $0.11–0.23/團）與全生成層（含 AI 生圖約 $0.20/團）。llmCache TTL 只有 24 小時、翻譯快取 7 天，事故隔 23 天 = 快取全冷，能省的趨近於零。
3. 品質門檻：建議「completeness 過門檻即上（先求有），calibration 低分標記後補（潤稿排隊）」。completeness 是純函式硬門檻（缺行程/景點/價/班期就擋、缺圖只軟旗標不擋）；calibration 是 Haiku 打 0–100 分的 gate，不寫 tours，只標記給 Jeff 一鍵審。
4. 執行 runbook：管線一次處理一個 scope = 一個 catalogBatch = 一個 promote transaction（非多小批）。建議三步：先全量 dryRun 看數字 → limit=25 小批真上 + 回滾演練 + Jeff 眼看 → 全量 confirm=true 真換批。紅線：全程 admin 手動觸發、絕不 cron，每次真換批前 Jeff 點頭。
5. 前置檢查：0097 migration（catalogBatches / toursCatalogArchive / tours.batchId）當日已 commit，schema 與管線相容；staging 相關表現為空（catalogBatches=0，等於史上第一批，回滾語意 = 退回 draft）；圖片存 Cloudflare R2，DDL 清的是 DB 不是 bucket，R2 物件應仍在，且管線用的是供應商鏡像 URL，不依賴被清的 tours 列。

**兩檔成本估算（Haiku、冷快取、選配潤稿層；重建本體本身 $0）**

| 檔位 | 團數（任務錨定） | 潤稿版 B（改寫+英譯+校準） | 全生成版 C（含 AI 生圖） |
|---|---|---|---|
| 日本先行 | 1,205 | $133 – $277 | ~$241 |
| 全量 | 5,640 | $620 – $1,297 | ~$1,128 |
| 實跑今日可跑（UV active，見下） | ~500 | $55 – $115 | ~$100 |

重建本體（把賣場從空變成有貨、原始供應商文案）= **$0 LLM**。以上是「之後要不要把文案潤成品牌口吻 + 英譯 + 配圖」的加值成本。快取節省 ≈ $0（隔 23 天全冷）。

**最大風險（一條）**：**供應商行銷照的版權紅線與管線實作直接衝突。** design.md 紅線 #3 + audit S2 都白紙黑字說「供應商圖是他們的行銷照，客人頁不直接放原圖，存網址當素材、自家重做版再上」；但重建管線目前把 `supplierProducts.imageUrl`（供應商行銷照）直接寫進 `tours.heroImage` / `tours.imageUrl`（客人頁會渲染），而 completeness 又把「無圖」列為軟旗標（不擋上架）。結果是二選一都踩雷：照跑就把供應商圖公開顯示（踩版權紅線），要嘛把圖拿掉上一批無圖空殼（audit 說這就是擋賣場開張的實體瓶頸）。上架前必須由 Jeff 裁示（見第三節「圖片三選一」）。

---

## 一、管線解讀

### 1.1 資料流（哪些純搬運、哪些 LLM）

```
供應商 API ─(syncUvCatalog + enrichUvProduct，純 fetch)→ 鏡像表
  supplierProducts / supplierDepartures / supplierProductDetails(parsed JSON)
        │  ← 事故後完好（7,600 / 6,007 筆）
        ▼
staging.buildStagedTour(純函式，零 LLM)
  hydrateTourFromParsed(parsed JSON → tours 對客欄，檔頭註明 "Zero LLM cost")
  + assessTourCompleteness(硬門檻) + assertRetailOnly(成本欄紅線)
        ▼
index.rebuildCatalog(orchestrator)
  對映既有 tour（就地更新 id/URL/SEO 穩）或建 draft → promotable[]
        ▼
promote.promoteBatch(單一 transaction)
  每團：快照舊列進 toursCatalogArchive → 就地 update 新值 + status=active + batchId
  這批沒對到的舊 active 團 → 退役 inactive（先快照）
  catalogBatches：這批 live、上一批 archived
```

**全程零 LLM。** 我把每支都讀過，`server/services/catalogRebuild/` 下沒有任何 `invokeLLM` / `claude-` 呼叫；`enrichUvProduct`（`supplierSync/uvDetail.ts`）是純供應商 fetch，`hydrateTourFromParsed` 檔頭明寫「純轉換」。改寫 / 翻譯 / 校準 / 生圖是重建之後跑在 tours 上的另一層（見第二節），不屬於這條管線。

### 1.2 輸入：直接餵鏡像，不需先過改寫

`rebuildCatalog('uv')` 直接讀 `supplierProducts`（status='active'）+ 批次預載 `supplierDepartures` / `supplierProductDetails`，經 staging 純函式算成候選。**不需要先過 `supplierRewriteService`。** 改寫是可選的後續潤稿，且 `rewriteSupplierTourInPlace` 有守門：0 班期或 price<=0 就拒改（facts 必須先在），所以順序天然是「先重建 → 後潤稿」。

`skipSync=true` 可略過 sync+enrich（鏡像已最新時），純用現有鏡像重建 tours。事故後鏡像完好但可能過期，建議首跑 `skipSync=false` 讓 enrich 把明細補到最新（純 fetch，$0 LLM）。

### 1.3 completeness 門檻擋什麼（`completeness.ts`）

硬門檻（缺任一 → 不上架，進 `missing`）：title、destinationCountry、days>0、priceRetail>0、≥1 個未來班期、每日行程（itineraryDetailed 非空陣列）、景點（attractions 非空陣列）。

軟旗標（不擋，只回報）：無任何圖（hero/main/gallery 皆空）、行程天數 < days、景點 < 3。

含意：**無圖不擋上架**（圖是軟旗標）。這正是第三節圖片裁示的技術根源。

### 1.4 promote 怎麼分批 / revert 怎麼回滾（`promote.ts`，有測試把關）

- **不是多小批。** 一個 scope 一次跑 = 開一筆 catalogBatch、把整批 promotable 在**單一 transaction** 內換掉。中途任一步丟錯 → 整個 txn rollback，客人永遠看到一致狀態（無空窗）。要小批只能靠 `limit=N`（取前 N 個產品）。
- promote 順序：先退役（快照→inactive）→ 再上架（快照舊列→就地 update）→ 翻批狀態（這批 live、`replacedBatchId` 那批 archived）。每個 promotable 進 DB 前再過一次 `assertRetailOnly`（DB 邊界紅線，有測試 `RED LINE: throws if fields carry a cost/agentPrice key`）。
- `revertBatch(batchId)`：把該批所有快照寫回 tours（就地）→ 該批翻 archived、它換掉的上一批翻回 live。一個 txn、可稽核。壞快照跳過不炸整批（有測試）。只還原 `RESTORABLE_TOUR_COLUMNS` 那 25 個重建管線會動的欄（不碰 createdAt/startDate 等，避開時區坑）。
- **史上第一批的特例（本次適用）**：現在 tours 表全空、catalogBatches=0，所以首跑 `replacedBatchId=null`、`matchedExisting=0`、全部 `wouldCreateNew`（建全新 draft 再 promote）。回滾首批 = 快照是剛建的空 draft，退回 = tours 回 draft（賣場再次變空），這是正確的安全語意（首批出事就退回沒上架）。

### 1.5 觸發面（要補的小缺口）

server 端 tRPC `suppliers.rebuildCatalog` / `suppliers.revertCatalogBatch` 已存在且有 audit log，但 **client 端沒有任何按鈕接它**（grep 全站無 client 呼叫）。所以今天要跑，只能發認證過的 tRPC 呼叫（curl / 一次性 script），不符「admin 手動觸發」的順手度。建議把它做成 SuppliersTab 的一顆 admin 按鈕（純 UI 接線，不動管線邏輯），dryRun / limit / confirm 都走既有 input。這是唯一的前置 code 工，且很小。

---

## 二、成本估算

### 2.1 LLM 呼叫點（全部 Haiku 4.5，$1/M 入、$5/M 出）

重建管線本體 = **零呼叫**。下列是重建**之後**選配的加值層（寫在 tours 或 sidecar）：

| 層 | 檔案 / 入口 | 模型 | 每團呼叫數 | 每團成本（冷快取） | 寫哪 |
|---|---|---|---|---|---|
| 改寫（潤稿） | `supplierRewriteService.rewriteSupplierTourInPlace` | Haiku 4.5 | 3 prose agent + 1 calib ≈ 4 | $0.06 – $0.11 | tours 欄（updateTour） |
| 英譯 | `translation.translateTour`（→ en 一種語言） | Haiku 4.5 | 20 – 60（per-field/per-day/per-hotel） | $0.03 – $0.10 | `translations` sidecar 表（非 tours 欄） |
| 校準 gate | `calibrationAgent.calibrateTour` | Haiku 4.5 | 1（+0–2 罕見 autofix） | $0.005 – $0.01 | 不寫（回報告，caller 設 status） |
| 全生成（含生圖） | masterAgent → tourGenerationQueue | Haiku + 生圖/vision | 多階段 | ~$0.20（程式碼實測值） | tours 欄 + imageLibrary |
| 配圖比對 | `smartMatchImages` / `assignItineraryImages` | 無 LLM（規則式） | 0 | $0 | imageLibrary |

註：`priorityRewriteCron` 檔頭實測「每次 full rewrite ~$0.20」= 全生成版（含生圖）。純文字改寫（不生圖）便宜些，約 $0.06–0.11。翻譯只有 en 一種（`Language = 'zh-TW' | 'en'`，**沒有 zh-CN 路徑**，audit 提的簡中缺席在此屬實）→ 別按三語估，按一語估。

### 2.2 兩檔總成本

以「重建本體 $0 + 選配潤稿/全生成」拆三檔：

- **檔位 A 上架版（重建本體）**：$0 LLM。tours 帶原始供應商 hydrate 文案 + 供應商圖 URL，過 completeness 硬門檻。這一步就讓賣場從空變有貨。
- **檔位 B 潤稿版**：A + 品牌口吻改寫 + 英譯 + 校準。冷快取每團 $0.11 – $0.23。
- **檔位 C 全生成版**：全 masterAgent（含 AI 生圖）。每團 ~$0.20（AI 生圖順帶解掉供應商圖版權問題，見第三節）。

| | 日本 1,205（任務錨定） | 全量 5,640（任務錨定） | 實跑今日 UV active ~500 |
|---|---|---|---|
| A 上架版 | $0 | $0 | $0 |
| B 潤稿版 | $133 – $277 | $620 – $1,297 | $55 – $115 |
| C 全生成版 | ~$241 | ~$1,128 | ~$100 |

**團數要誠實**：任務給的 1,205（日本）/ 5,640（全量）是**事故前 tours 表**的計數（含 draft + Lion + 全部）。今天管線只吃 `status='active'` 的供應商鏡像、且**只支援 UV**（Lion 需先解 NormGroupID 橋接，管線目前直接 throw）。依 design.md 2026-06-16 盤點：UV active ≈ **493 團**（近乎完整：100% 有行程、99% 有景點、94% 有圖），UV inactive 639 是空殼（會被 status 過濾掉、不處理）。所以**今日 scope='uv' 真正會產出的約 500 團、不是 1,205**。要到 1,205 / 5,640 需要（a）先建 Lion 橋接（code，未做）和/或（b）把更多供應商產品翻 active。權威數字以 **dryRun 的 `productsScanned` / `complete` 為準**，計費團數 = `complete`（不完整的不建 tour、不產生潤稿成本）。

### 2.3 快取能省多少（誠實：趨近零）

- `llmCache`（`_core/llmCache.ts`）：Redis SETEX，**TTL 24 小時**，key 含 model。事故隔 23 天 → 全部過期，冷。
- 翻譯快取（`translation.ts`）：Redis，**TTL 7 天**，一樣冷。
- Anthropic prompt cache：只有 5 分鐘 / 1 小時，無關。
- **唯一能跨 3 週存活的是 DB `translations` 表的「原文沒變就跳過」**（比對 originalText）。但 tours 被清空 = 沒有既有譯文可跳過，等於也沒得省。
- 結論：這次重建的潤稿層要付**全額**，快取節省 ≈ $0。這是誠實估。

---

## 三、品質門檻（先上架標準）

### 3.1 兩道關的分工

- **completeness（硬門檻，純函式，$0）**：進賣場的最低資格。缺行程/景點/價/班期就擋。這是「能不能上」。
- **calibration（Haiku gate，$0.005/團，不寫 tours）**：0–100 分，≥85 approved（可一鍵審）、60–84 review（Jeff 看）、<60 rejected（退 draft）。查目的地 fidelity（城市↔國家對不對、title 有沒有跟目的地打架）。這是「上得好不好、要不要潤」。

### 3.2 建議：先求有，過門檻即上，低分標記後補

**傾向：completeness 過門檻即上（檔位 A），calibration 低分標記排隊潤稿（檔位 B/C 之後補）。** 理由：

- 利：賣場現在是空的（audit 三大痛之首），A 檔 $0 且立即，先把貨上架比先潤稿重要得多；UV active 近乎完整（100% 行程 / 99% 景點），過門檻率高，raw 供應商文案雖不品牌口吻但資訊齊全可讀。潤稿可用既有的月度 `priorityRewriteCron`（日本已加權 +8）慢慢補，或手動分批。
- 弊：raw 供應商文案不是品牌口吻、無英譯、calibration 可能不少 review 級。這是「先求有再求好」的已知代價，可接受。

**但先求有卡在一個實體門檻 = 圖（見 3.3）。** 沒解圖，A 檔要嘛帶供應商圖（踩版權）、要嘛無圖上架（completeness 允許但難看）。

### 3.3 圖片三選一（Jeff 裁示，這是全案最大決策）

管線把供應商圖 URL 直接寫進 tours.heroImage/imageUrl 會顯示；design.md 紅線 #3 說不可。三條路：

1. **接受供應商圖暫時上**（Jeff 明確裁示可，或先跟供應商確認授權）：A 檔立即開賣、最快。風險：版權/品牌，與現有紅線文字衝突，需 Jeff 白紙推翻或界定「僅這批暫用」。
2. **無圖上架**：completeness 允許（軟旗標），A 檔 $0 立即，但 audit 說無圖賣場等於沒開張，體感差。適合當「先讓 SEO / 列表有貨」的過渡，圖後補。
3. **走全生成檔位 C（AI 生圖）**：masterAgent 生自家圖，順帶解版權問題，且是 design.md「自家重做版」的具體實現。成本 ~$0.20/團（日本 ~$241），時程較長（生圖慢、吃月度預算）。

我的建議：**過渡走 2（無圖或占位圖先上架 + prerender 讓 SEO 有貨）→ 日本熱門團優先跑 3（AI 生圖）補圖 + 潤稿**，避免踩 1 的版權紅線，也不讓賣場繼續空。最終仍請 Jeff 拍板。

---

## 四、執行 runbook

### 4.0 紅線（焊死）

- 全程 **admin 手動觸發，絕不 cron**。重建/promote/revert 都是手動一次一次跑。（潤稿的月度 cron 是另一層、既有的，不在此列。）
- 每次**真換批（dryRun=false）前 Jeff 點頭**。全量真換批（無 limit）程式已強制 `confirm=true`（防手滑）。
- prod schema 只准經 tracked migration 由 release_command 跑。這次重建只走 app 的 tRPC mutation，**不碰任何 DDL / drizzle-kit push**（正是事故主因，絕不重蹈）。

### 4.1 分批建議與人工檢查點

一個 scope 一次一個 batch（非多小批）。分階段降風險：

| 步 | 動作 | 觸發 | Jeff 檢查點 |
|---|---|---|---|
| 1 | 全量 dryRun | `rebuildCatalog({scope:'uv', dryRun:true})` | 看 `productsScanned / complete / incomplete / missingBreakdown / incompleteSamples`，確認會上幾團、缺什麼 |
| 2 | 小批真上（前 25 團） | `{scope:'uv', dryRun:false, limit:25}` | 上 prod 眼看 ~10 個團頁：文案通順？價對？班期對？圖的處理符合裁示？ |
| 3 | 回滾演練 | `revertCatalogBatch({batchId: <步2>})` | 確認 25 團退回、賣場乾淨、可回滾機制實跑過一次才敢全量 |
| 4 | 全量真換批 | `{scope:'uv', dryRun:false, confirm:true}` | 跑前口頭點頭；跑後看 RebuildReport `promoted / retired` |
| 5 | 潤稿排隊（選配） | 手動或既有月度 cron | 日本團優先（cron 已 +8 加權），calibration <60 的退 draft 不上 |

### 4.2 指令（tRPC mutation，非終端指令；建議做成 SuppliersTab 按鈕）

- dryRun 全量：`suppliers.rebuildCatalog({ scope:'uv', dryRun:true, skipSync:false })`
- 小批真上：`suppliers.rebuildCatalog({ scope:'uv', dryRun:false, limit:25 })`
- 全量真換批：`suppliers.rebuildCatalog({ scope:'uv', dryRun:false, confirm:true })`
- 回滾一批：`suppliers.revertCatalogBatch({ batchId:<N> })`

（`skipSync:true` 可略過重抓、純用現有鏡像重建，首跑建議 false 讓明細補到最新。）

### 4.3 觀測（進度怎麼回報）

- 每跑回傳 `RebuildReport`：productsScanned / complete / incomplete / promoted / retired / newDrafts / matchedExisting / wouldCreateNew / missingBreakdown / incompleteSamples。一眼看「補了多少、擋了多少、缺什麼」。
- `catalogBatches` 表存 status + 各計數 + notes（缺項彙整 JSON）；`adminAuditLog` 存 `catalog.rebuild` / `catalog.revert`（誰、何時、promoted/retired）。
- **補觀測神經（事故教訓，強烈建議同批做）**：deploySmoke 加第八臂「對客 active tours > 0」，賣場再歸零永不無聲。這正是事故三週無告警的根因缺口。

### 4.4 失敗處理

- promote 是單一 transaction，中途丟錯 → 整批 rollback、catalogBatches 停在 staging（永不翻 live）、tours 完全沒動。重跑即可。
- enrich / refreshTourDepartures 是 best-effort（fail-open，記 errorFunnel），單團失敗不炸整批，completeness 會把補不齊的擋在門外。
- 上架後才發現整批不對 → `revertCatalogBatch` 退回上一批（首批則退回 draft）。
- **交易大小注意**：全量 UV（~500 團）在一個 txn 內做 ~500×（1 select + 1 archive insert + 1 update）＋每團一份整列 JSON 快照（mediumtext）。TiDB 交易上限寬鬆，500 團應無虞；但若日後接上 Lion（數千團）要留意 txn 體積，`limit` 小批正好也是體積的安全閥。

---

## 五、前置檢查清單（重建前逐項確認）

| # | 要確認 | 現況（偵察所見） | 動作 |
|---|---|---|---|
| 1 | **0097 schema 與管線相容** | `0097_catalog_rebuild.sql` 事故當日已 commit（f182ee7）；`drizzle/schema.ts` 有 catalogBatches / toursCatalogArchive / tours.batchId+lastBatchAt，欄位與 promote.ts 的 `RESTORABLE_TOUR_COLUMNS` 對得上（有測試 `RESTORABLE_TOUR_COLUMNS covers the rebuild-managed fields`）。 | 確認 prod `__drizzle_migrations` 有 0097 這筆（事故時七張表被 recreate，schema 應在位）。 |
| 2 | **staging / batch 表狀態** | tours=0、catalogBatches=0（事故清空）。等於史上第一批，`replacedBatchId=null`、全 `wouldCreateNew`。 | 無需清理，直接首跑。認知：首批回滾 = 退回 draft、非退回舊資料。 |
| 3 | **R2 圖片資產還在不在** | 圖存 Cloudflare R2（`server/storage.ts`），事故是 DB DDL、不碰 R2 bucket，物件應仍在。且**管線的圖來自供應商鏡像 URL（`supplierProducts.imageUrl`，完好），不依賴被清的 tours 列**。 | 抽查幾個 R2 key 可讀即可；圖的真正決策是版權（第三節），不是「還在不在」。 |
| 4 | **供應商鏡像新鮮度** | supplierProducts 7,600 / supplierProductDetails 6,007 完好，但可能過期（事故前抓的）。 | 首跑 `skipSync:false` 讓 enrich 補到最新（純 fetch，$0 LLM）。 |
| 5 | **Lion 是否要一起** | 管線只支援 UV，Lion 直接 throw（需先解 NormGroupID 橋接）。5,640 全量今日不可跑。 | 本次只做 UV/日本。Lion 是另一個 code 任務，別綁進這次。 |
| 6 | **觸發面** | tRPC 有、client 無按鈕。 | 補一顆 SuppliersTab admin 按鈕（唯一小 code 前置），或首跑用認證 tRPC 呼叫。 |
| 7 | **圖片版權裁示** | 管線會顯示供應商圖，紅線說不可。 | **上架前必須 Jeff 拍板**（第三節三選一）。這是開跑的真正 gate。 |
| 8 | **TiDB PITR/備份** | 事故 23 天，大概率超保留窗。 | 花一分鐘在 TiDB 控制台確認；若竟有 6-17 前備份，策展層可直接撈回、跳過重建。 |
| 9 | **本地無 DB** | 本地無 DATABASE_URL，DB 操作須在 prod/Fly 跑。 | dryRun/rebuild 都在 prod 環境觸發（經 app），不在本機。 |

---

## 附：與現有紅線的相容性核對

- 成本價不外洩：管線 staging 出口 + promote DB 邊界各過一次 `assertRetailOnly`（`guard.ts`），擋 agentPrice / industrylowestprice / rawDepartureJson 等；有測試把關。tours 只寫 retail。**相容。**
- 部署紅線：本計畫零 DDL、零 `flyctl deploy`、零 drizzle-kit push；全走 app tRPC mutation，手動觸發。**相容且正是事故的反面。**
- i18n / 設計紅線：本計畫不動前端 JSX、不動樣式，屬資料層重建。潤稿的英譯走既有 `translation`（en 一語，zh-CN 待另案）。**相容。**
