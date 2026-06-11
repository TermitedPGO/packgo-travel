# 批7 — 行程管理(行程庫 + 單一行程全貌)

> Stage 3 task 文件。設計依據:後台_09_行程管理.html(一個行程的全貌)+ redesign-39.md。
> 39-tab 對照:tours + calibration-review(分數內嵌)→ 行程管理頁。
> 健檢出入 3(2026-06-09):行程在 /workspace 暫無入口,批7 補回(WorkspaceCompany 第 6 sub-item)。

## 實況調查(2026-06-11)

### 現有後端(齊全,零新 procedure;m3 對 marginAudit 加選用 tourId 過濾)
- `toursRead.list`:{category?, status?, featured?, pageSize ≤10000} → 完整 tour rows(含 calibrationScore/Verdict)
- `toursRead.getById`:單行程完整資料(餵 detail + TourEditDialog)
- `toursAdmin` 27 procedures:update(編輯)/ toggleStatus(上下架,L799 防 draft 直接 active)/ toggleFeatured / getPendingReview / approveTour / rejectTour / getCalibrationResult(5 分項)/ backfillLionDepartures(重新拉班次)
- `departures.listByTour`:{tourId} → 全班次(departureDate/returnDate/status open|full|cancelled|confirmed/totalSlots/bookedSlots/adultPrice)
- `toursRouteMap.getRouteMap`:{id} → {staticMapUrl, stops[], directionsUrl, fallbackMode?}
- `suppliers.marginAudit`(批5 m5 新建):成本毛利;m3 加選用 tourId 過濾(additive)

### tours JSON 欄位
- itineraryDetailed:[{day, title, activities[{time,title,description}], meals{breakfast,lunch,dinner}, accommodation}]
- costExplanation:{included[], excluded[], additionalCosts[], notes}
- galleryImages:[{url, alt, caption}];heroImage varchar
- calibrationScore int + calibrationVerdict pass|warn|fail + calibrationReport JSON

### 現有前端
- `admin/ToursTab.tsx`(1093)+ `admin/tours/*` 12 檔(header/filters/row/card/bulk/create/preview/quickCreate dialogs + helpers)
- `admin/TourEditDialog/`(shell ~400 + 6 sub-tabs ≈1800):props {open, onOpenChange, tourData, onSave, isSaving} → **直接重用**
- `admin/CalibrationReviewTab.tsx`:getPendingReview + getCalibrationResult + approve/reject → 批7 內嵌吸收
- WorkspaceSidebar COMPANY_SUBS(5 項)→ 加第 6 項 "tours"

### Mockup 對照(後台_09)與誠實 gap
- header(status badge + 供應商代碼 + serif 標題 + meta + 帶去報價/做文案/編輯)— **帶去報價/做文案 v1 不做**(報價工具/文案工具的跨頁帶 context still 無資料線,不放死按鈕;記 gap)
- 圖片 grid(主圖 + gallery + 補圖 affordance)— 補圖「AI 重生」無既有 per-image procedure,v1 顯示缺圖佔位 + 走編輯 dialog Photos tab;記 gap
- 路線地圖卡(N 景點已定位 + 天/景點/住宿統計 + Directions API 警示)✅ getRouteMap;landmark-ref m4 被 GCP 卡住照實顯示(見 memory project_landmark_ref)
- 每日行程 timeline ✅ itineraryDetailed
- 價格/毛利卡 ✅ m3 接 marginAudit(tourId)
- 出發日/庫存 pills ✅ departures.listByTour(過去隱藏)
- 內含/不含 ✅ costExplanation
- 品質 calibration ✅ calibrationScore + getCalibrationResult 5 分項
- 底部 per-tour AI composer — v1 不做(批2 customerChat 是 per-customer;per-tour context 注入是新線);記 gap
- 動作:編輯(重用 TourEditDialog)/ 預覽客人頁(/tour/:id)/ 上下架 toggleStatus / 重新整理供應商資料(backfillLionDepartures,Lion only 照實標)

