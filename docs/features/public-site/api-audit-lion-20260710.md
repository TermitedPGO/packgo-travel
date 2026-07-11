# Lion(雄獅)接口診斷：目錄重建 Lion 半為何 throw + 修復方案

> 偵察產出，2026-07-10。唯讀 repo + 打 Lion 公開 API（免登入）。零 code 改動、零 prod 寫入。
> 姊妹檔：`rebuild-plan.md`（UV 先行計畫，§5 第 5 列已標「Lion 直接 throw，需先解 NormGroupID 橋接」）。本檔把那條「需先解」查到底。
> 管線程式碼：`server/services/catalogRebuild/`。Lion 客戶端：`server/suppliers/lionClient.ts`、`server/services/lionTravelApiService.ts`、`server/services/supplierSync/lion.ts`、`server/services/supplierSync/lionDetail.ts`。

---

## 判定（一句話）

**小修可通，不需大規模重抓。** Lion 鏡像存的 ID 是對的、Lion 公開 API 活著（抽 10 個 10/10 存活）、Lion 明細 parser + hydrate + staging + 成本紅線 guard 全部已是 supplier 無關、對 Lion 資料實跑不 throw。卡點只在**重建總指揮（`catalogRebuild/index.ts`）三處只寫了 UV 分支 + 缺一個 Lion 班期 adapter + 缺 TWD→USD 換匯決策**。估計淨增 120 到 180 行、集中在 index.ts。**不必另開重抓大工**（sync + enrich 本來就是重建流程的一步，Lion 版函式都已存在，只差接線）。

三個必須配套處理的資料品質風險見 §5，其中 destinationCountry provenance 是唯一「不接會出錯值」的坑。

---

## 一、復現 throw：確切錯誤與 file:line

重建對 Lion 會 throw，**不是**在 hydrate/staging 核心，而是在總指揮的 supplier 分流閘。依 `rebuildCatalog(scope, opts)` 執行順序，有兩個硬閘：

### 閘 1（預設 `skipSync=false` 先撞這個）
`server/services/catalogRebuild/index.ts:290-293`
```ts
// 1. 刷新鏡像(sync 產品+班期 → enrich 明細)。skipSync 時略過。
if (!skipSync) {
  if (scope === "uv") await syncUvCatalog();
  else throw new Error(`[catalogRebuild] scope='${scope}' sync 尚未接上`);  // ← line 292
}
```
`rebuildCatalog('lion')`（tRPC `suppliers.rebuildCatalog` 已接受 `scope: z.enum(["uv","lion"])`，見 `suppliersRouter.ts:2846`，所以 throw 發生在函式體內、非 input 驗證）預設就撞這行。

### 閘 2（`skipSync=true` 繞過閘 1 後撞這個）
`server/services/catalogRebuild/index.ts:162-169`（在 line 325 被呼叫）
```ts
async function loadExistingSupplierTours(scope: RebuildScope): Promise<Map<string, ExistingTour>> {
  if (scope !== "uv") {
    throw new Error(
      `[catalogRebuild] scope='${scope}' 尚未接上 tours 對映(Lion 需先解 NormGroupID 橋接)。目前只支援 'uv'。`,  // ← line 166-168
    );
  }
  ...
```

### 另有兩處「不 throw 但只做 UV」的隱性斷點（繞過上面兩閘也產不出 Lion 團）
- `enrichAll` 只認 UV：`index.ts:222-226` — `scope === "uv" ? await enrichUvProduct(...) : null`（Lion 明細永不補）。
- 班期重建寫死 UV：`index.ts:384-388` 呼叫 `buildUvDepartures(...)`，而 `buildUvDepartures`→`buildDepartureFromMirrorRow`（`uvBulkImportService.ts:197`）解的是 UV 的 `rawDepartureJson` 形狀（`groupDate`/`groupPrice[]`）。Lion 的 `rawDepartureJson` 是 `LionGroupEntry` 形狀（`GoDate:"YYYY/MM/DD"`/`StraightLowestPrice`/`IndustryLowestPrice`），餵進去回 null，起價變 0 → 被完整度門檻擋光。

