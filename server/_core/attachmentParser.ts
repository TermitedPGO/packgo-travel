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

/** Maximum raw bytes per attachment. Larger → skip (parseStatus="too_large"). */
export const MAX_RAW_BYTES = 5 * 1024 * 1024; // 5 MB

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
  | "too_large"
  | "empty"
  | "unsupported"
  | "parse_error";

export type AttachmentParseResult = {
  filename: string;
  mimeType: string;
  kind: AttachmentKind;
  sizeBytes: number;
  /** Plain-text extracted content. Empty if parseStatus !== ok/ok_truncated. */
  text: string;
  parseStatus: AttachmentParseStatus;
  /** Set when parseStatus === parse_error. */
  parseError?: string;
};

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

  // Guard: too large
  if (sizeBytes > MAX_RAW_BYTES) {
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
    switch (kind) {
      case "pdf":
        text = await parsePdf(data);
        break;
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
      case "image":
        // No OCR yet — return descriptive placeholder so agent knows an
        // image was present without hallucinating its contents.
        return {
          ...base,
          text: `[圖片附件 / image attachment: ${filename}, ${formatBytes(sizeBytes)}]`,
          parseStatus: "ok",
        };
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
    if (normalized.length > MAX_TEXT_CHARS) {
      return {
        ...base,
        text: normalized.slice(0, MAX_TEXT_CHARS) + TRUNCATION_MARKER,
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
// PDF — pdf-parse already installed (used elsewhere for receipt OCR)
// ────────────────────────────────────────────────────────────────────────

async function parsePdf(data: Buffer): Promise<string> {
  // Dynamic import — pdf-parse pulls in a heavy debug fixture on require;
  // dynamic load avoids slowing cold start. v2.4.5 ships ESM with both
  // `default` and module-level exports, hence the `?? pdfParseModule`
  // fallback (same pattern as server/agents/pdfTextExtractor.ts).
  const pdfParseModule = await import("pdf-parse");
  const pdfParse: any =
    (pdfParseModule as any).default ?? pdfParseModule;
  const result = await pdfParse(data, { max: 50 }); // cap at 50 pages
  return result.text ?? "";
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
