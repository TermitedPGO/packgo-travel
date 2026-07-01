/**
 * chatStream reducer — the 斷句 fix, unit-tested without an LLM. The load-bearing
 * case: an agentic turn (bridge sentence → tool round → real answer) keeps the
 * thinking as a separate dim step and never concatenates it into the answer.
 */
import { describe, it, expect, vi } from "vitest";
import {
  emptyTurn,
  reduceChatEvent,
  parseSseChunk,
  humanizeToolName,
  toolResultsFromContext,
  TOOL_LABEL_KEYS,
  CHAT_ERROR_FALLBACK_KEY,
  type ChatTurn,
} from "./chatStream";
import { zhTW } from "../../../i18n/zh-TW";
import { en } from "../../../i18n/en";

/** Dotted-path lookup into an i18n bundle (same shape as translate()'s). */
function lookup(bundle: Record<string, unknown>, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
      bundle,
    );
}

const run = (events: Parameters<typeof reduceChatEvent>[1][]): ChatTurn =>
  events.reduce(reduceChatEvent, emptyTurn());

describe("reduceChatEvent", () => {
  it("token appends to the live buffer", () => {
    expect(run([{ type: "token", text: "中國" }, { type: "token", text: "有 5 團" }]).live).toBe(
      "中國有 5 團",
    );
  });

  it("round_thinking snapshots the bridge text as a dim step and clears live", () => {
    const t = run([
      { type: "token", text: "我查一下中國有哪些團" },
      { type: "round_thinking", tools: ["count_records"] },
    ]);
    expect(t.steps).toEqual([{ text: "我查一下中國有哪些團", tools: ["count_records"] }]);
    expect(t.live).toBe("");
  });

  it("the full agentic turn: thinking stays a step, answer is clean (no 斷句)", () => {
    const t = run([
      { type: "token", text: "我查一下中國有哪些團" }, // bridge
      { type: "round_thinking", tools: ["count_records"] }, // tool round ends
      { type: "token", text: "中國目前有 5 團。" }, // real answer streams
      { type: "done", finalAnswer: "中國目前有 5 團。" },
    ]);
    expect(t.steps).toEqual([{ text: "我查一下中國有哪些團", tools: ["count_records"] }]);
    expect(t.answer).toBe("中國目前有 5 團。");
    expect(t.live).toBe("");
    // the answer never contains the bridge sentence
    expect(t.answer).not.toContain("我查一下");
  });

  it("multiple tool rounds become multiple steps", () => {
    const t = run([
      { type: "token", text: "先看一下訂單" },
      { type: "round_thinking", tools: ["search_bookings"] },
      { type: "token", text: "再查財務" },
      { type: "round_thinking", tools: ["get_finance_summary"] },
      { type: "token", text: "這個月淨利 $3,200。" },
      { type: "done", finalAnswer: "這個月淨利 $3,200。" },
    ]);
    expect(t.steps).toHaveLength(2);
    expect(t.steps[1].tools).toEqual(["get_finance_summary"]);
    expect(t.answer).toBe("這個月淨利 $3,200。");
  });

  it("round_thinking prefers an explicit text over the live buffer", () => {
    const t = run([
      { type: "token", text: "live text" },
      { type: "round_thinking", text: "explicit bridge", tools: [] },
    ]);
    expect(t.steps[0].text).toBe("explicit bridge");
  });

  it("empty round_thinking (no text, no tools) does not push a step", () => {
    const t = run([{ type: "round_thinking", text: "", tools: [] }]);
    expect(t.steps).toEqual([]);
  });

  it("done falls back to live when finalAnswer is missing", () => {
    const t = run([{ type: "token", text: "部分答案" }, { type: "done" }]);
    expect(t.answer).toBe("部分答案");
  });

  it("error sets the error and clears live", () => {
    const t = run([{ type: "token", text: "x" }, { type: "error", error: "逾時" }]);
    expect(t.error).toBe("逾時");
    expect(t.live).toBe("");
  });

  it("error without a message stores the i18n fallback KEY, not hardcoded Chinese", () => {
    const t = run([{ type: "token", text: "x" }, { type: "error" }]);
    // The reducer is a pure module (no t()); it stores the key and the render
    // site translates it — so the English UI never shows a Chinese error.
    expect(t.error).toBe(CHAT_ERROR_FALLBACK_KEY);
    expect(t.live).toBe("");
  });

  it("status is ignored (superseded by round_thinking)", () => {
    const t = run([{ type: "token", text: "a" }, { type: "status", text: "查詢中" }]);
    expect(t.live).toBe("a");
    expect(t.steps).toEqual([]);
  });

  // 2026-07-01 跟進日事故: the model claimed「跟進日已設在 7/21」while the write
  // never landed. tool_result is the deterministic echo — 做沒做看 chip。
  describe("tool_result — write-tool ground-truth chips", () => {
    it("appends a chip without touching live / answer / steps", () => {
      const t = run([
        { type: "token", text: "我設一下" },
        { type: "tool_result", name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" },
      ]);
      expect(t.toolResults).toEqual([
        { name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" },
      ]);
      expect(t.live).toBe("我設一下");
      expect(t.steps).toEqual([]);
    });

    it("a failed write keeps ok:false and the server error verbatim", () => {
      const t = run([
        {
          type: "tool_result",
          name: "set_follow_up_date",
          ok: false,
          message: "日期格式要 YYYY-MM-DD 或 M/D 簡寫,收到「下週二」",
        },
      ]);
      expect(t.toolResults[0].ok).toBe(false);
      expect(t.toolResults[0].message).toContain("日期格式");
    });

    it("the incident turn: chips survive done — the AI's claim never becomes a chip", () => {
      const t = run([
        { type: "tool_result", name: "set_follow_up_date", ok: false, message: "不是有效日期" },
        { type: "token", text: "跟進日已設在 7/21(週二)。" }, // the model's false claim
        { type: "done", finalAnswer: "跟進日已設在 7/21(週二)。" },
      ]);
      // The chip shows the FAILURE regardless of what the answer text claims.
      expect(t.toolResults).toEqual([
        { name: "set_follow_up_date", ok: false, message: "不是有效日期" },
      ]);
      expect(t.answer).toContain("已設在");
    });

    it("multiple writes → one chip each, in execution order", () => {
      const t = run([
        { type: "tool_result", name: "create_custom_order", ok: true, message: "已建立專案「A」(PG-1)" },
        { type: "tool_result", name: "update_customer_note", ok: true, message: "備註已更新" },
      ]);
      expect(t.toolResults.map((r) => r.name)).toEqual([
        "create_custom_order",
        "update_customer_note",
      ]);
    });

    it("a pure-read turn keeps toolResults empty (沒 chip = 沒寫入)", () => {
      const t = run([
        { type: "token", text: "中國有 5 團。" },
        { type: "done", finalAnswer: "中國有 5 團。" },
      ]);
      expect(t.toolResults).toEqual([]);
    });

    it("missing fields coerce safely (name/message '' , ok false)", () => {
      const t = run([{ type: "tool_result" }]);
      expect(t.toolResults).toEqual([{ name: "", ok: false, message: "" }]);
    });
  });
});

describe("toolResultsFromContext — history reload re-renders the same chips", () => {
  it("reads context.tools back from a persisted agent row", () => {
    const context = JSON.stringify({
      suggestedActions: [],
      cards: [],
      streamed: true,
      tools: [{ name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" }],
    });
    expect(toolResultsFromContext(context)).toEqual([
      { name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" },
    ]);
  });

  it("legacy rows (no tools field) and null/malformed context → []", () => {
    expect(toolResultsFromContext(JSON.stringify({ suggestedActions: [], cards: [] }))).toEqual([]);
    expect(toolResultsFromContext(null)).toEqual([]);
    expect(toolResultsFromContext(undefined)).toEqual([]);
    expect(toolResultsFromContext("not json")).toEqual([]);
    expect(toolResultsFromContext(JSON.stringify({ tools: "nope" }))).toEqual([]);
  });

  it("drops non-object entries and coerces loose fields", () => {
    const context = JSON.stringify({
      tools: [null, "x", { name: 1, ok: "yes", message: 2 }, { name: "a", ok: true, message: "b" }],
    });
    expect(toolResultsFromContext(context)).toEqual([
      { name: "", ok: false, message: "" },
      { name: "a", ok: true, message: "b" },
    ]);
  });
});

/**
 * i18n 紅線 (Finding: TOOL_LABELS 硬編碼中文) — tool labels + error fallback
 * must resolve through i18n keys that exist in BOTH bundles, so the English UI
 * shows English steps instead of Chinese.
 */
describe("humanizeToolName (i18n)", () => {
  it("known tools resolve through the caller's t() with an admin.customers.chat.tools.* key", () => {
    const t = (key: string) => `T(${key})`;
    expect(humanizeToolName("search_bookings", t)).toBe(
      "T(admin.customers.chat.tools.search_bookings)",
    );
  });

  it("unknown tool names fall back to the raw name without calling t()", () => {
    const t = vi.fn((key: string) => `T(${key})`);
    expect(humanizeToolName("brand_new_tool", t)).toBe("brand_new_tool");
    expect(t).not.toHaveBeenCalled(); // no missing-key Sentry noise
  });

  it.each(Object.entries(TOOL_LABEL_KEYS))(
    "%s → %s exists in zh-TW and en (en not Chinese)",
    (_tool, key) => {
      const zh = lookup(zhTW, key);
      const enVal = lookup(en, key);
      expect(zh, `${key} missing in zh-TW`).toBeTypeOf("string");
      expect(enVal, `${key} missing in en`).toBeTypeOf("string");
      // The whole point of the finding: English UI must not show Chinese.
      expect(enVal as string).not.toMatch(/[一-鿿]/);
    },
  );

  it("the zh-TW labels keep the original display strings", () => {
    expect(lookup(zhTW, TOOL_LABEL_KEYS.search_bookings)).toBe("查詢訂單");
    expect(lookup(zhTW, TOOL_LABEL_KEYS.draft_followup)).toBe("草擬跟進信");
  });

  it("the error fallback key exists in both bundles (en not Chinese)", () => {
    expect(lookup(zhTW, CHAT_ERROR_FALLBACK_KEY)).toBe("出錯了,請再試一次。");
    const enVal = lookup(en, CHAT_ERROR_FALLBACK_KEY);
    expect(enVal).toBeTypeOf("string");
    expect(enVal as string).not.toMatch(/[一-鿿]/);
  });
});

describe("parseSseChunk", () => {
  it("parses complete data: frames and keeps the incomplete tail", () => {
    const buf =
      'data: {"type":"token","text":"hi"}\n\n' +
      'data: {"type":"round_thinking","tools":["count_records"]}\n\n' +
      'data: {"type":"done","finalAnswer":"hi the';
    const { events, rest } = parseSseChunk(buf);
    expect(events).toEqual([
      { type: "token", text: "hi" },
      { type: "round_thinking", tools: ["count_records"] },
    ]);
    expect(rest).toContain('"finalAnswer":"hi the'); // incomplete frame held back
  });

  it("ignores malformed frames", () => {
    const { events } = parseSseChunk("data: not json\n\n");
    expect(events).toEqual([]);
  });
});
