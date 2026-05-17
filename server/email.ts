import { notifyOwner } from "./_core/notification";
import { redactEmail } from "./_core/redact";
import nodemailer, { type Transporter } from 'nodemailer';
import { wrapInBrandTemplate, emailInfoTable, emailButton, emailHighlightBox } from "./services/emailTemplateService";

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587');
const EMAIL_SECURE = process.env.EMAIL_SECURE === 'true';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER || 'noreply@packgo.com';
const BASE_URL = process.env.BASE_URL || 'https://packgo-travel.fly.dev';

let transporter: Transporter | null = null;

/**
 * Initialize SMTP transporter
 */
function getTransporter(): Transporter | null {
  if (!transporter && EMAIL_USER && EMAIL_PASSWORD) {
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_SECURE,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASSWORD,
      },
    });
  }
  return transporter;
}

/**
 * Email templates and sending logic
 */

interface BookingEmailData {
  to: string; // Customer email address
  customerName: string;
  customerEmail: string;
  bookingId: number;
  tourTitle: string;
  departureDate: string;
  returnDate: string;
  numberOfAdults: number;
  numberOfChildren: number;
  numberOfInfants: number;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
  /** v78x: Optional customer language preference. Defaults to 'zh-TW' for backward compat. */
  language?: 'zh-TW' | 'en';
  /** QA audit Phase 9: pre-generated deposit invoice PDF URL. When present
   *  the email renders a prominent "下載訂金通知 / 立即付款" CTA so the
   *  customer never has to ask "how do I pay?". */
  depositInvoiceUrl?: string;
}

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

interface PaymentSuccessEmailData {
  customerName: string;
  customerEmail: string;
  bookingId: number;
  tourTitle: string;
  paymentAmount: number;
  paymentType: "deposit" | "balance" | "full";
  /** v78y: customer language preference; defaults to zh-TW */
  language?: 'zh-TW' | 'en';
}

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

// ============================================================================
// v77: Trip Reminder Email — sent at 30/14/7/3/1 days before departure.
// Each window has slightly different copy aimed at the customer's current
// concern (planning vs paperwork vs final logistics).
// ============================================================================

export interface TripReminderEmailData {
  to: string;
  customerName: string;
  bookingId: number;
  tourTitle: string;
  departureDate: Date;
  returnDate: Date | null;
  daysOut: 30 | 14 | 7 | 3 | 1;
  balanceDue: number;
  balanceCurrency: string;
  balanceUnpaid: boolean;
  /** v78y: bilingual reminder copy */
  language?: 'zh-TW' | 'en';
}

const REMINDER_COPY: Record<30 | 14 | 7 | 3 | 1, { zh: { subject: string; body: string }; en: { subject: string; body: string } }> = {
  30: {
    zh: {
      subject: '出發倒數 30 天｜開始準備您的旅程',
      body: '距離您的行程出發還有 30 天。建議您此時開始確認護照效期、辦理簽證（如需要）、預訂出發地交通。如果您尚未繳清尾款，本月底前請完成。',
    },
    en: {
      subject: '30 days to departure | Start preparing for your trip',
      body: "Your trip departs in 30 days. Now is a good time to verify your passport validity, apply for visas (if required), and book transportation from your home city to the airport. If your balance is unpaid, please settle it by month-end.",
    },
  },
  14: {
    zh: {
      subject: '出發倒數 14 天｜文件與行李檢查',
      body: '距離出發還有 14 天。請再次檢查護照（建議至少有 6 個月效期）、簽證、旅平險。我們建議您確認航班資訊與機場接送，並開始整理行李清單。',
    },
    en: {
      subject: '14 days to departure | Documents & packing checklist',
      body: 'Departure is 14 days away. Recheck your passport (at least 6 months validity recommended), visa, and travel insurance. Confirm flight details + airport transfer, and start your packing list.',
    },
  },
  7: {
    zh: {
      subject: '出發倒數 7 天｜尾款提醒與最終確認',
      body: '一週後您將踏上旅程！請務必在此時：(1) 完成尾款支付（若仍有未付款項），(2) 與旅伴核對最終旅客資料，(3) 確認出發機場、報到時間。',
    },
    en: {
      subject: '7 days to departure | Balance + final confirmation',
      body: "One week to go! Please make sure to: (1) settle the balance payment if still outstanding, (2) double-check traveler info with your companions, (3) confirm the departure airport and check-in time.",
    },
  },
  3: {
    zh: {
      subject: '出發倒數 3 天｜行程與緊急聯絡',
      body: '3 天後出發！請列印或下載最終行程表、保留我們的緊急聯絡電話 +1 (510) 634-2307。確保手機漫遊或當地 SIM 卡準備就緒。',
    },
    en: {
      subject: '3 days to departure | Itinerary & emergency contacts',
      body: 'Departure in 3 days! Print or download your final itinerary, save our emergency line +1 (510) 634-2307. Make sure international roaming or a local SIM is ready.',
    },
  },
  1: {
    zh: {
      subject: '明日出發｜祝您旅途愉快',
      body: '您的旅程即將開始！再次提醒：提早至少 3 小時抵達國際線機場、攜帶護照與簽證、行動電源充飽。如遇任何問題，隨時聯絡我們：+1 (510) 634-2307。',
    },
    en: {
      subject: 'Departing tomorrow | Have a great trip',
      body: 'Your journey starts tomorrow! Reminder: arrive at the international terminal at least 3 hours before flight, carry passport + visa, charge your power bank. Any issues, reach us at +1 (510) 634-2307.',
    },
  },
};

