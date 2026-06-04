/**
 * Tests for the per-booking margin arithmetic. A wrong margin would mislead
 * Jeff's pricing decisions, so the edges (no cost entered, zero sell price,
 * selling below cost) are pinned down.
 */
import { describe, it, expect } from "vitest";
import { computeMargin } from "@shared/bookingMargin";

describe("computeMargin", () => {
  it("computes margin + percentage from a normal sell/cost", () => {
    const r = computeMargin(1000, 700);
    expect(r.margin).toBe(300);
    expect(r.marginPct).toBe(30);
    expect(r.isNegative).toBe(false);
    expect(r.hasCost).toBe(true);
  });

  it("flags a negative margin when selling below cost", () => {
    const r = computeMargin(700, 1000);
    expect(r.margin).toBe(-300);
    expect(r.isNegative).toBe(true);
    expect(r.marginPct).toBeCloseTo(-42.9, 1);
  });

  it("treats a missing supplier cost as 'no margin to show' (not zero margin)", () => {
    for (const v of [null, undefined, NaN]) {
      const r = computeMargin(1000, v as number | null | undefined);
      expect(r.hasCost).toBe(false);
      expect(r.marginPct).toBeNull();
      expect(r.isNegative).toBe(false);
    }
  });

  it("zero cost is a real entry (100% margin), distinct from no cost", () => {
    const r = computeMargin(1000, 0);
    expect(r.hasCost).toBe(true);
    expect(r.margin).toBe(1000);
    expect(r.marginPct).toBe(100);
  });

  it("guards divide-by-zero when totalPrice is 0", () => {
    const r = computeMargin(0, 0);
    expect(r.marginPct).toBeNull();
    expect(r.margin).toBe(0);
    expect(r.isNegative).toBe(false);
  });

  it("rounds the percentage to one decimal place", () => {
    const r = computeMargin(3, 1); // 2/3 = 66.66...%
    expect(r.marginPct).toBe(66.7);
  });
});
