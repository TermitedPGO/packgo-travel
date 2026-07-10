# 公開站現況盤點（對客旅遊頁面）

> 偵察產出，2026-07-10。唯讀盤點，零 code 改動。目的：行程頁翻修（含地圖重做，目前保留狀態）動工前的誠實現況與缺口清單。
> 量測方式：讀 `client/src` 路由與元件 + 對 prod（packgoplay.com）打 prerender（Googlebot UA）與 tRPC 端點實測 + 沿用 `public-site-redesign/design.md`（2026-06-16 browser 量測）的效能數字。
> 相關既有文件：`docs/features/public-site-redesign/`（P1 已做未 ship，P2-P6 待做）、`docs/features/tour-page-redesign/`（詳情頁行動區，已上線）、memory `project_tour_route_map`（地圖基準 v357 + 保留裁示）。

---

## 一、頁面清單與結構

公開路由源頭：`client/src/App.tsx`（Wouter `<Switch>`）。以下為對客頁面，依用途分組。規模＝原始檔行數對應的 KB，最後大改＝該檔最後一次 commit 日期（git log 粗查）。管理端（`/workspace`、`/ops/*`、`/admin/*`、`/preview/*`）不在盤點範圍。

### 內容／行銷
| 路由 | 元件 | 規模 | 最後大改 | 備註 |
|---|---|---|---|---|
| `/` | `pages/Home.tsx` + `components/home/*` | 7.5KB（骨架，內容拆多個子元件） | 2026-05-18 | Round 79/80 改版後的現行首頁 |
| `/about-us` | AboutUs.tsx | 4.9KB | 2026-05-22 | |
| `/faq` | FAQ.tsx | 2.9KB | 2026-05-22 | |
| `/contact-us` | ContactUs.tsx | 13.9KB | 2026-05-22 | |
| `/emergency` | Emergency.tsx | 8.9KB | 2026-05-22 | 24h 緊急聯絡 |
| `/terms-of-service` `/privacy-policy` | 3.2KB / 4.6KB | 2026-05 | 法務頁 |

### 目錄／瀏覽（核心賣場）
| 路由 | 元件 | 規模 | 最後大改 | 備註 |
|---|---|---|---|---|
| `/tours` | Tours.tsx | 40.3KB | 2026-06-17 | 行程列表 |
| `/tours/:id` | TourDetailPeony/（index 24KB + 約 28 個子元件） | 目錄合計 ~360KB 原始碼 | 2026-07-07 | 詳情頁，站上最重的一頁 |
| `/tours/:id/print` | TourPrintView.tsx | 51KB | 2026-05-27 | 列印版行程 |
| `/search` | SearchResults.tsx | 42.5KB | 2026-07-07 | 搜尋結果 |
| `/destinations/:region` | RegionPage.tsx | 17.4KB | 2026-05-17 | 地區頁 |
| `/destinations/:region/:country` | CountryPage.tsx | 21.9KB | 2026-05-27 | 國家頁 |
| `/cruises` | CruisePage.tsx | 17KB | 2026-05-27 | 郵輪 |
| `/group-packages` | GroupPackages.tsx | 11.3KB | 2026-05 | |

### 成交／預訂動線
| 路由 | 元件 | 規模 | 最後大改 |
|---|---|---|---|
| `/book/:id` | BookTour.tsx | 50KB | 2026-07-07 |
| `/bookings/:id` | BookingDetail.tsx | 26KB | 2026-06-03 |
| `/payment/success` `/payment/failure` | 13.8KB / 6.8KB | 2026-06-03 |
| `/inquiry` | QuickInquiry.tsx | 16KB | 2026-05-22 |
| `/custom-tour-request` | CustomTourRequest.tsx | 31KB | 2026-05-22 |
| `/custom-tours` | CustomTours.tsx | 12.6KB | 2026-05 |

### 附屬服務
| 路由 | 元件 | 規模 |
|---|---|---|
| `/flight-booking` | FlightBooking.tsx | 26KB |
| `/hotel-booking` | HotelBooking.tsx | 23KB |
| `/airport-transfer` | AirportTransfer.tsx | 13KB |
| `/china-visa`（+ success / status/:id） | ChinaVisa.tsx | 37KB |

### 會員／帳號
| 路由 | 元件 | 規模 |
|---|---|---|
| `/membership` `/membership-terms` | 22KB / 18KB |
| `/rewards` | Rewards.tsx | 15KB |
| `/login` `/forgot-password` `/reset-password` `/profile` | 17 / 7.8 / 7.7 / 37KB |

