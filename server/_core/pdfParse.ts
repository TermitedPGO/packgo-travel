/**
 * pdfParse — the SINGLE adapter around pdf-parse for the whole codebase
 * (pdf-attachment-reliability, 2026-07-15).
 *
 * Incident: repo runtime moved to pdf-parse@2.4.5 (v2 exposes a `PDFParse`
 * class) while `attachmentParser.ts` and `agents/pdfTextExtractor.ts` each
 * kept their own v1 resolver hunting for a callable export. v2 has none, so
 * EVERY PDF entering the shared parseAttachment path failed with
 * "pdf-parse export is not callable" before reading a single byte — and the
 * two copies had already drifted apart. All pdf-parse access now goes through
 * this module; nothing else may import "pdf-parse" directly.
 */
import type { PDFParse as PDFParseClass } from "pdf-parse";

/** Page cap for text extraction (same 50-page cap as the pre-v2 code). */
export const PDF_MAX_PAGES = 50;

/**
 * Below this many normalized chars, extracted text is considered "thin" —
 * likely a scanned/photographed PDF with no real text layer — and callers
 * must consult the Claude-native PDF fallback.
 */
export const MIN_PDF_TEXT_CHARS = 40;

export interface PdfPrimaryResult {
  /** Concatenated page text (page markers stripped — see extract note). */
  text: string;
  /** Total pages in the document (not just the parsed range). */
  pageCount: number;
  /** Pages actually parsed (≤ the page cap). Callers MUST surface
   *  pageCount > parsedPages as a truncated read (ok_truncated), never as a
   *  full read (Codex 14:07 §四.1: a 51-page PDF read to page 50 was
   *  silently marked ok). */
  parsedPages: number;
}

type PdfParseCtor = typeof PDFParseClass;

/**
 * Resolve the v2 `PDFParse` class across bundler interop shapes. Same lesson
 * as the old v1 resolver (prod esbuild double-wraps `default`): never assume
 * the module shape, walk the chain with typeof checks, and unit-test against
 * the REAL installed module so an API drift goes red in CI, not in prod.
 */
export function resolvePdfParseClass(mod: unknown): PdfParseCtor | null {
  const candidates = [
    mod,
    (mod as { default?: unknown })?.default,
    (mod as { default?: { default?: unknown } })?.default?.default,
  ];
  for (const m of candidates) {
    const ctor = (m as { PDFParse?: unknown })?.PDFParse;
    if (typeof ctor === "function") return ctor as PdfParseCtor;
  }
  return null;
}

/**
 * Primary (non-LLM) PDF text extraction via pdf-parse v2:
 * `new PDFParse({ data })` → `getText({ first })` → `finally destroy()`.
 *
 * Throws on structurally invalid PDFs — callers are responsible for routing
 * a throw (and thin/empty text) to the Claude-native fallback.
 *
 * Text is joined from `pages[].text` rather than `result.text`: v2 injects a
 * "-- N of M --" marker per page into the concatenated text, so a 50-page
 * scanned PDF would yield ~650 chars of pure markers and defeat the
 * MIN_PDF_TEXT_CHARS thin-text check that triggers the fallback.
 */
export async function extractPdfTextPrimary(
  data: Buffer,
  opts?: { maxPages?: number },
): Promise<PdfPrimaryResult> {
  // Dynamic import — pdf-parse pulls in pdfjs, heavy on cold start.
  const mod = await import("pdf-parse");
  const PDFParse = resolvePdfParseClass(mod);
  if (!PDFParse) {
    throw new Error(
      "pdf-parse v2 PDFParse class not found in module — check installed pdf-parse version",
    );
  }
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText({
      first: opts?.maxPages ?? PDF_MAX_PAGES,
    });
    const pages = result.pages ?? [];
    const text = pages
      .map((p) => p.text ?? "")
      .join("\n\n")
      .trim();
    return { text, pageCount: result.total ?? 0, parsedPages: pages.length };
  } finally {
    await parser.destroy();
  }
}
