/**
 * chatStream reducer — the 斷句 fix, unit-tested without an LLM. The load-bearing
 * case: an agentic turn (bridge sentence → tool round → real answer) keeps the
 * thinking as a separate dim step and never concatenates it into the answer.
 */
import { describe, it, expect } from "vitest";
import {
  emptyTurn,
  reduceChatEvent,
  parseSseChunk,
  type ChatTurn,
} from "./chatStream";

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

  it("status is ignored (superseded by round_thinking)", () => {
    const t = run([{ type: "token", text: "a" }, { type: "status", text: "查詢中" }]);
    expect(t.live).toBe("a");
    expect(t.steps).toEqual([]);
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
