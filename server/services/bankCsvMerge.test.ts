/**
 * Tests for bankCsvMerge (bank-csv-merge m1) — matcher + enrichment rules.
 * 錢的不變式:本模組輸出永遠不含 amount/date/分類欄位。
 */
import { describe, it, expect } from "vitest";
import {
  matchCsvRowsToPlaid,
  buildEnrichment,
  amountKey,
  mergedFromCsvOf,
  isGenericBankLabel,
  type CsvRowLike,
  type PlaidRowLike,
} from "./bankCsvMerge";

const csv = (over: Partial<CsvRowLike> & { syntheticId: string }): CsvRowLike => ({
  date: "2026-06-01",
  amount: 6.95,
  description: 'Zelle payment to LION for "Taiwan7days"; Conf# abc',
  merchantName: "LION TRAVEL",
  referenceNumber: null,
  ...over,
});

const plaid = (over: Partial<PlaidRowLike> & { id: number }): PlaidRowLike => ({
  plaidTransactionId: `plaid-${over.id}`,
  date: "2026-06-01",
  amount: "6.95",
  merchantName: "PURCHASE",
  description: "PURCHASE",
  paymentMeta: null,
  ...over,
});

describe("matchCsvRowsToPlaid", () => {
  it("same-day same-amount → merge", () => {
    const r = matchCsvRowsToPlaid([csv({ syntheticId: "c1" })], [plaid({ id: 1 })]);
    expect(r.merges).toHaveLength(1);
    expect(r.merges[0].plaidRow.id).toBe(1);
    expect(r.merges[0].dateDiffDays).toBe(0);
    expect(r.inserts).toHaveLength(0);
    expect(r.ambiguous).toHaveLength(0);
  });

  it("date diff 1-3 days matches; 4 days does not", () => {
    const within = matchCsvRowsToPlaid(
      [csv({ syntheticId: "c1", date: "2026-06-04" })],
      [plaid({ id: 1, date: "2026-06-01" })],
    );
    expect(within.merges).toHaveLength(1);
    expect(within.merges[0].dateDiffDays).toBe(3);

    const outside = matchCsvRowsToPlaid(
      [csv({ syntheticId: "c1", date: "2026-06-05" })],
      [plaid({ id: 1, date: "2026-06-01" })],
    );
    expect(outside.merges).toHaveLength(0);
    expect(outside.inserts).toHaveLength(1);
  });

  it("amount mismatch never matches (decimal-string safe)", () => {
    const r = matchCsvRowsToPlaid(
      [csv({ syntheticId: "c1", amount: 6.95 })],
      [plaid({ id: 1, amount: "6.96" })],
    );
    expect(r.inserts).toHaveLength(1);
    // and "6.950" string equals 6.95 number
    expect(amountKey("6.950")).toBe(amountKey(6.95));
  });

  it("closest date wins, second row takes the farther candidate", () => {
    const r = matchCsvRowsToPlaid(
      [
        csv({ syntheticId: "c1", date: "2026-06-02" }),
        csv({ syntheticId: "c2", date: "2026-06-03" }),
      ],
      [
        plaid({ id: 10, date: "2026-06-02" }),
        plaid({ id: 11, date: "2026-06-04" }),
      ],
    );
    expect(r.merges).toHaveLength(2);
    const byCsv = Object.fromEntries(r.merges.map((m) => [m.csvRow.syntheticId, m.plaidRow.id]));
    expect(byCsv).toEqual({ c1: 10, c2: 11 });
  });

  it("兩杯同價咖啡: two same-day same-amount plaid rows for ONE csv row → ambiguous, never guessed", () => {
    const r = matchCsvRowsToPlaid(
      [csv({ syntheticId: "c1" })],
      [plaid({ id: 1 }), plaid({ id: 2 })],
    );
    expect(r.merges).toHaveLength(0);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].reason).toBe("multiple-equidistant");
    expect(r.inserts).toHaveLength(0);
  });

  it("two csv rows + two equidistant plaid rows → both ambiguous (no arbitrary pairing)", () => {
    const r = matchCsvRowsToPlaid(
      [csv({ syntheticId: "c1" }), csv({ syntheticId: "c2" })],
      [plaid({ id: 1 }), plaid({ id: 2 })],
    );
    expect(r.ambiguous).toHaveLength(2);
    expect(r.merges).toHaveLength(0);
  });

  it("candidate consumed by an earlier csv row → later row falls to next-nearest or ambiguous", () => {
    const r = matchCsvRowsToPlaid(
      [
        csv({ syntheticId: "c1", date: "2026-06-01" }),
        csv({ syntheticId: "c2", date: "2026-06-01" }),
      ],
      [plaid({ id: 1, date: "2026-06-01" })],
    );
    expect(r.merges).toHaveLength(1);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].reason).toBe("candidates-consumed");
  });

  it("idempotent re-upload: marker row wins outright and counts alreadyMerged", () => {
    const marked = plaid({
      id: 5,
      date: "2026-06-03", // farther than the unmarked candidate
      paymentMeta: { merged_from_csv: "c1", plaid_original_name: "PURCHASE" },
    });
    const r = matchCsvRowsToPlaid(
      [csv({ syntheticId: "c1", date: "2026-06-01" })],
      [plaid({ id: 4, date: "2026-06-01" }), marked],
    );
    expect(r.merges).toHaveLength(1);
    expect(r.merges[0].plaidRow.id).toBe(5);
    expect(r.merges[0].alreadyMerged).toBe(true);
  });

  it("a row claimed by a DIFFERENT csv hash is never re-claimed", () => {
    const claimed = plaid({
      id: 6,
      paymentMeta: JSON.stringify({ merged_from_csv: "other-hash" }),
    });
    const r = matchCsvRowsToPlaid([csv({ syntheticId: "c1" })], [claimed]);
    expect(r.merges).toHaveLength(0);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].reason).toBe("candidates-consumed");
  });

  it("deterministic: shuffled input order produces the same pairing", () => {
    const csvRows = [
      csv({ syntheticId: "c2", date: "2026-06-03" }),
      csv({ syntheticId: "c1", date: "2026-06-02" }),
    ];
    const plaidRows = [
      plaid({ id: 11, date: "2026-06-04" }),
      plaid({ id: 10, date: "2026-06-02" }),
    ];
    const a = matchCsvRowsToPlaid(csvRows, plaidRows);
    const b = matchCsvRowsToPlaid([...csvRows].reverse(), [...plaidRows].reverse());
    const key = (r: ReturnType<typeof matchCsvRowsToPlaid>) =>
      r.merges.map((m) => `${m.csvRow.syntheticId}->${m.plaidRow.id}`).sort();
    expect(key(a)).toEqual(key(b));
  });
});

