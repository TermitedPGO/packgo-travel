# 記帳系統強化 — Progress (總覽)

> 監工視角。逐模組細節在 tasks/module-*.md。harness task ID 對應在表。

| 模組 | harness | 狀態 | 核心交付 | 過 tsc | 過 Vitest |
|------|---------|------|----------|--------|-----------|
| M1 詞彙表統一 (keystone) | #68 | ✅ 完成 | 共用 10 類別設定 + UI 下拉 + server enum + 舊資料唯讀稽核 | ☑ | ☑ |
| M2 Agent 知識庫 + 業主身分 | #69 | ✅ 完成 | accountingKnowledge.ts + preClassify 接線 + prompt 注入 | ☑ | ☑ |
| M3 批次分類 UI + 待審佇列 | #70 | ✅ 完成 | 多選 + 批次 bar + 需審核 filter | ☑ | ☑ |
| M4 P&L 報表 UI + 匯出按鈕 | #71 | ✅ 完成 | 年度/月度 P&L 分區 + 下載報稅 ZIP | ☑ | ☑ |
| M5 信託合規 + 稽核匯出 | #72 | ✅ 完成 | trust 報表 UI（CST 三元組 + env gate）+ 排除清單稽核匯出 | ☑ | ☑ |

## 完成定義 (每模組)
1. `pnpm tsc --noEmit` 0 error（OOM 時 `NODE_OPTIONS="--max-old-space-size=6144"`）。
2. 對應 `.test.ts` 通過。
3. 不違反 CLAUDE.md（圓角、繁中 i18n、tRPC-only、檔案 ≤300 行除非既有）。

## 紅線守則 (本 feature)
- 不自動 remap 歷史 override（financial data，Jeff 確認後才動）。
- 未知對方進帳 → other_review，不猜成收入。
- 業主本人金流 → transfer，不計營收。
- AI 不報價、不碰敏感金融/身分資料。

## 變更日誌
- 2026-05-28 proposal + design + tasks 文件建立；M1 開工。
- 2026-05-28 M1 完成：shared `accountingCategories.ts`、雙語 i18n key、BankLedgerV2 下拉重寫（移除 free-text）、plaidRouter server enum 驗證（transactionUpdate + bulkCategorize）+ 唯讀 `accountingLegacyOverrideAudit`、parity Vitest 8/8 綠、`tsc --noEmit` 0 error。M2 開工。
- 2026-05-28 M2 完成：`accountingKnowledge.ts`（OWNER_IDENTITIES 業主本人→transfer conf95；KNOWN_OUTFLOW_VENDORS Jupiter Legend/Ann→cogs_tour conf90，出帳限定；WF 卡出帳→cogs_tour；memo 提示 conf65 不拍板；未知進帳→null 不猜）。`preClassify` 接進 classifyOne：≥90 跳過 LLM（省錢），<90 注入 user prompt hint，未命中走原 LLM。`buildSystem()` 注入靜態知識摘要（byte 穩定，不破 prompt cache）。Vitest 17/17（含「知識庫絕不自動判收入」+「未知進帳→null」不變式）。`tsc --noEmit` 0 error。M3 開工。
- 2026-05-28 M4 完成：後端先補洞 — `BankPLReport` 新增 `transfer:{total,count}`（owner capital inflow-positive，**絕不進** income/expense/netProfit，Jeff:「我自己拿出 不代表公司賺」），純 fold 抽到 `foldBankPLRows`（async trust 查詢留在 `generateBankPL`，結果當參數傳入），`bankPLService.test.ts` 8/8（含「transfer surfaced 但不進淨利」「trust deferral 從 income.total+netProfit 扣除並 surface」「uncategorized+other_review→needsReview 不猜」紅線）。前端新 `ProfitLossV2.tsx`：年度/月度切換、P&L 瀑布（訂單收入→退款→信託遞延→淨營收→COGS→毛利→OpEx 逐類別→淨利）、owner capital + trust + 待審 + 已排除 4 張 audit tile（透明列出不影響淨利）、「下載 {year} 報稅 ZIP」→ `yearEndExport` → `window.open` R2 URL。UI 純 render 後端值不重算。接進 AdminV2（PageId `profit-loss` + nav「📊 損益表」+ lazy + switch case）。41 個 i18n key `admin.profitLoss.*`（zh+en parity 綠）。`tsc --noEmit` 0 error；Vitest 35/35（M4 8 + i18n 2 + M3 regression 25）。M5 開工。
- 2026-05-28 M3 完成：純邏輯抽到 `client/src/lib/bankLedgerFilters.ts`（needs-review 佇列 predicate + 多選 Set 數學，全 immutable，React 外可單測）。DataTable primitive 加 `headerRender`（向後相容）→ 全選 checkbox 進表頭支援 indeterminate。BankLedgerV2 加 row checkbox（stopPropagation 不觸發 drawer）+ 需審核 filter pill（Jeff override 一律清出佇列、excluded 永不進、conf<60 進）+ `fixed` 浮動批次 bar（複用 M1 類別下拉，confirm 後呼叫既有 `bulkCategorize`，無新後端）。切 tab/搜尋/日期清空選取避免誤套。9 個雙語 i18n key。Vitest `bankLedgerFilters.test.ts` 25/25（含「Jeff override 清出需審核」+「excluded 永不需審」紅線不變式）；accounting 全套 50/50 綠。`tsc --noEmit` 0 error。M4 開工。
- 2026-05-28 M5 完成（feature 收尾）：信託合規報表 + 稽核匯出。後端 — `foldOutstandingTrust` 純函式從 `computeOutstandingTrust` 抽出（DB 查詢留在 service，fold 可單測）；新 `auditExportService.ts`（純，無 DB/React）`foldExclusionRows` + `toExclusionCsv`（RFC-4180）— **紅線不變式：排除清單只含 effective category = transfer + other_review（一切不進 P&L 的錢），income/expense/refund/uncategorized 永不洩漏進稽核**，transfer 取 inflow-positive 淨額（對齊 bankPLService），other_review 取絕對值，pending 跳過。`plaidRouter.auditExclusionList` query（adminProcedure，日期區間，回 records+summary+csv）。前端新 `TrustComplianceV2.tsx`：env gate（`enabled=false`→amber「未啟用」banner 不報錯）、CST 對帳三元組 KPI（Outstanding/Balance/Drift + Unmatched，全來自 trustReconciliation 無 row cap）、per-account 對帳卡、deferred-list status filter 表、稽核匯出區（年度 Select + 下載 CSV + transfer/other_review 摘要 tile + 前 20 列預覽）。**守「不準猜」：不編可能不準的 recognized grand-total，已認列改用 status filter 按需呈現。** CSV 下載為 Jeff 點擊觸發的 client-side Blob。接進 AdminV2（PageId `trust-compliance` + nav「🔒 信託合規」+ lazy + switch case）。~50 個 i18n key `admin.trustCompliance.*`（zh+en parity 綠）。`tsc --noEmit` 0 error；Vitest 14（M5 foldOutstandingTrust 4 + foldExclusionRows/toExclusionCsv 8 + i18n parity 2），accounting 全套續綠。**M1–M5 全數完成，feature ready for deploy/QA。**
