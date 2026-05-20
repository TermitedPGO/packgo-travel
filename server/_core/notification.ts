import { TRPCError } from "@trpc/server";
import nodemailer, { type Transporter } from "nodemailer";
import { captureMessage } from "./sentry";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

// SECURITY_AUDIT_2026_05_14 P2-6: strip CRLF before the title lands in an
// email Subject header. Nodemailer ≥6 already strips CRLF from headers as
// a defense, so this is belt-and-suspenders — if the transport is ever
// swapped (different mail library, or the title is forwarded through SMS /
// Slack later), the lack of explicit \r\n stripping becomes load-bearing.
const trimValue = (value: string): string =>
  value.replace(/[\r\n]+/g, " ").trim();
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validatePayload = (input: NotificationPayload): NotificationPayload => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required.",
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required.",
    });
  }

  const title = trimValue(input.title);
  const content = trimValue(input.content);

  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`,
    });
  }

  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`,
    });
  }

  return { title, content };
};

const OWNER_EMAIL = process.env.OWNER_EMAIL || "jeffhsieh09@gmail.com";

let cachedTransporter: Transporter | null = null;
function getNotifyTransport(): Transporter | null {
  if (cachedTransporter) return cachedTransporter;
  const host = process.env.EMAIL_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.EMAIL_PORT || "587", 10);
  const secure = process.env.EMAIL_SECURE === "true";
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;
  if (!user || !pass) return null;
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return cachedTransporter;
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Dispatches an owner notification (currently to Jeff's Gmail via SMTP).
 *
 * The QA audit (2026-05-11) found this was the #1 leverage point: 5+ call
 * sites in the codebase already invoke notifyOwner() expecting delivery,
 * and Phase 5 ("Solo Operator Resilience") identified payment / refund /
 * worker-failure / refund-escalation as silently dropping on the floor.
 * Wiring this single function back to a real SMTP transport instantly
 * fixes every downstream call site.
 *
 * Channel: Gmail SMTP via EMAIL_USER / EMAIL_PASSWORD env vars. Falls
 * back to console.warn if SMTP isn't configured (dev / preview envs).
 * Return value: true on delivery success, false on missing config or
 * SMTP error. Callers should treat false as "try fallback channel" but
 * NOT as a hard failure (we never want notification gaps to crash the
 * primary operation that triggered the notify).
 *
 * Recipient: OWNER_EMAIL env var, falling back to jeffhsieh09@gmail.com.
 * The owner address lives in env so future co-owners / staff can be CC'd
 * without code changes.
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  const { title, content } = validatePayload(payload);

  // v2 Wave 1 Module 1.1 — also surface the notification in Sentry. Belt +
  // suspenders per CLAUDE.md §核心原則: if email delivery silently fails
  // (SMTP misconfig, rate limit, OWNER_EMAIL typo) the trail is still in
  // Sentry. Capture as "warning" — notifyOwner is the owner-alert channel,
  // not an error channel; treating every alert as an error would noise up
  // the Sentry inbox.
  captureMessage(`[notifyOwner] ${title}\n${content}`, "warning");

  const transport = getNotifyTransport();
  if (!transport) {
    console.warn(
      "[notifyOwner] SMTP not configured (EMAIL_USER/EMAIL_PASSWORD); " +
        "notification dropped:",
      title
    );
    return false;
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || OWNER_EMAIL;
  const subject = `[PACK&GO] ${title}`;
  const textBody = `${title}\n\n${content}\n\n— PACK&GO automated notification`;
  const htmlBody = `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;background:#f5f5f5;margin:0;padding:24px;color:#1a1a1a">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
<h2 style="margin:0 0 16px 0;font-size:18px;color:#0D9488">${escapeHtml(title)}</h2>
<div style="font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(content)}</div>
<hr style="border:0;border-top:1px solid #e5e5e5;margin:24px 0 12px 0">
<p style="font-size:11px;color:#666;margin:0">PACK&GO automated notification · 此信由系統自動寄出,請勿回覆</p>
</div>
</body>
</html>`;

  try {
    await transport.sendMail({
      from,
      to: OWNER_EMAIL,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return true;
  } catch (err: any) {
    console.error(
      "[notifyOwner] delivery failed:",
      err?.message || err,
      "— title:",
      title
    );
    return false;
  }
}
