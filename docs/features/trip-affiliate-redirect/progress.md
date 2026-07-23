# Trip.com Affiliate Redirect MVP — Progress（總覽 / Gate）

> 給監工看的總覽。**監工不信文件自我宣稱,結論獨立驗證**。
> 隔離工作樹 `網站-trip-affiliate`,分支 `trip-affiliate-redirect-mvp`,基準 `4c86254`。

## 狀態

| Stage | 內容 | 狀態 |
|-------|------|------|
| 0 | 唯讀落地驗證(連結格式/參數真值) | ✅ 完成(2026-07-16) |
| 1 | 文件四件套 | ✅ 完成(2026-07-16) |
| 2 | 連結格式修正 + popup 窄修 + 安全閘 + 測試(batch-1) | ✅ 完成(2026-07-16) |
| 2.5 | Codex P1 覆核修正 + deep-link 預設關閉(batch-2) | ✅ 完成(2026-07-16) |
| 2.7 | Codex 終驗 P1 修正(batch-3) | ✅ 完成(2026-07-16) |
| 2.9 | **homepage-only redirect 收口(batch-4,依 Codex §八固定方案)** | ✅ 完成(2026-07-16) |
| 2.95 | batch-4 終驗四 P1 窄修(302 先回/route 前置/同頁導向/導流語意,batch-5) | ✅ 完成(2026-07-16) |
| 2.97 | batch-5 終驗唯一 P1(GA throw 阻斷導向)+ 四類文字真值(batch-6) | ✅ 完成(2026-07-16) |
| 3 | Codex 真正最後機械確認 batch-6 | ⬜ 等驗 |
| 4 | Trip.com Link Builder 正式連結或書面確認(第二階段 deep link 另案) | ⬜ 未開始 |
| 5 | 部署 | ⬜ **未授權**(停止線:不 commit、不 push、不部署) |

**目前狀態階梯:已在隔離工作樹改完並驗證,未 commit、未合併、未部署、未啟用。**

**重要(batch-4 起):自建 deep link 已整組移除,不是關閉。** 不存在 `TRIP_DEEP_LINK_ENABLED`
旗標,沒有任何 env 可以復活動態深連結。第一階段唯一出口 = Jeff 核准的主入口(原封逐字)。
動態深連結屬第二階段,等 Trip.com Link Builder 正式連結或書面確認後**另案設計**。

## Codex P1 覆核(2026-07-16,batch-2)

Codex 覆核 batch-1 後回四個 P1,均先對實際程式碼親證屬實才修(細節與親證見 `tasks/batch-2.md`):

1. **點擊紀錄並非匿名 + GA 收自由輸入**:伺服端 `trackAffiliateClick` 改為結構性去識別(不收也不寫
   userId/IP/UA);前端 GA 只送 vouched route token(IATA pair / cityKey),PII 一律丟棄。
2. **來回/日期先後/嬰兒被靜默改錯**:新增顯式 `tripType`;無法忠實表達的來回、`return<depart`、
   `checkOut<checkIn`、`infants>0`(無已驗證參數)一律回退。`deepLinked=true` 現在保證「忠實帶過」。
3. **原型鍵繞過城市白名單**:`{tokyo:"228"}["constructor"]` 會回傳 truthy 建構子並建出垃圾深連結;
   改用 `Object.hasOwn` 守門,city 與 cabin 查表只認自有字串鍵。
4. **公開 trackClick 無限流**:加 per-IP `checkRateLimit`(60/小時),超過丟 `TOO_MANY_REQUESTS`;
   IP 只當 ephemeral key 不入庫。client 本就 fire-and-forget,節流不影響客人跳轉。

## Codex 終驗(2026-07-16,batch-3)

Codex 終驗 batch-2 仍 FAIL,回四個 P1,均親證屬實並修(細節與親證見 `tasks/batch-3.md`):

1. **GA 仍漏姓名**:舊 token 正則讓 `Jeff-Hsieh` 這類連字號姓名通過 → 收緊為嚴格 IATA pair 或全小寫
   城市鍵;呼叫端改用 `flightRouteToken`/`hotelCityToken`,free text 根本不產 token。
2. **referrerPage PII + 限流可重放**:`referrerPage` 加 `sanitizeReferrerPage`(只留自家路徑);限流改
   原子 INCR `checkAtomicRateLimit`(併發不溢)。「200/200」真相是測試環境本就跳過限流(無 Redis),
   非 prod 漏洞;prod 邏輯以 mock Redis 單測。
3. **錯誤日期/小數人數被靜默丟**:加 `isValidCalendarDate`(擋 2026-02-30);提供了但非法的日期/人數
   一律回退;zod 全加 `.int()`。
4. **fallback 提示跳轉後才顯示 + 三 caller 無測試**:改「先顯示 toast(fallback 加長)再導向」;caller
   決策邏輯抽成純函式 `affiliateClick.ts` 並單測(repo 無 RTL,以純函式覆蓋)。

