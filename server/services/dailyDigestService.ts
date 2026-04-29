/**
 * dailyDigestService.ts — v78m Sprint 5A: morning ops digest email.
 *
 * Every morning at 09:00 Taipei time, Jeff receives ONE email summarizing:
 *   1. Actions awaiting his decision (WeChat drafts ready, new quotes to follow-up,
 *      new inquiries, post-trip reviews that didn't go out)
 *   2. Past 24h activity stats (new quotes, new bookings, revenue)
 *   3. System health (Stripe reconciliation warnings, R2 storage status)
 *
 * Replaces the habit of checking the admin dashboard every morning.
 * Single source of truth for "what does Jeff need to do today".
 */

import { getDb } from "../db";
import {
  aiQuotes,
  wechatMessages,
  bookings,
  inquiries,
  payments,
} from "../../drizzle/schema";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import nodemailer, { type Transporter } from "nodemailer";
import { wrapInBrandTemplate, emailButton } from "./emailTemplateService";
import { runReconciliation } from "./reconciliationService";

// SMTP — same env vars as server/email.ts
const EMAIL_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || "587");
const EMAIL_SECURE = process.env.EMAIL_SECURE === "true";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER || "noreply@packgo.com";
const BASE_URL = process.env.BASE_URL || "https://packgo-travel.fly.dev";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "jeffhsieh09@gmail.com";

let _transporter: Transporter | null = null;
function smtp(): Transporter | null {
  if (!_transporter && EMAIL_USER && EMAIL_PASSWORD) {
    _transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_SECURE,
      auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
    });
  }
  return _transporter;
}

export interface DigestData {
  // Time window
  windowStart: Date;
  windowEnd: Date;
  // Actions to take
  pendingWechat: Array<{ id: number; from: string; preview: string; confidence: number }>;
  newQuotesToFollowUp: Array<{ id: number; quoteNumber: string; customerName: string | null; summary: string }>;
  newInquiries: number;
  // Activity
  newQuotesCount: number;
  newBookingsCount: number;
  revenue24h: number; // USD-equivalent
  // System
  reconciliationDiscrepancies: number;
  reconciliationWarnings: string[];
}

/**
 * Build the digest snapshot.
 */
