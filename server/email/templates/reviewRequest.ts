// server/email/templates/reviewRequest.ts
//
// v78l Sprint 4C: Post-trip review request — sent shortly after the
// customer returns home, asking for a Google / Yelp review.
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.

import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailButton,
  emailHighlightBox,
} from "../../services/emailTemplateService";
import { EMAIL_FROM, getTransporter } from "../_shared";
import type { ReviewRequestData } from "./types";

export async function sendReviewRequestEmail(data: ReviewRequestData) {
  const isEN = data.language === "en";
  const subject = isEN
    ? `Welcome home! How was your ${data.tourTitle} trip?`
    : `歡迎回家！您的「${data.tourTitle}」旅程如何？`;

  const text = isEN
    ? `Hello ${data.customerName},\n\nYou just got home from ${data.tourTitle} (booking #${data.bookingId}). We hope it was wonderful!\n\nIf you have 30 seconds, would you mind leaving us a review?\n  • Google: ${data.googleReviewUrl || "(link coming soon)"}\n  • Yelp: ${data.yelpReviewUrl || "(link coming soon)"}\n\nReply with one or two photos and a sentence, we'd love to hear about your favorite moment.\n\nAs a thank-you, your next booking gets 5% off (mention "REVIEW5" when you book).\n\nPACK&GO Travel\n  +1 (510) 634-2307`
    : `親愛的 ${data.customerName} 您好：\n\n您剛結束的「${data.tourTitle}」旅程（訂單 #${data.bookingId}）希望一切順利！\n\n如果您願意花 30 秒，能否為我們留個評價？\n  • Google：${data.googleReviewUrl || "（連結整理中）"}\n  • Yelp：${data.yelpReviewUrl || "（連結整理中）"}\n\n或者您可以直接回信，附上一兩張照片與感想，我們很想聽您最喜歡的瞬間。\n\n為感謝您，下次訂團享 5% 優惠（訂團時報「REVIEW5」即可）。\n\nPACK&GO 旅行社\n  +1 (510) 634-2307`;

  const buttons: string[] = [];
  if (data.googleReviewUrl) buttons.push(emailButton(isEN ? "Review on Google" : "在 Google 留評價", data.googleReviewUrl));
  if (data.yelpReviewUrl) buttons.push(emailButton(isEN ? "Review on Yelp" : "在 Yelp 留評價", data.yelpReviewUrl));

  const bodyHtml = `
    <h2 style="color:#0d9488; margin-bottom: 16px;">${subject}</h2>
    <p>${text.split("\n\n")[0]}</p>
    <p>${text.split("\n\n")[1]}</p>
    ${buttons.length > 0 ? `<div style="margin: 20px 0; display: flex; gap: 12px; flex-wrap: wrap;">${buttons.join("")}</div>` : ""}
    ${emailHighlightBox(`<strong>${isEN ? "Thank-you bonus" : "感謝獎勵"}:</strong> ${isEN ? "5% off your next trip, code REVIEW5" : "下次訂團 5% 優惠，代碼 REVIEW5"}`)}
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
