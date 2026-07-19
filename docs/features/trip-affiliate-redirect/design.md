# Trip.com Affiliate Redirect MVP — Design

> **batch-4 起本檔 §〇~§六為歷史章節**:Codex 終驗裁定收口為 homepage-only redirect,
> 自建深連結程式碼(含 `TRIP_DEEP_LINK_ENABLED` 旗標)已整組移除。現行架構見文末
> 「§七、batch-4 現行架構:homepage-only redirect」。歷史章節保留,因其參數驗證
> 結果是第二階段(Trip.com Link Builder 確認後)的事實基礎。
>
> 2026-07-16。所有 URL 形狀與參數都經唯讀落地驗證(未登入、未讀 Jeff 個人 cookie、無下單、零付款、
> 測試資料;過程曾唯讀觀察測試瀏覽器自身的 attribution cookie 狀態,那是驗證的一部分)。
> 原始證據:`evidence-20260716.md`(同資料夾)。
> batch-2(Codex P1 覆核)後追加:deep-link 預設關閉 + 忠實意圖 + 原型鍵守門 + 去識別 + 限流,見 §六。

## 〇、deep-link 預設關閉(batch-2 · 最高優先)

`deepLinkEnabled()` 讀 `process.env.TRIP_DEEP_LINK_ENABLED === "true"`,**預設 false**,call-time 讀取
(可不重建即切換,測試可 toggle)。`generateFlightLink` / `generateHotelLink` 開頭即 gate:關閉時直接
回退 `APPROVED_HOMEPAGE_ENTRY`。理由:cookie 有設不等於佣金認列(亂編素材也會設),且 Trip.com FAQ
說勿自改平台連結。Jeff 向 Trip.com 確認前,線上只出現已核准主入口。§一以下的深連結行為只在旗標開啟時生效。

## 一、驗證過的參數表(只送這些,其他一律不送)

Trip.com **靜默失敗**:給它看不懂的值,它不報錯,而是安靜地渲染別的東西。
(`class=w` → Economy;城市名 → 客人上次搜尋的城市)。所以「沒驗過的參數不送」不是潔癖,是防呆。

### 機票 `https://www.trip.com/flights/showfarefirst`【已親證】

| 參數 | 值 | 證據 |
|------|----|------|
| `dcity` / `acity` | 3 碼 IATA(小寫) | `dcity=sfo&acity=nrt` → 37 筆真實 SFO→NRT 結果 |
| `ddate` / `rdate` | `YYYY-MM-DD` | 帶出 "Tue, Sep 15 — Tue, Sep 22" |
| `triptype` | `rt` 來回 / `ow` 單程 | `ow` → One-way 被選中,單一日期,53 筆結果 |
| `class` | `y` Economy / `c` Business / `f` First | `c` → "2 Passengers · Business";`f` → "1 adult · First" |
| `quantity` | 成人數 | `quantity=2` → "2 adults" |
| `childqty` | 兒童數 | `quantity=1&childqty=1` → "2 Passengers" |

- **日期非必要**【已親證】:只給 `dcity`+`acity` 仍會深連結("Flights from Taipei to Tokyo",97 筆,
  預設隔天)。這條讓沒有日期的「熱門航線」入口保住深連結,不必掉回主入口。
- **Premium Economy 無獨立代碼**:`w`、`p` 實測都靜默變 Economy。Trip.com 艙等篩選把
  「Economy/premium economy」併成一桶,故 `premiumEconomy → y`,客人會落在含 premium economy 的那一桶。
- **嬰兒無已驗證參數** → 不送,客人在 Trip.com 自行調整。
- 已知瑕疵【已親證】:用機場碼(`nrt`)時 Trip.com 的 "Going to" 輸入框渲染成空白,
  但搜尋結果確實是 SFO→NRT;用城市碼(`tyo`)則正常顯示。屬 Trip.com 端顯示問題,不影響搜尋正確性。

### 飯店 `https://www.trip.com/hotels/list`【已親證】

| 參數 | 值 | 證據 |
|------|----|------|
| `city` | **數字** Trip.com 城市 ID | `city=228` → "Tokyo Hotels",6,291 筆 |
| `checkin` / `checkout` | `YYYY-MM-DD` | → "Tue, Sep 15 - Fri, Sep 18, 3 nights" |
| `crn` / `adult` / `children` | 房數 / 成人 / 兒童 | `crn=2&adult=3&children=1` → "2 rooms, 3 adults, 1 child" |

- **城市名會被完全忽略**【已親證,關鍵】:要 `city=Osaka` 卻拿到 **Tokyo** 結果
  (搜尋框顯示 Tokyo、6,291 筆、池袋淺草飯店)。Trip.com 回退到訪客上次搜尋的城市。
  現行程式送的正是 `city=Tokyo`(名稱),等於**可能把客人送到錯的城市**。
  > 過程紀錄:先前單測 `city=Tokyo` 看似會過,那是被上一輪 `city=228` 汙染的假象,
  > 換一個沒去過的城市(Osaka)才照出來。單一樣本會騙人。
