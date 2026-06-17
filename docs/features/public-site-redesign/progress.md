# 進度 — 公開站重設計

> 監工視角總覽（CLAUDE.md §9.4）。決策與 contract 見 [design.md](./design.md)。

## 狀態

- [x] 現況盤點 + 量測（prod, browser，數字進 design.md）
- [x] 設計系統方向 + 關鍵版型 mockup（`/tmp/pg-cards.html`）
- [x] Jeff 拍板：B/C/A 組合卡、右側固定欄、資料層優先
- [ ] **P1 設計系統 + 列表 + 列表資料層**  ← 進行中
- [ ] P2 詳情頁
- [ ] P3 首頁對齊 + 搜尋 + 目的地
- [ ] P4 成交（/book + /custom）
- [ ] P5 bundle + 圖片
- [ ] P6 其餘頁（服務/方案/聯絡/法務）

## 每階段 gate（缺一不 ship）

1. `tsc --noEmit` 0 錯（OOM: `NODE_OPTIONS=--max-old-space-size=6144`）
2. `pnpm test` 綠（新元件有對應 .test）
3. before/after 效能對照（同一支 browse 量測腳本），數字要降
4. → `pnpm ship`（Jeff 放 .deploy-approve token，§4.3）。Claude 不自部署。

## ⚠️ 並行 session 協調（2026-06-16）

工作目錄有**另一個 session/agent** 在同一棵樹做：catalog 重抓（`server/services/catalogRebuild/*` + `suppliersRouter.ts`）+ **詳情頁重做**（新 `TourDetailPeony/BookingRail.tsx`、改 `TourActionArea.tsx`/`HeroSection.tsx`/`actionArea.helpers.ts` 餘位區塊/`TourDeparturesTable.tsx`）+ 一批 i18n keys。Jeff 確認有並行 session，指示**我只守 P1、不碰他們的檔**。

影響：
- **P2（詳情頁）改由並行 session 負責**，我不做（見 task #2）。我的 P1 安全地 **build on 他們已落地的 `actionArea.helpers`**（重用 deriveAvailability/deriveStartingUsd/deriveFlightInclusion）。
- 全樹 tsc 有 **1 個錯在他們的 `TourDeparturesTable.tsx:187`**（傳部分物件給 `deriveAvailabilityBucket`，缺 departureDate）→ **他們修**，不是 P1 阻擋。
- **不在共享樹 commit/ship**：husky pre-commit 會被他們那個 tsc 錯擋；且會混到他們未完成的工作。P1 等整合（或 Jeff 指示隔離到 worktree）再 ship。

## P1 子項

- [x] `client/src/components/site/`：TourCard（A 編輯 / B 卡 / C 橫列）、PriceTag、AvailabilityBadge、Section、PageHero（按鈕沿用 shadcn `Button` 階層）
- [x] 後端輕量投影：新 `tours.searchCards`（toursRead.ts，drop 重 JSON、server 端解析標題）— 比 `listToursForCards` 更低風險（沒動 searchTours / DB select；網路 payload 已瘦）
- [x] 殺 N+1：列表改用既有 `departures.getNextBatch(tourIds[])` 一次批次（取代每卡 getUpcoming + getTourTranslations，12 卡 24 查 → 1 查 + 1 批次）
- [x] 重做 `client/src/pages/Tours.tsx`：共用 `TourCard` layout="card" + actionSlot 比較鈕；刪本地 TourCard/AvailabilityPill + 清未用 import
- [x] 純函式 `toTourCardData` 抽出 + 8 測試綠（含紅線：output 不帶 cost/agentPrice）；i18n parity 100%；**我的檔 tsc 0 錯**
- [ ] /tours before/after 效能對照 → **prod 量（ship 後）**：485KB + 24 查 → searchCards 瘦 payload + 1 批次
- [ ] DB-level 投影（select 只取卡片欄位）留 P3（/search、/destinations 幾百列才真的需要）