> 三輪都印證同一件事:機械測試全綠不代表對。batch-1 的 98 綠沒抓到 batch-2 的四個 P1;
> batch-2 的 131 綠沒抓到 batch-3 的四個 P1。Codex 逐輪逼出的都是「看起來對、實際會漏」的東西。

## Codex 收口裁定 → batch-4:homepage-only redirect(2026-07-16)

Codex 終驗 batch-3 仍 FAIL(P1 4:三碼姓名可當 IATA、click row 可重放/收 path-shaped PII、
過去日期/零晚仍標 deepLinked=true、離站告知無 paint 保證),並裁定**停止逐洞補丁**,
第一階段固定收口為 homepage-only redirect(終驗 §八,Jeff 已核)。batch-4 依 §八七點施工,
逐項對照見 `tasks/batch-4.md`。架構變化:

1. **自建 deep link 整組移除**(非旗標關閉):service 不再 export 任何 builder,無 env 可復活。
2. **單一 first-party endpoint** `GET /go/trip/:source`:只收 closed enum
   (`flight_search|hotel_search|tour_flight|tour_hotel`),同一請求內 best-effort 匿名
   telemetry + 302 到核准 entry;tRPC 的 `generateAffiliateLink`/`trackClick` 已刪除。
3. **三個 UI caller 同步開同源路徑**(無 await/popup placeholder/離站 toast),
   搜尋鍵旁改**常駐文案**:「將前往 Trip.com,條件不會自動帶入」。
4. **GA 只送 closed enum**(runtime 再驗,type-cast 自由文字塌成 `unknown`);
   admin 加 `trip_homepage` 統計/filter/badge,homepage 不再被誤標成 Hotel。
5. **限流改 Lua 原子腳本**(INCR+自癒 TTL 同一原子執行);Redis/DB 任何失敗照樣 302;
   URL gate 拒 credentials 與非 443 port。

## batch-4 終驗 → batch-5:四 P1 固定窄修(2026-07-16)

Codex 終驗 batch-4:**核心 homepage-only 收斂 PASS,不得重開**;但四個 P1 由真執行路徑重現
(細節與逐項對照見 `tasks/batch-5.md`):

1. **telemetry await 阻斷 302**:Redis/DB 懸掛(非立即 reject)時客人不會被導向
   → 302 先同步送出,telemetry 改 detached `void`;新增兩案 never-resolve 測試。
2. **query PII 進 access log + 壞 JSON body 先被 400**:pino-http 與 body parser 掛在 route 前面
   → route 改掛 compression 之後、logger/parser 之前;新增真 Express + 真 listener 的完整
   middleware 整合測試(PII query 不進 log、壞 body 照樣 302)+ 掛載順序 source contract。
3. **`_blank` popup 被擋時零 fallback**:blocker 回 null,客人點了完全不動
   → 移除 popup,改同頁 `location.assign`(同源普通導向);navigation seam 測試證明
   一次 click 必達精確路徑;「瀏覽器不會阻擋」宣稱刪除並在 batch-4.md 標註被推翻。
4. **admin 把可重放的導流請求稱「點擊」** → 可見文案全改「導流請求/導流記錄/來源」
   (legacy 機票/飯店標「歷史」);i18n semantic guard 測試鎖住,防止 schema 語彙再漏到 UI。

## 這次真正的發現(比原任務書預期的嚴重)

原任務是「驗收 + 修 popup」。實測照出底下的事:

**舊 `/t/...` 連結形狀在觀察中掉光參數,且未見任何 Union 歸因 cookie。**【已親證】
(可親證的僅止於此;**佣金是否支付只有 Trip.com Affiliate 報表能定案**,觀察不到歸因是強烈訊號,不是佣金實證。)

`/t/{素材ID}` 格式會 `302 → /`,**整串參數(含 allianceId/sid)在第一跳被丟掉**,且**不設 Union 歸因 cookie**。
對照實驗釘死結論:同一個**出現在 Jeff 核准入口的**素材 `D13390050`,
用 `?trip_sub3=` 查詢格式會設 cookie,用 `/t/` 路徑格式不設 → **壞的是 URL 形狀,不是素材 ID**。

反向警訊:**亂編的素材 ID(`D99999999`)也會設 Union cookie** → `trip_sub3` 只是不驗證的透傳標籤,
**cookie 有設 ≠ 素材有效 ≠ 佣金會付**。

> 順帶:batch-1 前的舊測試 20 條全綠,而舊 URL 在觀察中掉參數、未見 attribution(收益與佣金只能由
> Affiliate 報表定案)—— 測試把這個死掉的格式當規格釘住了。
> 而 batch-1 的 98 條機械測試全綠,卻沒抓到 Codex 那四個 P1(去識別、忠實意圖、原型鍵、限流)。
> 兩次都印證:綠燈只證明「行為沒變」,不證明「行為是對的」。第二雙眼(Codex)是必要的。

