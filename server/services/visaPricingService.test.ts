/**
 * visaPricingService.test.ts
 * Unit tests for China visa pricing logic
 */
import { describe, it, expect } from "vitest";
import {
  calculateVisaPricing,
  getConsulateFee,
  getSupportedCountries,
  getVisaTypeName,
  getEntryTypeName,
  getProcessingSpeedInfo,
  type PricingInput,
} from "./visaPricingService";

// ── calculateVisaPricing ──────────────────────────────────────

describe("calculateVisaPricing", () => {
  it("calculates basic L tourist visa (US passport, single, regular)", () => {
    const input: PricingInput = {
      visaType: "L_tourist",
      entryType: "single",
      processingSpeed: "regular",
      passportCountry: "United States",
    };
    const result = calculateVisaPricing(input);

    // serviceFee = 120 (base) + 0 (single) + 0 (regular) = 120, no discount
    expect(result.serviceFee).toBe(120);
    // consulateFee for US = 185
    expect(result.consulateFee).toBe(185);
    expect(result.totalAmount).toBe(305);
    expect(result.discountType).toBe("none");
    expect(result.discountAmount).toBe(0);
  });

  it("applies express surcharge correctly", () => {
    const input: PricingInput = {
      visaType: "L_tourist",
      entryType: "single",
      processingSpeed: "express",
      passportCountry: "Taiwan",
    };
    const result = calculateVisaPricing(input);

    // serviceFee = 120 + 0 + 60 = 180, consulateFee = 50
    expect(result.serviceFee).toBe(180);
    expect(result.consulateFee).toBe(50);
    expect(result.totalAmount).toBe(230);
  });

  it("applies rush surcharge correctly", () => {
    const input: PricingInput = {
      visaType: "M_business",
      entryType: "double",
      processingSpeed: "rush",
      passportCountry: "Canada",
    };
    const result = calculateVisaPricing(input);

    // serviceFee = 150 + 20 + 120 = 290, consulateFee = 100
    expect(result.serviceFee).toBe(290);
    expect(result.consulateFee).toBe(100);
    expect(result.totalAmount).toBe(390);
  });

  it("applies multiple_12m entry surcharge", () => {
    const input: PricingInput = {
      visaType: "L_tourist",
      entryType: "multiple_12m",
      processingSpeed: "regular",
      passportCountry: "Japan",
    };
    const result = calculateVisaPricing(input);

    // serviceFee = 120 + 80 + 0 = 200, consulateFee = 50
    expect(result.serviceFee).toBe(200);
    expect(result.consulateFee).toBe(50);
    expect(result.totalAmount).toBe(250);
  });

  it("applies group discount (5+ people) — 10% off service fee", () => {
    const input: PricingInput = {
      visaType: "L_tourist",
      entryType: "single",
      processingSpeed: "regular",
      passportCountry: "Taiwan",
      groupSize: 5,
    };
    const result = calculateVisaPricing(input);

    // serviceSubtotal = 120, discount = 120 * 0.10 = 12
    expect(result.discountType).toBe("group");
    expect(result.discountAmount).toBe(12);
    expect(result.serviceFee).toBe(108);
    expect(result.consulateFee).toBe(50);
    expect(result.totalAmount).toBe(158);
  });

  it("does NOT apply group discount for 4 people", () => {
    const input: PricingInput = {
      visaType: "L_tourist",
      entryType: "single",
      processingSpeed: "regular",
      passportCountry: "Taiwan",
      groupSize: 4,
    };
    const result = calculateVisaPricing(input);

    expect(result.discountType).toBe("none");
    expect(result.discountAmount).toBe(0);
    expect(result.serviceFee).toBe(120);
  });

  it("applies returning customer discount — 5% off service fee", () => {
    const input: PricingInput = {
      visaType: "L_tourist",
      entryType: "single",
      processingSpeed: "regular",
      passportCountry: "Taiwan",
      isReturningCustomer: true,
    };
    const result = calculateVisaPricing(input);

    // serviceSubtotal = 120, discount = 120 * 0.05 = 6
    expect(result.discountType).toBe("returning");
    expect(result.discountAmount).toBe(6);
    expect(result.serviceFee).toBe(114);
    expect(result.totalAmount).toBe(164);
  });

  it("group discount takes priority over returning customer discount", () => {
    const input: PricingInput = {
      visaType: "L_tourist",
      entryType: "single",
      processingSpeed: "regular",
      passportCountry: "Taiwan",
      groupSize: 6,
      isReturningCustomer: true,
    };
    const result = calculateVisaPricing(input);

    // Group discount should win
    expect(result.discountType).toBe("group");
    expect(result.discountAmount).toBe(12); // 10% of 120
  });

  it("uses default consulate fee for unknown country", () => {
    const input: PricingInput = {
      visaType: "L_tourist",
      entryType: "single",
      processingSpeed: "regular",
      passportCountry: "Other",
    };
    const result = calculateVisaPricing(input);

    // Default consulate fee should be used (not 0)
    expect(result.consulateFee).toBeGreaterThan(0);
  });

  it("calculates Z work visa correctly", () => {
    const input: PricingInput = {
      visaType: "Z_work",
      entryType: "single",
      processingSpeed: "regular",
      passportCountry: "United States",
    };
    const result = calculateVisaPricing(input);

    // serviceFee = 200, consulateFee = 185
    expect(result.serviceFee).toBe(200);
    expect(result.consulateFee).toBe(185);
    expect(result.totalAmount).toBe(385);
  });

  it("breakdown fields sum correctly", () => {
    const input: PricingInput = {
      visaType: "M_business",
      entryType: "multiple_6m",
      processingSpeed: "express",
      passportCountry: "United Kingdom",
    };
    const result = calculateVisaPricing(input);
    const bd = result.breakdown;

    const expectedServiceSubtotal = bd.baseServiceFee + bd.entryTypeSurcharge + bd.processingSpeedSurcharge;
    const expectedServiceFee = expectedServiceSubtotal - bd.discountAmount;
    const expectedTotal = expectedServiceFee + bd.consulateFee;

    expect(expectedTotal).toBeCloseTo(result.totalAmount, 2);
    expect(result.totalAmount).toBe(bd.totalAmount);
  });
});

