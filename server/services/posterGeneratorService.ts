/**
 * posterGeneratorService.ts
 * 行程海報生成服務 — 使用 Puppeteer 渲染 HTML 截圖，支援三種尺寸
 * landscape: 1200×630 (FB/OG), square: 1080×1080 (IG), story: 1080×1920 (IG/LINE 限動)
 */

import puppeteer from "puppeteer";
import { storagePut } from "../storage";

// ── Types ──────────────────────────────────────────────────

export type PosterFormat = "landscape" | "square" | "story";

export interface PosterOptions {
  tourId: number;
  format: PosterFormat;
  heroImageUrl: string;
  title: string;
  destination: string;
  duration: string;
  price: string;
  highlights?: string[];
  overlayColor?: string;
  textColor?: string;
}

export interface PosterResult {
  buffer: Buffer;
  format: PosterFormat;
  width: number;
  height: number;
  s3Url: string;
}

// ── Dimensions ─────────────────────────────────────────────

const DIMENSIONS: Record<PosterFormat, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

// ── HTML Builder ───────────────────────────────────────────

export function buildPosterHtml(options: PosterOptions & { width: number; height: number }): string {
  const {
    heroImageUrl,
    title,
    destination,
    duration,
    price,
    highlights = [],
    overlayColor = "rgba(13, 148, 136, 0.82)",
    textColor = "#FFFFFF",
    width,
    height,
    format,
  } = options;

  // Adaptive font sizes based on format
  const titleSize = format === "story" ? 52 : format === "square" ? 44 : 40;
  const subtitleSize = format === "story" ? 28 : 22;
  const priceSize = format === "story" ? 38 : 30;
  const highlightSize = format === "story" ? 22 : 18;
  const logoSize = format === "story" ? 28 : 22;

  const highlightItems = highlights
    .slice(0, 3)
    .map(
      (h) =>
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="color:#0D9488;font-size:${highlightSize + 4}px;">✓</span>
          <span style="font-size:${highlightSize}px;color:rgba(255,255,255,0.92);">${escapeHtml(h)}</span>
        </div>`
    )
    .join("");

  // Gradient position based on format
  const gradientStart = format === "story" ? "50%" : "40%";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    font-family: 'Noto Serif TC', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', serif;
    position: relative;
    background: #000;
  }
  .bg-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(1px) brightness(0.85);
  }
  .gradient-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      rgba(0,0,0,0.05) 0%,
      rgba(0,0,0,0) ${gradientStart},
      rgba(0,0,0,0.75) 100%
    );
  }
  .content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: ${format === "story" ? "48px 48px" : "32px 40px"};
    color: ${textColor};
  }
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(13, 148, 136, 0.9);
    padding: 8px 16px;
    border-radius: 8px;
    align-self: flex-start;
  }
  .logo-text {
    font-size: ${logoSize}px;
    font-weight: 700;
    color: #FFFFFF;
    letter-spacing: 1px;
  }
  .bottom-section {
    display: flex;
    flex-direction: column;
    gap: ${format === "story" ? "20px" : "14px"};
  }
  .destination-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255,255,255,0.15);
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255,255,255,0.3);
    padding: 6px 14px;
    border-radius: 20px;
    font-size: ${subtitleSize - 2}px;
    color: rgba(255,255,255,0.95);
    align-self: flex-start;
  }
  .title {
    font-size: ${titleSize}px;
    font-weight: 700;
    line-height: 1.25;
    color: #FFFFFF;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
    max-width: 90%;
  }
  .duration {
    font-size: ${subtitleSize}px;
    color: rgba(255,255,255,0.85);
  }
  .highlights-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .price-badge {
    display: inline-flex;
    align-items: center;
    background: ${overlayColor};
    padding: 10px 20px;
    border-radius: 8px;
    align-self: flex-start;
  }
  .price-text {
    font-size: ${priceSize}px;
    font-weight: 700;
    color: #FFFFFF;
  }
  .cta-text {
    font-size: ${subtitleSize - 2}px;
    color: rgba(255,255,255,0.8);
    margin-top: 8px;
  }
</style>
</head>
<body>
  <!-- Background image -->
  <img class="bg-image" src="${heroImageUrl}" alt="" crossorigin="anonymous" />
  <!-- Gradient overlay -->
  <div class="gradient-overlay"></div>
  <!-- Content -->
  <div class="content">
    <!-- Top: Logo -->
    <div class="logo">
      <span class="logo-text">PACK&amp;GO</span>
    </div>

    <!-- Bottom: Tour info -->
    <div class="bottom-section">
      <!-- Destination badge -->
      <div class="destination-badge">
        ✈ ${escapeHtml(destination)}
      </div>

      <!-- Title -->
      <div class="title">${escapeHtml(title)}</div>

      <!-- Duration -->
      <div class="duration">🗓 ${escapeHtml(duration)}</div>

      <!-- Highlights -->
      ${highlightItems ? `<div class="highlights-section">${highlightItems}</div>` : ""}

      <!-- Price -->
      <div>
        <div class="price-badge">
          <span class="price-text">${escapeHtml(price)}</span>
        </div>
        <div class="cta-text">立即報名 · packgo.com</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── Main generator ─────────────────────────────────────────

export async function generatePoster(options: PosterOptions): Promise<PosterResult> {
  const { format, tourId } = options;
  const { width, height } = DIMENSIONS[format];

  const html = buildPosterHtml({ ...options, width, height });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    // Wait a bit for fonts and images to load
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const screenshotBuffer = await page.screenshot({ type: "png" });
    const buffer = Buffer.from(screenshotBuffer);

    // Upload to S3
    const suffix = Math.random().toString(36).slice(2, 8);
    const s3Key = `posters/tour-${tourId}-${format}-${suffix}.png`;
    const { url: s3Url } = await storagePut(s3Key, buffer, "image/png");

    return { buffer, format, width, height, s3Url };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// ── Generate all formats ───────────────────────────────────

export async function generateAllFormats(
  options: Omit<PosterOptions, "format">
): Promise<Record<PosterFormat, PosterResult>> {
  const formats: PosterFormat[] = ["landscape", "square", "story"];
  const results = await Promise.all(
    formats.map((format) => generatePoster({ ...options, format }))
  );

  return {
    landscape: results[0],
    square: results[1],
    story: results[2],
  };
}

// ── Helper ─────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
