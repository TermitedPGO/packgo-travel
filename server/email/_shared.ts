// server/email/_shared.ts
//
// Shared transport + environment helpers for all email templates.
// Extracted from server/email.ts in v2 Wave 2 Module 2.11.
//
// Public surface (consumed by per-template files under ./templates/):
//   - getTransporter(): cached nodemailer Transporter or null when env unset
//   - EMAIL_FROM      : "From:" address used by every send
//   - BASE_URL        : public base used in CTA links / footer URLs
//
// No HTML or copy lives here — templates own their own rendering.

import nodemailer, { type Transporter } from "nodemailer";

// Email configuration (read once at module load — process.env is immutable in
// production builds and tests reset env via vitest setupFiles when needed).
const EMAIL_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || "587");
const EMAIL_SECURE = process.env.EMAIL_SECURE === "true";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
export const EMAIL_FROM =
  process.env.EMAIL_FROM || EMAIL_USER || "noreply@packgo.com";
export const BASE_URL =
  process.env.BASE_URL || "https://packgo-travel.fly.dev";

let transporter: Transporter | null = null;

/**
 * Initialize SMTP transporter (Gmail by default, override via EMAIL_HOST).
 * Returns null when EMAIL_USER / EMAIL_PASSWORD are not configured — callers
 * MUST handle the null case (every template warns + returns false).
 */
export function getTransporter(): Transporter | null {
  if (!transporter && EMAIL_USER && EMAIL_PASSWORD) {
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_SECURE,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASSWORD,
      },
    });
  }
  return transporter;
}
