// server/email/templates/checkin.ts
//
// QA Audit 2026-05-11 Phase 9: 90-day check-in email.
// Final touchpoint in the customer journey. By 90 days post-trip the
// active memory has faded and competitors are easier to switch to. This
// is a low-touch reminder — no discount, just one warm-personal photo
// memory cue + an open invitation. The goal isn't conversion, it's
// keeping PACK&GO mentally available when they DO start thinking about
// the next trip.
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.

import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailHighlightBox,
} from "../../services/emailTemplateService";
import { EMAIL_FROM, getTransporter } from "../_shared";
import type { CheckinEmailData } from "./types";

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
