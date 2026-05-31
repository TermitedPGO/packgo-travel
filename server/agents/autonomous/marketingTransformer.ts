/**
 * marketingTransformer — 供應商內容 → PACK&GO 品牌版 AI 轉換器 (P3-v2).
 *
 * Jeff 每天從供應商微信群收到推廣文 + 海報圖。這個 transformer 用 LLM 把供應商
 * 內容（簡體、含供應商品牌名）轉成 PACK&GO 自己的版本（繁體、去品牌、保留原價+
 * 「起」、自然語氣），然後灌進 marketing 審核箱等 Jeff 審改。
 *
 * v1：純文字模式（不送圖給 LLM）。supplierImageUrl 保留在 payload 給 Jeff 對照。
 * 未來如果 invokeLLM 支援 vision，可以把海報圖也送給 AI 讀取排版/景點/地圖。
 *
 * 用 Haiku（快+便宜）— 這不是需要高智能的任務，只是格式轉換+翻譯。
 */

import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "marketingTransformer" });

// ── Types ───────────────────────────────────────────────────────────────────

export interface TransformSupplierInput {
  /** 供應商微信群原文（必填）。 */
  supplierText: string;
  /** 供應商海報 R2 URL（選填，v1 僅存進 payload 給 Jeff 對照）。 */
  supplierImageUrl?: string;
  /** 目標平台提示（影響 AI 調整語氣/長度）。 */
  platform?: string;
  /** Jeff 額外指示（例如「強調小團」「不要放價格」）。 */
  notes?: string;
}

export interface TransformResult {
  title: string;
  body: string;
  extractedTourCode?: string;
  extractedPrice?: string;
  hashtags: string[];
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是 PACK&GO 旅行社（packgoplay.com）的行銷文案師。
你的工作是把供應商（纵横海鸥/途風/雄獅/海鸥假期/Trip2EU 等）的推廣內容轉成 PACK&GO 自己的品牌版。

轉換規則：
1. **去掉供應商品牌名**（纵横海鸥、Trip2EU、途風、雄獅、海鸥假期、縱橫 等）— 不提它們的名字
2. **保留原始價格 + 加「起」字**（例如供應商寫 $1890/人 → 你寫「$1,890 起」）
3. **繁體中文**為主，語氣專業但自然（不要太官方、不用破折號 ——、不用 ✓）
4. **保留所有實際資訊**：團號、天數、行程亮點、出發頻率、酒店等級、包含項目
5. 產出**一篇統一草稿**，適合稍作修改後用在各社群平台
6. 如果原文有多條線路，保留全部
7. 不要編造任何原文沒有的資訊

回傳 JSON（嚴格格式，不要加 markdown code fence）：
{
  "title": "一行標題（30字內）",
  "body": "完整草稿全文",
  "extractedTourCode": "從原文抽取的團號（如 EU-ROMROM5S），沒有就 null",
  "extractedPrice": "從原文抽取的起始價格（如 $1,890 起），沒有就 null",
  "hashtags": ["tag1", "tag2", "tag3"]
}`;

// ── JSON parser with fallback ───────────────────────────────────────────────

function parseTransformResponse(raw: string): TransformResult {
  // Try direct JSON parse
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.title === "string" && typeof obj.body === "string") {
      return {
        title: obj.title,
        body: obj.body,
        extractedTourCode: obj.extractedTourCode || undefined,
        extractedPrice: obj.extractedPrice || undefined,
        hashtags: Array.isArray(obj.hashtags) ? obj.hashtags : [],
      };
    }
  } catch {
    // fall through to regex extraction
  }

  // Try extracting JSON from markdown code fence
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) {
    try {
      const obj = JSON.parse(fenced[1]);
      if (obj && typeof obj.title === "string" && typeof obj.body === "string") {
        return {
          title: obj.title,
          body: obj.body,
          extractedTourCode: obj.extractedTourCode || undefined,
          extractedPrice: obj.extractedPrice || undefined,
          hashtags: Array.isArray(obj.hashtags) ? obj.hashtags : [],
        };
      }
    } catch {
      // fall through
    }
  }

  // Fallback: use raw text as body
  log.warn(
    { rawPreview: raw.slice(0, 200) },
    "[marketingTransformer] failed to parse LLM JSON — falling back to raw text",
  );
  return {
    title: "供應商內容轉換",
    body: raw,
    hashtags: [],
  };
}

// ── Main transformer ────────────────────────────────────────────────────────

/**
 * Transform supplier promotional content into a PACK&GO branded draft.
 * Uses Claude Haiku for speed + cost efficiency.
 */
export async function transformSupplierContent(
  input: TransformSupplierInput,
): Promise<TransformResult> {
  const { invokeLLM } = await import("../../_core/llm");

  const userContent = input.notes
    ? `${input.supplierText}\n\n--- Jeff 的額外指示 ---\n${input.notes}`
    : input.supplierText;

  // TODO: when invokeLLM supports vision, attach supplierImageUrl as an
  // ImageContent block so the AI can also read poster layout/pricing/map.

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const rawText =
    typeof response.choices[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : Array.isArray(response.choices[0]?.message?.content)
        ? response.choices[0].message.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("")
        : "";

  log.info(
    { inputLength: input.supplierText.length, outputLength: rawText.length },
    "[marketingTransformer] transform complete",
  );

  return parseTransformResponse(rawText);
}

// Export for testing
export { SYSTEM_PROMPT, parseTransformResponse };