結構觀察：
- 對客路由約 35 條。對一人公司來說對外表面積偏大，尤其 flight / hotel / airport-transfer / visa 四個附屬服務頁各自 13-37KB，是要長期維護新鮮度的負擔，但流量與轉化貢獻存疑。
- 首頁採「拆元件」架構（`components/home/HomeHero`、`HomeFounderStory`、`HomeFeaturedSpotlight`、`WhyChooseUs`、`TestimonialsCarousel`、`HomeFAQ` 等），骨架乾淨、易改樣式。design.md 已把首頁定為「好範本，其餘對齊它」。
- 詳情頁 `TourDetailPeony/` 已是良好拆分（v2 Wave 2 從 3,846 行拆成 20+ 檔），且行動區（TourActionArea / TourSpecBar / TourFitWizard / TourInquiryDialog，2026-06-08）已落地：主 CTA 是「要報價」開 Dialog，「線上預訂」降為次要。符合客製旅遊「先詢問、Jeff 人工報價」的商業模式。
- 路線圖有 4 個重疊實作（見第三節 G6）。

---

## 二、實地體驗（prod prerender + tRPC 實測）

### 首頁（訪客視角）
第一屏賣點清楚：標題「把出國變簡單／為忙碌的家庭，帶出國的機會」，定位＝灣區華人家庭、創辦人 Jeff 親自規劃、全程司導私人行程、CST #2166984 合法登記。og/meta 完整、雙語（zh_TW + en_US）、JSON-LD 有 Organization + WebSite。頁面敘事順序合理：Hero → 搜尋列 → 創辦人故事＋信任條 → 精選行程 → 6 格地區 → 為何選我們 → 會員 promo → 見證 → FAQ → 電子報。

但兩個「秀商品／秀口碑」的區塊實際渲染是空的：
- `HomeFeaturedSpotlight` 打 `tours.list({status:'active', featured:true})` 與 fallback `{status:'active', pageSize:50}`。prod 實測兩者都回 `[]`。精選行程區＝空。
- `TestimonialsCarousel` 只吃 `reviews.listVerified`（FTC §465 合規，假評論已移除）。prod 回 `[]`。見證區＝空。
- 6 格地區（`EditableDestinations`）打 `homepage.getDestinations` prod 回 `[]`，但頁面仍顯示歐/亞/美/中東/非洲/郵輪六格，代表這是元件內建的靜態 fallback，不是 DB 驅動，且點進去（見下）也是空的。

所以首頁「看起來像有內容」，但只要往下點就露底。

### 行程列表 /tours 與搜尋 /search
prerender 的 /tours 對爬蟲直接顯示「沒有符合的行程」。tRPC `tours.searchCards`（無 filter、帶各種 filter：destination/region/keyword/Japan）prod 全部回 `total:0`。根因在 `server/db/tour.ts:497`：`searchTours` 寫死 `conditions = [eq(tours.status, "active")]`，而 prod 目前 status='active' 的行程數＝0。5,640 個供應商行程、日本 1,205 都在 DB，但沒有一個是 active 狀態，於是列表、搜尋、精選、地區頁全空。

### 行程詳情頁 /tours/:id
資訊架構豐富且順：Hero（旋轉照片）→ SpecBar 事實條 + FitWizard 小精靈 + 行動區（要報價 / 客製這團 / 加微信 / 打電話）→ 概覽 → 逐日 DayCard → 飯店 HotelCard → 路線圖 → 供應商細節 → 定價 → 相似行程。桌機右側固定預訂欄、手機底部固定 CTA 的規劃在 design.md 有，行動區已上線。
問題：① sitemap 沒有任何 /tours/:id（見下），直連才進得去；② `getById` 不濾 status，所以就算沒 active 也能單頁渲染，但無從瀏覽到；③ 這頁最慢（見效能）。

### 預訂動線幾步
理論路徑：落地 → /tours 或 /search 找團（目前死路，空的）→ 詳情頁 → 主 CTA「要報價」開 Dialog（姓名+email 必填）→ 送出 inquiry → Jeff 跟進報價。線上「立即下單」被刻意降為次要（符合客製旅遊模式，是 lead-gen 不是電商）。但因為賣場是空的，連 lead-gen 的入口（瀏覽到一個團再詢問）都走不通，只剩首頁那顆 AI advisor pill 和 /custom-tour-request 表單。

