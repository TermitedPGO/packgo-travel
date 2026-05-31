import { describe, it, expect } from "vitest";
import { buildCsvFromData, type TaxCsvData } from "./taxCsvService";

function makeTaxData(overrides: Partial<TaxCsvData> = {}): TaxCsvData {
  return {
    year: 2026,
    monthlyRows: [
      { month: "2026-01", income: 8000, cogs: 3000, operating: 1500, netProfit: 3500 },
      { month: "2026-02", income: 9000, cogs: 3500, operating: 1600, netProfit: 3900 },
      { month: "2026-03", income: 7500, cogs: 2800, operating: 1400, netProfit: 3300 },
      { month: "2026-04", income: 10000, cogs: 4000, operating: 2000, netProfit: 4000 },
      { month: "2026-05", income: 11000, cogs: 4500, operating: 2100, netProfit: 4400 },
    ],
    scheduleCLabels: {
      income_booking: "Line 1 — Gross receipts",
      cogs_tour: "Line 4 — Cost of goods sold",
      expense_marketing: "Line 8 — Advertising",
      transfer: "(excluded — internal transfer)",
    },
    trust: {
      totalReceived: 5000,
      totalRecognized: 3000,
      remainingDeferred: 2000,
    },
    ...overrides,
  };
}

describe("buildCsvFromData", () => {
  it("produces valid CSV string", () => {
    const csv = buildCsvFromData(makeTaxData());
    expect(typeof csv).toBe("string");
    expect(csv.length).toBeGreaterThan(0);
  });

  it("contains all 12 month headers", () => {
    const csv = buildCsvFromData(makeTaxData());
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toContain("Jan");
    expect(firstLine).toContain("Feb");
    expect(firstLine).toContain("Dec");
    expect(firstLine).toContain("Total");
  });

  it("contains income row", () => {
    const csv = buildCsvFromData(makeTaxData());
    expect(csv).toContain("Income - Gross Receipts (Line 1)");
  });

  it("contains COGS row", () => {
    const csv = buildCsvFromData(makeTaxData());
    expect(csv).toContain("COGS - Supplier Costs (Line 4)");
  });

  it("contains net profit row", () => {
    const csv = buildCsvFromData(makeTaxData());
    expect(csv).toContain("Net Profit (Line 31)");
  });

  it("contains Trust Account Summary section", () => {
    const csv = buildCsvFromData(makeTaxData());
    expect(csv).toContain("Trust Account Summary");
    expect(csv).toContain("Total Received in Trust");
    expect(csv).toContain("Total Recognized as Income");
    expect(csv).toContain("Remaining Deferred");
  });

  it("contains Schedule C reference", () => {
    const csv = buildCsvFromData(makeTaxData());
    expect(csv).toContain("Schedule C Line Reference");
    expect(csv).toContain("Line 1");
    expect(csv).toContain("Line 4");
  });

  it("excludes transfer from Schedule C reference", () => {
    const csv = buildCsvFromData(makeTaxData());
    expect(csv).not.toContain("(excluded");
  });

  it("totals are correct for income", () => {
    const data = makeTaxData();
    const csv = buildCsvFromData(data);
    // Total income = 8000+9000+7500+10000+11000 = 45500
    expect(csv).toContain("45500.00");
  });

  it("handles empty monthly rows", () => {
    const csv = buildCsvFromData(makeTaxData({ monthlyRows: [] }));
    expect(csv).toContain("Trust Account Summary");
    // No data rows but still valid CSV
  });

  it("handles zero trust values", () => {
    const csv = buildCsvFromData(
      makeTaxData({
        trust: { totalReceived: 0, totalRecognized: 0, remainingDeferred: 0 },
      }),
    );
    expect(csv).toContain("0.00");
  });

  it("properly escapes fields with commas", () => {
    const data = makeTaxData({
      scheduleCLabels: {
        "test_cat": "Line 4 — Cost of goods sold (suppliers, fees)",
      },
    });
    const csv = buildCsvFromData(data);
    // Field with comma should be quoted
    expect(csv).toContain('"Line 4');
  });
});
