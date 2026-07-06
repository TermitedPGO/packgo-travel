/**
 * customerDocumentRender — 批八 塊一 渲染基建
 *
 * 從 customOrders 欄位取數 → 套 Jeff 品牌模板(server/documentTemplates/)→ headless
 * Chrome(puppeteerPool)渲染 PDF → 存 R2 的 reply-attachments/ 命名空間 + 寫一列
 * customerDocuments。所有金額只由訂單欄位推導,渲染前跑三道閘:
 *
 *   1. 數字白名單閘(assertAmountWhitelist):全文 US$ 金額必須 ⊆ 由訂單欄位推導的白名單。
 *   2. 成本防漏閘(assertNoCostLeak):全文不得含該單 supplierCost 或掛單 invoice 抽出的金額。
 *   3. 佔位完整性閘(fillTemplate):替換後殘留任何 {{ }} 即擋下,絕不佔位符湊。
 *
 * 另有(工具/orchestrator 層):完整性閘(缺必填欄位 → 拒絕列缺)、誠實閘(沒收訂金不准
 * 出「訂金已收」)、幣別閘(非 USD 拒絕)。純函式全部 export 供單元測試紅綠例驗證。
 *
 * 硬紅線:LLM 的 tool input 不准有任何金額;金額全部 code 從 totalPrice + 比例演算。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { customerDocuments } from "../../drizzle/schema";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { createChildLogger } from "./logger";
import { acquirePage, releasePage } from "./puppeteerPool";
import { REPLY_ATTACHMENT_KEY_PREFIX } from "./replyAttachments";

const log = createChildLogger({ module: "customerDocumentRender" });

// ── 型別 ────────────────────────────────────────────────────────────────────

export type CustomerDocumentKind =
  | "deposit_receipt" // 訂金收據(已收部分訂金)
  | "payment_request" // 預訂與支付單(未收款,跟客人要錢)
  | "paid_receipt" // 付款收據(已收全額)
  | "quote_summary"; // 單頁報價摘要

export type DepositRatio = "30%" | "50%";

/** customOrders 的必要子集(工具查好後傳入;金額欄位是 decimal → mysql2 回字串)。 */
export interface OrderForDocument {
  id: number;
  orderNumber: string;
  title: string;
  customerName: string;
  destination: string | null;
  departureDate: string | null; // "YYYY-MM-DD"
  returnDate: string | null;
  totalPrice: string | null;
  currency: string;
  supplierCost: string | null;
  depositPaidAt: Date | null;
  balancePaidAt: Date | null;
}

/** 閘門違反一律丟這個 error;gate 欄讓呼叫端分辨是哪一道閘擋的。 */
export class CustomerDocumentError extends Error {
  readonly gate: string;
  constructor(gate: string, message: string) {
    super(message);
    this.name = "CustomerDocumentError";
    this.gate = gate;
  }
}

// ── 金額工具(純)──────────────────────────────────────────────────────────

