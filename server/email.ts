import { notifyOwner } from "./_core/notification";
import nodemailer, { type Transporter } from 'nodemailer';
import { wrapInBrandTemplate, emailInfoTable, emailButton, emailHighlightBox } from "./services/emailTemplateService";

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587');
const EMAIL_SECURE = process.env.EMAIL_SECURE === 'true';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER || 'noreply@packgo.com';
const BASE_URL = process.env.BASE_URL || 'https://packgo-travel.fly.dev';

let transporter: Transporter | null = null;

/**
 * Initialize SMTP transporter
 */
function getTransporter(): Transporter | null {
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

/**
 * Email templates and sending logic
 */

interface BookingEmailData {
  to: string; // Customer email address
  customerName: string;
  customerEmail: string;
  bookingId: number;
  tourTitle: string;
  departureDate: string;
  returnDate: string;
  numberOfAdults: number;
  numberOfChildren: number;
  numberOfInfants: number;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
}

/**
 * Send booking confirmation email to customer
 * Uses SMTP to send actual email to customer, with notifyOwner as backup notification
 */
export async function sendBookingConfirmationEmail(data: BookingEmailData) {
  // Always notify owner about new booking
  const emailContent = `
訂單確認通知

客戶姓名：${data.customerName}
客戶信箱：${data.customerEmail}
訂單編號：${data.bookingId}

行程資訊：
- 行程名稱：${data.tourTitle}
- 出發日期：${data.departureDate}
- 回程日期：${data.returnDate}

旅客人數：
- 成人：${data.numberOfAdults} 位
- 兒童：${data.numberOfChildren} 位
- 嬰兒：${data.numberOfInfants} 位

費用資訊：
- 總金額：NT$ ${data.totalPrice.toLocaleString()}
- 訂金：NT$ ${data.depositAmount.toLocaleString()}
- 尾款：NT$ ${data.remainingAmount.toLocaleString()}
  `.trim();

  await notifyOwner({
    title: `新訂單 #${data.bookingId} - ${data.customerName}`,
    content: emailContent,
  });

  // Try to send actual email to customer
  const smtp = getTransporter();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: `"PACK&GO 旅行社" <${EMAIL_FROM}>`,
        to: data.to,
        subject: `訂單確認 #${data.bookingId} - ${data.tourTitle}`,
        html: generateBookingConfirmationHTML(data),
        text: emailContent,
      });
      console.log('[Email] Booking confirmation email sent to:', data.to);
    } catch (error) {
      console.error('[Email] Failed to send booking confirmation email:', error);
    }
  }

  return true;
}

interface PaymentSuccessEmailData {
  customerName: string;
  customerEmail: string;
  bookingId: number;
  tourTitle: string;
  paymentAmount: number;
  paymentType: "deposit" | "balance" | "full";
}

/**
 * Send payment success email to customer
 */
export async function sendPaymentSuccessEmail(data: PaymentSuccessEmailData) {
  const paymentTypeText = {
    deposit: "訂金",
    balance: "尾款",
    full: "全額",
  }[data.paymentType];

  const emailContent = `
付款成功通知

客戶姓名：${data.customerName}
客戶信箱：${data.customerEmail}
訂單編號：${data.bookingId}
行程名稱：${data.tourTitle}

付款資訊：
- 付款類型：${paymentTypeText}
- 付款金額：NT$ ${data.paymentAmount.toLocaleString()}

感謝您的付款，我們將盡快為您安排行程。
  `.trim();

  await notifyOwner({
    title: `付款成功 #${data.bookingId} - ${data.customerName}`,
    content: emailContent,
  });

  // Try to send actual email to customer
  const smtp = getTransporter();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: `"PACK&GO 旅行社" <${EMAIL_FROM}>`,
        to: data.customerEmail,
        subject: `付款成功 #${data.bookingId} - ${data.tourTitle}`,
        html: generatePaymentSuccessHTML(data, paymentTypeText),
        text: emailContent,
      });
      console.log('[Email] Payment success email sent to:', data.customerEmail);
    } catch (error) {
      console.error('[Email] Failed to send payment success email:', error);
    }
  }

  return true;
}

/**
 * Generate HTML email template for payment success
 */
