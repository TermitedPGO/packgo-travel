/**
 * Round 81 Layer 2 — FollowupAgent
 *
 * Three-stage customer care:
 *   - pre_departure (7 / 3 / 1 days before): logistics check, gentle reminder
 *   - mid_trip (mid-tour): "everything OK?" + emergency reachability
 *   - post_trip (1 / 7 / 30 days after): thank-you, review invite, future plans
 *
 * No commercial pitch — pure relationship care. Self-retrospective tracks
 * whether these messages get warm replies vs ignored, to tune cadence.
 */

import { invokeLLM, type Message } from "../../_core/llm";

export const DEFAULT_FOLLOWUP_POLICY = {
  cadenceDaysBefore: [7, 3, 1],
  cadenceDaysAfter: [1, 7, 30],
  forbidden: [
    "upsell_other_tour",
    "ask_for_review_before_trip_done",
    "remind_about_payment_balance_in_a_warm_message",
  ],
  tonePerStage: {
    pre_departure: "Practical + reassuring — 'we're ready, here's what to remember'",
    mid_trip: "Brief + warm — 'thinking of you, any issues?'",
    post_trip: "Genuinely grateful + curious — 'how was it really?'",
  },
  signature: "PACK&GO Travel · Jeff 親自關心",
};

export type FollowupAgentInput = {
  stage: "pre_departure" | "mid_trip" | "post_trip";
  daysFromStart: number; // negative = before, positive = after
  customerName?: string;
  destinationSummary: string; // e.g. "黃石公園 10 日"
  bookingNotes?: string; // e.g. "小孩 6 歲, 11 歲"
  language: "zh-TW" | "zh-CN" | "en";
  isFirstFollowup: boolean;
  policyRules?: string | null;
};

export type FollowupAgentOutput = {
  channel: "email" | "whatsapp" | "wechat";
  subject?: string; // for email
  body: string;
  confidence: number;
  reasoning: string;
};

const TOOL = {
  name: "submit_followup_draft",
  description: "Submit a customer care message for the given stage.",
  parameters: {
    type: "object",
    properties: {
      channel: { type: "string", enum: ["email", "whatsapp", "wechat"] },
      subject: { type: "string" },
      body: { type: "string" },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      reasoning: { type: "string" },
    },
    required: ["channel", "body", "confidence", "reasoning"],
  },
};

function buildSystem(policy: string): string {
  return `你是 PACK&GO 旅行社的 FollowupAgent。你負責出發前 / 旅途中 / 回國後 三段式關懷。

【絕對原則】
1. 不可在關懷訊息裡推銷其他行程。
2. 不可在出發前提醒尾款(那是業務的事)。
3. 不可在旅途中就要求評論。
4. 用客戶名字稱呼(如有)。
5. 短訊息頻道(whatsapp/wechat)→ body 短一點(50-150 字);email → 可以稍長(150-300 字)。

【當前政策】
${policy}

【你的任務】
根據 stage + 行程資訊,寫一則短關懷訊息,回傳 submit_followup_draft。
- channel:根據語境選擇 email / whatsapp / wechat
- body:對應 stage 的語氣
  - pre_departure:實用 + 安心(打包提醒、機場接送確認、緊急聯絡)
  - mid_trip:簡短 + 溫暖(「想到你們了,一切順利嗎?」)
  - post_trip:真誠感謝 + 好奇(「回到家了吧?最 memorable 的時刻是?」)
- 簽名用 policy.signature`;
}

export async function runFollowupAgent(
  input: FollowupAgentInput
): Promise<FollowupAgentOutput> {
  const policyText = input.policyRules ?? JSON.stringify(DEFAULT_FOLLOWUP_POLICY, null, 2);

  const userPrompt = [
    `【關懷階段】${input.stage}`,
    `【距出發】${input.daysFromStart} 天 (${input.daysFromStart < 0 ? "出發前" : "已回國"})`,
    `【目的地】${input.destinationSummary}`,
    input.customerName ? `【客人姓名】${input.customerName}` : null,
    input.bookingNotes ? `【訂單備註】${input.bookingNotes}` : null,
    `【語言】${input.language}`,
    `【是否第一次關懷】${input.isFirstFollowup ? "是" : "否"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: Message[] = [
    { role: "system", content: buildSystem(policyText) },
    { role: "user", content: userPrompt },
  ];

  const result = await invokeLLM({
    model: "claude-sonnet-4-5-20250929",
    messages,
    tools: [TOOL as any],
    toolChoice: { name: "submit_followup_draft" },
    maxTokens: 1200,
  });

  const toolCall = result.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("FollowupAgent: no tool_call returned");
  return JSON.parse(toolCall.function.arguments);
}
