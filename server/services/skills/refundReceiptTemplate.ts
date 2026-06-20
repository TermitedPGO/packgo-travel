/**
 * packgo-refund-receipt skill — server-side.
 *
 * Generates a single-page refund receipt PDF in PACK&GO black/white
 * brand style. Sent to customers after a refund is processed so they
 * have documentation of the refund amount, method, and timeline.
 *
 * Created 2026-06-18 after Wang Zimin refund case — previously had
 * no branded refund receipt template, was generating one-off HTML.
 */

import { escapeHtml, fmtNum, LOGO_NAVY_B64 } from "./skillPdfService";

export type RefundReceiptInput = {
  // Customer
  customerNames: string[];       // e.g. ["WANG ZIMIN", "ZHANG ZILAN"]
  // Trip
  tourName: string;              // e.g. "黃石公園七日遊 (YG7)"
  departureDate: string;         // e.g. "2026 年 7 月 11 日"
  // Original payment
  originalAmountUSD: number;
  paymentMethod: string;         // e.g. "Visa ****9594"
  paymentDate: string;           // e.g. "2026 年 6 月 17 日 1:44 PM"
  // Refund
  refundAmountUSD: number;
  refundDate: string;            // e.g. "2026 年 6 月 18 日"
  refundReason?: string;         // defaults to "訂單取消"
  refundTo?: string;             // defaults to paymentMethod
  referenceId?: string;          // e.g. "HWCU"
  // Optional extras
  notes?: string[];              // extra lines below refund section
};

export function renderRefundReceiptHtml(input: RefundReceiptInput): string {
  const reason = input.refundReason ?? "訂單取消";
  const refundTo = input.refundTo ?? input.paymentMethod;
  const refId = input.referenceId ?? "";
  const guestCount = input.customerNames.length;
  const guestList = input.customerNames
    .map((n) => escapeHtml(n))
    .join("、");

  const notesHtml = input.notes?.length
    ? `<div class="notes">${input.notes
        .map((n) => `<div class="note-line">${escapeHtml(n)}</div>`)
        .join("")}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>PACK&GO LLC — 退款收據</title>
<style>
  @page { size: A5; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Noto Sans CJK TC", "Heiti TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
    background: #fff; color: #111;
    display: flex; justify-content: center; padding: 40px 20px;
  }
  .receipt { width: 420px; border: 1.5px solid #111; padding: 40px 32px; }
  .header { text-align: center; padding-bottom: 24px; border-bottom: 1.5px solid #111; }
  .logo-img { width: 48px; height: auto; margin-bottom: 8px; }
  .company-name { font-size: 14px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; margin-bottom: 2px; }
  .company-sub { font-size: 10px; color: #888; letter-spacing: 1px; margin-bottom: 20px; }
  .refund-badge { display: inline-block; border: 1.5px solid #111; padding: 3px 14px; font-size: 11px; font-weight: 600; letter-spacing: 2px; }
  .amount { font-size: 38px; font-weight: 700; margin-top: 10px; letter-spacing: -1px; }
  .section { padding: 18px 0; border-bottom: 1px solid #ddd; }
  .section-title { font-size: 10px; font-weight: 600; letter-spacing: 2px; color: #888; margin-bottom: 12px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
  .row-label { font-size: 12.5px; color: #333; }
  .row-value { font-size: 12.5px; font-weight: 500; text-align: right; }
  .row-sub { font-size: 11px; color: #999; margin-bottom: 5px; margin-top: -1px; }
  .total-row { display: flex; justify-content: space-between; align-items: baseline; padding-top: 12px; border-top: 1.5px solid #111; margin-top: 12px; }
  .total-label { font-size: 13px; font-weight: 700; letter-spacing: 1px; }
  .total-value { font-size: 18px; font-weight: 700; }
  .notes { padding: 14px 0 0; }
  .note-line { font-size: 11px; color: #666; margin-bottom: 4px; }
  .footer { padding-top: 20px; text-align: center; }
  .footer-text { font-size: 10px; color: #999; line-height: 1.7; }
  .receipt-id { font-size: 9px; color: #bbb; margin-top: 14px; text-align: center; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="receipt">
  <div class="header">
    <img class="logo-img" src="data:image/png;base64,${LOGO_NAVY_B64}" alt="PACK&GO">
    <div class="company-name">PACK & GO</div>
    <div class="company-sub">LLC</div>
    <div class="refund-badge">退款收據</div>
    <div class="amount">$${fmtNum(input.refundAmountUSD)}.00</div>
  </div>

  <div class="section">
    <div class="section-title">原始付款</div>
    <div class="row">
      <span class="row-label">${escapeHtml(input.tourName)}</span>
      <span class="row-value">$${fmtNum(input.originalAmountUSD)}.00</span>
    </div>
    <div class="row-sub">旅客：${guestList}（${guestCount} 位）</div>
    <div class="row-sub">出發日期：${escapeHtml(input.departureDate)}</div>
    <div class="row">
      <span class="row-label">付款方式</span>
      <span class="row-value">${escapeHtml(input.paymentMethod)}</span>
    </div>
    <div class="row-sub">${escapeHtml(input.paymentDate)}</div>
  </div>

  <div class="section">
    <div class="section-title">退款資訊</div>
    <div class="row">
      <span class="row-label">原因</span>
      <span class="row-value">${escapeHtml(reason)}</span>
    </div>
    <div class="row">
      <span class="row-label">退款日期</span>
      <span class="row-value">${escapeHtml(input.refundDate)}</span>
    </div>
    <div class="row">
      <span class="row-label">退款至</span>
      <span class="row-value">${escapeHtml(refundTo)}</span>
    </div>
    <div class="row-sub">預計 7-14 個工作天內退回至您的帳戶</div>

    <div class="total-row">
      <span class="total-label">退款金額</span>
      <span class="total-value">$${fmtNum(input.refundAmountUSD)}.00</span>
    </div>
  </div>

  ${notesHtml}

  <div class="footer">
    <div class="footer-text">
      PACK&GO LLC<br>
      39055 Cedar Blvd #126, Newark, CA 94560<br>
      support@packgoplay.com
    </div>
    ${refId ? `<div class="receipt-id">REF #${escapeHtml(refId)}</div>` : ""}
  </div>
</div>
</body>
</html>`;
}
