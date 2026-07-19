/**
 * Round 81 Phase 7 — Email attachment parser.
 *
 * Customers send PDFs (itinerary drafts, flight confirmations), Excel
 * (passenger lists, quotes from other agencies), DOCX (visa apps), CSV
 * (expense reports). Pre-2026-05-25, gmail.ts only extracted text/plain and
 * text/html → all attachments silently dropped → InquiryAgent's draft would
 * promise things like "我會仔細研讀您附件中的行程草稿" while the system never
 * actually read the attachment. Credibility-breaking.
 *
 * This module:
 *   1. Takes raw bytes + filename + mimeType from Gmail attachment API
 *   2. Detects format (PDF / XLSX / DOCX / CSV / TXT / image fallback)
 *   3. Returns plain-text content + parseStatus + size info
 *
 * Format support (priority by Jenny's case + travel-agency reality):
 *   - PDF             → pdf-parse (already installed)
 *   - XLSX (.xlsx)    → jszip + custom SpreadsheetML parser (no new deps)
 *   - DOCX (.docx)    → jszip + word/document.xml extraction
 *   - CSV / TSV / TXT → utf-8 decode + trim
 *   - JSON            → parsed + pretty-printed
 *   - HTML            → strip tags (reuse gmail.ts stripHtml)
 *   - Image (jpg/png) → returns "image: <filename>" placeholder (no OCR yet)
 *   - Unknown         → returns "" + parseStatus="unsupported"
 *
 * Limits (defense-in-depth — Jeff's inbox is the highest-bandwidth attack
 * vector for cost-blow-up and prompt-injection):
 *   - Raw bytes:       5 MB per attachment (skip if larger)
 *   - Extracted text:  50 KB per attachment (truncate with marker)
 *   - Total per email: enforced by caller (gmail.ts caps attachment count)
 *
 * This file is pure parsing — NO DB writes, NO LLM calls, NO Gmail API
 * calls. Caller provides bytes; we return text. Easy to test.
 */

import JSZip from "jszip";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "attachmentParser" });

// ────────────────────────────────────────────────────────────────────────
// Limits — tweak here if a real-world email blows past them
// ────────────────────────────────────────────────────────────────────────

