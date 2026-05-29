/**
 * BankLedgerV2 filter + selection logic — M3 (記帳系統強化, 2026-05-28).
 *
 * Pure functions only (no React, no tRPC, no DOM). Lives apart from the
 * 1,500-line BankLedgerV2.tsx so the "needs review" queue predicate and the
 * multi-select Set maths are unit-testable in isolation.
 *
 * Sign convention (Plaid): amount > 0 = outflow (expense), amount < 0 = inflow.
 * effective category = jeffOverrideCategory ?? agentCategory (Jeff's hand
 * override always wins; matches bankPLService + accountingAgent).
 */

/** Confidence below this (and not yet hand-confirmed) → lands in 需審核. */
export const NEEDS_REVIEW_CONFIDENCE = 60;

/** Minimal structural shape — the real TxRow has far more fields. */
export interface LedgerTxLike {
  id: number;
  amount?: string | number | null;
  agentCategory?: string | null;
  agentConfidence?: number | null;
  jeffOverrideCategory?: string | null;
  excludeFromAccounting?: number | null;
}

export type LedgerFilterTab =
  | "all"
  | "uncategorized"
  | "categorized"
  | "needsReview"
  | "excluded";

export function txToNumber(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? n : 0;
}

export function txEffectiveCategory(tx: LedgerTxLike): string | null {
  return tx.jeffOverrideCategory ?? tx.agentCategory ?? null;
}

export function txIsExcluded(tx: LedgerTxLike): boolean {
  return (tx.excludeFromAccounting ?? 0) === 1;
}

export function txIsUncategorized(tx: LedgerTxLike): boolean {
  return !tx.jeffOverrideCategory && !tx.agentCategory;
}

/**
 * 需審核 (needs Jeff's eyes) queue predicate.
 *
 * A row needs review when it is NOT excluded, Jeff has NOT yet hand-confirmed
 * a category (jeffOverrideCategory wins → resolved), AND any of:
 *   - it is still uncategorized, OR
 *   - the agent punted to `other_review`, OR
 *   - the agent's confidence is below the threshold (<60).
 *
 * A Jeff override always clears the row out of the queue — that's the whole
 * point of "confirm". This honours 不準猜: low-confidence AI guesses surface
 * for a human instead of silently entering the books.
 */
export function txNeedsReview(
  tx: LedgerTxLike,
  threshold: number = NEEDS_REVIEW_CONFIDENCE,
): boolean {
  if (txIsExcluded(tx)) return false;
  if (tx.jeffOverrideCategory) return false; // Jeff already confirmed
  if (txIsUncategorized(tx)) return true;
  if (tx.agentCategory === "other_review") return true;
  if (typeof tx.agentConfidence === "number" && tx.agentConfidence < threshold) {
    return true;
  }
  return false;
}

/** Does a row belong in the given filter tab? */
export function matchesTab(tx: LedgerTxLike, tab: LedgerFilterTab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "uncategorized":
      return txIsUncategorized(tx) && !txIsExcluded(tx);
    case "categorized":
      return !txIsUncategorized(tx) && !txIsExcluded(tx);
    case "needsReview":
      return txNeedsReview(tx);
    case "excluded":
      return txIsExcluded(tx);
    default:
      return true;
  }
}

export interface LedgerCounts {
  all: number;
  uncategorized: number;
  categorized: number;
  needsReview: number;
  excluded: number;
}

export function computeLedgerCounts(items: LedgerTxLike[]): LedgerCounts {
  return {
    all: items.length,
    uncategorized: items.filter((tx) => matchesTab(tx, "uncategorized")).length,
    categorized: items.filter((tx) => matchesTab(tx, "categorized")).length,
    needsReview: items.filter((tx) => matchesTab(tx, "needsReview")).length,
    excluded: items.filter((tx) => matchesTab(tx, "excluded")).length,
  };
}

// ── Multi-select helpers (immutable: never mutate the input Set) ──────────

/** Toggle one id in/out of the selection, returning a new Set. */
export function toggleIdInSet(set: Set<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** True when every currently-visible row id is selected (and there is ≥1). */
export function isAllSelected(
  visibleIds: number[],
  selected: Set<number>,
): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
}

/** True when some — but not all — visible rows are selected (indeterminate). */
export function isSomeSelected(
  visibleIds: number[],
  selected: Set<number>,
): boolean {
  const hit = visibleIds.filter((id) => selected.has(id)).length;
  return hit > 0 && hit < visibleIds.length;
}

/**
 * Select-all toggle over the visible rows: if all visible are already
 * selected, remove them; otherwise add them all. Returns a new Set and
 * preserves any selected ids that aren't currently visible only when adding.
 * (We clear selection on filter change in the component, so in practice the
 * Set holds visible ids — but staying immutable keeps this testable.)
 */
export function toggleSelectAll(
  visibleIds: number[],
  selected: Set<number>,
): Set<number> {
  if (isAllSelected(visibleIds, selected)) {
    const next = new Set(selected);
    for (const id of visibleIds) next.delete(id);
    return next;
  }
  const next = new Set(selected);
  for (const id of visibleIds) next.add(id);
  return next;
}
