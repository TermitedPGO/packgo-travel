/**
 * emailMarketingService.ts
 * Email 電子報服務 — 生成 HTML 模板 + 批量發送
 * 使用 nodemailer SMTP（與 email.ts 相同設定，但不修改 email.ts）
 */

import nodemailer, { type Transporter } from "nodemailer";
import { updateMarketingCampaign } from "../db";
import { redactEmail } from "../_core/redact";

// ── Types ──────────────────────────────────────────────────

export interface NewsletterTourCard {
  id: number;
  title: string;
  destination: string;
  duration: string;
  price: number;
  heroImage: string;
  highlights: string[];
}

export interface NewsletterOptions {
  subject: string;
  preheader: string;
  tours: NewsletterTourCard[];
  headerMessage?: string;
  footerMessage?: string;
}

export interface SendNewsletterOptions {
  campaignId: number;
  subject: string;
  htmlContent: string;
  subscribers: string[];
}

export interface SendResult {
  sent: number;
  failed: number;
}

// ── SMTP transporter (lazy init) ───────────────────────────

let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (_transporter) return _transporter;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;
  if (!user || !pass) return null;

  _transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: process.env.EMAIL_SECURE === "true",
    auth: { user, pass },
  });
  return _transporter;
}

// ── HTML Template Generator ────────────────────────────────