### 本地無 DB，怎麼證 hydrate/staging 核心對 Lion 是乾淨的
本地無 `DATABASE_URL`，`getDb()` lazy 回 null（`server/db.ts:81-82`），`rebuildCatalog()` 會先在 line 283 因無 DB 提早 throw，撞不到 Lion 閘。因此我改跑**純函式路徑**：抓真 Lion API → 過真 Lion parser（`lionDetail.ts`）→ 真 `buildStagedTour`（`staging.ts`），完全不碰 DB。結果（8 個真產品，指令 `tsx lion_staging_harness.mts`）：

```
#1 旅展一口價｜小琉球…      | days=2 price=6038  country=台灣 => ok=true  missing=[]            soft=[fewAttractions]
#2 馬祖旅遊｜南北竿東引…    | days=3 price=13950 country=台灣 => ok=true  missing=[]            soft=[]
#3 26年航程｜挪威郵輪暢悅號… | days=8 price=47700 country=台灣 => ok=false missing=[attractions] soft=[]
#4 璽品杜拜親子奇幻7日…      | days=7 price=109000 country=台灣 => ok=true missing=[]            soft=[]
#5 金門旅遊…                | days=3 price=8980  country=台灣 => ok=true  missing=[]            soft=[]
#6 小琉球｜高鐵…豐富3日     | days=3 price=7999  country=台灣 => ok=true  missing=[]            soft=[fewAttractions]
#7 《聯合航空》直飛關島…機加酒 | days=5 price=38500 country=台灣 => ok=false missing=[attractions] soft=[]
#8 ２人成行│北京自由行…     | days=7 price=45900 country=台灣 => ok=false missing=[attractions] soft=[]
==== staging yield: 5/8 pass hard completeness (no buildStagedTour throw = staging is supplier-agnostic) ====
```

結論：`buildStagedTour` 對 Lion **零 throw**、`assertRetailOnly` 出口不擋（無成本欄漏出）。**hydrate/staging/guard 核心已是 supplier 無關，病根 100% 在 index.ts 的 UV-only 分流。**

---

## 二、NormGroupID 鏈路：鏡像存什麼 ID、API 需要什麼、斷點在哪

### 2.1 鏡像存的 ID（`supplierSync/lion.ts`）
| 層 | 欄位 | 存的值 | 出處 |
|---|---|---|---|
| 產品 `supplierProducts` | `externalProductCode` | **NormGroupID**（UUID） | `lionToProductInsert` `lion.ts:51` |
| 產品 | `rawProductJson` | 整個 NormGroup（含 `GroupList[]`，每筆有 GroupID + 價） | `lion.ts:63` |
| 班期 `supplierDepartures` | `externalDepartureCode` | **GroupID**（如 `26TS711SL38-T`，含出發日碼） | `lionGroupToDeparture` `lion.ts:90` |
| 班期 | `retailPrice` / `agentPrice` | **直客 StraightLowestPrice** / **同業 IndustryLowestPrice** | `lion.ts:78-79`、`112-113` |

即：NormGroupID 與 GroupID **兩個 ID 鏡像都有存**，且直客/同業價已分兩欄。

### 2.2 lionTravelApiService 這條鏈需要什麼（`lionTravelApiService.ts:199-235`）
```
NormGroupID ─travelinfojson→ GroupInfo.GroupID ─(NormGroupID+GroupID)→ priceinfojson / daytripinfojson / noticeinfojson
```
起點是 NormGroupID（鏡像有），travelinfojson 回當前代表 GroupID，再帶兩個 ID 打其餘明細端點。

### 2.3 斷點在哪：不在資料、在接線；一個 GroupID 選取的眉角要注意
抽 10 個鏡像等價產品（Lion search API 輸出 == 鏡像存的東西）實跑鏈路（指令 `node lion_probe.mjs`）：

```
[search] window 2026-07-11..2027-07-11
[search] TotalCount=5100 TotalPage=26 Count=200 NormGroupList.len=200

#1 NormGroupID=a15c5c18-…  mirror GroupID=26TS711SL38-T
   travelinfojson → GroupID=26TS716SL38-T  Country=TW TourDays=2  ← 注意:API GroupID ≠ mirror GroupID
#2 NormGroupID=9a4e7531-…  mirror 直客=14,950 同業=14,200
   travelinfojson → GroupID=26TI722SBL-T  daytripinfojson DailyList.len=3 attractions=19
…
==== SUMMARY (n=10) ====
alive(travelinfojson GroupID ok)=10  withPrice=10  withItinerary=10  mirrorHasAgentPrice=10  fullChainOk=10
```

