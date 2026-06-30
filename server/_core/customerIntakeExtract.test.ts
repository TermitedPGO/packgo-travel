/**
 * customerIntakeExtract vitest — covers the pure intake helpers used by
 * admin.extractCustomerFromFile. The LLM call + attachment parser are IO-bound
 * (no DB / no ANTHROPIC_API_KEY locally) so they are NOT exercised here; only
 * the pure normalizer + the size-guard boundary, which is all the business
 * logic worth pinning.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeExtractedCustomer,
  isIntakeTooLarge,
  MAX_INTAKE_BYTES,
} from "./customerIntakeExtract";

describe("normalizeExtractedCustomer", () => {
  it("passes valid values through unchanged", () => {
    expect(
      normalizeExtractedCustomer({
        name: "王小明",
        email: "wang@example.com",
        phone: "+1 510-555-1234",
      }),
    ).toEqual({
      name: "王小明",
      email: "wang@example.com",
      phone: "+1 510-555-1234",
    });
  });

  it("trims surrounding whitespace on every field", () => {
    expect(
      normalizeExtractedCustomer({
        name: "  Jeff Hsieh  ",
        email: "  jeff@packgoplay.com\n",
        phone: "\t+1 408 555 0000 ",
      }),
    ).toEqual({
      name: "Jeff Hsieh",
      email: "jeff@packgoplay.com",
      phone: "+1 408 555 0000",
    });
  });

  it("maps empty-string email to null", () => {
    const r = normalizeExtractedCustomer({ name: "A", email: "", phone: "123" });
    expect(r.email).toBeNull();
    expect(r.phone).toBe("123");
  });

  it("maps whitespace-only email to null", () => {
    const r = normalizeExtractedCustomer({ name: "A", email: "   \t\n ", phone: "123" });
    expect(r.email).toBeNull();
  });

  it("maps empty-string phone to null", () => {
    const r = normalizeExtractedCustomer({ name: "A", email: "a@b.com", phone: "" });
    expect(r.phone).toBeNull();
    expect(r.email).toBe("a@b.com");
  });

  it("maps whitespace-only phone to null", () => {
    const r = normalizeExtractedCustomer({ name: "A", email: "a@b.com", phone: "  " });
    expect(r.phone).toBeNull();
  });

  it("returns name='' (not null) when name is missing, with ok-able shape", () => {
    const r = normalizeExtractedCustomer({ email: "a@b.com" });
    expect(r.name).toBe("");
    expect(r.email).toBe("a@b.com");
    expect(r.phone).toBeNull();
  });

  it("handles all fields missing", () => {
    expect(normalizeExtractedCustomer({})).toEqual({
      name: "",
      email: null,
      phone: null,
    });
  });

  it("handles null / undefined raw input", () => {
    expect(normalizeExtractedCustomer(null)).toEqual({
      name: "",
      email: null,
      phone: null,
    });
    expect(normalizeExtractedCustomer(undefined)).toEqual({
      name: "",
      email: null,
      phone: null,
    });
  });

  it("coerces non-string fields to safe defaults (never throws)", () => {
    // The LLM is schema-constrained to strings, but be defensive about a
    // malformed object — numbers / objects collapse to '' rather than crash.
    const r = normalizeExtractedCustomer({
      name: 123 as unknown as string,
      email: {} as unknown as string,
      phone: undefined,
    });
    expect(r).toEqual({ name: "", email: null, phone: null });
  });
});

describe("isIntakeTooLarge", () => {
  it("allows a buffer at exactly the ceiling", () => {
    expect(isIntakeTooLarge(MAX_INTAKE_BYTES)).toBe(false);
  });

  it("allows a buffer below the ceiling", () => {
    expect(isIntakeTooLarge(MAX_INTAKE_BYTES - 1)).toBe(false);
    expect(isIntakeTooLarge(0)).toBe(false);
  });

  it("rejects a buffer over the ceiling", () => {
    expect(isIntakeTooLarge(MAX_INTAKE_BYTES + 1)).toBe(true);
  });

  it("ceiling is 15 MB", () => {
    expect(MAX_INTAKE_BYTES).toBe(15 * 1024 * 1024);
  });
});