/** 字串/數字金額 → 分(整數),無法解析回 null。逗號容錯。 */
export function parseAmountToCents(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** 分 → "1,234.56"(固定兩位小數 + 千分位)。渲染與白名單共用同一格式,確保精確比對。 */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}.${frac}`;
}

// ── HTML 逸出(資料值用;logo b64 / 條款 <li> 片段不逸出)────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── 佔位替換 + 完整性閘(純)─────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{\s*[A-Z0-9_]+\s*\}\}/g;

/**
 * 佔位替換(split/join,值內含 $ 等特殊字元安全)。替換後若殘留任何 {{UPPER}} 佔位
 * → 丟 CustomerDocumentError("placeholder_incomplete")。這就是「缺料拒絕不佔位」的
 * 最後一道:寧可整份擋下,也不出一份帶 {{TITLE}} 的殘缺文件。
 */
export function fillTemplate(templateHtml: string, values: Record<string, string>): string {
  let out = templateHtml;
  for (const [key, val] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(val);
  }
  const residual = out.match(PLACEHOLDER_RE);
  if (residual && residual.length > 0) {
    throw new CustomerDocumentError(
      "placeholder_incomplete",
      `模板佔位未填滿(殘留):${[...new Set(residual)].join(", ")}`,
    );
  }
  return out;
}

// ── 掃描前正規化(兩閘共用)──────────────────────────────────────────────────

/**
 * 掃描前把 HTML 正規化,避免閘門被繞過或誤擊:
 *   - 移除 base64 data URI(logo 影像):8KB 隨機 base64 可能含成本數字序列,若不移除
 *     cost_leak 會誤擊 logo 位元組;金額也不會藏在影像資料裡。
 *   - 全形數字 U+FF10-FF19 → ASCII、全形錢號 U+FF04 → '$':防止用全形字繞過偵測。
 */
function normalizeForScan(html: string): string {
  return html
    .replace(/data:[a-z-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/＄/g, "$");
}

// ── 數字白名單閘(純)────────────────────────────────────────────────────────

// 貨幣金額標記:US$ / US $ / USD / 裸 $(全形 $ 已於 normalizeForScan 轉半形)。
// 任一標記 + 數字都算「貨幣金額」,一律要在白名單內。
const CURRENCY_AMOUNT_RE = /(?:US\s*\$|USD\b|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)/gi;

/**
 * 全文掃出的每一個「貨幣金額」(US$ / US $ / USD / $ 任一標記 + 數字)必須 ⊆ 白名單
 * (由訂單欄位推導)。比對以「分」為單位(格式無關,7196 與 7,196.00 同值)。出現白名單
 * 外金額 = 整份擋下 —— 擋掉任何從文案/佔位/覆寫條款混進來的金額,不論來源、不論寫法。
 */
export function assertAmountWhitelist(html: string, whitelist: Iterable<string>): void {
  const allowedCents = new Set<number>();
  for (const w of whitelist) {
    const c = parseAmountToCents(w);
    if (c != null) allowedCents.add(c);
  }
  const scan = normalizeForScan(html);
  const offenders: string[] = [];
  let m: RegExpExecArray | null;
  CURRENCY_AMOUNT_RE.lastIndex = 0;
  while ((m = CURRENCY_AMOUNT_RE.exec(scan)) !== null) {
    const cents = parseAmountToCents(m[1]);
    if (cents == null) continue;
    if (!allowedCents.has(cents)) offenders.push(m[1].trim());
  }
  if (offenders.length > 0) {
    throw new CustomerDocumentError(
      "amount_whitelist",
      `文件出現訂單欄位以外的金額(白名單外):${[...new Set(offenders)].join(", ")}`,
    );
  }
}

// ── 成本防漏閘(純)──────────────────────────────────────────────────────────

/**
 * 全文不得出現任一 forbidden 金額(供應商 supplierCost、掛單 invoice 抽出的 total)。
 * 命中 = 整份擋下。安全偏向:寧可誤擋一份合法文件(Jeff 看得到是哪個數字擋的),也不
 * 放任成本數字外洩(David 案教訓)。掃描前折疊「數字之間」的分隔符(逗號/空白/NBSP/thin
 * space),讓 3,498 / 3 498 / 3498 都比對得到。整數形只在成本本身是整數金額時才用,且不得
 * 後接小數,避免 3498.50 的成本去誤擋合法的 3498.00 售價。
 */
export function assertNoCostLeak(html: string, forbiddenCents: Iterable<number>): void {
  const list = [...forbiddenCents].filter((c) => Number.isFinite(c) && c > 0);
  if (list.length === 0) return;
  const scan = normalizeForScan(html).replace(/(\d)[,\s  ](?=\d)/g, "$1");
  const hits: string[] = [];
  for (const cents of list) {
    const abs = Math.round(Math.abs(cents));
    const dollars = Math.floor(abs / 100);
    const frac = abs % 100;
    const decForm = `${dollars}\\.${String(frac).padStart(2, "0")}`;
    const patterns = [`(?<![\\d.])${decForm}(?![\\d])`];
    if (frac === 0) patterns.push(`(?<![\\d.])${dollars}(?![\\d.])`);
    const re = new RegExp(patterns.join("|"));
    if (re.test(scan)) hits.push(formatCents(cents));
  }
  if (hits.length > 0) {
    throw new CustomerDocumentError(
      "cost_leak",
      `文件疑似含供應商成本/invoice 金額(成本鐵律擋下):${[...new Set(hits)].join(", ")}`,
    );
  }
}

// ── 完整性 + 誠實 + 幣別閘(純)──────────────────────────────────────────────

/** 各文件種類的必填欄位;缺的逐項回傳(空陣列 = 齊全)。 */
export function checkRequiredFields(_kind: CustomerDocumentKind, order: OrderForDocument): string[] {
  const missing: string[] = [];
  const totalCents = parseAmountToCents(order.totalPrice);
  if (totalCents == null || totalCents <= 0) missing.push("行程總價(totalPrice)");
  if (!order.title || order.title.trim() === "") missing.push("行程名稱(title)");
  if (!order.departureDate) missing.push("出發日期(departureDate)");
  return missing;
}

/**
 * 誠實閘:收款狀態決定可出哪一態。沒登記收訂金不准出「訂金已收」;沒登記付清不准出
 * 「已付清」。違反回錯誤字串,呼叫端拒絕生成。
 */
export function checkHonestyGate(kind: CustomerDocumentKind, order: OrderForDocument): string | null {
  if (kind === "deposit_receipt" && order.depositPaidAt == null) {
    return "此訂單尚未登記收到訂金(depositPaidAt 為空),不能出「訂金已收」收據。先在訂單登記收款,或改出「預訂與支付單/請款」給客人。";
  }
  if (kind === "paid_receipt" && order.balancePaidAt == null) {
    return "此訂單尚未登記付清尾款(balancePaidAt 為空),不能出「已付清全額」收據。";
  }
  return null;
}

/** 客人文件永遠 USD;非 USD 回錯誤字串(工具提示先換算)。 */
export function checkCurrencyGate(order: OrderForDocument): string | null {
  const cur = (order.currency || "USD").trim().toUpperCase();
  if (cur !== "USD") {
    return `此訂單幣別為 ${cur},客人文件一律以 USD 顯示。請先確認售價換算成 USD(exchangeRate)後再出單,不由工具自動換算。`;
  }
  return null;
}

// ── 日期格式(純)──────────────────────────────────────────────────────────

export function formatCalendarDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${Number(m[1])} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
}

export function formatDateRange(dep: string, ret: string | null): string {
  const depStr = formatCalendarDate(dep);
  if (!ret || ret === dep) return depStr;
  return `${depStr} 至 ${formatCalendarDate(ret)}`;
}

// ── 三態金額演算(純)────────────────────────────────────────────────────────

export interface ReceiptAmounts {
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  midLabel: string;
  balanceLabel: string;
  whitelist: string[];
}

/**
 * 依三態演算金額 + 卡片中/下列標籤。金額全由 totalCents + 比例枚舉推導,呼叫端不得
 * 傳入任何金額。paid_receipt 忽略 ratio(全額 → 餘款 0)。
 */
export function computeReceiptAmounts(
  kind: CustomerDocumentKind,
  totalCents: number,
  ratio: DepositRatio | undefined,
): ReceiptAmounts {
  if (kind === "paid_receipt") {
    return {
      totalCents,
      depositCents: totalCents,
      balanceCents: 0,
      midLabel: "已收款項·全額",
      balanceLabel: "應付餘款",
      whitelist: [formatCents(totalCents), formatCents(0)],
    };
  }
  if (kind !== "deposit_receipt" && kind !== "payment_request") {
    throw new CustomerDocumentError("kind", `computeReceiptAmounts 不支援 kind=${kind}`);
  }
  if (!ratio) {
    throw new CustomerDocumentError("missing_ratio", "訂金收據/請款單需指定訂金比例(30% 或 50%)。");
  }
  const fraction = ratio === "30%" ? 30 : 50;
  const depositCents = Math.round((totalCents * fraction) / 100);
  const balanceCents = totalCents - depositCents;
  const midLabel = kind === "deposit_receipt" ? `已收訂金（${ratio}）` : `應付訂金（${ratio}）`;
  const balanceLabel = kind === "deposit_receipt" ? "應付餘款" : "餘款(出發前付清)";
  return {
    totalCents,
    depositCents,
    balanceCents,
    midLabel,
    balanceLabel,
    whitelist: [formatCents(totalCents), formatCents(depositCents), formatCents(balanceCents)],
  };
}

// ── 條款(預設 + Jeff 文案覆寫;LLM 絕不自行生成條款)────────────────────────

export function DEFAULT_PAY_TERMS(ratio: DepositRatio | undefined): string[] {
  return [
    "接受信用卡刷卡付款(美金計價)",
    // 有比例(收據/請款)→ 明寫比例;沒比例(報價摘要,尚未定案)→ 中性句,不硬塞
    // 「約定比例」佔位(讀起來像漏字)。
    ratio
      ? `訂金:確認行程後 2 日內支付團費之 ${ratio}`
      : "訂金:確認行程後 2 日內支付團費訂金(實際比例以正式合約為準)",
    "尾款:出發前付清全額",
  ];
}

export const DEFAULT_CANCEL_TERMS: string[] = [
  "出發前 35 天及以上:退還全額(需扣除銀行手續費)",
  "出發前 16-34 天:退還 50%",
  "出發前 8-15 天:退還 20%",
  "出發前 7 天以內:不可退款",
];

/** 純文字條款列 → <li> 片段(逸出);空列回空字串。 */
export function termsToHtml(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join("");
}

/** Jeff 文案覆寫(多行純文字)→ <li>;沒給就用預設。 */
function resolveTerms(override: string | null | undefined, fallback: string[]): string {
  if (override && override.trim().length > 0) {
    return termsToHtml(override.split(/\r?\n/));
  }
  return termsToHtml(fallback);
}

// ── 模板 + logo 讀取(fs;WORKDIR 相對,Dockerfile 已 COPY documentTemplates)──

const TEMPLATE_DIR = path.join(process.cwd(), "server", "documentTemplates");

const TEMPLATE_FILE: Record<CustomerDocumentKind, string> = {
  deposit_receipt: "receipt/template.html",
  payment_request: "receipt/template.html",
  paid_receipt: "receipt/template.html",
  quote_summary: "quote-summary/template.html",
};

const DOC_LABEL: Record<CustomerDocumentKind, string> = {
  deposit_receipt: "訂金收據",
  payment_request: "預訂與支付單",
  paid_receipt: "付款收據",
  quote_summary: "報價摘要",
};

const DEFAULT_NOTE: Record<CustomerDocumentKind, string> = {
  deposit_receipt: "※ 本收據為訂金收取之證明,不作為正式發票。如有疑問請聯繫 Pack & Go。",
  payment_request: "※ 本單為預訂與付款通知,款項到帳後另開立正式收據。如有疑問請聯繫 Pack & Go。",
  paid_receipt: "※ 本收據為全額付款之證明,不作為正式發票。如有疑問請聯繫 Pack & Go。",
  quote_summary: "※ 本報價僅供參考,實際以簽約與結帳當日為準。如有疑問請聯繫 Pack & Go。",
};

const templateCache = new Map<string, string>();
let cachedLogos: { white: string; black: string } | null = null;

function loadTemplate(kind: CustomerDocumentKind): string {
  const rel = TEMPLATE_FILE[kind];
  let t = templateCache.get(rel);
  if (t == null) {
    t = readFileSync(path.join(TEMPLATE_DIR, rel), "utf8");
    templateCache.set(rel, t);
  }
  return t;
}

function loadLogos(): { white: string; black: string } {
  if (cachedLogos == null) {
    cachedLogos = {
      white: readFileSync(path.join(TEMPLATE_DIR, "assets", "logo-white_b64.txt"), "utf8").trim(),
      black: readFileSync(path.join(TEMPLATE_DIR, "assets", "logo-black_b64.txt"), "utf8").trim(),
    };
  }
  return cachedLogos;
}

// ── 值組裝(純,logo/模板另注入)─────────────────────────────────────────────

const KIND_META: Record<CustomerDocumentKind, { title: string; titleEn: string; badge: string }> = {
  deposit_receipt: { title: "訂金收據", titleEn: "DEPOSIT RECEIPT", badge: "訂金已收　DEPOSIT RECEIVED" },
  payment_request: { title: "預訂與支付單", titleEn: "BOOKING & PAYMENT", badge: "房位保留中　請於期限前付款" },
  paid_receipt: { title: "付款收據", titleEn: "PAYMENT RECEIPT", badge: "已付清全額　PAID IN FULL" },
  quote_summary: { title: "報價摘要", titleEn: "QUOTATION SUMMARY", badge: "報價確認後保留房位" },
};

export interface BuildValuesInput {
  kind: CustomerDocumentKind;
  order: OrderForDocument;
  depositRatio?: DepositRatio;
  now: Date;
  paxCount?: number | null;
  clientDisplayName?: string | null;
  note?: string | null;
  payTermsText?: string | null;
  cancelTermsText?: string | null;
  extraSectionsHtml?: string | null;
}

export interface BuiltDocument {
  values: Record<string, string>;
  whitelist: string[];
}

function docNumber(kind: CustomerDocumentKind, order: OrderForDocument, now: Date): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const prefix = kind === "quote_summary" ? "PGQ" : "PGR";
  return `${prefix}-${y}${mo}${d}-${order.id}`;
}

/**
 * 組裝佔位值 + 白名單。純函式(logo b64 由呼叫端注入,方便測試不碰 fs)。金額全由
 * 訂單 totalPrice + 比例演算,任何呼叫端傳入的欄位都不含金額。
 */
export function buildDocumentValues(input: BuildValuesInput, logos: { white: string; black: string }): BuiltDocument {
  const { kind, order, now } = input;
  const totalCents = parseAmountToCents(order.totalPrice);
  if (totalCents == null || totalCents <= 0) {
    throw new CustomerDocumentError("incomplete", "訂單無有效總價(totalPrice),無法出金額文件。");
  }
  const meta = KIND_META[kind];
  const dateStr = formatCalendarDate(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`,
  );
  const tripDates = order.departureDate ? formatDateRange(order.departureDate, order.returnDate) : "";
  const clientName = (input.clientDisplayName && input.clientDisplayName.trim()) || order.customerName;
  const note = (input.note && input.note.trim()) || DEFAULT_NOTE[kind];

  const common: Record<string, string> = {
    WHITE_LOGO: logos.white,
    BLACK_LOGO: logos.black,
    TITLE: escapeHtml(meta.title),
    TITLE_EN: escapeHtml(meta.titleEn),
    DATE: escapeHtml(dateStr),
    PAYEE: escapeHtml("Pack & Go, LLC"),
    CLIENT: escapeHtml(clientName),
    TRIP_NAME: escapeHtml(order.title),
    TRIP_DATES: escapeHtml(tripDates),
    BADGE_TEXT: escapeHtml(meta.badge),
    EXTRA_SECTIONS: input.extraSectionsHtml ?? "",
    PAY_TERMS: resolveTerms(input.payTermsText, DEFAULT_PAY_TERMS(input.depositRatio)),
    CANCEL_TERMS: resolveTerms(input.cancelTermsText, DEFAULT_CANCEL_TERMS),
    NOTE: escapeHtml(note),
  };

  if (kind === "quote_summary") {
    const paxRow =
      input.paxCount != null && input.paxCount > 0
        ? `<div class="line"><span class="k">人數</span><span class="v">${escapeHtml(String(input.paxCount))} 人</span></div>`
        : "";
    return {
      values: {
        ...common,
        QUOTE_NO: escapeHtml(docNumber(kind, order, now)),
        PAX_ROW: paxRow,
        TOTAL: formatCents(totalCents),
      },
      whitelist: [formatCents(totalCents)],
    };
  }

  const amt = computeReceiptAmounts(kind, totalCents, input.depositRatio);
  return {
    values: {
      ...common,
      RECEIPT_NO: escapeHtml(docNumber(kind, order, now)),
      TOTAL: formatCents(amt.totalCents),
      DEPOSIT: formatCents(amt.depositCents),
      BALANCE: formatCents(amt.balanceCents),
      MID_LABEL: escapeHtml(amt.midLabel),
      BALANCE_LABEL: escapeHtml(amt.balanceLabel),
    },
    whitelist: amt.whitelist,
  };
}

