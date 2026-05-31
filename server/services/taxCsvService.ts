/**
 * taxCsvService — Schedule C tax CSV generator (P4).
 *
 * Generates a CSV string organized by Schedule C categories with monthly
 * columns, a yearly total, and a Trust Account Summary section. Jeff can
 * download this any time from the 指揮中心 財務 dashboard.
 *
 * Data sources (all dynamic import, read-only):
 *   - bankPLService.generateBankMonthlyTrend → monthly income/cogs/operating/net
 *   - bankPLService.generateBankPL → full-year category breakdown
 *   - bankPLService.SCHEDULE_C_MAP → category → Schedule C line mapping
 *   - trustDeferralService.totalDeferredForUser → trust separation
 *
 * Output: RFC 4180 CSV string (commas, quoted fields when needed).
 */

import { createChildLogger } from "../_core/logger";

const log = createChildLogger({ module: "taxCsvService" });

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Escape a CSV field: quote if it contains comma, quote, or newline. */
function csvField(value: string | number): string {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(",");
}

/** Minimal shape for the monthly trend rows we consume. */
export interface TaxMonthlyRow {
  month: string; // "YYYY-MM"
  income: number;
  cogs: number;
  operating: number;
  netProfit: number;
}

export interface TaxCsvTrustSummary {
  totalReceived: number;
  totalRecognized: number;
  remainingDeferred: number;
}

export interface TaxCsvData {
  year: number;
  monthlyRows: TaxMonthlyRow[];
  scheduleCLabels: Record<string, string>;
  trust: TaxCsvTrustSummary;
}

/**
 * Pure CSV builder. Exposed for testing without DB access.
 */
export function buildCsvFromData(data: TaxCsvData): string {
  const lines: string[] = [];
  const { year, monthlyRows, trust } = data;

  // Build monthly arrays indexed 0-11
  const income = new Array(12).fill(0);
  const cogs = new Array(12).fill(0);
  const operating = new Array(12).fill(0);
  const net = new Array(12).fill(0);

  for (const row of monthlyRows) {
    const parts = row.month.split("-");
    const monthIdx = parseInt(parts[1], 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) continue;
    const rowYear = parseInt(parts[0], 10);
    if (rowYear !== year) continue;
    income[monthIdx] = row.income;
    cogs[monthIdx] = row.cogs;
    operating[monthIdx] = row.operating;
    net[monthIdx] = row.netProfit;
  }

  const sumArr = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  // Header
  lines.push(csvRow([`PACK&GO Schedule C Report - ${year}`, ...MONTHS, "Total"]));
  lines.push("");

  // Income row (Line 1)
  lines.push(
    csvRow([
      "Income - Gross Receipts (Line 1)",
      ...income.map((v) => v.toFixed(2)),
      sumArr(income).toFixed(2),
    ]),
  );

  // COGS row (Line 4)
  lines.push(
    csvRow([
      "COGS - Supplier Costs (Line 4)",
      ...cogs.map((v) => v.toFixed(2)),
      sumArr(cogs).toFixed(2),
    ]),
  );

  // Operating expenses row (Lines 8-24)
  lines.push(
    csvRow([
      "Operating Expenses (Lines 8-24)",
      ...operating.map((v) => v.toFixed(2)),
      sumArr(operating).toFixed(2),
    ]),
  );

  // Net profit row (Line 31)
  lines.push(
    csvRow([
      "Net Profit (Line 31)",
      ...net.map((v) => v.toFixed(2)),
      sumArr(net).toFixed(2),
    ]),
  );

  // Trust Account Summary
  lines.push("");
  lines.push(csvRow(["---"]));
  lines.push(csvRow(["Trust Account Summary (CST §17550)"]));
  lines.push(csvRow(["Total Received in Trust", trust.totalReceived.toFixed(2)]));
  lines.push(
    csvRow(["Total Recognized as Income", trust.totalRecognized.toFixed(2)]),
  );
  lines.push(
    csvRow([
      "Remaining Deferred (Not Yet Income)",
      trust.remainingDeferred.toFixed(2),
    ]),
  );

  // Schedule C reference
  lines.push("");
  lines.push(csvRow(["---"]));
  lines.push(csvRow(["Schedule C Line Reference"]));
  for (const [cat, line] of Object.entries(data.scheduleCLabels)) {
    if (!line.startsWith("(excluded")) {
      lines.push(csvRow([cat, line]));
    }
  }

  return lines.join("\n");
}

/**
 * Generate the full tax CSV string for a given year.
 */
export async function generateTaxCsv(year: number): Promise<string> {
  let monthlyRows: TaxMonthlyRow[] = [];
  let scheduleCLabels: Record<string, string> = {};
  let trust: TaxCsvTrustSummary = {
    totalReceived: 0,
    totalRecognized: 0,
    remainingDeferred: 0,
  };

  // 1. Monthly trend from bankPLService
  try {
    const { generateBankMonthlyTrend, SCHEDULE_C_MAP } = await import(
      "./bankPLService"
    );
    monthlyRows = await generateBankMonthlyTrend({ months: 12 });
    scheduleCLabels = { ...SCHEDULE_C_MAP };
  } catch (err) {
    log.error({ err }, "[taxCsvService] failed to load bank monthly trend");
  }

  // 2. Trust account summary
  try {
    const { totalDeferredForUser, isTrustDeferralEnabled } = await import(
      "./trustDeferralService"
    );
    if (isTrustDeferralEnabled()) {
      const endDate = `${year}-12-31`;
      const startDate = `${year}-01-01`;
      // Currently deferred for this year's deposits
      const yearDeferred = await totalDeferredForUser({
        asOfDate: endDate,
        depositSince: startDate,
      });
      // Total still deferred (all time, not yet recognized)
      const totalDeferred = await totalDeferredForUser({
        asOfDate: endDate,
      });

      trust = {
        totalReceived: yearDeferred,
        totalRecognized: Math.max(0, yearDeferred - totalDeferred),
        remainingDeferred: totalDeferred,
      };
    }
  } catch (err) {
    log.warn({ err }, "[taxCsvService] trust data unavailable, using zeros");
  }

  const data: TaxCsvData = { year, monthlyRows, scheduleCLabels, trust };
  const csv = buildCsvFromData(data);

  log.info(
    { year, monthCount: monthlyRows.length },
    "[taxCsvService] CSV generated",
  );

  return csv;
}