### 行動版
viewport meta 正確（無 maximum-scale、`interactive-widget=resizes-content`，鍵盤開啟時底部 composer 上推）。有 PWA manifest、iOS add-to-home-screen、詳情頁手機底部 CTA、`docs/features/mobile` 與 `customer-mobile` 有規劃。架構上有考慮手機，但本次未做視覺實跑驗證，手機實際觀感待翻修時截圖確認。

### 明顯的醜與慢
- 效能（design.md 2026-06-16 prod 量）：首頁 `tours.list` 8.3s / 1.05MB、/tours 485KB + N+1×2、/tours/:id 7.5s（第二波 getRouteMap+getSupplierDetail+priceComparison+getSimilar 串行）、/search 9.9s、/destinations 8.9s。核心頁全是 7-10 秒等級。
- Bundle（本地 `dist/public/assets`，2026-07-06 build）：公開包混進一堆不該在的庫。code highlighter（emacs-lisp 780KB、cpp 626KB、wasm 622KB、wolfram 262KB）、mermaid.core 396KB、cytoscape 442KB、treemap 330KB、vue-vine 190KB、vendor-recharts 190KB，另有 `TourRouteMapCanvas` 795KB、兩個 index 主 chunk 948KB + 883KB、CSS index 297KB。這些多來自 AI advisor 的 `streamdown`/Shiki 與 mermaid，雖多為 lazy/code-split（不一定首頁全載），但確實打進公開 build，部分路由會拉到。design.md 的 P5（把 recharts/date/maps 移出公開包）尚未做。
- 圖片：dest-*.webp / hero-sakura.webp 每張約 420-500KB，無 responsive srcset/sizes。
- 路線圖：`TourRouteMapGoogle` 無 Maps API key 會丟 error 走 fallback，白載 JS。

---

## 三、缺口清單（對照「能讓客人信任下單的旅行社站」）

嚴重度：S1＝直接擋信任或成交、S2＝重要、S3＝打磨。

- **[S1] 賣場是空的。** /tours、/search、首頁精選、/destinations、sitemap 全部 0 個行程。5,640 在 DB、active＝0。訪客與爬蟲看到的是一家「沒有東西可訂」的旅行社。這就是 Jeff 說「我不能就是沒有網站」的體感來源：站在、但沒有商品上架。
- **[S1] 行程完全沒有 SEO/AEO 表面。** sitemap.xml 只有 16 條靜態 URL（首頁 + 服務頁 + 法務），零 /tours/:id、零 /destinations。5,600 個行程對搜尋引擎與 AI 引擎不可見，等於放棄長尾自然流量與被引用機會。
- **[S1] 零社會證明。** 見證區空（reviews.listVerified 回 []）、Trustpilot 假評論已依 FTC 移除、首頁無真實可信的口碑。一家靠「信任 + 客製」賣的旅行社，客人第一次來看不到任何評價、案例、成團實績。
- **[S2] 沒有自有／授權照片管線。** 供應商行銷照是紅線不能上客人頁（`feedback_no_cost_on_customer_docs` 同源紀律），目前沒有自家拍攝或授權圖庫，等於「就算把 1,205 個日本團翻成 active，也沒有合法好看的圖上架」。這是擋住賣場上線的實體瓶頸，不只是設計問題。
- **[S2] 核心頁 7-10 秒慢 + 公開包臃腫。** 見第二節。P1 資料層修復已做但卡在 worktree 未 ship（`redesign-p1` commit `2b08a5e`）。
- **[S2] 只有兩語（zh-TW / en），沒有簡體 zh-CN。** 但客群含中國大陸高端客（WeChat 公眾號 / 小紅書兩條內容線都對 zh-CN 受眾）。簡中缺席與行銷策略脫節。
- **[S2] 路線圖是未解的一團。** 4 個重疊實作：`TourRouteMapCanvas.tsx`（79KB 原始碼 / 795KB bundle，d3-geo+topojson，即 memory 的 v357 基準）、`TourRouteMapGoogle.tsx`（無 key 會 error）、`TourRouteMapHybrid.tsx`（3KB wrapper）、`TourRouteMapSvg.tsx`（13KB，react-simple-maps，實際被 `RouteMapSection` 接的那個 → 再 lazy 載 Hybrid）。Jeff 已裁示現行地圖「不好看要重新來」（memory `project_tour_route_map`，保留狀態）。
- **[S2] 定價與含蓋清晰度殘留問題。** design.md 記：/book 仍顯示「剩餘座位 0/20」數字（紅線是只給有位/名額有限/已滿三級）、殘留 teal/green 價格（應統一墨黑）、詳情頁「含/不含機票」有矛盾、供應商內部碼（26CC401BRC 那種）需清。
- **[S3] 品牌色 token 有歧義。** 靜態 index.html 的 theme-color / PWA tint 是 teal `#0D9488`（CLAUDE.md §2.2 稱其為 canonical brand），但可見設計是黑白 + 金點綴的極簡（loading spinner 金 `#c9a563`、AI pill 純黑、hero 攝影滿版）。teal 主要活在 PWA chrome 與少數 accent，surface 是 B&W。翻修時要把「品牌色到底是什麼」定死，避免 token 與視覺各說各話。
- **[S3] 對客路由過多。** 約 35 條，含四個維護成本高、貢獻存疑的附屬服務頁。可考慮收斂或降級。
- **[S3] CTA / 聯絡動線一致性。** 各頁 CTA 階層與聯絡入口（微信 QR / 電話 / inquiry）需在翻修時統一節奏。

