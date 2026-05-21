// server/email/templates/winback.ts
//
// QA Audit 2026-05-11 Phase 9: 30-day winback email.
// Sent 30 days after returnDate to remind former customers PACK&GO
// exists. For a one-person agency, repeat-booking rate is the single
// biggest revenue lever — Phase 9 found there was NO winback
// automation at all.
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.

import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailButton,
  emailHighlightBox,
} from "../../services/emailTemplateService";
import { EMAIL_FROM, getTransporter } from "../_shared";
import type { WinbackEmailData } from "./types";

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
