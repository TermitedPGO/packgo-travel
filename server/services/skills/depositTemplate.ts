/**
 * packgo-deposit skill — server-side port.
 *
 * Generates a single-page deposit invoice PDF with PACK&GO navy/gold
 * brand palette. Sent to customers after booking confirmation so they
 * know how much to pay (deposit), when it's due, and how to pay (Stripe
 * checkout link). The QA audit 2026-05-11 Phase 9 found this was a
 * critical gap — customers booked but had no clear payment instructions,
 * so bookings sat unpaid indefinitely.
 *
 * Default terms (overridable):
 *   - Deposit: 30% of total
 *   - Due: 2 days after issue
 *   - Balance: 14 days before departure
 */

import { escapeHtml, fmtNum, LOGO_NAVY_B64 } from "./skillPdfService";

export type DepositInput = {
  // Identifiers
  bookingId: number | string;
  invoiceNumber?: string;  // defaults to DEP-{bookingId}-{YYMMDD}
  issueDate?: string;       // defaults to today (zh-TW format)
  // Customer
  customerName: string;
  customerEmail?: string;
  // Trip
  tripName: string;
  departureDate: string;   // free text, e.g. "2026 年 8 月 22 日"
  passengers?: string;     // optional, e.g. "4 大人"
  // Amounts (USD)
  totalUSD: number;
  depositUSD: number;
  twdRate?: number;        // default 32
  // Payment
  paymentLink?: string;    // Stripe Checkout URL — required for self-serve pay
  dueDate?: string;        // free text, e.g. "2026 年 5 月 14 日 (3 日內)"
  // Footer
  notes?: string[];        // any extra instructions
};

const DEFAULT_NOTES = [
  "訂金繳清後即視為訂位完成,行程開始進入正式作業",
  "尾款請於出發前 14 天結清",
  "若有任何問題,請直接回信給 Jeff:jeffhsieh09@gmail.com",
];

