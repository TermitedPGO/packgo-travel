// PDF generation using Puppeteer
// Generates tour itinerary PDFs from HTML templates

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { storagePut } from './storage';

/**
 * Path to the system Chromium binary. Matches the pattern used by
 * dynamicScraperService / competitorScraperService / posterGeneratorService
 * — the Dockerfile installs /usr/bin/chromium and sets CHROMIUM_PATH at
 * runtime. Without this, puppeteer.launch() tries to use the bundled
 * Chromium which is skipped in CI (PUPPETEER_SKIP_DOWNLOAD=true), so PDF
 * generation silently fails in production.
 */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

export interface TourPdfData {
  id: number;
  title: string;
  subtitle?: string;
  days: number;
  nights?: number;
  destinations: string[];
  price?: number;
  currency?: string;
  heroImage?: string;
  description?: string;
  highlights?: string[];
  itinerary?: Array<{
    day: number;
    title: string;
    subtitle?: string;
    activities?: Array<{
      time?: string;
      title: string;
      description?: string;
      location?: string;
    }>;
    meals?: {
      breakfast?: string;
      lunch?: string;
      dinner?: string;
    };
    accommodation?: string;
  }>;
  inclusions?: string[];
  exclusions?: string[];
  notes?: string[];
  colorTheme?: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

const DEFAULT_COLOR_THEME = {
  primary: '#1A1A1A',
  secondary: '#F5F5F5',
  accent: '#C0392B',
};

/**
 * Generate HTML template for PDF
 */
function generatePdfHtml(data: TourPdfData): string {
  const theme = data.colorTheme || DEFAULT_COLOR_THEME;
  const destinations = data.destinations.join(' · ');
  const daysNights = data.nights
    ? `${data.days} 天 ${data.nights} 夜`
    : `${data.days} 天`;
  const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.title} - 行程表</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Noto Sans TC', 'Microsoft JhengHei', '微軟正黑體', sans-serif;
      font-size: 10.5pt;
      line-height: 1.7;
      color: #1a1a1a;
      background: white;
    }

    /* ── Cover Page ─────────────────────────── */
    .cover-page {
      width: 100%;
      min-height: 100vh;
      background: #111;
      color: white;
      display: flex;
      flex-direction: column;
      page-break-after: always;
      position: relative;
      overflow: hidden;
    }

    .cover-accent-bar {
      height: 5px;
      background: ${theme.accent};
      width: 100%;
    }

    .cover-inner {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 48px 56px;
    }

    .cover-brand {
      font-size: 11pt;
      font-weight: 700;
      letter-spacing: 5px;
      color: rgba(255,255,255,0.9);
      margin-bottom: 48px;
    }

    .cover-hero-image {
      width: 100%;
      height: 320px;
      object-fit: cover;
      margin-bottom: 40px;
    }

    .cover-tag {
      display: inline-block;
      background: ${theme.accent};
      color: white;
      font-size: 8.5pt;
      font-weight: 700;
      letter-spacing: 2px;
      padding: 4px 12px;
      margin-bottom: 16px;
    }

    .cover-title {
      font-size: 26pt;
      font-weight: 700;
      color: #fff;
      line-height: 1.25;
      margin-bottom: 12px;
    }

    .cover-subtitle {
      font-size: 13pt;
      color: rgba(255,255,255,0.65);
      margin-bottom: 36px;
    }

    .cover-meta-row {
      display: flex;
      gap: 40px;
      flex-wrap: wrap;
      margin-bottom: 48px;
    }

    .cover-meta-item { display: flex; flex-direction: column; gap: 3px; }

    .cover-meta-label {
      font-size: 7.5pt;
      color: rgba(255,255,255,0.45);
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    .cover-meta-value {
      font-size: 12pt;
      font-weight: 600;
      color: #fff;
    }

    .cover-footer {
      border-top: 1px solid rgba(255,255,255,0.12);
      padding-top: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8.5pt;
      color: rgba(255,255,255,0.35);
    }

    /* ── Content Pages ───────────────────────── */
    .page {
      padding: 36px 50px 40px;
      page-break-after: always;
    }

    .page:last-child { page-break-after: auto; }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      margin-bottom: 28px;
      border-bottom: 2px solid #1a1a1a;
    }

    .page-header-brand {
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 3px;
      color: #1a1a1a;
    }

    .page-header-info {
      font-size: 8pt;
      color: #888;
    }

    /* ── Section ─────────────────────────────── */
    .section { margin-bottom: 28px; }

    .section-title {
      font-size: 14pt;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 14px;
      padding-bottom: 7px;
      border-bottom: 2px solid ${theme.accent};
    }

    .section-content { padding-left: 2px; }

    /* ── Description ─────────────────────────── */
    .description {
      text-align: justify;
      line-height: 1.9;
      color: #444;
    }

    /* ── Hero Image ──────────────────────────── */
    .hero-image {
      width: 100%;
      height: 260px;
      object-fit: cover;
      margin-bottom: 24px;
    }

    /* ── Highlights ──────────────────────────── */
    .highlights-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .highlight-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 9px 12px;
      background: #f8f8f8;
      border-left: 3px solid ${theme.accent};
    }

    .highlight-check {
      color: ${theme.accent};
      font-weight: 700;
      font-size: 11pt;
      flex-shrink: 0;
    }

    .highlight-text {
      font-size: 9.5pt;
      line-height: 1.5;
      color: #333;
    }

    /* ── Day Block ───────────────────────────── */
    .day-block {
      margin-bottom: 22px;
      page-break-inside: avoid;
    }

    .day-header {
      background: #1a1a1a;
      color: white;
      padding: 10px 16px;
      font-weight: 700;
      font-size: 12pt;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .day-number {
      background: ${theme.accent};
      color: white;
      font-size: 9pt;
      font-weight: 700;
      padding: 2px 8px;
      letter-spacing: 1px;
    }

    .day-content {
      border: 1px solid #ddd;
      border-top: none;
      padding: 14px 16px;
    }

    .day-subtitle {
      color: #666;
      font-size: 10pt;
      margin-bottom: 12px;
      font-style: italic;
    }

    .activity {
      margin-bottom: 12px;
      padding-left: 14px;
      border-left: 2px solid ${theme.accent};
    }

    .activity-time {
      font-weight: 700;
      color: ${theme.accent};
      font-size: 9pt;
    }

    .activity-title {
      font-weight: 600;
      font-size: 11pt;
      margin: 3px 0;
    }

    .activity-description {
      color: #555;
      font-size: 9.5pt;
      line-height: 1.5;
    }

    .activity-location {
      color: #999;
      font-size: 8.5pt;
      margin-top: 2px;
    }

    .day-info {
      display: flex;
      gap: 24px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px dashed #e0e0e0;
      font-size: 9.5pt;
    }

    .day-info-item { flex: 1; }

    .day-info-label {
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 3px;
      font-size: 9pt;
    }

    .day-info-value { color: #555; }

    /* ── Info Lists ──────────────────────────── */
    .info-list { list-style: none; padding: 0; }

    .info-list li {
      padding: 5px 0 5px 18px;
      position: relative;
      line-height: 1.6;
      font-size: 10pt;
    }

    .info-list li:before {
      content: "▸";
      position: absolute;
      left: 0;
      color: ${theme.accent};
      font-weight: 700;
    }

    /* ── Two-column layout ───────────────────── */
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
    }

    /* ── Page Footer ─────────────────────────── */
    .page-footer {
      margin-top: 32px;
      padding-top: 14px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #aaa;
    }

    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- ══ COVER PAGE ══════════════════════════════════════ -->
  <div class="cover-page">
    <div class="cover-accent-bar"></div>
    <div class="cover-inner">
      <div class="cover-brand">PACK &amp; GO</div>

      ${data.heroImage ? `<img src="${data.heroImage}" alt="${data.title}" class="cover-hero-image" />` : ''}

      <div class="cover-tag">旅遊行程表</div>
      <h1 class="cover-title">${data.title}</h1>
      ${data.subtitle ? `<div class="cover-subtitle">${data.subtitle}</div>` : ''}

      <div class="cover-meta-row">
        <div class="cover-meta-item">
          <span class="cover-meta-label">目的地</span>
          <span class="cover-meta-value">${destinations}</span>
        </div>
        <div class="cover-meta-item">
          <span class="cover-meta-label">天數</span>
          <span class="cover-meta-value">${daysNights}</span>
        </div>
        ${data.price ? `
        <div class="cover-meta-item">
          <span class="cover-meta-label">參考價格</span>
          <span class="cover-meta-value">${data.currency || 'NT$'} ${data.price.toLocaleString()}</span>
        </div>` : ''}
      </div>

      <div class="cover-footer">
        <span>PACK&amp;GO 旅行社 · 讓每一次旅行都成為難忘的回憶</span>
        <span>製作日期：${today}</span>
      </div>
    </div>
  </div>

  <!-- ══ PAGE 2: OVERVIEW ════════════════════════════════ -->
  <div class="page">
    <div class="page-header">
      <span class="page-header-brand">PACK &amp; GO</span>
      <span class="page-header-info">${data.title} · 行程總覽</span>
    </div>

    ${data.description ? `
    <div class="section">
      <h2 class="section-title">行程簡介</h2>
      <div class="section-content">
        <p class="description">${data.description}</p>
      </div>
    </div>` : ''}

    ${data.highlights && data.highlights.length > 0 ? `
    <div class="section">
      <h2 class="section-title">行程亮點</h2>
      <div class="section-content">
        <div class="highlights-grid">
          ${data.highlights.map(h => `
          <div class="highlight-item">
            <span class="highlight-check">✓</span>
            <span class="highlight-text">${h}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>` : ''}

    <div class="page-footer">
      <span>PACK&amp;GO 旅行社</span>
      <span>${today}</span>
    </div>
  </div>

  <!-- ══ PAGE 3+: DAILY ITINERARY ═══════════════════════ -->
  ${data.itinerary && data.itinerary.length > 0 ? `
  <div class="page">
    <div class="page-header">
      <span class="page-header-brand">PACK &amp; GO</span>
      <span class="page-header-info">${data.title} · 每日行程</span>
    </div>
    <div class="section">
      <h2 class="section-title">每日行程</h2>
      <div class="section-content">
        ${data.itinerary.map(day => `
        <div class="day-block">
          <div class="day-header">
            <span class="day-number">DAY ${day.day}</span>
            ${day.title}
          </div>
          <div class="day-content">
            ${day.subtitle ? `<div class="day-subtitle">${day.subtitle}</div>` : ''}

            ${day.activities && day.activities.length > 0 ? `
            <div class="activities">
              ${day.activities.map(act => `
              <div class="activity">
                ${act.time ? `<div class="activity-time">${act.time}</div>` : ''}
                <div class="activity-title">${act.title}</div>
                ${act.description ? `<div class="activity-description">${act.description}</div>` : ''}
                ${act.location ? `<div class="activity-location">📍 ${act.location}</div>` : ''}
              </div>`).join('')}
            </div>` : ''}

            <div class="day-info">
              ${day.meals ? `
              <div class="day-info-item">
                <div class="day-info-label">🍽 餐食</div>
                <div class="day-info-value">
                  ${day.meals.breakfast ? `早餐：${day.meals.breakfast}<br/>` : ''}
                  ${day.meals.lunch ? `午餐：${day.meals.lunch}<br/>` : ''}
                  ${day.meals.dinner ? `晚餐：${day.meals.dinner}` : ''}
                </div>
              </div>` : ''}
              ${day.accommodation ? `
              <div class="day-info-item">
                <div class="day-info-label">🏨 住宿</div>
                <div class="day-info-value">${day.accommodation}</div>
              </div>` : ''}
            </div>
          </div>
        </div>`).join('')}
      </div>
    </div>
    <div class="page-footer">
      <span>PACK&amp;GO 旅行社</span>
      <span>${today}</span>
    </div>
  </div>` : ''}

  <!-- ══ PAGE N: INCLUSIONS & EXCLUSIONS ════════════════ -->
  ${(data.inclusions && data.inclusions.length > 0) || (data.exclusions && data.exclusions.length > 0) ? `
  <div class="page">
    <div class="page-header">
      <span class="page-header-brand">PACK &amp; GO</span>
      <span class="page-header-info">${data.title} · 費用說明</span>
    </div>
    <div class="two-col">
      ${data.inclusions && data.inclusions.length > 0 ? `
      <div class="section">
        <h2 class="section-title">費用包含</h2>
        <div class="section-content">
          <ul class="info-list">
            ${data.inclusions.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
      </div>` : ''}
      ${data.exclusions && data.exclusions.length > 0 ? `
      <div class="section">
        <h2 class="section-title">費用不包含</h2>
        <div class="section-content">
          <ul class="info-list">
            ${data.exclusions.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
      </div>` : ''}
    </div>
    <div class="page-footer">
      <span>PACK&amp;GO 旅行社</span>
      <span>${today}</span>
    </div>
  </div>` : ''}

  <!-- ══ PAGE N+1: NOTES ════════════════════════════════ -->
  ${data.notes && data.notes.length > 0 ? `
  <div class="page">
    <div class="page-header">
      <span class="page-header-brand">PACK &amp; GO</span>
      <span class="page-header-info">${data.title} · 注意事項</span>
    </div>
    <div class="section">
      <h2 class="section-title">注意事項</h2>
      <div class="section-content">
        <ul class="info-list">
          ${data.notes.map(note => `<li>${note}</li>`).join('')}
        </ul>
      </div>
    </div>
    <div class="page-footer">
      <span>PACK&amp;GO 旅行社 · 如有任何疑問，請聯繫我們的客服團隊</span>
      <span>${today}</span>
    </div>
  </div>` : ''}

</body>
</html>
  `;
}

/**
 * Generate PDF from tour data
 * @param data - Tour data
 * @returns Buffer containing the PDF
 */
export async function generateTourPdf(data: TourPdfData): Promise<Buffer> {
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });

    const page: Page = await browser.newPage();

    await page.setViewport({ width: 1240, height: 1754 });

    const html = generatePdfHtml(data);

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for fonts to load
    await page.evaluateHandle('document.fonts.ready');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error('[PDF Generator] Error generating PDF:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Generate PDF and upload to S3
 * @param data - Tour data
 * @param storageKey - S3 storage key (e.g., "tours/123/itinerary.pdf")
 * @returns URL of the uploaded PDF
 */
export async function generateAndUploadTourPdf(
  data: TourPdfData,
  storageKey: string
): Promise<string> {
  console.log(`[PDF Generator] Generating PDF for tour ${data.id}...`);

  const startTime = Date.now();
  const pdfBuffer = await generateTourPdf(data);
  const duration = Date.now() - startTime;

  console.log(`[PDF Generator] PDF generated in ${duration}ms, size: ${pdfBuffer.length} bytes`);

  const { url } = await storagePut(storageKey, pdfBuffer, 'application/pdf');

  console.log(`[PDF Generator] PDF uploaded to: ${url}`);

  return url;
}