- 故只對**已驗證數字 ID** 深連結,其餘回退主入口(Jeff 裁示)。目前已驗證:`tokyo = 228`。
  **新增 ID 必須做同樣的落地驗證,禁止猜。**

### 已核准主入口(回退目標)

`https://hk.trip.com/?Allianceid=7896974&SID=296102808&trip_sub1=&trip_sub3=D13390050`

逐字輸出,不經 `URL`/`searchParams` 重建(會重新編碼與重排)。Trip.com FAQ 說勿修改平台產生的連結,
故這條用常數 + 測試釘死。

## 二、模組設計

### `server/services/affiliateLinkService.ts`(唯一造連結的地方)

- `TRIP_COM_CONFIG`:allianceId `7896974`、sid `296102808`、素材
  `flights=S14595667`(官方機票 Search Box)、`hotels=S18716875`(官方飯店 Search Box)、
  `homepage=D13390050`(已核准主入口素材)。
- `APPROVED_HOMEPAGE_ENTRY`:逐字常數,同時是 fail-safe 目標。
- `isAllowedTripUrl(raw)`:HTTPS + hostname 精確落在
  `{trip.com, www.trip.com, hk.trip.com, us.trip.com}`。用 `URL.hostname` 比對(不是字串 includes),
  故 `trip.com.evil.com`、`https://www.trip.com@evil.com` 都擋得掉。
- `generateFlightLink` / `generateHotelLink` / `generateHomepageLink`
  → 回傳 `{ url, deepLinked }`。`deepLinked=false` 代表回退主入口,呼叫端必須告知客人可能要重打條件。
- `trackAffiliateClick`:寫入前再過一次 `isAllowedTripUrl`,非 Trip.com 一律拒寫。

**fail-safe 規則**:任何一項驗不過(非 IATA、城市無已驗證 ID、日期格式怪)→ 回退已核准主入口。
永遠不會導到未知網域;最壞情況是客人落在 Trip.com 首頁並被明白告知要重打條件。

### `server/routers/affiliate.ts`

- 輸入 schema **移除 `ouid`**,且從未接受 allianceId / SID / 素材 ID。瀏覽器無法影響歸因對象,
  也沒有欄位可夾帶客戶識別碼。
- `resolveAffiliateLink()` 單一入口:`generateAffiliateLink`(查詢)與 `trackClick`(寫入)共用,
  **`trackClick` 不再接受瀏覽器給的 `targetUrl`**,改由後端用同一批輸入重新推導 canonical URL。
  這是「點擊只記允許的 canonical target」的落實點。
- `resolvePlatform()`:以**實際落地**決定 platform,回退時記 `trip_homepage`,
  讓點擊表能跟 Trip.com 報表對帳。
- 程序數維持 8 支,既有 `affiliate.test.ts` 冒煙測試不動即綠。

### `client/src/lib/affiliateRedirect.ts`(新增)

popup 攔截的根因:舊流程 `await` 完 API 才 `window.open()`,使用者手勢已經沒了,瀏覽器直接擋。

- `openPendingWindow()`:**在 click handler 同步**開 `about:blank`;順手把 `opener` 設 null
  (防 reverse tabnabbing)。不能用 `noopener`,那會讓 `window.open` 回傳 null,就拿不到 handle 導向。
- `redirectPendingWindow(pending, url)`:先過前端 allowlist(縱深防禦,後端已擋一次),
  用 `location.replace`(about:blank 不留在上一頁歷史);popup 被擋(handle 為 null)則退為本頁導向,
  客人的點擊還是有反應。
- `closePendingWindow()`:API 失敗時關掉空白頁,不讓客人卡在白畫面。

### 三個呼叫端

`FlightBooking` / `HotelBooking` / `PriceComparisonWidget` 同一套:
同步開空白頁 → `await` 取 URL → 立刻導向 → **點擊記錄改 fire-and-forget**(`void ... .catch(() => {})`)。
客人不必等追蹤寫完才跳轉,追蹤壞掉也不會擋住跳轉。

`HotelBooking` 熱門城市改帶 `cityKey`(`'tokyo'`)而非翻譯後的顯示名(`'東京'`)——
顯示名依語系變動,永遠對不上查表。顯示文字不動,UI 無變化。

i18n 新增 `flightBooking.page.toastFallback` / `hotelBooking.page.toastFallback`(zh-TW + en 對稱),
用於告知客人已被帶到 Trip.com 首頁、可能需重新輸入條件。

## 三、刻意不做

- 不重做搜尋框 UI、不動版面(只加 `cityKey` 欄位與回退提示文案)。
- 不顯示 Trip.com 即時庫存、不嵌 iframe、不收款、不做 MCP、不接 Hotel/Flight API。
- 不宣稱佣金已確認。`affiliateClicks` 是匿名點擊紀錄,不是收入表。

## 六、batch-2 不變量(Codex P1 覆核後)

