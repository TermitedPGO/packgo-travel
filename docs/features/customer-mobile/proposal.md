# 客人版手機對齊 25 張示意圖 (proposal)

> 2026-06-10 Jeff 拍板:客人版手機體驗全 25 張示意圖逐一對齊,缺的功能補建。
> 示意圖位置:`/Users/jeff/Desktop/PackGo_示意圖/手機/客人_00_總目錄.html`(客人_01~05 五檔,390px 黑白極簡 app 風;2026-06-10 自 _archive 升為現役藍圖並改名,資料夾按裝置分 網站/手機)。
> 姊妹計畫:後台 PWA 見 `docs/features/admin-pwa/`。兩軌總綱與 UI/UX 鐵則見 `docs/features/mobile-roadmap/proposal.md` §0 + §0.5。

## 1. 起因與現狀

桌面示意圖 vs 現站對照,真正缺口是「手機殼」不是設計或功能:

| 面向 | 示意圖 | 現站 | 差距 |
|------|--------|------|------|
| 設計語言 | 純黑白極簡 | 黑白+金(2026-05-22 Round 80.4 已轉) | 一致,免改 |
| 功能 | 25 張畫面 | 35 條 customer 路由 | 只缺 4 個:AI 找團獨立頁、收藏頁、通知中心、旅行地圖 |
| 手機體驗 | 單欄 app 式、底部固定 CTA、44px 觸控 | 中等 RWD(md:/lg: 有、sm: 少)、無底部 CTA、部分頁小螢幕擠 | 主戰場 |

事實修正(2026-06-10 探索驗證,影響範圍估計):

1. **收藏不是新功能**:`userFavorites` 表 + `server/routers/favorites.ts`(含測試)+ `FavoriteButton.tsx`(optimistic toggle)全在線上,`Profile.tsx` 已消費 `favorites.list`。只缺獨立 `/favorites` 頁。零新 schema 零新 API。順帶:FavoriteButton 紅心紅底違反黑白金,一起改。
2. **付款是 hosted Checkout**:`server/routers/bookingsPayment.ts` 用 `stripe.checkout.sessions.create` redirect,站內無刷卡表單。示意圖 #9「付款」對應 redirect 前摘要頁 + PaymentSuccess/Failure,敏感度比想像低,但仍是錢路(風險見 design.md §5)。

## 2. 鐵則(繼承 mobile-roadmap §0.5,跟圓角同級)

- 客人站是**一個 responsive 網站**,25 張是同一批 route 的 390px 視圖,絕不開平行 mobile 頁面樹。
- 流動寬度絕不寫死 px;`w-full` + `flex` + `min-w-0` 防爆版;單欄無橫向捲動。
- 點擊區 ≥ 44×44px;輸入框字 ≥ 16px(`text-base`,iOS 對焦不放大);safe-area insets。
- 不靠 hover-only;所有動作是看得到的按鈕。
- 每頁 **360 / 390 / 430px** 三寬截圖驗收。
- 公開頁 SEO.tsx helmet 一個不掉;觸到 >300 行紅線檔先拆再改(拆檔 commit 與改版 commit 分開)。

## 3. 25 張對照表

分類:`audit` = 對齊微調 ｜ `重構` = 結構改造 ｜ `新頁` = 新頁面零新 schema ｜ `新功能` = 含 schema/API 變更