export async function buildDailyDigest(): Promise<DigestData | null> {
  const db = await getDb();
  if (!db) return null;

  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Pending WeChat drafts
  const pendingWechatRows = await db
    .select({
      id: wechatMessages.id,
      from: wechatMessages.fromDisplayName,
      preview: wechatMessages.inboundText,
      confidence: wechatMessages.aiConfidence,
    })
    .from(wechatMessages)
    .where(eq(wechatMessages.status, "ready_review" as any))
    .orderBy(desc(wechatMessages.receivedAt))
    .limit(10);

  // New quotes (still in 'generated' status, < 7 days old)
  const newQuotesRows = await db
    .select({
      id: aiQuotes.id,
      quoteNumber: aiQuotes.quoteNumber,
      customerName: aiQuotes.customerName,
      extractedParams: aiQuotes.extractedParams,
      createdAt: aiQuotes.createdAt,
    })
    .from(aiQuotes)
    .where(
      and(
        eq(aiQuotes.status, "generated" as any),
        gte(aiQuotes.createdAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))
      )
    )
    .orderBy(desc(aiQuotes.createdAt))
    .limit(10);

  // Past 24h: new quotes count, new bookings count
  const [{ count: newQuotesCount24h }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(aiQuotes)
    .where(gte(aiQuotes.createdAt, windowStart));

  const [{ count: newBookingsCount24h }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(bookings)
    .where(gte(bookings.createdAt, windowStart));

  // Revenue past 24h (paid payments only)
  const paidPayments = await db
    .select({
      amount: payments.amount,
      currency: payments.currency,
    })
    .from(payments)
    .where(
      and(
        eq(payments.paymentStatus, "completed" as any),
        gte(payments.paidAt, windowStart)
      )
    );
  // Sum USD; treat TWD≈USD/30 if mixed for digest purposes only
  let revenue24h = 0;
  for (const p of paidPayments) {
    const amt = Number(p.amount) || 0;
    const cur = (p.currency || "USD").toUpperCase();
    revenue24h += cur === "TWD" ? amt / 30 : amt;
  }

  // New inquiries past 24h
  const [{ count: newInquiriesCount }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(inquiries)
    .where(
      and(eq(inquiries.status, "new" as any), gte(inquiries.createdAt, windowStart))
    );

  // Reconciliation for current month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let reconciliationDiscrepancies = 0;
  let reconciliationWarnings: string[] = [];
  try {
    const reconcile = await runReconciliation(monthStart, now);
    reconciliationDiscrepancies = (reconcile.discrepancies || []).filter(
      (d) => d.severity === "high" || d.severity === "medium"
    ).length;
    reconciliationWarnings = reconcile.warnings || [];
  } catch (err) {
    reconciliationWarnings.push(
      `Reconciliation failed: ${(err as Error).message?.slice(0, 100)}`
    );
  }

  return {
    windowStart,
    windowEnd: now,
    pendingWechat: pendingWechatRows.map((r) => ({
      id: r.id,
      from: r.from || "Unknown",
      preview: (r.preview || "").slice(0, 80),
      confidence: Number(r.confidence) || 0,
    })),
    newQuotesToFollowUp: newQuotesRows.map((r) => {
      let summary = "";
      try {
        const p = r.extractedParams ? JSON.parse(r.extractedParams) : {};
        summary = [
          p.destinationCountry || p.destinationCity,
          p.days ? `${p.days}天` : null,
          p.adults ? `${p.adults}大${p.children ? `${p.children}小` : ""}` : null,
          p.budgetMax ? `預算 ${p.currency || "USD"} ${p.budgetMax}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
      } catch {}
      return {
        id: r.id,
        quoteNumber: r.quoteNumber,
        customerName: r.customerName,
        summary: summary || "—",
      };
    }),
    newInquiries: Number(newInquiriesCount) || 0,
    newQuotesCount: Number(newQuotesCount24h) || 0,
    newBookingsCount: Number(newBookingsCount24h) || 0,
    revenue24h,
    reconciliationDiscrepancies,
    reconciliationWarnings,
  };
}

/**
 * Render and send the digest email.
 */
export async function sendDailyDigestEmail(
  digest: DigestData,
  recipient: string = OWNER_EMAIL
): Promise<boolean> {
  const transporter = smtp();
  if (!transporter) {
    console.warn("[DailyDigest] SMTP not configured — skipping send");
    return false;
  }

  const dateStr = new Date().toLocaleDateString("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Taipei",
  });
  const totalActions =
    digest.pendingWechat.length + digest.newQuotesToFollowUp.length + digest.newInquiries;

  const subject = `[PACK&GO 早報] ${dateStr} — ${totalActions} 件待處理`;

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(n);

  // Plain text
  const textParts: string[] = [];
  textParts.push(`PACK&GO 早報 — ${dateStr}`);
  textParts.push(`================================`);
  textParts.push("");

  if (digest.pendingWechat.length > 0) {
    textParts.push(`🔴 待 approve（WeChat 草稿）${digest.pendingWechat.length} 則：`);
    for (const m of digest.pendingWechat.slice(0, 5)) {
      textParts.push(
        `   • ${m.from}（信心 ${Math.round(m.confidence * 100)}%）：${m.preview}`
      );
    }
    if (digest.pendingWechat.length > 5)
      textParts.push(`   …還有 ${digest.pendingWechat.length - 5} 則`);
    textParts.push(`   → ${BASE_URL}/admin（WeChat 助手 tab）`);
    textParts.push("");
  }

  if (digest.newQuotesToFollowUp.length > 0) {
    textParts.push(`📋 待跟進報價 ${digest.newQuotesToFollowUp.length} 張：`);
    for (const q of digest.newQuotesToFollowUp.slice(0, 5)) {
      textParts.push(`   • ${q.quoteNumber} — ${q.customerName || "匿名"}：${q.summary}`);
    }
    if (digest.newQuotesToFollowUp.length > 5)
      textParts.push(`   …還有 ${digest.newQuotesToFollowUp.length - 5} 張`);
    textParts.push(`   → ${BASE_URL}/admin（AI 報價單 tab）`);
    textParts.push("");
  }

  if (digest.newInquiries > 0) {
    textParts.push(`✉️ 新客戶詢問 ${digest.newInquiries} 則`);
    textParts.push(`   → ${BASE_URL}/admin（客戶詢問 tab）`);
    textParts.push("");
  }

  textParts.push(`📊 過去 24 小時：`);
  textParts.push(`   • ${digest.newQuotesCount} 個新報價`);
  textParts.push(`   • ${digest.newBookingsCount} 筆新訂單`);
  textParts.push(`   • 收入 ${fmtMoney(digest.revenue24h)}（折換 USD）`);
  textParts.push("");

  if (digest.reconciliationDiscrepancies > 0 || digest.reconciliationWarnings.length > 0) {
    textParts.push(`⚠️ 系統警告：`);
    if (digest.reconciliationDiscrepancies > 0)
      textParts.push(`   • 對帳發現 ${digest.reconciliationDiscrepancies} 筆異常`);
    for (const w of digest.reconciliationWarnings.slice(0, 3)) {
      textParts.push(`   • ${w}`);
    }
    textParts.push("");
  }

  if (totalActions === 0) {
    textParts.push("✅ 所有事項已處理完畢，AI 正在處理其餘訊息。");
    textParts.push("");
  }

  textParts.push(`---`);
  textParts.push(`管理後台：${BASE_URL}/admin`);
  textParts.push(`PACK&GO Travel · CST #2166984`);

  // HTML
  const htmlBody = `
    <h2 style="margin: 0 0 8px 0; color: #0d9488;">PACK&GO 早報</h2>
    <p style="margin: 0 0 24px 0; color: #6b7280; font-size: 14px;">${dateStr} · ${totalActions} 件待處理</p>

    ${
      digest.pendingWechat.length > 0
        ? `
    <h3 style="color: #047857; margin-top: 24px;">🟢 WeChat 草稿等您 approve（${digest.pendingWechat.length}）</h3>
    <ul style="padding-left: 20px; color: #374151; line-height: 1.8;">
      ${digest.pendingWechat
        .slice(0, 5)
        .map(
          (m) =>
            `<li><strong>${escapeHtml(m.from)}</strong>（信心 ${Math.round(
              m.confidence * 100
            )}%）：${escapeHtml(m.preview)}</li>`
        )
        .join("")}
      ${
        digest.pendingWechat.length > 5
          ? `<li style="color: #6b7280;">…還有 ${digest.pendingWechat.length - 5} 則</li>`
          : ""
      }
    </ul>
    <div style="margin: 12px 0 24px 0;">${emailButton(
      "前往 WeChat 助手",
      `${BASE_URL}/admin`
    )}</div>
    `
        : ""
    }

    ${
      digest.newQuotesToFollowUp.length > 0
        ? `
    <h3 style="color: #1e40af; margin-top: 24px;">🔵 待跟進報價（${digest.newQuotesToFollowUp.length}）</h3>
    <ul style="padding-left: 20px; color: #374151; line-height: 1.8;">
      ${digest.newQuotesToFollowUp
        .slice(0, 5)
        .map(
          (q) =>
            `<li><span style="font-family: monospace; font-size: 13px;">${escapeHtml(
              q.quoteNumber
            )}</span> — ${escapeHtml(q.customerName || "匿名")}：${escapeHtml(q.summary)}</li>`
        )
        .join("")}
      ${
        digest.newQuotesToFollowUp.length > 5
          ? `<li style="color: #6b7280;">…還有 ${digest.newQuotesToFollowUp.length - 5} 張</li>`
          : ""
      }
    </ul>
    <div style="margin: 12px 0 24px 0;">${emailButton(
      "前往 AI 報價單",
      `${BASE_URL}/admin`
    )}</div>
    `
        : ""
    }

    ${
      digest.newInquiries > 0
        ? `
    <h3 style="color: #b45309; margin-top: 24px;">🟡 新客戶詢問（${digest.newInquiries}）</h3>
    <div style="margin: 12px 0 24px 0;">${emailButton(
      "前往客戶詢問",
      `${BASE_URL}/admin`
    )}</div>
    `
        : ""
    }

    <h3 style="margin-top: 24px;">📊 過去 24 小時統計</h3>
    <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
      <tr>
        <td style="padding: 12px; background: #f9fafb; border-radius: 8px; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: bold; color: #111827;">${digest.newQuotesCount}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">新報價</div>
        </td>
        <td style="padding: 12px; text-align: center; width: 1%;"></td>
        <td style="padding: 12px; background: #f9fafb; border-radius: 8px; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: bold; color: #111827;">${digest.newBookingsCount}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">新訂單</div>
        </td>
        <td style="padding: 12px; text-align: center; width: 1%;"></td>
        <td style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: bold; color: #047857;">${fmtMoney(digest.revenue24h)}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">收入（USD）</div>
        </td>
      </tr>
    </table>

    ${
      digest.reconciliationDiscrepancies > 0 || digest.reconciliationWarnings.length > 0
        ? `
    <h3 style="color: #b91c1c; margin-top: 24px;">⚠️ 系統警告</h3>
    <ul style="padding-left: 20px; color: #374151; line-height: 1.8;">
      ${
        digest.reconciliationDiscrepancies > 0
          ? `<li>對帳發現 <strong>${digest.reconciliationDiscrepancies}</strong> 筆異常</li>`
          : ""
      }
      ${digest.reconciliationWarnings
        .slice(0, 3)
        .map((w) => `<li>${escapeHtml(w)}</li>`)
        .join("")}
    </ul>
    `
        : ""
    }

    ${
      totalActions === 0
        ? `
    <div style="margin-top: 24px; padding: 16px; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 4px;">
      <strong style="color: #047857;">所有事項已處理完畢</strong>
      <p style="margin: 4px 0 0 0; color: #374151; font-size: 14px;">AI 正在處理其餘訊息。</p>
    </div>
    `
        : ""
    }

    <p style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;">
      管理後台：<a href="${BASE_URL}/admin" style="color: #0d9488;">${BASE_URL}/admin</a><br>
      此信由 PACK&GO 早報自動寄送，每天台北時間 09:00。如要修改請於後台設定。
    </p>
  `;

  try {
    await transporter.sendMail({
      from: `"PACK&GO 早報" <${EMAIL_FROM}>`,
      to: recipient,
      subject,
      text: textParts.join("\n"),
      html: wrapInBrandTemplate(htmlBody),
    });
    console.log(`[DailyDigest] Sent to ${recipient}: ${totalActions} actions, ${digest.newQuotesCount} quotes, ${digest.newBookingsCount} bookings`);
    return true;
  } catch (err) {
    console.error("[DailyDigest] Send failed:", err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convenience: build + send in one call.
 */
export async function runDailyDigestJob(): Promise<{ sent: boolean; data: DigestData | null }> {
  const digest = await buildDailyDigest();
  if (!digest) return { sent: false, data: null };
  const sent = await sendDailyDigestEmail(digest);
  return { sent, data: digest };
}