/**
 * 組 HTML + 跑三道閘(佔位完整性 + 數字白名單 + 成本防漏)。純字串進出,不碰 puppeteer,
 * 方便單元測試。forbiddenCents = supplierCost + 掛單 invoice 抽出金額(呼叫端算好)。
 */
export function renderDocumentHtml(input: BuildValuesInput, forbiddenCents: number[]): string {
  const logos = loadLogos();
  const built = buildDocumentValues(input, logos);
  const template = loadTemplate(input.kind);
  const html = fillTemplate(template, built.values); // 閘 3:佔位完整性
  assertAmountWhitelist(html, built.whitelist); // 閘 1:數字白名單
  assertNoCostLeak(html, forbiddenCents); // 閘 2:成本防漏
  return html;
}

// ── PDF 渲染(puppeteerPool,照 pdfGenerator 既有 prod 實證路線)───────────────

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const page = await acquirePage();
  try {
    await page.setViewport({ width: 1240, height: 1754 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluateHandle("document.fonts.ready");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await releasePage(page);
  }
}

// ── 存放(R2 reply-attachments/ + customerDocuments 一列)───────────────────

export interface GeneratedDocument {
  key: string;
  url: string;
  fileName: string;
  documentId: number;
  kind: CustomerDocumentKind;
}

function fileStamp(now: Date): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
}

