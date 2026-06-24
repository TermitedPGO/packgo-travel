/**
 * customerFacts (customer-cockpit) — the DETERMINISTIC half of the customer
 * summary. The four-field card used to be 100% Haiku narrative, so it could
 * (and did) lie: Jenny's card said「待交付」when her order was already confirmed,
 * because the model narrated instead of reading the system's own timestamps.
 *
 * Jeff 憲法 (admin_ai_boundary): AI 出手處資訊 100% 正確,搬運不生成。So the two
 * FACTUAL fields are computed here from authoritative rows, never from the LLM:
 *   - actions  (做了什麼) = our outbound activity log (回信、寄報價、收款、出確認書)
 *   - delivered(給了什麼) = the concrete documents the customer now has in hand
 *
 * The signals are real timestamps / status enums, not prose:
 *   customOrders.{quoteSentAt, collectionSentAt, depositPaidAt, balancePaidAt,
 *                confirmedAt, status}  (the state-machine anchor)
 *   aiQuotes.status (generated/sent/viewed/converted/expired)
 *   invoices.status (draft/sent/paid/overdue/cancelled)
 *   customerInteractions.direction (inbound/outbound)
 *   customerDocuments (uploadedBy="email_sent") — files we emailed the customer.
 *     詢問階段的交付幾乎只活在這裡(行程表 / 報價 PDF 當 email 附件),沒有訂製單
 *     也算交付。少了它,Jenny 那種純詢問客人會被誤報「還沒交付任何文件」。
 *
 * Identity resolution mirrors loadCustomerDocs / customerChatContext exactly
 * (userId → profileIds + verified email), so the facts cover the same canonical
 * customer the rest of the cockpit shows. Nothing here is persisted.
 *
 * The derivers (deriveActions / deriveDelivered / formatFactsLedger) are PURE
 * and unit-tested; gatherCustomerFacts does the IO and degrades to empty facts
 * when the DB is down (the summary still renders, just with empty factual lines).
 */
import { eq, or, and, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "customerFacts" });

export interface OrderFact {
  orderNumber: string;
  title: string | null;
  status: string;
  currency: string;
  quoteSentAt: Date | null;
  collectionSentAt: Date | null;
  depositPaidAt: Date | null;
  balancePaidAt: Date | null;
  confirmedAt: Date | null;
}

export interface QuoteFact {
  quoteNumber: string;
  status: string;
  createdAt: Date | null;
}

export interface InvoiceFact {
  invoiceNumber: string;
  status: string;
  sentAt: Date | null;
  paidAt: Date | null;
}

/** A file we emailed the customer (customerDocuments, uploadedBy="email_sent").
 *  Metadata only — the fileName, never the contents (PII never enters a prompt). */
export interface DocFact {
  fileName: string;
  sentAt: Date | null;
}

/** Everything the deterministic fields are computed from. All counts/dates are
 *  authoritative DB facts — no inference. */
export interface CustomerFacts {
  orders: OrderFact[];
  quotes: QuoteFact[];
  invoices: InvoiceFact[];
  /** Files we emailed the customer (行程表 / 報價 PDF 等附件). The delivery
   *  signal for inquiry-stage customers who have no order/quote/invoice yet. */
  deliveredDocs: DocFact[];
  /** Emails / messages WE sent the customer (never spam — outbound is ours). */
  outboundCount: number;
  outboundLastAt: Date | null;
  /** Emails / messages the customer sent us. */
  inboundCount: number;
  inboundLastAt: Date | null;
  /** Registered-only: bookings that reached confirmed. */
  confirmedBookingCount: number;
}

export const EMPTY_FACTS: CustomerFacts = {
  orders: [],
  quotes: [],
  invoices: [],
  deliveredDocs: [],
  outboundCount: 0,
  outboundLastAt: null,
  inboundCount: 0,
  inboundLastAt: null,
  confirmedBookingCount: 0,
};

export type FactsScope = { userId: number } | { profileId: number };

// ── pure formatting helpers ────────────────────────────────────────────────

/** M/D in PACK&GO's business timezone (Newark CA = America/Los_Angeles). The
 *  summary is computed server-side (Fly = UTC) but READ by Jeff in Pacific, and
 *  the 文件 tab renders its dates client-side in his local clock — so we must
 *  format the instant in Pacific or a late-evening send shows up a day off and
 *  stops lining up. Same calendar Jeff sees, every time. */
const MD_LA = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "numeric",
  day: "numeric",
});
function md(d: Date | null): string {
  if (!d) return "";
  return MD_LA.format(d); // "6/22"
}

