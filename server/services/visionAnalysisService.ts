/**
 * Vision Analysis Service
 * Uses Claude Vision (via invokeLLM) to analyze travel photos.
 * Produces tags, quality score, content type, and match keywords.
 *
 * Cost: ~$0.001/image (Claude Haiku, detail: low)
 */

import { invokeLLM } from "../_core/llm";

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
  try {
    const response = await invokeLLM({
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

    return {
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
  } catch (err) {
    console.warn("[VisionAnalysis] analyzeImage failed, using default:", err);
    return { ...DEFAULT_RESULT };
  }
}
