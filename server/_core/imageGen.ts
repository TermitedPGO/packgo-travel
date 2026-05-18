/**
 * imageGen.ts — v78z-z3 Sprint 11 (Image 2.0 Phase A v1).
 *
 * OpenAI gpt-image-2 wrapper:
 *   - generateImage()       text → image (from-scratch generation)
 *   - editImage()           image (+ optional mask) + prompt → edited image
 *                           For "fix this area" iteration OR "use this
 *                           reference image as the starting point".
 *
 * Phase B (next month) will add: full circuit-breaker / batch / async
 * job queue. For now we keep it synchronous and let the BullMQ trip
 * reminder worker pattern carry over later.
 */
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MODEL_ID = "gpt-image-2";

export type GptImageSize = "1024x1024" | "1024x1792" | "1792x1024" | "2048x2048";
export type GptImageQuality = "low" | "medium" | "high";

export interface GenerateOptions {
  prompt: string;
  size?: GptImageSize;
  quality?: GptImageQuality;
  /** Default 90s for low/medium, 240s for high. */
  timeoutMs?: number;
}

export interface EditOptions {
  prompt: string;
  /** Source image (the one to edit). PNG buffer. */
  image: Buffer;
  /** Optional mask. PNG with transparent areas = "edit here", opaque = "keep". */
  mask?: Buffer;
  size?: GptImageSize;
  quality?: GptImageQuality;
  timeoutMs?: number;
}

export interface GenerateResult {
  imageBuffer: Buffer;
  width: number;
  height: number;
  fileSize: number;
  cost: number; // USD
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/**
 * gpt-image-2 pricing as of 2026 (verify against OpenAI docs at deploy):
 *   - low quality:     $0.011 / 1024x1024
 *   - medium quality:  $0.042 / 1024x1024
 *   - high quality:    $0.167 / 1024x1024
 *   - portrait/landscape (1792 long edge): ~1.7× of square
 *   - 2048x2048: ~2.5× of square
 *
 * This is a coarse estimate to surface "today's spend" UX. Real billing
 * is at OpenAI's end based on token counts.
 */
function estimateCost(size: string, quality: string): number {
  const baseCost: Record<string, number> = {
    low: 0.011,
    medium: 0.042,
    high: 0.167,
  };
  const sizeMultiplier =
    size === "1024x1024" ? 1.0 : size === "2048x2048" ? 2.5 : 1.7;
  return (baseCost[quality] || 0.042) * sizeMultiplier;
}

function parseSize(size: string): { width: number; height: number } {
  const [w, h] = size.split("x").map(Number);
  return { width: w, height: h };
}

function defaultTimeoutFor(quality: GptImageQuality): number {
  return quality === "high" ? 240_000 : 90_000;
}

/**
 * Generate an image from text only (no reference).
 */
export async function generateImage(opts: GenerateOptions): Promise<GenerateResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY env var not set — cannot call gpt-image-2");
  }

  const start = Date.now();
  const size = opts.size || "1024x1024";
  const quality = opts.quality || "medium";

  // Round 80.21 v12: gpt-image-2 doesn't accept `response_format` — it
  // returns b64_json by default. Passing the param triggers
  // `400 Unknown parameter: 'response_format'` from OpenAI.
  const response = (await client.images.generate(
    {
      model: MODEL_ID,
      prompt: opts.prompt,
      size: size as any,
      quality: quality as any,
      n: 1,
    },
    { timeout: opts.timeoutMs || defaultTimeoutFor(quality) }
  )) as any;

  const item = response?.data?.[0];
  if (!item?.b64_json) {
    throw new Error("gpt-image-2 returned no image data — possible content-policy refusal");
  }

  const imageBuffer = Buffer.from(item.b64_json, "base64");
  const { width, height } = parseSize(size);
  const usage = response.usage || {};

  return {
    imageBuffer,
    width,
    height,
    fileSize: imageBuffer.length,
    cost: estimateCost(size, quality),
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    durationMs: Date.now() - start,
  };
}

/**
 * Edit an existing image. Two main use cases:
 *
 *  1. ITERATION ("regenerate with this fix"):
 *     - Pass the previous output as `image`
 *     - No mask
 *     - Prompt describes the desired changes (e.g. "make the logo bigger,
 *       fix the date to 2026/12/19")
 *
 *  2. MASKED EDIT ("change this area only"):
 *     - Pass image
 *     - Pass mask (PNG with transparent = edit, opaque = preserve)
 *     - Prompt describes what should appear in the masked area
 *
 * The OpenAI API takes the image (and optional mask) as multipart files.
 */
export async function editImage(opts: EditOptions): Promise<GenerateResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY env var not set — cannot call gpt-image-2");
  }

  const start = Date.now();
  const size = opts.size || "1024x1024";
  const quality = opts.quality || "medium";

  // OpenAI SDK expects File-like uploads
  const imageFile = await toFile(opts.image, "input.png", { type: "image/png" });
  const maskFile = opts.mask
    ? await toFile(opts.mask, "mask.png", { type: "image/png" })
    : undefined;

  // Round 80.21 v12: gpt-image-2 doesn't accept `response_format`
  // (returns b64_json by default). Same fix as `generate` above.
  const params: any = {
    model: MODEL_ID,
    prompt: opts.prompt,
    image: imageFile,
    size,
    quality,
    n: 1,
  };
  if (maskFile) params.mask = maskFile;

  const response = (await client.images.edit(params, {
    timeout: opts.timeoutMs || defaultTimeoutFor(quality),
  })) as any;

  const item = response?.data?.[0];
  if (!item?.b64_json) {
    throw new Error("gpt-image-2 edit returned no image data");
  }

  const imageBuffer = Buffer.from(item.b64_json, "base64");
  const { width, height } = parseSize(size);
  const usage = response.usage || {};

  return {
    imageBuffer,
    width,
    height,
    fileSize: imageBuffer.length,
    cost: estimateCost(size, quality),
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    durationMs: Date.now() - start,
  };
}
