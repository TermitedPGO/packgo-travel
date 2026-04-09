/**
 * visaEmailService.ts
 * 中國簽證代辦 Email 通知服務
 *
 * 發送場景：
 *   1. 申請確認（付款完成後）
 *   2. 狀態更新（每次狀態變更）
 *   3. 審核通過
 *   4. 審核拒絕
 *   5. 完成取件通知
 */

import nodemailer from "nodemailer";

const SMTP_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.EMAIL_PORT || "587");
const SMTP_USER = process.env.EMAIL_USER || "";
const SMTP_PASS = process.env.EMAIL_PASSWORD || "";
const FROM_NAME = "PACK&GO 旅行社 — 中國簽證代辦";
const FROM_EMAIL = SMTP_USER;
const SITE_URL = process.env.SITE_URL || "https://packgo09.manus.space";

function createTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// ── 共用 HTML 模板 ────────────────────────────────────────────
function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #fff; border: 1px solid #e0e0e0; }
    .header { background: #1a1a1a; padding: 32px 40px; }
    .header h1 { margin: 0; color: #fff; font-size: 22px; font-weight: 700; letter-spacing: 1px; }
    .header p { margin: 4px 0 0; color: #999; font-size: 13px; }
    .content { padding: 40px; }
    .content h2 { font-size: 18px; font-weight: 700; margin: 0 0 16px; }
    .content p { font-size: 14px; line-height: 1.8; margin: 0 0 16px; color: #444; }
    .info-table { width: 100%; border-collapse: collapse; margin: 24px 0; }
    .info-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
    .info-table td:first-child { color: #888; width: 40%; }
    .info-table td:last-child { font-weight: 600; color: #1a1a1a; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700; }
    .status-paid { background: #e8f5e9; color: #2e7d32; }
    .status-processing { background: #fff3e0; color: #e65100; }
    .status-approved { background: #e3f2fd; color: #1565c0; }
    .status-rejected { background: #fce4ec; color: #c62828; }
    .status-completed { background: #e8f5e9; color: #2e7d32; }
    .cta-btn { display: inline-block; margin: 24px 0 0; padding: 14px 32px; background: #1a1a1a; color: #fff !important; text-decoration: none; font-size: 14px; font-weight: 700; letter-spacing: 1px; }
    .divider { border: none; border-top: 1px solid #f0f0f0; margin: 32px 0; }
    .footer { background: #f5f5f5; padding: 24px 40px; font-size: 12px; color: #888; }
    .footer a { color: #888; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>PACK&amp;GO 旅行社</h1>
      <p>中國簽證代辦服務</p>
    </div>
    <div class="content">
      ${body}
    </div>
    <div class="footer">
      <p>此郵件由系統自動發送，請勿直接回覆。如有疑問，請聯繫我們：<a href="mailto:${FROM_EMAIL}">${FROM_EMAIL}</a></p>
      <p>© ${new Date().getFullYear()} PACK&amp;GO 旅行社 版權所有</p>
    </div>
  </div>
</body>
</html>`;
}

// ── 1. 申請確認 Email ─────────────────────────────────────────
export async function sendVisaApplicationConfirmation(params: {
  toEmail: string;
  applicantName: string;
  applicationId: number;
  totalAmount: number;
  passportNumber: string;
  travelDate?: string;
}): Promise<void> {
  const { toEmail, applicantName, applicationId, totalAmount, passportNumber, travelDate } = params;
  const statusUrl = `${SITE_URL}/china-visa/status/${applicationId}`;

  const body = `
    <h2>申請確認通知</h2>
    <p>親愛的 ${applicantName} 您好，</p>
    <p>感謝您選擇 PACK&amp;GO 旅行社的中國簽證代辦服務。我們已收到您的申請及付款，以下是您的申請詳情：</p>
    <table class="info-table">
      <tr><td>申請編號</td><td>#${applicationId}</td></tr>
      <tr><td>護照號碼</td><td>${passportNumber}</td></tr>
      ${travelDate ? `<tr><td>預計出行日期</td><td>${travelDate}</td></tr>` : ""}
      <tr><td>費用總計</td><td>USD $${totalAmount.toFixed(2)}</td></tr>
      <tr><td>付款狀態</td><td><span class="status-badge status-paid">已付款</span></td></tr>
    </table>
    <p><strong>下一步：</strong>請將以下文件準備好並郵寄或親送至我們辦公室：</p>
    <ul style="font-size:14px; line-height:2; color:#444; padding-left:20px;">
      <li>有效護照正本（效期需超過 6 個月）</li>
      <li>護照照片頁影本</li>
      <li>近期 2 吋白底彩色照片 2 張（我們可協助拍攝）</li>
      <li>填寫完整的中國簽證申請表（我們將協助代填）</li>
    </ul>
    <p>您可以隨時查詢申請進度：</p>
    <a href="${statusUrl}" class="cta-btn">查詢申請進度</a>
    <hr class="divider" />
    <p style="font-size:13px; color:#888;">如有任何疑問，請聯繫我們的簽證專員。我們將在 1 個工作日內回覆您。</p>
  `;

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: toEmail,
    subject: `【PACK&GO】中國簽證申請確認 #${applicationId}`,
    html: wrapHtml(`申請確認 #${applicationId}`, body),
  });
}

// ── 2. 狀態更新 Email ─────────────────────────────────────────
const STATUS_LABELS: Record<string, { zh: string; badge: string }> = {
  submitted: { zh: "已提交", badge: "status-processing" },
  paid: { zh: "已付款", badge: "status-paid" },
  documents_received: { zh: "文件已收到", badge: "status-processing" },
  processing: { zh: "審核中", badge: "status-processing" },
  approved: { zh: "已核准", badge: "status-approved" },
  rejected: { zh: "已拒絕", badge: "status-rejected" },
  completed: { zh: "已完成", badge: "status-completed" },
  cancelled: { zh: "已取消", badge: "status-rejected" },
};

export async function sendVisaStatusUpdate(params: {
  toEmail: string;
  applicantName: string;
  applicationId: number;
  newStatus: string;
  note?: string;
}): Promise<void> {
  const { toEmail, applicantName, applicationId, newStatus, note } = params;
  const statusInfo = STATUS_LABELS[newStatus] ?? { zh: newStatus, badge: "status-processing" };
  const statusUrl = `${SITE_URL}/china-visa/status/${applicationId}`;

  const body = `
    <h2>申請狀態更新</h2>
    <p>親愛的 ${applicantName} 您好，</p>
    <p>您的中國簽證申請（編號 #${applicationId}）狀態已更新：</p>
    <table class="info-table">
      <tr><td>申請編號</td><td>#${applicationId}</td></tr>
      <tr><td>目前狀態</td><td><span class="status-badge ${statusInfo.badge}">${statusInfo.zh}</span></td></tr>
      ${note ? `<tr><td>備註說明</td><td>${note}</td></tr>` : ""}
    </table>
    <a href="${statusUrl}" class="cta-btn">查詢申請進度</a>
  `;

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: toEmail,
    subject: `【PACK&GO】簽證申請狀態更新 #${applicationId} — ${statusInfo.zh}`,
    html: wrapHtml(`狀態更新 #${applicationId}`, body),
  });
}

// ── 3. 審核通過 Email ─────────────────────────────────────────
export async function sendVisaApprovedEmail(params: {
  toEmail: string;
  applicantName: string;
  applicationId: number;
  trackingNumber?: string;
}): Promise<void> {
  const { toEmail, applicantName, applicationId, trackingNumber } = params;
  const statusUrl = `${SITE_URL}/china-visa/status/${applicationId}`;

  const body = `
    <h2>🎉 恭喜！您的中國簽證已核准</h2>
    <p>親愛的 ${applicantName} 您好，</p>
    <p>我們很高興通知您，您的中國簽證申請已成功核准！</p>
    <table class="info-table">
      <tr><td>申請編號</td><td>#${applicationId}</td></tr>
      <tr><td>申請狀態</td><td><span class="status-badge status-approved">已核准</span></td></tr>
      ${trackingNumber ? `<tr><td>追蹤號碼</td><td>${trackingNumber}</td></tr>` : ""}
    </table>
    <p>您的護照及簽證將以掛號郵件寄回，或您可以親自至我們辦公室取件。請攜帶您的申請確認信。</p>
    <a href="${statusUrl}" class="cta-btn">查看詳細資訊</a>
    <hr class="divider" />
    <p style="font-size:13px; color:#888;">祝您旅途愉快！如需規劃中國行程，歡迎瀏覽我們的旅遊產品。</p>
  `;

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: toEmail,
    subject: `【PACK&GO】🎉 您的中國簽證已核准 #${applicationId}`,
    html: wrapHtml(`簽證核准 #${applicationId}`, body),
  });
}

// ── 4. 審核拒絕 Email ─────────────────────────────────────────
export async function sendVisaRejectedEmail(params: {
  toEmail: string;
  applicantName: string;
  applicationId: number;
  reason?: string;
}): Promise<void> {
  const { toEmail, applicantName, applicationId, reason } = params;

  const body = `
    <h2>簽證申請結果通知</h2>
    <p>親愛的 ${applicantName} 您好，</p>
    <p>很遺憾地通知您，您的中國簽證申請（編號 #${applicationId}）未能獲得核准。</p>
    ${reason ? `<table class="info-table"><tr><td>拒絕原因</td><td>${reason}</td></tr></table>` : ""}
    <p>如您有任何疑問或希望重新申請，請聯繫我們的簽證專員，我們將竭誠協助您。</p>
    <hr class="divider" />
    <p style="font-size:13px; color:#888;">退款將在 5-10 個工作日內退回至您的付款方式。</p>
  `;

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: toEmail,
    subject: `【PACK&GO】簽證申請結果通知 #${applicationId}`,
    html: wrapHtml(`申請結果 #${applicationId}`, body),
  });
}