export async function sendTripReminderEmail(data: TripReminderEmailData) {
  const isEN = data.language === 'en';
  const copy = REMINDER_COPY[data.daysOut][isEN ? 'en' : 'zh'];
  const dateStr = data.departureDate.toLocaleDateString(isEN ? 'en-US' : 'zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  const balanceLine = data.balanceUnpaid && data.balanceDue > 0
    ? (isEN
        ? `\nOutstanding balance: ${data.balanceCurrency} ${data.balanceDue.toLocaleString()}\nPay at: ${BASE_URL}/booking/${data.bookingId}`
        : `\n尚未繳清的尾款：${data.balanceCurrency} ${data.balanceDue.toLocaleString()}\n請至訂單頁完成付款：${BASE_URL}/booking/${data.bookingId}`)
    : '';

  const emailText = isEN
    ? `${copy.subject}

Dear ${data.customerName},

${copy.body}

Order #: ${data.bookingId}
Tour: ${data.tourTitle}
Departure: ${dateStr}${balanceLine}

Questions? Contact us anytime:
PACK&GO Travel (CST #2166984)
Phone: +1 (510) 634-2307
Email: support@packgoplay.com

Have a wonderful trip!`
    : `${copy.subject}

親愛的 ${data.customerName}，

${copy.body}

訂單編號：#${data.bookingId}
行程：${data.tourTitle}
出發日期：${dateStr}${balanceLine}

如有任何問題，請隨時與我們聯絡：
PACK & GO 旅行社（CST #2166984）
電話：+1 (510) 634-2307
信箱：support@packgoplay.com

祝您旅途愉快！`;

  // Notify owner (Slack/email fallback) so ops sees activity (always ZH for owner)
  const ownerCopy = REMINDER_COPY[data.daysOut].zh;
  await notifyOwner({
    title: `行程提醒 (${data.daysOut}d) #${data.bookingId} — ${data.customerName}`,
    content: `${ownerCopy.subject}\n\n${ownerCopy.body}\n\n訂單 #${data.bookingId} — ${data.tourTitle}`,
  }).catch(() => {});

  const smtp = getTransporter();
  if (!smtp) return false;

  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.to,
      subject: `${copy.subject} — ${data.tourTitle}`,
      html: generateTripReminderHTML(data, copy),
      text: emailText.trim(),
    });
    console.log(`[Email] Trip reminder (${data.daysOut}d, ${data.language || 'zh-TW'}) sent to ${redactEmail(data.to)} for booking ${data.bookingId}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send trip reminder:', error);
    return false;
  }
}

function generateTripReminderHTML(
  data: TripReminderEmailData,
  copy: { subject: string; body: string }
): string {
  const isEN = data.language === 'en';
  const labels = isEN
    ? { greet: 'Dear', orderNo: 'Order #', tour: 'Tour', dep: 'Departure',
        balLabel: 'Outstanding balance', balCta: 'Pay now',
        contactLine: 'Questions? Call +1 (510) 634-2307 or reply to this email.' }
    : { greet: '親愛的', orderNo: '訂單編號', tour: '行程名稱', dep: '出發日期',
        balLabel: '未繳清尾款', balCta: '立即付款',
        contactLine: '如有任何問題，請聯絡 +1 (510) 634-2307 或回覆此 email。' };

  const dateStr = data.departureDate.toLocaleDateString(isEN ? 'en-US' : 'zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const balanceBlock = data.balanceUnpaid && data.balanceDue > 0
    ? `<div style="margin:16px 0;padding:14px 16px;border-left:4px solid #f59e0b;background:#fffbeb;border-radius:6px;">
         <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#92400e;">${labels.balLabel}</p>
         <p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:14px;color:#78350f;">${isEN ? 'Amount' : '金額'}: ${data.balanceCurrency} ${data.balanceDue.toLocaleString()}</p>
         <a href="${BASE_URL}/booking/${data.bookingId}" style="display:inline-block;padding:8px 16px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">${labels.balCta}</a>
       </div>`
    : '';
  const bodyHtml = `
    <p style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#111;margin:0 0 12px 0;">${copy.subject}</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;margin:0 0 16px 0;">${labels.greet} <strong>${data.customerName}</strong>${isEN ? ',' : '，'}</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 16px 0;">${copy.body}</p>
    ${emailInfoTable([
      { label: labels.orderNo, value: '#' + data.bookingId },
      { label: labels.tour, value: data.tourTitle },
      { label: labels.dep, value: dateStr },
    ])}
    ${balanceBlock}
    <p style="font-family:Arial,sans-serif;font-size:13px;color:#666;margin:16px 0 0 0;">${labels.contactLine}</p>
  `;
  return wrapInBrandTemplate({ title: copy.subject, bodyHtml });
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

// ─── v78l Sprint 4A: Supplier auto-notification ──────────────────────────

export interface SupplierNotificationData {
  supplierEmail: string;
  supplierName?: string;
  supplierNotes?: string;
  /** Supplier may prefer English or Mandarin — default zh-TW */
  language?: "zh-TW" | "en";
  // Booking context
  bookingId: number;
  bookingReference?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail: string;
  tourTitle: string;
  departureDate: string;
  returnDate?: string;
  numberOfAdults: number;
  numberOfChildren?: number;
  numberOfInfants?: number;
  specialRequests?: string;
  agentEmail?: string;
}

/**
 * Email the supplier (hotel/operator) when a booking is paid.
 * CC's Jeff so he sees what went out.
 */
export async function sendSupplierNotificationEmail(data: SupplierNotificationData) {
  const isEN = data.language === "en";
  const subject = isEN
    ? `[PACK&GO] New booking #${data.bookingId} — ${data.tourTitle}`
    : `【PACK&GO】新訂單 #${data.bookingId} — ${data.tourTitle}`;

  const text = isEN
    ? `Hello ${data.supplierName || "Supplier"},

PACK&GO Travel has confirmed a new paid booking. Please confirm availability and reply with vendor confirmation.

Booking ID: #${data.bookingId}${data.bookingReference ? ` (Ref: ${data.bookingReference})` : ""}
Tour: ${data.tourTitle}
Departure: ${data.departureDate}${data.returnDate ? ` → ${data.returnDate}` : ""}

Travelers:
  • Adults: ${data.numberOfAdults}
  • Children: ${data.numberOfChildren ?? 0}
  • Infants: ${data.numberOfInfants ?? 0}

Customer:
  • Name: ${data.customerName}
  • Phone: ${data.customerPhone || "—"}
  • Email: ${data.customerEmail}

${data.specialRequests ? `Special requests: ${data.specialRequests}\n\n` : ""}${data.supplierNotes ? `Internal notes: ${data.supplierNotes}\n\n` : ""}Please reply to this email to confirm. Thank you.

—
PACK&GO Travel — CST #2166984
${BASE_URL}`
    : `${data.supplierName || "供應商"} 您好：

PACK&GO 旅行社已收到新訂單，請確認接團安排並回覆。

訂單編號：#${data.bookingId}${data.bookingReference ? `（參考：${data.bookingReference}）` : ""}
行程：${data.tourTitle}
出發：${data.departureDate}${data.returnDate ? ` → ${data.returnDate}` : ""}

旅客人數：
  • 成人：${data.numberOfAdults}
  • 兒童：${data.numberOfChildren ?? 0}
  • 嬰兒：${data.numberOfInfants ?? 0}

客戶聯絡：
  • 姓名：${data.customerName}
  • 電話：${data.customerPhone || "—"}
  • Email：${data.customerEmail}

${data.specialRequests ? `特殊需求：${data.specialRequests}\n\n` : ""}${data.supplierNotes ? `內部備註：${data.supplierNotes}\n\n` : ""}請回覆此 email 確認接團安排，謝謝。

—
PACK&GO 旅行社 — CST #2166984
${BASE_URL}`;

  const bodyHtml = `
    <h2 style="color:#0d9488; margin-bottom: 16px;">${subject}</h2>
    <p>${isEN ? `Hello <strong>${data.supplierName || "Supplier"}</strong>,` : `${data.supplierName || "供應商"} 您好：`}</p>
    <p>${isEN ? "PACK&GO Travel has confirmed a new paid booking. Please confirm availability and reply." : "PACK&GO 旅行社已收到新訂單，請確認接團安排並回覆。"}</p>
    ${emailInfoTable([
      { label: isEN ? "Booking ID" : "訂單編號", value: `#${data.bookingId}` },
      { label: isEN ? "Tour" : "行程", value: data.tourTitle },
      { label: isEN ? "Departure" : "出發日", value: data.departureDate },
      ...(data.returnDate ? [{ label: isEN ? "Return" : "回程日", value: data.returnDate }] : []),
      { label: isEN ? "Adults" : "成人", value: String(data.numberOfAdults) },
      ...(data.numberOfChildren ? [{ label: isEN ? "Children" : "兒童", value: String(data.numberOfChildren) }] : []),
      ...(data.numberOfInfants ? [{ label: isEN ? "Infants" : "嬰兒", value: String(data.numberOfInfants) }] : []),
      { label: isEN ? "Customer" : "客戶", value: data.customerName },
      ...(data.customerPhone ? [{ label: isEN ? "Phone" : "電話", value: data.customerPhone }] : []),
      { label: isEN ? "Email" : "Email", value: data.customerEmail },
    ])}
    ${data.specialRequests ? emailHighlightBox(`<strong>${isEN ? "Special requests" : "特殊需求"}:</strong> ${data.specialRequests}`) : ""}
    ${data.supplierNotes ? `<p style="font-size:13px; color:#666;"><em>${isEN ? "Internal notes" : "內部備註"}：${data.supplierNotes}</em></p>` : ""}
    <p style="margin-top:24px;">${isEN ? "Please reply to confirm. Thank you." : "請回覆此 email 確認接團安排，謝謝。"}</p>
  `;
  const html = wrapInBrandTemplate({ title: subject, bodyHtml });

  const smtp = getTransporter();
  if (!smtp) {
    console.warn("[Email] SMTP not configured — supplier notification skipped for booking", data.bookingId);
    return false;
  }
  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.supplierEmail,
      cc: data.agentEmail || EMAIL_FROM, // CC Jeff so he has a paper trail
      subject,
      text,
      html,
    });
    console.log(`[Email] Supplier notification sent to ${redactEmail(data.supplierEmail)} for booking #${data.bookingId}`);
    return true;
  } catch (err) {
    console.error("[Email] Supplier notification failed:", err);
    return false;
  }
}