---

## 四、翻修範圍建議

### 只能先做一件事：先把貨上架，別先重畫貨架
最痛的不是某一頁的設計，是賣場空的。誠實的第一步：把日本 1,205 個團翻成 `status='active'`、配上自有/授權照片與後台核對過的直客售價、寫進 sitemap，讓 /tours、/search、首頁精選、/destinations 真的有東西。這件事偏「資料 + 內容 + 照片管線」，不是視覺翻修。在賣場空的狀態下重畫貨架，是把空店裝潢得更漂亮。

若一定要指一個「頁」先做：**/tours 列表 + 一個真的有資料的詳情頁**，因為它們是賣場的入口與轉化核心，且 P1 的列表卡（TourCard A/B/C + 輕量投影 + 殺 N+1）已寫好只等 ship。

### 詳情頁（含地圖重做）翻修範圍草案
沿用既有 `public-site-redesign` P2 計畫 + memory 的地圖保留案：
1. 版面：右側固定 BookingRail（價格 + 最近班期 + 餘位三級 + 主 CTA），手機底部固定列；facts 條 + DayBlock + IncludedList；下半部（routeMap / supplier / similar / reviews / priceComparison）延遲載入。目標把 7.5s 壓到約 1s。
2. 清理：拿掉供應商內部碼、修「含/不含機票」矛盾、餘位改三級不給數字、價格統一墨黑。
3. 地圖重做（解凍本盤點的觸發點）：把 4 個重疊實作收斂成 1 個。範圍照 memory 裁示兩件：①行程頁動畫看點（SVG 路線逐日畫出，自動化、全團適用）②訂團客人自動客製地圖（名字/日期/團號，零人工，進確認信 + 客人頁）。基準看 v357 演進，別走回復古風。Google Earth Studio / Hera 只歸自媒體影片線，與網站脫鉤。

### 沿用只調樣式 vs 該重畫
- 沿用（結構好，套 tokens / PageHero / Section 即可）：首頁骨架（design.md 認定的好範本）、詳情頁的 OverviewSection / DayCard / HotelCard / PricingSection、已上線的行動區（TourActionArea / SpecBar / FitWizard / InquiryDialog）、服務頁與法務頁。
- 該重畫：/tours + /search + /destinations 的卡片（P1 已寫好待 ship）、路線圖（4 合 1 + 動畫 + 客製地圖）、以及目前不存在的「空狀態 / 上架前」處理與自有照片層。

### 非目標（本次翻修不碰）
後台（`/workspace`、`/ops/*`）、自動下單/付款（維持人工、Jeff 親刷卡）、中國美 eChinaTours 之後再說、SSR（prerender 已解 SEO 隱形大半，之後再評估）。

---

## 附：本盤點最痛的三個問題
1. 賣場是空的。/tours、搜尋、首頁精選、地區頁、sitemap 全是 0 個團；DB 有 5,600、active 是 0。訪客與爬蟲都看到一家沒東西可訂的旅行社，這就是「像沒有網站」的真因。
2. 零社會證明 + 沒有自有照片管線。見證空、真實評價空、供應商照片又是紅線不能用，於是既沒有信任訊號，也沒有能合法上架的圖來讓賣場開張。
3. 核心頁 7-10 秒慢、公開包塞了不該在的庫（Shiki 語法高亮、mermaid、cytoscape、795KB 路線圖 canvas）；而 P1 的效能修復已經寫好，卡在 worktree 沒 ship。
</content>
