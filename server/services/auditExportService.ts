/**
 * Audit Export Service (M5, 2026-05-28).
 *
 * Produces the "exclusion audit" — the transactions that DON'T flow into the
 * P&L and therefore need a transparent paper trail for an accountant / IRS
 * review:
 *
 *   transfer      → owner capital / internal account moves. Excluded from
 *                   netProfit (Jeff:「我自己拿出 不代表公司賺」) but must be
 *                   auditable so an examiner sees WHY money moved without
 *                   touching income.
 *   other_review  → the agent couldn't classify it and it's pending Jeff's
 *                   review. Surfaced here so nothing silently disappears.
 *
 * Effective category = jeffOverrideCategory ?? agentCategory (Jeff wins).
 *
 * The fold + CSV serialization are pure (no DB, no React) so the invariant
 * "the exclusion list contains ONLY transfer + other_review" is unit-testable
 * — same pattern as bankPLService.foldBankPLRows.
 */

/** Categories that are intentionally excluded from the P&L. */
export const EXCLUSION_CATEGORIES = ["transfer", "other_review"] as const;
export type ExclusionCategory = (typeof EXCLUSION_CATEGORIES)[number];

/** Minimal row shape foldExclusionRows reads (subset of bankTransactions). */
export interface ExclusionRowLike {
  id?: number | null;
  date: string | Date | null;
  amount: string | number | null;
  merchantName?: string | null;
  description?: string | null;
  originalDescription?: string | null;
  counterparty?: string | null;
  counterpartyType?: string | null;
  purposeNote?: string | null;
  excludeReason?: string | null;
  agentCategory?: string | null;
  jeffOverrideCategory?: string | null;
  isPending?: number | null;
}

/** One row of the exclusion audit. */
export interface ExclusionRecord {
  id: number | null;
  date: string;
  /** Raw signed amount, Plaid convention: >0 outflow, <0 inflow. */
  amount: number;
  /** Human direction derived from sign. */
  direction: "inflow" | "outflow";
  category: ExclusionCategory;
  /** Where the category came from. */
  source: "jeff" | "agent";
  counterparty: string;
  description: string;
  note: string;
}

export interface ExclusionAuditResult {
  records: ExclusionRecord[];
  summary: {
    total: number;
    transferCount: number;
    transferTotal: number; // inflow-positive (owner capital convention)
    otherReviewCount: number;
    otherReviewTotal: number; // absolute sum
  };
}

function asDateStr(d: string | Date | null): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  // Already a YYYY-MM-DD (or ISO) string — take the date part.
  return String(d).slice(0, 10);
}

/**
 * Fold already-fetched rows into the exclusion audit. ONLY rows whose
 * effective category is `transfer` or `other_review` are included; everything
 * else (income, expense, refund, uncategorized, manually-excluded) is dropped.
 * Pending rows are skipped (not yet settled).
 */
export function foldExclusionRows(rows: ExclusionRowLike[]): ExclusionAuditResult {
  const records: ExclusionRecord[] = [];
  let transferCount = 0;
  let transferTotal = 0;
  let otherReviewCount = 0;
  let otherReviewTotal = 0;

  for (const r of rows) {
    if (r.isPending === 1) continue;

    const jeff = r.jeffOverrideCategory ?? null;
    const effective = (jeff ?? r.agentCategory ?? null) as string | null;
    if (effective !== "transfer" && effective !== "other_review") continue;

    const amt = parseFloat(r.amount as any) || 0;
    const counterparty =
      r.counterparty?.trim() ||
      r.merchantName?.trim() ||
      "";
    const description =
      r.originalDescription?.trim() ||
      r.description?.trim() ||
      "";
    const note = r.purposeNote?.trim() || r.excludeReason?.trim() || "";

    records.push({
      id: r.id ?? null,
      date: asDateStr(r.date),
      amount: amt,
      direction: amt < 0 ? "inflow" : "outflow",
      category: effective,
      source: jeff ? "jeff" : "agent",
      counterparty,
      description,
      note,
    });

    if (effective === "transfer") {
      transferCount++;
      // Inflow-positive (owner-capital convention, matches bankPLService).
      transferTotal += -amt;
    } else {
      otherReviewCount++;
      otherReviewTotal += Math.abs(amt);
    }
  }

  return {
    records,
    summary: {
      total: records.length,
      transferCount,
      transferTotal,
      otherReviewCount,
      otherReviewTotal,
    },
  };
}

/** RFC-4180 cell escaping: wrap in quotes if it contains comma/quote/newline. */
function csvCell(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADERS = [
  "Date",
  "Amount",
  "Direction",
  "Category",
  "Source",
  "Counterparty",
  "Description",
  "Note",
] as const;

/**
 * Serialize exclusion records to a CSV string (English headers — this lands in
 * front of an accountant alongside the Schedule-C export). Amount is the raw
 * signed Plaid value so the sign convention is auditable.
 */
export function toExclusionCsv(records: ExclusionRecord[]): string {
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const r of records) {
    lines.push(
      [
        csvCell(r.date),
        csvCell(r.amount.toFixed(2)),
        csvCell(r.direction),
        csvCell(r.category),
        csvCell(r.source),
        csvCell(r.counterparty),
        csvCell(r.description),
        csvCell(r.note),
      ].join(",")
    );
  }
  // Trailing newline so the file ends cleanly.
  return lines.join("\n") + "\n";
}
