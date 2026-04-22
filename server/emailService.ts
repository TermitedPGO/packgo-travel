import nodemailer, { type Transporter } from 'nodemailer';
import sgMail from '@sendgrid/mail';

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587');
const EMAIL_SECURE = process.env.EMAIL_SECURE === 'true';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER || 'noreply@packgo.com';
const BASE_URL = process.env.BASE_URL || 'https://packgo-travel.fly.dev';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

// Initialize SendGrid if API key is available
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log('[Email] SendGrid initialized');
}

let transporter: Transporter | null = null;

/**
 * Initialize SMTP transporter (fallback)
 */
function getTransporter(): Transporter {
  if (!transporter) {
    if (!EMAIL_USER || !EMAIL_PASSWORD) {
      throw new Error('Email credentials not configured');
    }

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
 * Send password reset email
 * Uses SendGrid if SENDGRID_API_KEY is configured, otherwise falls back to SMTP
 */
export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
  userName?: string
): Promise<boolean> {
  // Use SendGrid if configured
  if (SENDGRID_API_KEY) {
    return sendPasswordResetEmailViaSendGrid(to, resetToken, userName);
  }

  // Fall back to SMTP
  return sendPasswordResetEmailViaSMTP(to, resetToken, userName);
}

/**
 * Send password reset email via SendGrid
 */
async function sendPasswordResetEmailViaSendGrid(
  to: string,
  resetToken: string,
  userName?: string
): Promise<boolean> {
  const resetUrl = `${BASE_URL}/reset-password?token=${resetToken}`;

  const msg = {
    to,
    from: EMAIL_FROM,
    subject: '重設您的密碼 - PACK&GO 旅行社',
    text: `您好 ${userName || '會員'}，\n\n我們收到了重設您密碼的請求。請點擊以下連結重設您的密碼：\n\n${resetUrl}\n\n此連結將在 1 小時後過期。\n\n如果您沒有請求重設密碼，請忽略此郵件。\n\n祝您旅途愉快！\nPACK&GO 旅行社`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>重設密碼</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <tr>
                  <td style="background-color: #000000; padding: 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">PACK&GO</h1>
                    <p style="color: #cccccc; margin: 5px 0 0 0; font-size: 14px;">讓旅行更美好</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 24px;">重設您的密碼</h2>
                    <p style="color: #666666; line-height: 1.6; margin: 0 0 20px 0;">您好 <strong>${userName || '會員'}</strong>，</p>
                    <p style="color: #666666; line-height: 1.6; margin: 0 0 30px 0;">我們收到了重設您密碼的請求。請點擊下方按鈕重設您的密碼：</p>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${resetUrl}" style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 4px; font-weight: bold; font-size: 16px;">重設密碼</a>
                    </div>
                    <p style="color: #999999; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">或複製以下連結到瀏覽器：</p>
                    <p style="color: #0066cc; font-size: 14px; word-break: break-all; margin: 10px 0 20px 0;">${resetUrl}</p>
                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                      <p style="color: #856404; margin: 0; font-size: 14px; line-height: 1.6;">⚠️ <strong>安全提醒：</strong>此連結將在 <strong>1 小時</strong>後過期。如果您沒有請求重設密碼，請忽略此郵件。</p>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f8f8f8; padding: 20px 30px; text-align: center; border-top: 1px solid #eeeeee;">
                    <p style="color: #999999; margin: 0; font-size: 12px;">祝您旅途愉快！</p>
                    <p style="color: #999999; margin: 5px 0 0 0; font-size: 12px;">PACK&GO 旅行社</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log('[Email] Password reset email sent via SendGrid to:', to);
    return true;
  } catch (error: any) {
    console.error('[Email] Failed to send password reset email via SendGrid:', error.message);
    if (error.response) {
      console.error('[Email] SendGrid error details:', error.response.body);
    }
    return false;
  }
}

/**
 * Send password reset email via SMTP
 */
async function sendPasswordResetEmailViaSMTP(
  to: string,
  resetToken: string,
  userName?: string
): Promise<boolean> {
  try {
    const transporter = getTransporter();
    const resetUrl = `${BASE_URL}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"PACK&GO 旅行社" <${EMAIL_FROM}>`,
      to,
      subject: '重設您的密碼 - PACK&GO 旅行社',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>重設密碼</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="background-color: #000000; padding: 30px; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold; letter-spacing: 2px;">PACK&amp;GO</h1>
                      <p style="color: #cccccc; margin: 5px 0 0 0; font-size: 14px;">讓旅行更美好</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 40px 30px;">
                      <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 24px;">重設您的密碼</h2>
                      <p style="color: #666666; line-height: 1.6; margin: 0 0 20px 0;">您好 <strong>${userName || '會員'}</strong>，</p>
                      <p style="color: #666666; line-height: 1.6; margin: 0 0 30px 0;">我們收到了重設您密碼的請求。請點擊下方按鈕重設您的密碼：</p>
                      <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetUrl}" style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 4px; font-weight: bold; font-size: 18px;">重設密碼</a>
                      </div>
                      <p style="color: #999999; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">或複製以下連結到瀏覽器：</p>
                      <p style="color: #0066cc; font-size: 13px; word-break: break-all; margin: 10px 0 20px 0; background-color: #f8f8f8; padding: 12px; border-radius: 4px;">${resetUrl}</p>
                      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0;">
                        <p style="color: #856404; margin: 0; font-size: 14px; line-height: 1.8;">⚠️ <strong>安全提醒：</strong></p>
                        <ul style="color: #856404; margin: 8px 0 0 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
                          <li>此連結將在 <strong>1 小時後</strong>失效</li>
                          <li>如果您沒有請求重設密碼，請忽略此郵件</li>
                          <li>請勿將此連結分享給他人</li>
                        </ul>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #f8f8f8; padding: 24px 30px; text-align: center; border-top: 1px solid #eeeeee;">
                      <p style="color: #666666; margin: 0 0 8px 0; font-size: 14px;">需要協助？請聯絡我們的客服團隊</p>
                      <p style="color: #0066cc; margin: 0 0 8px 0; font-size: 14px;">
                        <a href="tel:+15106342307" style="color: #0066cc; text-decoration: none;">+1 (510) 634-2307</a>
                        &nbsp;｜&nbsp;
                        <a href="mailto:Jeffhsieh09@gmail.com" style="color: #0066cc; text-decoration: none;">Jeffhsieh09@gmail.com</a>
                      </p>
                      <p style="color: #999999; margin: 12px 0 0 0; font-size: 12px;">© ${new Date().getFullYear()} PACK&amp;GO 旅行社. All rights reserved.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
親愛的 ${userName || '會員'}，

我們收到了您的密碼重設請求。請複製以下連結至瀏覽器重設您的密碼：

${resetUrl}

安全提醒：
- 此連結將在 1 小時後失效
- 如果您沒有請求重設密碼，請忽略此郵件
- 請勿將此連結分享給他人

需要協助？請聯絡客服：+1 (510) 634-2307 | Jeffhsieh09@gmail.com

© ${new Date().getFullYear()} PACK&GO 旅行社. All rights reserved.
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('[Email] Password reset email sent via SMTP to:', to);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send password reset email via SMTP:', error);
    return false;
  }
}

