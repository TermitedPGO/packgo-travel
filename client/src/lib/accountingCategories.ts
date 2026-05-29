/**
 * Single source of truth for the 10 accounting categories — CLIENT side.
 *
 * These keys MUST stay identical to the server's canonical list in
 * `server/agents/autonomous/accountingAgent.ts` (ACCOUNTING_CATEGORIES) and the
 * P&L buckets in `server/services/bankPLService.ts`. A Vitest
 * (`accountingCategories.test.ts`) asserts client ⇄ server parity to prevent
 * drift.
 *
 * Why this file exists (the M1 keystone bug): BankLedgerV2's override dropdown
 * used to offer an OLD manual-entry taxonomy (tour_booking / supplier_payment /
 * …) plus a free-text "custom" field. bankPLService doesn't recognise those, so
 * every manual override silently dropped out of P&L and the Schedule C tax
 * export. Forcing the dropdown + server validation onto these 10 keys closes
 * that hole.
 *
 * Pure constants — NO imports. Server-side tests can import this file directly
 * without dragging in client-only dependencies.
 */

export type AccountingCategoryKey =
  | "income_booking"
  | "cogs_tour"
  | "cogs_other"
  | "expense_marketing"
  | "expense_software"
  | "expense_office"
  | "expense_travel"
  | "transfer"
  | "refund"
  | "other_review";

export type CategoryGroup = "income" | "cogs" | "opex" | "other";

export interface CategoryConfig {
  key: AccountingCategoryKey;
  group: CategoryGroup;
  /** i18n key under `admin.bankLedgerTab` (e.g. "catIncomeBooking"). */
  i18nKey: string;
}

/**
 * Display order matters: this drives the override dropdown. Grouped income →
 * cost of sales → operating expenses → other (transfer/refund/needs-review).
 */
export const ACCOUNTING_CATEGORY_CONFIG: readonly CategoryConfig[] = [
  { key: "income_booking", group: "income", i18nKey: "catIncomeBooking" },
  { key: "cogs_tour", group: "cogs", i18nKey: "catCogsTour" },
  { key: "cogs_other", group: "cogs", i18nKey: "catCogsOther" },
  { key: "expense_marketing", group: "opex", i18nKey: "catExpenseMarketing" },
  { key: "expense_software", group: "opex", i18nKey: "catExpenseSoftware" },
  { key: "expense_office", group: "opex", i18nKey: "catExpenseOffice" },
  { key: "expense_travel", group: "opex", i18nKey: "catExpenseTravel" },
  { key: "transfer", group: "other", i18nKey: "catTransfer" },
  { key: "refund", group: "other", i18nKey: "catRefund" },
  { key: "other_review", group: "other", i18nKey: "catOtherReview" },
] as const;

export const ACCOUNTING_CATEGORY_KEYS: readonly AccountingCategoryKey[] =
  ACCOUNTING_CATEGORY_CONFIG.map((c) => c.key);

/** Group display order + group-label i18n key (under `admin.bankLedgerTab`). */
export const CATEGORY_GROUP_ORDER: readonly {
  group: CategoryGroup;
  i18nKey: string;
}[] = [
  { group: "income", i18nKey: "groupIncome" },
  { group: "cogs", i18nKey: "groupCogs" },
  { group: "opex", i18nKey: "groupOpex" },
  { group: "other", i18nKey: "groupOther" },
] as const;

const KEY_SET: ReadonlySet<string> = new Set<string>(ACCOUNTING_CATEGORY_KEYS);

/** True when `value` is one of the canonical 10 category keys. */
export function isAccountingCategory(
  value: string | null | undefined,
): value is AccountingCategoryKey {
  return !!value && KEY_SET.has(value);
}

/**
 * i18n key for a category, or null when `key` is not canonical (a legacy /
 * free-text override). Callers fall back to showing the raw string so Jeff
 * notices stragglers that predate M1.
 */
export function categoryI18nKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const found = ACCOUNTING_CATEGORY_CONFIG.find((c) => c.key === key);
  return found ? found.i18nKey : null;
}