**鏈路本身沒斷，10/10 通。** 但有一個實作眉角必須寫對：

**mirror 的 GroupID 會漂。** `GroupList[0].GroupID` 是 sync 當下最早那團的碼（碼裡含出發日，如 `711`=約 7/11）；隨最近的團賣完或過期，Lion 的「當前代表團」往後移（`716`、`722`…）。所以：
- **別直接拿 `GroupList[0].GroupID` 去打明細**（那團可能已過期 → 拿到過期價或空）。
- **正解 = 先 live 打 `travelinfojson(NormGroupID)` 取當前 GroupID**（`lionTravelApiService` 就是這樣做），或用 `enrichLionProduct` 內的 `resolveLionGroupId`（`lionDetail.ts:205`，挑鏡像裡「最近未來」那筆 departure，比 `[0]` 穩）。這兩個 Lion 版函式**都已存在**，橋接只要「用它們」而不是「重寫」。

**能不能從鏡像既有欄位直接拿可用 GroupID？** 可以拿到，但不建議「直接用最舊那顆」。建議走 enrich（會 live 校正到當前團），這也正是重建流程 enrich 那一步該做的事。

---

## 三、價格紅線：直客/同業、TWD→USD 匯率鏈

### 3.1 hydrate 取直客價，成本紅線已 Lion-aware
- 鏡像已把 **直客(Straight)→`retailPrice`**、**同業(Industry)→`agentPrice`** 分兩欄（`lion.ts:78-79`）。10/10 都帶同業價（如 #2 直客 14,950 vs 同業 14,200，同業較低=成本）。
- 出口紅線 `guard.ts:16-22` 的禁字含 **`industrylowestprice`（Lion 原始欄名）+ `agentprice` + `rawdeparturejson`**，guard 檔頭白紙寫「同業價=我們的成本」。實跑 `buildStagedTour` 未 throw = 目前 hydrate 不會把同業價帶進對客欄。**紅線已守，且本來就為 Lion 寫的。**
- 註：我的探測腳本曾把 `costExplanation` 這個 hydrate 欄旗成疑似洩漏，**那是誤報**（naive 子字串 `cost` 命中）。真 guard 的禁字表不含它、`assertRetailOnly` 沒 throw，`costExplanation` 是「費用說明」文字欄、非成本價，合法。
- Lion 班期 adapter 要寫對的一點：起價取 `StraightLowestPrice`（直客），**絕不可誤取 `IndustryLowestPrice`（同業/成本）**。用鏡像 `retailPrice` 欄或 raw 的 Straight 欄，別碰 agent 欄。

### 3.2 TWD→USD 匯率鏈路：**目前重建管線沒有換匯，這是缺口**
- Lion 幣別全 TWD（10/10 `CurrencyCode=TWD`）。UV 的 `importOneUvProduct` 寫 `priceCurrency:"USD"`（UV 原生美金），Lion 現有 `lionBulkImportService.ts:120-121` 是 `priceCurrency: data.currencyCode`（直接存 TWD、不換）。
- 重建 staging（`staging.ts:118-119`）直接寫 `price: pricing.priceRetail` + `priceCurrency: pricing.currency`，**無換匯**。Lion 走這條 → tours 帶 TWD 數字（對美國客面站不對，或至少與 UV 團的 USD 不一致）。
- 匯率鏈路存在：`server/agents/exchangeRateAgent.ts` 的 `convertCurrency(amount,'TWD','USD')`；來源 `https://open.er-api.com/v6/latest/USD`（免費）、base=USD；**新鮮度：Redis 1 小時 TTL（`exchangeRateAgent.ts:26`）→ 記憶體 → 靜態備用匯率**（API 掛時 fallback）。
- 眉角：`convertCurrency` 是 **async**，而 `buildStagedTour` 是純同步函式。所以換匯要放在 **index.ts 的 Lion adapter**（算 priceRetail 時）先換好，再把 USD 值 + `currency:"USD"` 餵進 staging。別想塞進 staging 純函式。

---

