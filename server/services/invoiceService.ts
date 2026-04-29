/**
 * Invoice Service
 * Handles invoice number generation, PDF creation (HTML-based via S3 upload),
 * and invoice lifecycle management for PACK&GO Travel Agency.
 */

import { storagePut } from "../storage";
import { getNextInvoiceSequence } from "../db";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  issueDate: Date;
  dueDate?: Date;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  notes?: string;
  status: string;
}

/**
 * Generate a unique invoice number in format: INV-YYYY-NNNN
 */
export async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const seq = await getNextInvoiceSequence(year);
  return `INV-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Generate an HTML invoice. Returns BOTH the raw HTML (always) and an R2 URL
 * if the upload succeeded.
 *
 * v78g: caller persists `html` to `invoices.pdfHtml` and uses `r2Url` if
 * present, otherwise falls back to `/api/invoices/:id/view`. R2 is best-effort
 * — production R2 bucket missing means we always serve via the view route.
 */
export async function generateInvoicePdf(
  data: InvoiceData
): Promise<{ html: string; r2Url: string | null }> {
  const html = buildInvoiceHtml(data);

  let r2Url: string | null = null;
  try {
    const key = `invoices/${data.invoiceNumber}-${Date.now()}.html`;
    const { url } = await storagePut(key, Buffer.from(html, "utf-8"), "text/html");
    r2Url = url;
  } catch (err: any) {
    console.warn(
      `[invoiceService] R2 upload skipped (${err?.name || "error"}: ${err?.message?.slice(0, 80) || ""}). Invoice will be served via /api/invoices/:id/view.`
    );
  }

  return { html, r2Url };
}

function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = { USD: "$", TWD: "NT$", EUR: "€", GBP: "£" };
  const sym = symbols[currency] ?? currency + " ";
  return `${sym}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function buildInvoiceHtml(data: InvoiceData): string {
  const lineItemRows = data.lineItems
    .map(
      (item) => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;">${item.description}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(item.unitPrice, data.currency)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${formatCurrency(item.amount, data.currency)}</td>
    </tr>`
    )
    .join("");

  const statusBadge: Record<string, string> = {
    draft: "#6b7280",
    sent: "#2563eb",
    paid: "#16a34a",
    overdue: "#dc2626",
    cancelled: "#9ca3af",
  };
  const statusLabel: Record<string, string> = {
    draft: "草稿",
    sent: "已寄送",
    paid: "已付款",
    overdue: "逾期",
    cancelled: "已取消",
  };

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>發票 ${data.invoiceNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 3px solid #1a1a1a; }
    .company-name { font-size: 28px; font-weight: 900; letter-spacing: 2px; color: #1a1a1a; }
    .company-sub { font-size: 12px; color: #666; margin-top: 4px; }
    .invoice-title { text-align: right; }
    .invoice-title h1 { font-size: 36px; font-weight: 300; letter-spacing: 4px; color: #1a1a1a; text-transform: uppercase; }
    .invoice-number { font-size: 14px; color: #666; margin-top: 4px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; color: #fff; margin-top: 8px; background: ${statusBadge[data.status] ?? "#6b7280"}; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 32px; }
    .meta-block h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 8px; }
    .meta-block p { font-size: 14px; color: #1a1a1a; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { background: #1a1a1a; color: #fff; }
    thead th { padding: 12px 8px; text-align: left; font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
    thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
    tbody tr:nth-child(even) { background: #f9f9f9; }
    .totals { width: 280px; margin-left: auto; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; border-bottom: 1px solid #eee; }
    .totals-row.total { font-size: 18px; font-weight: 700; border-bottom: none; padding-top: 12px; }
    .notes { margin-top: 32px; padding: 16px; background: #f5f5f5; border-left: 4px solid #1a1a1a; }
    .notes h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 8px; }
    .notes p { font-size: 13px; color: #444; line-height: 1.6; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #eee; text-align: center; font-size: 11px; color: #999; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company-name">PACK&amp;GO</div>
      <div class="company-sub">旅行社 Travel Agency</div>
    </div>
    <div class="invoice-title">
      <h1>Invoice</h1>
      <div class="invoice-number">${data.invoiceNumber}</div>
      <div><span class="status-badge">${statusLabel[data.status] ?? data.status}</span></div>
    </div>
  </div>

  <div class="meta">
    <div class="meta-block">
      <h3>客戶資訊</h3>
      <p><strong>${data.customerName}</strong></p>
      ${data.customerEmail ? `<p>${data.customerEmail}</p>` : ""}
      ${data.customerPhone ? `<p>${data.customerPhone}</p>` : ""}
      ${data.customerAddress ? `<p>${data.customerAddress}</p>` : ""}
    </div>
    <div class="meta-block" style="text-align:right;">
      <h3>發票資訊</h3>
      <p>開立日期：${formatDate(data.issueDate)}</p>
      ${data.dueDate ? `<p>付款期限：${formatDate(data.dueDate)}</p>` : ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>說明</th>
        <th style="text-align:center;">數量</th>
        <th style="text-align:right;">單價</th>
        <th style="text-align:right;">小計</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>小計</span>
      <span>${formatCurrency(data.subtotal, data.currency)}</span>
    </div>
    ${
      data.taxRate > 0
        ? `<div class="totals-row">
      <span>稅率 (${data.taxRate}%)</span>
      <span>${formatCurrency(data.taxAmount, data.currency)}</span>
    </div>`
        : ""
    }
    <div class="totals-row total">
      <span>總計</span>
      <span>${formatCurrency(data.totalAmount, data.currency)}</span>
    </div>
  </div>

  ${
    data.notes
      ? `<div class="notes">
    <h3>備註</h3>
    <p>${data.notes}</p>
  </div>`
      : ""
  }

  <div class="footer">
    <p>PACK&amp;GO 旅行社 &nbsp;|&nbsp; 感謝您的惠顧</p>
    <p>如有任何問題，請聯絡我們的客服團隊</p>
  </div>
</body>
</html>`;
}
