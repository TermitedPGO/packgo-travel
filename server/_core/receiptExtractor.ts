/**
 * receiptExtractor — email-receipt-intake (2026-06-15).
 *
 * Two jobs, both deliberately conservative because this touches money:
 *   1. detectReceipt()  — cheap, rules-only gate deciding whether an inbound
 *      email even LOOKS like a supplier invoice / receipt. Runs on every
 *      fresh email, so it must be fast and must NOT call the LLM.
 *   2. extractReceipt() — for emails that pass the gate, read the receipt
 *      attachment with Claude vision and pull out vendor / amount / currency /
 *      date / description.
 *
 * 鐵則 (見 docs/features/email-receipt-intake/design.md):
 *   - AI 只接收 + 讀出來,不入帳、不付款。
 *   - 搬運不生成、100% 正確:讀不清楚就回 needsReview=true,欄位留 null,
 *     絕不猜。下游一定有 Jeff 逐筆確認。
 *
 * Phase 1 scope = supplier invoices (most accurate): a PDF/image attachment +
 * a receipt-ish keyword. Pure-text / noreply receipts (Stripe, airlines) are
 * intentionally out of scope until phase 2 (the Gmail poll query also filters
 * `-from:noreply`, so those never even arrive yet).
 */

import sharp from "sharp";
import { invokeLLM } from "./llm";
import { logger } from "./logger";

const log = logger.child({ mod: "receiptExtractor" });

/** Vision model — same as imageOcr/pdf precedent. Cheap; Jeff confirms every
 * row anyway, so the needsReview gate + human confirm are the real safety net. */
const VISION_MODEL = "claude-haiku-4-5";
const MAX_EDGE = 1568; // Anthropic vision downscales beyond this anyway
/** Below this the row is flagged 請人工看 even if fields parsed. */
const MIN_CONFIDENCE = 60;

// ── Detection (pure, no LLM) ────────────────────────────────────────────────

/** Receipt / invoice signal words in subject, body, or attachment filename. */
const RECEIPT_KEYWORDS = [
  // English
  "invoice", "receipt", "statement", "bill", "billing", "proforma",
  "payment", "paid", "amount due", "order confirmation", "remittance",
  // 繁中 / 简中
  "收據", "發票", "帳單", "对账单", "對帳單", "請款", "应付", "應付",
  "付款", "繳費", "缴费", "訂單確認", "订单确认", "確認單", "收費",
];

