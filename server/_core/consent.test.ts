/**
 * Tests for §17550 consent capture. This record is dispute evidence, so "did the
 * customer accept" must map to a stamped timestamp + version, and "didn't accept"
 * must map to nulls (never a false record of consent).
 */
import { describe, it, expect } from "vitest";
import { consentFields, DISCLOSURE_VERSION } from "@shared/consent";

describe("consentFields", () => {
  const now = new Date("2026-06-04T12:00:00.000Z");

  it("stamps timestamp + current version when accepted", () => {
    const r = consentFields(true, now);
    expect(r.disclaimerAcceptedAt).toBe(now);
    expect(r.disclaimerVersion).toBe(DISCLOSURE_VERSION);
  });

  it("records nulls when not accepted (never a false consent)", () => {
    for (const v of [false, undefined]) {
      const r = consentFields(v, now);
      expect(r.disclaimerAcceptedAt).toBeNull();
      expect(r.disclaimerVersion).toBeNull();
    }
  });

  it("has a non-empty version constant", () => {
    expect(typeof DISCLOSURE_VERSION).toBe("string");
    expect(DISCLOSURE_VERSION.length).toBeGreaterThan(0);
  });
});
