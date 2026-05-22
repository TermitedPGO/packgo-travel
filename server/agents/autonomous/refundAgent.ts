/**
 * Round 81 Layer 2 — RefundAgent
 *
 * Triage only. NEVER auto-replies, NEVER auto-approves, NEVER quotes a
 * refund amount. Always escalates to Jeff with a structured assessment
 * so Jeff can make the call faster.
 *
 * Provides:
 *   - severity assessment
 *   - extracted facts (booking ID, amount mentioned, dates, reason category)
 *   - precedent flag (this customer's history)
 *   - draft *internal* note for Jeff (not for customer)
 *   - suggested next action (with explicit confidence + caveats)
 */

import { invokeLLM, type Message, type Tool } from "../../_core/llm";

export const DEFAULT_REFUND_POLICY = {
  alwaysEscalate: true, // hard rule — agent never replies directly
  jeffMustDecide: ["amount", "approval", "tone_with_customer"],
  triageGoal:
    "Give Jeff 30-second context so he can decide in under 2 minutes. Never tell the customer anything before Jeff approves.",
  severityRubric: {
    low: "客觀小問題,客戶情緒平穩,金額 < 200 USD",
    medium: "明確問題,客戶失望但理性,金額 200-1000 USD",
    high: "嚴重問題或情緒激動,金額 > 1000 USD",
    critical: "公開威脅 / 法律 / 醫療 / 政治敏感 — Jeff 立刻處理",
  },
};

export type RefundAgentInput = {
  rawMessage: string;
  customerProfile?: {
    id: number;
    email?: string | null;
    bookingCount?: number | null;
    totalSpend?: number | null;
    vipScore?: number | null;
  };
  policyRules?: string | null;
  /**
   * v2 Wave 3 Module 3.5 — trigger source attribution.
   *
   * `manual_admin` is the legacy path (Jeff clicks the agent button).
   * `stripe_webhook` is the autonomous trigger from handleChargeRefunded
   * — rawMessage in that case is the synthesized summary from
   * `synthesizeStripeRawMessage`, NOT a real customer email.
   *
   * Optional + defaults to undefined (legacy callers unchanged).
   */
  source?: "manual_admin" | "stripe_webhook";
  /** Set when source==="stripe_webhook". */
  stripeContext?: {
    chargeId: string;
    paymentIntentId: string;
    refundedAmountUsd: number;
    bookingId?: number | null;
    currency: string;
  };
};

/**
 * v2 Wave 3 Module 3.5 — build a LLM-readable summary for RefundAgent
 * when the trigger is the Stripe `charge.refunded` webhook (not a
 * customer email). Tells the model clearly: this is backend-triggered;
 * generate a triage for Jeff to use when drafting the proactive
 * customer notification, not a reply.
 */
export function synthesizeStripeRawMessage(args: {
  charge: {
    id: string;
    amount: number;
    amount_refunded: number;
    currency: string;
  };
  paymentIntentId: string;
  bookingId?: number | null;
  bookingSnapshot?: {
    customerEmail?: string;
    customerName?: string;
    departureDate?: Date | string;
  };
}): string {
  const refundedUsd = (args.charge.amount_refunded / 100).toFixed(2);
  const originalUsd = (args.charge.amount / 100).toFixed(2);
  const currency = (args.charge.currency || "usd").toUpperCase();
  const departure = args.bookingSnapshot?.departureDate
    ? typeof args.bookingSnapshot.departureDate === "string"
      ? args.bookingSnapshot.departureDate
      : args.bookingSnapshot.departureDate.toISOString().slice(0, 10)
    : "(unknown)";
  return [
    `[STRIPE_REFUND_AUTOMATED_TRIGGER]`,
    `Booking ID: ${args.bookingId ?? "(unknown)"}`,
    `Customer email: ${args.bookingSnapshot?.customerEmail ?? "(unknown)"}`,
    `Customer name: ${args.bookingSnapshot?.customerName ?? "(unknown)"}`,
    `Departure date: ${departure}`,
    `Refund amount: $${refundedUsd} ${currency}`,
    `Original charge: $${originalUsd} ${currency}`,
    `Stripe charge ID: ${args.charge.id}`,
    `Stripe payment intent: ${args.paymentIntentId}`,
    ``,
    `Triggered by: Stripe charge.refunded webhook (NOT a customer email).`,
    `The customer has not written in about this refund — Jeff needs a`,
    `proactive notification draft. Generate a triage summary covering:`,
    `severity (low/medium/high/critical), likely reason category,`,
    `customer emotional state forecast, and 2-4 concrete actions Jeff`,
    `should take to close the loop with the customer warmly.`,
  ].join("\n");
}

