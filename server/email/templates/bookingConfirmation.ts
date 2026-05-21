// server/email/templates/bookingConfirmation.ts
//
// Booking confirmation email — sent when a new booking is created.
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.
//
// Public surface: sendBookingConfirmationEmail(data)
// Private: generateBookingConfirmationHTML(data) — inline HTML generator,
//           kept private to this file (no other template re-uses it).

import { notifyOwner } from "../../_core/notification";
import { redactEmail } from "../../_core/redact";
import { EMAIL_FROM, getTransporter } from "../_shared";
import type { BookingEmailData } from "./types";

/**
 * Send booking confirmation email to customer
 * Uses SMTP to send actual email to customer, with notifyOwner as backup notification
 */
export async function sendBookingConfirmationEmail(data: BookingEmailData) {
  // Always notify owner about new booking (owner reads ZH)
  const emailContent = `
訂單確認通知

客戶姓名：${data.customerName}
客戶信箱：${data.customerEmail}
訂單編號：${data.bookingId}

行程資訊：
- 行程名稱：${data.tourTitle}
- 出發日期：${data.departureDate}
- 回程日期：${data.returnDate}

旅客人數：
- 成人：${data.numberOfAdults} 位
- 兒童：${data.numberOfChildren} 位
- 嬰兒：${data.numberOfInfants} 位

費用資訊：
- 總金額：NT$ ${data.totalPrice.toLocaleString()}
- 訂金：NT$ ${data.depositAmount.toLocaleString()}
- 尾款：NT$ ${data.remainingAmount.toLocaleString()}
  `.trim();

  await notifyOwner({
    title: `新訂單 #${data.bookingId} - ${data.customerName}`,
    content: emailContent,
  });

  // v78x: Subject + template language follows the customer's preference.
  const isEN = data.language === 'en';
  const subject = isEN
    ? `Booking confirmed #${data.bookingId} - ${data.tourTitle}`
    : `訂單確認 #${data.bookingId} - ${data.tourTitle}`;

  // Try to send actual email to customer
  const smtp = getTransporter();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
        to: data.to,
        subject,
        html: generateBookingConfirmationHTML(data),
        text: emailContent,
      });
      console.log('[Email] Booking confirmation email sent to:', redactEmail(data.to), `(${data.language || 'zh-TW'})`);
    } catch (error) {
      console.error('[Email] Failed to send booking confirmation email:', error);
    }
  }

  return true;
}

/**
 * Generate branded HTML email template for booking confirmation (BUG-008)
 */
