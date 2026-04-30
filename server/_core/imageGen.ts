/**
 * imageGen.ts — v78z-z3 Sprint 11 (Image 2.0 Phase A v0).
 *
 * Lean wrapper around OpenAI gpt-image-2. Just enough surface for the
 * poster generator MVP. NOT the full IMAGE-2.0-SPEC.md circuit-breaker /
 * budget table / batch / mask flow — that's Phase B (next month).
 *
 * Inputs:  prompt + size + quality
 * Outputs: PNG buffer + cost ($USD)
 */
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MODEL_ID = "gpt-image-2";

export interface GenerateOptions {
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024" | "2048x2048";
  quality?: "low" | "medium" | "high";
  /** Default 60s; set higher for high-quality requests. */
  timeoutMs?: number;
}

export interface GenerateResult {
  imageBuffer: Buffer;
  width: number;
  height: number;
  fileSize: number;
  cost: number; // USD
  durationMs: number;
}

/**
 * gpt-image-2 pricing as of 2026 (confirm against OpenAI docs at deploy):
 *   - low quality:     $0.011 / image (1024x1024)
 *   - medium quality:  $0.042 / image (1024x1024)
 *   - high quality:    $0.167 / image (1024x1024)
 *   - portrait/landscape (1820 long edge): ~1.7× of square
 *
 * We charge per output token internally; this is a coarse estimate to
 * surface "today's spend" UX without exact token math.
 */
function estimateCost(size: string, quality: string): number {
  const baseCost: Record<string, number> = {
    low: 0.011,
    medium: 0.042,
    high: 0.167,
  };
  const sizeMultiplier = size === "1024x1024" ? 1.0 : size === "2048x2048" ? 2.5 : 1.7;
  return (baseCost[quality] || 0.042) * sizeMultiplier;
}

function parseSize(size: string): { width: number; height: number } {
  const [w, h] = size.split("x").map(Number);
  return { width: w, height: h };
}

/**
 * Generate an image from a text prompt.
 *
 * Throws on:
 *   - missing API key (env)
 *   - OpenAI API errors (timeout, rate limit, content policy violation)
 *   - empty/malformed response
 *
 * Returns a PNG buffer and cost estimate. Caller should:
 *   1. Persist to S3/R2 with sensible cache-control headers
 *   2. Log the cost to your spend tracker
 */
export async function generateImage(opts: GenerateOptions): Promise<GenerateResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY env var not set — cannot call gpt-image-2");
  }

  const start = Date.now();
  const size = opts.size || "1024x1024";
  const quality = opts.quality || "medium";

  // OpenAI SDK call — note: gpt-image-2 SDK signature may evolve; we cast
  // to `any` on params it doesn't yet type to avoid blocking on SDK lag.
  const response = (await client.images.generate(
    {
      model: MODEL_ID,
      prompt: opts.prompt,
      size: size as any,
      quality: quality as any,
      n: 1,
      response_format: "b64_json" as any,
    },
    { timeout: opts.timeoutMs || 90_000 } // 90s default — gpt-image-2 can be slow
  )) as any;

  const item = response?.data?.[0];
  if (!item?.b64_json) {
    throw new Error("gpt-image-2 returned no image data — possible content-policy refusal");
  }

  const imageBuffer = Buffer.from(item.b64_json, "base64");
  const { width, height } = parseSize(size);

  return {
    imageBuffer,
    width,
    height,
    fileSize: imageBuffer.length,
    cost: estimateCost(size, quality),
    durationMs: Date.now() - start,
  };
}
