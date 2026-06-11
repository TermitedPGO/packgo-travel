/**
 * workspaceLedger.helpers — pure logic for 批3 財務 views.
 *
 * Sign convention (Plaid): amount > 0 = outflow 支出, amount < 0 = inflow 入帳.
 */

export const CANONICAL_CATEGORIES = [
  "income_booking",
  "cogs_tour",
  "cogs_other",
  "expense_marketing",
  "expense_software",
  "expense_office",
  "expense_travel",
  "refund",
  "transfer",
  "other_review",
] as const;
export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

export type TriageTxnLike = {
  agentCategory: string | null;
  jeffOverrideCategory: string | null;
  excludeFromAccounting: number | null;
  amount: string | number;
};

/** Needs Jeff's eyes: no manual category AND (no AI category or AI punted). */
export function needsTriage(t: TriageTxnLike): boolean {
  if (t.excludeFromAccounting === 1) return false;
  if (t.jeffOverrideCategory) return false;
  return !t.agentCategory || t.agentCategory === "other_review";
}

export function isInflow(amount: string | number): boolean {
  return Number(amount) < 0;
}

/** Display magnitude — sign is communicated by the 入帳/支出 badge instead. */
export function absAmount(amount: string | number): number {
  return Math.abs(Number(amount));
}

/* ── m2: 信託認列 ── */

export type DeferredRowLike = {
  amount: string | number;
  expectedRecognitionDate: Date | string | null;
  recognizedAt: Date | string | null;
  reversedAt: Date | string | null;
};

/**
 * Rows whose departure date has arrived and are still unrecognized — the
 * 「可認列」card numbers feeding the 🔒 trustRecognizeNow confirm.
 */
export function dueForRecognition<T extends DeferredRowLike>(
  rows: T[],
  now: number = Date.now(),
): { rows: T[]; total: number } {
  const due = rows.filter((r) => {
    if (r.recognizedAt || r.reversedAt) return false;
    if (!r.expectedRecognitionDate) return false;
    const ts = new Date(r.expectedRecognitionDate).getTime();
    return Number.isFinite(ts) && ts <= now;
  });
  return {
    rows: due,
    total: due.reduce((s, r) => s + Math.abs(Number(r.amount)), 0),
  };
}

/* ── m3: 應收(催款唯讀) ── */

export type BookingLike = {
  id: number;
  customerName: string;
  depositAmount: number;
  remainingAmount: number;
  currency?: string | null;
  bookingStatus: string;
  paymentStatus: string;
  depositDueDate: Date | string | null;
  balanceDueDate: Date | string | null;
};

export type Receivable = {
  bookingId: number;
  customerName: string;
  kind: "deposit" | "balance";
  amount: number;
  currency: string;
  dueDate: Date | string | null;
  /** days until due; negative = overdue; null = no due date set. */
  daysLeft: number | null;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * What this booking still owes us. null = nothing collectable (cancelled /
 * completed / fully paid / refunded, or zero amount).
 */
export function receivableOf(
  b: BookingLike,
  now: number = Date.now(),
): Receivable | null {
  if (b.bookingStatus === "cancelled") return null;
  if (b.paymentStatus === "paid" || b.paymentStatus === "refunded") return null;

  const kind: "deposit" | "balance" =
    b.paymentStatus === "unpaid" ? "deposit" : "balance";
  const amount = kind === "deposit" ? b.depositAmount : b.remainingAmount;
  if (!amount || amount <= 0) return null;

  const dueDate = kind === "deposit" ? b.depositDueDate : b.balanceDueDate;
  let daysLeft: number | null = null;
  if (dueDate) {
    const ts = new Date(dueDate).getTime();
    if (Number.isFinite(ts)) daysLeft = Math.ceil((ts - now) / DAY);
  }
  return {
    bookingId: b.id,
    customerName: b.customerName,
    kind,
    amount,
    currency: b.currency ?? "USD",
    dueDate,
    daysLeft,
  };
}

/** Overdue first (most overdue on top), then nearest due, then no-date last. */
export function sortReceivables(rs: Receivable[]): Receivable[] {
  return [...rs].sort((a, b) => {
    if (a.daysLeft == null && b.daysLeft == null) return b.amount - a.amount;
    if (a.daysLeft == null) return 1;
    if (b.daysLeft == null) return -1;
    return a.daysLeft - b.daysLeft;
  });
}
