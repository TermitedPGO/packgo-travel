/**
 * PACK&GO skill PDF renderer.
 *
 * Wraps Puppeteer + system Chromium (same path the existing pdfGenerator.ts
 * uses) to convert skill HTML → A4 PDF. One launcher serves all 4 skills:
 *   - packgo-quote → renderQuotePdf
 *   - packgo-flight-ticket → renderFlightTicketPdf (next round)
 *   - packgo-deposit-receipt → renderDepositReceiptPdf (next round)
 *
 * The Docker image already has /usr/bin/chromium + fonts-noto-cjk so this
 * works in prod without any extra image deps.
 */

import puppeteer, { type Browser, type Page } from "puppeteer-core";

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";

// Logo base64 strings are inlined in logoConstants.ts (ES-module bundled
// code has no __dirname + Dockerfile doesn't copy server/services assets).
export { LOGO_NAVY_B64, LOGO_WHITE_B64 } from "./logoConstants";

/**
 * Render any HTML to an A4 PDF buffer. Used by all skill renderers.
 *
 * @param html Fully self-contained HTML (CSS inlined, images base64)
 * @param options Optional margin / format overrides
 */
export async function renderHtmlToPdf(
  html: string,
  options: {
    format?: "A4" | "Letter";
    margin?: { top?: string; right?: string; bottom?: string; left?: string };
  } = {}
): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    });

    const page: Page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754 });

    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });

    // Wait for fonts so CJK characters don't render in fallback face
    await page.evaluateHandle("document.fonts.ready");

    const pdf = await page.pdf({
      format: options.format ?? "A4",
      printBackground: true,
      margin: options.margin ?? {
        top: "0mm",
        right: "0mm",
        bottom: "0mm",
        left: "0mm",
      },
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}

/** Escape user-provided strings before injecting into HTML. */
export function escapeHtml(s: string | number | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format number with thousands separators. */
export function fmtNum(n: number | string): string {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString("en-US");
}
