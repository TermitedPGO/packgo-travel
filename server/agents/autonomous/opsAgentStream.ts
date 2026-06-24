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
import { READ_TOOLS, executeReadTool, toCard } from "./opsTools";

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
  type: "token" | "status" | "done" | "error";
  text?: string;
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
    const system =
      `【今天日期】${today} (UTC)。任何跟年份/月份相關的判斷都以這個為準 — 例如「今年報稅」就是 ${today.slice(0, 4)} 年,「這個月」就是 ${today.slice(0, 7)},不要用舊年份。\n\n` +
      SYSTEM_PROMPT + "\n\n" + ACTION_PROPOSAL_GUIDE +
      "\n\n【查資料 — 鐵則】你有一組唯讀查詢工具 (count_records / aggregate_departures / search_tours / search_departures / search_bookings / search_customers / get_finance_summary / search_supplier_inventory / preview_customer_threads / read_customer_conversation)。" +
      "\n【客人狀態 — 絕不猜】問「某客人什麼時候回我 / 進度到哪 / 上次聊到哪 / 要不要跟進」一定先呼叫 read_customer_conversation 讀真實對話再回(它會告訴你最後一封是誰、哪天、幾天沒回、球在誰手上)。查不到就老實說「系統裡還沒他的對話,先用『收 <email>』收進來」,絕對不要編時間、編內容、編進度。要草擬跟進信時,先讀他最近幾封實際訊息,只根據真實內容寫,不要重複承諾已經寄過的東西(行程表/報價已寄就別再說要補)。" +
      "回答前一定要先用工具查真實資料,不要憑空回答數字。問「幾個 / 幾團 / 多少」一定用 count_records 拿確切總數,絕不用「我看到的筆數」當答案。問「哪個最多 / 分布」用 aggregate_departures。問淨利/財務用 get_finance_summary。問「哪些要 receipt / 收據」用 list_missing_receipts。\n" +
      "【先說一句再查 — 體感鐵則】要呼叫工具前,先用一句短話跟 Jeff 說你正要查什麼(例:『我查一下中國有哪些團』『等我看一下這個月的帳』),再呼叫工具。不要一句話都不說就靜默查 — 查詢可能要十幾秒,Jeff 會盯著空白以為當掉。先吐這句話,他立刻看到你在動;查完再接正式答案。\n" +
      "【財務鐵則】每次回答財務問題 (淨利、這個月狀況),如果 get_finance_summary 回傳的 missingReceiptCount > 0,一定要主動提醒 Jeff:「有 N 筆支出還沒附 receipt,要補一下」,因為他需要收據報稅。\n" +
      "【最重要】查完工具後,你一定要用**文字**把答案講給 Jeff 聽 (例:問淨利就講「這個月淨利 $X」)。**絕對不可以**只丟一個 suggest_action 動作就當作回答 — 動作只是「答完之後」的額外建議。沒有文字回答 = 失敗。純資訊問題 (幾團、淨利、哪個最多) 通常根本不需要附動作,直接講答案就好。suggest_action 只在 Jeff 明顯需要做一件寫入的事 (寄信、退款、分類帳本) 時才用,而且永遠是在文字答案之後。" +
      (extraSystem ? "\n\n" + extraSystem : "");

    // Cache the (large, mostly-static) system prompt so Opus 4.8's per-round
    // re-send is read from cache (~90% cheaper) — keeps the model upgrade
    // affordable across the 6-round loop + repeat queries the same day.
    const systemBlocks = [
      { type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } },
    ];

    const tools = [...READ_TOOLS, SUGGEST_ACTION_TOOL];
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

      if (readNames.length > 0) {
        yield { type: "status", text: `查詢中: ${readNames.join(", ")}` };
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

    yield { type: "done", finalAnswer, suggestedActions, cards };
  } catch (err) {
    const message = (err as Error).message ?? "Unknown error";
    log.error({ err }, "[opsAgentStream] stream failed");
    yield { type: "error", error: message };
  }
}
