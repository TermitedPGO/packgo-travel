/**
 * customerDocsText (批3 M1) — turn a customer's document list into text the AI
 * can read (報價 / 行程 PDF 內文), for the customer-AI engine (summary + chat).
 *
 * Jeff 拍板 (proposal §五.2 + Stage 2 Q2): the AI sees the document LIST and
 * reads PDF CONTENT. Extracted text only ever flows into the prompt — it is
 * NEVER written to the DB or disk (PII rule, CLAUDE.md §四). This module is pure
 * read-and-format: callers pass the doc refs, we fetch bytes (R2 / http) and
 * parse to text via the existing attachmentParser (PDF + scanned-PDF OCR).
 *
 * PII carve-out: passport / visa / insurance / medical scans are LIST-ONLY — we
 * never OCR them into the prompt. They are PII-heavy ID images, the AI doesn't
 * need their pixels to answer 「行程第幾天去哪」, and OCR'ing a passport on every
 * chat turn would be both wasteful and a fresh plaintext-PII exposure. The list
 * still shows them so the AI knows a passport is on file.
 *
 * IO (fetchBytes / parse) is injected with real defaults so the formatting +
 * cap + selection logic is unit-testable without R2 / network / pdf-parse.
 */
import { parseAttachment } from "./attachmentParser";
import { storageGetBytes, extractR2KeyFromUrl } from "../storage";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "customerDocsText" });

/** A document to (maybe) read. Mirrors adminCustomersDocs `CustomerDoc`. */
export interface DocRef {
  /** stable code: quote / invoice / passport / visa / insurance / medical / file / flight / confirmation */
  kind: string;
  name: string;
  /** R2 key or http(s) URL; null = info-only row (e.g. flight order) — skipped. */
  url: string | null;
  /** short secondary line (amount / status), shown in the list only. */
  meta?: string | null;
}

export interface DocsTextResult {
  /** 「文件清單」block — always lists ALL docs (incl. PII scans + info-only). */
  list: string;
  /** Concatenated extracted PDF/doc text, capped. Empty if nothing readable. */
  fullText: string;
  /** How many docs we actually extracted text from. */
  readCount: number;
}

/** Overall cap on the concatenated doc text (chars). Per-doc cap is
 *  attachmentParser's MAX_TEXT_CHARS (50KB). */
export const MAX_DOCS_TOTAL_CHARS = 60 * 1024;

/** PII ID scans — list-only, never OCR'd into the prompt. */
const PII_KINDS = new Set(["passport", "visa", "insurance", "medical"]);

/** Business docs whose URL, when extension-less, is a PDF (quote/invoice/確認書). */
const PDF_KINDS = new Set(["quote", "invoice", "confirmation"]);

/** Injectable IO seam (tests pass fakes; prod uses the defaults below). */
export interface DocsTextDeps {
  fetchBytes: (
    url: string,
  ) => Promise<{ bytes: Buffer; mimeType: string } | null>;
  parse: (
    filename: string,
    mimeType: string,
    data: Buffer,
  ) => Promise<{ text: string; parseStatus: string }>;
}

function shouldExtract(doc: DocRef): boolean {
  return !!doc.url && !PII_KINDS.has(doc.kind);
}

/** Filename whose extension drives attachmentParser's kind detection. */
export function deriveFilename(doc: DocRef): string {
  const base = (doc.url ?? "").split("?")[0].split("/").pop() ?? "";
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base; // already has an extension
  if (PDF_KINDS.has(doc.kind)) return `${doc.name || "document"}.pdf`;
  return doc.name || base || "document";
}

/** Pure: the 「文件清單」block listing every doc. */
export function formatDocsList(docs: DocRef[]): string {
  if (!docs.length) return "【文件清單】(目前沒有文件)";
  const lines = docs.map((d) => {
    const meta = d.meta ? ` · ${d.meta}` : "";
    return `- ${d.name}(${d.kind}${meta})`;
  });
  return ["【文件清單】", ...lines].join("\n");
}

const realDeps: DocsTextDeps = {
  async fetchBytes(url) {
    try {
      if (/^https?:\/\//i.test(url)) {
        const key = extractR2KeyFromUrl(url);
        if (key) {
          const r = await storageGetBytes(key);
          return { bytes: r.bytes, mimeType: r.mimeType };
        }
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const ab = await resp.arrayBuffer();
        return {
          bytes: Buffer.from(ab),
          mimeType: resp.headers.get("content-type") || "application/octet-stream",
        };
      }
      const r = await storageGetBytes(url); // bare R2 key
      return { bytes: r.bytes, mimeType: r.mimeType };
    } catch (err) {
      log.warn(
        { url: url.slice(0, 80), err: (err as Error).message },
        "[customerDocsText] fetch failed — skipping doc",
      );
      return null;
    }
  },
  async parse(filename, mimeType, data) {
    const r = await parseAttachment(filename, mimeType, data);
    return { text: r.text, parseStatus: r.parseStatus };
  },
};

/**
 * Build the doc list + concatenated readable text for a customer's documents.
 * Fetch+parse run in parallel; assembly is sequential to honor the total cap
 * while preserving the input order. Nothing here is persisted.
 */
export async function buildCustomerDocsText(
  docs: DocRef[],
  deps: DocsTextDeps = realDeps,
): Promise<DocsTextResult> {
  const list = formatDocsList(docs);

  const extractable = docs.filter(shouldExtract);
  const extracted = await Promise.all(
    extractable.map(async (doc) => {
      const fetched = await deps.fetchBytes(doc.url!);
      if (!fetched) return null;
      const parsed = await deps.parse(
        deriveFilename(doc),
        fetched.mimeType,
        fetched.bytes,
      );
      if (parsed.parseStatus !== "ok" && parsed.parseStatus !== "ok_truncated") {
        return null;
      }
      const text = parsed.text.trim();
      if (!text) return null;
      return { doc, text };
    }),
  );

  const blocks: string[] = [];
  let total = 0;
  let readCount = 0;
  for (const item of extracted) {
    if (!item) continue;
    if (total >= MAX_DOCS_TOTAL_CHARS) break;
    const header = `【文件內容:${item.doc.name}】\n`;
    const remaining = MAX_DOCS_TOTAL_CHARS - total;
    let body = item.text;
    if (header.length + body.length > remaining) {
      body =
        body.slice(0, Math.max(0, remaining - header.length)) +
        "\n[...內容過長已截斷...]";
    }
    const block = header + body;
    blocks.push(block);
    total += block.length;
    readCount++;
  }

  return { list, fullText: blocks.join("\n\n"), readCount };
}
