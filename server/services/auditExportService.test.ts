/**
 * Unit tests for foldExclusionRows + toExclusionCsv — the M5 exclusion audit
 * core (2026-05-28).
 *
 * The red-line under test: the exclusion list contains ONLY transactions whose
 * effective category (jeffOverride ?? agent) is `transfer` or `other_review`.
 * Nothing that flows into the P&L (income / expense / refund) and nothing
 * uncategorized may leak into the audit — otherwise an accountant reading it
 * would double-count money that's already in the Schedule-C export.
 *
 * Plaid sign convention: amount > 0 = outflow, amount < 0 = inflow.
 */
import { describe, it, expect } from "vitest";
import {
  foldExclusionRows,
  toExclusionCsv,
  type ExclusionRowLike,
} from "./auditExportService";

describe("foldExclusionRows — only transfer + other_review", () => {
  const rows: ExclusionRowLike[] = [
    { id: 1, date: "2026-01-05", amount: "-5000", jeffOverrideCategory: "transfer" }, // owner capital IN
    { id: 2, date: "2026-01-06", amount: "2000", agentCategory: "transfer" }, // owner draw OUT
    { id: 3, date: "2026-01-07", amount: "-77", agentCategory: "other_review" }, // needs review
    { id: 4, date: "2026-01-08", amount: "-1000", agentCategory: "income_booking" }, // EXCLUDED from audit (income)
    { id: 5, date: "2026-01-09", amount: "300", agentCategory: "cogs_tour" }, // EXCLUDED (expense)
    { id: 6, date: "2026-01-10", amount: "200", agentCategory: "refund" }, // EXCLUDED (refund)
    { id: 7, date: "2026-01-11", amount: "42" }, // EXCLUDED (uncategorized, not other_review)
    { id: 8, date: "2026-01-12", amount: "999", agentCategory: "transfer", isPending: 1 }, // EXCLUDED (pending)
  ];

  it("RED-LINE: result contains only transfer + other_review categories", () => {
    const { records } = foldExclusionRows(rows);
    expect(records.length).toBe(3);
    for (const r of records) {
      expect(["transfer", "other_review"]).toContain(r.category);
    }
    // The specific rows that survived
    expect(records.map((r) => r.id).sort()).toEqual([1, 2, 3]);
  });

  it("never lets income / expense / refund / uncategorized into the audit", () => {
    const { records } = foldExclusionRows(rows);
    const ids = records.map((r) => r.id);
    expect(ids).not.toContain(4); // income
    expect(ids).not.toContain(5); // expense
    expect(ids).not.toContain(6); // refund
    expect(ids).not.toContain(7); // uncategorized
  });

  it("skips pending rows even when their category is transfer", () => {
    const { records } = foldExclusionRows(rows);
    expect(records.map((r) => r.id)).not.toContain(8);
  });

  it("summary: transfer is inflow-positive net, other_review is absolute sum", () => {
    const { summary } = foldExclusionRows(rows);
    expect(summary.total).toBe(3);
    expect(summary.transferCount).toBe(2);
    // +5000 in − 2000 out = 3000 (inflow-positive, matches bankPLService)
    expect(summary.transferTotal).toBe(3000);
    expect(summary.otherReviewCount).toBe(1);
    expect(summary.otherReviewTotal).toBe(77);
  });

  it("direction is derived from sign; jeff override wins over agent", () => {
    const { records } = foldExclusionRows([
      { id: 10, date: "2026-02-01", amount: "-100", agentCategory: "income_booking", jeffOverrideCategory: "transfer" },
      { id: 11, date: "2026-02-02", amount: "250", agentCategory: "transfer" },
    ]);
    expect(records.length).toBe(2);
    const byId = Object.fromEntries(records.map((r) => [r.id, r]));
    expect(byId[10].category).toBe("transfer"); // jeff override beat agent's income_booking
    expect(byId[10].source).toBe("jeff");
    expect(byId[10].direction).toBe("inflow"); // -100
    expect(byId[11].source).toBe("agent");
    expect(byId[11].direction).toBe("outflow"); // +250
  });

  it("empty input yields empty records and zeroed summary", () => {
    const { records, summary } = foldExclusionRows([]);
    expect(records).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.transferTotal).toBe(0);
    expect(summary.otherReviewTotal).toBe(0);
  });
});

describe("toExclusionCsv — RFC-4180 serialization", () => {
  it("emits a header row plus one line per record, with trailing newline", () => {
    const { records } = foldExclusionRows([
      { id: 1, date: "2026-01-05", amount: "-5000", jeffOverrideCategory: "transfer", counterparty: "Jeff Hsieh" },
      { id: 2, date: "2026-01-07", amount: "-77", agentCategory: "other_review" },
    ]);
    const csv = toExclusionCsv(records);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("Date,Amount,Direction,Category,Source,Counterparty,Description,Note");
    expect(lines.length).toBe(3); // header + 2 rows
    expect(csv.endsWith("\n")).toBe(true);
    expect(lines[1]).toContain("-5000.00");
    expect(lines[1]).toContain("Jeff Hsieh");
  });

  it("escapes commas, quotes, and newlines in free-text fields", () => {
    const { records } = foldExclusionRows([
      {
        id: 1,
        date: "2026-01-05",
        amount: "-100",
        agentCategory: "transfer",
        counterparty: 'Wells, Fargo "WF"',
        purposeNote: "line1\nline2",
      },
    ]);
    const csv = toExclusionCsv(records);
    // comma + embedded quotes → wrapped and quotes doubled
    expect(csv).toContain('"Wells, Fargo ""WF"""');
    // newline forces quoting
    expect(csv).toContain('"line1\nline2"');
  });
});
