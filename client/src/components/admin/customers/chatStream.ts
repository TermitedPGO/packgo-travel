/**
 * chatStream — pure reducer for the ops-chat SSE, so the streaming logic is
 * unit-testable without an LLM. It is the fix for 斷句: a turn keeps the AI's
 * "thinking out loud" (bridge sentences + tool calls) as dim collapsed STEPS,
 * separate from the live streaming buffer and the final answer, so thinking and
 * the real answer never jam into one bubble.
 *
 * Backend event protocol (server/agents/autonomous/opsAgentStream.ts):
 *   token          — append to the live streaming buffer (shown with a cursor)
 *   round_thinking — a tool round finished: snapshot the live buffer as a dim
 *                    step (with the tools it ran) and clear live for the answer
 *   tool_result    — a WRITE tool executed: its REAL outcome (name/ok/message),
 *                    rendered as a deterministic chip (做沒做看 chip,不看 model
 *                    嘴上說什麼 — 2026-07-01 跟進日事故)
 *   done           — finalAnswer is the clean markdown answer; clear live
 *   error          — show the error
 */

export type ChatStep = { text: string; tools: string[] };

/** Deterministic write-tool echo (2026-07-01 事故: model 吞掉 set_follow_up_date
 * 失敗宣稱已設好). The server emits one per WRITE tool execution; `message` is
 * the tool's own message/error verbatim. Rendered as a chip under the answer —
 * 做沒做看 chip,沒 chip = 沒做. */
export type ChatToolResult = { name: string; ok: boolean; message: string };

export type ChatTurn = {
  /** dim, collapsed "thinking" steps (one per tool round) */
  steps: ChatStep[];
  /** current streaming buffer (the round in flight), rendered with a cursor */
  live: string;
  /** the final answer (markdown, rendered with Streamdown) */
  answer: string;
  /** write-tool ground truth (one chip each; empty on pure-read turns) */
  toolResults: ChatToolResult[];
  error: string | null;
};

export type ChatStreamEvent =
  | { type: "token"; text?: string }
  | { type: "round_thinking"; text?: string; tools?: string[] }
  | { type: "status"; text?: string }
  | { type: "tool_result"; name?: string; ok?: boolean; message?: string }
  | { type: "done"; finalAnswer?: string }
  | { type: "error"; error?: string };

/** Tool name → i18n key. This is a pure module (no hook access), so it maps to
 * KEYS and the render site resolves them via t() — the display strings live in
 * zh-TW.ts / en.ts under admin.customers.chat.tools.* (i18n 紅線: no hardcoded
 * UI Chinese here). */
export const TOOL_LABEL_KEYS: Record<string, string> = {
  count_records: "admin.customers.chat.tools.count_records",
  aggregate_departures: "admin.customers.chat.tools.aggregate_departures",
  search_tours: "admin.customers.chat.tools.search_tours",
  search_departures: "admin.customers.chat.tools.search_departures",
  search_bookings: "admin.customers.chat.tools.search_bookings",
  search_customers: "admin.customers.chat.tools.search_customers",
  get_finance_summary: "admin.customers.chat.tools.get_finance_summary",
  list_missing_receipts: "admin.customers.chat.tools.list_missing_receipts",
  search_supplier_inventory: "admin.customers.chat.tools.search_supplier_inventory",
  preview_customer_threads: "admin.customers.chat.tools.preview_customer_threads",
  read_customer_conversation: "admin.customers.chat.tools.read_customer_conversation",
  list_followups_needed: "admin.customers.chat.tools.list_followups_needed",
  draft_followup: "admin.customers.chat.tools.draft_followup",
  update_customer_note: "admin.customers.chat.tools.update_customer_note",
  update_booking_status: "admin.customers.chat.tools.update_booking_status",
  get_customer_documents: "admin.customers.chat.tools.get_customer_documents",
  get_payment_history: "admin.customers.chat.tools.get_payment_history",
  set_follow_up_date: "admin.customers.chat.tools.set_follow_up_date",
  create_custom_order: "admin.customers.chat.tools.create_custom_order",
  update_custom_order: "admin.customers.chat.tools.update_custom_order",
  collect_customer_threads: "admin.customers.chat.tools.collect_customer_threads",
  create_customer: "admin.customers.chat.tools.create_customer",
};