// ─── v78l Sprint 4B: AI quote follow-up sequence ─────────────────────────

export interface QuoteFollowUpData {
  customerEmail: string;
  customerName?: string;
  quoteNumber: string;
  pdfUrl?: string | null;
  /** Day mark — affects copy tone */
  stage: "24h" | "3d" | "7d";
  language?: "zh-TW" | "en";
  /** Brief recap of the trip (destination, days, party) so customer remembers */
  tripRecap?: string;
}

export async function sendQuoteFollowUpEmail(data: QuoteFollowUpData) {
  const isEN = data.language === "en";
  const stageCopy = {
    "24h": {
      subjectZh: `您的行程建議書 ${data.quoteNumber} — 有任何問題嗎？`,
      subjectEn: `Your itinerary ${data.quoteNumber} — any questions?`,
      bodyZh: `您好${data.customerName ? `，${data.customerName}` : ""}：\n\n感謝您昨天向 PACK&GO 諮詢。我們的 AI 顧問已為您整理一份行程建議。\n\n如有任何疑問，或想調整內容，歡迎隨時回覆此 email 或撥打 +1 (510) 634-2307。\n\n附帶提醒：最終報價我們會在 1 週內與供應商確認後另行通知。`,
      bodyEn: `Hello${data.customerName ? `, ${data.customerName}` : ""},\n\nThanks for reaching out to PACK&GO yesterday. Our AI advisor has put together an itinerary for you.\n\nQuestions or want changes? Reply or call +1 (510) 634-2307.\n\nAs a reminder: final pricing follows within 1 week after we confirm with suppliers.`,
    },
    "3d": {
      subjectZh: `${data.quoteNumber} — 出發位子有限，要保留嗎？`,
      subjectEn: `${data.quoteNumber} — Limited seats, want to lock yours?`,
      bodyZh: `您好${data.customerName ? `，${data.customerName}` : ""}：\n\n您 3 天前看的行程建議${data.quoteNumber}，目前出發日仍有空位。\n\n旅遊團通常離出發越近、空位越緊張。如果這趟旅程符合您的期待，建議您回覆此 email 或致電 +1 (510) 634-2307 讓我們先為您鎖位（鎖位不收訂金，只是預留位子方便我們和供應商確認）。`,
      bodyEn: `Hello${data.customerName ? `, ${data.customerName}` : ""},\n\nYour itinerary ${data.quoteNumber} from 3 days ago — seats are still available.\n\nGroup tours fill up fast as departure approaches. If this trip looks right, reply or call +1 (510) 634-2307 to hold seats (no deposit needed yet — just a hold so we can confirm with suppliers).`,
    },
    "7d": {
      subjectZh: `${data.quoteNumber} — 最後機會，是否需要協助？`,
      subjectEn: `${data.quoteNumber} — Last chance — anything we can help with?`,
      bodyZh: `您好${data.customerName ? `，${data.customerName}` : ""}：\n\n一個禮拜前您曾向我們諮詢行程建議${data.quoteNumber}。\n\n如果這趟旅程不再考慮中，沒問題，請忽略此信。\n如果您仍在計畫中、只是時間還沒定，回覆告訴我您的偏好（出發月份、預算、特別需求），我們可以為您提供新的建議。\n\n或者您正在比較多家旅行社 — 我們的優勢：CST #2166984 加州合法旅行業者、TCRF 消費者保障基金成員、+1 (510) 634-2307 真人接聽。`,
      bodyEn: `Hello${data.customerName ? `, ${data.customerName}` : ""},\n\nA week ago you reached out about itinerary ${data.quoteNumber}.\n\nIf you've moved on, no worries — please ignore this.\nIf you're still planning but timing isn't fixed yet, reply with your preferences (month, budget, special needs) and we'll prepare a fresh suggestion.\n\nOr you're comparing agencies — our credentials: CST #2166984 California-licensed, TCRF Consumer Protection member, +1 (510) 634-2307 real human support.`,
    },
  };
  const copy = stageCopy[data.stage];
  const subject = isEN ? copy.subjectEn : copy.subjectZh;
  const text = isEN ? copy.bodyEn : copy.bodyZh;
  const bodyHtml =
    `<p>${(isEN ? copy.bodyEn : copy.bodyZh).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` +
    (data.pdfUrl
      ? `<div style="margin: 24px 0;">${emailButton(isEN ? "View itinerary" : "查看行程建議", data.pdfUrl)}</div>`
      : "") +
    (data.tripRecap ? `<p style="font-size:13px;color:#666;"><em>${data.tripRecap}</em></p>` : "");
  const html = wrapInBrandTemplate({ title: subject, bodyHtml });

  const smtp = getTransporter();
  if (!smtp) {
    console.warn(`[Email] SMTP not configured — quote follow-up ${data.stage} skipped for ${data.quoteNumber}`);
    return false;
  }
  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.customerEmail,
      subject,
      text,
      html,
    });
    console.log(`[Email] Quote follow-up ${data.stage} sent for ${data.quoteNumber} → ${redactEmail(data.customerEmail)}`);
    return true;
  } catch (err) {
    console.error("[Email] Quote follow-up failed:", err);
    return false;
  }
}

