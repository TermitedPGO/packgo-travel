# 客人版手機對齊 (design)

> 先讀 proposal.md。本檔 = Stage 2:批次細節、四個新功能設計決策、共用 primitives、風險。
> 動工前每批再開 `tasks/c<N>-*.md`(§9.1 Stage 3),本檔不預寫 task checklist。

## 1. 共用手機 primitives(C1 先建,後批重用)

| Primitive | 規格 | 重用來源 |
|-----------|------|----------|
| `StickyCtaBar` | 底部固定 bar:左價格/摘要 + 右主 CTA(h-12 rounded-xl bg-black);safe-area-inset-bottom | 示意圖 #3 #4 文法 |
| Bottom-sheet filter | `md:hidden fixed inset-0` overlay + `fixed inset-x-0 bottom-0` sheet | Tours.tsx 既有先例,抽成共用 |
| 訂單卡 | 圖 w-16 h-16 rounded-lg + 標題 truncate + 狀態點 + inline CTA | 示意圖 #5 文法 |
| 建議 chip 列 | `px-3 py-1.5 rounded-lg border` 橫向 wrap | 示意圖 #2 文法 |

原則:primitive 進 `client/src/components/`(非 pages),圓角照 CLAUDE.md §2.1,間距照 §2.4。

## 2. 批次細節

### C1 轉換主流程(首頁、行程詳情、訂團、付款、訂單確認)

- **首頁**:HomeSearchBar 浮搜尋卡已近似示意圖;補「不知道去哪?讓 AI 幫你找團」入口卡(黑框卡,取代現有左下浮動 AI 鈕);熱門目的地 chip 列;hero 補 sm: 斷點。
- **行程詳情**:TourDetailPeony 加 `StickyCtaBar`(總價 + 立即預訂,目前手機無);出發日期 chip 橫捲;回/分享/收藏浮鈕(`bg-white/90 rounded-full`)。
- **訂團**:BookTour.tsx 51KB **先拆模組再改**;單欄化(行程摘要卡 → 人數加減 → 聯絡資料 → 明細)+ StickyCtaBar;**金額計算邏輯一行不動**。
- **付款**:redirect 前摘要頁 audit;`checkout.sessions.create` 參數零改動。
- **訂單確認**:PaymentSuccess 對齊示意圖 #19 版式。

### C2 找團 + AI(搜尋結果、AI 找團頁、旅遊靈感、收藏清單)

- **搜尋結果**:SearchResults.tsx 43KB 先拆;filter 用共用 bottom-sheet;結果卡單欄。
- **AI 找團頁**:見 §3.1。
- **旅遊靈感**:新頁,內容源 = destinations 表 + 精選 tours,零新 schema;公開頁要進 prerender 清單。
- **收藏清單**:新 `/favorites` 頁消費 `favorites.list`;FavoriteButton 紅心改黑白金。

### C3 訂後自助(我的訂單、訂單詳情、每日行程、客製團申請、聯絡客服、緊急求助)

