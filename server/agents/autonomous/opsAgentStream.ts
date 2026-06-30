/**
 * opsAgentStream — Agentic PACK&GO Agent (rewrite v3, 2026-06-01).
 *
 * This is now a real Claude-Code-style agent loop, not a single-shot call:
 *
 *   user question
 *     → LLM (Sonnet 4) with read tools + suggest_action tool
 *     → if it calls read tools (count/search/finance/supplier), execute them,
 *       feed results back, and let it call MORE tools or answer
 *     → repeat until it produces a final text answer (max 6 rounds)
 *
 * Why: the old version pre-fetched a fixed 15-row slice and reported "15"
 * when there were 165. Now the model runs an actual COUNT / GROUP BY via
 * count_records / aggregate_departures and gets the real number.
 *
 * Streaming: text tokens stream live (Jeff sees it think + answer). The saved
 * answer is the FINAL round's text (intermediate "let me check…" is ephemeral).
 *
 * Stability: Sonnet 4, max_tokens 4096, retry on 429/500/529, hard round cap.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../../_core/env";
import { createChildLogger } from "../../_core/logger";
import {
  READ_TOOLS,
  WRITE_TOOLS,
  WRITE_TOOL_NAMES,
  CREATE_CUSTOMER_TOOL,
  executeReadTool,
  executeWriteTool,
  toCard,
} from "./opsTools";
import { cleanChatAnswerKeepMarkdown } from "../../_core/plainTextReply";

const log = createChildLogger({ module: "opsAgentStream" });

export type { OpsAgentTurn, OpsActionProposal } from "./opsAgent";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    if (!ENV.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set");
    _client = new Anthropic({ apiKey: ENV.anthropicApiKey });
  }
  return _client;
}

export interface StreamEvent {
  type: "token" | "status" | "round_thinking" | "done" | "error";
  text?: string;
  /** read tools this round is about to run (for the dim thinking step). */
  tools?: string[];
  finalAnswer?: string;
  suggestedActions?: any[];
  cards?: any[];
  error?: string;
}

const MAX_ROUNDS = 6;

/** Tool the model calls to propose a write-action chip (executed only on Jeff's click). */
const SUGGEST_ACTION_TOOL: Anthropic.Tool = {
  name: "suggest_action",
  description: "Propose a follow-up WRITE action for Jeff to confirm (a chip appears; nothing runs until he clicks). Call 0-3 times. Only when there is a genuine next step — never on a pure information question.",
  input_schema: {
    type: "object",
    properties: {
      actionType: {
        type: "string",
        enum: [
          "sendCustomerEmail", "addTourGroupNote", "assignTourLeader",
          "updateInternalNote", "markBookingPaid", "scheduleReminder",
          "cancelBooking", "triggerRefund", "runFinanceAlerts",
          "askFinanceAdvisor", "produceInquiryReply", "downloadTaxCsv",
          "classifyBankTransactions", "draftWechatReply",
          "collectCustomerThreads",
        ],
      },
      label: { type: "string", description: "1-line Chinese chip label (< 30 chars)" },
      description: { type: "string", description: "2-3 sentence detail for the confirm modal" },
      args: { type: "object", description: "Action arguments" },
      sensitivity: { type: "string", enum: ["safe", "normal", "sensitive"] },
    },
    required: ["actionType", "label", "description", "args", "sensitivity"],
  },
};

/** Customer-page chat only: produce a follow-up draft card for THIS customer
 * (the resolved profile is held by the stream, not passed by the model). The
 * draft lands in the 待審草稿 panel for Jeff to review + one-click send. */
