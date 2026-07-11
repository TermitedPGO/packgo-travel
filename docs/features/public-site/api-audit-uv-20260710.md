# UV 鏡像 → hydrateTourFromParsed API 正確性審計（線三·目錄重建前置）

> 審計產出，2026-07-10，Opus（API 正確性審計員）。全程唯讀：無 commit 應用碼、無 prod DB 寫入、無 promote。
> 任務：重建 500 團前，證明或推翻「UV 供應商鏡像 → hydrateTourFromParsed 產出的 tour 資料是對的」。價格錯 = 最嚴重（報價紅線）。
> 相關檔：`rebuild-plan.md`（重建計畫）、`incident-20260617-tours-wipe.md`（事故）、`audit.md`（賣場現況）。
> 管線碼：`server/services/catalogRebuild/`（index/staging/completeness/guard/promote）+ `server/services/supplierSync/`（uv/uvDetail/hydration）+ `server/services/uvBulkImportService.ts`（價格）。

---

## 判定：GO（附三條必做前置，見第五節）

證據結論一句話：**hydrate 產出的售價、天數、班期、行程結構、標題全部正確，價格紅線清白（取的是 UV 公開門市直客零售價，鏡像整層 54,629 筆班期 agentPrice 全 NULL，出口 guard 再鎖一道）。** 20 個抽樣團的 hydrate 售價與鏡像值 100% 一致，其中 10 個對 UV 即時 API 再比對也 100% 一致；completeness 門檻精準擋掉該擋的 5 個殘缺團、放行 15 個完整團，判定全對；49 條回歸測試全綠。

唯一需要在開跑前處理的是「明細層過期」（見第三節）與既有的「圖片版權」裁示（rebuild-plan 已列），都不是 hydrate 邏輯的錯，用重建計畫已寫的 `skipSync:false` 首跑即可自癒明細過期。

---

## 一、審計方法與證據鏈

三路交叉驗證，每個判定帶證據：

1. **鏡像快照（唯讀 SELECT）**：`flyctl ssh` 進 prod 機、以 mysql2 對 prod DB 跑純 SELECT，撈 20 個多樣 UV active 產品的 `supplierProducts` + `supplierProductDetails`（5 個 parsed 欄）+ `supplierDepartures`（rawDepartureJson）+ 新鮮度時間戳，另跑全量聚合。零寫入。
2. **本地跑真管線純函式**：以快照為輸入，import repo 真碼 `catalogRebuild/staging.ts`（連帶 hydration/completeness/guard，全純函式無 DB/queue 副作用）跑 `buildStagedTour`；價格照 `index.ts` 的 `buildUvDepartures` 用 `uvBulkImportService` 的 `buildDepartureFromMirrorRow`/`headlineFromBuiltDepartures`（原文照抄，避開該模組的 ../db、../queue 副作用，邏輯逐字一致）。不寫 DB。
3. **UV 即時 API 現值**：以 `server/suppliers/uvClient.ts` 同一組 header-guest 認證（免登入、無密鑰）重打 `getProductGroup` / `getProductMain`，取 UV 公開門市今日現值，比對鏡像與 hydrate。

抽樣涵蓋：天數 1–12 天、售價 US$1–US$9,199、11 個目的地（美國/秘魯/多國/墨西哥/巴西/馬爾地夫/加拿大/西班牙/瑞士/哥斯大黎加/摩洛哥）、有明細 18 個 + 無明細 2 個、有未來班期 19 個 + 零班期 1 個、含刻意抓進來的殘缺樣本（$1 佔位、無 country、無班期）。

抽樣代碼：P00008352, P00004442, P00008680, P00003708, P00004995, P00003693, P00003362, P00008667, P00006905, P00002762, P00006874, P00008808, P00001906, P00007049, P00000119, P00002305, P00008618, P00001649, P00008362, P00002460。

---

## 二、項目一：抽樣真值比對（20 團逐欄）

欄位說明：鏡像值 = `supplierDepartures.retailPrice` 未來班期 MIN；hydrate 值 = 真管線算出的 `tours.price`；UV 現值 = 即時 `getProductGroup` 起價（10 團抽驗）；班期 鏡像/hydrate = DB 未來班期數 vs hydrate 重建班期數；門檻 = completeness 判定。