- **我的訂單**:從 Profile.tsx 拆出獨立訂單清單模組;filter chip(即將出發/已完成)+ 狀態點 + inline「付訂金」CTA(連既有付款流程)。
- **訂單詳情**:BookingDetail 26KB 單欄化,動作鈕 ≥44px。
- **每日行程**:重用 DailyItinerarySection 抽手機視圖(示意圖 #10:日期 tab + 縱向時間軸)。
- 其餘三頁 audit 對齊。

### C4 會員/帳戶(登入註冊、會員中心、帳戶設定、會員訂閱、PackPoint、評價)

- **會員中心**:Profile.tsx 37KB 模組化(訂單已在 C3 拆走,剩資料/設定/收藏入口/PackPoint 摘要)。
- **評價**:tourReviews 表已有;補「我的評價」視圖(示意圖 #17)。
- 其餘 audit。

### C5 新功能 + 長尾(通知中心、旅行地圖、中國簽證、關於我)

- **通知中心**:見 §3.2。
- **旅行地圖**:見 §3.3。
- **中國簽證**:ChinaVisa 37KB audit + 拆檔;表單輸入 ≥16px 字(iOS)。
- **關於我**:audit。

## 3. 新功能設計決策

### 3.1 AI 找團頁(C2)

- 新 route `/ai-finder`,桌機手機共用(桌機置中 max-w,手機全幅)。
- 內容從 `AITravelAdvisorDialog` 搬家,**dialog 淘汰**:一份對話 UI 維護一處。
- 後端零新建:重用 `server/routers/ai.ts` advisor procedures + `aiAdvisorUsage` 限流表。
- 行程卡內嵌推薦重用既有 TourCard;建議 chip 硬編 4-6 個常見意圖(看楓葉/帶長輩/蜜月/親子)。
- 首頁入口卡 + header 入口指到這頁。對 bot:公開 route,回乾淨殼(對話不需 SEO 內容)。

### 3.2 通知中心(C5)

- **v1 = derived feed,不建 notifications 表**:一人公司沒有寫入方塞 event,derived 永遠不漏同步。
- 新 tRPC query(protectedProcedure)聚合既有 per-user 信號:bookings 狀態/付款變更、aiQuotes ready、visaStatusHistory、pointsTransactions,各取最近 N 筆按時間排。
- unread 劃線:單一 `notificationsSeenAt` timestamp 欄位(加在 users 或 customerProfiles,唯一 schema 變更),晚於它的算未讀。
- 每則通知 deep-link 到對應頁(訂單詳情/報價/簽證狀態),所以排 C5:目標頁要先手機化完。
- 不做 push(押後 admin-pwa P5)。

### 3.3 我的旅行地圖(C5)

- 重用 `tour-detail/TourRouteMapGoogle.tsx` 的 Maps stack(`VITE_GOOGLE_MAPS_API_KEY` 已有,含 key-missing fallback)。
- 資料:completed bookings → tours destination → **`shared/` 靜態 destination→座標字典**(純資料檔可測試,零 schema 改動)。
- 足跡 marker 可掛 `tripPhotos`(表已有 userId/bookingId/photoUrl)。
- 地圖 styled 灰階,配黑白設計語言。

## 4. i18n

- 每張新頁 = zh-TW + en 雙份 key,JSX 禁硬編碼中文。
- 比照 `workspaceI18n.test.ts` 為四個新頁加 JSX 字面量 guard 測試(audit-i18n 只抓 key parity,抓不到字面量,workspace 2026-06-09 踩過)。

## 5. 風險(每批動工前重讀)

1. **SW cache**:全站共一個 service-worker(cache-first shell),每批 ship 都 bump `CACHE_VERSION`(`client/public/service-worker.js`)+ Jeff 親驗前 hard refresh。
2. **Prerender**:新公開 route(`/ai-finder`、旅遊靈感)進 sitemap/prerender 路由清單;auth-gated 新頁(收藏/通知/地圖)對 bot 回乾淨空殼不是錯誤;C1/C2 驗收加 `curl -A Googlebot | grep -c 'ld+json'` 不歸零。
3. **大檔案紅線**:BookTour 51KB / SearchResults 43KB / Profile 37KB / ChinaVisa 37KB,觸到先拆 <300 行模組,拆檔工時算進批次,拆檔與改版分開 commit。
4. **錢路**:C1 全程 UI-only;金額計算與 `checkout.sessions.create` 參數零邏輯改動;deposit vs 全額選項不動;ship 前 Stripe test mode 走通 happy path + Jeff 親驗(比照後台「碰錢先確認」鐵律)。
5. **驗收**:每頁 360/390/430 三寬截圖 + tsc 0 err + 對應 Vitest;會員區有登入牆的頁,截圖盡力 + Jeff prod 親驗雙層。
