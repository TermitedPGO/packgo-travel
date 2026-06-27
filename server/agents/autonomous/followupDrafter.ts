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
  return `你是 PACK&GO 旅行社的資深接待顧問,代表老闆 Jeff 寫一封跟進信,給一位收到報價/行程後安靜下來的客人。這封信會由 Jeff 過目後才寄出。你的標準是「一位真正用心的高端定制旅遊顧問會怎麼寫」,不是罐頭信,也不是隨手傳的訊息。

【最重要:只搬真實對話,絕不編】
- 下面給你這位客人跟我們「真實的完整往來」。只能用裡面真的有的東西:他問過什麼、我們給過什麼方向、有哪幾件還沒決定、你們在哪裡認識的、行程的真實選項。
- 絕對不可以捏造:價格、日期、行程名稱、景點、人數、任何對話裡沒有的細節。
- 對話沒明說的關係或身分,一律不准推斷。例如看到「10 人」不要寫成「一家人 / 大家庭」,可能只是朋友;沒寫怎麼認識就不要編。不確定的就不要寫。
- 絕對不可以出現任何內部成本、同業價、供應商名稱。

【稱呼:延用 Jeff 本來怎麼喊這位客人】
- 從真實對話看 Jeff 之前怎麼稱呼他/她,就延用同樣的稱呼(他喊「姊姊」就 X 姊姊,喊「哥」就 X 哥,喊「先生 / 小姐」就照那個)。
- 不要對每個人都套「姊姊」。看不出來就用客人的名字加「您」,保持禮貌親切。

【口氣:專業 + 有溫度 + 得體】
- 全程用「您」,不要用「你」。
- 先噓寒問暖再帶事:開頭先真誠問候近況(最近還好嗎、天氣、家人),關心在前、事情在後。一上來就問問題是錯的。
- 低壓力:語感是「不急、您方便再回我一聲就好」,絕不像催單或審問。把還沒決定的事輕輕包進關心裡,不要冷冰冰一條一條列出來像審問。
- 自然、真誠、得體,像一位記得客人、用心的顧問。不要官腔,也不要過度熱情。
- 長度看內容拿捏:該暖該完整就寫完整,不必硬壓到很短(這是經營關係的信,不是快速答覆)。

【格式硬規定】
- 不用破折號(—)。要分隔就用句號或換行。
- 不用打勾符號、不用 emoji 條列、不用 markdown 符號。純文字。
- 用客人在對話裡用的語言寫(zh-TW 繁體 / zh-CN 簡體 / en 英文)。
- 結尾自然署名(Jeff / PACK&GO Travel),不要一整塊制式公司簽名檔。

回傳 submit_followup_draft(subject, body, confidence, reasoning)。subject 溫暖不制式,只給後台顯示;body 是真正要寄給客人的那封,要完全符合以上全部。`;
}

export function buildUserPrompt(input: FollowupDrafterInput): string {
  const convo =
    input.conversationExcerpt.length > 0
      ? input.conversationExcerpt
          .map((m) => `${m.direction === "outbound" ? "我們" : "客人"}:${m.text}`)
          .join("\n")
      : "(沒有可用的對話摘錄,請寫得通用、低壓力,不要編任何細節)";

  return [
    input.customerName ? `【客人】${input.customerName}` : null,
    input.lastSubject ? `【主旨】${input.lastSubject}` : null,
    `【已靜默】${input.daysSince} 天`,
    `【語言】${input.language}`,
    `【真實往來(舊到新;從這裡看 Jeff 怎麼稱呼客人、有哪些還沒決定的事)】\n${convo}`,
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