const DRAFT_FOLLOWUP_TOOL: Anthropic.Tool = {
  name: "draft_followup",
  description:
    "為「目前正在看的這位客人」備好一封專業跟進信草稿。會讀這位客人的真實對話、用 Jeff 的接待語氣(延用稱呼、用您、先噓寒問暖、低壓力、不催)寫好,放進客戶頁的待審草稿區,Jeff 看過一鍵就能寄。當 Jeff 要你回信 / 跟進 / 寫信給這位客人時呼叫;呼叫後用一兩句話跟 Jeff 說重點即可,不要自己長篇寫整封信。",
  input_schema: { type: "object", properties: {}, required: [] },
};

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode ?? 0;
      const retryable = status === 429 || status === 500 || status === 529;
      if (!retryable || attempt === maxAttempts) throw err;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
      log.warn({ attempt, status, delay }, "[opsAgentStream] retryable error, backing off");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

export async function* runOpsAgentStream(
  question: string,
  history: { role: "user" | "agent"; content: string }[] = [],
  imageUrls?: string[],
  /** 批2 m3 — per-customer chat pins WHO the thread is about (appended to
   *  the system prompt). Plain ops chat passes nothing; behavior unchanged. */
  extraSystem?: string,
  /** 批3 m4 — override the model for this stream. Customer-scoped chats pass
   *  Haiku (fast + cheap); global #ops passes nothing → Opus. */
  model?: string,
  /** Customer-page chat only: the resolved customerProfileId, which unlocks the
   *  draft_followup tool (produce a follow-up draft card for THIS customer).
   *  Global #ops passes nothing → the tool is absent. */
  draftProfileId?: number,
): AsyncGenerator<StreamEvent, void, void> {
  try {
    const { SYSTEM_PROMPT, ACTION_PROPOSAL_GUIDE, OPS_CHAT_MODEL } =
      await import("./opsAgent");
    const chatModel = model || OPS_CHAT_MODEL;

    // Build conversation: history → current question (+ optional images)
    const messages: Anthropic.MessageParam[] = [];
    let lastRole: string | null = null;
    for (const turn of history.slice(-10)) {
      // Skip empty-content turns — Anthropic rejects any message with empty
      // content ("messages.N: user messages must have non-empty content"). An
      // earlier failed/aborted reply can leave a blank row in the #ops thread;
      // one poison empty must not break every subsequent query.
      if (!turn.content || !turn.content.trim()) continue;
      const role = turn.role === "agent" ? "assistant" : "user";
      if (role === lastRole) {
        const prev = messages[messages.length - 1];
        prev.content = (prev.content as string) + "\n\n" + turn.content;
      } else {
        messages.push({ role: role as "user" | "assistant", content: turn.content });
        lastRole = role;
      }
    }

    const userContent: Anthropic.ContentBlockParam[] = [];
    if (imageUrls && imageUrls.length > 0) {
      for (const url of imageUrls.slice(0, 5)) {
        userContent.push({ type: "image", source: { type: "url", url } } as any);
      }
    }
    userContent.push({ type: "text", text: question });

    if (lastRole === "user") {
      const prev = messages[messages.length - 1];
      prev.content =
        typeof prev.content === "string"
          ? [{ type: "text", text: prev.content }, ...userContent]
          : [...(prev.content as any[]), ...userContent];
    } else {
      messages.push({ role: "user", content: userContent });
    }

    const today = new Date().toISOString().slice(0, 10);
    // Cache split (cost + speed, 2026-06-29): the big static prompt is identical
    // for every customer/session, so it gets its OWN cache block → a HIT on every
    // request no matter which customer. Only the small per-customer/per-day tail
    // (date + pinned context) goes in a second block. Before, both shared one
    // block, so each new customer busted the cache on the whole static bulk (the
    // expensive part). Same total content, just two cache prefixes.
    const staticSystem =
      SYSTEM_PROMPT + "\n\n" + ACTION_PROPOSAL_GUIDE +
      "\n\n【訂單狀態三層 — 讀法】bookings 有三個獨立狀態,不要混淆:\n" +
      "1. bookingStatus (pending/confirmed/completed/cancelled) = 客人承諾狀態\n" +
      "2. paymentStatus (unpaid/deposit/paid/refunded) = 款項狀態。deposit = 訂金已收,還欠尾款(不是「等繳訂金」)\n" +
      "3. tourDepartures.opsStatus (planning/confirmed/departed) = 出團執行狀態\n" +
      "一筆訂單可以同時是 confirmed + unpaid(已確認但還沒付錢)。要知道付款細節(幾時付/怎麼付/付多少)用 get_payment_history。\n\n" +
      "【查資料 — 鐵則】你有一組查詢工具 (count_records / aggregate_departures / search_tours / search_departures / search_bookings / search_customers / get_finance_summary / search_supplier_inventory / preview_customer_threads / read_customer_conversation / list_followups_needed / get_customer_documents / get_payment_history)。" +
      "\n【客人狀態 — 絕不猜】問「某客人什麼時候回我 / 進度到哪 / 上次聊到哪 / 要不要跟進」一定先呼叫 read_customer_conversation 讀真實對話再回(它會告訴你最後一封是誰、哪天、幾天沒回、現在輪到誰回)。講狀態時用「換你回 / 輪到客人回 / 該跟進了」這種白話,不要用「球在誰手上」這種比喻。問「誰需要跟進 / 哪些客人沒回我 / 有哪些卡住的」用 list_followups_needed。查不到就老實說「系統裡還沒他的對話,先用『收 <email>』收進來」,絕對不要編時間、編內容、編進度。要草擬跟進信時,先讀他最近幾封實際訊息,只根據真實內容寫,不要重複承諾已經寄過的東西(行程表/報價已寄就別再說要補)。" +
      "回答前一定要先用工具查真實資料,不要憑空回答數字。問「幾個 / 幾團 / 多少」一定用 count_records 拿確切總數,絕不用「我看到的筆數」當答案。問「哪個最多 / 分布」用 aggregate_departures。問淨利/財務用 get_finance_summary。問「哪些要 receipt / 收據」用 list_missing_receipts。\n" +
      "【先說一句再查 — 體感鐵則】要呼叫工具前,先用一句短話跟 Jeff 說你正要查什麼(例:『我查一下中國有哪些團』『等我看一下這個月的帳』),再呼叫工具。不要一句話都不說就靜默查 — 查詢可能要十幾秒,Jeff 會盯著空白以為當掉。先吐這句話,他立刻看到你在動;查完再接正式答案。\n" +
      "【財務鐵則】每次回答財務問題 (淨利、這個月狀況),如果 get_finance_summary 回傳的 missingReceiptCount > 0,一定要主動提醒 Jeff:「有 N 筆支出還沒附 receipt,要補一下」,因為他需要收據報稅。\n" +
      "【最重要】查完工具後,你一定要用**文字**把答案講給 Jeff 聽 (例:問淨利就講「這個月淨利 $X」)。**絕對不可以**只丟一個 suggest_action 動作就當作回答 — 動作只是「答完之後」的額外建議。沒有文字回答 = 失敗。純資訊問題 (幾團、淨利、哪個最多) 通常根本不需要附動作,直接講答案就好。suggest_action 只在 Jeff 明顯需要做一件寫入的事 (寄信、退款、分類帳本) 時才用,而且永遠是在文字答案之後。" +
      "\n【新增客人】Jeff 說「新增客人」「加一個客人」或拖放了客人資訊檔案時,從對話或附件中提取姓名 + email 或手機,呼叫 create_customer。建好後告訴 Jeff 已新增。" +
      (draftProfileId != null
        ? "\n【要回信 / 跟進這位客人 — 直接備好草稿】當 Jeff 叫你回信 / 跟進 / 幫忙寫信給「目前這位客人」,呼叫 draft_followup 把專業跟進信草稿備好(它會出現在客戶頁待審草稿區,看過一鍵就能寄)。呼叫後只要用一兩句話跟 Jeff 說重點(誰、卡在哪、幾天沒回),不要自己把整封信長篇寫在聊天裡。" +
          "\n【說了就做 — 寫入工具】你有 update_customer_note 和 update_booking_status 兩個寫入工具。Jeff 說「備註加上…」「標記已付款」「這筆確認了」時,直接呼叫對應工具執行,不用再問確認。但碰錢的變更(退款、調價)和寄信給客人的,仍然走 suggest_action 或 draft_followup 讓 Jeff 審核。update_customer_note 改的是 Jeff 私人備忘(客人看不到)。update_booking_status 要先用 search_bookings 拿到 bookingId。" +
          "\n【跟進日 — 說了就設】Jeff 說「跟進日設下週三」「下週五跟進他」「三天後提醒我跟進」「月底跟進」時,用上面【今天日期】把相對講法換算成絕對日期 YYYY-MM-DD(換算後自己核對星期對不對),呼叫 set_follow_up_date 直接設好(不用再問確認)。要清除就傳 clear=true。設定後跟進日會顯示在客戶頁真相條,到日當天跳「今天該跟進」。設完用一句話跟 Jeff 確認設了哪天。" +
          "\n【收 / 歸檔這位客人 — 直接做完報結果】Jeff 在這位客人的對話框說「收」「收進來」「歸檔他的記錄」時,直接呼叫 collect_customer_threads(email = 目前這位客人的 email),它會把這個 email 的 Gmail 往來全收進他的檔案。收完用一句話報結果(收了幾條、新增幾條)。**這個對話框沒有可點的按鈕,絕對不要叫 Jeff『點上面那個按鈕』或說『按鈕出來了』** — 你就是執行的人,收完直接報數字。工具失敗就老實說「系統忙,稍後再試」,不要假裝收好了。"
        : "");
    const dynamicSystem =
      `【今天日期】${today} (UTC)。任何跟年份/月份相關的判斷都以這個為準 — 例如「今年報稅」就是 ${today.slice(0, 4)} 年,「這個月」就是 ${today.slice(0, 7)},不要用舊年份。` +
      (extraSystem ? "\n\n" + extraSystem : "");

    // staticSystem (big, stable) = its own cached prefix → hits across ALL
    // customers/sessions. dynamicSystem (date + this customer's pinned context) =
    // the small tail; its breakpoint also caches the full prefix for the same
    // conversation's later rounds. Two breakpoints, same total content as before.
    const systemBlocks = [
      { type: "text" as const, text: staticSystem, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: dynamicSystem, cache_control: { type: "ephemeral" as const } },
    ];

    const tools =
      draftProfileId != null
        ? [...READ_TOOLS, ...WRITE_TOOLS, CREATE_CUSTOMER_TOOL, SUGGEST_ACTION_TOOL, DRAFT_FOLLOWUP_TOOL]
        : [...READ_TOOLS, CREATE_CUSTOMER_TOOL, SUGGEST_ACTION_TOOL];
    const suggestedActions: any[] = [];
    const cards: any[] = [];
    let finalAnswer = "";

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = getClient().messages.stream({
        model: chatModel,
        max_tokens: 4096,
        system: systemBlocks,
        messages,
        tools,
      });

      let roundText = "";
      for await (const ev of stream as any) {
        if (
          ev.type === "content_block_delta" &&
          ev.delta?.type === "text_delta"
        ) {
          const t = ev.delta.text as string;
          roundText += t;
          yield { type: "token", text: t };
        }
      }

      const final = await withRetry(() => stream.finalMessage());

      if (final.stop_reason !== "tool_use") {
        // Pure text answer — we're done.
        finalAnswer = roundText.trim();
        break;
      }

      // The model spoke, then called tools: that text was thinking out loud (a
      // bridge sentence like 「我查一下中國有哪些團」), NOT the answer. Snapshot it
      // as a dim "thinking" step BEFORE running the tools, so it collapses out of
      // the way instead of jamming into the answer bubble. The old behavior
      // streamed both into one bubble with no break, which read as 斷句.
      const roundTools = final.content
        .filter(
          (b): b is Anthropic.ToolUseBlock =>
            b.type === "tool_use" && b.name !== "suggest_action",
        )
        .map((b) => b.name);
      yield { type: "round_thinking", text: roundText.trim(), tools: roundTools };

      // Model called tools — must return a tool_result for EVERY tool_use block.
      messages.push({ role: "assistant", content: final.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      const readNames: string[] = [];

      for (const block of final.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "suggest_action") {
          suggestedActions.push(block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "proposed",
          });
        } else if (block.name === "draft_followup") {
          // Produce a follow-up draft card for the current customer (the resolved
          // profile is held by the stream, not trusted from the model). It lands
          // in the 待審草稿 panel for Jeff to review + send; AI never sends.
          let outcome = "無法草擬:沒有這位客人的資料。";
          try {
            const { getDb } = await import("../../db");
            const { produceFollowupDraftForProfile } = await import(
              "./followupDraftOnDemand"
            );
            const dbInst = await getDb();
            if (dbInst && draftProfileId != null) {
              const res = await produceFollowupDraftForProfile(dbInst, draftProfileId);
              outcome =
                res.status === "drafted"
                  ? "跟進信草稿已備好,顯示在客戶頁待審草稿區,Jeff 看過一鍵就能寄。"
                  : `沒有自動草擬(原因:${res.reason}),請 Jeff 人工處理。`;
            }
          } catch (e) {
            log.warn({ err: e, draftProfileId }, "[opsAgentStream] draft_followup failed");
            outcome = "草擬時出錯,請再試一次。";
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: outcome,
          });
        } else if (WRITE_TOOL_NAMES.has(block.name)) {
          const result = await executeWriteTool(
            block.name,
            block.input,
            draftProfileId,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        } else {
          readNames.push(block.name);
          const result = await executeReadTool(block.name, block.input);
          try {
            const card = toCard(block.name, JSON.parse(result));
            if (card) cards.push(card);
          } catch {
            /* result not JSON or not cardable — skip */
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
      // If the only tool calls were suggest_action (no reads), the loop will
      // still iterate once more so the model can produce its final text.
    }

    // Forced finalization: if the model ended on a tool/action call with no
    // prose (e.g. asked "淨利多少", called get_finance_summary, then only
    // proposed an action), it has the data but never spoke. Make ONE more
    // call with NO tools so it MUST answer in text using what it just queried.
    if (!finalAnswer) {
      messages.push({
        role: "user",
        content:
          "請直接用中文回答我上面的問題,把你剛剛查到的數字 / 結果講出來。不要再呼叫工具,就用文字回答。",
      });
      const fstream = getClient().messages.stream({
        model: chatModel,
        max_tokens: 2048,
        system: systemBlocks,
        messages,
      });
      let ftext = "";
      for await (const ev of fstream as any) {
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          ftext += ev.delta.text as string;
          yield { type: "token", text: ev.delta.text as string };
        }
      }
      await withRetry(() => fstream.finalMessage());
      finalAnswer = ftext.trim();
    }

    // Last-resort guard (finalization also empty).
    if (!finalAnswer) {
      finalAnswer = "我沒查到對應的資料,可以換個方式問問看。";
    }

    // Clean the saved answer: no markdown ** / em dash / emoji (the live tokens
    // already streamed; this guarantees the persisted + re-shown answer is clean
    // even when Opus ignores the prompt's no-markdown rule).
    finalAnswer = cleanChatAnswerKeepMarkdown(finalAnswer);

    yield { type: "done", finalAnswer, suggestedActions, cards };
  } catch (err) {
    const message = (err as Error).message ?? "Unknown error";
    log.error({ err }, "[opsAgentStream] stream failed");
    yield { type: "error", error: message };
  }
}