// ─── v78l Sprint 4C: Post-trip review request ────────────────────────────

export interface ReviewRequestData {
  customerEmail: string;
  customerName: string;
  bookingId: number;
  tourTitle: string;
  language?: "zh-TW" | "en";
  /** Optional Google Place ID for direct review link */
  googleReviewUrl?: string;
  yelpReviewUrl?: string;
}

export async function sendReviewRequestEmail(data: ReviewRequestData) {
  const isEN = data.language === "en";
  const subject = isEN
    ? `Welcome home! How was your ${data.tourTitle} trip?`
    : `歡迎回家！您的「${data.tourTitle}」旅程如何？`;

  const text = isEN
    ? `Hello ${data.customerName},\n\nYou just got home from ${data.tourTitle} (booking #${data.bookingId}). We hope it was wonderful!\n\nIf you have 30 seconds, would you mind leaving us a review?\n  • Google: ${data.googleReviewUrl || "(link coming soon)"}\n  • Yelp: ${data.yelpReviewUrl || "(link coming soon)"}\n\nReply with one or two photos and a sentence — we'd love to hear about your favorite moment.\n\nAs a thank-you, your next booking gets 5% off (mention "REVIEW5" when you book).\n\n— PACK&GO Travel\n  +1 (510) 634-2307`
    : `親愛的 ${data.customerName} 您好：\n\n您剛結束的「${data.tourTitle}」旅程（訂單 #${data.bookingId}）希望一切順利！\n\n如果您願意花 30 秒，能否為我們留個評價？\n  • Google：${data.googleReviewUrl || "（連結整理中）"}\n  • Yelp：${data.yelpReviewUrl || "（連結整理中）"}\n\n或者您可以直接回信，附上一兩張照片與感想，我們很想聽您最喜歡的瞬間。\n\n為感謝您，下次訂團享 5% 優惠（訂團時報「REVIEW5」即可）。\n\n— PACK&GO 旅行社\n  +1 (510) 634-2307`;

  const buttons: string[] = [];
  if (data.googleReviewUrl) buttons.push(emailButton(isEN ? "Review on Google" : "在 Google 留評價", data.googleReviewUrl));
  if (data.yelpReviewUrl) buttons.push(emailButton(isEN ? "Review on Yelp" : "在 Yelp 留評價", data.yelpReviewUrl));

  const bodyHtml = `
    <h2 style="color:#0d9488; margin-bottom: 16px;">${subject}</h2>
    <p>${text.split("\n\n")[0]}</p>
    <p>${text.split("\n\n")[1]}</p>
    ${buttons.length > 0 ? `<div style="margin: 20px 0; display: flex; gap: 12px; flex-wrap: wrap;">${buttons.join("")}</div>` : ""}
    ${emailHighlightBox(`<strong>${isEN ? "Thank-you bonus" : "感謝獎勵"}:</strong> ${isEN ? "5% off your next trip — code REVIEW5" : "下次訂團 5% 優惠，代碼 REVIEW5"}`)}
    <p style="font-size:12px; color:#999; margin-top:24px;">PACK&GO Travel · CST #2166984 · +1 (510) 634-2307</p>
  `;
  const html = wrapInBrandTemplate({ title: subject, bodyHtml });

  const smtp = getTransporter();
  if (!smtp) {
    console.warn(`[Email] SMTP not configured — review request skipped for booking #${data.bookingId}`);
    return false;
  }
  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.customerEmail,
      subject,
      text,
      html,
    });
    console.log(`[Email] Review request sent for booking #${data.bookingId} → ${redactEmail(data.customerEmail)}`);
    return true;
  } catch (err) {
    console.error("[Email] Review request failed:", err);
    return false;
  }
}