## 四、修復方案（不實作）：改哪些檔、幾行、要不要重抓、風險

### 4.1 需要動的檔（全部集中在 index.ts；其餘皆「已存在、只差被呼叫」）

| # | 位置 | 現況 | 要做 | 規模 |
|---|---|---|---|---|
| a | `index.ts:290-293` sync 閘 | 只 `syncUvCatalog()` | 加 `else if (scope==="lion") await syncLionCatalog()`（`supplierSync/lion.ts:133` 已存在） | ~2 行 |
| b | `index.ts:222-226` enrichAll | 只 `enrichUvProduct` | 加 `scope==="lion" ? enrichLionProduct(...)`（`lionDetail.ts:101` 已存在） | ~3 行 |
| c | `index.ts:384-388` 班期重建 | 寫死 `buildUvDepartures` | 依 scope 分流到新 `buildLionDepartures`（解 `LionGroupEntry` 形狀 raw：`GoDate`→日期、`StraightLowestPrice`→adult(直客)、`Status`→餘位；跳過 `IndustryLowestPrice`） | **新增 ~40-60 行**（唯一真新程式） |
| d | `index.ts:162-190` loadExistingSupplierTours | `scope!=="uv"` 直接 throw | 加 Lion 分支：事故後 tours 全空→回空 Map 即可（全部 `wouldCreateNew` 建 draft）；長遠要靠 `sourceUrl` host（`travel.liontravel.com` + `NormGroupID` param）+ `productCode` 做穩定對映，避免日後 re-run id churn 砸 SEO | 首批 ~5 行；穩定版 ~20-30 行 |
| e | Lion adapter 內換匯 | 無 | 用 `convertCurrency(priceRetail,'TWD','USD')`（async，在 index adapter 算價時），staging 收到已是 USD + `currency:"USD"` | ~10-15 行 |

小計淨增約 **120-180 行**，其中真正「新邏輯」只有 c（Lion 班期 adapter）與 e（換匯）；a/b 是接線、d 首批是回空 Map。**零 schema/DDL 改動**（0097 已在位，欄位共用 UV）。

### 4.2 要不要重抓鏡像資料
**不需要另開重抓大工。** sync + enrich 本來就是 `rebuildCatalog(skipSync=false)` 的第一步，接好 a/b 後這步會自己把 Lion 鏡像刷新到最新（純 fetch，$0 LLM）。抽測顯示：
- Lion 公開 API 活著、**10/10 存活**、直客/同業/行程/班期都拿得到。
- 明細（itinerary/attractions/price/notice）都是 enrich 當場 live 抓，鏡像即使過期也會被 enrich 覆寫。
- 唯一「結構性缺欄」是 destinationCountry（見 §5.1），那不是靠重抓補得回來的欄位，是要改 provenance 邏輯（ArriveID/名稱推導）。

估算：Lion sync 12 個月窗 `TotalCount=5100` NormGroups。若全量 enrich（每團 6 個 detail 端點、rate-limited、並發 5），約數千團的補抓是可行但耗時的一次性跑（建議先 `limit=25` 小批，同 UV runbook）。真正的**鏡像現存 Lion 筆數要在 prod 查**（本地無 DB）：
```sql
SELECT p.status, COUNT(*) FROM supplierProducts p
JOIN suppliers s ON p.supplierId = s.id
WHERE s.code = 'lion' GROUP BY p.status;
```

### 4.3 風險點
1. **完整度良率明顯低於 UV。** 抽樣 5/8（約 62%）過硬門檻，3 個失敗全卡 `attractions`（郵輪 #3、機加酒 #7、自由行 #8）。原因：`hydration.ts:281 buildAttractionsList` 只從 `itinerary.days[].attractions[]` 生景點，而這類 FIT/郵輪產品 Lion 的 `daytripinfojson` 本來就沒逐日景點清單（實測 attractions=0）。景點是**硬門檻**（`completeness.ts:91-92`）→ 這批直接被擋。含意：Lion 全量丟進去，可能只有 6 成上得了架，缺的集中在自由行/郵輪/機加酒。跟團（escorted）良率高。**這是良率預期，不是 bug**，但估「Lion 會產出幾團」要打 6 折。
2. **txn 體積。** 全量 Lion（數千團）若一個 promote transaction 換批，體積遠大於 UV ~500。務必用 `limit` 小批（rebuild-plan §4.4 已提醒）。
3. **換匯新鮮度 / fallback。** open.er-api.com 掛時走靜態備用匯率，價格會偏；且匯率 1hr 快取。客面已有免責聲明（exchangeRate router），但重建寫進 tours.price 是「當下快照」，之後匯率變不會自動更新（與現有 UV/Lion 匯入同性質，非新問題）。
4. **GroupID 漂移**（§2.3）：若圖省事直接用 `GroupList[0].GroupID` 而非走 enrich 校正，會拿到過期團的價/明細。修時務必用 `resolveLionGroupId`/travelinfojson 當前 GroupID。