// ── getConsulateFee ───────────────────────────────────────────

describe("getConsulateFee", () => {
  it("returns 185 for United States", () => {
    expect(getConsulateFee("United States")).toBe(185);
  });

  it("returns 50 for Taiwan", () => {
    expect(getConsulateFee("Taiwan")).toBe(50);
  });

  it("returns default fee for unknown country", () => {
    const fee = getConsulateFee("UnknownCountry");
    expect(typeof fee).toBe("number");
    expect(fee).toBeGreaterThan(0);
  });
});

// ── getSupportedCountries ─────────────────────────────────────

describe("getSupportedCountries", () => {
  it("returns a non-empty array", () => {
    const countries = getSupportedCountries();
    expect(Array.isArray(countries)).toBe(true);
    expect(countries.length).toBeGreaterThan(0);
  });

  it("includes United States and Taiwan", () => {
    const countries = getSupportedCountries();
    expect(countries).toContain("United States");
    expect(countries).toContain("Taiwan");
  });

  it("includes Other as fallback", () => {
    const countries = getSupportedCountries();
    expect(countries).toContain("Other");
  });
});

// ── getVisaTypeName ───────────────────────────────────────────

describe("getVisaTypeName", () => {
  it("returns Chinese name for L_tourist by default", () => {
    const name = getVisaTypeName("L_tourist");
    expect(name).toContain("L");
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("returns English name when lang=en", () => {
    const name = getVisaTypeName("L_tourist", "en");
    expect(name).toContain("Tourist");
  });

  it("returns name for Z_work visa", () => {
    const name = getVisaTypeName("Z_work", "zh");
    expect(name).toContain("Z");
  });
});

// ── getEntryTypeName ──────────────────────────────────────────

describe("getEntryTypeName", () => {
  it("returns Chinese name for single entry", () => {
    const name = getEntryTypeName("single");
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("returns English name for multiple_12m when lang=en", () => {
    const name = getEntryTypeName("multiple_12m", "en");
    expect(name).toContain("12");
  });
});

// ── getProcessingSpeedInfo ────────────────────────────────────

describe("getProcessingSpeedInfo", () => {
  it("returns label and duration for regular", () => {
    const info = getProcessingSpeedInfo("regular");
    expect(info).toHaveProperty("label");
    expect(info).toHaveProperty("duration");
    expect(info.label.length).toBeGreaterThan(0);
    expect(info.duration.length).toBeGreaterThan(0);
  });

  it("returns English info for express when lang=en", () => {
    const info = getProcessingSpeedInfo("express", "en");
    expect(info.label).toBe("Express");
    expect(info.duration).toContain("5-7");
  });

  it("returns rush info with 2-3 day duration", () => {
    const info = getProcessingSpeedInfo("rush", "en");
    expect(info.duration).toContain("2-3");
  });
});
