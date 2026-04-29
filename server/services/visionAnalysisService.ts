/**
 * Vision Analysis Service
 * Uses Claude Vision (via invokeLLM) to analyze travel photos.
 * Produces tags, quality score, content type, and match keywords.
 *
 * Cost: ~$0.001/image (Claude Haiku, detail: low)
 *
 * v67: added URL-based Redis cache. Vision results don't change for the same
 * image URL — caching for 7 days avoids re-analyzing the same photo every time
 * a tour is regenerated.
 */

import { createHash } from "crypto";
import { invokeLLM } from "../_core/llm";
import { redis } from "../redis";

// v67: cache vision results by image URL hash for 7 days. Same photo on
// regen of the same tour → instant cache hit, zero LLM tokens.
const VISION_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
let _visionCacheAvailable = true;

function visionCacheKey(imageUrl: string): string {
  return `vision:v1:${createHash("sha256").update(imageUrl).digest("hex").slice(0, 32)}`;
}

async function getCachedVision(imageUrl: string): Promise<VisionAnalysisResult | null> {
  if (!_visionCacheAvailable) return null;
  try {
    const raw = await redis.get(visionCacheKey(imageUrl));
    if (raw) {
      console.log(`[VisionCache] HIT ${imageUrl.slice(0, 60)}`);
      return JSON.parse(raw) as VisionAnalysisResult;
    }
  } catch (err: any) {
    console.warn("[VisionCache] read error, disabling:", err?.message);
    _visionCacheAvailable = false;
  }
  return null;
}

async function setCachedVision(imageUrl: string, result: VisionAnalysisResult): Promise<void> {
  if (!_visionCacheAvailable) return;
  try {
    await redis.setex(
      visionCacheKey(imageUrl),
      VISION_CACHE_TTL_SECONDS,
      JSON.stringify(result)
    );
  } catch (err: any) {
    console.warn("[VisionCache] write error:", err?.message);
  }
}

export interface VisionAnalysisResult {
  description: string;       // One-sentence description
  tags: string[];             // 5-10 tags (attraction name, category, style)
  contentType:
    | "landscape"
    | "hotel"
    | "food"
    | "activity"
    | "transport"
    | "people"
    | "other";
  qualityScore: number;       // 0-100 (clarity + composition + relevance)
  matchKeywords: string[];    // Possible matching attraction or hotel names
}

const DEFAULT_RESULT: VisionAnalysisResult = {
  description: "Travel photo",
  tags: ["travel"],
  contentType: "other",
  qualityScore: 50,
  matchKeywords: [],
};

/**
 * Extract JSON from a string that may contain markdown code fences.
 */
function extractJson(raw: string): string {
  // Try to strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find first { ... } block
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];

  return raw.trim();
}

/**
 * Analyze a travel image using Claude Vision.
 * Returns a VisionAnalysisResult; never throws – falls back to DEFAULT_RESULT.
 */
export async function analyzeImage(imageUrl: string): Promise<VisionAnalysisResult> {
  // v67: short-circuit on cache hit. Same image URL → same result; 7-day TTL.
  // For a tour regen with N reused images, this saves N × ~600 tokens of vision input.
  const cached = await getCachedVision(imageUrl);
  if (cached) return cached;

  try {
    // v67: was defaulting to Sonnet on every image. Vision tagging is a
    // structured task — Haiku 4.5 supports vision and is fine here.
    // Per-tour ~5-10 images × Haiku is dramatically cheaper than Sonnet.
    const response = await invokeLLM({
      model: "claude-haiku-4-5-20251001",
      maxTokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: "low" }, // low = fewer tokens
            } as any,
            {
              type: "text",
              text: `Analyze this travel photo. Return JSON only (no markdown):
{
  "description": "one sentence describing what is shown",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "contentType": "landscape|hotel|food|activity|transport|people|other",
  "qualityScore": 0-100,
  "matchKeywords": ["possible matching attraction or hotel name"]
}
Only return valid JSON, no markdown, no explanation.`,
            },
          ],
        },
      ],
    } as any);

    const rawContent =
      (response as any)?.choices?.[0]?.message?.content ?? "";
    const jsonStr = extractJson(typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent));

    const parsed = JSON.parse(jsonStr) as Partial<VisionAnalysisResult>;

    // Validate and normalise fields
    const contentTypeOptions = [
      "landscape",
      "hotel",
      "food",
      "activity",
      "transport",
      "people",
      "other",
    ] as const;

    const contentType: VisionAnalysisResult["contentType"] =
      contentTypeOptions.includes(parsed.contentType as any)
        ? (parsed.contentType as VisionAnalysisResult["contentType"])
        : "other";

    const result: VisionAnalysisResult = {
      description:
        typeof parsed.description === "string" && parsed.description
          ? parsed.description
          : DEFAULT_RESULT.description,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : DEFAULT_RESULT.tags,
      contentType,
      qualityScore:
        typeof parsed.qualityScore === "number"
          ? Math.min(100, Math.max(0, parsed.qualityScore))
          : DEFAULT_RESULT.qualityScore,
      matchKeywords: Array.isArray(parsed.matchKeywords)
        ? parsed.matchKeywords.map(String)
        : DEFAULT_RESULT.matchKeywords,
    };
    // v67: persist vision result so subsequent requests for the same image URL
    // (regen, retry, refresh) are free. Don't await — fire-and-forget.
    setCachedVision(imageUrl, result).catch(() => { /* silent */ });
    return result;
  } catch (err) {
    console.warn("[VisionAnalysis] analyzeImage failed, using default:", err);
    return { ...DEFAULT_RESULT };
  }
}
