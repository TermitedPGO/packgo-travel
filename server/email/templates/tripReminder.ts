// server/email/templates/tripReminder.ts
//
// v77: Trip Reminder Email — sent at 30/14/7/3/1 days before departure.
// Each window has slightly different copy aimed at the customer's current
// concern (planning vs paperwork vs final logistics).
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.

import { notifyOwner } from "../../_core/notification";
import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailInfoTable,
} from "../../services/emailTemplateService";
import { BASE_URL, EMAIL_FROM, getTransporter } from "../_shared";
import type { TripReminderEmailData } from "./types";

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
