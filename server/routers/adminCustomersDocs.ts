/**
 * Pure helpers for customerDocs (server/routers/adminCustomers.ts).
 *
 * The customer page 文件 tab pulls from four real sources that already exist in
 * the DB — they were just never surfaced:
 *   - aiQuotes            → 報價單 PDF      (q:)
 *   - invoices            → 發票           (inv:)
 *   - customerDocuments   → email 附件 / 護照·簽證掃描 (cd:)
 *   - flightOrders        → 機票訂單 (info-only, no file) (fo:)
 *
 * Kept DB-free so the normalization + merge/sort is unit-testable. `kind` is a
 * stable code the client maps to an i18n label; `url` is the download link
 * (null = info-only row, e.g. a flight order). ids are namespaced so React
 * keys never collide across the four tables.
 */

export type CustomerDoc = {
  id: string;
  /** stable code → client i18n label */
  kind: "quote" | "invoice" | "passport" | "visa" | "insurance" | "medical" | "file" | "flight" | "confirmation";
  name: string;
  /** download link; null for info-only rows (flight orders carry no file) */
  url: string | null;
  /** short secondary line: status / amount / etc. */
  meta: string | null;
  createdAt: Date;
};

const money = (amount: number | string | null | undefined, currency: string | null | undefined): string | null => {
  if (amount == null) return null;
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return null;
  // Whole amounts stay clean (45,000); amounts with cents keep both digits
  // (1234.50 → 1,234.50, never the unfinished-looking 1,234.5).
  const formatted = Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency || "USD"} ${formatted}`;
};

export function quoteDoc(r: {
  id: number;
  quoteNumber: string | null;
  estimatedTotal: number | null;
  currency: string | null;
  pdfUrl: string | null;
  status: string | null;
  createdAt: Date;
}): CustomerDoc {
  return {
    id: `q:${r.id}`,
    kind: "quote",
    name: r.quoteNumber || `Quote #${r.id}`,
    url: r.pdfUrl || null,
    meta: [money(r.estimatedTotal, r.currency), r.status].filter(Boolean).join(" · ") || null,
    createdAt: r.createdAt,
  };
}

export function invoiceDoc(r: {
  id: number;
  invoiceNumber: string;
  totalAmount: string | number | null;
  currency: string | null;
  pdfUrl: string | null;
  status: string | null;
  createdAt: Date;
}): CustomerDoc {
  return {
    id: `inv:${r.id}`,
    kind: "invoice",
    name: r.invoiceNumber,
    url: r.pdfUrl || null,
    meta: [money(r.totalAmount, r.currency), r.status].filter(Boolean).join(" · ") || null,
    createdAt: r.createdAt,
  };
}

const DOC_KIND_BY_TYPE: Record<string, CustomerDoc["kind"]> = {
  passport: "passport",
  visa: "visa",
  insurance: "insurance",
  medical: "medical",
  other: "file",
};

export function uploadedDoc(r: {
  id: number;
  type: string;
  fileName: string | null;
  r2Url: string | null;
  uploadedAt: Date;
}): CustomerDoc {
  return {
    id: `cd:${r.id}`,
    kind: DOC_KIND_BY_TYPE[r.type] ?? "file",
    // PII docs (passport/visa) expose ONLY the filename + a download link —
    // never the encrypted passport number / DOB, which stay server-side.
    name: r.fileName || r.type,
    url: r.r2Url || null,
    meta: null,
    createdAt: r.uploadedAt,
  };
}

export function flightOrderDoc(r: {
  id: number;
  airline: string;
  flightSummary: string;
  status: string;
  createdAt: Date;
}): CustomerDoc {
  return {
    id: `fo:${r.id}`,
    kind: "flight",
    name: `${r.airline} · ${r.flightSummary}`,
    // bookingUrl is the Trip.com PAY page (Jeff opens it himself) — never a
    // download link in a read-only docs list.
    url: null,
    meta: r.status,
    createdAt: r.createdAt,
  };
}

/**
 * 訂製單 (custom-orders) → docs。一筆訂單可貢獻兩列:
 *   - 確認書 PDF (co-confirm:) — kind "confirmation"
 *   - 報價 PDF   (co-quote:)   — 僅當沒有對應 aiQuotes 列(quoteId == null),否則
 *     aiQuotes 的 q: 列已涵蓋,不重複上架。
 * name 用 orderNumber(client 以 kind 對應 i18n label),meta 放行程名。url 是
 * 引用 PDF(Jeff 上傳/貼),純展示,絕不洩成本。
 */
export function customOrderDocs(r: {
  id: number;
  orderNumber: string;
  title: string | null;
  quotePdfUrl: string | null;
  quoteId: number | null;
  confirmationPdfUrl: string | null;
  quoteSentAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
}): CustomerDoc[] {
  const docs: CustomerDoc[] = [];
  if (r.confirmationPdfUrl) {
    docs.push({
      id: `co-confirm:${r.id}`,
      kind: "confirmation",
      name: r.orderNumber,
      url: r.confirmationPdfUrl,
      meta: r.title || null,
      createdAt: r.confirmedAt ?? r.createdAt,
    });
  }
  if (r.quotePdfUrl && r.quoteId == null) {
    docs.push({
      id: `co-quote:${r.id}`,
      kind: "quote",
      name: r.orderNumber,
      url: r.quotePdfUrl,
      meta: r.title || null,
      createdAt: r.quoteSentAt ?? r.createdAt,
    });
  }
  return docs;
}

/**
 * Resolve a customerDocuments url for display. These rows store the R2 KEY (the
 * files can be passport/visa scans), so a bare key is signed to a short-TTL URL
 * on read; an already-full http(s) URL (legacy / other sources) is passed
 * through untouched; a sign failure degrades to null (info-only row) rather than
 * a broken or leaky link. Pure (signer injected) so the branch is testable.
 */
export async function signDocUrl(
  url: string | null,
  sign: (key: string) => Promise<string>,
): Promise<string | null> {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return await sign(url);
  } catch {
    return null;
  }
}

/** Merge the source groups into one list, newest first, capped to `lim`. */
export function mergeDocs(groups: CustomerDoc[][], lim = 50): CustomerDoc[] {
  return groups
    .flat()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, lim);
}