export async function storeGeneratedDocument(args: {
  profileId: number;
  customOrderId: number;
  kind: CustomerDocumentKind;
  buffer: Buffer;
  now: Date;
}): Promise<GeneratedDocument> {
  const { profileId, customOrderId, kind, buffer, now } = args;
  const ts = now.getTime();
  // reply-attachments/ 命名空間 = 寄信附件安全邊界(replyAttachments 的外洩防線)。
  const key = `${REPLY_ATTACHMENT_KEY_PREFIX}${profileId}/generated-${ts}-${kind}.pdf`;
  const fileName = `${DOC_LABEL[kind]}_${fileStamp(now)}.pdf`;
  const { url } = await storagePut(key, buffer, "application/pdf");

  const db = await getDb();
  if (!db) throw new CustomerDocumentError("db", "資料庫連線不可用,無法記錄 customerDocuments。");
  const inserted = (await db.insert(customerDocuments).values({
    customerProfileId: profileId,
    type: "other", // 既有 enum 無 receipt/quote/flight;以 uploadedBy=generated + fileName 區分
    fileName,
    r2Url: key, // 存 KEY(signDocUrl 讀時簽短效 URL);與 reply-attachments 同一份實體
    uploadedBy: "generated",
    customOrderId,
    isCurrent: true,
  })) as unknown as Array<{ insertId?: number }>;
  const documentId = Array.isArray(inserted) ? inserted[0]?.insertId ?? 0 : 0;

  log.info({ profileId, customOrderId, kind, key, documentId }, "generated customer document stored");
  return { key, url, fileName, documentId, kind };
}

