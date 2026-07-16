/**
 * pdf-attachment-reliability (2026-07-15) — the single pdf-parse v2 adapter.
 *
 * 2026-07-15 incident: repo runtime is pdf-parse@2.4.5 (v2, class API) but the
 * shared parser still resolved a v1 callable → every PDF died with
 * "pdf-parse export is not callable" BEFORE reading a byte, and the old
 * resolver tests were fake-green because they only fed hand-made v1 shapes.
 *
 * Rule locked here: these tests load the REAL installed pdf-parse module —
 * never a mocked v1 function — so a future major-version API drift goes red
 * immediately instead of only failing in prod.
 */

import { describe, it, expect } from "vitest";

import {
  extractPdfTextPrimary,
  resolvePdfParseClass,
  PDF_MAX_PAGES,
  MIN_PDF_TEXT_CHARS,
} from "./pdfParse";
import {
  buildItineraryPdf,
  buildNoTextPdf,
  buildCorruptPdf,
} from "./pdfTestFixture";

describe("resolvePdfParseClass — real installed pdf-parse@2.x module", () => {
  it("resolves the PDFParse class from the ACTUAL repo-installed module", async () => {
    const mod = await import("pdf-parse");
    const ctor = resolvePdfParseClass(mod);
    expect(typeof ctor).toBe("function");
  });

  it("unwraps bundler default-wrapped shapes (the prod-esbuild lesson)", () => {
    class Fake {}
    expect(resolvePdfParseClass({ PDFParse: Fake })).toBe(Fake);
    expect(resolvePdfParseClass({ default: { PDFParse: Fake } })).toBe(Fake);
    expect(
      resolvePdfParseClass({ default: { default: { PDFParse: Fake } } }),
    ).toBe(Fake);
  });

  it("returns null for v1-style modules (callable export, no PDFParse class)", () => {
    const v1fn = async () => ({ text: "v1" });
    expect(resolvePdfParseClass(v1fn)).toBe(null);
    expect(resolvePdfParseClass({ default: v1fn })).toBe(null);
    expect(resolvePdfParseClass(null)).toBe(null);
    expect(resolvePdfParseClass({})).toBe(null);
  });
});

describe("extractPdfTextPrimary — real pdf-parse against generated PDFs", () => {
  it("extracts full text + page count from a valid text PDF", async () => {
    const result = await extractPdfTextPrimary(buildItineraryPdf());
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("PACKGO PARSER FIXTURE");
    expect(result.text).toContain("scenic railway ride");
    expect(result.text.trim().length).toBeGreaterThan(MIN_PDF_TEXT_CHARS);
  });

  it("strips pdf-parse v2 page markers ('-- N of M --') from the text", async () => {
    // v2's TextResult.text injects a page marker per page; a 50-page scanned
    // PDF would accumulate ~650 chars of pure markers and defeat the
    // thin-text fallback threshold. The adapter must join pages[].text itself.
    const withText = await extractPdfTextPrimary(buildItineraryPdf());
    expect(withText.text).not.toMatch(/-- \d+ of \d+ --/);
    const noText = await extractPdfTextPrimary(buildNoTextPdf());
    expect(noText.text.trim()).toBe("");
    expect(noText.pageCount).toBe(1);
  });

  it("throws on structurally invalid PDF bytes (callers route to fallback)", async () => {
    await expect(extractPdfTextPrimary(buildCorruptPdf())).rejects.toThrow();
  });

  it("caps at PDF_MAX_PAGES pages by default", () => {
    expect(PDF_MAX_PAGES).toBe(50);
  });
});
