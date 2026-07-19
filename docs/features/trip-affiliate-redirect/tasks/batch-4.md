# Batch 4 — homepage-only redirect 收口(依 Codex 終驗 §八固定方案施工)

> 2026-07-16。承 Codex batch-3 終驗 FAIL 之收口裁定:停止逐洞補丁,第一階段改
> homepage-only redirect。同一隔離工作樹 `網站-trip-affiliate`,分支
> `trip-affiliate-redirect-mvp`,基準 `4c86254`。**停止線:不 commit、不 push、不部署。**
> 本批不是修 deep link,是**移除** deep link;§八七點逐項對照如下。

## §八逐項施工對照

| §8 | 要求 | 落實 | 檔案 |
|----|------|------|------|
| 1 | 移除可由 env 復活的 hand-built deep link deploy path;只用 Jeff 核准原封 entry;參數不送 Trip.com | `generateFlightLink`/`generateHotelLink`/`generateHomepageLink`/`deepLinkEnabled`/`TRIP_DEEP_LINK_ENABLED` 全部刪除(不是關閉,是不存在);service 只剩核准 entry 常數 + allowlist + 匿名 telemetry writer;測試釘死「模組不再 export 任何 builder」 | `affiliateLinkService.ts`(重寫,127→~110 行) |
| 2 | 單一 first-party endpoint `/go/trip/:source`,只收 closed enum,不收 raw referrer/route/city/tourId/target/affiliate ID | `GET /go/trip/:source` 掛在 Express(tRPC 與 SPA catch-all 之前);`parseRedirectSource` 只認 4 值(`flight_search\|hotel_search\|tour_flight\|tour_hotel`),其餘 400;handler 讀不了任何其他輸入 —— telemetry row 全部 server 端組裝 | `tripRedirect.ts`(新)、`_core/index.ts`(+9 行) |
| 3 | 同一請求 best-effort telemetry → 302 核准 entry;無第二個 public trackClick;資料名為 redirect request,非 click truth | tRPC `generateAffiliateLink` + `trackClick` **刪除**(router 剩 6 支 admin/price-comparison);telemetry 與 302 在同一 handler;row 固定 `platform=trip_homepage`、`referrerPage=<enum>`、`targetUrl=核准 entry`、user/IP/UA=null | `routers/affiliate.ts`(重寫)、`tripRedirect.ts` |
| 4 | UI 保留外觀,搜尋鍵旁常駐明示「條件不會帶入」;click 直接開 first-party URL,不依賴 async popup/placeholder/toast | 三個 caller 全部改成同步 `openTripClickout(source)`(無 await、無 placeholder、無離站 toast);搜尋鍵旁常駐 `redirectNotice` 文案(機票/飯店頁 + 比價 widget);popup helper 模組整組刪除 | `FlightBooking.tsx`、`HotelBooking.tsx`、`PriceComparisonWidget.tsx`、`tripClickout.ts`(新)、i18n zh-TW/en |
| 5 | GA 只送 closed enum + homepage_redirect;admin 加 `trip_homepage`,不得標成 Hotel | `trackAffiliateClick(source)` 只發 `{event_category, source, destination:"homepage_redirect"}`,runtime enum 再驗(type-cast 自由文字塌成 `"unknown"`);AffiliateTab 加 Homepage 統計卡/filter 選項/三態 badge(homepage 不再二元 fallback 成 Hotel) | `analytics.ts`、`AffiliateTab.tsx`、i18n |
| 6 | limiter 只保護 telemetry,Lua 原子補 TTL;Redis/DB 失敗不擋 302;URL gate 拒 credentials/非預設 port | `checkAtomicRateLimit` 改單一 Lua script(INCR+TTL<0 時 EXPIRE,原子執行,斷 TTL 自癒);limiter/telemetry 全包 try — 任何失敗照樣 302;`isAllowedTripUrl` 加 `username/password 必空`、`port 必空或 443` | `rateLimit.ts`、`tripRedirect.ts`、`affiliateLinkService.ts` |
| 7 | 測試打真 redirect handler | `tripRedirect.test.ts` 直接呼叫 `_core/index.ts` 掛的同一個 `handleTripRedirect`:4 source→302 核准 entry;未知 source 400 不 redirect 不記錄;log 只含 enum(黑箱塞 query/body 的 evil target/tourId 全都進不了 row);DB 掛/Redis 掛/限流中仍 302;重放=兩筆相同 redirect-request row | `tripRedirect.test.ts`(新) |

## 誠實邊界(不宣稱超過實證)

- telemetry row 是「**redirect request**」:同 IP 重放會產生多筆,rate limit 只壓量,
  不證明人類點擊,更不證明佣金。佣金唯一真相源 = Trip.com Affiliate report。
- ~~三個 caller 已無 async 縫隙(同步 window.open 同源路徑,popup blocker 無從攔)~~
  **此宣稱被 batch-4 終驗推翻**(Codex P1-3:`window.open` 被 blocker 回 null 時客人完全不動,
  零 fallback)。batch-5 已改同頁 `location.assign`,不再依賴 popup;原文保留供對照,不再有效。
- 常駐文案已明示「條件不會自動帶入」;若 Jeff 要求離站前 modal 確認,屬 UX 加項,未做。
- jsdom 測試涵蓋 helper 與 handler 的決策路徑;三個 React 元件本身仍無 render 測試
  (repo 無 RTL)。caller 與 endpoint 的接線由 `tripClickout.test.ts`(路徑表)+ tsc 保證。

## 驗證(全部實跑)

| 項目 | 結果 |
|------|------|
| Focused(service 29 + tripRedirect 25 + rateLimit.atomic 6 + router 2 + analytics 10 + tripClickout 10) | **82 passed** |
| `tsc --noEmit` | **exit 0、零錯**(4096MB 首輪 OOM 無錯誤輸出,6144MB 過;如實記錄) |
| `git diff --check` + 新檔行尾空白 + conflict marker | 乾淨 |
| 全量 vitest | **357 檔 / 5,237 tests passed / 90 skipped / 0 failed**(316s)。比 batch-3 少 104 條 = 深連結測試隨功能移除 |
| scope | 13 tracked(+334/−455)+ 14 untracked(1,129 行,Codex 核數更正);staged 0;`inquiries.ts` diff 0 |

## 禁動確認(同前)

未觸碰付款、Gmail、migration、credential、deployment、`inquiries.ts`、Safe Booking Saga、
PDF parser、主工作樹與 sibling worktree。schema 未改(telemetry 只往既有 nullable 欄位寫 null)。
未登入 Trip.com、未建立訂單、零付款。
