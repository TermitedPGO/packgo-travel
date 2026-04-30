/**
 * posterCompositeService.ts — v78z-z3 Sprint 11 (Image 2.0 Phase A v1).
 *
 * ChatGPT-in-admin poster composer service. Replaces the v0 templated
 * tour-spotlight approach with a full free-form prompt + iteration model.
 *
 * Pipeline modes:
 *
 *   GENERATE FROM SCRATCH:
 *     prompt → gpt-image-2 generate → (optional Sharp lock layer) → R2 → DB
 *
 *   ITERATE ON EXISTING:
 *     prompt + existing posterIteration → load image from R2 → gpt-image-2
 *       edit → (optional Sharp lock layer) → R2 → DB row with parent link
 *
 *   ITERATE WITH MASK (advanced — UI defers to v1.5):
 *     same as ITERATE but include mask buffer
 *
 * Sharp lock layer (post-AI cleanup):
 *   - When `lockBranding=true`, post-process to ensure
 *     PACK&GO logo + CST # appear EXACTLY in the corners regardless of
 *     what the model rendered. Defaults to true unless caller opts out
 *     for "free-form image gen" use case.
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { generateImage, editImage, type GptImageQuality, type GptImageSize } from "../_core/imageGen";
import { storagePut, storageGet } from "../storage";

const POSTER_W_PORTRAIT = 1024;
const POSTER_H_PORTRAIT = 1792;

// Logo locations to try (build differs between dev and prod)
const LOGO_CANDIDATES = [
  "/app/dist/public/images/logo-bag-white-v3.png",
  "/app/public/images/logo-bag-white-v3.png",
  path.join(process.cwd(), "client/public/images/logo-bag-white-v3.png"),
  path.join(process.cwd(), "public/images/logo-bag-white-v3.png"),
];

const CST_NUMBER = "2166984";

function findLogoPath(): string | null {
  for (const p of LOGO_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

export interface ComposeOptions {
  prompt: string;
  size?: GptImageSize;
  quality?: GptImageQuality;
  /** Apply Sharp post-processing to lock logo + CST # corners. Default true. */
  lockBranding?: boolean;
  /** If iterating: the previous iteration's storage key (we'll load + edit it) */
  baseImageKey?: string;
  /** If iterating with mask: PNG mask buffer (transparent = edit, opaque = preserve) */
  maskBuffer?: Buffer;
}

export interface ComposeResult {
  /** Public signed URL to display the result */
  posterUrl: string;
  /** R2 storage key for persistence */
  storageKey: string;
  /** Estimated AI cost in USD (just the gpt-image-2 call) */
  cost: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Indicates whether we used generate or edit */
  mode: "generate" | "edit";
}

async function applyBrandingLock(aiImageBuf: Buffer, size: GptImageSize): Promise<Buffer> {
  // Decide canvas dims based on size
  const [w, h] = size.split("x").map(Number);

  // Locate the real logo PNG (white version for dark posters)
  const logoPath = findLogoPath();
  const composites: any[] = [];

  if (logoPath) {
    const logoBuf = await sharp(logoPath)
      .resize(160, 160, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    // Top-right corner
    composites.push({ input: logoBuf, top: 30, left: w - 200 });
  }

  // Small CST # strip top-left, helps fix model's number hallucination
  const cstSvg = `<svg width="380" height="40" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="380" height="40" rx="6" fill="rgba(0,0,0,0.55)"/>
    <text x="14" y="27" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="white" letter-spacing="2">PACK&amp;GO TRAVEL · CST #${CST_NUMBER}</text>
  </svg>`;
  composites.push({ input: Buffer.from(cstSvg), top: 50, left: 40 });

  return await sharp(aiImageBuf)
    .resize(w, h, { fit: "cover" })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Run a single compose iteration. Caller is responsible for:
 *   - Generating projectKey (group iterations together)
 *   - Persisting the resulting iteration row (with parent link if applicable)
 */
export async function composePoster(
  opts: ComposeOptions
): Promise<ComposeResult> {
  const size = opts.size || "1024x1792";
  const quality = opts.quality || "medium";
  const t0 = Date.now();

  let aiResult: Awaited<ReturnType<typeof generateImage>>;
  let mode: "generate" | "edit";

  if (opts.baseImageKey) {
    // EDIT mode: load existing image and pass to gpt-image-2 edit endpoint
    mode = "edit";
    const { url } = await storageGet(opts.baseImageKey);
    const baseRes = await fetch(url);
    if (!baseRes.ok) throw new Error(`Failed to fetch base image: ${baseRes.status}`);
    const baseBuf = Buffer.from(await baseRes.arrayBuffer());

    aiResult = await editImage({
      prompt: opts.prompt,
      image: baseBuf,
      mask: opts.maskBuffer,
      size,
      quality,
    });
  } else {
    // GENERATE mode: text → image
    mode = "generate";
    aiResult = await generateImage({
      prompt: opts.prompt,
      size,
      quality,
    });
  }

  // Optional Sharp lock layer (logo + CST #)
  const finalBuf =
    opts.lockBranding === false
      ? await sharp(aiResult.imageBuffer).png({ compressionLevel: 9 }).toBuffer()
      : await applyBrandingLock(aiResult.imageBuffer, size);

  // Upload to R2
  const ts = Date.now();
  const key = `posters/composed-${ts}.png`;
  const { url: posterUrl } = await storagePut(key, finalBuf, "image/png");

  return {
    posterUrl,
    storageKey: key,
    cost: aiResult.cost,
    durationMs: Date.now() - t0,
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    mode,
  };
}