function generatePaymentSuccessHTML(data: PaymentSuccessEmailData, paymentTypeText: string): string {
  const bodyHtml = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:56px;height:56px;background:#22c55e;border-radius:50%;line-height:56px;text-align:center;margin-bottom:12px;">
        <span style="color:#fff;font-size:28px;line-height:56px;">&#10003;</span>
      </div>
      <p style="font-family:Arial,sans-serif;font-size:22px;font-weight:bold;color:#15803d;margin:0;">付款成功！</p>
    </div>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;margin:0 0 16px 0;">親愛的 <strong>${data.customerName}</strong>，</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 16px 0;">您的付款已成功處理，以下是您的付款詳情：</p>
    ${emailInfoTable([
      { label: '訂單編號', value: '#' + data.bookingId },
      { label: '行程名稱', value: data.tourTitle },
      { label: '付款類型', value: paymentTypeText },
      { label: '付款金額', value: 'NT$ ' + data.paymentAmount.toLocaleString() },
    ])}
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;line-height:1.7;margin:0 0 8px 0;">感謝您的付款，我們的專員將盡快與您聯繫，確認行程詳情。</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#444;margin:0;">如有任何問題，請隨時與我們聯繫。</p>
  `;
  return wrapInBrandTemplate({ title: '付款成功', bodyHtml });
}

/**
 * Generate branded HTML email template for booking confirmation (BUG-008)
 */
function generateBookingConfirmationHTML(data: BookingEmailData): string {
  const totalPax = data.numberOfAdults + data.numberOfChildren + data.numberOfInfants;
  const paxParts = [
    data.numberOfAdults > 0 ? `成人 ${data.numberOfAdults} 位` : '',
    data.numberOfChildren > 0 ? `兒童 ${data.numberOfChildren} 位` : '',
    data.numberOfInfants > 0 ? `嬰兒 ${data.numberOfInfants} 位` : '',
  ].filter(Boolean).join('、');

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>訂單確認 - PACK&amp;GO 旅行社</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.12);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a1a 0%,#3a3a3a 100%);padding:36px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:32px;font-weight:900;letter-spacing:4px;">PACK&amp;GO</h1>
            <p style="color:#cccccc;margin:6px 0 0 0;font-size:13px;letter-spacing:2px;">LET'S TRAVEL TOGETHER</p>
          </td>
        </tr>

        <!-- Success Banner -->
        <tr>
          <td style="background-color:#f0fdf4;padding:24px 40px;text-align:center;border-bottom:1px solid #dcfce7;">
            <div style="display:inline-block;width:52px;height:52px;background:#22c55e;border-radius:50%;line-height:52px;text-align:center;margin-bottom:12px;">
              <span style="color:#fff;font-size:26px;line-height:52px;">&#10003;</span>
            </div>
            <h2 style="color:#15803d;margin:0;font-size:22px;font-weight:700;">訂單已確認！</h2>
            <p style="color:#166534;margin:6px 0 0 0;font-size:14px;">感謝您選擇 PACK&amp;GO 旅行社</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 0 40px;">
            <p style="color:#333;font-size:16px;margin:0 0 8px 0;">親愛的 <strong>${data.customerName}</strong>，您好！</p>
            <p style="color:#666;font-size:15px;line-height:1.7;margin:0;">您的行程預訂已成功建立。我們的專員將在 <strong>1-2 個工作日內</strong>與您確認訂單詳情，請注意查收電話及電子郵件。</p>
          </td>
        </tr>

        <!-- Order Summary -->
        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;overflow:hidden;border:1px solid #e9ecef;">
              <tr>
                <td style="background:#1a1a1a;padding:14px 20px;">
                  <p style="color:#fff;margin:0;font-size:13px;font-weight:700;letter-spacing:1px;">訂單詳情</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #e9ecef;">
                        <span style="color:#888;font-size:13px;">訂單編號</span>
                        <span style="color:#333;font-size:13px;font-weight:700;float:right;">#${data.bookingId}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #e9ecef;">
                        <span style="color:#888;font-size:13px;">行程名稱</span>
                        <span style="color:#333;font-size:13px;font-weight:600;float:right;max-width:320px;text-align:right;display:block;">${data.tourTitle}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #e9ecef;">
                        <span style="color:#888;font-size:13px;">出發日期</span>
                        <span style="color:#333;font-size:13px;font-weight:600;float:right;">${data.departureDate}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #e9ecef;">
                        <span style="color:#888;font-size:13px;">回程日期</span>
                        <span style="color:#333;font-size:13px;font-weight:600;float:right;">${data.returnDate}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;">
                        <span style="color:#888;font-size:13px;">旅客人數</span>
                        <span style="color:#333;font-size:13px;font-weight:600;float:right;">${paxParts}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Payment Summary -->
        <tr>
          <td style="padding:0 40px 24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff9f0;border-radius:10px;overflow:hidden;border:1px solid #fed7aa;">
              <tr>
                <td style="background:#ea580c;padding:14px 20px;">
                  <p style="color:#fff;margin:0;font-size:13px;font-weight:700;letter-spacing:1px;">費用明細</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #fed7aa;">
                        <span style="color:#9a3412;font-size:13px;">訂金（須於 3 天內付清）</span>
                        <span style="color:#9a3412;font-size:15px;font-weight:700;float:right;">NT$ ${data.depositAmount.toLocaleString()}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #fed7aa;">
                        <span style="color:#888;font-size:13px;">尾款（出發前 30 天付清）</span>
                        <span style="color:#666;font-size:13px;font-weight:600;float:right;">NT$ ${data.remainingAmount.toLocaleString()}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:12px 0 0 0;">
                        <span style="color:#333;font-size:15px;font-weight:700;">總金額</span>
                        <span style="color:#ea580c;font-size:20px;font-weight:900;float:right;">NT$ ${data.totalPrice.toLocaleString()}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Next Steps -->
        <tr>
          <td style="padding:0 40px 32px 40px;">
            <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:16px 20px;border-radius:0 8px 8px 0;">
              <p style="color:#1e40af;font-size:14px;font-weight:700;margin:0 0 8px 0;">ℹ️ 接下來的步驟</p>
              <ol style="color:#1e40af;font-size:13px;line-height:1.8;margin:0;padding-left:18px;">
                <li>我們的專員將在 1-2 個工作日內以電話或電郵確認訂單</li>
                <li>請於 <strong>3 天內</strong>完成訂金付款，以保際您的座位</li>
                <li>出發前 30 天將收到尾款付款提醒</li>
                <li>出發前 7 天將收到完整行程資料及電子機票</li>
              </ol>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center;">
            <p style="color:#ffffff;margin:0 0 4px 0;font-size:15px;font-weight:700;">PACK&amp;GO 旅行社</p>
            <p style="color:#999;margin:0 0 12px 0;font-size:12px;">Tel: +886-2-1234-5678 &nbsp;|&nbsp; Email: jeffhsieh09@gmail.com</p>
            <p style="color:#666;margin:0;font-size:11px;">&copy; ${new Date().getFullYear()} PACK&amp;GO 旅行社. All rights reserved.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim();
}
