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

// PACK&GO brand palette: black + cream + gold (#c9a563).
// We override callers' theme.accent with the brand gold so every PDF feels
// like the same product — different cover heroes are still on-brand.
const DEFAULT_COLOR_THEME = {
  primary: '#0F0F0F',
  secondary: '#FAF8F2',
  accent: '#C9A563',
};

// Escape user-provided strings so titles like "AT&T Park" don't break HTML.
function escapeHtml(s: string | undefined | null): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate HTML template for PDF — v80.23 redesign.
 * Brand identity: cream + gold + serif headlines, generous whitespace.
 * Replaces the old red-accent design that felt cramped.
 */
function generatePdfHtml(data: TourPdfData): string {
  // Always force the brand gold — callers can pass their own colors but we
  // overlay accent so the whole catalog stays visually consistent.
  const theme = {
    primary: data.colorTheme?.primary || DEFAULT_COLOR_THEME.primary,
    secondary: DEFAULT_COLOR_THEME.secondary,
    accent: DEFAULT_COLOR_THEME.accent,
  };
  const destinations = data.destinations.map(escapeHtml).join(' · ');
  const daysNights = data.nights
    ? `${data.days} 天 ${data.nights} 夜`
    : `${data.days} 天`;
  const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  const titleEsc = escapeHtml(data.title);
  const subtitleEsc = escapeHtml(data.subtitle);
  const descEsc = data.description ? escapeHtml(data.description).replace(/\n/g, '<br/>') : '';

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titleEsc} - 行程表</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@500;700;900&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Noto Sans TC', 'Microsoft JhengHei', '微軟正黑體', sans-serif;
      font-size: 10.5pt;
      line-height: 1.75;
      color: #1a1a1a;
      background: white;
    }

    .serif { font-family: 'Noto Serif TC', 'PingFang TC', serif; }

    /* ── Cover Page (cream + gold + photo) ────────────── */
    .cover-page {
      width: 100%;
      min-height: 100vh;
      background: ${theme.secondary};
      color: #1a1a1a;
      display: flex;
      flex-direction: column;
      page-break-after: always;
      position: relative;
      overflow: hidden;
    }

    .cover-rule-top, .cover-rule-bottom {
      height: 3px;
      background: ${theme.accent};
      width: 100%;
    }

    .cover-inner {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 56px 64px 48px;
    }

    .cover-brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 36px;
    }

    .cover-brand {
      font-family: 'Noto Serif TC', serif;
      font-size: 13pt;
      font-weight: 900;
      letter-spacing: 8px;
      color: #1a1a1a;
    }

    .cover-brand-tag {
      font-size: 8.5pt;
      letter-spacing: 3px;
      color: ${theme.accent};
      font-weight: 700;
      text-transform: uppercase;
    }

    .cover-hero-frame {
      width: 100%;
      height: 360px;
      overflow: hidden;
      position: relative;
      margin-bottom: 36px;
    }

    .cover-hero-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .cover-hero-frame::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.12) 100%);
    }

    .cover-tag-line {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
      font-size: 9pt;
      letter-spacing: 4px;
      color: ${theme.accent};
      font-weight: 700;
      text-transform: uppercase;
    }

    .cover-tag-line::before {
      content: "";
      width: 36px;
      height: 1px;
      background: ${theme.accent};
    }

    .cover-title {
      font-family: 'Noto Serif TC', serif;
      font-size: 30pt;
      font-weight: 900;
      color: #0f0f0f;
      line-height: 1.2;
      margin-bottom: 14px;
      letter-spacing: 1px;
    }

    .cover-subtitle {
      font-size: 13pt;
      color: #555;
      line-height: 1.6;
      margin-bottom: 40px;
      font-weight: 400;
    }

    .cover-meta-row {
      display: flex;
      gap: 0;
      flex-wrap: wrap;
      margin-bottom: 48px;
      border-top: 1px solid rgba(0,0,0,0.1);
      border-bottom: 1px solid rgba(0,0,0,0.1);
      padding: 20px 0;
    }

    .cover-meta-item {
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 0 20px;
      border-right: 1px solid rgba(0,0,0,0.1);
      min-width: 130px;
    }

    .cover-meta-item:first-child { padding-left: 0; }
    .cover-meta-item:last-child { border-right: none; }

    .cover-meta-label {
      font-size: 8pt;
      color: #888;
      letter-spacing: 2px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .cover-meta-value {
      font-family: 'Noto Serif TC', serif;
      font-size: 13pt;
      font-weight: 700;
      color: #1a1a1a;
    }

    .cover-meta-value.price { color: ${theme.accent}; }

    .cover-footer {
      margin-top: auto;
      padding-top: 24px;
      border-top: 1px solid rgba(0,0,0,0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8.5pt;
      color: #888;
    }

    /* ── Content Pages ───────────────────────── */
    .page {
      padding: 48px 56px 44px;
      page-break-after: always;
      position: relative;
    }

    .page:last-child { page-break-after: auto; }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding-bottom: 14px;
      margin-bottom: 32px;
      border-bottom: 1px solid #e8e3d6;
    }

    .page-header-brand {
      font-family: 'Noto Serif TC', serif;
      font-size: 10pt;
      font-weight: 900;
      letter-spacing: 5px;
      color: #1a1a1a;
    }

    .page-header-info {
      font-size: 8.5pt;
      color: #999;
      letter-spacing: 1px;
    }

    /* ── Section ─────────────────────────────── */
    .section { margin-bottom: 32px; }

    .section-title {
      font-family: 'Noto Serif TC', serif;
      font-size: 16pt;
      font-weight: 900;
      color: #1a1a1a;
      margin-bottom: 18px;
      padding-bottom: 0;
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .section-title::before {
      content: "";
      width: 28px;
      height: 3px;
      background: ${theme.accent};
      flex-shrink: 0;
    }

    .section-content { padding-left: 0; }

    /* ── Description ─────────────────────────── */
    .description {
      text-align: justify;
      line-height: 1.95;
      color: #333;
      font-size: 10.5pt;
    }

    /* ── Highlights ──────────────────────────── */
    .highlights-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 14px;
    }

    .highlight-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 11px 14px;
      background: ${theme.secondary};
      border-left: 3px solid ${theme.accent};
    }

    .highlight-check {
      color: ${theme.accent};
      font-weight: 700;
      font-size: 12pt;
      flex-shrink: 0;
      line-height: 1.3;
    }

    .highlight-text {
      font-size: 9.5pt;
      line-height: 1.55;
      color: #2a2a2a;
    }

    /* ── Day Block ───────────────────────────── */
    .day-block {
      margin-bottom: 26px;
      page-break-inside: avoid;
      border: 1px solid #e8e3d6;
      overflow: hidden;
    }

    .day-header {
      background: #1a1a1a;
      color: white;
      padding: 14px 18px;
      font-weight: 700;
      font-size: 12pt;
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: 'Noto Serif TC', serif;
      letter-spacing: 0.5px;
    }

    .day-number {
      background: ${theme.accent};
      color: #1a1a1a;
      font-family: 'Noto Sans TC', sans-serif;
      font-size: 9pt;
      font-weight: 900;
      padding: 3px 10px;
      letter-spacing: 2px;
    }

    .day-content {
      border-top: none;
      padding: 18px 20px;
      background: #fefdfa;
    }

    .day-subtitle {
      color: #6a5a35;
      font-size: 10pt;
      margin-bottom: 14px;
      font-style: italic;
      line-height: 1.6;
    }

    .activity {
      margin-bottom: 14px;
      padding-left: 14px;
      border-left: 2px solid ${theme.accent};
    }

    .activity:last-child { margin-bottom: 0; }

    .activity-time {
      font-weight: 700;
      color: ${theme.accent};
      font-size: 9pt;
      letter-spacing: 1px;
    }

    .activity-title {
      font-weight: 600;
      font-size: 11pt;
      margin: 4px 0 4px;
      color: #1a1a1a;
    }

    .activity-description {
      color: #555;
      font-size: 9.5pt;
      line-height: 1.65;
    }

    .activity-location {
      color: #999;
      font-size: 8.5pt;
      margin-top: 3px;
    }

    .day-info {
      display: flex;
      gap: 28px;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px dashed #e0d8c2;
      font-size: 9.5pt;
    }

    .day-info-item { flex: 1; }

    .day-info-label {
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 4px;
      font-size: 9pt;
      letter-spacing: 0.5px;
    }

    .day-info-value { color: #555; line-height: 1.65; }

    /* ── Info Lists ──────────────────────────── */
    .info-list { list-style: none; padding: 0; }

    .info-list li {
      padding: 7px 0 7px 22px;
      position: relative;
      line-height: 1.7;
      font-size: 10pt;
      color: #2a2a2a;
    }

    .info-list li:before {
      content: "✦";
      position: absolute;
      left: 0;
      top: 7px;
      color: ${theme.accent};
      font-weight: 700;
      font-size: 9pt;
    }

    /* ── Two-column layout ───────────────────── */
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 36px;
    }

    /* ── Page Footer ─────────────────────────── */
    .page-footer {
      margin-top: 36px;
      padding-top: 16px;
      border-top: 1px solid #e8e3d6;
      display: flex;
      justify-content: space-between;
      font-size: 8.5pt;
      color: #aaa;
      letter-spacing: 1px;
    }

    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- ══ COVER PAGE ══════════════════════════════════════ -->
  <div class="cover-page">
    <div class="cover-rule-top"></div>
    <div class="cover-inner">
      <div class="cover-brand-row">
        <div class="cover-brand">PACK &amp; GO</div>
        <div class="cover-brand-tag">Curated Travel</div>
      </div>

      ${data.heroImage ? `<div class="cover-hero-frame"><img src="${escapeHtml(data.heroImage)}" alt="${titleEsc}" /></div>` : ''}

      <div class="cover-tag-line">旅遊行程表 · Itinerary</div>
      <h1 class="cover-title">${titleEsc}</h1>
      ${subtitleEsc ? `<div class="cover-subtitle">${subtitleEsc}</div>` : ''}

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
          <span class="cover-meta-value price">${escapeHtml(data.currency || 'NT$')} ${data.price.toLocaleString()}</span>
        </div>` : ''}
      </div>

      <div class="cover-footer">
        <span>PACK&amp;GO 旅行社 · Curated Journeys, Lasting Memories</span>
        <span>製作日期：${today}</span>
      </div>
    </div>
    <div class="cover-rule-bottom"></div>
  </div>

  <!-- ══ PAGE 2: OVERVIEW ════════════════════════════════ -->
  <div class="page">
    <div class="page-header">
      <span class="page-header-brand">PACK &amp; GO</span>
      <span class="page-header-info">${titleEsc} · 行程總覽</span>
    </div>

    ${descEsc ? `
    <div class="section">
      <h2 class="section-title">行程簡介</h2>
      <div class="section-content">
        <p class="description">${descEsc}</p>
      </div>
    </div>` : ''}

    ${data.highlights && data.highlights.length > 0 ? `
    <div class="section">
      <h2 class="section-title">行程亮點</h2>
      <div class="section-content">
        <div class="highlights-grid">
          ${data.highlights.map(h => `
          <div class="highlight-item">
            <span class="highlight-check">✦</span>
            <span class="highlight-text">${escapeHtml(h)}</span>
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
      <span class="page-header-info">${titleEsc} · 每日行程</span>
    </div>
    <div class="section">
      <h2 class="section-title">每日行程</h2>
      <div class="section-content">
        ${data.itinerary.map(day => `
        <div class="day-block">
          <div class="day-header">
            <span class="day-number">DAY ${day.day}</span>
            <span>${escapeHtml(day.title)}</span>
          </div>
          <div class="day-content">
            ${day.subtitle ? `<div class="day-subtitle">${escapeHtml(day.subtitle)}</div>` : ''}

            ${day.activities && day.activities.length > 0 ? `
            <div class="activities">
              ${day.activities.map(act => `
              <div class="activity">
                ${act.time ? `<div class="activity-time">${escapeHtml(act.time)}</div>` : ''}
                <div class="activity-title">${escapeHtml(act.title)}</div>
                ${act.description ? `<div class="activity-description">${escapeHtml(act.description)}</div>` : ''}
                ${act.location ? `<div class="activity-location">📍 ${escapeHtml(act.location)}</div>` : ''}
              </div>`).join('')}
            </div>` : ''}

            ${(day.meals || day.accommodation) ? `
            <div class="day-info">
              ${day.meals ? `
              <div class="day-info-item">
                <div class="day-info-label">🍽 餐食</div>
                <div class="day-info-value">
                  ${day.meals.breakfast ? `早餐：${escapeHtml(day.meals.breakfast)}<br/>` : ''}
                  ${day.meals.lunch ? `午餐：${escapeHtml(day.meals.lunch)}<br/>` : ''}
                  ${day.meals.dinner ? `晚餐：${escapeHtml(day.meals.dinner)}` : ''}
                </div>
              </div>` : ''}
              ${day.accommodation ? `
              <div class="day-info-item">
                <div class="day-info-label">🏨 住宿</div>
                <div class="day-info-value">${escapeHtml(day.accommodation)}</div>
              </div>` : ''}
            </div>` : ''}
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
      <span class="page-header-info">${titleEsc} · 費用說明</span>
    </div>
    <div class="two-col">
      ${data.inclusions && data.inclusions.length > 0 ? `
      <div class="section">
        <h2 class="section-title">費用包含</h2>
        <div class="section-content">
          <ul class="info-list">
            ${data.inclusions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      </div>` : ''}
      ${data.exclusions && data.exclusions.length > 0 ? `
      <div class="section">
        <h2 class="section-title">費用不包含</h2>
        <div class="section-content">
          <ul class="info-list">
            ${data.exclusions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
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
      <span class="page-header-info">${titleEsc} · 注意事項</span>
    </div>
    <div class="section">
      <h2 class="section-title">注意事項</h2>
      <div class="section-content">
        <ul class="info-list">
          ${data.notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
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