/**
 * Send welcome email
 * Uses SendGrid if SENDGRID_API_KEY is configured, otherwise falls back to SMTP
 */
export async function sendWelcomeEmail(
  to: string,
  userName: string
): Promise<boolean> {
  // Use SendGrid if configured
  if (SENDGRID_API_KEY) {
    return sendWelcomeEmailViaSendGrid(to, userName);
  }

  // Fall back to SMTP
  return sendWelcomeEmailViaSMTP(to, userName);
}

/**
 * Send welcome email via SendGrid
 */
async function sendWelcomeEmailViaSendGrid(
  to: string,
  userName: string
): Promise<boolean> {
  const msg = {
    to,
    from: EMAIL_FROM,
    subject: '歡迎加入 PACK&GO 旅行社！',
    text: `您好 ${userName}，\n\n歡迎加入 PACK&GO 旅行社！\n\n我們很高興您選擇與我們一起探索世界。現在您可以：\n\n- 瀏覽我們精選的旅遊行程\n- 預訂您夢想中的旅程\n- 享受專屬會員優惠\n\n如有任何問題，請隨時聯絡我們。\n\n祝您旅途愉快！\nPACK&GO 旅行社`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>歡迎加入</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <tr>
                  <td style="background-color: #000000; padding: 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">PACK&GO</h1>
                    <p style="color: #cccccc; margin: 5px 0 0 0; font-size: 14px;">讓旅行更美好</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 24px;">歡迎加入！</h2>
                    <p style="color: #666666; line-height: 1.6; margin: 0 0 20px 0;">您好 <strong>${userName}</strong>，</p>
                    <p style="color: #666666; line-height: 1.6; margin: 0 0 30px 0;">歡迎加入 PACK&GO 旅行社！我們很高興您選擇與我們一起探索世界。</p>
                    <div style="background-color: #f8f9fa; border-radius: 4px; padding: 20px; margin: 20px 0;">
                      <p style="color: #333333; margin: 0 0 15px 0; font-weight: bold;">現在您可以：</p>
                      <ul style="color: #666666; margin: 0; padding-left: 20px; line-height: 1.8;">
                        <li>瀏覽我們精選的旅遊行程</li>
                        <li>預訂您夢想中的旅程</li>
                        <li>享受專屬會員優惠</li>
                      </ul>
                    </div>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${BASE_URL}" style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 4px; font-weight: bold; font-size: 16px;">開始探索</a>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f8f8f8; padding: 20px 30px; text-align: center; border-top: 1px solid #eeeeee;">
                    <p style="color: #999999; margin: 0; font-size: 12px;">如有任何問題，請隨時聯絡我們。</p>
                    <p style="color: #999999; margin: 5px 0 0 0; font-size: 12px;">祝您旅途愉快！PACK&GO 旅行社</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log('[Email] Welcome email sent via SendGrid to:', to);
    return true;
  } catch (error: any) {
    console.error('[Email] Failed to send welcome email via SendGrid:', error.message);
    if (error.response) {
      console.error('[Email] SendGrid error details:', error.response.body);
    }
    return false;
  }
}

