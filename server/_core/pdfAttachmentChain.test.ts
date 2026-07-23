/**
 * pdf-attachment-reliability (2026-07-15) — REAL-PDF full-chain regression:
 * generated PDF bytes → real parseAttachment (real pdf-parse@2.4.5) →
 * buildCustomerDocsText → the customer-AI context actually contains the
 * document's FULL TEXT, not just its filename.
 *
 * This is the exact chain that broke in prod: the parser died on the v1/v2
 * API mismatch, customerDocsText silently skipped the non-ok doc, and the
 * customer-page AI saw a file list with no content — then told the customer
 * the file "couldn't be parsed". The old tests never went red because every
 * layer mocked the parser. Here only the LLM fallback (imageOcr) is mocked;
 * pdf-parse and the chain are real.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("./imageOcr", () => ({
  extractImageText: vi.fn(),
  extractPdfText: vi.fn().mockResolvedValue({ ok: false, text: "" }),
}));

import { parseAttachment } from "./attachmentParser";
import { buildCustomerDocsText, type DocsTextDeps } from "./customerDocsText";
import { buildItineraryPdf } from "./pdfTestFixture";

describe("real PDF → parseAttachment → buildCustomerDocsText (full chain)", () => {
  it("customer docs context gets readCount > 0 and non-empty fullText", async () => {
    const pdfBytes = buildItineraryPdf();
    const deps: DocsTextDeps = {
      fetchBytes: async () => ({ bytes: pdfBytes, mimeType: "application/pdf" }),
      // REAL parser — the seam is only used to avoid R2/network, not pdf-parse.
      parse: async (filename, mimeType, data) => {
        const r = await parseAttachment(filename, mimeType, data);
        return { text: r.text, parseStatus: r.parseStatus };
      },
    };

    const result = await buildCustomerDocsText(
      [
        {
          kind: "quote",
          name: "fixture-quote",
          url: "https://example.test/fixture-quote.pdf",
        },
      ],
      deps,
    );

    expect(result.readCount).toBeGreaterThan(0);
    expect(result.fullText.length).toBeGreaterThan(0);
    expect(result.fullText).toContain("PACKGO PARSER FIXTURE");
    expect(result.fullText).toContain("scenic railway ride");
    expect(result.list).toContain("fixture-quote");
  });
});