// ─── v78n Sprint 6A: Booking abandonment recovery ──────────────────────

export interface AbandonmentRecoveryData {
  customerEmail: string;
  customerName: string;
  bookingId: number;
  tourTitle: string;
  departureDate: string;
  totalPrice: number;
  currency: string;
  language?: "zh-TW" | "en";
  /** Recovery discount code (5% off) */
  recoveryCode?: string;
}

export async function sendAbandonmentRecoveryEmail(data: AbandonmentRecoveryData) {
  const isEN = data.language === "en";
  const cur = (data.currency || "TWD").toUpperCase();
  const sym = cur === "TWD" ? "NT$" : cur === "USD" ? "$" : `${cur} `;
  const priceStr = `${sym}${data.totalPrice.toLocaleString()}`;
  const code = data.recoveryCode || "BACK5";

  const subject = isEN
    ? `Your spot is still waiting — ${data.tourTitle}`
    : `您的座位還為您保留中 — ${data.tourTitle}`;

  const text = isEN
    ? `Hello ${data.customerName},\n\nWe noticed you started booking ${data.tourTitle} (departing ${data.departureDate}) but didn't complete payment.\n\nYour seat is reserved for 24 more hours. Total: ${priceStr}\n\nUse code ${code} at checkout for 5% off.\n\n${BASE_URL}/bookings/${data.bookingId}\n\nQuestions? Reply or call +1 (510) 634-2307.\n\n— PACK&GO Travel`
    : `親愛的 ${data.customerName} 您好：\n\n您剛才開始預訂「${data.tourTitle}」（出發日 ${data.departureDate}），但似乎還沒完成付款。\n\n您的座位我們已為您保留 24 小時。總金額：${priceStr}\n\n結帳時使用優惠碼 ${code}，享 5% 折扣。\n\n${BASE_URL}/bookings/${data.bookingId}\n\n有任何問題？回覆此 email 或撥打 +1 (510) 634-2307\n\n— PACK&GO 旅行社`;

  const bodyHtml = `
    <h2 style="color:#0d9488; margin-bottom: 16px;">${isEN ? "Your spot is still waiting" : "您的座位仍為您保留中"}</h2>
    <p>${isEN ? `Hello <strong>${data.customerName}</strong>,` : `親愛的 <strong>${data.customerName}</strong> 您好：`}</p>
    <p>${
      isEN
        ? `We noticed you started booking <strong>${data.tourTitle}</strong> (departing ${data.departureDate}) but didn't complete payment.`
        : `您剛才開始預訂「<strong>${data.tourTitle}</strong>」（出發日 ${data.departureDate}），但似乎還沒完成付款。`
    }</p>
    ${emailHighlightBox(`<strong>${isEN ? "Your seat is reserved for 24 more hours" : "我們為您保留座位 24 小時"}</strong><br>${isEN ? "Total" : "總金額"}: ${priceStr}`)}
    <p>${isEN ? `Use code <strong style="font-family: monospace; padding: 2px 6px; background: #fef3c7; border-radius: 4px;">${code}</strong> at checkout for <strong>5% off</strong>.` : `結帳時使用優惠碼 <strong style="font-family: monospace; padding: 2px 6px; background: #fef3c7; border-radius: 4px;">${code}</strong>，享 <strong>5% 折扣</strong>。`}</p>
    <div style="margin: 24px 0;">${emailButton(isEN ? "Complete booking" : "繼續完成預訂", `${BASE_URL}/bookings/${data.bookingId}`)}</div>
    <p style="font-size:13px; color:#6b7280;">${isEN ? "Questions? Reply this email or call" : "有任何問題？回覆此 email 或撥打"} <a href="tel:+15106342307" style="color: #0d9488;">+1 (510) 634-2307</a></p>
  `;
  const html = wrapInBrandTemplate({ title: subject, bodyHtml });

  const smtp = getTransporter();
  if (!smtp) {
    console.warn(`[Email] SMTP not configured — abandonment recovery skipped for booking #${data.bookingId}`);
    return false;
  }
  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.customerEmail,
      subject,
      text,
      html,
    });
    console.log(`[Email] Abandonment recovery sent for booking #${data.bookingId} → ${redactEmail(data.customerEmail)}`);
    return true;
  } catch (err) {
    console.error("[Email] Abandonment recovery failed:", err);
    return false;
  }
}

// ─── Round 80.22 Phase G: Voucher issued email ──────────────────────────

export interface VoucherIssuedEmailData {
  customerEmail: string;
  customerName: string;
  voucherCode: string;
  voucherTitle: string;       // e.g. "$500 機票折抵券" / "$500 Flight Credit"
  amountUsd: number;
  pointsCost: number;
  expiresAt: Date;
  language?: "zh-TW" | "en";
}

/**
 * Sent immediately after a customer redeems Packpoint for a voucher.
 * Reinforces the brand + gives them the code + tells them how to use it.
 */
