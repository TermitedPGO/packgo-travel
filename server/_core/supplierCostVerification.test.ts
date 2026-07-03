/**
 * Tests for supplierCostVerification (Phase2 2b) — supplierCost may never be
 * an LLM-invented number. verifyAmountInDocumentText is pure (no mocks needed).
 * resolveAndVerifySupplierCost is DB-touching; getDb/schema/extractDocTextCached
 * are mocked so no real R2/MySQL is touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockExtractDocTextCached = vi.fn();
vi.mock("./customerDocsText", () => ({
  extractDocTextCached: (...args: any[]) => mockExtractDocTextCached(...args),
}));

// Chainable Drizzle mock: select().from().where().limit() → resolves to nextRows.
let nextRows: any[] = [];
let dbUnavailable = false;
function makeDb() {
  const chain: any = {};
  for (const m of ["select", "from", "where"]) chain[m] = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(nextRows));
  return chain;
}
vi.mock("../db", () => ({
  getDb: vi.fn(async () => (dbUnavailable ? null : makeDb())),
}));
vi.mock("../../drizzle/schema", () => ({
  customerDocuments: { id: "id", customerProfileId: "cpid", type: "t", fileName: "fn", r2Url: "url" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (...args: any[]) => ({ _op: "eq", args }),
}));

import { verifyAmountInDocumentText, resolveAndVerifySupplierCost } from "./supplierCostVerification";

describe("verifyAmountInDocumentText (pure)", () => {
  it("matches a plain decimal amount", () => {
    expect(verifyAmountInDocumentText(5794, "Total due: 5794.00")).toBe(true);
  });

  it("matches a $ + thousands-comma amount", () => {
    expect(verifyAmountInDocumentText(5794, "Grand Total: $5,794.00")).toBe(true);
  });

  it("matches a bare number without decimals", () => {
    expect(verifyAmountInDocumentText(5794, "amount 5794 due on receipt")).toBe(true);
  });

  it("matches a foreign-currency-prefixed amount, ignoring the currency code (currency-agnostic)", () => {
    expect(verifyAmountInDocumentText(172600, "小計 NT$172,600 應付")).toBe(true);
  });

  it("matches within the 0.01 tolerance", () => {
    expect(verifyAmountInDocumentText(5794, "5793.995")).toBe(true);
  });

  it("returns false when the amount is not present anywhere", () => {
    expect(verifyAmountInDocumentText(5794, "Total: $1,234.00 and $9,999.00")).toBe(false);
  });

  it("returns false for empty document text", () => {
    expect(verifyAmountInDocumentText(5794, "")).toBe(false);
    expect(verifyAmountInDocumentText(5794, "   ")).toBe(false);
  });

  it("returns false for a non-finite claimed amount (defensive)", () => {
    expect(verifyAmountInDocumentText(NaN, "5794")).toBe(false);
    expect(verifyAmountInDocumentText(Infinity, "5794")).toBe(false);
  });

  it("returns false when the document has no amount-shaped tokens at all", () => {
    expect(verifyAmountInDocumentText(5794, "no numbers here whatsoever")).toBe(false);
  });
});

describe("resolveAndVerifySupplierCost (DB-touching coordinator)", () => {
  beforeEach(() => {
    nextRows = [];
    dbUnavailable = false;
    mockExtractDocTextCached.mockReset();
  });

  it("rejects when the document does not exist", async () => {
    nextRows = [];
    const r = await resolveAndVerifySupplierCost({
      claimedAmount: 100,
      sourceDocId: 999,
      customerProfileId: 1,
    });
    expect(r).toEqual({ ok: false, reason: "找不到指定的文件" });
    expect(mockExtractDocTextCached).not.toHaveBeenCalled();
  });

  it("cross-customer guard: rejects when the doc belongs to a DIFFERENT customer", async () => {
    nextRows = [{ id: 5, customerProfileId: 999, type: "other", fileName: "invoice.pdf", r2Url: "k/invoice.pdf" }];
    const r = await resolveAndVerifySupplierCost({
      claimedAmount: 100,
      sourceDocId: 5,
      customerProfileId: 1, // NOT 999
    });
    expect(r).toEqual({ ok: false, reason: "這份文件不屬於這位客人" });
    expect(mockExtractDocTextCached).not.toHaveBeenCalled();
  });

  it.each(["passport", "visa", "insurance", "medical"])(
    "rejects PII doc type (%s) as cost evidence",
    async (type) => {
      nextRows = [{ id: 5, customerProfileId: 1, type, fileName: "scan.pdf", r2Url: "k/scan.pdf" }];
      const r = await resolveAndVerifySupplierCost({
        claimedAmount: 100,
        sourceDocId: 5,
        customerProfileId: 1,
      });
      expect(r).toEqual({ ok: false, reason: "不可用個資文件作為成本佐證" });
      expect(mockExtractDocTextCached).not.toHaveBeenCalled();
    },
  );

  it("rejects when the document text cannot be read (parse/fetch failure)", async () => {
    nextRows = [{ id: 5, customerProfileId: 1, type: "other", fileName: "invoice.pdf", r2Url: "k/invoice.pdf" }];
    mockExtractDocTextCached.mockResolvedValue(null);
    const r = await resolveAndVerifySupplierCost({
      claimedAmount: 100,
      sourceDocId: 5,
      customerProfileId: 1,
    });
    expect(r).toEqual({ ok: false, reason: "無法讀取該文件內容,請確認文件可正常開啟" });
  });

  it("rejects when the claimed amount does not appear in the document text", async () => {
    nextRows = [{ id: 5, customerProfileId: 1, type: "other", fileName: "invoice.pdf", r2Url: "k/invoice.pdf" }];
    mockExtractDocTextCached.mockResolvedValue("Total: $999.00");
    const r = await resolveAndVerifySupplierCost({
      claimedAmount: 6621.4,
      sourceDocId: 5,
      customerProfileId: 1,
    });
    expect(r).toEqual({ ok: false, reason: "這個金額沒有出現在指定文件裡" });
  });

  it("succeeds when the claimed amount appears in the document text, and passes a PDF-eligible kind through", async () => {
    nextRows = [{ id: 5, customerProfileId: 1, type: "other", fileName: "invoice.pdf", r2Url: "k/invoice.pdf" }];
    mockExtractDocTextCached.mockResolvedValue("Grand Total: $6,621.40");
    const r = await resolveAndVerifySupplierCost({
      claimedAmount: 6621.4,
      sourceDocId: 5,
      customerProfileId: 1,
    });
    expect(r).toEqual({ ok: true });
    expect(mockExtractDocTextCached).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "invoice", url: "k/invoice.pdf" }),
    );
  });

  it("never throws — an unexpected DB error is swallowed into {ok:false}", async () => {
    dbUnavailable = false;
    mockExtractDocTextCached.mockImplementation(() => {
      throw new Error("boom");
    });
    nextRows = [{ id: 5, customerProfileId: 1, type: "other", fileName: "invoice.pdf", r2Url: "k/invoice.pdf" }];
    await expect(
      resolveAndVerifySupplierCost({ claimedAmount: 100, sourceDocId: 5, customerProfileId: 1 }),
    ).resolves.toEqual({ ok: false, reason: "驗證過程發生錯誤" });
  });

  it("degrades gracefully when the DB itself is unavailable", async () => {
    dbUnavailable = true;
    const r = await resolveAndVerifySupplierCost({ claimedAmount: 100, sourceDocId: 5, customerProfileId: 1 });
    expect(r).toEqual({ ok: false, reason: "驗證過程發生錯誤" });
  });
});
