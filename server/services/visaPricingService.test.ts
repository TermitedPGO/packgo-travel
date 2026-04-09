import { describe, it, expect } from "vitest";
import { calculateVisaPricing, CHINA_VISA_PRICING } from "./visaPricingService";

describe("calculateVisaPricing", () => {
  it("1 person = $290", () => {
    const r = calculateVisaPricing({ groupSize: 1 });
    expect(r.pricePerPerson).toBe(290);
    expect(r.grandTotal).toBe(290);
    expect(r.isGroupDiscount).toBe(false);
    expect(r.savedPerPerson).toBe(0);
  });

  it("2 people = $275 × 2 = $550 (group discount)", () => {
    const r = calculateVisaPricing({ groupSize: 2 });
    expect(r.pricePerPerson).toBe(275);
    expect(r.grandTotal).toBe(550);
    expect(r.isGroupDiscount).toBe(true);
    expect(r.savedPerPerson).toBe(15);
  });

  it("3 people = $275 × 3 = $825", () => {
    const r = calculateVisaPricing({ groupSize: 3 });
    expect(r.pricePerPerson).toBe(275);
    expect(r.grandTotal).toBe(825);
  });

  it("5 people = $275 × 5 = $1,375", () => {
    const r = calculateVisaPricing({ groupSize: 5 });
    expect(r.grandTotal).toBe(1375);
  });

  it("pricing constants are correct", () => {
    expect(CHINA_VISA_PRICING.regular).toBe(290);
    expect(CHINA_VISA_PRICING.group).toBe(275);
    expect(CHINA_VISA_PRICING.groupMinSize).toBe(2);
  });
});