| # | 示意圖 | 現有落點 | 分類 | 批 |
|---|--------|----------|------|----|
| 1 | 首頁·找團 | `/` Home.tsx | 重構(中) | C1 |
| 3 | 行程詳情 | `/tours/:id` TourDetailPeony | 重構 | C1 |
| 4 | 訂團 | `/book/:id` BookTour.tsx(51KB) | 重構+拆檔 | C1 |
| 9 | 付款 | BookTour 內摘要 → Checkout redirect | audit | C1 |
| 19 | 訂單確認(成功) | `/payment/success` PaymentSuccess.tsx | audit | C1 |
| 6 | 搜尋結果 | `/search` SearchResults.tsx(43KB) | 重構+拆檔 | C2 |
| 2 | AI 找團對話 | 無(現為首頁浮鈕開 AITravelAdvisorDialog) | 新頁 `/ai-finder` | C2 |
| 20 | 旅遊靈感 | 無 | 新頁 | C2 |
| 15 | 收藏清單 | 無頁(後端全有) | 新頁 `/favorites` | C2 |
| 5 | 我的訂單 | Profile.tsx 內嵌(37KB) | 重構+拆檔 | C3 |
| 7 | 訂單詳情 | `/bookings/:id` BookingDetail.tsx(26KB) | 重構 | C3 |
| 10 | 每日行程 | TourDetailPeony DailyItinerarySection | 重構 | C3 |
| 8 | 客製團申請 | `/custom-tour-request`(已有 AI express) | audit | C3 |
| 16 | 聯絡/客服 | `/contact-us` ContactUs.tsx | audit | C3 |
| 21 | 緊急求助 | `/emergency` Emergency.tsx | audit | C3 |
| 14 | 登入/註冊 | `/login` Login.tsx | audit | C4 |
| 23 | 會員中心 | `/profile` Profile.tsx | 重構+拆檔 | C4 |
| 25 | 帳戶設定 | Profile 設定區 | audit | C4 |
| 11 | 會員訂閱 | `/membership` Membership.tsx | audit | C4 |
| 22 | PackPoint 詳情 | `/rewards` Rewards.tsx | audit | C4 |
| 17 | 評價 | BookingDetail 內嵌表單 | 重構(補「我的評價」) | C4 |
| 18 | 通知中心 | 無 | 新功能(最小 schema) | C5 |
| 24 | 我的旅行地圖 | 無 | 新功能(零 schema 新 API) | C5 |
| 12 | 中國簽證代辦 | `/china-visa` ChinaVisa.tsx(37KB) | audit+拆檔 | C5 |
| 13 | 關於我 | `/about-us` AboutUs.tsx | audit | C5 |

## 4. 批次總覽(細節見 design.md)

| 批 | 主題 | 張數 | 為什麼這順序 |
|----|------|------|--------------|
| C1 | 轉換主流程 | 5 | 錢路優先,營收面最大價值 |
| C2 | 找團 + AI | 4 | 差異化(AI 找團)+ 低垂果實(收藏頁) |
| C3 | 訂後自助 | 6 | 減少「我的狀態?」詢問 |
| C4 | 會員/帳戶 | 6 | Profile 模組化收尾 |
| C5 | 新功能 + 長尾 | 4 | 通知 deep-link 目標頁要先在 C3 手機化完,連過去才不丟臉 |

## 5. 不做(本計畫範圍外)

- 客人 App 打包(Capacitor):PWA 加主畫面已覆蓋,最低優先(mobile-roadmap B4)。
- Push 通知:無 web-push 基礎,iOS 要求安裝 PWA + VAPID,押後到 admin-pwa P5 與 Capacitor 一起決策。
- 桌面版重排:只動手機斷點下的呈現,桌面佈局不動。

## 6. 示意圖沒回答的三個問題(2026-06-10 盤點,動工前拍板)

1. **全站手機導航沒畫**:25 張都是單頁畫面,沒定義客人怎麼在首頁/訂單/收藏/通知間移動。建議 v1 照圖原樣走「頂部選單 + 會員中心當樞紐」,不加底部分頁鍵(本質是網站、改動最小);C3 做完看數據再評估要不要加。**C1 動工前拍板。**
2. **行程詳情只畫上半部**:示意圖精簡,真實頁內容厚(地圖/每日行程/飯店/餐食同一頁)。手機收法(往下捲到底 vs 頂部錨點快跳)在 C1 設計時定,不補畫圖。
3. **十來頁未入圖**:機票/酒店/接送/郵輪/目的地頁/FAQ/法律頁不在 25 張裡。照同一套卡片文法 audit 對齊,不補畫;歸入各批的 audit 工作。
