/**
 * Tests for piiScrub — payment-card redaction. Uses only public test PANs
 * (4111…1111 etc.), never real customer data.
 */
import { describe, it, expect } from "vitest";
import {
  luhnValid,
  scrubPaymentCards,
  containsPaymentCard,
  scrubPii,
} from "./piiScrub";

const VISA = "4111111111111111"; // public Visa test PAN, Luhn-valid
const VISA_BAD = "4111111111111112"; // check digit broken → Luhn-invalid
const MC = "5500005555555559"; // public Mastercard test PAN, Luhn-valid

describe("luhnValid", () => {
  it("accepts valid test PANs, rejects broken ones", () => {
    expect(luhnValid(VISA)).toBe(true);
    expect(luhnValid(MC)).toBe(true);
    expect(luhnValid(VISA_BAD)).toBe(false);
  });
  it("rejects non-13-19-digit strings", () => {
    expect(luhnValid("1234567890")).toBe(false); // 10 digits
    expect(luhnValid("")).toBe(false);
  });
});

describe("scrubPaymentCards", () => {
  it("redacts a spaced PAN keeping the last 4", () => {
    const out = scrubPaymentCards("card: 4111 1111 1111 1111 thanks");
    expect(out).not.toContain("4111 1111 1111 1111");
    expect(out).toContain("****1111");
    expect(out).toContain("thanks");
  });

  it("redacts dash-separated and bare PANs", () => {
    expect(scrubPaymentCards("4111-1111-1111-1111")).toContain("****1111");
    expect(scrubPaymentCards("pan 5500005555555559 end")).toContain("****5559");
  });

  it("redacts multiple cards in one body", () => {
    const out = scrubPaymentCards(`a ${VISA} b ${MC} c`);
    expect(out).toContain("****1111");
    expect(out).toContain("****5559");
    expect(out).not.toContain(VISA);
    expect(out).not.toContain(MC);
  });

  it("leaves Luhn-invalid long numbers alone (order ids, not cards)", () => {
    expect(scrubPaymentCards(`order ${VISA_BAD} shipped`)).toContain(VISA_BAD);
  });

  it("leaves short numbers (phone) alone", () => {
    expect(scrubPaymentCards("call 415-555-1234")).toContain("415-555-1234");
  });

  it("is a no-op on empty / card-free text", () => {
    expect(scrubPaymentCards("")).toBe("");
    expect(scrubPaymentCards("no cards here, just words")).toBe(
      "no cards here, just words",
    );
  });
});

describe("containsPaymentCard", () => {
  it("detects a valid PAN, ignores broken/short ones", () => {
    expect(containsPaymentCard(`here ${VISA}`)).toBe(true);
    expect(containsPaymentCard(`here ${VISA_BAD}`)).toBe(false);
    expect(containsPaymentCard("415-555-1234")).toBe(false);
    expect(containsPaymentCard("")).toBe(false);
  });
});

describe("scrubPii (entry point)", () => {
  it("redacts cards", () => {
    expect(scrubPii(`pay ${VISA}`)).toContain("****1111");
  });
});
