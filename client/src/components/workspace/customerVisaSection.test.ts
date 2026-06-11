/**
 * customerVisaSection.test.ts — batch 6 m4: visa stepper mapping + status key derivation.
 */
import { describe, it, expect } from "vitest";

const STEPS = [
  "submitted",
  "paid",
  "documents_received",
  "processing",
  "approved",
  "completed",
] as const;

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function camelCase(s: string) {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
function statusI18nKey(status: string) {
  return `workspace.visaSt${capitalize(camelCase(status))}`;
}

describe("visa stepper mapping", () => {
  it("maps each status to a unique i18n key", () => {
    const keys = STEPS.map(statusI18nKey);
    expect(new Set(keys).size).toBe(STEPS.length);
    for (const k of keys) {
      expect(k).toMatch(/^workspace\.visaSt[A-Z]/);
    }
  });

  it("derives correct i18n keys for each status", () => {
    expect(statusI18nKey("submitted")).toBe("workspace.visaStSubmitted");
    expect(statusI18nKey("paid")).toBe("workspace.visaStPaid");
    expect(statusI18nKey("documents_received")).toBe("workspace.visaStDocumentsReceived");
    expect(statusI18nKey("processing")).toBe("workspace.visaStProcessing");
    expect(statusI18nKey("approved")).toBe("workspace.visaStApproved");
    expect(statusI18nKey("completed")).toBe("workspace.visaStCompleted");
  });

  it("stepper index for each status is correct", () => {
    STEPS.forEach((step, i) => {
      expect(STEPS.indexOf(step)).toBe(i);
    });
  });

  it("determines progress bar fill correctly", () => {
    const currentIdx = STEPS.indexOf("processing");
    expect(currentIdx).toBe(3);
    expect(currentIdx >= 0).toBe(true); // submitted done
    expect(currentIdx >= 1).toBe(true); // paid done
    expect(currentIdx >= 2).toBe(true); // documents_received done
    expect(currentIdx >= 3).toBe(true); // processing active
    expect(currentIdx >= 4).toBe(false); // approved not done
    expect(currentIdx >= 5).toBe(false); // completed not done
  });

  it("handles unknown status gracefully (indexOf returns -1)", () => {
    const unknownIdx = STEPS.indexOf("unknown" as any);
    expect(unknownIdx).toBe(-1);
    // no step should be marked done
    STEPS.forEach((_, i) => {
      expect(unknownIdx >= i).toBe(false);
    });
  });
});

describe("doc count parsing", () => {
  function parseDocCount(docs: string | null): number {
    if (!docs) return 0;
    try {
      const arr = JSON.parse(docs);
      return Array.isArray(arr) ? arr.length : 0;
    } catch {
      return 0;
    }
  }

  it("returns 0 for null", () => {
    expect(parseDocCount(null)).toBe(0);
  });
  it("returns 0 for empty string", () => {
    expect(parseDocCount("")).toBe(0);
  });
  it("returns 0 for invalid JSON", () => {
    expect(parseDocCount("{broken")).toBe(0);
  });
  it("returns 0 for non-array JSON", () => {
    expect(parseDocCount('"just a string"')).toBe(0);
  });
  it("counts array items", () => {
    expect(parseDocCount('["a.pdf","b.jpg","c.png"]')).toBe(3);
  });
  it("returns 0 for empty array", () => {
    expect(parseDocCount("[]")).toBe(0);
  });
});
