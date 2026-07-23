# Batch 1 — 連結格式修正 + popup 窄修 + 測試

> 2026-07-16。隔離工作樹 `網站-trip-affiliate`,分支 `trip-affiliate-redirect-mvp`,基準 `4c86254`。
> **停止線:不 commit、不 push、不部署。**

## 交付項目

| # | 項目 | 檔案 | 狀態 |
|---|------|------|------|
| 1 | 連結格式改為已驗證查詢格式,棄用死掉的 `/t/{素材ID}` | `server/services/affiliateLinkService.ts` | ✅ |
| 2 | Host allowlist(`isAllowedTripUrl`)+ fail-safe 回退已核准主入口 | 同上 | ✅ |
| 3 | 已驗證飯店城市 ID 表(目前僅 `tokyo=228`),未驗證一律回退 | 同上 | ✅ |
| 4 | 移除 `ouid` 透傳;後端獨佔 affiliate 身分 | `server/routers/affiliate.ts` | ✅ |
| 5 | `trackClick` 不再收瀏覽器 `targetUrl`,改後端推導 canonical target | 同上 | ✅ |
| 6 | popup 同步開窗 helper(開/導向/關 + 前端 allowlist) | `client/src/lib/affiliateRedirect.ts`(新) | ✅ |
| 7 | 三個呼叫端接上 helper;追蹤改 fire-and-forget | `FlightBooking.tsx`、`HotelBooking.tsx`、`PriceComparisonWidget.tsx` | ✅ |
| 8 | 熱門城市改帶 `cityKey` 而非翻譯顯示名 | `HotelBooking.tsx` | ✅ |
| 9 | i18n 回退提示(zh-TW + en 對稱) | `client/src/i18n/{zh-TW,en}.ts` | ✅ |
| 10 | 測試 | `affiliateLinkService.test.ts`(改寫)、`affiliateRedirect.test.ts`(新) | ✅ |

## 測試覆蓋(對照任務書第五節)

| 任務書要求 | 覆蓋處 |
|------------|--------|
| 正確 Alliance ID／SID | `TRIP_COM_CONFIG` + 每類 URL 各自斷言 `Allianceid=7896974`、`SID=296102808` |
| flight／hotel／homepage 三類 URL | 三個 describe 各自驗證形狀、路徑與素材 ID |
| Trip.com HTTPS host allowlist | `isAllowedTripUrl` 接受 4 個官方 host |
| 非 Trip.com URL 拒絕 | 擋 `evil.com`、`nottrip.com`、`trip.com.evil.com`、`www.trip.com@evil.com`、`http:`、`javascript:`、`data:`、protocol-relative |
| 使用者不能覆寫 affiliate IDs | 夾帶 `SFO&Allianceid=999999` → 驗證失敗回退;`Allianceid` 恆為單一真值;全 URL 無 `ouid` |
| 不含 PII | email/電話/護照/姓名 塞進 origin 與 city → 一律回退且不出現在 URL;深連結參數白名單 |
| popup 成功、API 失敗與 fallback 行為 | `affiliateRedirect.test.ts`:同步開窗、`opener` 斷開、成功 `location.replace`、被擋退本頁、失敗關空白頁 |
| 點擊只記允許的 canonical target | `trackAffiliateClick` 拒寫非 Trip.com;回退時記已核准主入口;寫入失敗不擋跳轉 |
| desktop／mobile 搜尋按鈕行為 | 見下方「誠實說明」 |
| 既有熱門航線／熱門城市入口不回歸 | 6 條熱門航線逐條斷言仍深連結;6 個熱門城市斷言仍導向 allowlist 內的 Trip.com |

### 誠實說明:desktop／mobile 搜尋按鈕

沒有寫「桌機/手機」分歧測試,因為**程式上沒有這個分歧**:兩個斷點共用同一顆搜尋鈕與同一個
`handleSearchFlights` / `handleSearchHotels`,響應式差異只在 CSS(如 swap 鈕 `hidden md:flex`)。
寫一個假裝在測斷點、實際只呼叫同一函式的測試等於自欺。真正跟斷點有關的是「popup 在行動瀏覽器
是否被擋」,那要真機驗證,不是 jsdom 能證的 —— 列為待驗(見 progress.md)。

## 實跑結果

- Focused:`affiliateLinkService.test.ts` + `affiliateRedirect.test.ts` + `affiliate.test.ts`
  → **98 passed**(73 + 24 + 1)。
- `pnpm check`(`tsc --noEmit`,`NODE_OPTIONS=--max-old-space-size=4096`)→ **0 error**。
- `git diff --check` → 乾淨;新增檔亦無行尾空白。
- 全量 vitest:見 progress.md「驗證」。

## 禁動確認

未觸碰:付款、Gmail、migration、credential、deployment、`inquiries.ts` 電話 hotfix、
Safe Booking Saga、PDF parser 修復、主工作樹、`網站-pdf-fix`、`網站-sagadocs`。
未建立任何正式 Trip.com 訂單;所有驗證皆唯讀、零付款、測試資料、未登入。