export function generateNewsletterHtml(options: NewsletterOptions): string {
  const {
    subject,
    preheader,
    tours,
    headerMessage = "感謝您訂閱 PACK&GO 旅行社電子報！以下是我們為您精選的最新行程：",
    footerMessage = "期待與您一起探索世界的美好。",
  } = options;

  const tourCards = tours
    .map((tour) => {
      const highlightItems = tour.highlights
        .slice(0, 3)
        .map((h) => `<li style="margin: 4px 0; color: #374151;">✓ ${escapeHtml(h)}</li>`)
        .join("");

      const priceFormatted = `USD $${tour.price.toLocaleString()} 起`;

      return `
      <!-- Tour Card -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px; border-radius: 12px; overflow: hidden; border: 1px solid #E5E7EB;">
        <tr>
          <td>
            <!-- Tour Image -->
            <img src="${escapeHtml(tour.heroImage)}"
              alt="${escapeHtml(tour.title)}"
              width="600"
              style="display: block; width: 100%; max-width: 600px; height: 280px; object-fit: cover;"
            />
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 24px; background-color: #FFFFFF;">
            <!-- Destination badge -->
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #0D9488; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
              ✈ ${escapeHtml(tour.destination)}
            </p>
            <!-- Title -->
            <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #111827; line-height: 1.3;">
              ${escapeHtml(tour.title)}
            </h2>
            <!-- Duration -->
            <p style="margin: 0 0 12px 0; font-size: 14px; color: #6B7280;">
              🗓 ${escapeHtml(tour.duration)}
            </p>
            <!-- Highlights -->
            ${
              highlightItems
                ? `<ul style="margin: 0 0 16px 0; padding-left: 0; list-style: none; font-size: 14px;">${highlightItems}</ul>`
                : ""
            }
            <!-- Price + CTA row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle;">
                  <span style="font-size: 22px; font-weight: 700; color: #0D9488;">${priceFormatted}</span>
                </td>
                <td style="text-align: right; vertical-align: middle;">
                  <a href="https://packgo.com/tours/${tour.id}"
                    style="display: inline-block; background-color: #0D9488; color: #FFFFFF; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                    了解更多
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <!-- Preheader text (hidden) -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${escapeHtml(preheader)}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;
  </div>

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F3F4F6;">
    <tr>
      <td align="center" style="padding: 32px 16px;">

        <!-- Email container -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="background-color: #0D9488; padding: 24px 32px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #FFFFFF; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                PACK&amp;GO
              </h1>
              <p style="margin: 4px 0 0 0; color: rgba(255,255,255,0.85); font-size: 13px;">
                旅行社 | Travel Agency
              </p>
            </td>
          </tr>

          <!-- Intro message -->
          <tr>
            <td style="background-color: #FFFFFF; padding: 28px 32px 20px 32px;">
              <p style="margin: 0; font-size: 16px; color: #374151; line-height: 1.6;">
                ${escapeHtml(headerMessage)}
              </p>
            </td>
          </tr>

          <!-- Tour Cards -->
          <tr>
            <td style="background-color: #FFFFFF; padding: 0 32px 8px 32px;">
              ${tourCards}
            </td>
          </tr>

          <!-- Footer message -->
          <tr>
            <td style="background-color: #FFFFFF; padding: 8px 32px 24px 32px; border-top: 1px solid #E5E7EB;">
              <p style="margin: 0; font-size: 15px; color: #374151; line-height: 1.6;">
                ${escapeHtml(footerMessage)}
              </p>
              <p style="margin: 12px 0 0 0; font-size: 14px; color: #6B7280;">
                PACK&amp;GO 旅行社團隊 敬上
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #1F2937; padding: 24px 32px; border-radius: 0 0 12px 12px; text-align: center;">
              <p style="margin: 0 0 8px 0; color: #9CA3AF; font-size: 13px; line-height: 1.6;">
                PACK&amp;GO, LLC | 39055 Cedar Blvd #126, Newark, CA 94560<br />
                +1 (510) 634-2307 | <a href="https://packgo.com" style="color: #0D9488; text-decoration: none;">packgo.com</a>
              </p>
              <p style="margin: 12px 0 0 0; font-size: 12px; color: #6B7280;">
                您收到此郵件是因為您訂閱了 PACK&amp;GO 旅行社電子報。<br />
                如不希望繼續收到，請
                <a href="https://packgo.com/unsubscribe?email={{email}}" style="color: #9CA3AF; text-decoration: underline;">
                  取消訂閱
                </a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Batch send (rate-limited) ──────────────────────────────

const RATE_LIMIT_PER_SECOND = 5;
const BATCH_DELAY_MS = 1000;

export async function sendNewsletter(
  options: SendNewsletterOptions
): Promise<SendResult> {
  const { campaignId, subject, htmlContent, subscribers } = options;
  const transporter = getTransporter();

  let sent = 0;
  let failed = 0;

  // Process in batches of RATE_LIMIT_PER_SECOND
  for (let i = 0; i < subscribers.length; i += RATE_LIMIT_PER_SECOND) {
    const batch = subscribers.slice(i, i + RATE_LIMIT_PER_SECOND);

    await Promise.all(
      batch.map(async (email) => {
        try {
          if (!transporter) {
            // No SMTP configured — log as failed
            console.warn(`[EmailMarketing] No SMTP transporter, skipping ${email}`);
            failed++;
            return;
          }

          const personalizedHtml = htmlContent.replace(/\{\{email\}\}/g, email);

          await transporter.sendMail({
            from: `PACK&GO 旅行社 <${process.env.EMAIL_USER || "noreply@packgo.com"}>`,
            to: email,
            subject,
            html: personalizedHtml,
          });

          sent++;
          console.log(`[EmailMarketing] Sent to ${redactEmail(email)} (campaign ${campaignId})`);
        } catch (err) {
          failed++;
          console.error(`[EmailMarketing] Failed to send to ${email}:`, err);
        }
      })
    );

    // Rate limit: wait 1 second between batches (except after last batch)
    if (i + RATE_LIMIT_PER_SECOND < subscribers.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Update campaign stats
  try {
    await updateMarketingCampaign(campaignId, {
      status: "sent",
      sentAt: new Date(),
      recipientCount: sent,
    });
  } catch (err) {
    console.error(`[EmailMarketing] Failed to update campaign ${campaignId}:`, err);
  }

  console.log(`[EmailMarketing] Campaign ${campaignId} complete: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

// ── Helpers ────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
