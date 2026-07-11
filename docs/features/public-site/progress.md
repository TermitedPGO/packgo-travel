# 線三·公開網站目錄重建 — progress

> 進度回寫。工作分支 `public-site-rebuild`(worktree,從 main b936074 開)。未合 main、未碰 prod、未 promote。

## 2026-07-10 · 批次 R1:兩份審計修四件(Lion 接線 + provenance + UV fallback + 圖片層)

規格書:`api-audit-uv-20260710.md`、`api-audit-lion-20260710.md`、`rebuild-plan.md`。

### 1. Lion 接線(catalogRebuild 支援 scope='lion')
- `catalogRebuild/index.ts`:sync 閘(+syncLionCatalog)、enrichAll(+enrichLionProduct)、loadExistingSupplierTours(Lion 分支:tours 空回空 Map、日後靠 sourceUrl 的 NormGroupID param 對映)、班期重建分流到新 Lion adapter + TWD→USD 換匯。
- 新 `catalogRebuild/lionDepartures.ts`(純函式):`buildLionDepartureFromMirrorRow` / `buildLionDepartures` 取 **StraightLowestPrice(直客)**,絕不取 IndustryLowestPrice(同業/成本);`convertLionDeparturesToUsd(built, rate)` 純函式套匯率(async fetch 放 index adapter 層,不塞純函式);`pickRepresentativeGroupId` 取最近未來團(不拿鏡像最舊那顆,lion-audit §2.3)。
- 匯率走既有 `exchangeRateAgent.getExchangeRate('TWD','USD')`,rebuild 開跑時 fetch 一次。
- 紅綠:`lionDepartures.test.ts`(9 tests)— 直客價選取 / 同業價絕不出現 / TWD→USD 換算(14,950 → 460 USD)/ GroupID 校正到最近未來 / 過期跳過 / 額滿標 full。

### 2. destinationCountry provenance(lion-audit §5.1 真蟲)
- Lion travelinfojson `GroupInfo.Country` 是出發國(永遠 TW)非目的地。改用既有 `lionLocation.deriveLocation`(名稱+行程推導,NO guessing)。
- `supplierSync/lionDetail.ts`:新增純函式 `deriveLionDestination(travel, dayTrip)`;`enrichLionProduct` 的 country 回填改走它(abstain→null→門檻擋,不寫錯值)。移除已無用的 `LION_COUNTRY_MAP`。
- `lionBulkImportService.ts`(現有直匯路徑同步修):`lionDataToTourRecord` 改用 deriveLocation,丟掉 `data.country→TW` 的 fallback。
- 紅綠:`lionDetail.test.ts` +3 — 杜拜團(Country='TW')解出「阿聯」不再標台灣;小琉球仍解台灣;信號不足時 abstain(null)而非誤標台灣。

### 3. UV 取價 fallback 硬化(uv-audit §4)
- `uvBulkImportService.ts:pickDepartureAdultPrice`:pt4→pt1→0(跳過),移除舊「第一個非 pt3 tier」fallback(可能落 pt5/pt6 低報)。
- 紅綠:`uvBulkImportService.test.ts` +3(共 21)— pt5/pt6-only 回 0(不低報)、pt4 在時仍取 pt4、mirror 版同步跳過;既有 18 條未弱化,全綠。

### 4. 圖片層(供應商圖不上客人頁,指揮裁決 + design.md 紅線 #3)
- `catalogRebuild/staging.ts`:`buildStagedTour` 不再把供應商 heroImage/imageUrl 寫進對客 `fields`;改掛在 staging 內部欄 `StagedTour.supplierImageUrl`(供參考;鏡像本就永久保有)。completeness 圖輸入改 null(noImage 軟旗標,不擋)。
- 新 `catalogRebuild/stockPhotoResolver.ts`:`buildStockPhotoQuery`(景點>城市>國家)+ `resolveStockPhoto`(注入式 search,預設 unsplashService)。fail-open:無 key / 查無 / 出錯 → null = 無圖上架。
- `index.ts`:非 dryRun 時 `attachStockHeroImages(promotable)` 配對客 hero(並發 5,promote 就地寫入);draft 建成無圖(不用供應商 URL)。
- 紅綠:`staging.test.ts` +1(供應商 URL 絕不進對客 fields,guard 式);`stockPhotoResolver.test.ts`(10 tests)— 命中/未命中/無 key 三態 + 無訊號不打 API。

### 驗證(本批)
- `NODE_OPTIONS=--max-old-space-size=6144 tsc --noEmit`:0 錯。
- vitest(catalogRebuild + supplierSync + uvBulkImport + lionLocation):17 files / 231 tests 綠,連跑兩輪穩定。

### 附錄:探針腳本原文(地雷 #7)
本批 **未跑任何探針腳本 / flyctl ssh / node 探針 / code-in-string blob** — 全程唯讀 repo 檔案 + 本地 vitest/tsc。無探針原文需留檔。(兩份審計的探針原文見各自審計檔的證據附錄。)

### 已知限制 / 待辦(交指揮)
- 本地無 DATABASE_URL:rebuildCatalog 端到端(sync/enrich/promote)未在本機實跑,只跑了純函式 + 型別 + 測試。dryRun/小批真上須在 prod/Fly 觸發(rebuild-plan §4 runbook)。
- Lion 換匯寫進 tours.price 是「當下匯率快照」,之後匯率變不自動更新(與現有 UV/Lion 匯入同性質)。
- Unsplash 免費層速率限制(~50/hr):數百~數千團批次超額後 resolveStockPhoto 多回 null → 無圖上架;後續潤稿/AI 生圖另案補。
- Lion 良率預期 ~6 成(自由行/郵輪/機加酒卡 attractions 硬門檻,lion-audit §4.3),非 bug。
- destinationCountry provenance 修的是 enrich 回填 + 直匯路徑;已在 tours 表的舊 Lion 團(事故後為空)不受影響。