/** Drop a trailing file extension so the 給了什麼 line reads like the 文件 tab
 *  ("…報價與行程_2026.pdf" → "…報價與行程_2026"). Only the last .ext. */
function stripDocExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,6}$/, "").trim();
}

/** "檔名(6/22)" — a file we emailed the customer + the date it went out, dated
 *  in business tz so it aligns with the 文件 tab. Empty name → "". */
function docLabel(d: DocFact): string {
  const name = stripDocExt(d.fileName);
  if (!name) return "";
  const date = md(d.sentAt);
  return date ? `${name}(${date})` : name;
}

/** aiQuotes statuses that mean the quote actually reached the customer. */
const QUOTE_DELIVERED = new Set(["sent", "viewed", "converted"]);
/** invoices statuses that mean it was sent out. */
const INVOICE_DELIVERED = new Set(["sent", "paid", "overdue"]);

/** Join distinct, non-empty parts with 、 and cap length (Jeff tone: 口語、
 *  無破折號、無打勾). Empty list → the provided fallback sentence. */
function joinFacts(parts: string[], fallback: string, cap = 140): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  if (!out.length) return fallback;
  const joined = out.join("、");
  return joined.length > cap ? joined.slice(0, cap) + "…" : joined;
}

/**
 * 做了什麼 — our activity log, computed. The VERBS (replied / sent quote /
 * collected / confirmed), not the documents. Pure.
 */
export function deriveActions(facts: CustomerFacts): string {
  const parts: string[] = [];

  if (facts.outboundCount > 0) {
    const last = facts.outboundLastAt ? `,最後 ${md(facts.outboundLastAt)}` : "";
    parts.push(`回了 ${facts.outboundCount} 封信${last}`);
  }
  if (facts.orders.some((o) => o.quoteSentAt)) parts.push("寄了報價");
  if (facts.orders.some((o) => o.collectionSentAt)) parts.push("寄了付款連結");
  if (facts.orders.some((o) => o.depositPaidAt)) parts.push("收了訂金");
  if (facts.orders.some((o) => o.balancePaidAt)) parts.push("收了尾款");
  if (facts.orders.some((o) => o.confirmedAt)) parts.push("出了確認書");
  if (facts.confirmedBookingCount > 0) parts.push("成立了訂單");

  return joinFacts(parts, "目前還沒有對外動作記錄");
}

/**
 * 給了什麼 — the concrete documents the customer now has in hand, computed from
 * the authoritative sent/confirmed timestamps + status enums. Pure.
 */
export function deriveDelivered(facts: CustomerFacts): string {
  const parts: string[] = [];

  // (ORD-2026-0001,6/18) / (ORD-2026-0001) / (6/18) / "" — order# and date both
  // inside one paren so the line reads clean.
  const tag = (orderNumber: string, d: Date | null) => {
    const bits = [orderNumber, md(d)].filter(Boolean);
    return bits.length ? `(${bits.join(",")})` : "";
  };
  for (const o of facts.orders) {
    if (o.quoteSentAt) parts.push(`報價${tag(o.orderNumber, o.quoteSentAt)}`);
    if (o.confirmedAt) parts.push(`確認書${tag(o.orderNumber, o.confirmedAt)}`);
  }
  for (const q of facts.quotes) {
    if (QUOTE_DELIVERED.has(q.status)) parts.push(`報價單 ${q.quoteNumber}`);
  }
  for (const inv of facts.invoices) {
    if (INVOICE_DELIVERED.has(inv.status)) parts.push(`發票 ${inv.invoiceNumber}`);
  }
  // Files we emailed the customer (行程表 / 報價 PDF 當附件). For inquiry-stage
  // customers with no order/quote/invoice these ARE the delivery — listing them
  // by name + date (per Jeff) matches the 文件 tab exactly. joinFacts dedupes + caps.
  for (const d of facts.deliveredDocs) {
    const label = docLabel(d);
    if (label) parts.push(label);
  }

  return joinFacts(parts, "目前還沒有交付任何文件給客人");
}

/**
 * A compact, authoritative ledger handed to the LLM so its wants/nextStep are
 * GROUNDED (it must not suggest「寄報價」when quoteSentAt already exists). Pure.
 */