## 驗證(可獨立重跑,batch-6 後)

| 項目 | 結果 |
|------|------|
| Focused(8 檔:service 29 + redirect 27 + middleware 整合 10 + atomic 6 + router 2 + **clickout 13(+gtag-throws)** + analytics 10 + contract 13) | **110 passed** |
| `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` | **exit 0、零錯** |
| `git diff --check` + untracked 行尾空白/conflict marker 掃描 | 乾淨 |
| 全量 vitest | **359 檔通過 / 11 skipped;5,265 tests passed / 90 skipped;0 失敗**(158s;+1 = gtag-throws 案) |
| scope(`git ls-files --others --exclude-standard` 逐檔 wc,Codex 同款指令) | 13 tracked(+363/−482)+ **17 untracked(1,593 行)**(batch-6 終驗裁定:未授權的 tasks/batch-6.md 已刪除,batch-6 durable 紀錄在本檔+Claude 通信+索引);staged 0;`inquiries.ts` diff 0 |

> batch-1~5 的驗證數字(98/131/186/82/109 focused、5,253/5,286/5,341/5,237/5,264 全量)保留在各批 tasks 檔。
> batch-5 scope 的 Codex 核數 1,572 記於 tasks/batch-5.md。

### 端對端落地驗證(batch-1~3 歷史證據,深連結程式碼已於 batch-4 移除)

唯讀、未登入、零付款、測試資料、未下單。**注意:下表所測的深連結 builder 已整組移除**,
保留於此作為第二階段(Link Builder 確認後)的事實基礎;batch-4 之後線上唯一出口是最後一列的核准主入口。

| 新程式輸出 | Trip.com 實際結果 |
|------------|-------------------|
| 機票 `?dcity=sfo&acity=nrt&ddate=2026-09-15&rdate=2026-09-22&triptype=rt&class=c&quantity=2&Allianceid=..&trip_sub3=S14595667` | **`Union=AllianceID=7896974&SID=296102808` 有設**;"2 adults · Business";**24 flights found**;NRT 航線正確 |
| 飯店 `?city=228&checkin=2026-09-15&checkout=2026-09-18&crn=2&adult=3&Allianceid=..&trip_sub3=S18716875` | 標題 "Tokyo Hotels";**Union 有設**;"2 rooms, 3 adults, 0 children";**6,292 properties found** |
| 未驗證城市(Kaohsiung) | 回退 `hk.trip.com/?Allianceid=..&trip_sub3=D13390050`(Jeff 核准主入口,逐字一致) |

對照修改前:同樣情境**無 Union cookie、參數全掉、落在 Trip.com 首頁**。

## 尚未驗證 / 不得宣稱(誠實欄)

1. **佣金未確認,且從我方驗不出來**。Union cookie 有設只代表歸因參數被接受;
   **點擊 ≠ 有效佣金**,telemetry row 是「redirect request」(可重放,限流只壓量),
   **飯店／機票佣金最終以 Trip.com Affiliate 報表為準**。
   亂編 ID 也會設 cookie 這件事直接證明 cookie 不能拿來當佣金證據。
2. **尚未取得 Trip.com Hotel／Flight API 資格**(未申請)。**尚未實作 MCP**。
   **PACK&GO 不顯示 Trip.com 即時庫存,不收款;Trip.com 才是預訂與付款方。**
   **第一階段只是 affiliate clickout(homepage-only)**,客人的搜尋條件不會帶到 Trip.com,
   常駐文案已如實告知。
3. **真機瀏覽器仍未驗證**(本機無 DATABASE_URL 跑不起完整站台)。batch-5 已改同頁
   `location.assign` 同源導向,popup 這個失敗模式已整個移除;但 iOS Safari / Android
   Chrome 的實際行為仍應在 staging 點一次確認。不作「瀏覽器必放行」宣稱。
4. **動態深連結為第二階段另案**:等 Trip.com Link Builder 正式連結或書面確認。
   batch-1~3 的參數驗證結果(IATA/日期/城市 ID/艙等代碼、Union cookie 行為)保留在
   `evidence-20260716.md` 與 design.md 歷史章節,屆時是第二階段的事實基礎,本階段不使用。

## 禁動確認

未觸碰:付款、Gmail、migration、credential、deployment、`inquiries.ts` 電話 hotfix、
Safe Booking Saga、PDF parser 修復、主工作樹 `網站`、`網站-pdf-fix`、`網站-sagadocs`。
schema 未改。未建立任何正式 Trip.com 訂單。所有對外驗證皆唯讀、未登入、零付款、測試資料。

## 下一步

1. Codex 真正最後機械確認 batch-6(GA best-effort 唯一 P1 + 四類文字真值,終驗 §五固定範圍)。
2. 終驗過後由 Jeff 裁 commit;部署照舊只走 `pnpm ship`。
3. 第二階段(動態深連結)等 Trip.com Link Builder / 書面確認,另開 feature 檔案夾設計。
