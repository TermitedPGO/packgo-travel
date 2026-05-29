# M1 — 分類詞彙表統一 (keystone bug fix) ✅

harness #68 · design.md §M1 · 完成 2026-05-28

## 為什麼最優先
Jeff 手選的類別（舊詞彙表）P&L 不認得 → 從損益/報稅靜默消失。同時影響 #1/#2/#3 正確性，是地基。

## Checklist

### A. 共用設定模組
- [x] 建 `client/src/lib/accountingCategories.ts`
  - [x] `AccountingCategoryKey` union（10 個，字面對齊後端 accountingAgent.ts）
  - [x] `CategoryGroup` = income | cogs | opex | other
  - [x] `ACCOUNTING_CATEGORY_CONFIG: CategoryConfig[]`（key + group + i18nKey）
  - [x] `ACCOUNTING_CATEGORY_KEYS` 匯出（純常數無 import，server test 可直接 import）
  - [x] bonus: `isAccountingCategory()` + `categoryI18nKey()` helpers

### B. i18n
- [x] zh-TW.ts 加 10 個 cat* key + 4 group* label（flat 在 admin.bankLedgerTab 下）
- [x] en.ts 同步同樣 key
- [x] Vitest 斷言 10 cat + 4 group key 在 zh-TW + en 都存在

### C. BankLedgerV2.tsx
- [x] 刪 `INCOME_CATEGORY_KEYS` / `EXPENSE_CATEGORY_KEYS` / `CUSTOM_VALUE` 自由文字
- [x] 下拉改 map ACCOUNTING_CATEGORY_CONFIG，依 group 分 SelectGroup
- [x] `categoryLabel()` 改吃新 i18nKey（agent 的 income_booking 正常顯示）
- [x] exclude 旗標路徑不動
- [x] grep 確認零殘留 INCOME_CATEGORY_KEYS/EXPENSE_CATEGORY_KEYS/CUSTOM_VALUE/customCategory

### D. Server 驗證 (plaidRouter.ts)
- [x] `CATEGORY_ENUM = z.enum(ACCOUNTING_CATEGORIES)`（直接衍生自 accountingAgent，真單一來源）
- [x] transactionUpdate.category → `z.union([CATEGORY_ENUM, z.literal("")]).optional()`（"" 清除 override）
- [x] bulkCategorize.category → `z.union([CATEGORY_ENUM, z.literal("exclude")])`

### E. 歷史唯讀稽核（不自動改）
- [x] query `accountingLegacyOverrideAudit`：列出 jeffOverrideCategory 不在 10 類別的 row
- [x] 只對明確 1:1 給 suggestedNew（LEGACY_CATEGORY_SUGGESTION），ambiguous（salary/tax_payment/other_expense）留空；**不寫入**

### 驗收
- [x] `tsc --noEmit` 0 error（NODE_OPTIONS=6144）
- [x] Vitest 8/8：前後端 key 集合相等 + SCHEDULE_C_MAP 對齊 + i18n key 存在 + enum helper 擋非法字串
- [ ] 手測：下拉只剩 10 類別、agent 類別正常顯示中文 → 併入 M3 self-test（M3 也動 BankLedgerV2，一次測）