| 代碼 | 天 | 目的地 | 鏡像售價 | hydrate售價 | UV現值 | 售價判定 | 班期 鏡/hyd | 門檻 | 擋因 / 備註 |
|---|---|---|---|---|---|---|---|---|---|
| P00008352 | 3 | 美國 | 598 | 598 | 598 | 一致 | 38/38 | 過 | 完整 |
| P00004442 | 6 | 秘魯 | 1249 | 1249 | 1249 | 一致 | 44/44 | 過 | 完整 |
| P00008680 | 9 | 多國 | 3680 | 3680 | 3680 | 一致 | 25/25 | 過 | 完整 |
| P00003708 | 4 | 墨西哥 | 980 | 980 | 980 | 一致 | 180/180 | 過 | 完整（有 pt2 兒童價，未被誤取為起價）|
| P00004995 | 7 | 巴西 | 2088 | 2088 | 未查 | 一致 | 157/157 | 過 | 完整 |
| P00003693 | 4 | 馬爾地夫 | 1720 | 1720 | 未查 | 一致 | 163/163 | 過 | 軟旗標 fewAttractions |
| P00003362 | 5 | 加拿大 | 708 | 708 | 未查 | 一致 | 109/109 | 過 | 完整 |
| P00008667 | 5 | 西班牙 | 1550 | 1550 | 未查 | 一致 | 25/25 | 過 | 完整 |
| P00006905 | 6 | 瑞士 | 2280 | 2280 | 2280 | 一致 | 174/174 | 過 | 完整 |
| P00002762 | 4 | 哥斯大黎加 | 1089 | 1089 | 未查 | 一致 | 25/25 | 過 | 完整 |
| P00006874 | 8 | 摩洛哥 | 1890 | 1890 | 未查 | 一致 | 4/4 | 過 | 完整 |
| P00008808 | 1 | NULL | 88 | 88 | 88 | 一致 | 148/148 | 擋 | 無明細 → 缺 country/行程/景點（正確擋）|
| P00001906 | 1 | NULL | 1 | 1 | 1 | 一致 | 180/180 | 擋 | 「機票預訂」US$1 佔位品，缺 country（正確擋）|
| P00007049 | 12 | 美國 | 9199 | 9199 | 9199 | 一致 | 1/1 | 過 | 軟旗標 noImage（$9,199 高價團仍正確算價）|
| P00000119 | 4 | 美國 | 368 | 368 | 未查 | 一致 | 8/8 | 擋 | 無明細 → 缺行程/景點（正確擋，有 country/價/班期）|
| P00002305 | 1 | NULL | 無 | 0 | 未查 | 一致 | 0/0 | 擋 | 零班期 → 缺 country/價/班期（正確擋）|
| P00008618 | 1 | 美國 | 148 | 148 | 148 | 一致 | 93/93 | 過 | 1 日團用 pt1 成人價，正確 |
| P00001649 | 1 | 美國 | 230 | 230 | 未查 | 一致 | 180/180 | 過 | 軟旗標 fewAttractions |
| P00008362 | 7 | 美國 | 1249 | 1249 | 未查 | 一致 | 8/8 | 過 | 完整 |
| P00002460 | 2 | 美國 | 298 | 298 | 298 | 一致 | 26/26 | 過 | 完整 |

**逐欄判定：**

- **售價**：20/20 hydrate = 鏡像；抽驗的 10/10 = UV 即時現值。零偏差，含 $1 / $88 / $9,199 極端值。判定：**hydrate 邏輯正確 + 鏡像價未過期**。
- **天數**：hydrate `duration` 直接沿用 `supplierProducts.days`，與 UV `tripDay` 一致（例 P00008352 現值 title「3 日遊」對得上 days=3）。
- **未來班期**：DB 未來班期數與 hydrate 重建數 20/20 完全相等（38/38、180/180、1/1、0/0）；即時 API 班期數與鏡像近乎相等（差 ±1 純屬 180 天滾動窗邊界，非漏抓）。判定：班期鏈正確。
- **行程日程**：itineraryDetailed 產出 `{day,title,activities[],meals{},accommodation}`（DayCard 形狀正確，實查 P00008352 三天齊、景點由路線鏈拆出）。日數多半 = 團天數。
- **標題**：hydrate 用鏡像 title = UV 門市 productName，一致。原文照搬（零 LLM），帶供應商促銷框（【金榜怡享】等）與「英文團」字樣，屬「先求有」的 raw 文案（非錯，見第五節建議）。

---

## 三、項目二：價格紅線專項（最嚴重項，多重舉證清白）

**結論：hydrate 取的是 UV 公開門市直客零售價（兩人一房 per-person 起價），絕非同業成本價。四重證據：**