export function formatFactsLedger(facts: CustomerFacts): string {
  const lines: string[] = ["【系統事實(這些是真實記錄,不可改寫,nextStep 要據此判斷)】"];
  if (facts.orders.length) {
    for (const o of facts.orders.slice(0, 5)) {
      const stamps = [
        o.quoteSentAt && `報價已寄 ${md(o.quoteSentAt)}`,
        o.collectionSentAt && `付款連結已寄 ${md(o.collectionSentAt)}`,
        o.depositPaidAt && `訂金已收 ${md(o.depositPaidAt)}`,
        o.balancePaidAt && `尾款已收 ${md(o.balancePaidAt)}`,
        o.confirmedAt && `確認書已出 ${md(o.confirmedAt)}`,
      ].filter(Boolean);
      lines.push(
        `- 訂單 ${o.orderNumber}(${o.title || "未命名"})狀態=${o.status}` +
          (stamps.length ? ` · ${stamps.join("、")}` : " · 尚無寄送/收款記錄"),
      );
    }
  } else {
    lines.push("- 目前沒有訂製單");
  }
  const sentQuotes = facts.quotes.filter((q) => QUOTE_DELIVERED.has(q.status));
  if (sentQuotes.length) lines.push(`- 已送出報價單:${sentQuotes.map((q) => q.quoteNumber).join("、")}`);
  if (facts.deliveredDocs.length)
    lines.push(
      `- 已 email 寄給客人的文件:${facts.deliveredDocs
        .map(docLabel)
        .filter(Boolean)
        .join("、")}`,
    );
  lines.push(
    `- 來往信件:我們回了 ${facts.outboundCount} 封,客人來了 ${facts.inboundCount} 封` +
      (facts.outboundLastAt ? `(我們最後回信 ${md(facts.outboundLastAt)})` : ""),
  );
  return lines.join("\n");
}

// ── IO ──────────────────────────────────────────────────────────────────────

/** Resolve a scope to { profileIds, userId, email } — the same canonical set
 *  loadCustomerDocs uses, so facts and docs describe one customer. */
async function resolveIdentity(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  scope: FactsScope,
): Promise<{ profileIds: number[]; userId: number | null; email: string | null }> {
  const { users, customerProfiles } = await import("../../drizzle/schema");

  if ("userId" in scope) {
    const userId = scope.userId;
    const email =
      (
        await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      )[0]?.email ?? null;
    const profs = await db
      .select({ id: customerProfiles.id })
      .from(customerProfiles)
      .where(
        email
          ? or(eq(customerProfiles.userId, userId), eq(customerProfiles.email, email))
          : eq(customerProfiles.userId, userId),
      );
    return { profileIds: profs.map((p) => p.id), userId, email };
  }

  const prof = (
    await db
      .select({ id: customerProfiles.id, email: customerProfiles.email })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, scope.profileId))
      .limit(1)
  )[0];
  return {
    profileIds: prof ? [prof.id] : [],
    userId: null,
    email: prof?.email ?? null,
  };
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

/** Gather the authoritative facts for a customer. Degrades to EMPTY_FACTS on a
 *  down DB or any query error (the summary still renders). Nothing persisted. */
