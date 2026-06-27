// server/email/templates/quoteFollowUp.ts
//
// v78l Sprint 4B: AI quote follow-up sequence — 24h / 3d / 7d cadence
// after a customer requests a quote. Each stage has a different tone
// (curious → urgency → last chance).
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.

import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailButton,
} from "../../services/emailTemplateService";
import { EMAIL_FROM, getTransporter } from "../_shared";
import type { QuoteFollowUpData } from "./types";

export async function sendQuoteFollowUpEmail(data: QuoteFollowUpData) {
  const isEN = data.language === "en";
  const stageCopy = {
    "24h": {
      subjectZh: `您的行程建議書 ${data.quoteNumber}｜有任何問題嗎？`,
      subjectEn: `Your itinerary ${data.quoteNumber}｜any questions?`,
      bodyZh: `您好${data.customerName ? `，${data.customerName}` : ""}：\n\n感謝您昨天向 PACK&GO 諮詢。我們的 AI 顧問已為您整理一份行程建議。\n\n如有任何疑問，或想調整內容，歡迎隨時回覆此 email 或撥打 +1 (510) 634-2307。\n\n附帶提醒：最終報價我們會在 1 週內與供應商確認後另行通知。`,
      bodyEn: `Hello${data.customerName ? `, ${data.customerName}` : ""},\n\nThanks for reaching out to PACK&GO yesterday. Our AI advisor has put together an itinerary for you.\n\nQuestions or want changes? Reply or call +1 (510) 634-2307.\n\nAs a reminder: final pricing follows within 1 week after we confirm with suppliers.`,
    },
    "3d": {
      subjectZh: `${data.quoteNumber}｜出發位子有限，要保留嗎？`,
      subjectEn: `${data.quoteNumber}｜Limited seats, want to lock yours?`,
      bodyZh: `您好${data.customerName ? `，${data.customerName}` : ""}：\n\n您 3 天前看的行程建議${data.quoteNumber}，目前出發日仍有空位。\n\n旅遊團通常離出發越近、空位越緊張。如果這趟旅程符合您的期待，建議您回覆此 email 或致電 +1 (510) 634-2307 讓我們先為您鎖位（鎖位不收訂金，只是預留位子方便我們和供應商確認）。`,
      bodyEn: `Hello${data.customerName ? `, ${data.customerName}` : ""},\n\nYour itinerary ${data.quoteNumber} from 3 days ago, seats are still available.\n\nGroup tours fill up fast as departure approaches. If this trip looks right, reply or call +1 (510) 634-2307 to hold seats (no deposit needed yet, just a hold so we can confirm with suppliers).`,
    },
    "7d": {
      subjectZh: `${data.quoteNumber}｜最後機會，是否需要協助？`,
      subjectEn: `${data.quoteNumber}｜Last chance, anything we can help with?`,
      bodyZh: `您好${data.customerName ? `，${data.customerName}` : ""}：\n\n一個禮拜前您曾向我們諮詢行程建議${data.quoteNumber}。\n\n如果這趟旅程不再考慮中，沒問題，請忽略此信。\n如果您仍在計畫中、只是時間還沒定，回覆告訴我您的偏好（出發月份、預算、特別需求），我們可以為您提供新的建議。\n\n或者您正在比較多家旅行社,我們的優勢：CST #2166984 加州合法旅行業者、TCRF 消費者保障基金成員、+1 (510) 634-2307 真人接聽。`,
      bodyEn: `Hello${data.customerName ? `, ${data.customerName}` : ""},\n\nA week ago you reached out about itinerary ${data.quoteNumber}.\n\nIf you've moved on, no worries, please ignore this.\nIf you're still planning but timing isn't fixed yet, reply with your preferences (month, budget, special needs) and we'll prepare a fresh suggestion.\n\nOr you're comparing agencies, our credentials: CST #2166984 California-licensed, TCRF Consumer Protection member, +1 (510) 634-2307 real human support.`,
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
