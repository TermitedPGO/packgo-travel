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
