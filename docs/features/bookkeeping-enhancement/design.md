# 記帳系統強化 — Design (Stage 2)

> Vibe Coding §9。本文件是「怎麼做 + 模組劃分 + 依賴」。需求在 proposal.md，逐模組 checklist 在 tasks/。

## 設計總則

1. **單一真實詞彙表 (single source of truth)**：10 類別只在一處定義，前後端共用。
2. **不準猜**：未確認的歷史資料只做唯讀稽核報告，不自動 remap；未知對方的進帳一律 `other_review`，不腦補成收入。
3. **可逆優先**：M2 知識庫用 version-controlled TS 常數（非 DB table），無 migration、易測、易回退。
4. **外科手術**：不拆 `BankLedgerV2.tsx`（1576 行）、不重寫 `financialReportService.ts`。只動需要動的。
5. **每模組獨立過 `tsc --noEmit` + Vitest** 才算完成。

---

## M1 — 分類詞彙表統一 (keystone)

### 問題回顧
- AI agent + `bankPLService` 共用 10 類別。
- `BankLedgerV2` 覆寫下拉用**舊的 manual-entry 詞彙表**（`tour_booking`/`supplier_payment`/…）。
- `transactionUpdate` / `bulkCategorize` 用 `z.string().max(64)` 把字串原樣寫進 `jeffOverrideCategory`，**零驗證**。
- 結果：Jeff 手選的類別 P&L 不認得 → 從損益與報稅靜默消失。

### 解法
**A. 新增共用設定模組** `client/src/lib/accountingCategories.ts`
```ts
export type AccountingCategoryKey =
  | "income_booking" | "cogs_tour" | "cogs_other"
  | "expense_marketing" | "expense_software" | "expense_office"
  | "expense_travel" | "transfer" | "refund" | "other_review";

export type CategoryGroup = "income" | "cogs" | "opex" | "other";

export interface CategoryConfig {
  key: AccountingCategoryKey;
  group: CategoryGroup;
  i18nKey: string; // e.g. "catIncomeBooking" under admin.bankLedgerTab
}

export const ACCOUNTING_CATEGORY_CONFIG: CategoryConfig[] = [ … 10 entries … ];
export const ACCOUNTING_CATEGORY_KEYS: AccountingCategoryKey[] = [ …10… ];
```
- group 用於下拉的 optgroup 分區（收入 / 成本 / 營業費用 / 其他）。
- 與後端 `accountingAgent.ts` 的 `ACCOUNTING_CATEGORIES` 字面一致（10 個 key 完全相同）。後端已有型別，前端這份是 UI 對應；用一支 Vitest 斷言兩邊 key 集合相等，避免日後漂移。

**B. i18n key**（flat，掛在 `admin.bankLedgerTab` 下；zh-TW + en 同步）
- `catIncomeBooking` / `catCogsTour` / `catCogsOther` / `catExpenseMarketing` / `catExpenseSoftware` / `catExpenseOffice` / `catExpenseTravel` / `catTransfer` / `catRefund` / `catOtherReview`
- group label：`groupIncome`（已有「收入」可複用）、`groupCogs`、`groupOpex`、`groupOther`

**C. 改 `BankLedgerV2.tsx`**
- 刪除 `INCOME_CATEGORY_KEYS` / `EXPENSE_CATEGORY_KEYS` 兩個舊陣列與 `CUSTOM_VALUE` 自訂自由文字路徑。
- 下拉改 map `ACCOUNTING_CATEGORY_CONFIG`，依 group 分 optgroup。
- `categoryLabel()` 改吃新 i18nKey → agent 寫的 `income_booking` 正常顯示「訂單收入」而非原始字串。
- 排除 (exclude) 維持既有 `isExcluded` 旗標路徑，不混進 category enum 顯示。

**D. 伺服器驗證**（`plaidRouter.ts`）
- 定義 `const CATEGORY_ENUM = z.enum([...10 keys])`。
- `transactionUpdate.category`：`CATEGORY_ENUM.optional()`。
- `bulkCategorize.category`：`z.union([CATEGORY_ENUM, z.literal("exclude")])`（exclude 仍是合法批次動作）。
- 非法字串 → tRPC 直接擋下，不再寫進 DB。

**E. 歷史舊資料唯讀稽核**（不自動改）
- 新增 query `accountingLegacyOverrideAudit`：掃 `jeffOverrideCategory` 不在 10 類別內的 row，回傳 {id, date, amount, description, legacyCategory, suggestedNew?}。
- suggestedNew 只給「明確 1:1」的對應提示（如 `software → expense_software`），其餘留空待 Jeff 決定。**不寫入任何東西。**

### 風險
- 刪自由文字後，少數靠自訂類別的舊 row 會落在稽核報告 → 正是要 Jeff 看到的。
- i18n 漏 key → UI 顯示 key 名；用 Vitest 斷言 10 個 key 在 zh-TW/en 都存在。

---

## M2 — Agent 知識庫 + 業主身分