### 設計治理
- 上架(approveTour / toggleStatus → active)= 客人可見 = 🔒 gated confirm;下架輕 confirm
- 全部重用既有 mutation,零新寫路徑
- 手機內建:min-w-0/truncate/44px/text-base;3-col grid → lg:grid-cols-3、手機單欄

## Milestones

### m1 — 行程庫 list + workspace 入口(零新後端)✅
- [x] WorkspaceSidebar COMPANY_SUBS + CompanySub type 加 "tours"(置首);WorkspaceCompany 第 6 tab lazy WorkspaceTours
- [x] `workspace/WorkspaceTours.tsx`(215 行):tours.list(pageSize 1000)→ 卡列(縮圖 + title + 天數/價格 + status badge + calibration 分 + featured ★)
- [x] 篩選:搜尋 + status pills 帶數字(全部/上架/未上架/待審核)+ 排序(預設=待審核優先/最新/價格);client-side 分頁 25/頁(stale page clamp)
- [x] 待審核行黑左條 + BadgeK,預設排序置頂
- [x] i18n · tsc 0 · Vitest(filterSortTours/filterCounts/pageSlice)

### m2 — 行程全貌 detail(零新後端)✅
- [x] list 點行 → inline detail(返回鈕)— TourDetail.tsx(237)+ TourDetailPanels.tsx(134)
- [x] header:status badge + productCode + serif 標題 + meta(國/城/天數/出發地/calibration)
- [x] 圖片:heroImage 大圖 + galleryImages 縮圖 grid(rounded-xl);缺圖誠實佔位
- [x] 每日行程 timeline(day 圓 + 住宿/餐 chips)— parseItinerary 壞 JSON/junk 安全降級(description fallback 用 activities 標題)
- [x] 右欄:價格卡 / 出發日庫存 pills(departures.listByTour,過去+cancelled 隱藏,seatsLeft clamp 0)/ 內含不含 / 品質卡(總分 + verdict pill)
- [x] 路線地圖卡:staticMapUrl 縮圖 + N 景點已定位 + fallbackMode Warn(geocode 有 24h in-process cache,與公開頁同款成本)
- [x] i18n · tsc 0 · Vitest(parseItinerary/parseCost/upcomingDepartures 共 6 組)

### m3 — 動作列 + 毛利接線
- [ ] marginAudit 加選用 tourId 過濾(additive,批5 新 procedure 自己的)→ 價格卡 cost/毛利行 + <15% 警示
- [ ] 編輯:重用 TourEditDialog(getById 餵 tourData,tours.update 存)
- [ ] 上下架:上架 🔒 gated confirm(客人可見)、下架輕 confirm → toggleStatus;featured toggle
- [ ] 預覽客人頁(window.open /tour/:id)+ 重新整理供應商班次(backfillLionDepartures,Lion 來源才顯示)
- [ ] i18n · tsc 0 · Vitest

### m4 — calibration 內嵌(吸收 calibration-review)
- [ ] detail 品質卡展開:getCalibrationResult 5 分項(內容忠實/翻譯/圖片/完整/行銷)+ issues 列表
- [ ] pending_review 行程:detail 顯示 approve 🔒 / reject 動作(既有 approveTour/rejectTour)
- [ ] 行程庫「待審核」filter pill 帶數字
- [ ] i18n · tsc 0 · Vitest

## DoD Checklist
- [ ] tsc 0 · 全套 Vitest 綠(2049+ 基線)· i18n parity
- [ ] 上架動作 🔒 gated;全部走既有 mutation
- [ ] 300 行紅線;手機規則內建
- [ ] Jeff visual approval(prod)

## 記錄的 gaps(不虛構,後續批/feature 接)
- 帶去報價 / 做文案 跨頁 context 帶入(無資料線)
- per-image AI 補圖/重生(走編輯 dialog Photos tab 代替)
- per-tour AI composer(批2 模式是 per-customer)
- 路線實際路徑需 GCP Directions API(landmark-ref m4,等 Jeff)
