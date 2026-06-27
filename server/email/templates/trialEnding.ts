// server/email/templates/trialEnding.ts
//
// Round 81 / migration 0075: Membership trial ending reminder.
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
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.
// Atomicity guard: Wave 1 Module 2 already flips the "reminder_sent"
// flag BEFORE this function is invoked, so duplicate sends are avoided
// even if SMTP fails — keep callers' ordering intact.

import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailButton,
  emailHighlightBox,
} from "../../services/emailTemplateService";
import { EMAIL_FROM, getTransporter } from "../_shared";
import type { TrialEndingReminderData } from "./types";

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

Just a heads-up, your 10-day PACK&GO ${data.tierLabel} trial ends on ${endDateStr}.

After that, your card will be automatically charged ${data.chargeAmount} ${intervalLabel.trim()} for the ${data.tierLabel} membership.

What happens next:
  • If you do nothing → membership continues, card charged on ${endDateStr}
  • If you want to cancel → click below, takes 10 seconds, no phone call needed

Cancel or manage subscription:
${data.cancelUrl}

Thanks for trying PACK&GO ${data.tierLabel}!

PACK&GO Travel
CST #2166984 · +1 (510) 634-2307
This message complies with California Business & Professions Code §17602.`
    : `${data.customerName} 您好,

提醒一下,您 10 天的 PACK&GO ${data.tierLabel} 試用將於 ${endDateStr} 結束。

之後您的卡將自動扣款 ${data.chargeAmount} ${intervalLabel}（${data.tierLabel} 會員費)。

接下來:
  • 不做任何事 → 會員自動延續,${endDateStr} 開始扣款
  • 想取消 → 點下面的連結,10 秒完成,無需打電話

取消或管理訂閱:
${data.cancelUrl}

感謝您體驗 PACK&GO ${data.tierLabel}!

PACK&GO 旅行社
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
        ? "If you'd like to continue, you don't need to do anything. To cancel, click below, takes 10 seconds, no phone call needed."
        : "若想繼續使用無需任何動作。想取消請點下方連結,10 秒完成,無需打電話。"}
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
