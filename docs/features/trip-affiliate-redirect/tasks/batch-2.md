# Batch 2 — Codex P1 覆核修正 + deep-link 預設關閉

> 2026-07-16。承 Codex 對 batch-1 的覆核。同一隔離工作樹 `網站-trip-affiliate`,分支
> `trip-affiliate-redirect-mvp`,基準 `4c86254`。**停止線:不 commit、不 push、不部署。**
> 每個 P1 都先對實際程式碼親證屬實才修(見下方「親證」欄),不憑 Codex 摘要照單全收。

## Codex 裁示(Jeff 轉述)

1. 外部確認前,**自建 deep link 必須 default-off**,只能回退已核准主入口。
2. 四個 P1 修掉。

## P1 修正對照

| # | Codex P1 | 親證 | 修法 | 檔案 |
|---|----------|------|------|------|
| A | deep link 預設開啟,未經 Trip.com 確認就上線有風險 | — 裁示 | 新增 `deepLinkEnabled()`(讀 `TRIP_DEEP_LINK_ENABLED`,**預設 false**);兩個 generator 開頭即 gate,關閉時一律回退主入口 | `affiliateLinkService.ts` |
| 1 | 「匿名點擊」仍存 userId/IP/UA,並把自由輸入送進 GA | 親證:`trackAffiliateClick` 寫入 userId/ip/ua;client 送 `search_query=起→迄`、`destination` 進 gtag | 伺服端:`trackAffiliateClick` **結構性去識別**——不再接受 userId/IP/UA,三欄一律寫 null。前端:GA 只收 vouched route token(IATA pair / cityKey),經 `SAFE_ROUTE_TOKEN` 再驗一次;含數字/空白/@ 一律丟棄 | `affiliateLinkService.ts`、`routers/affiliate.ts`、`analytics.ts`、`FlightBooking.tsx`、`HotelBooking.tsx` |
| 2 | 來回/日期先後/嬰兒被靜默改錯卻仍 `deepLinked=true` | 親證:`isRoundTrip` 只由 returnDate 是否存在推得;roundtrip 空返程 → 靜默變單程;無 return<depart 檢查;infants 在 router 就被丟 | 新增顯式 `tripType`;無法忠實表達的來回(缺/亂序 return)→ 回退;`checkOut<checkIn` / `return<depart` → 回退;`infants>0` 無已驗證參數 → 回退。**deepLinked=true 現在代表「忠實帶過」** | `affiliateLinkService.ts`、`routers/affiliate.ts`、`FlightBooking.tsx` |
| 3 | `constructor`/`__proto__` 可繞過 Tokyo 城市白名單 | 親證:`{tokyo:"228"}["constructor"]` 回傳 Object 建構子(truthy),會建出 `city=function Object(){...}` 的垃圾 deep link 且標 deepLinked=true;CABIN_CODES 同病 | 新增 `ownLookup()`(`Object.hasOwn` 守門),city 與 cabin 查表都只認自有字串鍵 | `affiliateLinkService.ts` |
| 4 | 公開 `trackClick` 無限流,可灌假點擊污染報表 | 親證:`trackClick: publicProcedure` 無任何 rate limit | 沿用 repo 既有 `checkRateLimit`,per-IP 60/小時,超過丟 `TOO_MANY_REQUESTS`。IP 只當 ephemeral rate-limit key,不寫進點擊表。client 端本就 fire-and-forget,節流不影響跳轉 | `routers/affiliate.ts` |

## 關於「自建深連結違反 Trip.com FAQ」

Codex 指出 Trip.com 官方要求用平台產生、未修改的 affiliate link;目前手工把 Search Box 素材塞進
`trip_sub3` 只能證明 cookie 有設,不能證明佣金認列。**這正是 P1-A default-off 的理由**:
在 Jeff 向 Trip.com 書面確認前,`TRIP_DEEP_LINK_ENABLED` 保持未設,線上只會出現已核准主入口
(本身已歸因、FAQ 安全)。確認後才由 Jeff 決定是否設 `TRIP_DEEP_LINK_ENABLED=true`。

## 驗證

| 項目 | 結果 |
|------|------|
| Focused(service+redirect+analytics+router 冒煙) | **131 passed**(97+24+9+1) |
| `pnpm check`(4096MB heap) | **0 error** |
| `git diff --check` + 新檔行尾空白 | 乾淨 |
| gate 實測 dump | 旗標未設 → flight/hotel 皆回退主入口;旗標=true → 正常深連結;旗標=true 但來回缺返程 → 回退主入口 |
| 全量 vitest | 見 progress.md |

## 新增測試重點

- deep-link master gate:未設/`false`/`1`/`yes`/`TRUE` 全部關;只有精確 `'true'` 開。
- 忠實意圖:顯式來回缺返程→回退;return<depart→回退;顯式單程忽略多餘 return;缺 tripType 由 return 推斷;infants>0→回退。
- 原型鍵:cabin `constructor/__proto__/toString/...`→退回 economy(不出現 function/[object);city 同鍵→回退主入口。
- 去識別:寫入列 userId/ipAddress/userAgent 皆 null;`trackAffiliateClick` 型別上已不收這三者。
- GA 淨化:email/電話/姓名/中文箭頭查詢/過長 一律 route=""；不再有 `search_query`/`destination` 欄位。

## 禁動確認(同 batch-1)

未觸碰付款、Gmail、migration、credential、deployment、`inquiries.ts` 電話 hotfix、Safe Booking Saga、
PDF parser 修復、主工作樹與其他 worktree。schema **未改**(只往既有 nullable 欄位寫 null,無 migration)。
未建立任何正式 Trip.com 訂單。
