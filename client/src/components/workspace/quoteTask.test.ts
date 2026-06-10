/**
 * Tests for quoteTask — quote-lane payload parse for workspace cards (批2 m2).
 */
import { describe, it, expect } from "vitest";
import { parseQuoteCard } from "./quoteTask";

const base = {
  tourId: 5,
  tourTitle: "北海道溫泉 6 日",
  currency: "USD",
};

describe("parseQuoteCard", () => {
  it("prefers Jeff's finalPrice over the supplier seed", () => {
    const info = parseQuoteCard(
      JSON.stringify({ ...base, supplierPrice: 3280, finalPrice: 3400 }),
    );
    expect(info).toMatchObject({
      price: 3400,
      priceKind: "final",
      currency: "USD",
      fromSupplier: true,
    });
  });

  it("falls back to supplier 直客價 when no finalPrice", () => {
    const info = parseQuoteCard(
      JSON.stringify({ ...base, supplierPrice: 3280 }),
    );
    expect(info).toMatchObject({ price: 3280, priceKind: "supplier" });
  });

  it("custom trip → no price, manual flag", () => {
    const info = parseQuoteCard(
      JSON.stringify({ ...base, isCustomTrip: true }),
    );
    expect(info).toMatchObject({
      price: null,
      priceKind: null,
      isCustomTrip: true,
      fromSupplier: false,
    });
  });

  it("returns null on malformed / non-quote payloads instead of throwing", () => {
    expect(parseQuoteCard("not json")).toBeNull();
    expect(parseQuoteCard(JSON.stringify({ draftBody: "cs shape" }))).toBeNull();
    expect(parseQuoteCard(JSON.stringify([1, 2]))).toBeNull();
  });

  it("defaults currency to USD when absent", () => {
    const info = parseQuoteCard(
      JSON.stringify({ tourId: 1, tourTitle: "T", supplierPrice: 100 }),
    );
    expect(info?.currency).toBe("USD");
  });
});