describe("buildEnrichment", () => {
  it("CSV text becomes description + originalDescription; generic merchant replaced", () => {
    const e = buildEnrichment(
      csv({ syntheticId: "c1", merchantName: "LION TRAVEL" }),
      plaid({ id: 1, merchantName: "PURCHASE", description: "PURCHASE" }),
    );
    expect(e.description).toContain("Taiwan7days");
    expect(e.originalDescription).toBe(e.description);
    expect(e.merchantName).toBe("LION TRAVEL");
    expect(e.paymentMeta.merged_from_csv).toBe("c1");
    expect(e.paymentMeta.plaid_original_name).toBe("PURCHASE");
  });

  it("meaningful Plaid merchant (Uber) is kept", () => {
    const e = buildEnrichment(
      csv({ syntheticId: "c1", merchantName: "UBER TRIP SF" }),
      plaid({ id: 1, merchantName: "Uber", description: "UBER *TRIP" }),
    );
    expect(e.merchantName).toBe("Uber");
  });

  it("existing paymentMeta fields survive the merge", () => {
    const e = buildEnrichment(
      csv({ syntheticId: "c1", referenceNumber: "r123" }),
      plaid({ id: 1, paymentMeta: { reference_number: "p999" } }),
    );
    expect(e.paymentMeta.reference_number).toBe("p999");
    expect(e.paymentMeta.csv_reference_number).toBe("r123");
  });

  it("錢的不變式: enrichment set has NO amount/date/category keys", () => {
    const e = buildEnrichment(csv({ syntheticId: "c1" }), plaid({ id: 1 }));
    expect(Object.keys(e).sort()).toEqual([
      "description",
      "merchantName",
      "originalDescription",
      "paymentMeta",
    ]);
  });
});

describe("helpers", () => {
  it("mergedFromCsvOf reads object, JSON string, junk", () => {
    expect(mergedFromCsvOf({ merged_from_csv: "x" })).toBe("x");
    expect(mergedFromCsvOf(JSON.stringify({ merged_from_csv: "y" }))).toBe("y");
    expect(mergedFromCsvOf("junk")).toBeNull();
    expect(mergedFromCsvOf(null)).toBeNull();
    expect(mergedFromCsvOf([1])).toBeNull();
  });

  it("isGenericBankLabel", () => {
    expect(isGenericBankLabel("PURCHASE")).toBe(true);
    expect(isGenericBankLabel(" mail/telephone order ")).toBe(true);
    expect(isGenericBankLabel("Uber")).toBe(false);
    expect(isGenericBankLabel(null)).toBe(true);
  });
});