### 3.1 資料源就是零售門市（code path）

- UV client 打的是 **公開門市** `uvbookings.toursbms.com` 經 Ctrip SOA2 gateway，**header-guest 認證、無 cookie/token**（`server/suppliers/uvClient.ts:46-57` `COMMON_HEADERS` + `:38-44` `GUEST_USER`）。這是客人在官網看到的零售價層。
- B2B 後台 `bms.toursbms.com`（cookie 認證、才有同業價）**明碼標註不使用**：`uvClient.ts:11-16` 註「we don't use that path until Phase 3」。所以資料源結構上就取不到同業成本價。

### 3.2 鏡像整層零 agentPrice（data-level 鐵證）

- `supplierSync/uv.ts:110`：寫班期時 `agentPrice: null,  // UV public storefront doesn't expose agent price`。
- 唯讀聚合實查：`SELECT COUNT(*), SUM(agentPrice IS NOT NULL) FROM supplierDepartures WHERE supplierId=2` → **total 54,629，hasAgent 0**。UV 鏡像沒有任何一筆班期帶成本價，物理上無從外洩。
- 對照組：Lion 的 `agentPrice` = IndustryLowestPrice = 同業成本（`guard.ts:16-22` 註）。UV 這條路根本沒有這個欄位有值。

### 3.3 取價邏輯取零售 pt4→pt1（code path + 現值舉證）

- 重建取價鏈：`catalogRebuild/index.ts:193-208` `buildUvDepartures` → `uvBulkImportService.ts:197-242` `buildDepartureFromMirrorRow` → `:151-157` `pickDepartureAdultPrice`：
  `const adult = byType(4) ?? byType(1);`（pt4 兩人一房 → pt1 成人），起價取 `headlineFromBuiltDepartures`（未來班期 pt4 最低 = 「從 $X 起」）。
- **價層是 per-person（不是整房價，不會低報一半）**：即時 API 實見價階單調遞減（占房愈多 per-person 愈便宜），例 P00008352 pt3 單人 768 > pt4 雙人 598 > pt5 三人 518 > pt6 四人 478。pt4=598 < pt3 單人 768，證明 pt4 是「雙人房每人價」而非整房價。取 pt4 為對客起價正確，不低報。
- **單人 pt3 過報（+30~37%）正確迴避**、**兒童 pt2 不誤取為起價**：P00003708 有 pt2=480（兒童）但起價正確取 pt4 路徑算出 980，未被 480 拉低。
- 回歸測試明鎖：`uvBulkImportService.test.ts`「never picks priceType=3 even when it is the first tier」「returns 0 for a single-occupancy-only (pt3) departure — never over-quotes」「uses priceType=4 for the headline, not a cheaper higher-occupancy tier」。實跑 **18/18 綠**。

### 3.4 出口 guard 再鎖一道（回歸鎖）

- `catalogRebuild/guard.ts` `assertRetailOnly` 遞迴掃對客 payload，命中 `agentprice`/`industrylowestprice`/`costprice`/`spareseats`/`rawdeparturejson`（大小寫、底線、子字串皆擋）即 throw。staging 出口（`staging.ts:128`）+ promote 出口各過一次。
- 20 個抽樣 hydrate 出的 fields **全數通過 guard，零 CostLeakGuardError**。`guard.test.ts` + `staging.test.ts` 的 RED LINE 測試 **16 條綠**。

### 3.5 幣別：無 FX 風險

UV 全 USD（`currencyCode CI00000002`、`productCurrencyNum "USD"`），`tours.priceCurrency` 直接寫 USD，無換匯。對照 Lion 是 TWD 需換算，UV 沒有這層風險。

**價格紅線判定：清白。取直客零售、per-person 正確、成本價物理不存在、出口再鎖、測試綠。**

---

## 四、項目三：鏡像新鮮度（三層分別看）

UV 供應商 id=2。鏡像分三層，新鮮度差很多：

| 層 | 內容 | 最後同步 | 判定 |
|---|---|---|---|
| 產品層 `supplierProducts` | 標題/天數/目的地/圖 URL | maxSync **2026-07-10**（今日）；1194 筆中 1180 在事故日後同步、僅 14 過期 | **新鮮** |
| 班期層 `supplierDepartures` | 售價/餘位/未來出發日 | maxSync **2026-07-10**（今日）；即時 API 現值 10/10 對得上 | **新鮮**（價格今日有效）|
| 明細層 `supplierProductDetails` | 逐日行程/景點/含蓋/須知/自費 | lastEnrichedAt 全落在 **2026-05-25～05-30**（1094 筆 100% 在 6/1 前、0 筆之後） | **過期約 6 週** |

