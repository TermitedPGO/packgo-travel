/**
 * Unit tests for BankLedgerV2's pure filter + multi-select logic (M3).
 *
 * Two things we must never get wrong here are financial red-lines:
 *   1. A Jeff hand-override always clears a row OUT of 需審核 (he confirmed it).
 *   2. Excluded rows never count anywhere except 已排除.
 * The select-all maths must stay immutable (never mutate the input Set) so
 * React state updates are sound.
 */
import { describe, it, expect } from "vitest";
import {
  NEEDS_REVIEW_CONFIDENCE,
  txToNumber,
  txEffectiveCategory,
  txIsExcluded,
  txIsUncategorized,
  txNeedsReview,
  matchesTab,
  computeLedgerCounts,
  toggleIdInSet,
  isAllSelected,
  isSomeSelected,
  toggleSelectAll,
  type LedgerTxLike,
} from "./bankLedgerFilters";

// ── small builder so each case reads as just its meaningful fields ──────────
function tx(over: Partial<LedgerTxLike> = {}): LedgerTxLike {
  return { id: 1, ...over };
}

describe("txToNumber", () => {
  it("parses decimal strings (Plaid amount is a string)", () => {
    expect(txToNumber("12.34")).toBe(12.34);
    expect(txToNumber("-5")).toBe(-5);
  });
  it("treats null/undefined/garbage as 0", () => {
    expect(txToNumber(null)).toBe(0);
    expect(txToNumber(undefined)).toBe(0);
    expect(txToNumber("abc")).toBe(0);
  });
});

describe("txEffectiveCategory", () => {
  it("Jeff override wins over agent category", () => {
    expect(
      txEffectiveCategory(tx({ agentCategory: "cogs_tour", jeffOverrideCategory: "transfer" })),
    ).toBe("transfer");
  });
  it("falls back to agent category, then null", () => {
    expect(txEffectiveCategory(tx({ agentCategory: "income_booking" }))).toBe("income_booking");
    expect(txEffectiveCategory(tx())).toBeNull();
  });
});

describe("txIsExcluded / txIsUncategorized", () => {
  it("excluded only when flag === 1", () => {
    expect(txIsExcluded(tx({ excludeFromAccounting: 1 }))).toBe(true);
    expect(txIsExcluded(tx({ excludeFromAccounting: 0 }))).toBe(false);
    expect(txIsExcluded(tx())).toBe(false);
  });
  it("uncategorized only when neither override nor agent category", () => {
    expect(txIsUncategorized(tx())).toBe(true);
    expect(txIsUncategorized(tx({ agentCategory: "cogs_tour" }))).toBe(false);
    expect(txIsUncategorized(tx({ jeffOverrideCategory: "transfer" }))).toBe(false);
  });
});

describe("txNeedsReview — 需審核 queue predicate", () => {
  it("uncategorized rows need review", () => {
    expect(txNeedsReview(tx())).toBe(true);
  });

  it("agent punt (other_review) needs review", () => {
    expect(txNeedsReview(tx({ agentCategory: "other_review", agentConfidence: 99 }))).toBe(true);
  });

  it("low agent confidence (<60) needs review", () => {
    expect(txNeedsReview(tx({ agentCategory: "cogs_tour", agentConfidence: 59 }))).toBe(true);
  });

  it("high agent confidence (>=60) does NOT need review", () => {
    expect(txNeedsReview(tx({ agentCategory: "cogs_tour", agentConfidence: 60 }))).toBe(false);
    expect(txNeedsReview(tx({ agentCategory: "cogs_tour", agentConfidence: 92 }))).toBe(false);
  });

  it("RED-LINE: a Jeff override always clears the row out of the queue", () => {
    // Even an other_review agentCategory with confidence 0 is resolved once
    // Jeff has hand-confirmed a category.
    expect(
      txNeedsReview(
        tx({ jeffOverrideCategory: "transfer", agentCategory: "other_review", agentConfidence: 0 }),
      ),
    ).toBe(false);
  });

  it("RED-LINE: excluded rows never need review", () => {
    expect(
      txNeedsReview(tx({ excludeFromAccounting: 1, agentConfidence: 10 })),
    ).toBe(false);
  });

  it("threshold is configurable but defaults to 60", () => {
    expect(NEEDS_REVIEW_CONFIDENCE).toBe(60);
    // raise the bar to 80 → a conf-70 row now needs review
    expect(txNeedsReview(tx({ agentCategory: "cogs_tour", agentConfidence: 70 }), 80)).toBe(true);
  });
});

