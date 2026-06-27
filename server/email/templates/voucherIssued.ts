// server/email/templates/voucherIssued.ts
//
// Round 80.22 Phase G: Voucher issued email — sent immediately after a
// customer redeems Packpoint for a voucher. Reinforces the brand +
// gives them the code + tells them how to use it.
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.

import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailButton,
  emailHighlightBox,
} from "../../services/emailTemplateService";
import { BASE_URL, EMAIL_FROM, getTransporter } from "../_shared";
import type { VoucherIssuedEmailData } from "./types";

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
    ? `Hi ${data.customerName},\n\nThanks for redeeming ${data.pointsCost.toLocaleString()} Packpoint for ${data.voucherTitle}.\n\nYour voucher code:\n  ${data.voucherCode}\n\nValue: $${data.amountUsd}\nExpires: ${expiryStr}\n\nHow to use: present this code when booking with PACK&GO. We'll apply it to your next eligible booking.\n\nQuestions? Reply this email or call +1 (510) 634-2307.\n\nPACK&GO Travel`
    : `${data.customerName} 您好,\n\n感謝您用 ${data.pointsCost.toLocaleString()} Packpoint 兌換 ${data.voucherTitle}。\n\n您的 voucher 代碼:\n  ${data.voucherCode}\n\n價值:$${data.amountUsd}\n到期日:${expiryStr}\n\n使用方式:預訂時告訴 PACK&GO 此 voucher code,我們會自動套用到符合條件的訂單上。\n\n如有問題請回覆此 email 或致電 +1 (510) 634-2307。\n\nPACK&GO 旅行社`;

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