**含意：**

- **價格與班期是今日鮮的**（第二、三節已實證），這是報價紅線最在意的部分，安全。
- **行程/景點文案凍結在 5 月底**，約 6 週未更新。行程內容變動頻率低，過渡期可接受；但若 UV 這 6 週改過某團行程，鏡像會顯示舊行程。
- **自癒路徑已在計畫內**：`rebuildCatalog(skipSync:false)` 首跑會先 `syncUvCatalog()`（刷產品+班期）**再 `enrichAll()` 重抓明細到最新**（`index.ts:290-323`），純 fetch、$0 LLM。所以照 rebuild-plan 建議的 `skipSync:false` 首跑，promote 出去的團明細就是當下最新，過期問題消失。**只有用 `skipSync:true` 才會上到 6 週前的行程。**

**停售/滿團會不會誤上架（availability 鏈）：**

- 鏡像只收 `stockStatus:200`（可售）班期（`uvClient.ts:262` `getProductGroup(stockStatus:200)`）；供應商完全下架的產品在 `getPagerProductTemp(status:200)` 抓不到 → 同步的 stale-detection 把它翻 `inactive`（`uv.ts:253-275`），重建只吃 `status='active'`（`index.ts:308-314`），停售品被過濾。**正確。**
- 邊角：若某團所有未來班期都「已售完但仍掛可售狀態（full）」，completeness 的 futureDeparture 門檻仍算它 1 個 → 會上架，但每個班期顯示「已滿」（三級餘位）。屬可接受（未來可能開位、狀態如實顯示），非誤價。列為小注意。

**團數校正（重要）**：rebuild-plan 依 2026-06-16 舊盤點估「今日 UV active ~500」。今日實查 **UV active = 1,127**（鏡像 6/17 後已重新同步、產品數長回）。但真正會過門檻的（有未來班期 + 有 parsed 行程 + 有 country + days>0）proxy = **516**；有未來班期的 active = 541。所以 **實際會 promote 的仍約 500–516 團**，與計畫估值吻合；另約 600 個 active 會被門檻正確擋掉（多數缺未來班期或缺 country 或無明細）。權威數字仍以 dryRun 的 `productsScanned`/`complete` 為準。

---

## 五、項目四：completeness gate 有效性

門檻碼 `catalogRebuild/completeness.ts`。硬門檻（缺任一即擋）：title、destinationCountry、days>0、priceRetail>0、≥1 未來班期、itineraryDetailed 非空、attractions 非空。軟旗標（不擋）：無圖、行程天數 < days、景點 < 3。

**20 團實跑：15 過 / 5 擋，擋的原因逐一核對全對：**

| 擋掉的團 | 硬門檻缺項 | 該不該擋 |
|---|---|---|
| P00008808（1日 芝加哥半日遊，無明細）| destinationCountry, dailyItinerary, attractions | 該擋。無明細=無行程無景點、country NULL |
| P00001906（「機票預訂」US$1 佔位）| destinationCountry | 該擋。$1 佔位品、無目的地，不該進賣場 |
| P00000119（4日 美國，無明細）| dailyItinerary, attractions | 該擋。有 country/價/班期但無逐日行程與景點 |
| P00002305（1日，零班期）| destinationCountry, retailPrice, futureDeparture | 該擋。無班期=無價無出發日 |

- 15 個放行團全部有完整行程+景點+價+未來班期+country，放行正確。
- 軟旗標運作正常：`fewAttractions`（景點<3，如馬爾地夫路線少）、`noImage`（無 hero，如 P00007049 $9,199 團）不擋上架、只回報，符合 Jeff「缺圖不擋」裁示。
- 全域門檻體質：active 1,127 中 35 缺 destinationCountry（會被擋，正確）、0 缺 title、0 天數<=0；明細層 itineraryParseStatus **parsed 1,076 / parse_failed 18 / 無明細列 33**。

**判定：門檻有效，擋放精準，沒有殘缺團漏過、沒有完整團誤擋。**

