/**
 * followupDrafter — Step 4 (customer cockpit).
 *
 * Drafts a gentle, grounded follow-up to a stale-QUOTED customer (we sent a
 * quote / itinerary, they went quiet, ball in their court). This is NOT the
 * trip-care FollowupAgent (pre/mid/post-trip): there is no booking or departure
 * date here — just a quiet sales thread we want to nudge warmly.
 *
 * The draft is written FROM the REAL filed conversation (customerInteractions
 * excerpt), in Jeff's personal customer voice, and only ever lands in the
 * cockpit 待審草稿 panel for Jeff to approve+send. It NEVER sends.
 *
 * Hard rules (customer-facing text — see feedback_packgo_customer_msg_style,
 * feedback_no_em_dashes, feedback_ops_ai_read_real_conversation):
 *   - read the real excerpt; reference only what is actually there; no invented
 *     prices / dates / tour names; if the excerpt is thin, stay generic.
 *   - Jeff's voice: 口語、自然、不官方、短(2-4 句 / email ~120 字以內).
 *   - NO em dash (—), NO check marks / emoji bullets, plain text, no markdown.
 *   - warm low-pressure check-in, NOT a sales push; offer to answer questions /
 *     help the next step; never pressure to pay or book.
 *   - never mention internal cost / 同業價 / supplier names.
 *   - match the customer's language.
 *
 * Pure prompt builders (buildSystem / TOOL) are exported so the safety-critical
 * contract is unit-tested without an LLM call (local has no ANTHROPIC_API_KEY).
 */

import { invokeLLM, type Message, type Tool } from "../../_core/llm";
import { withAutonomousSafety } from "../_helpers/safety";

export type FollowupDraftLanguage = "zh-TW" | "zh-CN" | "en";

export type FollowupDrafterInput = {
  customerName?: string | null;
  daysSince: number;
  language: FollowupDraftLanguage;
  /** Real recent conversation, chronological (oldest first), already trimmed. */
  conversationExcerpt: Array<{ direction: "inbound" | "outbound"; text: string }>;
  /** Thread subject, for display + light grounding. */
  lastSubject?: string | null;
};

export type FollowupDrafterOutput = {
  subject: string;
  body: string;
  confidence: number;
  reasoning: string;
};

// OpenAI-nested tool shape (see inquiryAgent.ts header for why).
export const TOOL: Tool = {
  type: "function",
  function: {
    name: "submit_followup_draft",
    description:
      "Submit a gentle, grounded follow-up note to a quiet customer for Jeff to review and send.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Short subject line for display." },
        body: {
          type: "string",
          description:
            "The follow-up note in the customer's language. Plain text, no em dash, no markdown, no emoji bullets.",
        },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        reasoning: { type: "string", description: "Why this note (internal, not sent)." },
      },
      required: ["subject", "body", "confidence", "reasoning"],
    },
  },
};

export function buildSystem(): string {
  return `你是 PACK&GO 旅行社老闆 Jeff 本人,在寫一封「跟進信」給一位安靜下來的客人。

【情境】我們先前已經給過這位客人報價 / 行程,之後他就沒回了,球在他手上。這不是出發前後的關懷,是把一條安靜的報價對話溫和地推一下。

【最重要:讀真對話,不要編】
- 下面會給你這位客人「真實的往來摘錄」。你只能引用裡面真的有的東西(他問過什麼、我們給過什麼方向)。
- 絕對不可以捏造價格、日期、行程名稱、人數、任何對話裡沒有的細節。摘錄很少時就寫得通用一點(例如「想跟你確認一下上次給你的安排有沒有什麼問題」)。
- 絕對不可以出現任何內部成本、同業價、供應商名稱。

【口氣:就是 Jeff 平常傳訊息的樣子】
- 口語、自然、不官方。像朋友又像專業顧問。
- 短。最好 2 到 4 句,email 也別超過約 120 字。
- 低壓力的關心,不是催單。可以問「還在考慮嗎 / 有沒有想再多看哪邊 / 需要我幫你補什麼資料」,主動幫他下一步,但不要逼他付錢或下訂。

【格式硬規定】
- 不用破折號(—)。要分隔就用句號或換行。
- 不用打勾符號、不用 emoji 條列、不用 markdown。純文字。
- 用客人的語言寫(zh-TW 繁體 / zh-CN 簡體 / en 英文)。
- 結尾自然署名(Jeff 或 PACK&GO),不要一整塊公司簽名檔。

回傳 submit_followup_draft(subject, body, confidence, reasoning)。subject 只是給後台顯示用;body 是真正要給客人看的那封。`;
}

export function buildUserPrompt(input: FollowupDrafterInput): string {
  const convo =
    input.conversationExcerpt.length > 0
      ? input.conversationExcerpt
          .map((m) => `${m.direction === "outbound" ? "我們" : "客人"}:${m.text}`)
          .join("\n")
      : "(沒有可用的對話摘錄,請寫得通用、低壓力)";

  return [
    input.customerName ? `【客人】${input.customerName}` : null,
    input.lastSubject ? `【主旨】${input.lastSubject}` : null,
    `【已靜默】${input.daysSince} 天`,
    `【語言】${input.language}`,
    `【真實往來摘錄(舊到新)】\n${convo}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function _draftFollowupInner(
  input: FollowupDrafterInput,
): Promise<FollowupDrafterOutput> {
  const messages: Message[] = [
    { role: "system", content: buildSystem() },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const result = await invokeLLM({
    model: "claude-sonnet-4-5-20250929",
    messages,
    tools: [TOOL],
    toolChoice: { name: "submit_followup_draft" },
    maxTokens: 1000,
  });

  const toolCall = result.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("followupDrafter: no tool_call returned");
  return JSON.parse(toolCall.function.arguments) as FollowupDrafterOutput;
}

/** Wrapped export with the notifyOwner safety net (mirrors followupAgent). */
export const draftFollowup = withAutonomousSafety(
  { agentName: "followup_draft" },
  _draftFollowupInner,
);
