# Batch 3 — Codex 終驗 P1 修正

> 2026-07-16。承 Codex batch-2 終驗 FAIL。同一隔離工作樹 `網站-trip-affiliate`,分支
> `trip-affiliate-redirect-mvp`,基準 `4c86254`。**停止線:不 commit、不 push、不部署。**
> 每個 P1 都先對實際程式碼親證屬實才修。

## P1 修正對照

| # | Codex 終驗 P1 | 親證 | 修法 | 檔案 |
|---|---------------|------|------|------|
| 1 | GA 仍可能送出 `Jeff-Hsieh` 這類姓名 | 親證:`SAFE_ROUTE_TOKEN=/^[A-Za-z]{2,10}(-[A-Za-z]{2,10})?$/` 讓 `Jeff-Hsieh`/`Mary-Jane`/`Ann-Kim` 全通過;且 flight 呼叫端無條件把 `${origin}-${destination}` 當 token(free text 也送) | 收緊為 `/^(?:[A-Za-z]{3}-[A-Za-z]{3}\|[a-z]{3,12})$/`(嚴格 IATA pair 或全小寫城市鍵);呼叫端改用 `flightRouteToken()`(只在雙方都是 3 碼 IATA 才產 token)/`hotelCityToken()`(只認已知城市鍵) | `analytics.ts`、新 `affiliateClick.ts`、`FlightBooking.tsx`、`HotelBooking.tsx` |
| 2 | 匿名點擊仍接受含 PII 的 `referrerPage`;public endpoint 可重放,限流併發 200 全過 | 親證:`referrerPage: z.string().optional()` 收任意字串入庫;`checkRateLimit` 讀後寫非原子(TOCTOU),且測試環境整段跳過(故任何 test-based 併發都 200/200) | `sanitizeReferrerPage()`:只留像自家路徑者(前導斜線、無 query、限長),其餘丟 null。限流改 `checkAtomicRateLimit`(單次原子 INCR,併發不溢);測試環境仍跳過(無 Redis),邏輯以 mock Redis 單測 | `routers/affiliate.ts`、`rateLimit.ts`(加函式)、新 `rateLimit.atomic.test.ts` |
| 3 | 錯誤日期、小數人數仍可能被刪掉後標 `deepLinked=true` | 親證:`ISO_DATE` 收 `2026-13-45`/`2026-02-30`;zod `.min().max()` 無 `.int()` 收 `2.5`;兩者都被靜默丟棄後仍 deepLinked=true | 加 `isValidCalendarDate()`(重建日期驗真);**提供了但非法**的日期/人數 → 回退(不靜默丟);zod 全部加 `.int()` | `affiliateLinkService.ts`、`routers/affiliate.ts` |
| 4 | Default-off 後 fallback 提示在跳轉後才顯示,客人可能看不到;三個 UI caller 無整合測試 | 親證:handler 先 `redirectPendingWindow` 才 `toast`,同分頁導向會吃掉 toast;repo 無 RTL、無 `.test.tsx` | 改「先驗 URL → **先顯示 toast(fallback 加長停留)** → 再導向」;caller 共用邏輯抽成純函式 `affiliateClick.ts` 並單測(RTL 不存在,以純函式覆蓋 caller 決策) | `FlightBooking.tsx`、`HotelBooking.tsx`、新 `affiliateClick.ts` + 測試 |

## 誠實說明

- **限流「200/200」的真相**:`checkRateLimit`/`checkAtomicRateLimit` 在測試環境(`VITEST`/`NODE_ENV=test`)
  一律放行,因為單元測試沒有 Redis。所以任何 test 內併發 N 次都會 N 次全過 —— 這是測試工具的性質,
  不是 prod 漏洞。prod 限流邏輯改用原子 INCR(併發不溢),並以 mock Redis 單測(關掉環境跳過)驗證
  「超過 limit 即擋、200 併發只放行 60」。
- **fallback 提示的殘餘極限**:改成先顯示再導向,popup 情境下 toast 在原分頁;但若新分頁搶焦點,
  客人仍可能先看到 Trip.com。這是導向第三方站的固有限制。目前是 default-off,fallback 落在 Trip.com
  首頁(本身有搜尋框、功能完整)。若 Jeff 要求「離站前強制確認」,那是 UX 決策,可再加 interstitial。
- **RTL 不存在**:repo 沒有 `@testing-library/react` 也無任何 `.test.tsx` render 測試。因此「三個 UI
  caller 整合測試」以抽出純函式 + 單測 caller 決策邏輯達成,而非引入新測試框架(那超出窄修範圍)。
- **`rateLimit.ts` 是共用檔**:本次只「新增」`checkAtomicRateLimit`,未動既有 `checkRateLimit`,
  故 auth/login/newsletter 等既有使用者不受影響;全量測試通過佐證。

## 驗證

| 項目 | 結果 |
|------|------|
| Focused(service/atomic-rl/router/affiliateClick/analytics/redirect) | **186 passed** |
| `pnpm check`(4096MB heap) | **0 error** |
| `git diff --check` + 新檔行尾空白 | 乾淨 |
| 全量 vitest | 見 progress.md「全量」欄(batch-3 重跑) |

## 禁動確認(同前）

未觸碰付款、Gmail、migration、credential、deployment、`inquiries.ts` 電話 hotfix、Safe Booking Saga、
PDF parser 修復、主工作樹與其他 worktree。schema **未改**(仍只往既有 nullable 欄位寫 null)。
`rateLimit.ts` 僅新增函式。未建立任何正式 Trip.com 訂單。
