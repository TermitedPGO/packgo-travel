# 公開站重設計 — 一套設計系統 + 修慢

> 起因（2026-06-16，Jeff）：把整個公開網站當「一套」一致的設計系統重做（不是一頁頁各做），同時把「反應慢」修掉。本文件是這個 feature 的 source of truth（CLAUDE.md §9.1）。資料層那塊與 [[tour-catalog-rebuild]] 重疊，互相引用。

## 現況量測（prod, 2026-06-16, 1440 桌機，用 gstack browse 量）

| 頁面 | 殼載入 | 最慢 tRPC | 病因 |
|---|---|---|---|
| 首頁 | 0.55s | 8.3s / 1.05MB | `tours.list` pageSize=50 回傳整包行程 JSON（無投影）|
| /tours | 0.23s | `tours.search` 485KB + `departures.getUpcoming` ×12 + `getTourTranslations` ×12 | 列表回傳整列 + 每卡 2 查（N+1×2）|
| /tours/:id | 0.81s | 7.5s | 第二波 getRouteMap+getSupplierDetail+priceComparison+getSimilar 串行阻塞 |
| /search | 1.1s | 9.9s | 一次倒出幾百張卡、整列資料 |
| /destinations | 0.72s | 8.9s | 同上 |
| /book /custom /flight /membership /contact | <1s | <0.3s | 正常 |

Bundle（首頁）：~2MB JS（index 913KB + vendor-recharts 573KB 誤打包進公開包 + react 437KB + date 79KB）、~3.7MB 圖（6 張目的地/hero 各 ~450KB，無 responsive）。
其他：`TourRouteMapGoogle` 在首頁與每個詳情頁丟 error（沒 Maps API key）→ fallback SVG，白載 JS。hero-sakura preload 但沒即時用（LCP 失準）。

根因：慢全集中在「行程資料層」回傳整列（itineraryDetailed/attractions/hotels/meals/galleryImages，~21KB/團），不是版面、不是骨架。`server/db/tour.ts:getAllTours` 無投影；`Tours.tsx:144` 的本地 TourCard 每卡查 departures + translations。

## SSR/prerender 評估結論（Jeff 要求先評估）

先不做 SSR。① 爬蟲已有 `server/_core/prerenderMiddleware.ts`（bot UA → Puppeteer 出 HTML，Redis 24h），SEO 隱形已解大半。② SSR 不修真實使用者的慢——慢的是那幾支 8 秒 query，不先修，SSR 只是把 8 秒搬到伺服器端。最高槓桿是資料層。資料層修好後真實使用者首屏約 1 秒；SSR 列為之後加分項。

## 決策（Jeff 拍板 2026-06-16）

1. **主卡 TourCard**：一顆元件、三種排版 → **B 簡潔卡**用於 /tours 列表、**C 橫列**用於 /search 與 /destinations 長清單、**A 編輯風大圖**用於首頁精選。mockup：`/tmp/pg-cards.html`。
2. **詳情頁**：右側固定預訂欄（價格＋最近班期＋餘位＋主 CTA），手機改底部固定列。
3. **效能**：資料層優先（P1）→ bundle（P2）→ 圖片（P3），SSR 之後。
4. 首頁是好範本，其餘對齊它，別改壞。極簡黑白 + 對齊。

## 紅線（焊死，每階段測試守）

- 客人頁/文件**只用 retailPrice / tours.price（直客價）**，絕不碰 `supplierDepartures.agentPrice`（成本）。[[feedback_no_cost_on_customer_docs]]
- 餘位只給 **有位 / 名額有限 / 已滿**，不給數字，標「下單前再確認」。（現 /book 顯示「剩餘座位 0/20」要改。）
- 供應商行銷照不直接上客人頁；mockup 暫用站上既有圖，正式版自家重製/授權。
- 詳情頁拿掉供應商內部碼（26CC401BRC 那種）、修「含/不含機票」矛盾。
- 價格顏色一律品牌墨黑，**移除 /book 殘留的 teal/green 價格**。
- i18n：JSX 不硬編中文（DB 動態內容除外）。圓角規範 CLAUDE.md §2.1。

## 共用元件 contract（client/src/components/site/）

| 元件 | 職責 | 重點 props |
|---|---|---|
| `TourCard` | 全站行程卡 | `layout: "editorial"\|"card"\|"row"`、`tour: TourCardData`（輕量投影）|
| `PriceTag` | 直客價顯示 | `amount`、`currency`、`from?`；tabular-nums、墨黑；**永不吃 agentPrice** |
| `AvailabilityBadge` | 餘位三級 | `bucket: "available"\|"limited"\|"soldout"`；金描邊/琥珀/灰 |
| `PageHero` | 頁首 | `variant: "photo"\|"compact"`、`image?`、`title`、`eyebrow?`、一個主 CTA |
| `Section` | 區塊節奏 | `eyebrow?`、`title?`、`action?`；統一 py 與容器 |
| `BookingRail` | 詳情頁固定預訂欄 | `price`、`nextDeparture`、`bucket`、主/次 CTA；桌機 sticky、手機底部列 |
| `DayBlock` | 逐日行程一天 | `day`、`title`、`body`、`meals`、`hotel` |
| `IncludedList` | 含/不含 | `included[]`、`excluded[]` |
| button 階層 | 主（實心黑）/次（描邊）/文字（+箭頭）| 每頁一個主要動作 |

`TourCardData`（輕量投影，list/search 用）：`{ id, slug?, title, destination, days, priceFrom, currency, heroImage, nextDepartureDate?, frequencyLabel?, availabilityBucket }`。不含 itinerary/attractions/hotels/meals/gallery。

## Phase 計畫（每階段：tsc 0 錯 + vitest 綠 + before/after 效能對照 → `pnpm ship`，Jeff token §4.3。不自部署。）

- **P1 設計系統 + 列表 + 列表資料層**：建 site/ 共用元件（TourCard B/C、PriceTag、AvailabilityBadge、Section、PageHero、button）；後端加輕量投影 `listToursForCards` + 批次 `departures.getUpcoming(tourIds[])`（殺 N+1）；重做 /tours 用 TourCard B + 真分頁。量 /tours：485KB+N+1 → 小。
- **P2 詳情頁**：重做 TourDetailPeony 右側 BookingRail + facts 列 + DayBlock + IncludedList；拿掉供應商碼、修含/不含機票；下半部（routeMap/supplier/similar/reviews/priceComparison）延遲載入；修 Maps error。量 7.5s → ~1s。
- **P3 首頁對齊 + 搜尋 + 目的地**：首頁精選換 TourCard A + 輕量投影（修 8.3s/1MB）；/search、/destinations 換 TourCard C + 分頁 + 投影（修 9.9s/8.9s）；對齊區塊節奏，不改首頁骨架。
- **P4 成交**：/book 修 teal 價→墨黑、餘位改三級不給數字、套 tokens；/custom-tour-request 對齊。
- **P5 bundle + 圖片**：recharts/date/maps 移出公開包、拆 913KB index；hero/dest/卡片 responsive srcset+sizes+尺寸；修 hero preload。
- **P6 其餘頁**：服務頁（flight/hotel/visa/airport-transfer）、membership、contact、about/faq/terms/privacy/emergency/rewards 套 PageHero + Section + tokens。

## 非目標

- 中國美（eChinaTours）之後。自動下單/付款維持人工。客人看確切餘位數字。SSR（之後再評估）。
