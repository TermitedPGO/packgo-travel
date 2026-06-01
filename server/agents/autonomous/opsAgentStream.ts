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
import { READ_TOOLS, executeReadTool } from "./opsTools";

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
): AsyncGenerator<StreamEvent, void, void> {
  try {
    const { SYSTEM_PROMPT, ACTION_PROPOSAL_GUIDE } = await import("./opsAgent");

    // Build conversation: history → current question (+ optional images)
    const messages: Anthropic.MessageParam[] = [];
    let lastRole: string | null = null;
    for (const turn of history.slice(-10)) {
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

    const system =
      SYSTEM_PROMPT + "\n\n" + ACTION_PROPOSAL_GUIDE +
      "\n\n【查資料 — 鐵則】你有一組唯讀查詢工具 (count_records / aggregate_departures / search_tours / search_departures / search_bookings / search_customers / get_finance_summary / search_supplier_inventory)。" +
      "回答前一定要先用工具查真實資料,不要憑空回答數字。問「幾個 / 幾團 / 多少」一定用 count_records 拿確切總數,絕不用「我看到的筆數」當答案。問「哪個最多 / 分布」用 aggregate_departures。問淨利/財務用 get_finance_summary。查完再用自然中文回答。要建議寫入動作才用 suggest_action,純查詢問題不要附動作。";

    const tools = [...READ_TOOLS, SUGGEST_ACTION_TOOL];
    const suggestedActions: any[] = [];
    let finalAnswer = "";

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = getClient().messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        temperature: 0.3,
        system,
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

    // Empty-answer guard (the old "blank bubble" bug): if the model went
    // straight to actions with no prose, synthesize a short line.
    if (!finalAnswer) {
      finalAnswer =
        suggestedActions.length > 0
          ? "好,我準備了下面的動作,你確認要不要執行。"
          : "我沒查到對應的資料,可以換個方式問問看。";
    }

    yield { type: "done", finalAnswer, suggestedActions };
  } catch (err) {
    const message = (err as Error).message ?? "Unknown error";
    log.error({ err }, "[opsAgentStream] stream failed");
    yield { type: "error", error: message };
  }
}
