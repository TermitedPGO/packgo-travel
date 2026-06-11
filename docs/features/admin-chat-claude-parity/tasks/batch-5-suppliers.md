# 批5 — 供應商(同步 · 監控 · 商品庫 · 競品摘要)

> Stage 3 task 文件。設計依據:後台_07_行銷.html PAGE 2「供應商完整」+ redesign-39.md。
> 拍板(2026-06-09):competitor-monitor 縮編為「每週摘要卡」;tour-monitor / suppliers / supplier-enrichment 併入供應商一頁。

## 實況調查(2026-06-11)

### 現有後端(3 routers — 齊全,只差毛利查詢)
- `suppliersRouter.ts`(2733 行,17 procedures):overview · recentRuns · triggerSync · listProducts · bulkImport · importProduct · setHidden · enrichmentOverview · triggerFullBackfill · previewMassImport · massImportFromMirror + 6 個 audit/deactivate 工具
- `tourMonitorRouter.ts`(59 行,5 procedures):getStats{total,ok,changed,error,unmonitored} · getRecentLogs · getTourHistory · getLatestRun · triggerRun
- `competitor.ts`(169 行,11 procedures):list · getById · create · update · delete · triggerScrape · priceHistory · alerts · unreadAlertCount · markAlertRead · markAllAlertsRead
- `workspace.ts`:setDisposition(itemKind enum 可加值,additive)
- `tours.update`(toursAdmin.ts):含 price,有 audit log + optimistic lock — 「更新我的售價」走這條既有 mutation

### 相關 tables(零新表需求)
- suppliers · supplierProducts(status: active/inactive/pending + isHiddenByAdmin)· supplierDepartures(agentPrice=成本)· supplierProductDetails(5 種 parse status)· supplierSyncRuns(kind: full/hot/manual/detail,status: running/success/failed/partial)
- tourMonitorLogs:priceChanged + previous/currentPrice · currentStatus(open/soldout/confirmed/cancelled)· hasChanges · changesSummary · errorMessage
- competitorTours / competitorDepartures / competitorPriceHistory / competitorAlerts(7 alertType,3 severity,isRead)
- workspaceDispositions(itemKind+itemId 通用,可收「維持原價=已看過」)

### tours ↔ supplierProducts 連結(毛利計算的既有模式)
suppliersRouter 3 處已用:`tours.sourceUrl LIKE '%NormGroupID=' + externalProductCode + '%'` OR `'%/product/detail/' + externalProductCode + '%'`。毛利查詢沿用同一 LIKE-join。

### 現有前端(4 個 tab → 併 1 頁)
- `admin/SuppliersTab.tsx`(520 行):同步 + 商品庫 + 批量匯入
- `admin-v2/SupplierEnrichmentTabV2.tsx`(188 行):enrichment 進度 — **目前 workspace suppliers sub-tab 載的就是這個**
- `admin-v2/MonitorDashboardV2.tsx`(639 行):行程監控
- `admin/CompetitorMonitorTab.tsx`(929 行):競品監控(縮編為摘要卡)

### Mockup 對照(後台_07 PAGE 2)與誠實 gap
- (a) 同步狀態 per supplier 卡(4 格 KPI + 看失敗清單)✅ 資料齊。mockup「價格變動」格 = tourMonitor stats.changed(sync runs 沒有價格變動數,不虛構)
- (b) 成本毛利卡(毛利 < 15% 警告)— **無既有 procedure,m5 新增唯讀查詢**(LIKE-join + min 未來 agentPrice vs tours.price)
- (c) 價格變動碰錢卡(原成本→新成本 + 更新我的售價🔒/維持原價)✅ tourMonitorLogs priceChanged;更新售價走既有 tours.update
- (d) 缺貨卡 ✅ currentStatus=soldout;「受影響客人」連結 = gap(詢問/報價無 tourId 強連結,v1 不虛構,只給「去行程」跳轉)

