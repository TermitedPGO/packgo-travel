/**
 * marketingCopyService.ts
 * AI 社群文案生成服務 — 支援 Facebook / Instagram / LINE 三平台
 * 使用 invokeLLM (Claude) 生成品牌化行銷文案
 */

import { invokeLLM } from "../_core/llm";
import { getTourById } from "../db";

// ── Types ──────────────────────────────────────────────────

export interface SocialCopyRequest {
  tourId: number;
  platform: "facebook" | "instagram" | "line";
  tone?: "professional" | "casual" | "exciting" | "luxury";
  language?: "zh-TW" | "en";
}

export interface SocialCopyResult {
  copyText: string;
  hashtags: string[];
  callToAction: string;
  imageCaption?: string;
}

// ── Platform-specific rules ────────────────────────────────

const PLATFORM_RULES: Record<string, string> = {
  facebook: `
Facebook 文案規則：
- 200-300 字，開頭用引人注目的 hook（問句或驚嘆句）
- 含行程亮點 3-5 個（用 emoji 列點，每點一行）
- 明確標示價格資訊 + 天數
- CTA：「立即報名」或「私訊了解更多」
- 5-8 個 hashtags（#PACKGO旅行社 #目的地 #旅遊 等）`,

  instagram: `
Instagram 文案規則：
- 150-200 字，更生活化、感性語氣
- 密集使用 emoji（每句都有）
- 15-20 個 hashtags（IG 標準，英文 + 中文混合）
- 含 @packgo.travel mention
- 結尾用「儲存這篇貼文」或「標記想去的朋友」`,

  line: `
LINE 文案規則：
- 100-150 字，簡潔有力，直接給重點
- 用 LINE 風格 emoji（🎌✈️🏨🌸🍜）
- 直接給價格 + 天數 + 出發日期（如有）
- 加入「限時優惠」「名額有限」等緊迫感
- 結尾附上官網連結提示：「詳情請洽 packgo.com」`,
};

const TONE_DESCRIPTIONS: Record<string, string> = {
  professional: "專業、正式、值得信賴",
  casual: "輕鬆、親切、像朋友推薦",
  exciting: "熱情、興奮、充滿活力",
  luxury: "高端、奢華、精緻體驗",
};

// ── Main function ──────────────────────────────────────────

export async function generateSocialCopy(
  req: SocialCopyRequest
): Promise<SocialCopyResult> {
  const { tourId, platform, tone = "exciting", language = "zh-TW" } = req;

  // Fetch tour data
  const tour = await getTourById(tourId);
  if (!tour) {
    throw new Error(`Tour ${tourId} not found`);
  }

  // Parse JSON fields safely
  const highlights = parseJsonArray(tour.highlights);
  const meals = parseJsonArray(tour.meals);
  const hotels = parseJsonArray(tour.hotels);

  const highlightText = highlights.slice(0, 5).join("、") || "精彩行程";
  const mealNames = meals
    .slice(0, 3)
    .map((m: Record<string, string>) => m.name || m.description || "")
    .filter(Boolean)
    .join("、");
  const hotelNames = hotels
    .slice(0, 2)
    .map((h: Record<string, string>) => h.name || "")
    .filter(Boolean)
    .join("、");

  const nights = tour.duration ? tour.duration - 1 : 0;
  const durationText = `${tour.duration}天${nights}夜`;
  const priceText =
    tour.priceCurrency === "USD"
      ? `USD $${tour.price.toLocaleString()} 起`
      : `TWD $${tour.price.toLocaleString()} 起`;

  const systemPrompt = `你是 PACK&GO 旅行社的資深行銷文案師。PACK&GO 是美國加州 Newark 的旅行社，專營亞洲團體旅遊。
品牌語調：專業但親切、注重品質、強調獨家行程。
品牌標籤：#PACKGO旅行社 @packgo.travel

請嚴格按照指定格式輸出 JSON，不要有任何額外說明。`;

  const userPrompt = `根據以下行程資訊，為 ${platform.toUpperCase()} 撰寫推廣文案：

行程名稱：${tour.title}
目的地：${tour.destination}
天數：${durationText}
價格：${priceText}
亮點：${highlightText}
特色餐食：${mealNames || "精選當地美食"}
住宿：${hotelNames || "精選優質飯店"}

要求：
- 語言：${language === "zh-TW" ? "繁體中文" : "English"}
- 語氣：${TONE_DESCRIPTIONS[tone]}
${PLATFORM_RULES[platform]}

請輸出以下 JSON 格式（不要有 markdown code block）：
{
  "copyText": "主文案（不含 hashtags）",
  "hashtags": ["hashtag1", "hashtag2", ...],
  "callToAction": "CTA 文字",
  "imageCaption": "圖片說明（50字以內）"
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "social_copy",
        strict: true,
        schema: {
          type: "object",
          properties: {
            copyText: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
            callToAction: { type: "string" },
            imageCaption: { type: "string" },
          },
          required: ["copyText", "hashtags", "callToAction", "imageCaption"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("LLM returned empty response");
  }

  // Parse JSON, strip markdown fences if present
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: SocialCopyResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: extract fields with regex
    parsed = {
      copyText: extractField(cleaned, "copyText") || content,
      hashtags: extractHashtags(cleaned),
      callToAction: extractField(cleaned, "callToAction") || "立即報名",
      imageCaption: extractField(cleaned, "imageCaption"),
    };
  }

  // Ensure hashtags are properly formatted
  parsed.hashtags = parsed.hashtags.map((h) =>
    h.startsWith("#") ? h : `#${h}`
  );

  return parsed;
}

// ── Helpers ────────────────────────────────────────────────

function parseJsonArray(value: string | null | undefined): Record<string, string>[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractField(text: string, field: string): string | undefined {
  const match = text.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "i"));
  return match?.[1];
}

function extractHashtags(text: string): string[] {
  // Try to extract array
  const arrayMatch = text.match(/"hashtags"\s*:\s*\[([^\]]*)\]/i);
  if (arrayMatch) {
    return arrayMatch[1]
      .split(",")
      .map((h) => h.replace(/"/g, "").trim())
      .filter(Boolean);
  }
  // Fallback: extract # tags from text
  const tags = text.match(/#[\w\u4e00-\u9fff]+/g) || [];
  return tags.slice(0, 8);
}

// ── Batch generation ───────────────────────────────────────

export async function generateAllPlatformCopy(
  tourId: number,
  tone: SocialCopyRequest["tone"] = "exciting",
  language: SocialCopyRequest["language"] = "zh-TW"
): Promise<{
  facebook: SocialCopyResult;
  instagram: SocialCopyResult;
  line: SocialCopyResult;
}> {
  const [facebook, instagram, line] = await Promise.all([
    generateSocialCopy({ tourId, platform: "facebook", tone, language }),
    generateSocialCopy({ tourId, platform: "instagram", tone, language }),
    generateSocialCopy({ tourId, platform: "line", tone, language }),
  ]);

  return { facebook, instagram, line };
}
