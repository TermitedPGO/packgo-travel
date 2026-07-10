/**
 * claimCategories —— 認領對話框「內部分類」下拉的選項(F3 塊B)。
 *
 * 鎖 SCHEDULE_C_MAP 枚舉(server/services/bankPLService.ts),禁自由文字
 * (dispatch-f3 塊B#2)。client 不能 import server 檔(會把 server code 打進
 * bundle),故此處鏡像一份;claimCategories.test.ts 在 node 環境同時 import
 * 兩邊,斷言兩份枚舉完全一致 —— server 加減分類時測試會紅,鏡像不會默默漂移。
 */

export const CLAIM_CATEGORIES = [
  "cogs_tour",
  "cogs_other",
  "expense_marketing",
  "expense_software",
  "expense_office",
  "expense_travel",
  "income_booking",
  "refund",
  "transfer",
  "other_review",
  "stripe_payout",
  "square_payout",
] as const;

export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

/** 分類 → i18n key(label 走 t(),JSX 零硬編碼中文)。 */
export const CLAIM_CATEGORY_LABEL_KEY: Record<ClaimCategory, string> = {
  cogs_tour: "financeCockpit.claim.catCogsTour",
  cogs_other: "financeCockpit.claim.catCogsOther",
  expense_marketing: "financeCockpit.claim.catExpenseMarketing",
  expense_software: "financeCockpit.claim.catExpenseSoftware",
  expense_office: "financeCockpit.claim.catExpenseOffice",
  expense_travel: "financeCockpit.claim.catExpenseTravel",
  income_booking: "financeCockpit.claim.catIncomeBooking",
  refund: "financeCockpit.claim.catRefund",
  transfer: "financeCockpit.claim.catTransfer",
  other_review: "financeCockpit.claim.catOtherReview",
  stripe_payout: "financeCockpit.claim.catStripePayout",
  square_payout: "financeCockpit.claim.catSquarePayout",
};