### 設計治理
- 碰錢(更新售價)= 🔒 黑鎖條 gated confirm,走既有 mutation,零新自動流程
- 競品 = 摘要卡 + 告警列表 + 最小管理(加/爬/刪),不重建 929 行 tab
- 手機內建(redesign-39 手機驗收規則):w-full min-w-0 · truncate · grid-cols-1 sm:grid-cols-2 · 點擊區 ≥44px · 輸入 text-base

## Milestones

### m1 — WorkspaceSuppliers shell + 同步狀態卡(零新後端)
- [x] 新元件 `workspace/WorkspaceSuppliers.tsx`:header(供應商 · 同步/監控/商品庫/競品)+ 立即同步鈕
- [x] per-supplier 同步卡(Lion/UV 動態自 suppliers.overview):商品數/上架/隱藏/最後同步 + 最近一次 run KPI(掃描/新增/狀態/耗時)
- [x] 最近同步紀錄列表(recentRuns):failed run 黑框 + errorMessage
- [x] 立即同步:kind 選擇(full/lion-only/uv-only)+ confirm dialog → triggerSync
- [x] WorkspaceCompany suppliers sub-tab:SupplierEnrichmentTabV2 → WorkspaceSuppliers
- [x] i18n(zh-TW + en)· tsc 0 · Vitest(runState 映射 + 排序)

### m2 — 行程監控卡(變動/缺貨/錯誤 + 碰錢價格卡)
- [x] 監控 KPI 行(getStats:total/ok/changed/error/unmonitored)+ triggerRun
- [x] 價格變動卡(mockup c):原價→新價黑框 + Δ% · 更新我的售價 = 🔒 黑鎖條 confirm → tours.update({id, price})· 維持原價 = setDisposition(monitor_log)淡化
- [x] 缺貨/狀態變動卡(mockup d):soldout 黑 badge + 變動摘要 + 去行程跳轉(開 /tour/:id)
- [x] 錯誤卡:errorMessage 誠實顯示
- [x] workspace.setDisposition itemKind 加 "monitor_log"(additive)
- [x] i18n · tsc 0 · Vitest(monitorCardKind 分類 + 已處理過濾)

### m3 — Enrichment 進度 + 商品庫 
- [x] Enrichment 卡(enrichmentOverview):per-supplier 行程解析進度條 + triggerFullBackfill(confirm)
- [x] 商品庫:listProducts 篩選(供應商/國家/關鍵字/天數/未匯入)+ 分頁列表
- [x] 單品匯入(importProduct + queueRewrite)+ 隱藏/顯示(setHidden)
- [x] 批量匯入 dialog(bulkImport:上限 + queueRewrite)→ 結果 toast(requested/imported/failed)
- [x] i18n · tsc 0 · Vitest(filter 參數組裝)

### m4 — 競品每週摘要卡 
- [ ] 摘要卡:unreadAlertCount + 近 7 天告警分組統計(price_drop/sold_out/new_departure…)
- [ ] 告警列表:severity 視覺(critical=粗黑左條)+ markAlertRead / markAllAlertsRead
- [ ] 最小管理:競品行程列表(list)+ 新增 dialog(create)+ triggerScrape + delete(confirm)
- [ ] i18n · tsc 0 · Vitest(告警分組統計)

### m5 — 成本毛利卡(新唯讀查詢)
- [ ] 新 procedure `suppliers.marginAudit`(唯讀):LIKE-join tours↔supplierProducts + min 未來 departure agentPrice → margin = (price−cost)/price,flag < 15%
- [ ] 毛利卡(mockup b):後台成本/建議售價/毛利% + <15% 警告 + src 行(後台模擬訂單核對提醒)
- [ ] 更新售價從毛利卡也可走(同 m2 🔒 路徑)
- [ ] i18n · tsc 0 · Vitest(margin 計算 + 警戒線)

## DoD Checklist
- [ ] tsc --noEmit 0 errors
- [ ] Vitest 全綠(1885+ 基線)
- [ ] i18n parity:全部新 key zh-TW + en
- [ ] 碰錢動作(更新售價)🔒 gated + 走既有 mutation
- [ ] 手機:w-full min-w-0 / truncate / 點擊區 / text-base 內建(截圖驗證待 prod)
- [ ] Jeff visual approval