---

## 五、資料品質風險（配套處理，其一是硬坑）

### 5.1 destinationCountry provenance 是錯的（唯一「不接會出錯值」的坑）
`enrichLionProduct` 用 `travelinfojson` 的 `GroupInfo.Country` 回填 destinationCountry（`lionDetail.ts:148-153`），且 `lionTravelApiService.ts:81-85` 註解把 Country 當「目的地 ISO-2」。**實測推翻此假設**：杜拜團（NormGroupID `adc85581-…`）的 `GroupInfo.Country="TW"`，其 `StartFromCityList=[台北,高雄]`、另有 `ArriveID="40-C-4"`、`IsForeign`。抽的 10 團**全部 Country=TW**（含挪威郵輪、關島、北京、杜拜）。

即 **`Country` 是出發國（台灣），不是目的地。** 後果：
- destinationCountry 是**硬門檻**，回填成「台灣」→ 門檻**會過**（非空），但值**語意錯**（杜拜團標成台灣）。
- 下游 calibration 會抓 city↔country 打架、目的地頁路由也會錯。
- 正解：destinationCountry 改由 `ArriveID` 映射表或 tourName 解析推導，**別信 Country**。此坑同時影響現有 Lion 匯入（非重建獨有），值得一併修。台灣國內團（小琉球/馬祖/金門）剛好 Country=TW 正確，所以問題被國內團掩蓋、只在出境團爆。

### 5.2 班期數偏少（軟性）
Lion search 的 `GroupList` 每產品只回約 4 筆（實測 len=4），非全部班期（完整日曆在 `groupcalendarjson`）。過 `futureDepartureCount>=1` 沒問題，但客面只看得到約 4 個出發日。要更多日期需另接 `groupcalendarjson`（`lionTravelApiService` 已有此呼叫可參考）。非上架阻擋，屬體驗優化。

---

## 附：Lion 產品量與存活率（§任務第 5 項）

- **live 可售量**：Lion search 12 個月窗 `TotalCount=5100` NormGroups（`node lion_probe.mjs` 實測，2026-07-10）。
- **存活率**：抽 10 個，travelinfojson 拿到當前 GroupID 10/10、有價 10/10、有行程 10/10、full-chain（GroupID+price+itin）10/10。**live 池健康**。
- **可上架良率外推**：真 staging 抽 8 個過硬門檻 5 個（~62%），缺者集中在自由行/郵輪/機加酒（卡 attractions）。若 Lion 全量約 5,100，樂觀估可上架約 3,000-3,300 團（打 6 折），實際以 `dryRun` 的 `complete` 為準。
- **鏡像現存 Lion 筆數**：本地無 DB 無法查，需在 prod 跑 §4.2 的 SQL。任務提的 1,205（日本）/ 5,640（全量）是**事故前 tours 表**計數（含 UV+draft），非 Lion 鏡像數，別混用。

---

## 證據附錄（可重跑）

- 探測腳本：`/private/tmp/.../scratchpad/lion_probe.mjs`（search + travelinfojson→GroupID→priceinfojson→daytripinfojson，抽 10）。
- staging 實跑：`/private/tmp/.../scratchpad/lion_staging_harness.mts`（真 Lion parser → 真 `buildStagedTour`，抽 8，`tsx` 跑）。
- destinationCountry 反證：杜拜團 travelinfojson `GroupInfo.Country="TW"` / `ArriveID="40-C-4"` / `StartFromCityList=[台北,高雄]`。
- 全程唯讀 repo、只打 Lion 公開 API、無 prod 寫入、無 DB 連線。
