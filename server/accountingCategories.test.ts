/**
 * M1 keystone guard — accounting category taxonomy parity.
 *
 * The bug this prevents: the client override dropdown, the AI agent, the P&L
 * engine, and the tax export must all speak the SAME 11 category keys (was 10
 * until F1 塊C 2026-07-08 added stripe_payout for double-count protection).
 * When they drift, manual overrides silently fall out of P&L + Schedule C.
 * These tests fail loudly the moment any of the four lists diverges.
 */
import { describe, it, expect } from "vitest";
import {
  ACCOUNTING_CATEGORY_CONFIG,
  ACCOUNTING_CATEGORY_KEYS,
  CATEGORY_GROUP_ORDER,
  categoryI18nKey,
  isAccountingCategory,
} from "@/lib/accountingCategories";
import { ACCOUNTING_CATEGORIES } from "./agents/autonomous/accountingAgent";
import { SCHEDULE_C_MAP } from "./services/bankPLService";
import { zhTW } from "@/i18n/zh-TW";
import { en } from "@/i18n/en";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("accounting category parity", () => {
  it("client config keys === server ACCOUNTING_CATEGORIES", () => {
    expect(sorted(ACCOUNTING_CATEGORY_KEYS)).toEqual(
      sorted(ACCOUNTING_CATEGORIES as unknown as string[]),
    );
  });

  it("every category has a Schedule C mapping (P&L can bucket it)", () => {
    expect(sorted(Object.keys(SCHEDULE_C_MAP))).toEqual(
      sorted(ACCOUNTING_CATEGORY_KEYS),
    );
  });

  it("exactly 11 categories, no duplicates (F1 塊C 2026-07-08 added stripe_payout)", () => {
    expect(ACCOUNTING_CATEGORY_KEYS.length).toBe(11);
    expect(new Set(ACCOUNTING_CATEGORY_KEYS).size).toBe(11);
  });

  it("every config row belongs to a declared group", () => {
    const groups = new Set(CATEGORY_GROUP_ORDER.map((g) => g.group));
    for (const c of ACCOUNTING_CATEGORY_CONFIG) {
      expect(groups.has(c.group)).toBe(true);
    }
  });
});

describe("category i18n keys exist in both locales", () => {
  const zhBank = (zhTW as any).admin.bankLedgerTab as Record<string, unknown>;
  const enBank = (en as any).admin.bankLedgerTab as Record<string, unknown>;

  it("zh-TW + en define every category label", () => {
    for (const c of ACCOUNTING_CATEGORY_CONFIG) {
      expect(typeof zhBank[c.i18nKey]).toBe("string");
      expect(typeof enBank[c.i18nKey]).toBe("string");
    }
  });

  it("zh-TW + en define every group label", () => {
    for (const g of CATEGORY_GROUP_ORDER) {
      expect(typeof zhBank[g.i18nKey]).toBe("string");
      expect(typeof enBank[g.i18nKey]).toBe("string");
    }
  });
});

describe("helpers", () => {
  it("isAccountingCategory accepts canonical, rejects legacy/empty/null", () => {
    expect(isAccountingCategory("income_booking")).toBe(true);
    expect(isAccountingCategory("cogs_tour")).toBe(true);
    expect(isAccountingCategory("supplier_payment")).toBe(false); // old taxonomy
    expect(isAccountingCategory("__custom__")).toBe(false);
    expect(isAccountingCategory("")).toBe(false);
    expect(isAccountingCategory(null)).toBe(false);
    expect(isAccountingCategory(undefined)).toBe(false);
  });

  it("categoryI18nKey returns key for canonical, null otherwise", () => {
    expect(categoryI18nKey("income_booking")).toBe("catIncomeBooking");
    expect(categoryI18nKey("transfer")).toBe("catTransfer");
    expect(categoryI18nKey("supplier_payment")).toBeNull();
    expect(categoryI18nKey(null)).toBeNull();
  });
});
