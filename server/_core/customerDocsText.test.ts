/**
 * M1 tests (customer-ai-sessions) — customerDocsText.
 *
 * IO is injected (fake fetchBytes / parse), so no R2 / network / pdf-parse is
 * touched. Covers: list formatting, PII list-only carve-out, info-only (no url)
 * skipping, total-cap truncation, readCount, and filename derivation.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildCustomerDocsText,
  formatDocsList,
  deriveFilename,
  makeCachedExtract,
  clearDocTextCache,
  extractDocTextCached,
  MAX_DOCS_TOTAL_CHARS,
  type DocRef,
  type DocsTextDeps,
} from "./customerDocsText";

function fakeDeps(textByName: Record<string, string>): DocsTextDeps {
  return {
    fetchBytes: vi.fn(async (url: string) =>
      url ? { bytes: Buffer.from("x"), mimeType: "application/pdf" } : null,
    ),
    // returns text keyed by the doc name embedded in the filename, else ok empty
    parse: vi.fn(async (filename: string) => {
      const hit = Object.entries(textByName).find(([name]) =>
        filename.includes(name),
      );
      return hit
        ? { text: hit[1], parseStatus: "ok" }
        : { text: "", parseStatus: "empty" };
    }),
  };
}

describe("formatDocsList", () => {
  it("lists every doc with kind + meta; empty marker when none", () => {
    expect(formatDocsList([])).toContain("目前沒有文件");
    const out = formatDocsList([
      { kind: "quote", name: "Q-001", url: "k1", meta: "USD 45,000 · sent" },
      { kind: "passport", name: "passport.pdf", url: "k2" },
    ]);
    expect(out).toContain("【文件清單】");
    expect(out).toContain("Q-001(quote · USD 45,000 · sent)");
    expect(out).toContain("passport.pdf(passport)");
  });
});

describe("deriveFilename", () => {
  it("keeps a real extension from the url", () => {
    expect(deriveFilename({ kind: "file", name: "x", url: "docs/a/b.pdf?sig=1" })).toBe(
      "b.pdf",
    );
  });
  it("infers .pdf for extension-less quote/invoice/confirmation", () => {
    expect(deriveFilename({ kind: "quote", name: "Q-9", url: "https://x/abc" })).toBe(
      "Q-9.pdf",
    );
  });
});

describe("buildCustomerDocsText", () => {
  it("extracts business-doc text, lists all, counts reads", async () => {
    const docs: DocRef[] = [
      { kind: "quote", name: "台灣報價", url: "k1" },
      { kind: "confirmation", name: "確認書", url: "k2" },
    ];
    const deps = fakeDeps({ 台灣報價: "Day1 台北 Day2 阿里山", 確認書: "已確認出團" });
    const r = await buildCustomerDocsText(docs, deps);

    expect(r.readCount).toBe(2);
    expect(r.fullText).toContain("Day2 阿里山");
    expect(r.fullText).toContain("已確認出團");
    expect(r.list).toContain("台灣報價");
  });

  it("never OCRs PII scans (passport/visa/insurance/medical) — list-only", async () => {
    const docs: DocRef[] = [
      { kind: "passport", name: "passport.jpg", url: "k1" },
      { kind: "visa", name: "visa.pdf", url: "k2" },
    ];
    const deps = fakeDeps({ "passport.jpg": "SECRET PASSPORT NO", "visa.pdf": "VISA" });
    const r = await buildCustomerDocsText(docs, deps);

    expect(r.readCount).toBe(0);
    expect(r.fullText).toBe("");
    expect(r.fullText).not.toContain("SECRET PASSPORT");
    // still appears in the list so the AI knows they exist
    expect(r.list).toContain("passport.jpg");
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });

  it("skips info-only rows with no url", async () => {
    const docs: DocRef[] = [{ kind: "flight", name: "BR16", url: null }];
    const deps = fakeDeps({});
    const r = await buildCustomerDocsText(docs, deps);
    expect(r.readCount).toBe(0);
    expect(deps.fetchBytes).not.toHaveBeenCalled();
    expect(r.list).toContain("BR16");
  });

  it("caps the concatenated text at MAX_DOCS_TOTAL_CHARS", async () => {
    const big = "好".repeat(MAX_DOCS_TOTAL_CHARS);
    const docs: DocRef[] = [
      { kind: "quote", name: "A", url: "k1" },
      { kind: "quote", name: "B", url: "k2" },
    ];
    const deps = fakeDeps({ A: big, B: big });
    const r = await buildCustomerDocsText(docs, deps);

    expect(r.fullText.length).toBeLessThanOrEqual(MAX_DOCS_TOTAL_CHARS + 100);
    expect(r.fullText).toContain("截斷");
  });

  it("drops docs that fail to fetch or parse empty", async () => {
    const docs: DocRef[] = [
      { kind: "quote", name: "good", url: "k1" },
      { kind: "quote", name: "broken", url: "k2" },
    ];
    const deps: DocsTextDeps = {
      fetchBytes: vi.fn(async (url: string) =>
        url === "k2" ? null : { bytes: Buffer.from("x"), mimeType: "application/pdf" },
      ),
      parse: vi.fn(async () => ({ text: "行程內容", parseStatus: "ok" })),
    };
    const r = await buildCustomerDocsText(docs, deps);
    expect(r.readCount).toBe(1);
    expect(r.fullText).toContain("行程內容");
  });
});

describe("makeCachedExtract (in-memory doc-text cache)", () => {
  const doc = (url: string | null): DocRef => ({ kind: "quote", name: "Q", url });

  it("parses once then serves the cache on repeat (no re-fetch / re-parse)", async () => {
    clearDocTextCache();
    const fetchBytes = vi.fn(async () => ({ bytes: Buffer.from("x"), mimeType: "application/pdf" }));
    const parse = vi.fn(async () => ({ text: "ITINERARY", parseStatus: "ok" }));
    const extract = makeCachedExtract(fetchBytes, parse);

    const a = await extract(doc("r2://quote-1.pdf"));
    const b = await extract(doc("r2://quote-1.pdf"));
    expect(a?.text).toBe("ITINERARY");
    expect(b?.text).toBe("ITINERARY");
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("does not share text across different urls", async () => {
    clearDocTextCache();
    const fetchBytes = vi.fn(async () => ({ bytes: Buffer.from("x"), mimeType: "application/pdf" }));
    const parse = vi.fn(async () => ({ text: "T", parseStatus: "ok" }));
    const extract = makeCachedExtract(fetchBytes, parse);
    await extract(doc("r2://a.pdf"));
    await extract(doc("r2://b.pdf"));
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache a failed / empty parse (so a later fix can succeed)", async () => {
    clearDocTextCache();
    const fetchBytes = vi.fn(async () => ({ bytes: Buffer.from("x"), mimeType: "application/pdf" }));
    const parse = vi.fn(async () => ({ text: "", parseStatus: "parse_error" }));
    const extract = makeCachedExtract(fetchBytes, parse);
    await extract(doc("r2://broken.pdf"));
    await extract(doc("r2://broken.pdf"));
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("returns null without fetching for a doc that has no url", async () => {
    clearDocTextCache();
    const fetchBytes = vi.fn(async () => null);
    const parse = vi.fn(async () => ({ text: "", parseStatus: "empty" }));
    const extract = makeCachedExtract(fetchBytes, parse);
    expect(await extract(doc(null))).toBe(null);
    expect(fetchBytes).not.toHaveBeenCalled();
  });
});

describe("extractDocTextCached (order-ai-understanding 的單檔入口)", () => {
  it("PII 證件掃描 list-only:passport/visa/insurance/medical 一律 null,不碰 IO", async () => {
    for (const kind of ["passport", "visa", "insurance", "medical"]) {
      expect(
        await extractDocTextCached({ kind, name: "scan.jpg", url: "r2://scan.jpg" }),
      ).toBe(null);
    }
  });

  it("沒有 url 的資訊列 → null,不碰 IO", async () => {
    expect(await extractDocTextCached({ kind: "quote", name: "Q-001", url: null })).toBe(null);
  });

  it("走同一個 module 級快取:預熱過的 url 直接回快取文字,零 IO", async () => {
    clearDocTextCache();
    // 用注入的 fake IO 預熱 module 快取(makeCachedExtract 寫的是同一個 Map)。
    const warm = makeCachedExtract(
      vi.fn(async () => ({ bytes: Buffer.from("x"), mimeType: "application/pdf" })),
      vi.fn(async () => ({ text: "行程第 2 天去日月潭", parseStatus: "ok" })),
    );
    await warm({ kind: "quote", name: "行程.pdf", url: "r2://itinerary.pdf" });
    // extractDocTextCached 用 realDeps,但快取命中 → 不會走到真 R2/pdf-parse。
    expect(
      await extractDocTextCached({ kind: "quote", name: "行程.pdf", url: "r2://itinerary.pdf" }),
    ).toBe("行程第 2 天去日月潭");
    clearDocTextCache();
  });
});
