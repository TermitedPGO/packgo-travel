import { describe, it, expect } from "vitest";
import {
  isCustomerDocAttachment,
  safeDocFilename,
  customerDocR2Key,
  MIN_IMAGE_DOC_BYTES,
} from "./customerDocFiling";

describe("customerDocFiling", () => {
  it("files document kinds (pdf/docx/xlsx/csv) regardless of size", () => {
    for (const k of ["pdf", "docx", "xlsx", "csv"] as const) {
      expect(isCustomerDocAttachment(k, 1)).toBe(true);
    }
  });

  it("files images only when big enough to be a real doc (not inline logos)", () => {
    expect(isCustomerDocAttachment("image", MIN_IMAGE_DOC_BYTES)).toBe(true);
    expect(isCustomerDocAttachment("image", MIN_IMAGE_DOC_BYTES - 1)).toBe(false);
  });

  it("does NOT file noise kinds (txt/json/html/unknown) or empty files", () => {
    for (const k of ["txt", "json", "html", "unknown"] as const) {
      expect(isCustomerDocAttachment(k, 999999)).toBe(false);
    }
    expect(isCustomerDocAttachment("pdf", 0)).toBe(false);
    expect(isCustomerDocAttachment("pdf", -5)).toBe(false);
    expect(isCustomerDocAttachment("pdf", NaN)).toBe(false);
  });

  it("safeDocFilename strips unsafe chars, caps length, never empty", () => {
    expect(safeDocFilename("我的 行程/itinerary final!.pdf")).toMatch(/itinerary_final_\.pdf$/);
    expect(safeDocFilename("")).toBe("document");
    expect(safeDocFilename("///")).toBe("document");
    expect(safeDocFilename("a".repeat(300)).length).toBeLessThanOrEqual(120);
  });

  it("customerDocR2Key namespaces under the private customer-docs prefix", () => {
    const key = customerDocR2Key(2550004, "itinerary.pdf", 1782000000000, "ab12cd");
    expect(key).toBe("customer-docs/2550004/1782000000000-ab12cd-itinerary.pdf");
    expect(key.startsWith("customer-docs/")).toBe(true);
  });
});
