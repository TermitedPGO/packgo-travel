/**
 * pendingClaimCategoryOptions —— PendingClaimsTab「內部分類」下拉選項
 * (F2 塊D 回令 #3,2026-07-10:從 PendingClaimsTab.tsx 抽出成純模組,
 * 讓 parity 守門(accountingCategories.test.ts)能在 node 環境 import,
 * 不拖 React/tRPC 依賴 —— 三客面鏡像(ClaimDialog/BankLedger/本表)全數
 * 納入守門,server 枚舉變動時三面同時紅)。
 *
 * 注意:這是刻意的「常用子集」不是全枚舉 —— 待認領頁只提供最常見的內部
 * 分類快捷鍵,完整 12 枚舉在駕駛艙 ClaimDialog。守門斷言:子集 ⊆ server
 * SCHEDULE_C_MAP 枚舉(值永遠合法),不斷言等於。
 *
 * 純常數,零 import(同 claimCategories.ts 慣例)。
 */

export const PENDING_CLAIM_CATEGORY_OPTIONS = [
  { value: "transfer", labelKey: "pendingClaimsTab.categoryOwnerTransfer" },
  { value: "stripe_payout", labelKey: "pendingClaimsTab.categoryStripePayout" },
  { value: "square_payout", labelKey: "pendingClaimsTab.categorySquarePayout" },
  { value: "other_review", labelKey: "pendingClaimsTab.categoryOther" },
] as const;

export type PendingClaimCategoryValue =
  (typeof PENDING_CLAIM_CATEGORY_OPTIONS)[number]["value"];
