/**
 * emailTemplateService.ts
 * 統一品牌 Email 模板
 * 所有對外 Email 都透過這個 wrapper 產生 HTML
 */

const BRAND_COLOR = "#0D9488";
const BRAND_NAME = "PACK&GO";
const COMPANY_ADDRESS = "39055 Cedar Blvd #126, Newark, CA 94560";
const COMPANY_PHONE = "+1 (510) 634-2307";
const COMPANY_WEBSITE = "https://packgo-travel.fly.dev";
const CURRENT_YEAR = new Date().getFullYear();

export interface BrandTemplateOptions {
  title: string;
  preheader?: string;
  bodyHtml: string;
  showFooter?: boolean;
}

/**
 * 統一品牌 Email 模板包裝函數
 * 所有對外 Email 都透過這個 wrapper 產生 HTML
 */
export function wrapInBrandTemplate(options: BrandTemplateOptions): string {
  const { title, preheader, bodyHtml, showFooter = true } = options;

  const preheaderHtml = preheader
    ? `<div style="display:none;font-size:1px;color:#fefefe;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${preheader}</div>`
    : "";

  const footerHtml = showFooter
    ? `
    <!-- Footer -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f4f4;border-top:1px solid #e0e0e0;">
      <tr>
        <td style="padding:24px 32px;text-align:center;font-family:Arial,sans-serif;font-size:13px;color:#666666;line-height:1.6;">
          <p style="margin:0 0 8px 0;font-weight:600;color:#333333;">${BRAND_NAME}, LLC</p>
          <p style="margin:0 0 4px 0;">${COMPANY_ADDRESS}</p>
          <p style="margin:0 0 4px 0;">${COMPANY_PHONE}</p>
          <p style="margin:0 0 16px 0;">
            <a href="${COMPANY_WEBSITE}" style="color:${BRAND_COLOR};text-decoration:none;">${COMPANY_WEBSITE}</a>
          </p>
          <p style="margin:0 0 8px 0;color:#999999;font-size:12px;">
            © ${CURRENT_YEAR} ${BRAND_NAME}, LLC. All rights reserved.
          </p>
          <p style="margin:0;font-size:12px;">
            <a href="${COMPANY_WEBSITE}/unsubscribe" style="color:#999999;text-decoration:underline;">取消訂閱 / Unsubscribe</a>
          </p>
        </td>
      </tr>
    </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  ${preheaderHtml}
  
  <!-- Email Wrapper -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f4f4;">
    <tr>
      <td style="padding:24px 16px;">
        
        <!-- Email Container -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:24px 32px;text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align:center;">
                    <span style="font-family:Georgia,serif;font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:2px;">✈ ${BRAND_NAME}</span>
                    <p style="margin:4px 0 0 0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;">讓旅行更美好</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          
          ${footerHtml}
          
        </table>
        <!-- End Email Container -->
        
      </td>
    </tr>
  </table>
  <!-- End Email Wrapper -->
  
</body>
</html>`;
}

/**
 * 常用 Email 元件 helpers
 */
export function emailButton(text: string, url: string, color = BRAND_COLOR): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto;">
    <tr>
      <td style="border-radius:6px;background-color:${color};">
        <a href="${url}" style="display:inline-block;padding:14px 32px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${text}</a>
      </td>
    </tr>
  </table>`;
}

export function emailDivider(): string {
  return `<hr style="border:none;border-top:1px solid #e8e8e8;margin:24px 0;" />`;
}

export function emailInfoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;font-family:Arial,sans-serif;font-size:14px;color:#666666;width:40%;vertical-align:top;">${label}</td>
    <td style="padding:8px 0;font-family:Arial,sans-serif;font-size:14px;color:#333333;font-weight:600;vertical-align:top;">${value}</td>
  </tr>`;
}

export function emailInfoTable(rows: Array<{ label: string; value: string }>): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9f9f9;border-radius:6px;padding:16px;margin:16px 0;">
    <tbody>
      ${rows.map(r => emailInfoRow(r.label, r.value)).join("")}
    </tbody>
  </table>`;
}

export function emailHeading(text: string, level: 1 | 2 | 3 = 2): string {
  const sizes: Record<number, string> = { 1: "24px", 2: "20px", 3: "16px" };
  const margins: Record<number, string> = { 1: "0 0 16px 0", 2: "0 0 12px 0", 3: "0 0 8px 0" };
  return `<p style="font-family:Arial,sans-serif;font-size:${sizes[level]};font-weight:bold;color:#1a1a1a;margin:${margins[level]};">${text}</p>`;
}

export function emailParagraph(text: string, color = "#444444"): string {
  return `<p style="font-family:Arial,sans-serif;font-size:14px;color:${color};line-height:1.7;margin:0 0 12px 0;">${text}</p>`;
}

export function emailHighlightBox(content: string, bgColor = "#f0fdf4", borderColor = BRAND_COLOR): string {
  return `<div style="background-color:${bgColor};border-left:4px solid ${borderColor};padding:16px;border-radius:4px;margin:16px 0;">
    ${content}
  </div>`;
}