function hasReceiptKeyword(haystack: string): boolean {
  const lower = haystack.toLowerCase();
  return RECEIPT_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

function isReceiptAttachment(a: { filename: string; mimeType: string; kind?: string }): boolean {
  const mime = (a.mimeType || "").toLowerCase();
  const name = (a.filename || "").toLowerCase();
  if (a.kind === "pdf" || a.kind === "image") return true;
  if (mime === "application/pdf" || mime.startsWith("image/")) return true;
  return /\.(pdf|png|jpe?g|webp|heic|gif)$/i.test(name);
}

/**
 * Rules-only gate. True only when the email both carries a PDF/image
 * attachment AND reads like a receipt (keyword in subject/body/filename).
 * Conservative on purpose — false negatives just fall through to the normal
 * customer-inquiry pipeline, false positives are cheap (Jeff rejects).
 */
export function detectReceipt(input: {
  subject: string;
  body: string;
  attachments: Array<{ filename: string; mimeType: string; kind?: string }>;
}): { isReceipt: boolean; reason: string } {
  const receiptAttachments = (input.attachments || []).filter(isReceiptAttachment);
  if (receiptAttachments.length === 0) {
    return { isReceipt: false, reason: "no-pdf-or-image-attachment" };
  }
  const filenames = receiptAttachments.map((a) => a.filename).join(" ");
  const haystack = `${input.subject}\n${input.body}\n${filenames}`;
  if (!hasReceiptKeyword(haystack)) {
    return { isReceipt: false, reason: "no-receipt-keyword" };
  }
  return { isReceipt: true, reason: "attachment+keyword" };
}

/** Pick the attachment most likely to BE the receipt: prefer PDF, then image. */
export function pickReceiptAttachment<T extends { filename: string; mimeType: string }>(
  attachments: T[],
): T | null {
  const pdf = attachments.find(
    (a) => a.mimeType?.toLowerCase() === "application/pdf" || /\.pdf$/i.test(a.filename),
  );
  if (pdf) return pdf;
  const img = attachments.find(
    (a) => a.mimeType?.toLowerCase().startsWith("image/") || /\.(png|jpe?g|webp|heic|gif)$/i.test(a.filename),
  );
  return img ?? null;
}

// ── Extraction result + parsing (parsing is pure → unit-testable) ────────────

export interface ReceiptExtraction {
  /** The model's own judgment that this really is a receipt. */
  isReceipt: boolean;
  vendor: string | null;
  /** Total amount in `currency`. Null = unreadable (do not guess). */
  amount: number | null;
  /** ISO 4217 (USD/TWD/JPY/CNY/EUR…). Null = unreadable. */
  currency: string | null;
  /** YYYY-MM-DD or null. */
  receiptDate: string | null;
  /** What was bought / line items, short plain text. */
  description: string | null;
  confidence: number; // 0-100
  /** True → show 請人工看; downstream must not trust the fields. */
  needsReview: boolean;
  /** Raw LLM text, kept for audit. */
  raw: string;
}

function normalizeAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? round2(v) : null;
  if (typeof v === "string") {
    // strip currency symbols, thousands separators, spaces, letters
    const cleaned = v.replace(/[^\d.,-]/g, "").replace(/,/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? round2(n) : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeCurrency(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  // Strict: only accept a real ISO-4217-shaped code. We never map ambiguous
  // symbols ($ / ¥) ourselves — that would be guessing. The model is asked to
  // return the ISO code; if it couldn't, this stays null → needsReview.
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

function normalizeDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\//g, "-");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function cleanStr(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || /^(n\/?a|none|null|unknown|未知|無)$/i.test(s)) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Parse the LLM's JSON response into a normalized ReceiptExtraction, applying
 * the needsReview gate. PURE — the unit tests feed it real-receipt-shaped
 * model outputs and assert the money fields. Tolerant of ```json fences and
 * surrounding prose.
 */
export function parseReceiptResponse(raw: string): ReceiptExtraction {
  const fallback = (): ReceiptExtraction => ({
    isReceipt: false,
    vendor: null,
    amount: null,
    currency: null,
    receiptDate: null,
    description: null,
    confidence: 0,
    needsReview: true,
    raw,
  });

  if (!raw || typeof raw !== "string") return fallback();

  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    // tolerate ```json fences / leading prose — grab the first {...} block
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback();
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return fallback();
    }
  }
  if (!obj || typeof obj !== "object") return fallback();

  const isReceipt = obj.is_receipt === true || obj.isReceipt === true;
  const vendor = cleanStr(obj.vendor, 255);
  const amount = normalizeAmount(obj.amount);
  const currency = normalizeCurrency(obj.currency);
  const receiptDate = normalizeDate(obj.date ?? obj.receiptDate);
  const description = cleanStr(obj.description, 2000);
  let confidence = typeof obj.confidence === "number" ? obj.confidence : 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 100) confidence = 100;

  const needsReview =
    !isReceipt ||
    amount === null ||
    vendor === null ||
    currency === null ||
    confidence < MIN_CONFIDENCE;

  return {
    isReceipt,
    vendor,
    amount,
    currency,
    receiptDate,
    description,
    confidence,
    needsReview,
    raw,
  };
}

