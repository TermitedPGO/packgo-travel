/**
 * posterCompositeService.ts — v78z-z3 Sprint 11 (Image 2.0 Phase A v0).
 *
 * Composites a brand-locked overlay onto an AI-generated background.
 * Pipeline:
 *   gpt-image-2 → background PNG (1024×1820)
 *      ↓
 *   Sharp composite layers:
 *     - Bottom 35% gradient mask (for text legibility)
 *     - PACK&GO logo (top-left)
 *     - Tour title (top, large, white, font-bold serif)
 *     - Departure date + price + duration (mid-bottom, brand teal badge)
 *     - QR code (bottom-right) → packgoplay.com/tours/{id}
 *     - Footer: "PACK&GO Travel · CST #2166984 · packgoplay.com"
 *      ↓
 *   Output PNG → R2 storage → signed URL
 *
 * Why this hybrid:
 *   - AI handles atmospheric variety (every poster looks unique)
 *   - Sharp handles brand-locked elements (logo, prices, QR all pixel-perfect)
 *   - Same background can drive multi-language posters by re-running overlay
 */
import sharp from "sharp";
import QRCode from "qrcode";
import { generateImage } from "../_core/imageGen";
import { storagePut } from "../storage";

export interface PosterOptions {
  /** Tour basics */
  tourId: number;
  tourTitle: string;
  /** "2026-08-15" or formatted "8/15/2026" */
  departureDateStr: string;
  /** "$2,499 USD" or "NT$ 79,900" — already formatted */
  priceStr: string;
  /** "8 days 7 nights" or "8 天 7 夜" — already formatted */
  durationStr: string;
  /** Free-form theme to inject into the AI prompt */
  themePrompt?: string;
  /** Language for overlay text */
  language?: "zh-TW" | "en";
  /** Override quality (default medium). high = ~$0.07/image */
  quality?: "low" | "medium" | "high";
}

export interface PosterResult {
  /** Public signed URL (15 min default) for admin to download/preview */
  posterUrl: string;
  /** R2 storage key */
  storageKey: string;
  /** Estimated AI cost in USD */
  cost: number;
  durationMs: number;
}

const POSTER_W = 1024;
const POSTER_H = 1820;
// PACK&GO brand teal #0D9488
const BRAND_TEAL = "#0D9488";
const BRAND_TEAL_DARK = "#0F766E";

/**
 * Build a structured prompt for gpt-image-2 that biases toward poster
 * aesthetic: cinematic background photo + bottom gradient (so our text
 * overlay reads), no text in the AI image (we add text via Sharp).
 */
function buildPrompt(opts: PosterOptions): string {
  const theme = opts.themePrompt?.trim() || `${opts.tourTitle} travel destination`;
  return [
    `A breathtaking cinematic travel poster background photograph.`,
    `Theme: ${theme}.`,
    `Composition: vertical poster orientation, sweeping landscape with foreground subject and atmospheric depth.`,
    `Quality: editorial National Geographic style, high detail, golden-hour lighting, cinematic color grading.`,
    `Bottom 30% should be slightly darker / more atmospheric (we will overlay branding text there).`,
    `IMPORTANT: NO text, NO writing, NO logos, NO captions visible in the image. Pure photographic scene only.`,
  ].join(" ");
}

/**
 * SVG overlay layer with PACK&GO branding + tour data.
 * Sharp's text rendering needs SVG (not raster text APIs).
 */
