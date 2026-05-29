# M4 — P&L 報表 UI + 年度匯出按鈕

harness #71 · design.md §M4

## 目標
一鍵年度/月度 P&L，分區清楚，owner capital 獨立顯示不計入；一鍵下載報稅 ZIP。後端全已存在（profitLossReport / profitLossTrend / financeKpi / yearEndExport）。

## Checklist
- [x] 年度/月度切換
  - `ProfitLossV2.tsx` mode toggle (teal 高亮)；annual → `{year}-01-01..12-31`，monthly → `monthRange(year,month)` 算當月最後一天
  - 年份下拉 2020..今年；monthly 時才顯示月份下拉
- [x] P&L 分區顯示：營收 / COGS / 毛利 / OpEx / 淨利 / 退款
  - `PLRow` 瀑布：訂單收入 → (減)退款 → (減)信託遞延 → **淨營收** → (減)COGS → **毛利** → (減)OpEx(+逐類別 indent) → **淨利**
  - 數字全部直接讀後端 `BankPLReport`，UI 不重算（math 權威在 foldBankPLRows）
- [x] owner capital (transfer) 獨立 tile，不計入淨利
  - KPI strip 第 4 張 + audit callout tile；`fmtSigned`（inflow-positive）；標「不計入損益 · N 筆」
- [x] trust deferred 沿用既有扣除 + 獨立 tile（task #41）
  - statement 內當作 (減)信託遞延 line（後端已扣進 income.total）+ audit callout 獨立 tile「客人訂金 (trust)」
- [x] 「下載年度報稅 ZIP」按鈕 → yearEndExport({year}) → R2 URL → 下載
  - `exportMutation` → onSuccess `window.open(data.url)`（user-initiated，非 agent 觸發）+ toast；isPending 時 spinner + disabled
- [x] 圓角 / 繁中 i18n 合規
  - container rounded-xl、toggle rounded-lg/md、Select rounded-lg/xl、Button rounded-lg、tile rounded-lg；41 個 i18n key 進 `admin.profitLoss.*`（zh-TW + en）

### 驗收
- [x] `tsc --noEmit` 0 error
- [x] Vitest：P&L 分區數字 = 後端回傳；transfer 不進淨利（`bankPLService.test.ts` 8/8 — UI 直接 render 後端值，math guarantee 在 fold 測試；i18n parity 2/2；M3 regression 25/25）
- [ ] 手測：切年度、下載 ZIP 成功（待部署後 prod 自測）