/** i18n key the reducer stores when the backend sent an error event with no
 * message; the render site translates it (see CustomerChat). */
export const CHAT_ERROR_FALLBACK_KEY = "admin.customers.chat.errorFallback";

/** Resolve a tool name to its display label via the caller's t(). Tool names
 * without an i18n key fall back to the raw name (t is never called with an
 * unknown key, so no missing-key Sentry noise). */
export function humanizeToolName(name: string, t: (key: string) => string): string {
  const key = TOOL_LABEL_KEYS[name];
  return key ? t(key) : name;
}

export function emptyTurn(): ChatTurn {
  return { steps: [], live: "", answer: "", toolResults: [], error: null };
}

/**
 * Re-hydrate the write-tool chips from a persisted turn's context JSON
 * (context.tools, written by the server at completion) so history reload shows
 * the same ground-truth chips the live stream did. Malformed / absent context
 * (older rows predate this field) → []. Pure, unit-testable.
 */
export function toolResultsFromContext(context: string | null | undefined): ChatToolResult[] {
  if (!context) return [];
  try {
    const parsed = JSON.parse(context);
    if (!Array.isArray(parsed?.tools)) return [];
    return parsed.tools
      .filter((t: unknown) => t && typeof t === "object")
      .map((t: { name?: unknown; ok?: unknown; message?: unknown }) => ({
        name: typeof t.name === "string" ? t.name : "",
        ok: t.ok === true,
        message: typeof t.message === "string" ? t.message : "",
      }));
  } catch {
    return [];
  }
}

/** Apply one SSE event to a turn, returning a new turn (immutable). */
export function reduceChatEvent(t: ChatTurn, ev: ChatStreamEvent): ChatTurn {
  switch (ev.type) {
    case "token":
      return { ...t, live: t.live + (ev.text ?? "") };

    case "round_thinking": {
      // The text the model spoke this round (a bridge sentence) is in `live`
      // unless the event carried it explicitly. Snapshot it as a dim step and
      // clear live so the next round / the answer starts fresh.
      const text = (ev.text ?? t.live).trim();
      const tools = ev.tools ?? [];
      const hasContent = text.length > 0 || tools.length > 0;
      return {
        ...t,
        steps: hasContent ? [...t.steps, { text, tools }] : t.steps,
        live: "",
      };
    }

    case "tool_result":
      // A WRITE tool's real outcome — append a ground-truth chip. The message
      // is server data carried verbatim (工具回傳,純搬運), never model prose.
      return {
        ...t,
        toolResults: [
          ...t.toolResults,
          {
            name: ev.name ?? "",
            ok: ev.ok === true,
            message: ev.message ?? "",
          },
        ],
      };

    case "done":
      // finalAnswer is the cleaned markdown answer; fall back to whatever
      // streamed if the backend somehow omitted it.
      return { ...t, answer: (ev.finalAnswer ?? t.live).trim(), live: "" };

    case "error":
      return { ...t, error: ev.error ?? CHAT_ERROR_FALLBACK_KEY, live: "" };

    case "status":
    default:
      // status is no longer emitted (round_thinking supersedes it); ignore.
      return t;
  }
}

/**
 * Parse the SSE wire chunk(s) accumulated in `buffer` into events, returning the
 * events found and the remaining (incomplete) buffer tail. Mirrors the
 * "\n\n"-delimited `data: {json}` framing the endpoint writes.
 */
export function parseSseChunk(buffer: string): {
  events: ChatStreamEvent[];
  rest: string;
} {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: ChatStreamEvent[] = [];
  for (const part of parts) {
    const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    try {
      events.push(JSON.parse(dataLine.slice(6)) as ChatStreamEvent);
    } catch {
      /* ignore a malformed chunk */
    }
  }
  return { events, rest };
}
