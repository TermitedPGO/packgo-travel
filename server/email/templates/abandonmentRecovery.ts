// server/email/templates/abandonmentRecovery.ts
//
// v78n Sprint 6A: Booking abandonment recovery email — sent ~1h after
// the customer starts a checkout but doesn't complete payment. Offers a
// small discount (BACK5 default) + a 24-hour seat hold.
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.

import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailButton,
  emailHighlightBox,
} from "../../services/emailTemplateService";
import { BASE_URL, EMAIL_FROM, getTransporter } from "../_shared";
import type { AbandonmentRecoveryData } from "./types";

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