/** Maximum raw bytes per plain non-image, non-PDF attachment. */
export const MAX_RAW_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Images + PDFs get a much higher cap (2026-06-13): images are downscaled
 * with sharp before vision OCR; PDFs are read by Claude natively (incl
 * scanned). "File too large" is our problem to solve, not the customer's to
 * work around (Jeff's rule) — we never bounce a file for size.
 */
export const MAX_IMAGE_RAW_BYTES = 30 * 1024 * 1024; // 30 MB

/** Maximum extracted text per attachment. Truncated with marker if larger. */
export const MAX_TEXT_CHARS = 50 * 1024; // 50 KB

/** Truncation marker appended when MAX_TEXT_CHARS exceeded. */
export const TRUNCATION_MARKER = "\n\n[... 內容過長已截斷 / content truncated ...]";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type AttachmentKind =
  | "pdf"
  | "xlsx"
  | "docx"
  | "csv"
  | "tsv"
  | "txt"
  | "json"
  | "html"
  | "image"
  | "unknown";

export type AttachmentParseStatus =
  | "ok"
  | "ok_truncated"
  /** Fragmentary text only — the document as a whole was NOT reliably read
   *  (thin primary text layer + Claude fallback failed). The fragment is kept
   *  in `text` for Jeff, but this is a NON-readable status: the reply gate
   *  must force escalation (Codex 14:07 P1-1). */
  | "partial"
  | "too_large"
  | "empty"
  | "unsupported"
  | "parse_error"
  /** The attachment exists but was never parsed at all (per-message cap
   *  overflow, whole-hydration failure, spam-rescue replay without stored
   *  bytes). NON-readable: existence evidence must reach the reply gate so
   *  an attachment-bearing email is never treated as attachment-free
   *  (Codex 14:07 P1-3). */
  | "not_processed";

/** Statuses whose text may be treated as a (possibly truncated) full read.
 *  Everything else — including partial and not_processed — is non-readable
 *  and must force escalation at the reply gate. */
export const READABLE_PARSE_STATUSES: ReadonlySet<AttachmentParseStatus> =
  new Set(["ok", "ok_truncated"]);

export type AttachmentParseResult = {
  filename: string;
  mimeType: string;
  kind: AttachmentKind;
  sizeBytes: number;
  /** Plain-text extracted content. Empty unless parseStatus is
   *  ok/ok_truncated, or partial (fragment only — not a full read). */
  text: string;
  parseStatus: AttachmentParseStatus;
  /** Set for parse_error / partial / not_processed. Internal observability
   *  only (logs + Jeff metadata) — must never enter a customer-facing LLM
   *  prompt or draft (Codex 14:07 §四.2). */
  parseError?: string;
};

/**
 * Assemble the combined fileContext text the ops chat feeds the agent from a set
 * of parsed attachments — so the chat reads PDFs / images / docx like Claude,
 * routed through the SAME parser the 新增客人 modal uses. Each file gets a
 * `--- name ---` header; a file we couldn't read gets a short human note (not a
 * silent drop) so the model knows a file was attached but unreadable. Pure +
 * unit-tested (no DB / LLM). Returns "" when there is nothing readable.
 */
export function buildFileContextText(results: AttachmentParseResult[]): string {
  return results
    .map((r) => {
      const header = `--- ${r.filename} ---`;
      if ((r.parseStatus === "ok" || r.parseStatus === "ok_truncated") && r.text.trim()) {
        return `${header}\n${r.text.trim()}`;
      }
      const note =
        r.parseStatus === "too_large"
          ? "(檔案太大,讀不了)"
          : r.parseStatus === "empty"
            ? "(空檔)"
            : r.parseStatus === "unsupported"
              ? "(不支援的檔案類型)"
              : r.parseStatus === "not_processed"
                ? "(這個檔系統沒有處理到,請開原始檔確認)"
                : r.parseStatus === "partial"
                  ? "(只讀出零碎片段,不是完整內容,請開原始檔確認)"
                  // parse_error 到這裡代表系統該試的都試過了(PDF 含 Claude 備援)
                  // — 給 Jeff 清楚的人工作業提示,不是可重試狀態。
                  : "(這個檔系統讀不出來,請開原始檔確認)";
      // partial 保留零碎片段給 Jeff 參考,但註記在前,不冒充完整內容。
      if (r.parseStatus === "partial" && r.text.trim()) {
        return `${header}\n${note}\n${r.text.trim()}`;
      }
      return `${header}\n${note}`;
    })
    .filter((block) => block.length > 0)
    .join("\n\n");
}

// ────────────────────────────────────────────────────────────────────────
// Format detection — filename extension first (more reliable than Gmail's
// mimeType which often comes back as application/octet-stream for .xlsx)
// ────────────────────────────────────────────────────────────────────────

export function detectAttachmentKind(
  filename: string,
  mimeType: string
): AttachmentKind {
  const lower = filename.toLowerCase();
  const mt = mimeType.toLowerCase();

  // Extension takes priority — most reliable
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".tsv")) return "tsv";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "txt";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)$/.test(lower)) return "image";

  // mimeType fallback
  if (mt === "application/pdf") return "pdf";
  if (
    mt ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mt === "application/vnd.ms-excel.sheet.macroenabled.12"
  )
    return "xlsx";
  if (
    mt ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (mt === "text/csv") return "csv";
  if (mt === "text/tab-separated-values") return "tsv";
  if (mt.startsWith("text/plain")) return "txt";
  if (mt === "application/json") return "json";
  if (mt === "text/html") return "html";
  if (mt.startsWith("image/")) return "image";

  return "unknown";
}

// ────────────────────────────────────────────────────────────────────────
// Main entry — caller passes raw bytes (Buffer) + filename + mimeType
// ────────────────────────────────────────────────────────────────────────

