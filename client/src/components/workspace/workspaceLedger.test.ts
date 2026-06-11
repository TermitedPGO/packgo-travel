/**
 * Tests for workspaceLedger.helpers (批3) — real implementations.
 */
import { describe, it, expect } from "vitest";
import {
  needsTriage,
  isInflow,
  absAmount,
  dueForRecognition,
  receivableOf,
  sortReceivables,
  type BookingLike,
} from "./workspaceLedger.helpers";

describe("needsTriage (m1)", () => {
  const base = {
    agentCategory: null,
    jeffOverrideCategory: null,
    excludeFromAccounting: 0,
    amount: "100",
  };

  it("uncategorized → triage", () => {
    expect(needsTriage(base)).toBe(true);
  });
  it("AI punted (other_review) → triage", () => {
    expect(needsTriage({ ...base, agentCategory: "other_review" })).toBe(true);
  });
  it("AI categorized confidently → no triage", () => {
    expect(needsTriage({ ...base, agentCategory: "expense_travel" })).toBe(
      false,
    );
  });
  it("Jeff already overrode → no triage even if AI punted", () => {
    expect(
      needsTriage({
        ...base,
        agentCategory: "other_review",
        jeffOverrideCategory: "expense_office",
      }),
    ).toBe(false);
  });
  it("excluded → no triage", () => {
    expect(needsTriage({ ...base, excludeFromAccounting: 1 })).toBe(false);
  });
});

describe("sign convention (m1)", () => {
  it("Plaid: negative = inflow, positive = outflow", () => {
    expect(isInflow(-1968)).toBe(true);
    expect(isInflow("1184.20")).toBe(false);
  });
  it("absAmount strips sign for display", () => {
    expect(absAmount("-1968")).toBe(1968);
    expect(absAmount(86.4)).toBe(86.4);
  });
});

describe("dueForRecognition (m2)", () => {
  const NOW = new Date("2026-06-11T00:00:00Z").getTime();
  const row = (over = {}) => ({
    amount: "-600",
    expectedRecognitionDate: "2026-06-08",
    recognizedAt: null,
    reversedAt: null,
    ...over,
  });

  it("departure arrived + unrecognized → due, totals abs amounts", () => {
    const out = dueForRecognition(
      [row(), row({ amount: "-1200", expectedRecognitionDate: "2026-06-10" })],
      NOW,
    );
    expect(out.rows).toHaveLength(2);
    expect(out.total).toBe(1800);
  });

  it("future departure / already recognized / reversed / no date → not due", () => {
    const out = dueForRecognition(
      [
        row({ expectedRecognitionDate: "2026-07-01" }),
        row({ recognizedAt: "2026-06-09" }),
        row({ reversedAt: "2026-06-09" }),
        row({ expectedRecognitionDate: null }),
      ],
      NOW,
    );
    expect(out.rows).toHaveLength(0);
    expect(out.total).toBe(0);
  });
});

describe("receivableOf (m3)", () => {
  const NOW = new Date("2026-06-11T00:00:00Z").getTime();
  const booking = (over: Partial<BookingLike> = {}): BookingLike => ({
    id: 1,
    customerName: "林淑芬",
    depositAmount: 600,
    remainingAmount: 1800,
    currency: "USD",
    bookingStatus: "confirmed",
    paymentStatus: "deposit",
    depositDueDate: null,
    balanceDueDate: "2026-06-20",
    ...over,
  });

  it("deposit paid → balance receivable with T-days", () => {
    const r = receivableOf(booking(), NOW)!;
    expect(r.kind).toBe("balance");
    expect(r.amount).toBe(1800);
    expect(r.daysLeft).toBe(9);
  });

  it("unpaid → deposit receivable", () => {
    const r = receivableOf(
      booking({ paymentStatus: "unpaid", depositDueDate: "2026-06-08" }),
      NOW,
    )!;
    expect(r.kind).toBe("deposit");
    expect(r.amount).toBe(600);
    expect(r.daysLeft).toBe(-3); // overdue
  });

  it("paid / refunded / cancelled / zero-amount → null", () => {
    expect(receivableOf(booking({ paymentStatus: "paid" }), NOW)).toBeNull();
    expect(
      receivableOf(booking({ paymentStatus: "refunded" }), NOW),
    ).toBeNull();
    expect(
      receivableOf(booking({ bookingStatus: "cancelled" }), NOW),
    ).toBeNull();
    expect(
      receivableOf(booking({ remainingAmount: 0 }), NOW),
    ).toBeNull();
  });

  it("no due date → daysLeft null", () => {
    expect(receivableOf(booking({ balanceDueDate: null }), NOW)!.daysLeft)
      .toBeNull();
  });
});

describe("sortReceivables (m3)", () => {
  const r = (id: number, daysLeft: number | null, amount = 100) => ({
    bookingId: id,
    customerName: "x",
    kind: "balance" as const,
    amount,
    currency: "USD",
    dueDate: null,
    daysLeft,
  });

  it("overdue first, then nearest due, no-date last", () => {
    const out = sortReceivables([r(1, 9), r(2, -2), r(3, 3), r(4, null)]);
    expect(out.map((x) => x.bookingId)).toEqual([2, 3, 1, 4]);
  });

  it("no-date ties break by amount desc", () => {
    const out = sortReceivables([r(1, null, 100), r(2, null, 500)]);
    expect(out[0].bookingId).toBe(2);
  });
});
