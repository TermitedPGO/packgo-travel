// server/email/templates/supplierNotification.ts
//
// v78l Sprint 4A: Supplier auto-notification email.
// Sent to the operating supplier (hotel/operator) when a customer's
// booking is paid; CC's Jeff so he sees what went out.
//
// Extracted verbatim from server/email.ts in v2 Wave 2 Module 2.11.

import { redactEmail } from "../../_core/redact";
import {
  wrapInBrandTemplate,
  emailInfoTable,
  emailHighlightBox,
} from "../../services/emailTemplateService";
import { BASE_URL, EMAIL_FROM, getTransporter } from "../_shared";
import type { SupplierNotificationData } from "./types";

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