1. **忠實意圖**:`deepLinked=true` 保證「客人指定的都忠實帶過,未指定的才可省略」。
   - `tripType` 顯式傳入;無 tripType 時由是否有合法 return 推斷。
   - 來回但缺/亂序 return(`return<depart`)→ 回退,不靜默降成單程。
   - 飯店 `checkOut<checkIn` → 回退。
   - `infants>0`:無已驗證 Trip.com 參數,不靜默丟一名旅客 → 回退。要解除須先落地驗證 infant 參數。
2. **原型鍵守門**:`ownLookup()` 用 `Object.hasOwn`,city 與 cabin 查表只認自有字串鍵。
   `constructor`/`__proto__`/`toString` 不再回傳 truthy 繼承值(否則會建出 `city=function...` 垃圾深連結)。
3. **結構性去識別**:`trackAffiliateClick` 型別上不收 userId/IP/UA,寫入列三欄一律 null。
   per-IP 濫用控制放在 router 的 ephemeral `checkRateLimit`(不入庫),不放進持久點擊表。
4. **GA 淨化**:`analytics.trackAffiliateClick` 只收 vouched `routeToken`(IATA pair / cityKey),
   以 `SAFE_ROUTE_TOKEN`(僅字母+單一連字號)再驗一次;含數字/空白/@ 的自由輸入一律變空字串。
   呼叫端:機票搜尋傳 `origin-destination`(IATA)、熱門航線傳 `fromCode-toCode`、熱門城市傳 `cityKey`;
   飯店自由搜尋不傳 token(城市是自由文字)。
5. **限流**:`trackClick` per-IP 60/小時,超過丟 `TOO_MANY_REQUESTS`。client fire-and-forget,不影響跳轉。

## 七、batch-4/5 現行架構:homepage-only redirect(2026-07-16,依 Codex 終驗 §八 + batch-4 終驗四 P1)

上面 §〇~§六描述的深連結架構已整組移除。現行架構只有四個件:

### 流程(一條線)

```
客人點 PACK&GO 搜尋鍵
  → openTripClickout(source)                      [client/src/lib/tripClickout.ts]
    → GA: {source, destination:"homepage_redirect"}(closed enum,runtime 再驗)
    → location.assign("/go/trip/<source>")         同頁、同源導向 — 無 popup 可被擋
  → GET /go/trip/:source                           [server/services/tripRedirect.ts]
    (掛在 pino-http 與 body parser 之前 — access log 看不到這條請求的 raw URL/query,
     body 也不會被 parse,壞 JSON GET body 進不了 400)
    → parseRedirectSource:非 4 值 enum → 400
    → 302 → APPROVED_HOMEPAGE_ENTRY(Jeff 核准 entry,原封逐字)— 先回應
    → void 匿名 telemetry(Lua 原子限流 60/h/IP;detached,任何失敗/懸掛都吞掉)
```

### 不變量

1. **closed enum 是唯一輸入**:`flight_search | hotel_search | tour_flight | tour_hotel`。
   endpoint 不讀 query/body;referrer、route、city、tourId、target URL、affiliate ID 皆無入口。
   route 掛在 access logger 之前,query 裡塞 PII 也進不了 log(batch-5,完整 middleware 整合測試)。
2. **telemetry = redirect request**,非 click truth:row 固定
   `platform=trip_homepage / referrerPage=<enum> / targetUrl=核准entry / userId=ipAddress=userAgent=null`。
   重放產生多筆相同 row;佣金真相源只有 Trip.com Affiliate report。admin 可見文案一律稱
   「導流請求/Redirect requests」,不稱點擊(batch-5,i18n guard 測試鎖住)。
3. **302 先回,任何東西都不得擋**:回應在 telemetry 之前送出;限流/Redis/DB 不論
   reject 還是**永不 settle**,客人都已經在路上(batch-5,never-resolve 測試)。唯一 400 是未知 source。
4. **URL gate**(`isAllowedTripUrl`):HTTPS + 官方 host 精確比對 + **拒 credentials + 拒非 443 port**;
   `redirectTarget()` 出口前再過一次 gate,常數被改壞時丟例外而非把客人送去未知網域。
5. **常駐告知 + 同頁導向**:三個 caller 的按鈕旁常駐 `redirectNotice` 文案(「條件不會自動帶入,
   請在 Trip.com 重新輸入」),不用 toast 當離站告知;導向用同頁 `location.assign`,
   不依賴 popup(batch-4 的 `_blank` window.open 被 blocker 回 null 時客人完全不動 — Codex 黑箱證實,
   batch-5 移除)。熱門航線/熱門城市卡片改開 PACK&GO 顧問(對話 icon,非外連 icon)。
6. **admin 對帳**:AffiliateTab 有 `trip_homepage` 統計卡/filter/三態 badge;
   legacy `trip_flights`/`trip_hotels` 標示為「歷史」,不再被二元 fallback 誤標。

### 測試錨點

`tripRedirect.test.ts` 打的是 `_core/index.ts` 掛的同一個 handler(§8.7 驗收清單逐條);
`tripClickout.test.ts` 釘死 caller 只開同源 `/go/trip/*`;`affiliateLinkService.test.ts`
釘死核准 entry 逐字不漂 + allowlist + 「模組不再 export 任何深連結 builder」。
