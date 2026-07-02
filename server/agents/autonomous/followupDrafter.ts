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
 * Voice-distillation technique (ported from the hung-yi-lee skill's prompt design):
 *   1. layered override — Jeff's hard rules sit at the top and win over any urge
 *      to write longer / more "professional".
 *   2. ❌ bad vs ✅ good pairs — show the wrong form next to the right one, instead
 *      of only stating the rule abstractly (the highest-leverage addition).
 *   3. anti-regression self-check — a list of drift symptoms to catch before submit.
 *   The ❌/✅ pairs are derived from Jeff's stated rules (the memory feedback files),
 *   NOT from mined message stats; a real phrase-frequency fingerprint would need
 *   his actual filed conversations and is a separate follow-up.
 *
 * Pure prompt builders (buildSystem / TOOL) are exported so the safety-critical
 * contract is unit-tested without an LLM call (local has no ANTHROPIC_API_KEY).
 */

import { hasCjk } from "./customerLanguage";
import { invokeLLM, type Message, type Tool } from "../../_core/llm";
import { withAutonomousSafety } from "../_helpers/safety";

export type FollowupDraftLanguage = "zh-TW" | "zh-CN" | "en";

/**
 * Live A/B arm. "A" = the frozen pre-2026-06-26 baseline; "B" = the
 * voice-distilled prompt (layered override + ❌/✅ pairs + self-check). The
 * producer assigns one per draft and stamps it on the row; the send path joins
 * it to Jeff's edit distance to measure which prompt he edits less.
 */
export type FollowupPromptVariant = "A" | "B";

/** The shipped default arm. buildSystem() and the drafter fall back to this. */
export const FOLLOWUP_PROMPT_DEFAULT: FollowupPromptVariant = "B";

export type FollowupDrafterInput = {
  customerName?: string | null;
  daysSince: number;
  language: FollowupDraftLanguage;
  /** Real recent conversation, chronological (oldest first), already trimmed. */
  conversationExcerpt: Array<{ direction: "inbound" | "outbound"; text: string }>;
  /** Thread subject, for display + light grounding. */
  lastSubject?: string | null;
  /** Which prompt arm to draft with. Omitted → FOLLOWUP_PROMPT_DEFAULT. */
  promptVariant?: FollowupPromptVariant;
  /** Jeff 口述的信件內容/指示(2026-07-02:「給我草稿」曾無視 Jeff 在聊天裡
   * 交代的內容,自己寫了封通用問候)。有值時信必須照做。 */
  jeffInstruction?: string | null;
  /** 第二次嘗試旗標:第一稿對 en 客人吐了中文,加重語言指令重打(見
   * draftFollowupEnforcingLanguage)。 */
  hardLanguageRetry?: boolean;
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

/**
 * Arm A — the frozen pre-2026-06-26 baseline. This is the control in the live
 * A/B. DO NOT edit it: it must stay byte-stable so the bake-off compares B
 * against a fixed reference. Prompt improvements land in SYSTEM_V2_DISTILLED.
 */
const SYSTEM_V1_BASELINE = `你是 PACK&GO 旅行社的資深接待顧問,代表老闆 Jeff 寫一封跟進信,給一位收到報價/行程後安靜下來的客人。這封信會由 Jeff 過目後才寄出。你的標準是「一位真正用心的高端定制旅遊顧問會怎麼寫」,不是罐頭信,也不是隨手傳的訊息。

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

/**
 * Arm B — the voice-distilled prompt (ported from the hung-yi-lee skill's
 * prompt design): layered override at the top, ❌ bad vs ✅ good pairs, and a
 * pre-send drift self-check. This is where prompt improvements land.
 */
const SYSTEM_V2_DISTILLED = `你是 PACK&GO 旅行社的資深接待顧問,代表老闆 Jeff 寫一封跟進信,給一位收到報價/行程後安靜下來的客人。這封信會由 Jeff 過目後才寄出。你的標準是「一位真正用心的高端定制旅遊顧問會怎麼寫」,不是罐頭信,也不是隨手傳的訊息。

【最高優先:這些是 Jeff 本人對客人訊息的硬性要求】
下面所有規則代表 Jeff 親自定的客人訊息風格。任何時候你想寫得更完整、更專業、更熱情,只要和這些衝突,一律以這些為準。寧可短而對,不要長而跑偏。

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

【壞例子 ❌ vs 好例子 ✅(只示範「寫法」,實際內容一律只能取自上面的真實對話)】
❌ 開場打官腔:「您好,關於您先前諮詢的行程,想跟您做個跟進確認。」
✅ 先真誠問候:「X 姊姊,最近還好嗎?天氣轉熱了,您那邊還好吧。」

❌ 一上來就追進度:「請問您考慮得如何了?還需要我提供什麼?」
✅ 先暖再輕輕帶事:「上次聊到的那幾天,您要是還在想,不急,等您方便再回我一聲就好。」

❌ 催單施壓:「名額有限,建議盡快確認以免向隅。」
✅ 低壓力:「都可以的,您慢慢看,有任何想問的我都在。」

❌ 破折號 / 打勾 / emoji / markdown:「行程已備好 — 隨時為您服務 ✅」
✅ 純文字:「行程我這邊都備著,您想看隨時跟我說。」

❌ 審問式列點:「還需確認:1. 出發日期 2. 人數 3. 預算」
✅ 把未定的事包進關心:「上次還有幾個小地方還沒定下來,不過都不急,等您有譜了再說。」

❌ 推斷沒講過的身分(對話只說 10 人):「祝您全家旅途愉快」
✅ 中性祝福:「祝您這趟玩得開心」

❌ 一整塊制式簽名檔:「PACK&GO Travel | Tel | Email | Address」
✅ 自然署名:「Jeff / PACK&GO Travel」

【寄出前自檢:出現以下任一徵兆代表跑偏了,重寫】
- 第一句就在講事情 / 問進度 → 漏了先噓寒問暖。
- 出現「建議盡快 / 名額有限 / 把握機會 / 盡早回覆」→ 變成催單了。
- 出現破折號、打勾、emoji、星號、任何 markdown 符號 → 違反純文字。
- 對方不確定是不是叫姊姊卻喊了「姊姊」,或對每個人都套同一個稱呼 → 沒延用真實稱呼。
- 出現對話裡沒有的價格 / 日期 / 景點 / 人數 / 身分 → 編了,刪掉。
- 結尾掛一整塊公司簽名檔 → 太制式。

回傳 submit_followup_draft(subject, body, confidence, reasoning)。subject 溫暖不制式,只給後台顯示;body 是真正要寄給客人的那封,要完全符合以上全部。`;

/** System prompt for the requested A/B arm (defaults to the shipped arm). */
export function buildSystem(variant: FollowupPromptVariant = FOLLOWUP_PROMPT_DEFAULT): string {
  return variant === "A" ? SYSTEM_V1_BASELINE : SYSTEM_V2_DISTILLED;
}

/** Forceful, unambiguous reply-language directive. The system prompt is written
 * in Chinese, which biases the model toward Chinese output even when the customer
 * wrote in English, so we restate the target language as a hard instruction in
 * the customer's own language. Shared by both A/B arms → no bake-off bias. */
const LANGUAGE_DIRECTIVE: Record<FollowupDraftLanguage, string> = {
  "zh-TW": "【回信語言】整封信務必用繁體中文撰寫。",
  "zh-CN": "【回信语言】整封信务必用简体中文撰写。",
  en: "【Reply language】Write the ENTIRE reply in English. The customer wrote to us in English, so reply in English, not Chinese.",
};

export function buildUserPrompt(input: FollowupDrafterInput): string {
  const convo =
    input.conversationExcerpt.length > 0
      ? input.conversationExcerpt
          .map((m) => `${m.direction === "outbound" ? "我們" : "客人"}:${m.text}`)
          .join("\n")
      : "(沒有可用的對話摘錄,請寫得通用、低壓力,不要編任何細節)";

  const instruction = input.jeffInstruction?.trim();
  return [
    input.customerName ? `【客人】${input.customerName}` : null,
    input.lastSubject ? `【主旨】${input.lastSubject}` : null,
    `【已靜默】${input.daysSince} 天`,
    LANGUAGE_DIRECTIVE[input.language],
    input.hardLanguageRetry && input.language === "en"
      ? "【SECOND ATTEMPT】Your previous draft contained Chinese characters. That is a hard failure. Rewrite the ENTIRE letter in English only. Zero Chinese characters."
      : null,
    instruction
      ? `【Jeff 的指示(這封信的內容必須照這個寫;下面的對話摘錄只拿來對口氣與稱呼,不要自己另編主題)】\n${instruction}`
      : null,
    `【真實往來(舊到新;從這裡看 Jeff 怎麼稱呼客人、有哪些還沒決定的事)】\n${convo}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function _draftFollowupInner(
  input: FollowupDrafterInput,
): Promise<FollowupDrafterOutput> {
  const messages: Message[] = [
    { role: "system", content: buildSystem(input.promptVariant ?? FOLLOWUP_PROMPT_DEFAULT) },
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

/**
 * Language-enforcing wrapper(2026-07-02 Leslie 中文跟進卡斷根):en 客人的
 * 第一稿含 CJK → 帶加重語言指令重打一次;第二稿還髒就原樣回傳,交給
 * sanitizeFollowupDraftBody 的 cjk_in_en_draft 硬擋(blocked → 不落卡)。
 * draftFn 可注入,純邏輯可測不燒 LLM。
 */
export async function draftFollowupEnforcingLanguage(
  input: FollowupDrafterInput,
  draftFn: (i: FollowupDrafterInput) => Promise<FollowupDrafterOutput> = draftFollowup,
): Promise<FollowupDrafterOutput> {
  const first = await draftFn(input);
  if (input.language !== "en" || !hasCjk(first.body ?? "")) return first;
  return draftFn({ ...input, hardLanguageRetry: true });
}