export async function parseAttachment(
  filename: string,
  mimeType: string,
  data: Buffer
): Promise<AttachmentParseResult> {
  const sizeBytes = data.length;
  const kind = detectAttachmentKind(filename, mimeType);

  const base: Omit<AttachmentParseResult, "text" | "parseStatus"> = {
    filename,
    mimeType,
    kind,
    sizeBytes,
  };

  // Guard: too large. Images get a higher cap because we downscale them
  // before reading (see the "image" case below).
  const rawCap =
    kind === "image" || kind === "pdf" ? MAX_IMAGE_RAW_BYTES : MAX_RAW_BYTES;
  if (sizeBytes > rawCap) {
    return {
      ...base,
      text: "",
      parseStatus: "too_large",
    };
  }

  // Guard: empty
  if (sizeBytes === 0) {
    return { ...base, text: "", parseStatus: "empty" };
  }

  try {
    let text = "";
    let pdfPagesTruncated: { parsedPages: number; totalPages: number } | undefined;
    switch (kind) {
      case "pdf": {
        const pdf = await parsePdfWithFallback(data, filename);
        if (!pdf.ok) {
          // Both the primary parser AND the Claude-native fallback failed —
          // only now is a non-readable verdict allowed (pdf-attachment-
          // reliability, 2026-07-15: a primary throw used to skip the
          // fallback entirely). parseError is for logs/Jeff only; the
          // customer-facing reply gate must never let it leak into a draft.
          const fragment = normalizeWhitespace(pdf.fragment ?? "");
          if (fragment) {
            // Codex 14:07 P1-1 — thin text layer + fallback failure is NOT a
            // full read: keep the fragment for Jeff, mark partial (forces
            // escalation at the reply gate), never ok.
            return {
              ...base,
              text: fragment,
              parseStatus: "partial",
              parseError: pdf.error.slice(0, 200),
            };
          }
          return {
            ...base,
            text: "",
            parseStatus: "parse_error",
            parseError: pdf.error.slice(0, 200),
          };
        }
        text = pdf.text;
        pdfPagesTruncated = pdf.pagesTruncated;
        break;
      }
      case "xlsx":
        text = await parseXlsx(data);
        break;
      case "docx":
        text = await parseDocx(data);
        break;
      case "csv":
      case "tsv":
      case "txt":
        text = data.toString("utf-8");
        break;
      case "json":
        text = formatJson(data.toString("utf-8"));
        break;
      case "html":
        text = stripHtml(data.toString("utf-8"));
        break;
      case "image": {
        // 2026-06-13 — actually READ the image via Claude vision (downscale
        // first). Customers send posters / itinerary screenshots; bouncing
        // them is bad service.
        const { extractImageText } = await import("./imageOcr");
        const ocr = await extractImageText(data, filename);
        if (ocr.ok) {
          text = ocr.text;
          break;
        }
        // Codex 14:07 P1-2 — OCR failure is a NON-readable outcome. The old
        // code returned a placeholder with parseStatus="ok", so the reply
        // gate treated a genuinely unread image as readable and never
        // escalated. parse_error is honest: vision was tried and failed.
        return {
          ...base,
          text: "",
          parseStatus: "parse_error",
          parseError: "image OCR failed (vision read unreadable)",
        };
      }
      case "unknown":
        return {
          ...base,
          text: "",
          parseStatus: "unsupported",
        };
    }

    // Normalize + truncate
    const normalized = normalizeWhitespace(text);
    if (normalized.length === 0) {
      return { ...base, text: "", parseStatus: "empty" };
    }
    // Codex 14:07 §四.1 — a PDF longer than the page cap is a TRUNCATED read:
    // surface the parsed/total page fact and mark ok_truncated, never plain ok.
    const pageMarker = pdfPagesTruncated
      ? `\n\n[... PDF 共 ${pdfPagesTruncated.totalPages} 頁,僅解析前 ${pdfPagesTruncated.parsedPages} 頁 / only first ${pdfPagesTruncated.parsedPages} of ${pdfPagesTruncated.totalPages} pages parsed ...]`
      : "";
    if (normalized.length > MAX_TEXT_CHARS) {
      return {
        ...base,
        text: normalized.slice(0, MAX_TEXT_CHARS) + TRUNCATION_MARKER + pageMarker,
        parseStatus: "ok_truncated",
      };
    }
    if (pageMarker) {
      return {
        ...base,
        text: normalized + pageMarker,
        parseStatus: "ok_truncated",
      };
    }
    return { ...base, text: normalized, parseStatus: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      { filename, mimeType, kind, sizeBytes, err: msg },
      "[attachmentParser] parse failed"
    );
    return {
      ...base,
      text: "",
      parseStatus: "parse_error",
      parseError: msg.slice(0, 200),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// PDF — primary pdf-parse v2 (via the shared adapter) + Claude-native
// fallback. pdf-attachment-reliability (2026-07-15): the old code used the
// v1 callable API against the installed v2 class → EVERY pdf died with
// "pdf-parse export is not callable" before reading a byte, and because the
// primary threw, the Claude fallback never ran either. All pdf-parse access
// now lives in _core/pdfParse.ts (single adapter, shared with
// agents/pdfTextExtractor.ts).
// ────────────────────────────────────────────────────────────────────────

type PdfChainResult =
  | {
      ok: true;
      text: string;
      /** Set when the primary parser read fewer pages than the document has
       *  (page cap) — caller must mark the result ok_truncated. */
      pagesTruncated?: { parsedPages: number; totalPages: number };
    }
  | {
      ok: false;
      error: string;
      /** Thin/fragmentary primary text (when primary succeeded but the
       *  fallback failed) — caller marks it partial, never ok. */
      fragment?: string;
    };

/**
 * Primary parser + Claude-native fallback chain:
 *   - primary succeeds with a real text layer → use it (no LLM call);
 *     document longer than the page cap → pagesTruncated is set
 *   - primary THROWS, or returns empty/thin text → Claude reads the PDF
 *     natively (scanned/photographed PDFs, and any primary-parser failure)
 *   - fallback also fails → { ok:false } in every case (Codex 14:07 P1-1):
 *       · primary threw → parse_error downstream
 *       · primary succeeded but thin/empty → fragment carries what little it
 *         saw; downstream marks it partial (non-readable), never ok/empty
 */
async function parsePdfWithFallback(
  data: Buffer,
  filename: string
): Promise<PdfChainResult> {
  const { extractPdfTextPrimary, MIN_PDF_TEXT_CHARS } = await import(
    "./pdfParse"
  );

  let primaryText = "";
  let primaryError: string | null = null;
  let pagesTruncated: { parsedPages: number; totalPages: number } | undefined;
  try {
    const primary = await extractPdfTextPrimary(data);
    primaryText = primary.text;
    if (primary.pageCount > primary.parsedPages) {
      pagesTruncated = {
        parsedPages: primary.parsedPages,
        totalPages: primary.pageCount,
      };
    }
  } catch (err) {
    primaryError = err instanceof Error ? err.message : String(err);
    log.warn(
      { filename, err: primaryError },
      "[attachmentParser] pdf primary parser threw — consulting Claude fallback"
    );
  }

  const thin = normalizeWhitespace(primaryText).length < MIN_PDF_TEXT_CHARS;
  if (!primaryError && !thin) return { ok: true, text: primaryText, pagesTruncated };

  // Scanned / photographed PDFs have no text layer, and a primary-parser
  // failure must not be terminal: fall back to Claude reading the PDF
  // natively (passports, scanned itineraries, fax-to-PDF). Never throws.
  const { extractPdfText } = await import("./imageOcr");
  const fallback = await extractPdfText(data, filename);
  if (fallback.ok) return { ok: true, text: fallback.text };

  if (primaryError) {
    return {
      ok: false,
      error: `primary: ${primaryError}; fallback: unreadable`,
    };
  }
  // Codex 14:07 P1-1 — primary succeeded but empty/thin AND the fallback
  // failed: the document was NOT reliably read. Old behavior returned ok
  // here, so a watermark-only scan read as a full read and the reply gate
  // never escalated. Surface the fragment; caller marks it partial.
  return {
    ok: false,
    error: "primary: thin/empty text layer; fallback: unreadable",
    fragment: primaryText,
  };
}

// ────────────────────────────────────────────────────────────────────────
// XLSX — SpreadsheetML parsing via jszip + minimal XML walker.
//
// xlsx format = zip of XML files:
//   xl/sharedStrings.xml   — pool of unique strings (indexed by sheet cells)
//   xl/workbook.xml        — list of sheets
//   xl/worksheets/sheetN.xml — rows + cells, cells with t="s" reference
//                              sharedStrings, otherwise inline value
//
// We extract text from every cell of every sheet, output as
// "Sheet: <name>\n<row1>\n<row2>\n..." with tab-separated columns.
//
// Why hand-roll instead of `xlsx` npm package: keeps deps small (we already
// have jszip from elsewhere) and we only need text extraction. Cell types
// we DO support: shared-string, inline number, inline string, boolean.
// Cell types we DON'T support: formulas (we return the cached value, which
// xlsx writers usually include), date serial numbers (Excel stores dates as
// numbers since 1900 → we leave the number; the LLM is smart enough).
// ────────────────────────────────────────────────────────────────────────

async function parseXlsx(data: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);

  // Load shared strings (may be absent if the workbook has no strings)
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings: string[] = sharedStringsFile
    ? parseSharedStrings(await sharedStringsFile.async("string"))
    : [];

  // Map sheet rId → name from workbook.xml (best-effort; falls back to filename)
  const workbookFile = zip.file("xl/workbook.xml");
  const sheetNames: Record<string, string> = {};
  if (workbookFile) {
    const wbXml = await workbookFile.async("string");
    // <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
    const sheetRe =
      /<sheet[^>]*\bname="([^"]+)"[^>]*\br:id="(rId\d+)"[^>]*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = sheetRe.exec(wbXml)) !== null) {
      sheetNames[m[2]] = m[1];
    }
  }

  // Iterate worksheets
  const sheetFiles = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort();

  const out: string[] = [];
  for (const path of sheetFiles) {
    const sheetXml = await zip.file(path)!.async("string");
    const m = path.match(/sheet(\d+)\.xml$/);
    const idx = m ? m[1] : "?";
    const fallbackName = `Sheet${idx}`;
    // Find sheet name via rels — heuristic: assume order matches
    const sheetName =
      Object.values(sheetNames)[parseInt(idx, 10) - 1] || fallbackName;

    out.push(`【Sheet: ${sheetName}】`);
    const rows = parseSheetRows(sheetXml, sharedStrings);
    for (const row of rows) {
      out.push(row.join("\t"));
    }
    out.push(""); // blank between sheets
  }

  return out.join("\n").trim();
}