export async function sendVoucherIssuedEmail(data: VoucherIssuedEmailData) {
  const isEN = data.language === "en";
  const subject = isEN
    ? `Your reward voucher: ${data.voucherTitle}`
    : `兌換成功!您的 ${data.voucherTitle}`;
  const expiryStr = data.expiresAt.toLocaleDateString(isEN ? "en-US" : "zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const text = isEN
    ? `Hi ${data.customerName},\n\nThanks for redeeming ${data.pointsCost.toLocaleString()} Packpoint for ${data.voucherTitle}.\n\nYour voucher code:\n  ${data.voucherCode}\n\nValue: $${data.amountUsd}\nExpires: ${expiryStr}\n\nHow to use: present this code when booking with PACK&GO. We'll apply it to your next eligible booking.\n\nQuestions? Reply this email or call +1 (510) 634-2307.\n\n— PACK&GO Travel`
    : `${data.customerName} 您好,\n\n感謝您用 ${data.pointsCost.toLocaleString()} Packpoint 兌換 ${data.voucherTitle}。\n\n您的 voucher 代碼:\n  ${data.voucherCode}\n\n價值:$${data.amountUsd}\n到期日:${expiryStr}\n\n使用方式:預訂時告訴 PACK&GO 此 voucher code,我們會自動套用到符合條件的訂單上。\n\n如有問題請回覆此 email 或致電 +1 (510) 634-2307。\n\n— PACK&GO 旅行社`;

  const bodyHtml = `
    <h2 style="color:#8a6f3a; margin-bottom: 16px;">${isEN ? "Voucher Issued 🎁" : "兌換成功 🎁"}</h2>
    <p>${isEN ? `Hi <strong>${data.customerName}</strong>,` : `<strong>${data.customerName}</strong> 您好,`}</p>
    <p>${isEN ? `You redeemed ${data.pointsCost.toLocaleString()} Packpoint for:` : `您用 ${data.pointsCost.toLocaleString()} Packpoint 兌換:`}</p>
    ${emailHighlightBox(`<strong style="font-size:16px;">${data.voucherTitle}</strong><br><span style="font-size:13px;color:#666;">${isEN ? "Value" : "面額"}: $${data.amountUsd}</span>`)}
    <p style="margin-top:20px; font-size:13px; color:#666;">${isEN ? "Voucher code (click to copy):" : "Voucher 代碼(可全選複製):"}</p>
    <div style="font-family:monospace; font-size:18px; font-weight:700; padding:14px 20px; background:#FAF8F2; border:1px solid #c9a563; border-radius:8px; text-align:center; letter-spacing:2px; user-select:all;">${data.voucherCode}</div>
    <p style="margin-top:16px; font-size:13px;">${isEN ? `<strong>Expires:</strong> ${expiryStr}` : `<strong>到期日:</strong>${expiryStr}`}</p>
    <p style="font-size:13px; color:#555;">${isEN ? "<strong>How to use:</strong> Present this code when booking with PACK&GO. We'll apply it to your next eligible booking automatically." : "<strong>使用方式:</strong>預訂時告訴 PACK&GO 此 voucher code,我們會自動套用到符合條件的訂單上。"}</p>
    <div style="margin: 24px 0;">${emailButton(isEN ? "View my vouchers" : "查看我的 voucher", `${BASE_URL}/rewards`)}</div>
    <p style="font-size:12px; color:#999; margin-top:24px;">PACK&GO Travel · CST #2166984 · +1 (510) 634-2307</p>
  `;
  const html = wrapInBrandTemplate({ title: subject, bodyHtml });

  const smtp = getTransporter();
  if (!smtp) {
    console.warn(`[Email] SMTP not configured — voucher email skipped (${data.voucherCode})`);
    return false;
  }
  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.customerEmail,
      subject,
      text,
      html,
    });
    console.log(`[Email] Voucher issued email sent (${data.voucherCode}) → ${redactEmail(data.customerEmail)}`);
    return true;
  } catch (err) {
    console.error("[Email] Voucher issued email failed:", err);
    return false;
  }
}

// ─── QA Audit 2026-05-11 Phase 9: 30-day winback email ─────────────────
//
// Sent 30 days after returnDate to remind former customers PACK&GO exists.
// For a one-person agency, repeat-booking rate is the single biggest
// revenue lever — Phase 9 found there was NO winback automation at all.

export interface WinbackEmailData {
  customerEmail: string;
  customerName: string;
  bookingId: number;
  pastTourTitle: string;
  language?: "zh-TW" | "en";
  /** Optional discount code, defaults to WELCOMEBACK7 */
  promoCode?: string;
}

export async function sendWinbackEmail(data: WinbackEmailData) {
  const isEN = data.language === "en";
  const code = data.promoCode || "WELCOMEBACK7";

  const subject = isEN
    ? `Still thinking about that ${data.pastTourTitle} trip?`
    : `還記得我們陪您去的「${data.pastTourTitle}」嗎?`;

  const text = isEN
    ? `Hello ${data.customerName},\n\nIt's been a month since your ${data.pastTourTitle} trip. We hope the memories are still vivid.\n\nIf you're thinking about your next trip — maybe a different season, a new region, or bringing family this time — Jeff would love to plan it with you personally.\n\nAs a returning customer, your next custom itinerary gets 7% off (code ${code}).\n\nWhat caught your eye? Just reply with a destination or a date range and Jeff will draft a quote within 24 hours.\n\n— Jeff @ PACK&GO Travel\n  jeffhsieh09@gmail.com · +1 (510) 634-2307`
    : `親愛的 ${data.customerName} 您好:\n\n您從「${data.pastTourTitle}」回來剛好滿一個月了,旅程的回憶還鮮明嗎?\n\n如果您開始想下一趟 — 或許不同季節、不同地區,或這次帶家人 — Jeff 想親自陪您規劃。\n\n回頭客專屬,下次客製行程享 7% 優惠(代碼 ${code})。\n\n有什麼想去的地方?回信告訴我目的地或日期區間,Jeff 24 小時內幫您起草報價。\n\n— Jeff @ PACK&GO 旅行社\n  jeffhsieh09@gmail.com · +1 (510) 634-2307`;

  const bodyHtml = `
    <h2 style="color:#0d9488; margin-bottom: 16px;">${isEN ? "We miss you" : "想念您"}</h2>
    <p>${isEN ? `Hello <strong>${data.customerName}</strong>,` : `親愛的 <strong>${data.customerName}</strong> 您好:`}</p>
    <p>${
      isEN
        ? `It's been a month since your <strong>${data.pastTourTitle}</strong> trip. We hope the memories are still vivid.`
        : `您從「<strong>${data.pastTourTitle}</strong>」回來剛好滿一個月了,旅程的回憶還鮮明嗎?`
    }</p>
    <p>${
      isEN
        ? "If you're thinking about your next trip — maybe a different season, a new region, or bringing family this time — Jeff would love to plan it with you personally."
        : "如果您開始想下一趟 — 或許不同季節、不同地區,或這次帶家人 — Jeff 想親自陪您規劃。"
    }</p>
    ${emailHighlightBox(
      `<strong>${isEN ? "Returning customer bonus" : "回頭客專屬"}:</strong> ${
        isEN
          ? `7% off your next custom itinerary — code <code style="font-family:monospace;letter-spacing:1px;">${code}</code>`
          : `下次客製行程享 7% 優惠 — 代碼 <code style="font-family:monospace;letter-spacing:1px;">${code}</code>`
      }`
    )}
    <p style="margin-top:18px;">${
      isEN
        ? "Just reply with a destination or date range — Jeff will draft a quote within 24 hours."
        : "回信告訴 Jeff 目的地或日期區間,24 小時內幫您起草報價。"
    }</p>
    <div style="margin: 24px 0;">${emailButton(
      isEN ? "Email Jeff directly" : "直接回信給 Jeff",
      "mailto:jeffhsieh09@gmail.com"
    )}</div>
    <p style="font-size:12px; color:#999; margin-top:24px;">PACK&GO Travel · CST #2166984 · +1 (510) 634-2307</p>
  `;
  const html = wrapInBrandTemplate({ title: subject, bodyHtml });

  const smtp = getTransporter();
  if (!smtp) {
    console.warn(
      `[Email] SMTP not configured — winback skipped for booking #${data.bookingId}`
    );
    return false;
  }
  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.customerEmail,
      subject,
      text,
      html,
    });
    console.log(
      `[Email] Winback sent for booking #${data.bookingId} → ${redactEmail(
        data.customerEmail
      )}`
    );
    return true;
  } catch (err) {
    console.error("[Email] Winback failed:", err);
    return false;
  }
}

