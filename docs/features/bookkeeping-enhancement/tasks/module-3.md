# M3 — 批次分類 UI + 待審佇列

harness #70 · design.md §M3 · 待 M1

## 目標
多選一次分類數十筆；真正的「需要 Jeff 確認」佇列一眼看完低信心交易。後端 bulkCategorize 已存在（M1 補了 enum）。

## Checklist
- [x] row 加 checkbox + 全選；選取存 Set<id> state
  - 純邏輯抽到 `client/src/lib/bankLedgerFilters.ts`（toggleIdInSet / isAllSelected / isSomeSelected / toggleSelectAll，全 immutable）
  - DataTable primitive 加 `headerRender`（向後相容）→ 全選 checkbox 進表頭，支援 indeterminate
  - row checkbox `onClick stopPropagation` 不觸發 drawer
- [x] 選取 > 0 浮出批次 bar：類別下拉（複用 M1 設定）+「套用到 N 筆」
  - `fixed bottom-6` 浮動 bar，rounded-xl + shadow；下拉直接 render CATEGORY_GROUP_ORDER × ACCOUNTING_CATEGORY_CONFIG
- [x] 套用前 confirm（financial）；呼叫既有 `bulkCategorize`
  - `handleBatchApply` confirm 顯示「N 筆 → 類別」再 fire；複用 M1-validated `trpc.plaid.bulkCategorize`，無新後端
- [x] 「需審核」filter：agentCategory==='other_review' OR agentConfidence<60 OR 未分類
  - `txNeedsReview`：Jeff override 一律清出佇列（已確認）；excluded 永不進；conf 門檻 60 可調
- [x] 切頁/換 filter 清空選取（避免誤套）
  - `useEffect` on [tab, searchQuery, dateFrom, dateTo] → 清 selectedIds + batchCategory
- [x] 圓角 / 繁中 i18n 合規（CLAUDE.md）
  - bar rounded-xl、下拉 rounded-lg、checkbox rounded；9 個 i18n key 進 zh-TW + en（tabNeedsReview / selectAll / selectRow / batchSelected / batchCategoryPlaceholder / batchApply / batchConfirm / batchToastDone / batchToastFailed）

### 驗收
- [x] `tsc --noEmit` 0 error
- [x] Vitest：選取狀態邏輯 / 需審核 filter 條件（`bankLedgerFilters.test.ts` 25/25 綠）
- [ ] 手測：選 5 筆套用、需審核 tab 只顯示低信心（待部署後 prod 自測）