export type RefundAgentOutput = {
  severity: "low" | "medium" | "high" | "critical";
  reasonCategory:
    | "service_quality"
    | "logistics_failure"
    | "weather_or_external"
    | "personal_emergency"
    | "buyer_remorse"
    | "fraud_suspected"
    | "unclear";
  extractedFacts: {
    bookingIdMentioned?: string;
    amountMentioned?: string;
    dateRangeMentioned?: string;
    specificIncidents: string[];
  };
  customerEmotionalState: string;
  jeffInternalBriefing: string; // for Jeff's eyes only — NOT for customer
  suggestedJeffActions: string[]; // bulleted next steps
  confidence: number;
  reasoning: string;
};

// 2026-05-21 hotfix: wrap in OpenAI-nested shape (see inquiryAgent.ts header).
const TOOL: Tool = {
  type: "function",
  function: {
    name: "submit_refund_triage",
    description:
      "Submit triage of a customer refund request — for Jeff's eyes only.",
    parameters: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        reasonCategory: {
          type: "string",
          enum: [
            "service_quality",
            "logistics_failure",
            "weather_or_external",
            "personal_emergency",
            "buyer_remorse",
            "fraud_suspected",
            "unclear",
          ],
        },
        extractedFacts: {
          type: "object",
          properties: {
            bookingIdMentioned: { type: "string" },
            amountMentioned: { type: "string" },
            dateRangeMentioned: { type: "string" },
            specificIncidents: { type: "array", items: { type: "string" } },
          },
          required: ["specificIncidents"],
        },
        customerEmotionalState: { type: "string" },
        jeffInternalBriefing: { type: "string" },
        suggestedJeffActions: { type: "array", items: { type: "string" } },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        reasoning: { type: "string" },
      },
      required: [
        "severity",
        "reasonCategory",
        "extractedFacts",
        "customerEmotionalState",
        "jeffInternalBriefing",
        "suggestedJeffActions",
        "confidence",
        "reasoning",
      ],
    },
  },
};

function buildSystem(policy: string): string {
  return `你是 PACK&GO 旅行社的 RefundAgent。你的工作 ONLY 是 triage — 給 Jeff 30 秒 context,讓他在 2 分鐘內做決定。

【絕對原則 — 寫進骨子裡的硬規則】
1. 你 NEVER 直接回覆客戶。你寫的所有內容 ONLY 給 Jeff 看。
2. 你 NEVER 提到具體退款金額。
3. 你 NEVER 承諾「我們會退費」「沒問題」等。
4. 你 NEVER 拒絕(拒絕也是 Jeff 的事)。
5. critical 等級(公開威脅 / 法律 / 醫療 / 政治敏感)立刻 escalate 不等 confidence。

【當前政策】
${policy}

【你的任務】
讀完客戶來信,回傳 submit_refund_triage:
- severity:根據政策 rubric 評估
- reasonCategory:猜測原因類別
- extractedFacts:抽取訂單編號、金額、日期、具體事件(只填明確可見的,不要編造)
- customerEmotionalState:1 句話形容情緒(冷靜 / 失望 / 憤怒 / 焦慮 etc)
- jeffInternalBriefing:給 Jeff 看的 3-5 句摘要 — 客觀事實 + 你的觀察。**不要寫給客戶看的草稿**。
- suggestedJeffActions:bulleted 下一步建議,例如:
  - 確認訂單 PG-1234 在 8/15 是否確實有飯店降級
  - 查供應商 LionTravel 的服務紀錄
  - 親自打電話而非回 email(emotional state = 憤怒)
- confidence + reasoning`;
}

export async function runRefundAgent(
  input: RefundAgentInput
): Promise<RefundAgentOutput> {
  const policyText = input.policyRules ?? JSON.stringify(DEFAULT_REFUND_POLICY, null, 2);

  const ctxLines: string[] = [];
  if (input.customerProfile) {
    if (input.customerProfile.email)
      ctxLines.push(`【客戶】${input.customerProfile.email}`);
    if (input.customerProfile.bookingCount != null)
      ctxLines.push(`【歷史預訂】${input.customerProfile.bookingCount} 次`);
    if (input.customerProfile.totalSpend != null)
      ctxLines.push(`【歷史消費】$${input.customerProfile.totalSpend / 100}`);
  }
  const userPrompt = `${ctxLines.join("\n")}\n\n【客戶來信原文】\n${input.rawMessage}`;

  const messages: Message[] = [
    { role: "system", content: buildSystem(policyText) },
    { role: "user", content: userPrompt },
  ];

  const result = await invokeLLM({
    model: "claude-sonnet-4-5-20250929",
    messages,
    tools: [TOOL],
    toolChoice: { name: "submit_refund_triage" },
    maxTokens: 1800,
  });

  const toolCall = result.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("RefundAgent: no tool_call returned");
  return JSON.parse(toolCall.function.arguments);
}