// ─── QA Audit 2026-05-11 Phase 9: 90-day check-in email ────────────────
//
// Final touchpoint in the customer journey. By 90 days post-trip the
// active memory has faded and competitors are easier to switch to. This
// is a low-touch reminder — no discount, just one warm-personal photo
// memory cue + an open invitation. The goal isn't conversion, it's
// keeping PACK&GO mentally available when they DO start thinking about
// the next trip.

export interface CheckinEmailData {
  customerEmail: string;
  customerName: string;
  bookingId: number;
  pastTourTitle: string;
  language?: "zh-TW" | "en";
  /** Optional discount code for users who DO want to re-engage */
  promoCode?: string;
}

export async function sendCheckinEmail(data: CheckinEmailData) {
  const isEN = data.language === "en";
  const code = data.promoCode || "FRIENDS10";

  const subject = isEN
    ? `Three months on — quick hello from Jeff @ PACK&GO`
    : `三個月過去了 — Jeff 跟您打聲招呼`;

  const text = isEN
    ? `Hello ${data.customerName},\n\nThree months ago you went on ${data.pastTourTitle} with us. I hope it still feels recent.\n\nI'm not pitching anything — just a quick check-in. If you ever want to recommend a friend or family member to PACK&GO, they get 10% off their first trip (code ${code}) and you get a $100 credit toward your next one.\n\nIf you've been daydreaming about another trip, you know where to find me.\n\n— Jeff @ PACK&GO Travel\n  jeffhsieh09@gmail.com · +1 (510) 634-2307`
    : `親愛的 ${data.customerName} 您好:\n\n三個月前我陪您走了「${data.pastTourTitle}」,希望那段時光還鮮明。\n\n這封信不推銷什麼 — 純粹打聲招呼。如果您身邊有朋友或家人想試試 PACK&GO,他們第一趟享 10% 優惠(代碼 ${code}),您也會收到 $100 信用額度抵下次行程。\n\n如果您自己在想下趟旅行,您知道去哪裡找我。\n\n— Jeff @ PACK&GO 旅行社\n  jeffhsieh09@gmail.com · +1 (510) 634-2307`;

  const bodyHtml = `
    <h2 style="color:#0d9488; margin-bottom: 16px;">${isEN ? "Three months on" : "三個月過去了"}</h2>
    <p>${isEN ? `Hello <strong>${data.customerName}</strong>,` : `親愛的 <strong>${data.customerName}</strong> 您好:`}</p>
    <p>${
      isEN
        ? `Three months ago you went on <strong>${data.pastTourTitle}</strong> with us. I hope it still feels recent.`
        : `三個月前我陪您走了「<strong>${data.pastTourTitle}</strong>」,希望那段時光還鮮明。`
    }</p>
    <p>${
      isEN
        ? "I'm not pitching anything — just a quick check-in."
        : "這封信不推銷什麼 — 純粹打聲招呼。"
    }</p>
    ${emailHighlightBox(
      isEN
        ? `<strong>Referral perk:</strong> Friend/family gets 10% off (code <code style="font-family:monospace;">${code}</code>), you get $100 credit for the next trip.`
        : `<strong>推薦獎勵:</strong>朋友或家人第一趟享 10% 優惠(代碼 <code style="font-family:monospace;">${code}</code>),您獲 $100 信用額度抵下次行程。`
    )}
    <p style="margin-top:18px;">${
      isEN
        ? "If you've been daydreaming about another trip, you know where to find me."
        : "如果您自己在想下趟旅行,您知道去哪裡找我。"
    }</p>
    <p style="margin-top:18px;font-style:italic;color:#666;">${isEN ? "— Jeff" : "— Jeff"}</p>
    <p style="font-size:12px; color:#999; margin-top:24px;">PACK&GO Travel · CST #2166984 · +1 (510) 634-2307</p>
  `;
  const html = wrapInBrandTemplate({ title: subject, bodyHtml });

  const smtp = getTransporter();
  if (!smtp) {
    console.warn(
      `[Email] SMTP not configured — checkin skipped for booking #${data.bookingId}`
    );
    return false;
  }
  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.customerEmail,
      subject,
      text,
      html,
    });
    console.log(
      `[Email] 90-day check-in sent for booking #${data.bookingId} → ${redactEmail(
        data.customerEmail
      )}`
    );
    return true;
  } catch (err) {
    console.error("[Email] Check-in failed:", err);
    return false;
  }
}