/**
 * Send welcome email via SMTP
 */
async function sendWelcomeEmailViaSMTP(
  to: string,
  userName: string
): Promise<boolean> {
  try {
    const transporter = getTransporter();

    const mailOptions = {
      from: `"PACK&GO 旅行社" <${EMAIL_FROM}>`,
      to,
      subject: '歡迎加入 PACK&GO 旅行社！',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #000;
              color: #fff;
              padding: 20px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .content {
              background-color: #f9f9f9;
              padding: 30px;
              border-radius: 0 0 8px 8px;
            }
            .button {
              display: inline-block;
              background-color: #000;
              color: #fff;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 25px;
              margin: 20px 0;
              font-weight: bold;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #ddd;
              font-size: 12px;
              color: #666;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>歡迎加入 PACK&GO！</h1>
          </div>
          <div class="content">
            <h2>親愛的 ${userName}，</h2>
            <p>感謝您註冊 PACK&GO 旅行社會員！</p>
            <p>我們提供多樣化的旅遊服務，包括：</p>
            <ul>
              <li>精選團體旅遊行程</li>
              <li>客製化旅遊規劃</li>
              <li>簽證代辦服務</li>
              <li>機票預訂與機場接送</li>
              <li>飯店預訂服務</li>
            </ul>
            <p>現在就開始探索您的下一趟旅程吧！</p>
            <div style="text-align: center;">
              <a href="${BASE_URL}" class="button">開始探索</a>
            </div>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} PACK&GO 旅行社. All rights reserved.</p>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('[Email] Welcome email sent via SMTP to:', to);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send welcome email via SMTP:', error);
    return false;
  }
}

/**
 * Send newsletter subscription confirmation email
 */
export async function sendNewsletterConfirmationEmail(to: string): Promise<boolean> {
  const subject = '感謝訂閱 PACK&GO 旅行社電子報！';
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #000; color: #fff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">PACK&amp;GO</h1>
        <p style="color: #ccc; margin: 5px 0 0; font-size: 13px;">讓旅行更美好</p>
      </div>
      <div style="padding: 30px; background-color: #f9f9f9;">
        <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 16px;">感謝您訂閱我們的電子報！</h2>
        <p style="color: #555; font-size: 15px; line-height: 1.7;">
          您已成功訂閱 PACK&amp;GO 旅行社電子報。我們會定期為您發送最新旅遊資訊、特惠行程與旅遊小知識。
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${BASE_URL}" style="display: inline-block; background-color: #000; color: #fff; text-decoration: none; padding: 12px 32px; font-weight: bold; font-size: 15px;">瀏覽行程</a>
        </div>
        <p style="color: #888; font-size: 13px; line-height: 1.6;">
          如需取消訂閱，請回覆此郵件或聯繫我們的客服團隊。
        </p>
      </div>
      <div style="padding: 16px; text-align: center; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; margin: 0;">PACK&amp;GO 旅行社 | 讓每一次旅行都成為難忘的回憶</p>
      </div>
    </div>
  `;

  if (SENDGRID_API_KEY) {
    try {
      await sgMail.send({ to, from: EMAIL_FROM, subject, html: htmlContent });
      return true;
    } catch (error) {
      console.error('[Email] Failed to send newsletter confirmation via SendGrid:', error);
    }
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({ from: `"PACK&GO 旅行社" <${EMAIL_FROM}>`, to, subject, html: htmlContent });
    return true;
  } catch (error) {
    console.error('[Email] Failed to send newsletter confirmation via SMTP:', error);
    return false;
  }
}

/**
 * Test email configuration
 */
export async function testEmailConfiguration(): Promise<boolean> {
  // Test SendGrid if configured
  if (SENDGRID_API_KEY) {
    console.log('[Email] SendGrid is configured');
    return true;
  }

  // Test SMTP if configured
  try {
    const transporter = getTransporter();
    await transporter.verify();
    console.log('[Email] SMTP configuration is valid');
    return true;
  } catch (error) {
    console.error('[Email] Email configuration test failed:', error);
    return false;
  }
}
