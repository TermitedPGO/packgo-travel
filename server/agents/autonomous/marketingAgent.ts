/**
 * Round 81 Layer 2 — MarketingAgent
 *
 * Generates marketing emails (EDMs) for a target segment + topic.
 * Unlike Inquiry/Review which RESPOND, this PROACTIVELY composes.
 *
 * Critical rules:
 *   - ALWAYS includes opt-out footer
 *   - Respects frequency cap (caller enforces; agent assumes cap is checked)
 *   - Fairness: copy quality identical across segments — no "low-value
 *     customers get worse copy" pattern
 */

import { invokeLLM, type Message } from "../../_core/llm";

export const DEFAULT_MARKETING_POLICY = {
  toneByLanguage: {
    "zh-TW": "溫暖專業,不誇張不便宜感,類似精品旅行社的語氣",
    "zh-CN": "热情专业,克制使用感叹号,体现品质感",
    en: "warm, professional, never salesy — boutique travel feel",
  },
  mustInclude: [
    "clear_value_proposition",
    "concrete_offering",
    "soft_call_to_action",
    "opt_out_footer",
  ],
  forbidden: [
    "ALL_CAPS_subject",
    "exclamation_overload",
    "fake_urgency_like_今天最後一天",
    "specific_price_promise",
  ],
  signature: "PACK&GO Travel · pack@packandgousa.com",
  optOutFooter:
    "如不希望收到 PACK&GO 推廣信件,可回覆此信並寫上「取消訂閱」即可。",
};

export type MarketingAgentInput = {
  segment: string; // e.g. "首次詢問未下訂", "去年來過西雅圖的客戶"
  topic: string; // e.g. "黃石公園夏季團", "感恩節長週末紐約",
  language: "zh-TW" | "zh-CN" | "en";
  additionalContext?: string;
  policyRules?: string | null;
};

export type MarketingAgentOutput = {
  subject: string;
  preheader: string; // gmail preview text
  body: string; // full HTML-friendly text (with simple line breaks)
  callToAction: string;
  estimatedReadingTime: string; // e.g. "30 秒"
  confidence: number;
  reasoning: string;
  fairnessCheck: string; // explicit affirmation that copy is segment-neutral quality
};

const TOOL = {
  name: "submit_edm_draft",
  description: "Submit a fully drafted marketing email.",
  parameters: {
    type: "object",
    properties: {
      subject: { type: "string" },
      preheader: { type: "string" },
      body: { type: "string" },
      callToAction: { type: "string" },
      estimatedReadingTime: { type: "string" },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      reasoning: { type: "string" },
      fairnessCheck: { type: "string" },
    },
    required: [
      "subject",
      "preheader",
      "body",
      "callToAction",
      "estimatedReadingTime",
      "confidence",
      "reasoning",
      "fairnessCheck",
    ],
  },
};

function buildSystem(policy: string): string {
  return `你是 PACK&GO 旅行社的 MarketingAgent。你寫 EDM 給特定 segment,目的是溫和推廣,不是硬銷。

【絕對原則】
1. 品質公平 — 不管 segment 是哪一類,EDM 品質一致。不可因為 "low-value customer" 就敷衍。
2. 永遠在結尾加 opt-out 段落(用 policy.optOutFooter)。
3. 不可虛構價格、不可製造假緊迫感、不可用 ALL CAPS。
4. 用 segment 的語言寫,但保持 PACK&GO 的精品感。

【當前政策】
${policy}

【你的任務】
讀完 segment + topic 後,寫一封完整 EDM,回傳 submit_edm_draft。
- subject:8-15 字 / 5-10 英文字,具體不誇張
- preheader:30-60 字補完 subject,讓人想點開
- body:200-400 字,3-5 段。每段一個要點。最後一段是 opt-out。
- callToAction:具體下一步(例如「點此查看完整行程」「直接回信問細節」)
- fairnessCheck:用一句話自我檢查 — 「我寫的這封 EDM,如果換成 high-LTV segment,品質會一樣嗎?」`;
}

export async function runMarketingAgent(
  input: MarketingAgentInput
): Promise<MarketingAgentOutput> {
  const policyText = input.policyRules ?? JSON.stringify(DEFAULT_MARKETING_POLICY, null, 2);

  const userPrompt = [
    `【目標 segment】${input.segment}`,
    `【主題】${input.topic}`,
    `【語言】${input.language}`,
    input.additionalContext
      ? `【補充資訊】\n${input.additionalContext}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: Message[] = [
    { role: "system", content: buildSystem(policyText) },
    { role: "user", content: userPrompt },
  ];

  const result = await invokeLLM({
    model: "claude-sonnet-4-5-20250929",
    messages,
    tools: [TOOL as any],
    toolChoice: { name: "submit_edm_draft" },
    maxTokens: 2000,
  });

  const toolCall = result.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("MarketingAgent: no tool_call returned");
  return JSON.parse(toolCall.function.arguments);
}