// ─── Round 81 / migration 0075: Membership trial ending reminder ─────────
//
// AB 390 / California Bus. & Prof. Code §17602 mandates a "clear and
// conspicuous" notice of the upcoming auto-charge between 3 and 21 days
// before it happens. Stripe fires `customer.subscription.trial_will_end`
// ~3 days before the trial ends — this email is what we send in response.
//
// Required content per AB 390:
//   - The exact charge amount (in user's currency)
//   - The charge date
//   - The product / tier being charged for
//   - How to cancel (one-click link, no phone-only escape routes allowed)
//
// We use plain Gmail SMTP (PACK&GO brand voice), not Stripe's invoice
// template — Stripe's default email is generic and doesn't match the
// PACK&GO tone customers will have set expectations around.

export interface TrialEndingReminderData {
  to: string;
  customerName: string;
  /** "Plus" or "Concierge" — already capitalized */
  tierLabel: string;
  trialEndsAt: Date;
  /** Pre-formatted "USD $29.00" string */
  chargeAmount: string;
  chargeInterval: "month" | "year";
  /** Direct link to /membership where they can cancel (one-click) */
  cancelUrl: string;
  language?: "zh-TW" | "en";
}

export async function sendTrialEndingReminder(data: TrialEndingReminderData) {
  const isEN = data.language === "en";
  const endDateStr = data.trialEndsAt.toLocaleDateString(isEN ? "en-US" : "zh-TW", {
    year: "numeric", month: "long", day: "numeric",
  });
  const intervalLabel = isEN
    ? data.chargeInterval === "year" ? "/ year" : "/ month"
    : data.chargeInterval === "year" ? "/年" : "/月";

  const subject = isEN
    ? `Heads-up: Your PACK&GO ${data.tierLabel} trial ends ${endDateStr}`
    : `提醒:您的 PACK&GO ${data.tierLabel} 試用 ${endDateStr} 結束`;

  const text = isEN
    ? `Hi ${data.customerName},

Just a heads-up — your 10-day PACK&GO ${data.tierLabel} trial ends on ${endDateStr}.

After that, your card will be automatically charged ${data.chargeAmount} ${intervalLabel.trim()} for the ${data.tierLabel} membership.

What happens next:
  • If you do nothing → membership continues, card charged on ${endDateStr}
  • If you want to cancel → click below, takes 10 seconds, no phone call needed

Cancel or manage subscription:
${data.cancelUrl}

Thanks for trying PACK&GO ${data.tierLabel}!

— PACK&GO Travel
CST #2166984 · +1 (510) 634-2307
This message complies with California Business & Professions Code §17602.`
    : `${data.customerName} 您好,

提醒一下 — 您 10 天的 PACK&GO ${data.tierLabel} 試用將於 ${endDateStr} 結束。

之後您的卡將自動扣款 ${data.chargeAmount} ${intervalLabel}（${data.tierLabel} 會員費)。

接下來:
  • 不做任何事 → 會員自動延續,${endDateStr} 開始扣款
  • 想取消 → 點下面的連結,10 秒完成,無需打電話

取消或管理訂閱:
${data.cancelUrl}

感謝您體驗 PACK&GO ${data.tierLabel}!

— PACK&GO 旅行社
CST #2166984 · +1 (510) 634-2307
本通知符合加州 Business & Professions Code §17602。`;

  const cta = isEN ? "Manage subscription" : "管理訂閱";
  const bodyHtml = `
    <h2 style="color:#8a6f3a; margin-bottom: 16px;">${isEN ? "Trial ending soon" : "試用即將結束"}</h2>
    <p>${isEN ? `Hi <strong>${data.customerName}</strong>,` : `<strong>${data.customerName}</strong> 您好,`}</p>
    <p>${isEN
      ? `Your <strong>10-day PACK&GO ${data.tierLabel} trial</strong> ends on <strong>${endDateStr}</strong>.`
      : `您的 <strong>10 天 PACK&GO ${data.tierLabel} 試用</strong> 將於 <strong>${endDateStr}</strong> 結束。`}</p>

    ${emailHighlightBox(`
      <strong style="font-size:15px;">${isEN ? "Auto-charge details" : "自動扣款明細"}:</strong><br>
      ${isEN ? "Amount" : "金額"}: <strong>${data.chargeAmount} ${intervalLabel.trim()}</strong><br>
      ${isEN ? "Charge date" : "扣款日期"}: <strong>${endDateStr}</strong><br>
      ${isEN ? "Product" : "方案"}: <strong>${data.tierLabel}</strong>
    `)}

    <p style="font-size:14px; margin-top:20px;">
      ${isEN
        ? "If you'd like to continue, you don't need to do anything. To cancel, click below — takes 10 seconds, no phone call needed."
        : "若想繼續使用無需任何動作。想取消請點下方連結 — 10 秒完成,無需打電話。"}
    </p>

    <div style="margin: 24px 0;">${emailButton(cta, data.cancelUrl)}</div>

    <hr style="border:0; border-top:1px solid #eee; margin:24px 0;">
    <p style="font-size:11px; color:#999;">
      PACK&GO Travel · CST #2166984 · +1 (510) 634-2307<br>
      ${isEN
        ? "This message complies with California Business & Professions Code §17602 (auto-renewal notification)."
        : "本通知符合加州 Business & Professions Code §17602(自動續訂通知)。"}
    </p>
  `;
  const html = wrapInBrandTemplate({ title: subject, bodyHtml });

  const smtp = getTransporter();
  if (!smtp) {
    console.warn(`[Email] SMTP not configured — trial reminder skipped for ${redactEmail(data.to)}`);
    return false;
  }
  try {
    await smtp.sendMail({
      from: `"PACK&GO Travel" <${EMAIL_FROM}>`,
      to: data.to,
      subject,
      text,
      html,
    });
    console.log(`[Email] Trial-ending reminder sent (tier=${data.tierLabel}) → ${redactEmail(data.to)}`);
    return true;
  } catch (err) {
    console.error("[Email] Trial-ending reminder failed:", err);
    return false;
  }
}
