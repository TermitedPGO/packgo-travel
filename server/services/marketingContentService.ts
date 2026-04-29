/**
 * marketingContentService.ts — v78n Sprint 6B: AI-generated weekly social
 * media content. Admin presses one button → AI picks featured tours, drafts
 * IG / Facebook / 小紅書 captions, returns for review and approval.
 *
 * Why: in a one-person operation, social content creation is a 2hr/week
 * recurring burden. AI gets 80% of the way there in 30 seconds.
 */

import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import { tours } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

export interface SocialPostDraft {
  platform: "instagram" | "facebook" | "xiaohongshu";
  tourId: number;
  tourTitle: string;
  caption: string;
  hashtags: string[];
  imageUrl?: string;
}

const PLATFORM_PROMPTS = {
  instagram: {
    style: "Instagram caption — punchy hook in line 1, evocative description, "
         + "emoji-free per brand rules, 8-10 hashtags at the end",
    lengthHint: "100–180 字（中文）或 80–150 words (English)",
  },
  facebook: {
    style: "Facebook post — slightly longer than Instagram, story-driven, "
         + "asks a question to engage commenters at the end",
    lengthHint: "180–280 字（中文）或 150–230 words (English)",
  },
  xiaohongshu: {
    style: "小紅書筆記 — 標題開頭抓住注意力（不能用 emoji，可用『｜』『・』分隔），"
         + "內文用列點呈現亮點，結尾呼籲行動。風格活潑但不誇張",
    lengthHint: "300–500 字（中文必須）",
  },
} as const;

/**
 * Generate a single platform's caption for a given tour.
 */
async function generateCaption(
  platform: keyof typeof PLATFORM_PROMPTS,
  tour: any,
  language: "zh-TW" | "en"
): Promise<{ caption: string; hashtags: string[] }> {
  const cfg = PLATFORM_PROMPTS[platform];
  const isEN = language === "en";

  const systemPrompt = `You are a social media content strategist for PACK&GO — a California-licensed (CST #2166984) travel agency serving North American Chinese diaspora. Generate ONE platform-appropriate post for the tour below.

Style: ${cfg.style}
Length: ${cfg.lengthHint}
Tone: confident, evocative, NOT salesy. Emphasize one specific detail (a place, an experience, a moment) — don't list features.
Brand rules:
  - NO Unicode emoji at all (the platform may add reactions; we don't pre-add them)
  - DO mention the tour duration if it's notable (e.g., "10 天")
  - Never invent prices or features not in the brief
  - Do NOT pretend final pricing is locked — say "報價需 1 週內供應商確認" if pricing comes up

Return JSON: { "caption": "...", "hashtags": ["tag1", "tag2", ...] }
Hashtags: 6-10 tags, mix of generic-travel + region-specific. No leading #.`;

  const userPrompt = `Tour:
- Title: ${tour.title}
- Destination: ${tour.destinationCountry || "—"} ${tour.destinationCity ? `· ${tour.destinationCity}` : ""}
- Duration: ${tour.duration || "?"} days${tour.nights ? ` / ${tour.nights} nights` : ""}
- Hero subtitle: ${tour.heroSubtitle || "—"}
- Description excerpt: ${(tour.description || "").slice(0, 400)}

Language: ${isEN ? "English" : "Traditional Chinese (繁體)"}.`;

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "social_post",
        strict: true,
        schema: {
          type: "object",
          properties: {
            caption: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
          },
          required: ["caption", "hashtags"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response?.choices?.[0]?.message?.content;
  if (!content) return { caption: "", hashtags: [] };
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return {
      caption: parsed.caption || "",
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    };
  } catch {
    return { caption: "", hashtags: [] };
  }
}

/**
 * Pick the top N featured tours and generate posts for each platform.
 *
 * @param topN  Number of tours to draft posts for (default 3 = weekly cadence)
 * @param language Output language preference for captions
 */
export async function generateWeeklySocialPosts(
  topN: number = 3,
  language: "zh-TW" | "en" = "zh-TW",
  platforms: Array<keyof typeof PLATFORM_PROMPTS> = ["instagram", "facebook", "xiaohongshu"]
): Promise<SocialPostDraft[]> {
  const db = await getDb();
  if (!db) return [];

  // Pick featured tours; fallback to most-recent active
  const allActive = await db
    .select()
    .from(tours)
    .where(eq(tours.status, "active" as any))
    .orderBy(desc(tours.featured), desc(tours.createdAt))
    .limit(topN * 2);

  const picked = (allActive as any[]).slice(0, topN);

  const drafts: SocialPostDraft[] = [];
  for (const tour of picked) {
    for (const platform of platforms) {
      try {
        const { caption, hashtags } = await generateCaption(platform, tour, language);
        drafts.push({
          platform,
          tourId: tour.id,
          tourTitle: tour.title,
          caption,
          hashtags,
          imageUrl: tour.heroImage || tour.imageUrl || undefined,
        });
      } catch (err) {
        console.error(
          `[MarketingContent] ${platform} caption failed for tour #${tour.id}:`,
          (err as Error).message
        );
      }
    }
  }

  return drafts;
}