describe("matchesTab + computeLedgerCounts", () => {
  const items: LedgerTxLike[] = [
    tx({ id: 1 }), // uncategorized → needsReview
    tx({ id: 2, agentCategory: "cogs_tour", agentConfidence: 95 }), // categorized, resolved
    tx({ id: 3, agentCategory: "cogs_tour", agentConfidence: 30 }), // categorized BUT needsReview
    tx({ id: 4, jeffOverrideCategory: "transfer" }), // categorized, resolved (Jeff)
    tx({ id: 5, excludeFromAccounting: 1 }), // excluded
  ];

  it("all tab matches everything", () => {
    expect(items.filter((t) => matchesTab(t, "all"))).toHaveLength(5);
  });

  it("uncategorized excludes excluded rows", () => {
    const ids = items.filter((t) => matchesTab(t, "uncategorized")).map((t) => t.id);
    expect(ids).toEqual([1]);
  });

  it("categorized counts agent OR Jeff categories, minus excluded", () => {
    const ids = items.filter((t) => matchesTab(t, "categorized")).map((t) => t.id);
    expect(ids).toEqual([2, 3, 4]);
  });

  it("needsReview catches uncategorized + low-confidence, not the resolved ones", () => {
    const ids = items.filter((t) => matchesTab(t, "needsReview")).map((t) => t.id);
    expect(ids).toEqual([1, 3]);
  });

  it("excluded isolates the excluded row", () => {
    const ids = items.filter((t) => matchesTab(t, "excluded")).map((t) => t.id);
    expect(ids).toEqual([5]);
  });

  it("computeLedgerCounts agrees with the per-tab filters", () => {
    expect(computeLedgerCounts(items)).toEqual({
      all: 5,
      uncategorized: 1,
      categorized: 3,
      needsReview: 2,
      excluded: 1,
    });
  });
});

describe("multi-select helpers (immutability + select-all maths)", () => {
  it("toggleIdInSet adds then removes, never mutating the input", () => {
    const a = new Set<number>([1]);
    const b = toggleIdInSet(a, 2);
    expect([...b].sort()).toEqual([1, 2]);
    expect([...a]).toEqual([1]); // original untouched
    const c = toggleIdInSet(b, 1);
    expect([...c]).toEqual([2]);
  });

  it("isAllSelected requires every visible id and at least one", () => {
    expect(isAllSelected([1, 2], new Set([1, 2]))).toBe(true);
    expect(isAllSelected([1, 2], new Set([1]))).toBe(false);
    expect(isAllSelected([], new Set())).toBe(false); // empty page is not "all selected"
  });

  it("isSomeSelected is the indeterminate (partial) state only", () => {
    expect(isSomeSelected([1, 2, 3], new Set([2]))).toBe(true);
    expect(isSomeSelected([1, 2], new Set([1, 2]))).toBe(false); // all → not "some"
    expect(isSomeSelected([1, 2], new Set())).toBe(false); // none → not "some"
  });

  it("toggleSelectAll adds all visible when not all selected", () => {
    const next = toggleSelectAll([1, 2, 3], new Set([1]));
    expect([...next].sort()).toEqual([1, 2, 3]);
  });

  it("toggleSelectAll removes the visible ids when all already selected", () => {
    const next = toggleSelectAll([1, 2], new Set([1, 2]));
    expect([...next]).toEqual([]);
  });

  it("toggleSelectAll does not mutate the input set", () => {
    const sel = new Set([1]);
    toggleSelectAll([1, 2, 3], sel);
    expect([...sel]).toEqual([1]);
  });
});
