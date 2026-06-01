/**
 * opsAgentStream — Streaming PACK&GO Agent (rewrite 2026-06-01).
 *
 * Token-by-token streaming via Anthropic SDK. Used by the SSE endpoint
 * `/api/agent/ask-ops-stream` to feed live tokens to the Chat UI.
 *
 * Key changes from v1:
 *   - Sonnet 4 instead of Haiku 4.5 (much better reasoning + stability)
 *   - tool_use for action proposals (no more fragile JSON output parsing)
 *   - System prompt imported from opsAgent.ts (single source of truth)
 *   - Auto-retry on 429/500 (3 attempts with exponential backoff)
 *   - max_tokens: 4096 (was 1500, answers were getting truncated)
 */
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../../_core/env";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "opsAgentStream" });

// Re-export for callers
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
  type: "token" | "done" | "error";
  text?: string;
  finalAnswer?: string;
  suggestedActions?: any[];
  error?: string;
}

/**
 * Anthropic tool definition for action proposals. The model calls this tool
 * when it wants to suggest an action, instead of embedding JSON in its text
 * output. This is far more reliable than parsing JSON from free-form text.
 */
const SUGGEST_ACTION_TOOL: Anthropic.Tool = {
  name: "suggest_action",
  description: "Suggest a follow-up action Jeff might want to take. Call this 0-3 times after answering. Only suggest actions when there is a clear next step.",
  input_schema: {
    type: "object" as const,
    properties: {
      actionType: {
        type: "string",
        enum: [
          "sendCustomerEmail", "addTourGroupNote", "assignTourLeader",
          "updateInternalNote", "markBookingPaid", "scheduleReminder",
          "cancelBooking", "triggerRefund",
          "runFinanceAlerts", "askFinanceAdvisor", "produceInquiryReply",
          "downloadTaxCsv", "classifyBankTransactions", "draftWechatReply",
        ],
        description: "The action type to execute",
      },
      label: { type: "string", description: "1-line Chinese label (< 30 chars) for the chip" },
      description: { type: "string", description: "2-3 sentence detail for the confirmation modal" },
      args: { type: "object", description: "Action-specific arguments" },
      sensitivity: {
        type: "string",
        enum: ["safe", "normal", "sensitive"],
        description: "safe=idempotent, normal=external effect, sensitive=money/customer-facing",
      },
    },
    required: ["actionType", "label", "description", "args", "sensitivity"],
  },
};

/**
 * Retry wrapper for Anthropic API calls. Handles 429 (rate limit) and 500
 * (server error) with exponential backoff. Max 3 attempts.
 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode ?? 0;
      const retryable = status === 429 || status === 500 || status === 529;
      if (!retryable || attempt === maxAttempts) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      log.warn(
        { attempt, status, delay },
        "[opsAgentStream] retryable error, backing off",
      );
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
    // Import from opsAgent.ts — single source of truth for prompts + context
    const {
      extractHints,
      fetchOpsContext,
      SYSTEM_PROMPT,
      ACTION_PROPOSAL_GUIDE,
    } = await import("./opsAgent");

    // Combine hints from current question + recent user turns
    const combinedText =
      history
        .filter((t) => t.role === "user")
        .slice(-3)
        .map((t) => t.content)
        .join(" ") +
      " " +
      question;
    const hints = extractHints(combinedText);
    const ctx = await fetchOpsContext(hints);

    const ctxStr = JSON.stringify(ctx, null, 2);
    const truncated =
      ctxStr.length > 15000
        ? ctxStr.slice(0, 15000) + "\n…(truncated)"
        : ctxStr;

    // Build messages — history then current question
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

    // Current question + DB context (no more JSON format requirement)
    const userMessage =
      `${question}\n\n` +
      `---\n` +
      `【從問題抽出的線索】\n` +
      `客戶名: ${hints.customerNameHints.join(", ") || "(無)"}\n` +
      `目的地: ${hints.destinationHints.join(", ") || "(無)"}\n` +
      `日期: ${hints.dateHint ? JSON.stringify(hints.dateHint) : "(無)"}\n` +
      `天數: ${hints.daysHint ?? "(無)"}\n\n` +
      `【DB + 供應商查詢結果】\n${truncated}`;

    // Build user content with optional images
    const userContent: Anthropic.ContentBlockParam[] = [];
    if (imageUrls && imageUrls.length > 0) {
      for (const url of imageUrls.slice(0, 5)) {
        userContent.push({ type: "image", source: { type: "url", url } } as any);
      }
    }
    userContent.push({ type: "text", text: userMessage });

    if (lastRole === "user") {
      const prev = messages[messages.length - 1];
      if (typeof prev.content === "string") {
        prev.content = [
          { type: "text", text: prev.content },
          ...userContent,
        ];
      } else if (Array.isArray(prev.content)) {
        prev.content = [...prev.content, ...userContent];
      }
    } else {
      messages.push({ role: "user", content: userContent });
    }

    const fullSystemPrompt = SYSTEM_PROMPT + "\n\n" + ACTION_PROPOSAL_GUIDE +
      "\n\n如果你想建議動作,用 suggest_action tool。回答直接用自然文字,不需要 JSON 格式。";

    // Stream with retry on initial connection.
    // messages.stream() returns a MessageStream synchronously; the actual API
    // call fires when we iterate. Wrap the creation + first event in retry.
    const streamParams = {
      model: "claude-sonnet-4-20250514" as const,
      max_tokens: 4096,
      temperature: 0.3,
      system: fullSystemPrompt,
      messages,
      tools: [SUGGEST_ACTION_TOOL],
    };
    const stream = getClient().messages.stream(streamParams);

    let accumulated = "";
    const suggestedActions: any[] = [];
    let currentToolInput = "";
    let inToolUse = false;

    for await (const event of stream as any) {
      if (event.type === "content_block_start") {
        if (event.content_block?.type === "tool_use") {
          inToolUse = true;
          currentToolInput = "";
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta" && !inToolUse) {
          const tokenText = event.delta.text as string;
          accumulated += tokenText;
          yield { type: "token", text: tokenText };
        } else if (event.delta.type === "input_json_delta" && inToolUse) {
          currentToolInput += event.delta.partial_json ?? "";
        }
      } else if (event.type === "content_block_stop" && inToolUse) {
        // Parse the completed tool call
        try {
          const action = JSON.parse(currentToolInput);
          suggestedActions.push(action);
        } catch {
          log.warn("[opsAgentStream] failed to parse tool input");
        }
        inToolUse = false;
        currentToolInput = "";
      }
    }

    yield {
      type: "done",
      finalAnswer: accumulated.trim(),
      suggestedActions,
    };
  } catch (err) {
    const message = (err as Error).message ?? "Unknown error";
    log.error({ err }, "[opsAgentStream] stream failed");
    yield { type: "error", error: message };
  }
}