function parseSharedStrings(xml: string): string[] {
  // <si><t>text</t></si>  or  <si><r><t>part1</t></r><r><t>part2</t></r></si>
  const result: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const siInner = m[1];
    // Pull every <t>…</t> regardless of nesting (rich text si has multiple)
    const tParts: string[] = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(siInner)) !== null) {
      tParts.push(decodeXmlEntities(tm[1]));
    }
    result.push(tParts.join(""));
  }
  return result;
}

function parseSheetRows(
  sheetXml: string,
  sharedStrings: string[]
): string[][] {
  // <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1234</v></c></row>
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheetXml)) !== null) {
    const rowInner = rm[1];
    const cells: { col: number; text: string }[] = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowInner)) !== null) {
      const attrs = cm[1] ?? cm[3] ?? "";
      const inner = cm[2] ?? "";
      const rMatch = attrs.match(/\br="([A-Z]+)(\d+)"/);
      const tMatch = attrs.match(/\bt="(\w+)"/);
      const col = rMatch ? colToIndex(rMatch[1]) : cells.length;
      const type = tMatch ? tMatch[1] : "n";

      let text = "";
      if (type === "s") {
        // Shared-string reference
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (v) {
          const idx = parseInt(v[1], 10);
          text = sharedStrings[idx] ?? "";
        }
      } else if (type === "inlineStr") {
        // Inline string
        const t = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        if (t) text = decodeXmlEntities(t[1]);
      } else if (type === "b") {
        // Boolean: <v>0</v> or <v>1</v>
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        text = v?.[1] === "1" ? "TRUE" : "FALSE";
      } else if (type === "str") {
        // Formula-cached string
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (v) text = decodeXmlEntities(v[1]);
      } else {
        // Number or default: inline <v>...</v>
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (v) text = v[1];
      }
      cells.push({ col, text });
    }
    // Pad sparse cells with empty strings up to last col
    if (cells.length === 0) {
      rows.push([]);
      continue;
    }
    const maxCol = Math.max(...cells.map((c) => c.col));
    const arr: string[] = new Array(maxCol + 1).fill("");
    for (const c of cells) arr[c.col] = c.text;
    rows.push(arr);
  }
  return rows;
}

function colToIndex(col: string): number {
  // "A" → 0, "B" → 1, ..., "Z" → 25, "AA" → 26
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - "A".charCodeAt(0) + 1);
  }
  return result - 1;
}

// ────────────────────────────────────────────────────────────────────────
// DOCX — Word OpenXML
//
// docx format = zip with word/document.xml. Text lives in <w:t>...</w:t>
// inside <w:p> paragraphs. We pull every <w:t>, joining within a paragraph
// and inserting "\n\n" between paragraphs.
// ────────────────────────────────────────────────────────────────────────

async function parseDocx(data: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return "";
  const xml = await docFile.async("string");

  // Split into paragraphs first; pull <w:t> from each
  const out: string[] = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml)) !== null) {
    const inner = pm[1];
    const parts: string[] = [];
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(inner)) !== null) {
      parts.push(decodeXmlEntities(tm[1]));
    }
    const para = parts.join("").trim();
    if (para) out.push(para);
  }
  return out.join("\n\n");
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/&amp;/g, "&"); // last to avoid double-decoding &amp;lt;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "") // strip control chars (preserve \t \n)
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
