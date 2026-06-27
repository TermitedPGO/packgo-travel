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
 *   done           — finalAnswer is the clean markdown answer; clear live
 *   error          — show the error
 */

export type ChatStep = { text: string; tools: string[] };

export type ChatTurn = {
  /** dim, collapsed "thinking" steps (one per tool round) */
  steps: ChatStep[];
  /** current streaming buffer (the round in flight), rendered with a cursor */
  live: string;
  /** the final answer (markdown, rendered with Streamdown) */
  answer: string;
  error: string | null;
};

export type ChatStreamEvent =
  | { type: "token"; text?: string }
  | { type: "round_thinking"; text?: string; tools?: string[] }
  | { type: "status"; text?: string }
  | { type: "done"; finalAnswer?: string }
  | { type: "error"; error?: string };

const TOOL_LABELS: Record<string, string> = {
  count_records: "統計資料",
  aggregate_departures: "匯總出團",
  search_tours: "搜尋行程",
  search_departures: "查詢出團",
  search_bookings: "查詢訂單",
  search_customers: "搜尋客戶",
  get_finance_summary: "查看財務",
  list_missing_receipts: "缺收據清單",
  search_supplier_inventory: "查詢供應商庫存",
  preview_customer_threads: "預覽郵件",
  read_customer_conversation: "讀取對話紀錄",
  list_followups_needed: "待跟進清單",
  draft_followup: "草擬跟進信",
  update_customer_note: "更新備註",
  update_booking_status: "更新訂單狀態",
  get_customer_documents: "查看證件狀態",
  get_payment_history: "查看付款紀錄",
};

export function humanizeToolName(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

export function emptyTurn(): ChatTurn {
  return { steps: [], live: "", answer: "", error: null };
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

    case "done":
      // finalAnswer is the cleaned markdown answer; fall back to whatever
      // streamed if the backend somehow omitted it.
      return { ...t, answer: (ev.finalAnswer ?? t.live).trim(), live: "" };

    case "error":
      return { ...t, error: ev.error ?? "出錯了,請再試一次。", live: "" };

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