function generateBookingConfirmationHTML(data: BookingEmailData): string {
  const isEN = data.language === 'en';
  // v78x: All user-facing strings extracted into a single copy block + bilingual.
  // Owner notification text stays ZH (sees admin perspective in notifyOwner).
  const c = isEN ? {
    htmlLang: 'en',
    title: 'Booking confirmed - PACK&GO Travel',
    tagline: "LET'S TRAVEL TOGETHER",
    successHeading: 'Booking confirmed!',
    successSub: 'Thank you for choosing PACK&GO Travel',
    greeting: 'Dear',
    intro: 'Your booking has been successfully created. Our team will reach out within <strong>1–2 business days</strong> to confirm details — please watch your phone and email.',
    sectionOrder: 'Order details',
    labelId: 'Order #',
    labelTour: 'Tour',
    labelDeparture: 'Departure date',
    labelReturn: 'Return date',
    labelPax: 'Travelers',
    paxAdult: (n: number) => `${n} adult${n > 1 ? 's' : ''}`,
    paxChild: (n: number) => `${n} child${n > 1 ? 'ren' : ''}`,
    paxInfant: (n: number) => `${n} infant${n > 1 ? 's' : ''}`,
    paxJoin: ', ',
    sectionFee: 'Fee breakdown',
    feeDeposit: 'Deposit (due in 3 days)',
    feeRemaining: 'Balance (due 30 days before departure)',
    feeTotal: 'Total',
    nextSteps: 'What happens next',
    step1: 'Our team confirms your booking by phone or email within 1–2 business days',
    step2: 'Please pay the deposit within <strong>3 days</strong> to lock in your seat',
    step3: 'You\'ll receive a balance-payment reminder 30 days before departure',
    step4: 'Final itinerary + e-tickets sent 7 days before departure',
    footerName: 'PACK&GO Travel',
    footerContact: 'Tel: +1 (510) 634-2307 | Email: support@packgoplay.com',
    footerLicense: 'CST #2166984 (California Seller of Travel)',
    footerCopy: `© ${new Date().getFullYear()} PACK&GO Travel. All rights reserved.`,
  } : {
    htmlLang: 'zh-TW',
    title: '訂單確認 - PACK&GO 旅行社',
    tagline: "LET'S TRAVEL TOGETHER",
    successHeading: '訂單已確認！',
    successSub: '感謝您選擇 PACK&GO 旅行社',
    greeting: '親愛的',
    intro: '您的行程預訂已成功建立。我們的專員將在 <strong>1-2 個工作日內</strong>與您確認訂單詳情，請注意查收電話及電子郵件。',
    sectionOrder: '訂單詳情',
    labelId: '訂單編號',
    labelTour: '行程名稱',
    labelDeparture: '出發日期',
    labelReturn: '回程日期',
    labelPax: '旅客人數',
    paxAdult: (n: number) => `成人 ${n} 位`,
    paxChild: (n: number) => `兒童 ${n} 位`,
    paxInfant: (n: number) => `嬰兒 ${n} 位`,
    paxJoin: '、',
    sectionFee: '費用明細',
    feeDeposit: '訂金（須於 3 天內付清）',
    feeRemaining: '尾款（出發前 30 天付清）',
    feeTotal: '總金額',
    nextSteps: '接下來的步驟',
    step1: '我們的專員將在 1-2 個工作日內以電話或電郵確認訂單',
    step2: '請於 <strong>3 天內</strong>完成訂金付款，以保留您的座位',
    step3: '出發前 30 天將收到尾款付款提醒',
    step4: '出發前 7 天將收到完整行程資料及電子機票',
    footerName: 'PACK&GO 旅行社',
    footerContact: 'Tel: +1 (510) 634-2307 | Email: support@packgoplay.com',
    footerLicense: 'CST #2166984（加州合法旅行社）',
    footerCopy: `© ${new Date().getFullYear()} PACK&GO 旅行社. All rights reserved.`,
  };
  const paxParts = [
    data.numberOfAdults > 0 ? c.paxAdult(data.numberOfAdults) : '',
    data.numberOfChildren > 0 ? c.paxChild(data.numberOfChildren) : '',
    data.numberOfInfants > 0 ? c.paxInfant(data.numberOfInfants) : '',
  ].filter(Boolean).join(c.paxJoin);

  return `
<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${c.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a1a 0%,#3a3a3a 100%);padding:36px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:32px;font-weight:900;letter-spacing:4px;">PACK&amp;GO</h1>
            <p style="color:#cccccc;margin:6px 0 0 0;font-size:13px;letter-spacing:2px;">${c.tagline}</p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f0fdf4;padding:24px 40px;text-align:center;border-bottom:1px solid #dcfce7;">
            <div style="display:inline-block;width:52px;height:52px;background:#22c55e;border-radius:50%;line-height:52px;text-align:center;margin-bottom:12px;">
              <span style="color:#fff;font-size:26px;line-height:52px;">&#10003;</span>
            </div>
            <h2 style="color:#15803d;margin:0;font-size:22px;font-weight:700;">${c.successHeading}</h2>
            <p style="color:#166534;margin:6px 0 0 0;font-size:14px;">${c.successSub}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 0 40px;">
            <p style="color:#333;font-size:16px;margin:0 0 8px 0;">${c.greeting} <strong>${data.customerName}</strong>${isEN ? ',' : '，您好！'}</p>
            <p style="color:#666;font-size:15px;line-height:1.7;margin:0;">${c.intro}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;overflow:hidden;border:1px solid #e9ecef;">
              <tr><td style="background:#1a1a1a;padding:14px 20px;"><p style="color:#fff;margin:0;font-size:13px;font-weight:700;letter-spacing:1px;">${c.sectionOrder}</p></td></tr>
              <tr><td style="padding:20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:8px 0;border-bottom:1px solid #e9ecef;"><span style="color:#888;font-size:13px;">${c.labelId}</span><span style="color:#333;font-size:13px;font-weight:700;float:right;">#${data.bookingId}</span></td></tr>
                  <tr><td style="padding:8px 0;border-bottom:1px solid #e9ecef;"><span style="color:#888;font-size:13px;">${c.labelTour}</span><span style="color:#333;font-size:13px;font-weight:600;float:right;max-width:320px;text-align:right;display:block;">${data.tourTitle}</span></td></tr>
                  <tr><td style="padding:8px 0;border-bottom:1px solid #e9ecef;"><span style="color:#888;font-size:13px;">${c.labelDeparture}</span><span style="color:#333;font-size:13px;font-weight:600;float:right;">${data.departureDate}</span></td></tr>
                  <tr><td style="padding:8px 0;border-bottom:1px solid #e9ecef;"><span style="color:#888;font-size:13px;">${c.labelReturn}</span><span style="color:#333;font-size:13px;font-weight:600;float:right;">${data.returnDate}</span></td></tr>
                  <tr><td style="padding:8px 0;"><span style="color:#888;font-size:13px;">${c.labelPax}</span><span style="color:#333;font-size:13px;font-weight:600;float:right;">${paxParts}</span></td></tr>
                </table>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff9f0;border-radius:10px;overflow:hidden;border:1px solid #fed7aa;">
              <tr><td style="background:#ea580c;padding:14px 20px;"><p style="color:#fff;margin:0;font-size:13px;font-weight:700;letter-spacing:1px;">${c.sectionFee}</p></td></tr>
              <tr><td style="padding:20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:8px 0;border-bottom:1px solid #fed7aa;"><span style="color:#9a3412;font-size:13px;">${c.feeDeposit}</span><span style="color:#9a3412;font-size:15px;font-weight:700;float:right;">NT$ ${data.depositAmount.toLocaleString()}</span></td></tr>
                  <tr><td style="padding:8px 0;border-bottom:1px solid #fed7aa;"><span style="color:#888;font-size:13px;">${c.feeRemaining}</span><span style="color:#666;font-size:13px;font-weight:600;float:right;">NT$ ${data.remainingAmount.toLocaleString()}</span></td></tr>
                  <tr><td style="padding:12px 0 0 0;"><span style="color:#333;font-size:15px;font-weight:700;">${c.feeTotal}</span><span style="color:#ea580c;font-size:20px;font-weight:900;float:right;">NT$ ${data.totalPrice.toLocaleString()}</span></td></tr>
                </table>
              </td></tr>
            </table>
          </td>
        </tr>
        ${data.depositInvoiceUrl ? `
        <tr>
          <td style="padding:0 40px 24px 40px;">
            <div style="background:#1a2a4a;padding:22px 24px;border-radius:8px;text-align:center;">
              <p style="color:#c9a563;font-size:11px;letter-spacing:0.2em;margin:0 0 6px 0;text-transform:uppercase;font-weight:700;">${data.language === 'en' ? 'Deposit Invoice' : '訂金繳款通知'}</p>
              <p style="color:#fff;font-size:13px;margin:0 0 14px 0;line-height:1.5;">${data.language === 'en' ? 'A formal PDF invoice with payment instructions has been generated for this booking.' : '我們已為您備好完整訂金繳款通知 PDF,包含金額明細與付款資訊。'}</p>
              <a href="${data.depositInvoiceUrl}" style="display:inline-block;padding:12px 28px;background:#c9a563;color:#1a2a4a;font-weight:700;text-decoration:none;border-radius:4px;font-size:14px;letter-spacing:0.04em;">${data.language === 'en' ? 'Download deposit invoice (PDF) →' : '下載訂金通知 PDF →'}</a>
            </div>
          </td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding:0 40px 32px 40px;">
            <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:16px 20px;border-radius:0 8px 8px 0;">
              <p style="color:#1e40af;font-size:14px;font-weight:700;margin:0 0 8px 0;">${c.nextSteps}</p>
              <ol style="color:#1e40af;font-size:13px;line-height:1.8;margin:0;padding-left:18px;">
                <li>${c.step1}</li>
                <li>${c.step2}</li>
                <li>${c.step3}</li>
                <li>${c.step4}</li>
              </ol>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center;">
            <p style="color:#ffffff;margin:0 0 4px 0;font-size:15px;font-weight:700;">${c.footerName}</p>
            <p style="color:#999;margin:0 0 4px 0;font-size:12px;">${c.footerContact}</p>
            <p style="color:#999;margin:0 0 12px 0;font-size:11px;">${c.footerLicense}</p>
            <p style="color:#666;margin:0;font-size:11px;">${c.footerCopy}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim();
}
