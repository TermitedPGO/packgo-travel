import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCsvFromData, generateTaxCsv, type TaxCsvData } from "./taxCsvService";

// F2 塊D 回爐 P2:generateTaxCsv 的兩個資料源 mock 成確定性 stub,
// 釘死稅表接線(includeRecognized 存入全額 + 認列期共用口徑)。
const totalDeferredForUser = vi.fn();
const recognizedTrustIncomeInPeriod = vi.fn();
const isAnyTrustDeferralEnabled = vi.fn(() => true);
vi.mock("./trustDeferralService", () => ({
  totalDeferredForUser: (...a: unknown[]) => totalDeferredForUser(...a),
  recognizedTrustIncomeInPeriod: (...a: unknown[]) => recognizedTrustIncomeInPeriod(...a),
  isAnyTrustDeferralEnabled: (...a: unknown[]) => isAnyTrustDeferralEnabled(...a),
}));
const generateBankMonthlyTrend = vi.fn(async () => []);
vi.mock("./bankPLService", () => ({
  generateBankMonthlyTrend: (...a: unknown[]) => generateBankMonthlyTrend(...a),
  SCHEDULE_C_MAP: { income_booking: "Line 1" },
}));

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


describe("generateTaxCsv — 稅表遞延接線(F2 塊D 回爐 P2)", () => {
  beforeEach(() => {
    totalDeferredForUser.mockReset();
    recognizedTrustIncomeInPeriod.mockReset();
    isAnyTrustDeferralEnabled.mockReturnValue(true);
    generateBankMonthlyTrend.mockClear();
  });

  it("totalReceived 用 includeRecognized 全額;totalRecognized 走共用口徑函式(不再用差值 hack)", async () => {
    totalDeferredForUser.mockImplementation(async (opts: any) =>
      opts.depositSince ? 5000 : 2000, // 本年存入全額 5000;全期未認列 2000
    );
    recognizedTrustIncomeInPeriod.mockResolvedValue(3000);

    const csv = await generateTaxCsv(2026);

    // 存入側:第一個呼叫必須帶 includeRecognized:true(收到就是收到)
    expect(totalDeferredForUser).toHaveBeenCalledWith(
      expect.objectContaining({ depositSince: "2026-01-01", asOfDate: "2026-12-31", includeRecognized: true }),
    );
    // 認列側:共用口徑函式,本年 LA 曆日
    expect(recognizedTrustIncomeInPeriod).toHaveBeenCalledWith({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(csv).toContain("Total Received in Trust,5000.00");
    expect(csv).toContain("Total Recognized as Income,3000.00");
    expect(csv).toContain("2000.00"); // remainingDeferred(全期未認列)
  });

  it("F2 收案補丁 #3:年度結束後補產(now=2027-03 報 2026)→ 視窗仍錨定 2026 全年,不漏頭幾個月", async () => {
    // 舊寫法 generateBankMonthlyTrend({months:12}) 滾動窗錨到「現在」——
    // 2027-03 產 2026 稅表時窗 = 2026-04..2027-03,2026 年 1-3 月收入從
    // Line-1 年度合計消失。修後 now 錨到該年 12/31,與「現在」無關。
    totalDeferredForUser.mockResolvedValue(0);
    recognizedTrustIncomeInPeriod.mockResolvedValue(0);
    await generateTaxCsv(2026);
    expect(generateBankMonthlyTrend).toHaveBeenCalledTimes(1);
    const arg: any = generateBankMonthlyTrend.mock.calls[0][0];
    expect(arg.months).toBe(12);
    expect(arg.now.getFullYear()).toBe(2026); // 錨到 year 年底,而非執行當下
    expect(arg.now.getMonth()).toBe(11);
  });

  it("F2 收案補丁 #1:Received/Remaining 呼叫帶 includeSentinel:true(與 Recognized 同 scope,恆等式前提)", async () => {
    totalDeferredForUser.mockResolvedValue(0);
    recognizedTrustIncomeInPeriod.mockResolvedValue(0);
    await generateTaxCsv(2026);
    expect(totalDeferredForUser).toHaveBeenCalledWith(
      expect.objectContaining({ depositSince: "2026-01-01", includeRecognized: true, includeSentinel: true }),
    );
    expect(totalDeferredForUser).toHaveBeenCalledWith(
      expect.objectContaining({ asOfDate: "2026-12-31", includeSentinel: true }),
    );
  });

  it("flag 全 OFF → 三值全零(byte-identical),不打任何遞延查詢", async () => {
    isAnyTrustDeferralEnabled.mockReturnValue(false);
    const csv = await generateTaxCsv(2026);
    expect(totalDeferredForUser).not.toHaveBeenCalled();
    expect(recognizedTrustIncomeInPeriod).not.toHaveBeenCalled();
    expect(csv).toContain("Total Received in Trust,0.00");
  });
});