const SYSTEM_PROMPT = `你是 PACK&GO 旅行社的收據/發票判讀助手。你會收到一封廠商寄來的信(主旨、寄件人、內文)以及附件(發票或收據的 PDF/圖片)。
你的工作只有「讀出來」,不做任何記帳、不付款、不下判斷該算哪一團。

請從附件(以附件為準,內文僅輔助)讀出以下欄位,輸出「單一 JSON 物件」,不要 markdown、不要多餘文字:
{
  "is_receipt": true 或 false,            // 這到底是不是收據/發票/帳單?不是就 false
  "vendor": "廠商/商家名稱" 或 null,
  "amount": 數字 或 null,                  // 應付/已付「總額」(含稅後的最終金額),只要一個數字
  "currency": "ISO 4217 三碼" 或 null,     // 例 USD、TWD、JPY、CNY、EUR。讀不出確切幣別就 null,不要用符號猜
  "date": "YYYY-MM-DD" 或 null,            // 發票/收據日期
  "description": "買了什麼(品項摘要,簡短)" 或 null,
  "confidence": 0 到 100 的整數            // 你對上面數字正確的把握
}

鐵則:
- 看不清楚、模糊、被裁切、或不確定的欄位一律填 null,並調低 confidence。絕對不要編造或推測金額/幣別。
- amount 只給「最終總額」一個數字;有多個品項時把明細放進 description,總額放 amount。
- 幣別一定要有依據(發票上寫的、$符號旁的代碼、地區);純看到 $ 但不確定是美金還台幣港幣 → currency 填 null。`;

/**
 * Read a receipt attachment via Claude vision and extract the money fields.
 * NEVER throws — on any failure returns a needsReview=true extraction so the
 * caller still queues a "請人工看" card (nothing is silently dropped).
 */
export async function extractReceipt(input: {
  subject: string;
  from: string;
  body: string;
  attachments: Array<{ filename: string; mimeType: string; bytes: Buffer }>;
}): Promise<ReceiptExtraction> {
  const picked = pickReceiptAttachment(input.attachments);
  if (!picked) {
    log.warn({ from: input.from }, "[receiptExtractor] no usable attachment");
    return parseReceiptResponse(""); // → needsReview
  }

  // Build the vision content block (downscale images; PDFs pass through).
  let visionBlock:
    | { type: "image_url"; image_url: { url: string } }
    | { type: "file_url"; file_url: { url: string; mime_type: "application/pdf" } };
  const isPdf =
    picked.mimeType?.toLowerCase() === "application/pdf" || /\.pdf$/i.test(picked.filename);
  try {
    if (isPdf) {
      const dataUrl = `data:application/pdf;base64,${picked.bytes.toString("base64")}`;
      visionBlock = { type: "file_url", file_url: { url: dataUrl, mime_type: "application/pdf" } };
    } else {
      const jpeg = await sharp(picked.bytes)
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      visionBlock = { type: "image_url", image_url: { url: dataUrl } };
    }
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), filename: picked.filename },
      "[receiptExtractor] could not prepare attachment for vision",
    );
    return parseReceiptResponse("");
  }

  const contextText =
    `寄件人:${input.from}\n主旨:${input.subject}\n` +
    `內文(輔助參考,以附件為準):\n${(input.body || "").slice(0, 2000)}\n\n` +
    `附件檔名:${picked.filename}。請讀這份收據/發票。`;

  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            visionBlock as unknown as { type: "text"; text: string },
            { type: "text", text: contextText },
          ],
        },
      ],
      model: VISION_MODEL,
      maxTokens: 1024,
      response_format: { type: "json_object" },
    } as Parameters<typeof invokeLLM>[0]);

    const raw =
      (result as { choices?: Array<{ message?: { content?: unknown } }> })
        ?.choices?.[0]?.message?.content ?? "";
    const text = typeof raw === "string" ? raw : "";
    if (!text) {
      log.warn({ filename: picked.filename }, "[receiptExtractor] empty vision response");
      return parseReceiptResponse("");
    }
    return parseReceiptResponse(text);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), filename: picked.filename },
      "[receiptExtractor] vision call failed",
    );
    return parseReceiptResponse("");
  }
}