**一個內容品質缺口（非門檻問題，但 Jeff 要知道）**：UV 明細層 **priceTerms 只有 34/1,094、notices 只有 34/1,094 是 parsed**（optional 自費 1,076 正常）。即約 96% 的 UV 團 hydrate 後 `costExplanation`（含蓋什麼）與 `noticeDetailed`（須知）是空的。hydrate 邏輯本身正確（來源沒東西就不塞，正確不造假），但來源資料稀疏，上架後這兩塊多半空白。行程逐日、景點、自費、售價都齊，只是「費用說明/出行須知」偏空。

---

## 六、結論與清單

### 判定：GO（hydrate 資料正確性成立），附三條開跑前置

核心問題「UV 鏡像 → hydrateTourFromParsed 產出對不對」的答案是 **對**：售價（直客零售、per-person、無成本外洩）、天數、班期、行程結構、標題全部正確，門檻擋放精準，回歸測試全綠。價格紅線清白，這是本審計最重的一項，可放心。

### 必做前置（開跑前）

1. **首跑必用 `skipSync:false`**（或先手動 enrich 一輪）。否則明細層是 6 週前（5/25~30）的行程。計畫已這樣寫，這裡確認為硬前置：`skipSync:true` 會上到過期行程。
2. **圖片版權裁示（沿用 rebuild-plan 第三節）**。管線把供應商行銷照直接寫 `heroImage`/`imageUrl`，與 design.md 紅線 #3 衝突。這是開賣真正的 gate，需 Jeff 三選一拍板（暫用/無圖/AI 生圖）。本審計不改變此結論，只確認 hydrate 對圖的搬運行為如計畫所述。
3. **先 dryRun 看真數字再小批**。今日 UV active=1,127（非計畫舊估的 ~500），實際 complete 約 500–516。以 `rebuildCatalog({scope:'uv',dryRun:true,skipSync:false})` 的 `complete`/`missingBreakdown` 為權威團數與缺項，再照計畫 limit=25 小批 + 回滾演練 + 全量。

### 建議（非阻擋，可後補）

4. **取價 fallback 硬化（小）**：`pickDepartureAdultPrice`（`uvBulkImportService.ts:155`）在 pt4 與 pt1 都缺時，fallback 取「第一個非 pt3 的 tier」，理論上可能取到 pt5/pt6（三/四人房，per-person 更低）造成低報。本次 20 樣本全未觸發（房型團都有 pt4、1 日團都有 pt1），實務機率極低；但建議改為 pt4→pt1→跳過（回 0）而非落到 pt5/pt6，與 `buildDepartureFromMirrorRow` 的「寧可跳過不過報」一致。低報是商業風險非成本外洩，故列建議不列必做。
5. **內容稀疏後補**：96% UV 團的 costExplanation / noticeDetailed 空白（第五節）。屬「先求有」可接受，之後靠潤稿層或重抓補；上架前知會即可。
6. **標題原文帶促銷框**：raw title 含【金榜怡享】等供應商促銷字與「英文團」，屬檔位 A 已知代價，潤稿層再處理。
7. **觀測補課**：deploySmoke 加「對客 active tours > 0」臂（事故三週無告警的根因），強烈建議同批做。

---

## 附：證據出處

- **管線碼**：`server/services/catalogRebuild/{index,staging,completeness,guard,promote}.ts`；`server/services/supplierSync/{uv,uvDetail,hydration}.ts`；`server/services/uvBulkImportService.ts`（取價 `pickDepartureAdultPrice:151` / `buildDepartureFromMirrorRow:197` / `headlineFromBuiltDepartures:245`）；`server/suppliers/uvClient.ts`（門市認證 46-57、不用 B2B 11-16）。
- **回歸測試（本次實跑 49/49 綠）**：`catalogRebuild/{completeness,guard,staging}.test.ts` + `uvBulkImportService.test.ts`。另存在 `promote.test.ts`、`retailOnlyEndpoints.regression.test.ts`、`hydration.test.ts`、`uv.test.ts`、`uvDetail.test.ts` 未逐跑但涵蓋 promote/revert/schema 紅線。
- **prod 唯讀查詢**（SELECT only，經 `flyctl ssh` + mysql2）：agentPrice 聚合（54,629/0）、新鮮度三層時間戳、parse-status 分布、20 樣本鏡像 dump。
- **UV 即時 API**（免登入 header-guest，同 uvClient）：10 團 `getProductGroup` 起價 + 價階 + 庫存 + `getProductMain` 標題，與鏡像/hydrate 三方比對全一致。
- **本地真管線跑**：import repo `staging.ts` 純函式鏈 + 原文照抄取價函式，對 20 樣本產出 hydrate 值，未寫任何 DB。
