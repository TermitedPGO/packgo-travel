/**
 * Round 81 Phase 7 — attachmentParser vitest.
 *
 * Covers:
 *   - detectAttachmentKind across extensions + mime types
 *   - XLSX parsing (built inline with jszip so no binary fixtures)
 *   - DOCX parsing (same)
 *   - CSV / TXT / JSON / HTML / image fallback
 *   - Size limits (too_large, truncation marker)
 *   - Empty file handling
 *   - parseError path (corrupt zip)
 *
 * PDF parsing isn't unit-tested here — pdf-parse needs a real binary PDF
 * and we exercise that path via integration tests on Jenny's actual email
 * once deployed. The wrapper around it (size check + truncation + error
 * catch) IS tested via the parse_error case.
 */

import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";

vi.mock("./imageOcr", () => ({
  extractImageText: vi.fn(),
  extractPdfText: vi.fn(),
}));

import {
  parseAttachment,
  detectAttachmentKind,
  resolvePdfParse,
  buildFileContextText,
  MAX_RAW_BYTES,
  MAX_TEXT_CHARS,
  TRUNCATION_MARKER,
  type AttachmentParseResult,
} from "./attachmentParser";
import { extractImageText } from "./imageOcr";

const ocrMock = vi.mocked(extractImageText);

// ──────────────────────────────────────────────────────────────────────
// detectAttachmentKind
// ──────────────────────────────────────────────────────────────────────