// ── Orchestrator(工具呼叫入口)──────────────────────────────────────────────

export interface GenerateCustomerDocumentInput extends BuildValuesInput {
  profileId: number;
  /** supplierCost 以外的額外禁止金額(掛單 invoice 抽出的 total);supplierCost 內部自動納入。 */
  extraForbiddenCents?: number[];
}

/**
 * 完整流程:幣別閘 → 完整性閘 → 誠實閘 → 組 HTML + 三道閘 → 渲染 PDF → 存 R2 +
 * customerDocuments。任一閘失敗丟 CustomerDocumentError(gate 標明哪道),絕不出殘缺/
 * 帶成本/帶白名單外金額的文件。回傳 { key, url, fileName, documentId } 供塊三掛草稿。
 */
export async function generateCustomerDocument(
  input: GenerateCustomerDocumentInput,
): Promise<GeneratedDocument> {
  const { kind, order, profileId, now } = input;

  const currencyErr = checkCurrencyGate(order);
  if (currencyErr) throw new CustomerDocumentError("currency", currencyErr);

  const missing = checkRequiredFields(kind, order);
  if (missing.length > 0) {
    throw new CustomerDocumentError("incomplete", `訂單缺少必填欄位,無法出文件:${missing.join("、")}`);
  }

  const honestyErr = checkHonestyGate(kind, order);
  if (honestyErr) throw new CustomerDocumentError("honesty", honestyErr);

  // 成本防漏:supplierCost 一律納入,加上掛單 invoice 抽出的金額。
  const forbidden: number[] = [];
  const scCents = parseAmountToCents(order.supplierCost);
  if (scCents != null && scCents > 0) forbidden.push(scCents);
  for (const c of input.extraForbiddenCents ?? []) {
    if (Number.isFinite(c) && c > 0) forbidden.push(c);
  }

  const html = renderDocumentHtml(input, forbidden);
  const buffer = await renderHtmlToPdf(html);
  return storeGeneratedDocument({ profileId, customOrderId: order.id, kind, buffer, now });
}
