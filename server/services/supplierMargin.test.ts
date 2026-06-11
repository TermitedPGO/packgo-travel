/**
 * Tests for supplierMargin.shapeMarginAudit (批5 m5) — margin math,
 * threshold flag, currency-mismatch honesty, sort order.
 */
import { describe, it, expect } from "vitest";
import {
  shapeMarginAudit,
  type MarginAuditRawRow,
} from "./supplierMargin";

const row = (over: Partial<MarginAuditRawRow>): MarginAuditRawRow => ({
  tourId: 1,
  title: "UV 京阪神 5 日",
  price: 1560,
  priceCurrency: "USD",
  externalProductCode: "P00008687",
  supplierCode: "uv",
  minCost: "1420.00",
  costCurrency: "USD",
  ...over,
});

describe("shapeMarginAudit", () => {
  it("computes margin = (price − cost) / price, rounded 3dp", () => {
    const [m] = shapeMarginAudit([row({})], 0.15);
    // (1560 − 1420) / 1560 = 0.0897…
    expect(m.margin).toBe(0.09);
    expect(m.cost).toBe(1420);
  });

  it("flags below threshold (mockup: 9% < 15% 安全線)", () => {
    const [m] = shapeMarginAudit([row({})], 0.15);
    expect(m.belowThreshold).toBe(true);
  });

  it("healthy margin not flagged", () => {
    const [m] = shapeMarginAudit(
      [row({ price: 2000, minCost: "1420" })],
      0.15,
    );
    expect(m.margin).toBe(0.29);
    expect(m.belowThreshold).toBe(false);
  });

  it("currency mismatch → margin null, mismatch flag, never converts", () => {
    const [m] = shapeMarginAudit(
      [row({ priceCurrency: "USD", costCurrency: "TWD" })],
      0.15,
    );
    expect(m.margin).toBeNull();
    expect(m.currencyMismatch).toBe(true);
    expect(m.belowThreshold).toBe(false);
    expect(m.cost).toBe(1420); // cost still shown, just not computed against
  });

  it("missing / zero cost → margin null, no flags", () => {
    const [a] = shapeMarginAudit([row({ minCost: null })], 0.15);
    expect(a.margin).toBeNull();
    expect(a.cost).toBeNull();
    const [b] = shapeMarginAudit([row({ minCost: "0" })], 0.15);
    expect(b.margin).toBeNull();
  });

  it("price <= 0 → margin null (bad data stays visible, not divided)", () => {
    const [m] = shapeMarginAudit([row({ price: 0 })], 0.15);
    expect(m.margin).toBeNull();
  });

  it("sorts worst margin first, non-computable rows sink to bottom", () => {
    const out = shapeMarginAudit(
      [
        row({ tourId: 1, price: 2000 }), // 29%
        row({ tourId: 2 }), // 9%
        row({ tourId: 3, costCurrency: "TWD" }), // mismatch → null
        row({ tourId: 4, price: 1500 }), // 5.3%
      ],
      0.15,
    );
    expect(out.map((m) => m.tourId)).toEqual([4, 2, 1, 3]);
  });

  it("negative margin (selling below cost) sorts first", () => {
    const out = shapeMarginAudit(
      [row({ tourId: 1 }), row({ tourId: 2, price: 1300 })],
      0.15,
    );
    expect(out[0].tourId).toBe(2);
    expect(out[0].margin).toBeLessThan(0);
  });
});
