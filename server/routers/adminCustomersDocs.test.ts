import { describe, it, expect } from "vitest";
import {
  quoteDoc,
  invoiceDoc,
  uploadedDoc,
  flightOrderDoc,
  mergeDocs,
} from "./adminCustomersDocs";

const d = (iso: string) => new Date(iso);

describe("adminCustomersDocs — source normalization", () => {
  it("quote → q: id, download via pdfUrl, amount+status meta", () => {
    const doc = quoteDoc({
      id: 5,
      quoteNumber: "Q-2026-001",
      estimatedTotal: 45000,
      currency: "USD",
      pdfUrl: "https://r2/q5.pdf",
      status: "sent",
      createdAt: d("2026-06-01"),
    });
    expect(doc).toMatchObject({
      id: "q:5",
      kind: "quote",
      name: "Q-2026-001",
      url: "https://r2/q5.pdf",
      meta: "USD 45,000 · sent",
    });
  });

  it("invoice → inv: id, decimal-string amount handled", () => {
    const doc = invoiceDoc({
      id: 9,
      invoiceNumber: "INV-100",
      totalAmount: "1234.50",
      currency: "USD",
      pdfUrl: null,
      status: "paid",
      createdAt: d("2026-06-02"),
    });
    expect(doc.id).toBe("inv:9");
    expect(doc.kind).toBe("invoice");
    expect(doc.url).toBeNull();
    expect(doc.meta).toBe("USD 1,234.50 · paid");
  });

  it("uploaded passport → kind=passport, filename only (no PII numbers), download via r2Url", () => {
    const doc = uploadedDoc({
      id: 3,
      type: "passport",
      fileName: "jenny-passport.pdf",
      r2Url: "https://r2/p3.pdf",
      uploadedAt: d("2026-06-03"),
    });
    expect(doc).toMatchObject({
      id: "cd:3",
      kind: "passport",
      name: "jenny-passport.pdf",
      url: "https://r2/p3.pdf",
      meta: null,
    });
  });

  it("uploaded 'other' type maps to generic file kind", () => {
    expect(
      uploadedDoc({ id: 1, type: "other", fileName: "draft.docx", r2Url: "x", uploadedAt: d("2026-01-01") }).kind,
    ).toBe("file");
  });

  it("flight order → fo: id, info-only (no download), status meta", () => {
    const doc = flightOrderDoc({
      id: 7,
      airline: "EVA",
      flightSummary: "BR8 直飛 SFO⇄TPE",
      status: "ticketed",
      createdAt: d("2026-06-04"),
    });
    expect(doc).toMatchObject({
      id: "fo:7",
      kind: "flight",
      name: "EVA · BR8 直飛 SFO⇄TPE",
      url: null,
      meta: "ticketed",
    });
  });

  it("mergeDocs sorts newest-first across sources and caps to lim", () => {
    const out = mergeDocs(
      [
        [quoteDoc({ id: 1, quoteNumber: "Q1", estimatedTotal: null, currency: null, pdfUrl: null, status: null, createdAt: d("2026-01-01") })],
        [invoiceDoc({ id: 1, invoiceNumber: "INV1", totalAmount: null, currency: null, pdfUrl: null, status: null, createdAt: d("2026-03-01") })],
        [flightOrderDoc({ id: 1, airline: "A", flightSummary: "S", status: "prepared", createdAt: d("2026-02-01") })],
      ],
      2,
    );
    expect(out.map((x) => x.id)).toEqual(["inv:1", "fo:1"]); // newest 2, Q1 (oldest) dropped
  });

  it("namespaced ids never collide across tables for the same numeric id", () => {
    const ids = [
      quoteDoc({ id: 1, quoteNumber: "Q", estimatedTotal: null, currency: null, pdfUrl: null, status: null, createdAt: d("2026-01-01") }).id,
      invoiceDoc({ id: 1, invoiceNumber: "I", totalAmount: null, currency: null, pdfUrl: null, status: null, createdAt: d("2026-01-01") }).id,
      uploadedDoc({ id: 1, type: "visa", fileName: "v", r2Url: null, uploadedAt: d("2026-01-01") }).id,
      flightOrderDoc({ id: 1, airline: "A", flightSummary: "S", status: "prepared", createdAt: d("2026-01-01") }).id,
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it("amount formatting tolerates missing amount / non-numeric", () => {
    expect(
      quoteDoc({ id: 1, quoteNumber: "Q", estimatedTotal: null, currency: "USD", pdfUrl: null, status: null, createdAt: d("2026-01-01") }).meta,
    ).toBeNull();
  });
});