describe("detectAttachmentKind", () => {
  it("detects PDF by extension", () => {
    expect(detectAttachmentKind("itinerary.pdf", "application/octet-stream")).toBe("pdf");
    expect(detectAttachmentKind("ITINERARY.PDF", "application/octet-stream")).toBe("pdf");
  });

  it("detects PDF by mime when extension missing", () => {
    expect(detectAttachmentKind("file", "application/pdf")).toBe("pdf");
  });

  it("detects XLSX (extension takes priority over generic mime)", () => {
    expect(
      detectAttachmentKind("trip.xlsx", "application/octet-stream")
    ).toBe("xlsx");
    expect(
      detectAttachmentKind(
        "file",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe("xlsx");
    expect(detectAttachmentKind("macro.xlsm", "")).toBe("xlsx");
  });

  it("detects DOCX", () => {
    expect(detectAttachmentKind("visa.docx", "")).toBe("docx");
    expect(
      detectAttachmentKind(
        "f",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("docx");
  });

  it("detects CSV/TSV/TXT", () => {
    expect(detectAttachmentKind("passengers.csv", "")).toBe("csv");
    expect(detectAttachmentKind("data.tsv", "")).toBe("tsv");
    expect(detectAttachmentKind("notes.txt", "")).toBe("txt");
    expect(detectAttachmentKind("log.log", "")).toBe("txt");
  });

  it("detects JSON/HTML/image", () => {
    expect(detectAttachmentKind("data.json", "")).toBe("json");
    expect(detectAttachmentKind("page.html", "")).toBe("html");
    expect(detectAttachmentKind("photo.JPG", "")).toBe("image");
    expect(detectAttachmentKind("photo.png", "")).toBe("image");
    expect(detectAttachmentKind("photo.heic", "")).toBe("image");
    expect(detectAttachmentKind("f", "image/jpeg")).toBe("image");
  });

  it("returns unknown for unrecognized", () => {
    expect(detectAttachmentKind("file.zip", "application/zip")).toBe("unknown");
    expect(detectAttachmentKind("nofile", "")).toBe("unknown");
  });
});

// ──────────────────────────────────────────────────────────────────────
// XLSX — build a real workbook inline, then parse it back
// ──────────────────────────────────────────────────────────────────────

async function buildXlsx(rows: string[][], sheetName = "Sheet1"): Promise<Buffer> {
  // Minimal valid xlsx: workbook.xml + sheet1.xml + sharedStrings.xml +
  // [Content_Types].xml + _rels/.rels + xl/_rels/workbook.xml.rels
  //
  // Use shared strings for every cell so we exercise that code path.
  const sharedSet = new Map<string, number>();
  for (const row of rows) {
    for (const cell of row) {
      if (!sharedSet.has(cell)) sharedSet.set(cell, sharedSet.size);
    }
  }
  const sharedStrings = Array.from(sharedSet.keys());

  const sharedStringsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings
      .map(
        (s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`
      )
      .join("") +
    `</sst>`;

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>` +
    rows
      .map((row, rIdx) => {
        const r = rIdx + 1;
        const cells = row
          .map((val, cIdx) => {
            const col = indexToCol(cIdx);
            const idx = sharedSet.get(val);
            return `<c r="${col}${r}" t="s"><v>${idx}</v></c>`;
          })
          .join("");
        return `<row r="${r}">${cells}</row>`;
      })
      .join("") +
    `</sheetData></worksheet>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("xl/_rels/workbook.xml.rels", wbRels);
  zip.file("xl/workbook.xml", workbookXml);
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  zip.file("xl/sharedStrings.xml", sharedStringsXml);

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}

function indexToCol(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

describe("parseAttachment — XLSX", () => {
  it("extracts text from a Jenny-style itinerary spreadsheet", async () => {
    const xlsx = await buildXlsx([
      ["日期", "城市", "活動", "備註"],
      ["8/15", "洛杉磯", "聖塔莫尼卡海灘", "下午 3 點集合"],
      ["8/16", "拉斯維加斯", "Cirque du Soleil O Show", "晚場 7pm"],
      ["8/17", "拉斯維加斯", "大峽谷一日遊", "出發前一天確認天氣"],
    ]);
    const result = await parseAttachment(
      "Taiwan trip - draft.xlsx",
      "application/octet-stream",
      xlsx
    );
    expect(result.kind).toBe("xlsx");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toContain("洛杉磯");
    expect(result.text).toContain("聖塔莫尼卡海灘");
    expect(result.text).toContain("Cirque du Soleil O Show");
    expect(result.text).toContain("大峽谷一日遊");
    // Headers and tab-separated structure preserved
    expect(result.text).toContain("日期\t城市\t活動\t備註");
    expect(result.text).toContain("【Sheet: Sheet1】");
  });

  it("handles empty xlsx (no rows)", async () => {
    const xlsx = await buildXlsx([]);
    const result = await parseAttachment("empty.xlsx", "", xlsx);
    expect(result.kind).toBe("xlsx");
    // Sheet header still printed → not empty
    expect(result.parseStatus).toBe("ok");
  });

  it("escapes special XML chars correctly", async () => {
    const xlsx = await buildXlsx([
      ["a & b", "<tag>", "5 < 10"],
      ["O'Brien", "she said \"hi\"", "x > y"],
    ]);
    const result = await parseAttachment("special.xlsx", "", xlsx);
    expect(result.text).toContain("a & b");
    expect(result.text).toContain("<tag>");
    expect(result.text).toContain("O'Brien");
    expect(result.text).toContain('she said "hi"');
  });
});

// ──────────────────────────────────────────────────────────────────────
// DOCX — build inline
// ──────────────────────────────────────────────────────────────────────

async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    paragraphs
      .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
      .join("") +
    `</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}

describe("parseAttachment — DOCX", () => {
  it("extracts paragraphs joined by blank lines", async () => {
    const docx = await buildDocx([
      "簽證申請表",
      "申請人姓名:張小明",
      "護照號碼:E12345678",
      "出生日期:1990/01/15",
    ]);
    const result = await parseAttachment("visa.docx", "", docx);
    expect(result.kind).toBe("docx");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toContain("簽證申請表");
    expect(result.text).toContain("申請人姓名:張小明");
    expect(result.text).toContain("E12345678");
    // Paragraphs separated by blank line
    expect(result.text).toMatch(/簽證申請表\n\n申請人/);
  });

  it("handles docx with no document.xml gracefully", async () => {
    const zip = new JSZip();
    zip.file("other.xml", "<xml/>");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const result = await parseAttachment("broken.docx", "", buf);
    expect(result.kind).toBe("docx");
    expect(result.parseStatus).toBe("empty");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Plain text / CSV / JSON / HTML / image
// ──────────────────────────────────────────────────────────────────────

describe("parseAttachment — text formats", () => {
  it("decodes utf-8 CSV", async () => {
    const csv = "姓名,房型,人數\n張小明,雙人房,2\n李大華,單人房,1\n";
    const result = await parseAttachment(
      "passengers.csv",
      "text/csv",
      Buffer.from(csv, "utf-8")
    );
    expect(result.kind).toBe("csv");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toContain("張小明");
    expect(result.text).toContain("雙人房");
  });

  it("pretty-prints JSON", async () => {
    const json = '{"name":"Jenny","trip":"Taiwan","dates":["8/15","8/22"]}';
    const result = await parseAttachment(
      "data.json",
      "application/json",
      Buffer.from(json, "utf-8")
    );
    expect(result.kind).toBe("json");
    expect(result.text).toContain('"name": "Jenny"');
    expect(result.text).toMatch(/\n  "name"/); // pretty-print indent
  });

  it("falls back to raw text for invalid JSON", async () => {
    const result = await parseAttachment(
      "broken.json",
      "",
      Buffer.from("{this is not json", "utf-8")
    );
    expect(result.text).toContain("this is not json");
  });

  it("strips HTML tags", async () => {
    const html =
      "<html><body><h1>Trip plan</h1><p>Day 1: <b>LA</b></p><script>alert(1)</script></body></html>";
    const result = await parseAttachment(
      "page.html",
      "text/html",
      Buffer.from(html, "utf-8")
    );
    expect(result.text).toContain("Trip plan");
    expect(result.text).toContain("Day 1");
    expect(result.text).not.toContain("<");
    expect(result.text).not.toContain("alert(1)");
  });

  it("reads image content via vision OCR when it succeeds", async () => {
    ocrMock.mockResolvedValueOnce({ ok: true, text: "台灣 8 天\n鳴日號觀光列車\n台北 → 花蓮 → 台東" });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await parseAttachment("poster.png", "image/png", png);
    expect(result.kind).toBe("image");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toContain("鳴日號");
    expect(result.text).not.toContain("image attachment");
  });

  it("falls back to a placeholder when the image genuinely can't be read", async () => {
    ocrMock.mockResolvedValueOnce({ ok: false, text: "" });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await parseAttachment("photo.png", "image/png", png);
    expect(result.kind).toBe("image");
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toContain("photo.png");
    expect(result.text).toContain("讀不出");
  });

  it("large image is NOT rejected as too_large (we downscale + read it)", async () => {
    ocrMock.mockResolvedValueOnce({ ok: true, text: "16MB 海報已讀取" });
    const big = Buffer.alloc(16 * 1024 * 1024, 1); // 16 MB, over the 5 MB non-image cap
    const result = await parseAttachment("big-poster.png", "image/png", big);
    expect(result.parseStatus).toBe("ok");
    expect(result.text).toContain("16MB 海報已讀取");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Size limits + edge cases
// ──────────────────────────────────────────────────────────────────────

describe("parseAttachment — limits", () => {
  it("returns too_large for files over MAX_RAW_BYTES", async () => {
    const huge = Buffer.alloc(MAX_RAW_BYTES + 1, 0x41);
    const result = await parseAttachment("huge.txt", "text/plain", huge);
    expect(result.parseStatus).toBe("too_large");
    expect(result.text).toBe("");
    expect(result.sizeBytes).toBe(MAX_RAW_BYTES + 1);
  });

  it("returns empty for zero-byte files", async () => {
    const empty = Buffer.alloc(0);
    const result = await parseAttachment("blank.txt", "text/plain", empty);
    expect(result.parseStatus).toBe("empty");
    expect(result.sizeBytes).toBe(0);
  });

  it("truncates content over MAX_TEXT_CHARS with marker", async () => {
    // Build text just over the cap
    const big = "x".repeat(MAX_TEXT_CHARS + 1000);
    const result = await parseAttachment("big.txt", "text/plain", Buffer.from(big));
    expect(result.parseStatus).toBe("ok_truncated");
    expect(result.text.endsWith(TRUNCATION_MARKER)).toBe(true);
    // Total length = MAX + marker
    expect(result.text.length).toBe(MAX_TEXT_CHARS + TRUNCATION_MARKER.length);
  });

  it("returns unsupported for unknown formats", async () => {
    const buf = Buffer.from("random bytes");
    const result = await parseAttachment(
      "file.zip",
      "application/zip",
      buf
    );
    expect(result.parseStatus).toBe("unsupported");
  });

  it("returns parse_error when xlsx is corrupt", async () => {
    const corrupt = Buffer.from("not a real xlsx file");
    const result = await parseAttachment(
      "fake.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      corrupt
    );
    expect(result.parseStatus).toBe("parse_error");
    expect(result.parseError).toBeTruthy();
  });
});

describe("resolvePdfParse — bundler interop", () => {
  const fn = async () => ({ text: "ok" });

  it("returns the module itself when it is the function (CJS)", () => {
    expect(resolvePdfParse(fn)).toBe(fn);
  });
  it("unwraps a single default (ESM)", () => {
    expect(resolvePdfParse({ default: fn })).toBe(fn);
  });
  it("unwraps a double-wrapped default (the prod-bundle shape that broke)", () => {
    expect(resolvePdfParse({ default: { default: fn } })).toBe(fn);
  });
  it("returns null when nothing is callable (so the caller throws clearly)", () => {
    expect(resolvePdfParse({ default: { notAFn: 1 } })).toBe(null);
    expect(resolvePdfParse(null)).toBe(null);
    expect(resolvePdfParse({})).toBe(null);
  });
});

describe("buildFileContextText — assembles the chat fileContext from parsed files", () => {
  const r = (o: Partial<AttachmentParseResult>): AttachmentParseResult => ({
    filename: "f.txt",
    mimeType: "text/plain",
    kind: "txt",
    sizeBytes: 1,
    text: "",
    parseStatus: "ok",
    ...o,
  });

  it("headers each readable file with --- name --- + its text", () => {
    const out = buildFileContextText([
      r({ filename: "quote.pdf", kind: "pdf", text: "Taipei 5 days $1200" }),
      r({ filename: "pax.csv", kind: "csv", text: "name,dob\nWang,1990" }),
    ]);
    expect(out).toContain("--- quote.pdf ---\nTaipei 5 days $1200");
    expect(out).toContain("--- pax.csv ---\nname,dob");
    expect(out.split("\n\n").length).toBe(2);
  });

  it("keeps ok_truncated text", () => {
    const out = buildFileContextText([r({ filename: "big.txt", parseStatus: "ok_truncated", text: "first part" })]);
    expect(out).toContain("--- big.txt ---\nfirst part");
  });

  it("notes an unreadable file instead of dropping it silently", () => {
    const out = buildFileContextText([
      r({ filename: "huge.pdf", kind: "pdf", parseStatus: "too_large", text: "" }),
      r({ filename: "blank.txt", parseStatus: "empty", text: "" }),
      r({ filename: "weird.bin", kind: "unknown", parseStatus: "unsupported", text: "" }),
      r({ filename: "broken.docx", kind: "docx", parseStatus: "parse_error", text: "" }),
    ]);
    expect(out).toContain("--- huge.pdf ---\n(檔案太大,讀不了)");
    expect(out).toContain("--- blank.txt ---\n(空檔)");
    expect(out).toContain("--- weird.bin ---\n(不支援的檔案類型)");
    expect(out).toContain("--- broken.docx ---\n(這個檔讀不出內容)");
  });

  it("returns empty string for no files", () => {
    expect(buildFileContextText([])).toBe("");
  });
});