### 解法
**新增** `server/agents/autonomous/accountingKnowledge.ts`（version-controlled 常數 + 純函式）
```ts
// 只編「Jeff 已確認」的規則。未確認 → 不放。
export const OWNER_IDENTITIES = ["CHUN FU HSIEH", "謝俊甫", "JUN FU HSIEH", ...]; // 業主本人
export const KNOWN_OUTFLOW_VENDORS = [
  { match: ["jupiter legend"], category: "cogs_tour", note: "簽證/巴士 vendor" },
  { match: ["ann"], category: "cogs_tour", note: "中國簽證 vendor" },
  …
];
export const MEMO_HINTS = [ // medium-confidence，只當提示
  { match: ["visa", "china visa", "chinavisa"], category: "income_booking" }, // 客人付簽證服務費
  …
];

export interface PreClassifyResult {
  category: AccountingCategoryKey | null;
  confidence: number;        // 0-100
  reason: string;
  source: "owner" | "vendor" | "memo" | null;
}
export function preClassify(input): PreClassifyResult { … }
```

### 排序（優先級，重要）
1. **業主身分最優先**：payer/payee 命中 OWNER_IDENTITIES → `transfer`（自己拿錢進出），confidence 95，覆蓋一切 memo。對應 Jeff：「我自己拿出 那不代表公司賺」。
2. **已知 outflow 廠商** → `cogs_tour`/指定類別，confidence 90。
3. **memo 關鍵字** → medium hint，confidence 60-75（仍會進待審佇列讓 Jeff 確認）。
4. **未知對方的進帳（無記名存款 / 無 memo）** → `null`（不猜），交給 LLM；LLM 若也不確定 → `other_review`。

### 接線
- `accountingAgentService.classifyOne`：先跑 `preClassify`。
  - 命中且 confidence ≥ 90 → 直接用，**省一次 LLM 呼叫**（省錢）。
  - 命中但 < 90 → 把 hint 注入 prompt，仍讓 LLM 定奪。
  - 未命中 → 現狀（純 LLM）。
- `accountingAgent.buildSystem()`：把 OWNER_IDENTITIES + KNOWN_OUTFLOW_VENDORS 摘要注入 system prompt（讓 LLM 也知道），但**動態值要放 prompt 尾端**避免破壞 Anthropic prompt cache（見 task #61 教訓）。

### 風險
- 業主名字大小寫/拼法變體 → match 用 lowercase + trim + 包含比對。
- WF 卡客人機票（cogs_tour）：Jeff 說「Wells Fargo 都是幫客人訂機票」→ 編進 KNOWN rules，但這是**卡片消費**不是 Zelle，要在 card 來源判斷。

---

## M3 — 批次分類 UI + 待審佇列（前端）

### 解法（`BankLedgerV2.tsx` 外科手術）
- **多選**：row 加 checkbox + 全選；選取狀態存 component state（Set<id>）。
- **批次列**：選取 > 0 時浮出一條 bar：類別下拉（複用 M1 設定）+「套用到 N 筆」按鈕 → 呼叫既有 `bulkCategorize`。動作前 confirm（financial，需明確）。
- **待審佇列**：新增「需審核」tab/filter — 條件 = `agentCategory === 'other_review'` OR `agentConfidence < 60` OR （effective 仍未分類）。複用既有 `transactionsList`（加 filter 參數或前端篩）。
- 不新增後端：`bulkCategorize` 已存在且 M1 已補 enum 驗證。

### 風險
- 大量選取一次送 → `bulkCategorize` 已是單一 audit log，OK。
- 多選 state 與既有篩選/分頁互動 → 切頁清空選取，避免誤套。

---

## M4 — P&L 報表 UI + 年度匯出按鈕

### 解法（純前端外露既有後端）
- 後端 `profitLossReport` / `profitLossTrend` / `financeKpi` / `yearEndExport` 都已存在。
- FinanceLanding（或 admin-v2 finance 區）加：
  - **年度/月度切換** + P&L 分區顯示：營收 / COGS / 毛利 / OpEx / 淨利 / 退款，**owner capital (transfer) 獨立顯示且不計入**。
  - **「下載年度報稅 ZIP」按鈕** → 呼叫 `yearEndExport({year})`，回 R2 URL → 觸發下載（下載需 Jeff 同意的既有規則：此為 Jeff 主動點擊，視為同意）。
- trust deferred 已在 KPI 扣除並獨立 tile（task #41 已做），確認沿用。

### 風險
- ZIP 由 server 產生上傳 R2 再給 URL，非瀏覽器端組檔 → 無敏感資料經 URL param。

---

## M5 — 信託合規報表 + 稽核匯出

### 解法
- 後端 `trustDeferralService.ts` 完整、`trustReconciliation`/`trustDeferredList` query 已存在；`yearEndExportService` 已含 `trust_account_reconciliation.csv`。
- 確認 `PLAID_TRUST_DEFERRAL_ENABLED` 狀態；若關閉，UI 顯示「未啟用」而非報錯。
- **報表 UI**：列出 outstanding trust（未認列的客人訂金）、已認列、本期變動。
- **稽核匯出**：排除清單（transfer + other_review 明細）+ 轉帳明細，當稽核軌跡。可複用 `yearEndExport` 的 CSV 或加一支輕量 export query。

### 風險
- env flag off 時 trust 數字為 0 → UI 要明講「信託遞延未啟用」，不要讓 Jeff 以為沒有客人訂金。

---

## 模組依賴

```
M1 (詞彙表統一) ─┬─> M2 (知識庫，用同一份 10 類別)
                 ├─> M3 (批次 UI，用同一下拉)
                 └─> M5 (稽核匯出，排除類別一致)
M4 (P&L UI) 可與 M2/M3 並行（只外露既有後端），但建議 M1 後做以免顯示舊類別
```

順序：**M1 → M2 → M3 → M4 → M5**。
