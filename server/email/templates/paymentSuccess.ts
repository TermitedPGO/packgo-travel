// server/email/templates/paymentSuccess.ts
//
// Payment success email — sent after Stripe confirms a deposit / balance /
// full payment for a booking. Extracted verbatim from server/email.ts in
// v2 Wave 2 Module 2.11.

import { notifyOwner } from "../../_core/notification";
import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailInfoTable,
} from "../../services/emailTemplateService";
import { EMAIL_FROM, getTransporter } from "../_shared";
import type { PaymentSuccessEmailData } from "./types";

/**
 * Send payment success email to customer
 */
export async function sendPaymentSuccessEmail(data: PaymentSuccessEmailData) {
  const isEN = data.language === 'en';
  const paymentTypeText = isEN
    ? ({ deposit: 'Deposit', balance: 'Balance', full: 'Full payment' }[data.paymentType])
    : ({ deposit: '訂金', balance: '尾款', full: '全額' }[data.paymentType]);

  // Owner notification stays in ZH (admin reads ZH).
  const ownerEmailContent = `
付款成功通知

客戶姓名：${data.customerName}
客戶信箱：${data.customerEmail}
訂單編號：${data.bookingId}
行程名稱：${data.tourTitle}

付款資訊：
- 付款類型：${ isEN ? ({ deposit: '訂金', balance: '尾款', full: '全額' }[data.paymentType]) : paymentTypeText }
- 付款金額：NT$ ${data.paymentAmount.toLocaleString()}

感謝您的付款，我們將盡快為您安排行程。
  `.trim();

  // Customer-facing plain-text fallback follows the customer's language.
  const customerEmailContent = isEN
    ? `Payment confirmed

Dear ${data.customerName},

Order #: ${data.bookingId}
Tour: ${data.tourTitle}

Payment type: ${paymentTypeText}
Amount: NT$ ${data.paymentAmount.toLocaleString()}

Thank you. Our team will continue arranging your trip and will email the final itinerary once supplier confirms.`
    : ownerEmailContent;

  await notifyOwner({
    title: `付款成功 #${data.bookingId} - ${data.customerName}`,
    content: ownerEmailContent,
  });

  // Try to send actual email to customer
  const smtp = getTransporter();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
        to: data.customerEmail,
        subject: isEN
          ? `Payment confirmed #${data.bookingId} - ${data.tourTitle}`
          : `付款成功 #${data.bookingId} - ${data.tourTitle}`,
        html: generatePaymentSuccessHTML(data, paymentTypeText),
        text: customerEmailContent,
      });
      console.log('[Email] Payment success email sent to:', redactEmail(data.customerEmail), `(${data.language || 'zh-TW'})`);
    } catch (error) {
      console.error('[Email] Failed to send payment success email:', error);
    }
  }

  return true;
}

/**
 * Generate HTML email template for payment success
 */
function generatePaymentSuccessHTML(data: PaymentSuccessEmailData, paymentTypeText: string): string {
  const isEN = data.language === 'en';
  const c = isEN ? {
    title: 'Payment confirmed',
    heading: 'Payment confirmed!',
    greeting: 'Dear',
    intro: 'Your payment has been processed. Below are the details:',
    labelOrder: 'Order #',
    labelTour: 'Tour',
    labelType: 'Payment type',
    labelAmount: 'Amount',
    thanksLine: 'Thank you. Our team will continue arranging your trip and will email the final itinerary once the supplier confirms.',
    contactLine: 'Questions? Reply to this email or call +1 (510) 634-2307.',
  } : {
    title: '付款成功',
    heading: '付款成功！',
    greeting: '親愛的',
    intro: '您的付款已成功處理，以下是您的付款詳情：',
    labelOrder: '訂單編號',
    labelTour: '行程名稱',
    labelType: '付款類型',
    labelAmount: '付款金額',
    thanksLine: '感謝您的付款，我們的專員將盡快與您聯繫，確認行程詳情。',
    contactLine: '如有任何問題，請隨時與我們聯繫。',
  };
  const bodyHtml = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:56px;height:56px;background:#22c55e;border-radius:50%;line-height:56px;text-align:center;margin-bottom:12px;">
        <span style="color:#fff;font-size:28px;line-height:56px;">&#10003;</span>
      </div>
      <p style="font-family:Arial,sans-serif;font-size:22px;font-weight:bold;color:#15803d;margin:0;">${c.heading}</p>
    </div>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;margin:0 0 16px 0;">${c.greeting} <strong>${data.customerName}</strong>${isEN ? ',' : '，'}</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 16px 0;">${c.intro}</p>
    ${emailInfoTable([
      { label: c.labelOrder, value: '#' + data.bookingId },
      { label: c.labelTour, value: data.tourTitle },
      { label: c.labelType, value: paymentTypeText },
      { label: c.labelAmount, value: 'NT$ ' + data.paymentAmount.toLocaleString() },
    ])}
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 8px 0;">${c.thanksLine}</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;margin:0;">${c.contactLine}</p>
  `;
  return wrapInBrandTemplate({ title: c.title, bodyHtml });
}
