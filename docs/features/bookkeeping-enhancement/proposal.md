# 記帳系統強化 — Proposal (Stage 1)

> Vibe Coding §9。本文件是「需求 + 為什麼」。設計細節在 design.md，逐模組 checklist 在 tasks/。

## 目標 (Goal)

強化 PACK&GO 記帳 AI agent 與整套記帳功能，讓明年（2026）的自動分類正確率大幅提升、
損益/報稅一鍵匯出、批次分類不再一筆一筆點、信託合規可稽核。

Jeff 2026-05-28 透過 AskUserQuestion 確認全部四項都要做：

1. **AI 分類更聰明** — 把今年人工修正過的知識變成 agent 的永久規則。
2. **損益表 + 報稅匯出** — 一鍵年度/月度 P&L，自動排除「我自己拿出的錢」(transfer)，拆 營收/COGS/OpEx/退款，CSV+PDF 給會計師。
3. **批次分類 + 待審佇列** — 多選批次分類，真正的「需要 Jeff 確認」佇列。
4. **信託合規 + 稽核匯出** — 信託遞延收入報表 (CST §17550)，匯出排除清單/轉帳明細當稽核軌跡。

## 背景與既有狀態 (Input)

讀過真實 source（不靠二手摘要），確認後端其實大半已存在：

| 區塊 | 既有 | 檔案 |
|------|------|------|
| AI 分類 agent | ✅ 10 類別 + Haiku 4.5 | `server/agents/autonomous/accountingAgent.ts` |
| 分類 orchestration | ✅ 單筆 + 批次 + 過去案例學習 | `server/services/accountingAgentService.ts` |
| 真實 P&L 引擎 | ✅ 讀 Plaid ledger、Schedule C map、transfer 排除、trust 扣除 | `server/services/bankPLService.ts` |
| 批次分類後端 | ✅ `bulkCategorize` / `uncategorizedGroups` | `server/routers/plaidRouter.ts` |
| 年度報稅 ZIP | ✅ 5 個 CSV + README | `server/services/yearEndExportService.ts` |
| 信託遞延 | ✅ 完整、env-gated `PLAID_TRUST_DEFERRAL_ENABLED` | `server/services/trustDeferralService.ts` |
| 大帳本 UI | ✅ 篩選/搜尋/抽屜/覆寫/收據 | `client/src/components/admin-v2/BankLedgerV2.tsx` |

## 關鍵發現 (Critical bug — 為什麼這件事最優先)

**分類詞彙表不一致 → Jeff 手動分類的交易會被「靜默」排除在損益與報稅之外。**

- AI agent 與 P&L 引擎共用同一套 **10 類別**：`income_booking, cogs_tour, cogs_other,
  expense_marketing, expense_software, expense_office, expense_travel, transfer, refund, other_review`。
- 但 `BankLedgerV2.tsx` 抽屜的「覆寫」下拉選單用的是**另一套舊詞彙表**（manual-entry 時代）：
  `tour_booking, visa_service, supplier_payment, rent, software, ...`。
- `transactionUpdate`（plaidRouter:803）與 `bulkCategorize`（:1412）只用 `z.string().max(64)`
  把字串原樣寫進 `jeffOverrideCategory`，**沒有任何映射或驗證**。
- 結果：Jeff 用下拉選單手動選的任何類別（如 `supplier_payment`），`bankPLService` 不認得 →
  既不算收入也不算支出 → **從 P&L 與 Schedule C 匯出中消失**。
- 附帶：agent 寫的 `income_booking` 在 UI 上顯示成醜的原始字串（i18n 只有舊 key）。

這個 bug 同時影響第 1、2、3 項，是所有正確性的地基，必須先修。

## 範圍 (Scope)

- M1 詞彙表統一（keystone bug fix）：UI 下拉 + 伺服器驗證 + 既有舊資料**唯讀稽核報告**（不自動改，遵守「不準猜」）。
- M2 Agent 知識庫：把 Jeff 確認過的對方/廠商/業主身分編成規則，先做確定性 pre-classifier，再注入 prompt。
- M3 批次分類 UI + 待審佇列（前端）。
- M4 P&L 報表 UI + 年度匯出按鈕外露。
- M5 信託合規報表 + 稽核匯出。

## 非目標 (Non-goals)

- 不重寫 `financialReportService.ts`（舊手動分錄系統），那不是銀行帳本的稅務真實來源。
- 不在這次拆 `BankLedgerV2.tsx`（已 1576 行、違反 300 行規範）——只做外科手術式修改，拆檔列為後續。
- 不自動 remap 舊詞彙表的歷史 override（financial data，必須 Jeff 確認後才動）。
- AI 不報價、不碰敏感金融/身分資料、不執行不可逆動作而未取得同意。

## 成功標準 (Success criteria)

- Jeff 在大帳本手選的任何類別都會正確進 P&L（下拉只剩 10 類別 + 排除）。
- 已知對方（業主本人、Jupiter Legend、WF 卡客人機票等）自動分類正確、不再灌水營收。
- 多選一次分類數十筆；「需審核」佇列一眼看完低信心交易。
- 一鍵下載年度報稅 ZIP；損益表分區清楚、owner capital 獨立顯示。
- 每模組過 `tsc --noEmit` + Vitest。
