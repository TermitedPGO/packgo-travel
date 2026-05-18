/**
 * Round 81 Layer 2 — ReviewAgent
 *
 * Takes a customer review (text + star rating) and decides:
 *   - sentiment / theme classification
 *   - draft public reply (warm, professional, never defensive)
 *   - whether to escalate (1-star, severe complaint, or fairness flag)
 *
 * Same fairness rule as Inquiry: every review gets the same response
 * quality, no preferential treatment for high-LTV customers.
 */

import { invokeLLM, type Message } from "../../_core/llm";

export const DEFAULT_REVIEW_POLICY = {
  responseGoal:
    "Acknowledge the customer's experience genuinely, address concerns, never be defensive, and invite continued dialogue when appropriate.",
  classifications: {
    positive: { action: "draft_reply", minConfidence: 75 },
    constructive: { action: "draft_reply", minConfidence: 75 },
    negative: { action: "escalate" },
    spam: { action: "discard" },
  },
  alwaysEscalate: ["1_star", "specific_complaint_about_staff", "refund_implied"],
  signature: "PACK&GO Travel · 感謝您的回饋",
  fairnessRule:
    "Reply quality must be equal regardless of star rating or historical spend. A 5-star review and a 3-star review get equally thoughtful replies.",
};

export type ReviewAgentInput = {
  reviewText: string;
  rating: number; // 1-5
  customerProfile?: {
    id: number;
    email?: string | null;
    preferredLanguage?: string | null;
    bookingCount?: number | null;
    vipScore?: number | null;
  };
  policyRules?: string | null;
};

export type ReviewAgentOutput = {
  classification: "positive" | "constructive" | "negative" | "spam";
  themes: string[]; // e.g. ["hotel_quality","tour_pace","guide_friendliness"]
  sentiment: "positive" | "neutral" | "negative";
  draftReply: string;
  draftLanguage: "zh-TW" | "zh-CN" | "en";
  shouldEscalate: boolean;
  escalationReason?: string;
  confidence: number;
  reasoning: string;
};

const TOOL = {
  name: "submit_review_analysis",
  description: "Submit structured analysis of a customer review.",
  parameters: {
    type: "object",
    properties: {
      classification: {
        type: "string",
        enum: ["positive", "constructive", "negative", "spam"],
      },
      themes: { type: "array", items: { type: "string" } },
      sentiment: {
        type: "string",
        enum: ["positive", "neutral", "negative"],
      },
      draftReply: { type: "string" },
      draftLanguage: { type: "string", enum: ["zh-TW", "zh-CN", "en"] },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      reasoning: { type: "string" },
    },
    required: [
      "classification",
      "themes",
      "sentiment",
      "draftReply",
      "draftLanguage",
      "confidence",
      "reasoning",
    ],
  },
};

function buildSystem(policy: string): string {
  return `你是 PACK&GO 旅行社的 ReviewAgent。你的工作是為每條客戶評論起草公開回覆。

【絕對原則】
1. 回覆品質一致 — 不管 5 星還是 1 星,不管 VIP 還是新客,回覆都要用心。
2. 不要防衛、不要找藉口、不要怪客人。
3. 1 星評論 / 嚴重投訴 / 影射退費 → 一律 escalate Jeff。
4. 中文評論用繁體中文(除非客人用簡體)、英文評論用英文。

【當前政策】
${policy}

【你的任務】
讀完評論後,回傳 submit_review_analysis tool call,內容包含:
- classification:positive / constructive / negative / spam
- themes:評論觸及的主題(例如 ["hotel_quality", "guide_friendliness"])
- sentiment / draftReply / draftLanguage / confidence / reasoning

【draft 寫法】
- 開頭用客人名字(如有)或「親愛的旅客」
- 真誠致謝(無論 rating 高低)
- 對具體點 acknowledge(不是制式 thanks for feedback)
- 如果負面,認可問題 + 表達會內部檢討(不過度承諾)
- 結尾邀請再次旅行 / 進一步聯繫
- 100-250 字,簽名用 policy.signature`;
}

export async function runReviewAgent(
  input: ReviewAgentInput
): Promise<ReviewAgentOutput> {
  const policyText = input.policyRules ?? JSON.stringify(DEFAULT_REVIEW_POLICY, null, 2);
  const ctxLines: string[] = [`【評論評分】${input.rating}/5`];
  if (input.customerProfile) {
    if (input.customerProfile.email)
      ctxLines.push(`【客戶 email】${input.customerProfile.email}`);
    if (input.customerProfile.bookingCount != null)
      ctxLines.push(`【過往預訂次數】${input.customerProfile.bookingCount}`);
    ctxLines.push("【提醒】無論 VIP 與否,回覆品質一致");
  }
  const userPrompt = `${ctxLines.join("\n")}\n\n【評論原文】\n${input.reviewText}`;

  const messages: Message[] = [
    { role: "system", content: buildSystem(policyText) },
    { role: "user", content: userPrompt },
  ];

  const result = await invokeLLM({
    model: "claude-sonnet-4-5-20250929",
    messages,
    tools: [TOOL as any],
    toolChoice: { name: "submit_review_analysis" },
    maxTokens: 1500,
  });

  const toolCall = result.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall)
    throw new Error("ReviewAgent: no tool_call returned");
  const parsed = JSON.parse(toolCall.function.arguments);

  const policy = safeParsePolicy(policyText);
  const action = policy.classifications?.[parsed.classification]?.action ?? "escalate";
  const minConf = policy.classifications?.[parsed.classification]?.minConfidence ?? 75;
  const shouldEscalate =
    action === "escalate" ||
    input.rating === 1 ||
    parsed.confidence < minConf;

  let escalationReason: string | undefined;
  if (shouldEscalate) {
    if (input.rating === 1) escalationReason = "1-star review → always escalate";
    else if (action === "escalate")
      escalationReason = `classification=${parsed.classification} → policy.action=escalate`;
    else if (parsed.confidence < minConf)
      escalationReason = `confidence ${parsed.confidence} < min ${minConf}`;
  }

  return {
    classification: parsed.classification,
    themes: parsed.themes ?? [],
    sentiment: parsed.sentiment,
    draftReply: parsed.draftReply,
    draftLanguage: parsed.draftLanguage,
    shouldEscalate,
    escalationReason,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
  };
}

function safeParsePolicy(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return DEFAULT_REVIEW_POLICY;
  }
}