export async function gatherCustomerFacts(scope: FactsScope): Promise<CustomerFacts> {
  const db = await getDb();
  if (!db) return EMPTY_FACTS;

  try {
    const { profileIds, userId, email } = await resolveIdentity(db, scope);
    const {
      customOrders,
      aiQuotes,
      invoices,
      customerInteractions,
      customerDocuments,
      bookings,
    } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");

    // 訂製單 — the state-machine anchor, keyed by profileId(s).
    const orders: OrderFact[] = profileIds.length
      ? (
          await db
            .select({
              orderNumber: customOrders.orderNumber,
              title: customOrders.title,
              status: customOrders.status,
              currency: customOrders.currency,
              quoteSentAt: customOrders.quoteSentAt,
              collectionSentAt: customOrders.collectionSentAt,
              depositPaidAt: customOrders.depositPaidAt,
              balancePaidAt: customOrders.balancePaidAt,
              confirmedAt: customOrders.confirmedAt,
            })
            .from(customOrders)
            .where(inArray(customOrders.customerProfileId, profileIds))
            .orderBy(desc(customOrders.createdAt))
            .limit(20)
        ).map((o) => ({
          orderNumber: o.orderNumber,
          title: o.title,
          status: o.status,
          currency: o.currency,
          quoteSentAt: toDate(o.quoteSentAt),
          collectionSentAt: toDate(o.collectionSentAt),
          depositPaidAt: toDate(o.depositPaidAt),
          balancePaidAt: toDate(o.balancePaidAt),
          confirmedAt: toDate(o.confirmedAt),
        }))
      : [];

    // aiQuotes — owned by userId OR unattributed under the verified email.
    const quoteConds: SQL[] = [];
    if (userId != null) quoteConds.push(eq(aiQuotes.userId, userId));
    if (email)
      quoteConds.push(
        and(sql`${aiQuotes.userId} IS NULL`, eq(aiQuotes.customerEmail, email)) as SQL,
      );
    const quotes: QuoteFact[] = quoteConds.length
      ? (
          await db
            .select({
              quoteNumber: aiQuotes.quoteNumber,
              status: aiQuotes.status,
              createdAt: aiQuotes.createdAt,
            })
            .from(aiQuotes)
            .where(or(...quoteConds))
            .orderBy(desc(aiQuotes.createdAt))
            .limit(20)
        ).map((q) => ({
          quoteNumber: q.quoteNumber,
          status: q.status,
          createdAt: toDate(q.createdAt),
        }))
      : [];

    // invoices — same identity rule.
    const invConds: SQL[] = [];
    if (userId != null) invConds.push(eq(invoices.userId, userId));
    if (email)
      invConds.push(
        and(sql`${invoices.userId} IS NULL`, eq(invoices.customerEmail, email)) as SQL,
      );
    const invoiceFacts: InvoiceFact[] = invConds.length
      ? (
          await db
            .select({
              invoiceNumber: invoices.invoiceNumber,
              status: invoices.status,
              sentAt: invoices.sentAt,
              paidAt: invoices.paidAt,
            })
            .from(invoices)
            .where(or(...invConds))
            .orderBy(desc(invoices.createdAt))
            .limit(20)
        ).map((inv) => ({
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          sentAt: toDate(inv.sentAt),
          paidAt: toDate(inv.paidAt),
        }))
      : [];

    // Files we emailed the customer — uploadedBy="email_sent" (sentMailFiling)
    // is definitively outbound; type="other" double-guards PII (passport / visa /
    // insurance / medical are inbound scans, never "我們給的"). Metadata only:
    // we read fileName, never the bytes, so nothing PII enters a prompt.
    const deliveredDocs: DocFact[] = profileIds.length
      ? (
          await db
            .select({
              fileName: customerDocuments.fileName,
              uploadedAt: customerDocuments.uploadedAt,
            })
            .from(customerDocuments)
            .where(
              and(
                inArray(customerDocuments.customerProfileId, profileIds),
                eq(customerDocuments.uploadedBy, "email_sent"),
                eq(customerDocuments.type, "other"),
              ),
            )
            .orderBy(desc(customerDocuments.uploadedAt))
            .limit(20)
        )
          .filter((d) => d.fileName != null)
          .map((d) => ({ fileName: d.fileName as string, sentAt: toDate(d.uploadedAt) }))
      : [];

    // Email/message direction counts (authoritative, aggregated in SQL so a
    // heavy customer isn't undercounted by a row cap).
    let outboundCount = 0;
    let inboundCount = 0;
    let outboundLastAt: Date | null = null;
    let inboundLastAt: Date | null = null;
    if (profileIds.length) {
      const agg = await db
        .select({
          direction: customerInteractions.direction,
          cnt: sql<number>`count(*)`,
          last: sql<string>`max(${customerInteractions.createdAt})`,
        })
        .from(customerInteractions)
        .where(inArray(customerInteractions.customerProfileId, profileIds))
        .groupBy(customerInteractions.direction);
      for (const row of agg) {
        const n = Number(row.cnt) || 0;
        if (row.direction === "outbound") {
          outboundCount = n;
          outboundLastAt = toDate(row.last);
        } else if (row.direction === "inbound") {
          inboundCount = n;
          inboundLastAt = toDate(row.last);
        }
      }
    }

    // Confirmed bookings (registered only).
    let confirmedBookingCount = 0;
    if (userId != null) {
      const [b] = await db
        .select({ cnt: sql<number>`count(*)` })
        .from(bookings)
        .where(
          and(eq(bookings.userId, userId), eq(bookings.bookingStatus, "confirmed")),
        );
      confirmedBookingCount = Number(b?.cnt) || 0;
    }

    return {
      orders,
      quotes,
      invoices: invoiceFacts,
      deliveredDocs,
      outboundCount,
      outboundLastAt,
      inboundCount,
      inboundLastAt,
      confirmedBookingCount,
    };
  } catch (err) {
    log.warn(
      { scope, err: (err as Error).message },
      "[customerFacts] gather failed — summary continues with empty facts",
    );
    return EMPTY_FACTS;
  }
}