export function renderDepositHtml(input: DepositInput): string {
  const today = input.issueDate ?? new Date().toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const yymmdd = new Date()
    .toISOString()
    .slice(2, 10)
    .replace(/-/g, "");
  const invoiceNumber =
    input.invoiceNumber ?? `DEP-${input.bookingId}-${yymmdd}`;

  const twdRate = input.twdRate ?? 32;
  const totalTWD = Math.round(input.totalUSD * twdRate);
  const depositTWD = Math.round(input.depositUSD * twdRate);
  const balanceUSD = input.totalUSD - input.depositUSD;
  const balanceTWD = totalTWD - depositTWD;

  const notes = input.notes ?? DEFAULT_NOTES;

  const dueDate = input.dueDate
    ? escapeHtml(input.dueDate)
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() + 2);
        return d.toLocaleDateString("zh-TW", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }) + " (2 日內)";
      })();

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>訂金繳款通知 ${escapeHtml(String(invoiceNumber))}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
    color: #1a1a1a; background: #fff;
    font-size: 13px; line-height: 1.6;
  }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm; position: relative; }
  /* Header */
  .header {
    display: flex; align-items: flex-end; justify-content: space-between;
    padding-bottom: 14px; border-bottom: 2px solid #1a2a4a; margin-bottom: 24px;
  }
  .header .logo { height: 48px; }
  .header .meta { text-align: right; font-size: 11px; color: #555; }
  .header .meta strong { color: #1a2a4a; font-size: 13px; display: block; margin-bottom: 2px; }
  /* Title */
  h1 {
    margin: 0 0 6px 0; font-size: 22px; color: #1a2a4a; letter-spacing: 0.04em;
  }
  .subtitle { color: #888; font-size: 12px; margin-bottom: 22px; }
  /* Section labels */
  h2 {
    font-size: 12px; letter-spacing: 0.18em; color: #c9a563;
    text-transform: uppercase; margin: 24px 0 10px 0; font-weight: 700;
  }
  /* Info grid */
  .info-grid {
    display: grid; grid-template-columns: 100px 1fr; gap: 6px 14px;
    padding: 14px 16px; background: #f7f5ee; border-radius: 6px;
  }
  .info-grid dt { color: #777; font-size: 11px; padding-top: 2px; }
  .info-grid dd { margin: 0; color: #1a1a1a; font-size: 13px; }
  /* Pricing table */
  .price-table {
    width: 100%; border-collapse: collapse; margin-top: 8px;
    border: 1px solid #e2dccf;
  }
  .price-table tr { border-bottom: 1px solid #e2dccf; }
  .price-table tr:last-child { border-bottom: 0; }
  .price-table th, .price-table td {
    padding: 10px 14px; font-size: 13px; text-align: left;
  }
  .price-table th { background: #faf8f1; color: #5a4f30; font-weight: 600; width: 50%; }
  .price-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .price-table .due {
    background: #fdf6e0;
  }
  .price-table .due th, .price-table .due td {
    color: #1a2a4a; font-weight: 700; font-size: 15px;
  }
  /* Payment CTA */
  .pay-box {
    margin-top: 16px; padding: 18px 20px; background: #1a2a4a; color: #fff;
    border-radius: 8px; text-align: center;
  }
  .pay-box .pay-label { font-size: 11px; letter-spacing: 0.2em; color: #c9a563; text-transform: uppercase; }
  .pay-box .pay-amount { font-size: 28px; font-weight: 700; margin: 6px 0 10px 0; font-variant-numeric: tabular-nums; }
  .pay-box .pay-due { font-size: 12px; color: #d4d0c2; margin-bottom: 14px; }
  .pay-box .pay-link {
    display: inline-block; padding: 10px 28px; background: #c9a563; color: #1a2a4a;
    font-weight: 700; text-decoration: none; border-radius: 4px; font-size: 14px;
    letter-spacing: 0.04em;
  }
  /* Notes */
  ul.notes { padding-left: 18px; margin: 8px 0; color: #555; font-size: 12px; }
  ul.notes li { margin-bottom: 4px; }
  /* Footer */
  .footer {
    position: absolute; bottom: 14mm; left: 16mm; right: 16mm;
    padding-top: 10px; border-top: 1px solid #e2dccf;
    display: flex; justify-content: space-between; font-size: 10px; color: #888;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <img class="logo" src="data:image/png;base64,${LOGO_NAVY_B64}" alt="PACK&GO">
    <div class="meta">
      <strong>訂金繳款通知</strong>
      No. ${escapeHtml(String(invoiceNumber))}<br>
      ${escapeHtml(today)}
    </div>
  </div>

  <h1>${escapeHtml(input.tripName)}</h1>
  <p class="subtitle">親愛的 ${escapeHtml(input.customerName)},以下是您的訂金繳款資訊。</p>

  <h2>行程資訊</h2>
  <dl class="info-grid">
    <dt>訂單編號</dt><dd>#${escapeHtml(String(input.bookingId))}</dd>
    <dt>客戶姓名</dt><dd>${escapeHtml(input.customerName)}</dd>
    ${input.customerEmail ? `<dt>聯絡 Email</dt><dd>${escapeHtml(input.customerEmail)}</dd>` : ""}
    <dt>出發日期</dt><dd>${escapeHtml(input.departureDate)}</dd>
    ${input.passengers ? `<dt>人數</dt><dd>${escapeHtml(input.passengers)}</dd>` : ""}
  </dl>

  <h2>金額明細</h2>
  <table class="price-table">
    <tr>
      <th>行程總額</th>
      <td class="num">US$ ${fmtNum(input.totalUSD)}<br><span style="color:#888;font-size:11px;">約 NT$ ${fmtNum(totalTWD)}</span></td>
    </tr>
    <tr class="due">
      <th>本次應付訂金</th>
      <td class="num">US$ ${fmtNum(input.depositUSD)}<br><span style="font-weight:500;font-size:11px;">約 NT$ ${fmtNum(depositTWD)}</span></td>
    </tr>
    <tr>
      <th>剩餘尾款</th>
      <td class="num">US$ ${fmtNum(balanceUSD)}<br><span style="color:#888;font-size:11px;">約 NT$ ${fmtNum(balanceTWD)}(出發前 14 天結清)</span></td>
    </tr>
  </table>

  <div class="pay-box">
    <div class="pay-label">立即繳付訂金</div>
    <div class="pay-amount">US$ ${fmtNum(input.depositUSD)}</div>
    <div class="pay-due">繳款期限:${dueDate}</div>
    ${
      input.paymentLink
        ? `<a class="pay-link" href="${escapeHtml(input.paymentLink)}">點此前往 Stripe 安全付款 →</a>`
        : `<div style="color:#d4d0c2;font-size:11px;">付款連結將另以 Email 寄送</div>`
    }
  </div>

  <h2>注意事項</h2>
  <ul class="notes">
    ${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
  </ul>

  <div class="footer">
    <span>PACK&GO Travel · CST #2166984</span>
    <span>jeffhsieh09@gmail.com · +1 (510) 634-2307</span>
  </div>
</div>
</body>
</html>`;
}
