// server/email/templates/customOrder.ts
//
// 訂製單三封客人信:報價 / 催款 / 確認書。設計 docs/features/custom-orders/design.md §4.4。
//
// 規範(memory: packgo_customer_msg_style / no_em_dashes / no_cost_on_customer_docs):
//   - Jeff 口語聲音:短、不官腔、不用破折號、不用打勾。
//   - 絕不出現供應商成本,只出現直客售價。
//   - 幣別符號依 currency,never 硬編 NT$。
//   - 信不自動發 — 只有 adminCustomerOrders 的 send* mutation(Jeff 親按)呼叫。
//
// 每個 sender 回 boolean(SMTP 未設定 → warn + false),並 notifyOwner 備援通知。

import { redactEmail } from "../../_core/redact";
import { notifyOwner } from "../../_core/notification";
import {
  wrapInBrandTemplate,
  emailButton,
} from "../../services/emailTemplateService";
import { EMAIL_FROM, getTransporter } from "../_shared";
import type {
  CustomOrderQuoteEmailData,
  CustomOrderCollectionEmailData,
  CustomOrderConfirmationEmailData,
} from "./types";

const FROM = `"PACK&GO Travel" <${EMAIL_FROM}>`;

/** Currency symbol — USD for direct customers; never hardcode NT$. */
function currencySymbol(currency?: string): string {
  const c = (currency || "USD").toUpperCase();
  if (c === "USD") return "$";
  if (c === "TWD") return "NT$";
  return `${c} `;
}

function money(amount: number, currency?: string): string {
  return `${currencySymbol(currency)}${Number(amount).toLocaleString()}`;
}

/** "{name}您好" / "Hi {name}" with a graceful no-name fallback. */
function greeting(name: string | null | undefined, isEN: boolean): string {
  const n = (name || "").trim();
  if (isEN) return n ? `Hi ${n},` : "Hi,";
  return n ? `${n}您好,` : "您好,";
}

/** Plain text → simple branded HTML (paragraphs + optional CTA button). */
function renderHtml(subject: string, text: string, cta?: { label: string; url: string }): string {
  const bodyHtml =
    `<p>${text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` +
    (cta ? `<div style="margin: 24px 0;">${emailButton(cta.label, cta.url)}</div>` : "");
  return wrapInBrandTemplate({ title: subject, bodyHtml });
}

async function deliver(args: {
  to: string;
  subject: string;
  text: string;
  cta?: { label: string; url: string };
  ownerSummary: string;
  logLabel: string;
}): Promise<boolean> {
  // Owner always gets a heads-up that a customer-facing send happened.
  await notifyOwner({ title: args.logLabel, content: args.ownerSummary }).catch(() => {});
  const smtp = getTransporter();
  if (!smtp) {
    console.warn(`[Email] SMTP not configured — ${args.logLabel} skipped for ${args.to ? redactEmail(args.to) : "(no email)"}`);
    return false;
  }
  if (!args.to) {
    console.warn(`[Email] ${args.logLabel} has no customer email — skipped`);
    return false;
  }
  try {
    await smtp.sendMail({
      from: FROM,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: renderHtml(args.subject, args.text, args.cta),
    });
    console.log(`[Email] ${args.logLabel} sent → ${redactEmail(args.to)}`);
    return true;
  } catch (err) {
    console.error(`[Email] ${args.logLabel} failed:`, err);
    return false;
  }
}

/** 報價:把 Jeff skill 出的報價 PDF 寄給客人。 */
export async function sendCustomOrderQuoteEmail(
  data: CustomOrderQuoteEmailData,
): Promise<boolean> {
  const isEN = data.language === "en";
  const hi = greeting(data.customerName, isEN);
  const subject = isEN
    ? `Your quote ${data.orderNumber}`
    : `您的行程報價 ${data.orderNumber}`;
  const text = isEN
    ? `${hi}\n\nHere is your quote for ${data.title}. Open the link below to view it.\n\nAnything you want to change, just reply to this email.\n\nPACK&GO Travel`
    : `${hi}\n\n這是您「${data.title}」的行程報價,點下面連結就能看。\n\n有想調整的地方或任何問題,直接回我這封信就好。\n\nPACK&GO 旅行社`;
  const cta = data.quotePdfUrl
    ? { label: isEN ? "View quote" : "查看報價", url: data.quotePdfUrl }
    : undefined;
  return deliver({
    to: data.customerEmail,
    subject,
    text,
    cta,
    ownerSummary: `訂製單 ${data.orderNumber} 報價已寄給 ${data.customerName || data.customerEmail}`,
    logLabel: `custom-order quote ${data.orderNumber}`,
  });
}

/** 催款:訂金或尾款,附 Square 付款連結。 */
export async function sendCustomOrderCollectionEmail(
  data: CustomOrderCollectionEmailData,
): Promise<boolean> {
  const isEN = data.language === "en";
  const hi = greeting(data.customerName, isEN);
  const amt = money(data.amount, data.currency);
  const labelZh = data.kind === "deposit" ? "訂金" : "尾款";
  const labelEn = data.kind === "deposit" ? "deposit" : "balance";
  const subject = isEN
    ? `${data.orderNumber} ${labelEn}`
    : `${data.orderNumber} ${labelZh}`;
  const text = isEN
    ? `${hi}\n\nThe ${labelEn} for ${data.title} is ${amt}. You can pay using the link below.\n\nOnce it is in I will get the rest arranged for you.\n\nPACK&GO Travel`
    : `${hi}\n\n「${data.title}」的${labelZh}是 ${amt},用下面的連結就可以付。\n\n付好我這邊會收到,再幫您把後面安排好。\n\nPACK&GO 旅行社`;
  const cta = data.paymentLink
    ? { label: isEN ? "Pay now" : "立即付款", url: data.paymentLink }
    : undefined;
  return deliver({
    to: data.customerEmail,
    subject,
    text,
    cta,
    ownerSummary: `訂製單 ${data.orderNumber} ${labelZh}催款已寄(${amt}) → ${data.customerName || data.customerEmail}`,
    logLabel: `custom-order ${labelEn} ${data.orderNumber}`,
  });
}

/** 確認書:行程已確認,附確認書 PDF。 */
export async function sendCustomOrderConfirmationEmail(
  data: CustomOrderConfirmationEmailData,
): Promise<boolean> {
  const isEN = data.language === "en";
  const hi = greeting(data.customerName, isEN);
  const subject = isEN
    ? `${data.orderNumber} confirmed`
    : `${data.orderNumber} 行程確認`;
  const depLine = data.departureDate
    ? isEN
      ? `Departure ${data.departureDate}.\n\n`
      : `出發日期 ${data.departureDate}。\n\n`
    : "";
  const text = isEN
    ? `${hi}\n\nYour ${data.title} is all confirmed. The confirmation is at the link below.\n\n${depLine}I will be in touch again before you go. Any questions, just reply.\n\nPACK&GO Travel`
    : `${hi}\n\n您的「${data.title}」已經確認好了,確認單放在下面連結。\n\n${depLine}出發前我會再跟您聯絡。有問題隨時回我。\n\nPACK&GO 旅行社`;
  const cta = data.confirmationPdfUrl
    ? { label: isEN ? "View confirmation" : "查看確認單", url: data.confirmationPdfUrl }
    : undefined;
  return deliver({
    to: data.customerEmail,
    subject,
    text,
    cta,
    ownerSummary: `訂製單 ${data.orderNumber} 確認書已寄給 ${data.customerName || data.customerEmail}`,
    logLabel: `custom-order confirmation ${data.orderNumber}`,
  });
}
