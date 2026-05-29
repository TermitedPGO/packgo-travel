/**
 * Unit tests for foldOutstandingTrust — the pure outstanding-trust summation
 * core (M5, 2026-05-28).
 *
 * CST §17550 reconciliation: outstanding = sum(amount) of deferred rows that
 * are NOT yet recognized and NOT reversed. unmatched = the subset with no
 * linked bookingId (deposits Jeff still has to attach to a trip). The DB query
 * lives in computeOutstandingTrust; this fold is the testable money math.
 */
import { describe, it, expect } from "vitest";
import {
  foldOutstandingTrust,
  type TrustDeferredRowLike,
} from "./trustDeferralService";

describe("foldOutstandingTrust — outstanding + unmatched", () => {
  it("sums all rows into totalOutstanding and counts rows", () => {
    const rows: TrustDeferredRowLike[] = [
      { amount: "1000", bookingId: 11 },
      { amount: "2500", bookingId: 12 },
      { amount: "408", bookingId: null },
    ];
    const r = foldOutstandingTrust(rows);
    expect(r.totalOutstanding).toBe(3908);
    expect(r.rowCount).toBe(3);
  });

  it("flags rows without a bookingId as unmatched (needs Jeff to link)", () => {
    const rows: TrustDeferredRowLike[] = [
      { amount: "1000", bookingId: 11 }, // matched
      { amount: "408", bookingId: null }, // unmatched
      { amount: "200" }, // unmatched (undefined bookingId)
    ];
    const r = foldOutstandingTrust(rows);
    expect(r.unmatchedCount).toBe(2);
    expect(r.unmatchedTotal).toBe(608);
    // matched portion is the remainder
    expect(r.totalOutstanding - r.unmatchedTotal).toBe(1000);
  });

  it("handles string and number amounts, tolerates garbage as 0", () => {
    const rows: TrustDeferredRowLike[] = [
      { amount: 500, bookingId: 1 },
      { amount: "1500.50", bookingId: 2 },
      { amount: null, bookingId: 3 },
      { amount: "not-a-number", bookingId: 4 },
    ];
    const r = foldOutstandingTrust(rows);
    expect(r.totalOutstanding).toBeCloseTo(2000.5, 2);
    expect(r.rowCount).toBe(4);
    expect(r.unmatchedCount).toBe(0);
  });

  it("empty ledger is all zeros", () => {
    const r = foldOutstandingTrust([]);
    expect(r).toEqual({
      totalOutstanding: 0,
      rowCount: 0,
      unmatchedCount: 0,
      unmatchedTotal: 0,
    });
  });
});
