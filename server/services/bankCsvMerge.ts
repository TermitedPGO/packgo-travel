/**
 * bankCsvMerge — 銀行帳目雙源合併的純邏輯(bank-csv-merge m1)。
 *
 * BofA-via-Plaid strips descriptors (prod: PURCHASE×55, originalDescription
 * all-null) while Jeff's BofA CSV download keeps the full bank line. This
 * module decides, for each parsed CSV row, whether it IS an already-synced
 * Plaid transaction (→ enrich that row with the CSV text, insert nothing)
 * or a genuinely new one (→ insert as before).
 *
 * Matching contract (design.md §1):
 *   same account (caller guarantees) + amount exactly equal (sign
 *   conventions already aligned at CSV parse time) + |posted-date diff| ≤
 *   windowDays. One-to-one greedy by closest date. Ambiguity is NEVER
 *   guessed away: equal-distance multiple candidates, or every candidate
 *   already consumed, keeps the CSV row as a plain insert + an `ambiguous`
 *   entry so the import result can say so honestly.
 *
 * Money invariant: nothing in this module (or its consumers) ever changes
 * an amount, a date, or an account id. Description fields only.
 */

export interface CsvRowLike {
  /** `csv:<accountId>:<hash>` — stable per (date, amount, description). */
  syntheticId: string;
  /** YYYY-MM-DD posted date. */
  date: string;
  /** Plaid sign convention (positive = outflow). */
  amount: number;
  description: string;
  merchantName: string | null;
  referenceNumber?: string | null;
}

export interface PlaidRowLike {
  id: number;
  plaidTransactionId: string;
  /** Date or YYYY-MM-DD string, as drizzle returns it. */
  date: string | Date;
  /** decimal column → string from mysql2. */
  amount: string | number;
  merchantName: string | null;
  description: string | null;
  paymentMeta: unknown;
}

export interface MergePair {
  csvRow: CsvRowLike;
  plaidRow: PlaidRowLike;
  dateDiffDays: number;
  /** paymentMeta.merged_from_csv already names this CSV row → no-op. */
  alreadyMerged: boolean;
}

export interface AmbiguousRow {
  csvRow: CsvRowLike;
  reason: "multiple-equidistant" | "candidates-consumed";
}

