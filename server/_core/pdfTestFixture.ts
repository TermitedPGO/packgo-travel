/**
 * pdf-attachment-reliability (2026-07-15) — self-generated PDF fixtures for
 * regression tests. Builds a minimal, structurally valid one-page PDF (real
 * xref offsets, Helvetica, ASCII text) entirely in code, so the real
 * pdf-parse@2.4.5 pipeline can be exercised without checking any binary
 * fixture into the repo. Contains ZERO customer data — all text is synthetic.
 *
 * Test-only helper: never import from production code.
 */

/** Escape characters that are special inside a PDF literal string. */
function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Build a one-page PDF whose text layer contains the given lines (ASCII only —
 * standard Helvetica, no font embedding). `buildTextPdf([])` produces a valid
 * page with NO text content, emulating a scanned/image-only PDF.
 */
export function buildTextPdf(lines: string[]): Buffer {
  const ops: string[] = ["BT", "/F1 12 Tf", "72 720 Td"];
  lines.forEach((line, i) => {
    if (i > 0) ops.push("0 -16 Td");
    ops.push(`(${escapePdfString(line)}) Tj`);
  });
  ops.push("ET");
  const content = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  // ASCII-only content → latin1 keeps byte offsets == string offsets.
  return Buffer.from(pdf, "latin1");
}

/** Synthetic itinerary lines (>40 normalized chars so the thin-text fallback
 *  must NOT trigger). Entirely made up — no real customer, trip, or price. */
export const FIXTURE_ITINERARY_LINES = [
  "PACKGO PARSER FIXTURE - synthetic itinerary, no real customer data.",
  "Day 1: Arrive at Test City, hotel check-in, welcome dinner.",
  "Day 2: Museum visit, lakeside walk, night market food tour.",
  "Day 3: Mountain day trip with scenic railway ride.",
];

/** A structurally valid text PDF with a healthy text layer. */
export function buildItineraryPdf(): Buffer {
  return buildTextPdf(FIXTURE_ITINERARY_LINES);
}

/** A structurally valid PDF with NO text layer (scanned-PDF stand-in). */
export function buildNoTextPdf(): Buffer {
  return buildTextPdf([]);
}

/** Bytes that claim to be a PDF but are structurally invalid — the primary
 *  parser must throw on these (the "primary throw" regression path). */
export function buildCorruptPdf(): Buffer {
  return Buffer.from("%PDF-1.4\nthis is not a valid pdf body at all", "latin1");
}

/**
 * Build a structurally valid PDF with `pageCount` pages, every page carrying
 * the same single ASCII text line. Used for the page-cap truncation
 * regression (Codex 14:07 §四.1: a 51-page PDF read to page 50 was silently
 * marked ok) — buildMultiPagePdf(51, …) exceeds the 50-page cap by one.
 */
export function buildMultiPagePdf(pageCount: number, lineText: string): Buffer {
  const line = escapePdfString(lineText);
  // Object ids: 1=Catalog, 2=Pages, 3..(2+n)=Page objs, (3+n)=Font,
  // (4+n)..(3+2n)=per-page content streams.
  const fontId = 3 + pageCount;
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(" ");

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
  ];
  for (let i = 0; i < pageCount; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${fontId + 1 + i} 0 R >>`
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < pageCount; i++) {
    const content = `BT\n/F1 12 Tf\n72 720 Td\n(${line} [page ${i + 1}]) Tj\nET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
