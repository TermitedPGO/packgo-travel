# 行程目錄重抓 + 詳情/列表頁重做(UV + Lion)

> 起因(2026-06-16):兩份 API 筆記(桌面 UV_縱橫海鷗 / 雄獅_Lion)證明兩家供應商 API 都能即時給「完整」一團資料(逐日行程、即時餘位、各房型直客價、必付+自費、照片、航班)。Jeff:現在 DB 的團不夠完整、不夠整潔、不夠直白,要下架 UV+Lion 全部重抓,並把詳情頁 + 列表頁重做成「客人一眼就懂」。中國美(eChinaTours)以後再做。

## 現況盤點(prod,2026-06-16)

總共 6,499 團(Lion ~5,355、UV ~1,144),完整度不一:

| 供應商 / 狀態 | 數量 | 有每日行程 | 有景點 | 有圖 |
|---|---|---|---|---|
| Lion active | 2,138 | 1,781 (83%) | 1,464 (68%) | 1,993 (93%) |
| Lion draft | 2,742 | 2,595 | 1,651 | 2,458 |
| Lion inactive | 474 | 353 | 247 | 354 |
| UV active | 493 | 493 (100%) | 489 | 464 |
| **UV inactive** | **639** | **3 (0.5%)** | 3 | 3 |

重點:UV active 幾乎完整;**UV inactive 639 團幾乎是空殼**(只有基本欄位,沒行程/景點/圖);Lion active 還有 ~17% 沒每日行程、~32% 沒景點。所以「不夠完整」是真的,重抓能補。

schema 其實夠用(`tours`:itineraryDetailed、attractions、hotels、meals、galleryImages、heroImage、status、availableSeats、departureDates JSON)。問題在「沒抓滿」+「頁面沒呈現好」。

## 紅線(焊進重抓 + 頁面)

1. **成本價已經在 DB 裡**:`supplierDepartures.agentPrice` = Lion 的 IndustryLowestPrice = 同業價 = 我們的成本(`server/services/supplierSync/lion.ts:113` 有存)。客人頁 / 文件**只能用 retailPrice / tours.price(直客價),絕對不能碰 agentPrice**。這是 David 漏價那課的延伸([[feedback_no_cost_on_customer_docs]]),要有 guard + 測試。
2. **餘位**:客人只看 有位 / 名額有限 / 已滿,不給確切數字;標「下單前再確認」(站台有位 ≠ 一定訂得到)。
3. **照片版權**:供應商圖是他們的行銷照,客人頁不直接放原圖;存網址當素材來源,自家重做版再上。
4. **SEO**:列表 / 詳情頁是 client-side SPA,對爬蟲 / AI 引擎隱形([[project_seo_clientside_invisible]])。不先 prerender,頁面做再漂亮 SEO 也是白做。

## 決定(Jeff 拍板 2026-06-16)

- 範圍:UV + Lion(中國美以後)。
- 重抓策略:**不要先清空再抓**(會讓現在上線那批空窗、壞連結、掉 SEO)。改成:全部重新抓進來、驗過,再一次性把上架那批換掉,舊批封存不硬刪、可回滾。結果一樣乾淨,但沒空窗、出事能退。
- 餘位:**即時查**,加短快取(5–15 分鐘 TTL),避免每次看頁面都打供應商 API(會慢、會被擋)。
- 照片:重做自家版(細節再議)。
- 頁面:**直白簡單**,客人一眼看到該知道的,不堆東西(見下)。

## 頁面重做(直白簡單)

- 列表頁:乾淨的卡,一卡講完 目的地、幾天、起價(直客)、最近出發 / 頻率、有沒有位。極簡 + 對齊([[feedback_minimalism_is_intentional]]、[[feedback_grid_density_rhythm]])。
- 詳情頁(`client/src/pages/TourDetailPeony.tsx`,CLAUDE.md 標記待拆大檔):最上面一眼看完關鍵(去哪、幾天、起價、最近班期、有沒有位、含什麼),往下逐日行程(一天一塊清楚)、含與自費、清楚 CTA。不塞、不花、白話。

## 關鍵檔案

| 用途 | 檔案 |
|---|---|
| UV / Lion API client(read-only,免登入) | `server/suppliers/{uvClient,lionClient}.ts` |
| 餘位分級 deriveAvailability | `server/suppliers/types.ts` |
| 同步進 DB | `server/services/supplierSync/{uv,lion,lionDetail}.ts` |
| tours / supplierDepartures(retail + agentPrice) schema | `drizzle/schema.ts` |
| 詳情頁 | `client/src/pages/TourDetailPeony.tsx` |
| 列表頁 | (待確認路由) |

## 怎麼做(分塊,新 session)

1. **重抓 pipeline**:UV + Lion 全產品 + 每日行程 + 景點 + 直客價 + 班期,寫進新一批 → 驗完整度 → 原子換上架批、舊批封存。只存 retail,agentPrice 留內部。
2. **即時餘位**:看頁面時查 supplier API(uvClient / lionClient)+ 短快取 → 轉 buckets。
3. **詳情頁重做**:直白簡單版(關鍵上、逐日下、含/自費、CTA)。
4. **列表頁重做**:乾淨卡。
5. **紅線 guard**:客人頁查詢一律 retail,加測試確保 agentPrice 不外洩。
6. **prerender**:讓列表 / 詳情頁對爬蟲可見。

每塊 vitest + tsc 0 錯(OOM 用 `NODE_OPTIONS=--max-old-space-size=6144`)+ 全測試綠 → `pnpm ship`(Jeff token,§4.3)。建議第一塊先把重抓 pipeline + 紅線 guard 跑通(資料先對),再做兩頁。

## 非目標

- 中國美(之後)。
- 自動下單 / 付款(維持人工)。
- 客人看確切餘位數字。