function buildOverlaySvg(opts: PosterOptions): string {
  const isEN = opts.language === "en";
  const lblCST = "CST #2166984";
  const lblFooter = isEN
    ? "PACK&GO Travel · packgoplay.com"
    : "PACK&GO 旅行社 · packgoplay.com";
  const lblDate = isEN ? "Departure" : "出發";
  const lblPrice = isEN ? "From" : "起價";
  const lblDuration = isEN ? "Trip length" : "天數";

  // Escape XML-unsafe characters
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  return `<svg width="${POSTER_W}" height="${POSTER_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="60%" stop-color="rgba(0,0,0,0.5)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.85)"/>
    </linearGradient>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0.65)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </linearGradient>
  </defs>

  <!-- Top fade for logo + title legibility -->
  <rect x="0" y="0" width="${POSTER_W}" height="380" fill="url(#topFade)"/>

  <!-- Bottom fade for details + footer legibility -->
  <rect x="0" y="${POSTER_H - 720}" width="${POSTER_W}" height="720" fill="url(#bottomFade)"/>

  <!-- TOP: PACK&GO branding -->
  <text x="60" y="110" font-family="Arial, 'Noto Sans TC', sans-serif" font-size="38" font-weight="900" fill="white" letter-spacing="3">
    PACK&amp;GO
  </text>
  <text x="60" y="148" font-family="Arial, sans-serif" font-size="18" font-weight="500" fill="rgba(255,255,255,0.85)" letter-spacing="2">
    TRAVEL · ${lblCST}
  </text>

  <!-- TOP: Tour title (wraps if long) -->
  <foreignObject x="60" y="200" width="${POSTER_W - 120}" height="240">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: 'Noto Serif TC', Georgia, serif; font-size: 56px; font-weight: 700; color: white; line-height: 1.15; text-shadow: 0 2px 12px rgba(0,0,0,0.6);">
      ${esc(opts.tourTitle)}
    </div>
  </foreignObject>

  <!-- BOTTOM: Detail badges -->
  <g transform="translate(60 ${POSTER_H - 540})">
    <!-- Departure date -->
    <rect x="0" y="0" width="280" height="86" rx="14" fill="${BRAND_TEAL}"/>
    <text x="20" y="32" font-family="Arial, sans-serif" font-size="14" font-weight="600" fill="rgba(255,255,255,0.85)" letter-spacing="2">
      ${esc(lblDate.toUpperCase())}
    </text>
    <text x="20" y="68" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="white">
      ${esc(opts.departureDateStr)}
    </text>

    <!-- Duration -->
    <rect x="300" y="0" width="220" height="86" rx="14" fill="${BRAND_TEAL_DARK}"/>
    <text x="320" y="32" font-family="Arial, sans-serif" font-size="14" font-weight="600" fill="rgba(255,255,255,0.85)" letter-spacing="2">
      ${esc(lblDuration.toUpperCase())}
    </text>
    <text x="320" y="68" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="white">
      ${esc(opts.durationStr)}
    </text>
  </g>

  <!-- BOTTOM: Price (full-width band) -->
  <g transform="translate(60 ${POSTER_H - 410})">
    <text x="0" y="32" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="rgba(255,255,255,0.7)" letter-spacing="3">
      ${esc(lblPrice.toUpperCase())}
    </text>
    <text x="0" y="100" font-family="Arial, sans-serif" font-size="72" font-weight="900" fill="white">
      ${esc(opts.priceStr)}
    </text>
  </g>

  <!-- Footer band -->
  <text x="60" y="${POSTER_H - 80}" font-family="Arial, sans-serif" font-size="22" font-weight="600" fill="white" letter-spacing="1">
    ${esc(lblFooter)}
  </text>
  <text x="60" y="${POSTER_H - 48}" font-family="Arial, sans-serif" font-size="16" font-weight="400" fill="rgba(255,255,255,0.6)">
    ${esc(`packgoplay.com/tours/${opts.tourId}`)}
  </text>
</svg>`;
}

/**
 * Generate a poster end-to-end.
 *
 * Steps:
 *   1. Build prompt
 *   2. Call gpt-image-2 → background PNG
 *   3. Generate QR code → packgoplay.com/tours/{tourId}
 *   4. Sharp composite: background + SVG overlay + QR PNG
 *   5. Upload to R2 with key `posters/{tourId}/{ts}.png`
 *   6. Return signed URL
 */
export async function generatePoster(opts: PosterOptions): Promise<PosterResult> {
  const start = Date.now();

  // 1 + 2: AI background
  const prompt = buildPrompt(opts);
  const aiResult = await generateImage({
    prompt,
    size: "1024x1820",
    quality: opts.quality || "medium",
    timeoutMs: 90_000,
  });

  // 3: QR code
  const qrUrl = `https://packgoplay.com/tours/${opts.tourId}`;
  const qrPngBuffer = await QRCode.toBuffer(qrUrl, {
    type: "png",
    width: 180,
    margin: 1,
    color: { dark: "#0F766E", light: "#FFFFFF" }, // brand teal on white
  });

  // 4: Sharp composite
  const overlaySvg = buildOverlaySvg(opts);
  const composited = await sharp(aiResult.imageBuffer)
    .resize(POSTER_W, POSTER_H, { fit: "cover" }) // ensure exact dims
    .composite([
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
      { input: qrPngBuffer, top: POSTER_H - 220, left: POSTER_W - 220 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();

  // 5: Upload to R2
  const ts = Date.now();
  const storageKey = `posters/${opts.tourId}/${ts}.png`;
  const { url: posterUrl } = await storagePut(storageKey, composited, "image/png");

  return {
    posterUrl,
    storageKey,
    cost: aiResult.cost,
    durationMs: Date.now() - start,
  };
}