export interface MatchResult {
  merges: MergePair[];
  inserts: CsvRowLike[];
  ambiguous: AmbiguousRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDayMs(d: string | Date): number {
  if (d instanceof Date) {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  // YYYY-MM-DD (CSV parser normalizes); Date.parse treats it as UTC midnight
  const ts = Date.parse(d.slice(0, 10));
  return Number.isFinite(ts) ? ts : NaN;
}

/** Decimal-safe amount key: "12.5", 12.50, "12.500" all → "12.50". */
export function amountKey(a: string | number): string {
  const n = typeof a === "number" ? a : Number(a);
  return Number.isFinite(n) ? n.toFixed(2) : "NaN";
}

/** merged_from_csv marker out of a paymentMeta value (object or JSON). */
export function mergedFromCsvOf(paymentMeta: unknown): string | null {
  let o: unknown = paymentMeta;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  if (o == null || typeof o !== "object" || Array.isArray(o)) return null;
  const v = (o as Record<string, unknown>).merged_from_csv;
  return typeof v === "string" && v ? v : null;
}

export function matchCsvRowsToPlaid(
  csvRows: CsvRowLike[],
  plaidRows: PlaidRowLike[],
  windowDays = 3,
): MatchResult {
  const merges: MergePair[] = [];
  const inserts: CsvRowLike[] = [];
  const ambiguous: AmbiguousRow[] = [];

  // Index Plaid rows by amount for O(n) candidate lookup.
  const byAmount = new Map<string, PlaidRowLike[]>();
  for (const p of plaidRows) {
    const k = amountKey(p.amount);
    const list = byAmount.get(k);
    if (list) list.push(p);
    else byAmount.set(k, [p]);
  }

  // A Plaid row already claimed by SOME OTHER csv hash is consumed from the
  // start; one claimed by THIS row resolves as alreadyMerged below.
  const consumed = new Set<number>();

  // Deterministic greedy order: by date then syntheticId, so re-running the
  // same import always produces the same pairing.
  const ordered = [...csvRows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.syntheticId.localeCompare(b.syntheticId),
  );

  for (const csvRow of ordered) {
    const csvDay = toUtcDayMs(csvRow.date);
    const candidates = (byAmount.get(amountKey(csvRow.amount)) ?? [])
      .map((p) => ({
        p,
        diff: Math.round(Math.abs(toUtcDayMs(p.date) - csvDay) / DAY_MS),
      }))
      .filter((c) => Number.isFinite(c.diff) && c.diff <= windowDays)
      .sort((a, b) => a.diff - b.diff || a.p.id - b.p.id);

    if (candidates.length === 0) {
      inserts.push(csvRow);
      continue;
    }

    // Idempotency first: a candidate that already carries OUR marker wins
    // outright regardless of distance or consumption.
    const mine = candidates.find(
      (c) => mergedFromCsvOf(c.p.paymentMeta) === csvRow.syntheticId,
    );
    if (mine) {
      consumed.add(mine.p.id);
      merges.push({
        csvRow,
        plaidRow: mine.p,
        dateDiffDays: mine.diff,
        alreadyMerged: true,
      });
      continue;
    }

    const free = candidates.filter(
      (c) => !consumed.has(c.p.id) && mergedFromCsvOf(c.p.paymentMeta) == null,
    );
    if (free.length === 0) {
      ambiguous.push({ csvRow, reason: "candidates-consumed" });
      continue;
    }

    // Equal-distance tie between distinct rows → never guess.
    if (free.length > 1 && free[0].diff === free[1].diff) {
      ambiguous.push({ csvRow, reason: "multiple-equidistant" });
      continue;
    }

    consumed.add(free[0].p.id);
    merges.push({
      csvRow,
      plaidRow: free[0].p,
      dateDiffDays: free[0].diff,
      alreadyMerged: false,
    });
  }

  return { merges, inserts, ambiguous };
}

/* ───────────────────────── enrichment 規則 (design §2) ───────────────────────── */

/** Bank labels that say nothing about the transaction. */
const GENERIC_BANK_LABELS = new Set([
  "purchase",
  "pos purchase",
  "debit card purchase",
  "mail/telephone order",
  "mail or telephone order",
  "payment",
  "deposit",
  "withdrawal",
  "check",
  "ach",
]);

export function isGenericBankLabel(s: string | null | undefined): boolean {
  if (!s) return true;
  return GENERIC_BANK_LABELS.has(s.trim().toLowerCase());
}

export interface EnrichmentSet {
  description: string;
  originalDescription: string;
  merchantName: string | null;
  paymentMeta: Record<string, unknown>;
}

/**
 * Update-set for the surviving Plaid row. Amount/date/category fields are
 * deliberately absent — they must never change here.
 */
export function buildEnrichment(
  csvRow: CsvRowLike,
  plaidRow: PlaidRowLike,
): EnrichmentSet {
  // Keep Plaid's merchant when it actually names a merchant; replace the
  // generic ones (PURCHASE etc.) with the CSV-derived guess.
  const plaidMerchant = plaidRow.merchantName?.trim() || null;
  const merchantName =
    plaidMerchant &&
    !isGenericBankLabel(plaidMerchant) &&
    plaidMerchant !== plaidRow.description?.trim()
      ? plaidMerchant
      : (csvRow.merchantName?.trim() || plaidMerchant);

  let meta: Record<string, unknown> = {};
  let raw: unknown = plaidRow.paymentMeta;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    meta = { ...(raw as Record<string, unknown>) };
  }
  meta.merged_from_csv = csvRow.syntheticId;
  meta.plaid_original_name = plaidRow.description ?? null;
  if (csvRow.referenceNumber) {
    meta.csv_reference_number = csvRow.referenceNumber;
  }

  return {
    description: csvRow.description,
    originalDescription: csvRow.description,
    merchantName,
    paymentMeta: meta,
  };
}
