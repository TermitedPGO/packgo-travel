/**
 * BofA CSV import — 2026-05-23.
 *
 * Plaid only retains ~90 days of BofA history. To get 2025 data, Jeff
 * downloads CSV from BofA online banking (Activity → Download → Date
 * Range → Format CSV) and uploads here.
 *
 * Supports the 3 BofA CSV variants:
 *
 *   1. Checking (legacy):
 *      Date, Description, Amount, Running Bal.
 *
 *   2. Checking (new, 2024+):
 *      Posted Date, Reference Number, Payee, Address, Amount
 *
 *   3. Credit card:
 *      Posted Date, Reference Number, Payee, Address, Amount
 *      (column meanings identical to #2)
 *
 * The CSV's headers are read to detect format. Dates auto-normalized to
 * YYYY-MM-DD regardless of BofA's locale.
 *
 * Dedup: each parsed row gets a synthetic plaidTransactionId of the form
 *   `csv:<linkedAccountId>:<sha1(date+amount+description).slice(0,32)>`
 * so re-running the same CSV upserts (not duplicates), AND so it can't
 * collide with real Plaid IDs (which are opaque random strings).
 *
 * Plaid-synced rows in the same date range stay untouched because their
 * IDs don't start with `csv:`.
 */

import { createHash } from "crypto";

export type ParsedCsvRow = {
  /** synthetic plaidTransactionId — stable per (account, date, amount, desc) */
  syntheticId: string;
  /** YYYY-MM-DD */
  date: string;
  /** Plaid sign convention: positive = outflow, negative = inflow.
   *  BofA CSV has the opposite convention (negative = outflow) so we flip. */
  amount: number;
  description: string;
  merchantName: string | null;
  referenceNumber: string | null;
  isoCurrencyCode: "USD";
};

/**
 * Parse BofA CSV text. Returns rows + any non-fatal warnings.
 */
export function parseBofaCsv(args: {
  csvText: string;
  linkedAccountId: number;
}): {
  rows: ParsedCsvRow[];
  warnings: string[];
  format: "legacy" | "checking-new" | "creditcard";
} {
  const warnings: string[] = [];
  const lines = args.csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], warnings: ["empty file"], format: "legacy" };
  }

  // Find header row — BofA CSVs sometimes have account summary lines
  // before the actual table. Header line contains the word "Date" or
  // "Posted Date".
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/posted date|^date\b/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      rows: [],
      warnings: ["could not find header row — is this a BofA Activity CSV?"],
      format: "legacy",
    };
  }

  const headers = splitCsvLine(lines[headerIdx]).map((h) =>
    h.trim().toLowerCase(),
  );
  // Map header positions
  const colMap = {
    date: headers.findIndex((h) => h === "date" || h === "posted date"),
    description: headers.findIndex((h) => h === "description"),
    amount: headers.findIndex((h) => h === "amount"),
    payee: headers.findIndex((h) => h === "payee"),
    reference: headers.findIndex((h) => h === "reference number"),
  };

  let format: "legacy" | "checking-new" | "creditcard" = "legacy";
  if (colMap.payee >= 0) {
    format = colMap.reference >= 0 ? "checking-new" : "creditcard";
  }

  const rows: ParsedCsvRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 3) continue;

    const dateRaw = colMap.date >= 0 ? cells[colMap.date] : "";
    const date = normalizeDate(dateRaw);
    if (!date) {
      warnings.push(`row ${i + 1}: bad date "${dateRaw}", skipped`);
      continue;
    }

    const amountRaw =
      colMap.amount >= 0 ? cells[colMap.amount] : cells[cells.length - 1];
    const amountNum = parseAmount(amountRaw);
    if (Number.isNaN(amountNum)) {
      warnings.push(`row ${i + 1}: bad amount "${amountRaw}", skipped`);
      continue;
    }

    // BofA convention: negative = withdrawal, positive = deposit.
    // Plaid convention: positive = outflow (expense), negative = inflow.
    // → flip sign.
    const plaidAmount = -amountNum;

    const descRaw =
      colMap.payee >= 0
        ? cells[colMap.payee] || cells[colMap.description] || ""
        : colMap.description >= 0
          ? cells[colMap.description]
          : "";
    const description = descRaw.trim();
    const merchantName = guessMerchantName(description);
    const referenceNumber =
      colMap.reference >= 0 ? cells[colMap.reference]?.trim() || null : null;

    const hashInput = `${args.linkedAccountId}|${date}|${plaidAmount.toFixed(2)}|${description}`;
    const hash = createHash("sha1").update(hashInput).digest("hex").slice(0, 32);
    const syntheticId = `csv:${args.linkedAccountId}:${hash}`;

    rows.push({
      syntheticId,
      date,
      amount: plaidAmount,
      description,
      merchantName,
      referenceNumber,
      isoCurrencyCode: "USD",
    });
  }

  return { rows, warnings, format };
}

/** Minimal CSV-line splitter handling double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Already YYYY-MM-DD
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return trimmed;
  // MM/DD/YYYY (BofA default)
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  }
  // MM/DD/YY
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const [, mo, da, yr] = m;
    const fullYr = Number(yr) >= 50 ? `19${yr}` : `20${yr}`;
    return `${fullYr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(raw: string): number {
  if (!raw) return Number.NaN;
  // Strip $, commas, surrounding whitespace, handle parens-as-negative
  let s = raw.replace(/[$,\s]/g, "").trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  const n = Number(s);
  return neg ? -n : n;
}

/** Strip Plaid-style noise to get a clean merchant name. */
function guessMerchantName(description: string): string {
  return (
    description
      // common BofA suffixes
      .replace(/\s+ON\s+\d{2}\/\d{2}.*$/i, "")
      .replace(/\s+#\d+.*$/i, "")
      .replace(/\s+REF#.*$/i, "")
      .replace(/\s+CONF#.*$/i, "")
      .replace(/\s+VIA\s+(WEB|MOBILE|PHONE).*$/i, "")
      .trim()
      .slice(0, 100)
  );
}
