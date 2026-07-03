/**
 * opsAgentStream — deterministic write-tool echo (2026-07-01 跟進日事故).
 *
 * Prod incident: Jeff said「7/20 跟進 改21」, the model claimed「跟進日已設在
 * 7/21」(persisted customerChatMessages id 30145) but customerProfiles.
 * followUpDate never changed — the tool either wasn't called or failed and the
 * model swallowed it. These tests run the REAL agent loop (scripted Anthropic
 * SDK, REAL executeWriteTool with a mocked DB) and feed its output through the
 * REAL persistence consumers (opsTurnContextJson + customerChatCompletionRows)
 * — followupDraftProducer style: no mock-shape-only assertions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../_core/env", () => ({ ENV: { anthropicApiKey: "test-key" } }));
// The prompt constants are plain strings — mock the module so the test does not
// drag in invokeLLM / the rest of opsAgent's dependency tree.
vi.mock("./opsAgent", () => ({
  SYSTEM_PROMPT: "test system prompt",
  ACTION_PROPOSAL_GUIDE: "test action guide",
  OPS_CHAT_MODEL: "test-model",
  OPS_CUSTOMER_CHAT_MODEL: "test-model-mini",
}));

// ── DB mock for the REAL executeWriteTool (set_follow_up_date path) ────────
const { mockUpdateSet, mockUpdateWhere } = vi.hoisted(() => ({
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(async () => undefined),
}));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({
    update: vi.fn(() => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return { where: mockUpdateWhere };
      },
    })),
  })),
}));
vi.mock("../../../drizzle/schema", () => ({
  customerProfiles: { id: "id", followUpDate: "followUpDate" },
}));
vi.mock("drizzle-orm", () => ({ eq: (..._a: unknown[]) => ({ _op: true }) }));

// ── Scripted Anthropic SDK: each messages.stream() call shifts one round ────
type FakeRound = { deltas: string[]; final: { stop_reason: string; content: unknown[] } };
const { roundQueue, streamCalls } = vi.hoisted(() => ({
  roundQueue: [] as FakeRound[],
  // Captures the raw params of every messages.stream() call (tool-gating tests
  // read .tools off the last entry — the scripts never inspect this).
  streamCalls: [] as any[],
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = {
      stream: (params: any) => {
        streamCalls.push(params);
        const round = roundQueue.shift();
        if (!round) throw new Error("test script exhausted — unexpected extra round");
        return {
          async *[Symbol.asyncIterator]() {
            for (const text of round.deltas) {
              yield { type: "content_block_delta", delta: { type: "text_delta", text } };
            }
          },
          finalMessage: async () => round.final,
        };
      },
    };
  },
}));

import { runOpsAgentStream, parseWriteToolResult, type StreamEvent } from "./opsAgentStream";
import {
  opsTurnContextJson,
  customerChatCompletionRows,
} from "../../_core/opsChatPersist";

async function collect(gen: AsyncGenerator<StreamEvent, void, void>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

beforeEach(() => {
  roundQueue.length = 0;
  streamCalls.length = 0;
  mockUpdateSet.mockClear();
  mockUpdateWhere.mockClear();
  // Freeze ONLY Date at the incident day (LA noon 2026-07-01) so the "7/21"
  // shorthand's year inference is deterministic. Timers stay real — the loop's
  // retry sleep is never hit in these scripts.
  vi.useFakeTimers({ now: new Date("2026-07-01T12:00:00-07:00"), toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("parseWriteToolResult — pure echo of executeWriteTool's JSON", () => {
  it("success carries the tool's own message verbatim", () => {
    expect(
      parseWriteToolResult("set_follow_up_date", '{"success":true,"message":"跟進日設為 2026-07-21"}'),
    ).toEqual({ name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" });
  });
  it("failure carries the error field, ok:false", () => {
    expect(parseWriteToolResult("set_follow_up_date", '{"error":"不是有效日期:x"}')).toEqual({
      name: "set_follow_up_date",
      ok: false,
      message: "不是有效日期:x",
    });
  });
  it("non-JSON (defensive) is a failure carrying the raw text", () => {
    const r = parseWriteToolResult("t", "boom");
    expect(r.ok).toBe(false);
    expect(r.message).toBe("boom");
  });

  describe("merge-rebind echo (2026-07-02 實測:merge 那輪對話留在已隱藏的來源檔底下)", () => {
    it("a successful merge carries the tool-reported targetProfileId", () => {
      const r = parseWriteToolResult(
        "merge_into_customer",
        '{"success":true,"targetProfileId":9,"moved":{"interactions":2},"message":"已把「Leslie」併入「Emerald Young」(#9)"}',
      );
      expect(r.ok).toBe(true);
      expect(r.targetProfileId).toBe(9);
    });
    it("a FAILED merge never carries a target (nothing moved, nothing to rebind)", () => {
      const r = parseWriteToolResult(
        "merge_into_customer",
        '{"error":"找不到要併入的客人(測試三號)"}',
      );
      expect(r.ok).toBe(false);
      expect(r.targetProfileId).toBeUndefined();
    });
    it("other tools never grow a targetProfileId even if their JSON has one", () => {
      const r = parseWriteToolResult(
        "update_customer_note",
        '{"success":true,"targetProfileId":9,"message":"備註已更新"}',
      );
      expect(r.ok).toBe(true);
      expect(r.targetProfileId).toBeUndefined();
    });
    it("a garbage targetProfileId on a successful merge is dropped, not propagated", () => {
      const r = parseWriteToolResult(
        "merge_into_customer",
        '{"success":true,"targetProfileId":"not-a-number","message":"ok"}',
      );
      expect(r.ok).toBe(true);
      expect(r.targetProfileId).toBeUndefined();
    });
  });
});

describe("the incident, replayed through the REAL loop + REAL consumers", () => {
  it("「7/20 跟進 改21」→ tool runs, tool_result streams, context.tools persists", async () => {
    roundQueue.push(
      {
        deltas: ["我把跟進日改一下"],
        final: {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "我把跟進日改一下" },
            {
              type: "tool_use",
              id: "tu_1",
              name: "set_follow_up_date",
              // The exact incident input — the M/D shorthand that used to be
              // rejected (and whose failure the model then swallowed).
              input: { followUpDate: "7/21" },
            },
          ],
        },
      },
      {
        deltas: ["好了,跟進日設在 7/21。"],
        final: { stop_reason: "end_turn", content: [{ type: "text", text: "好了,跟進日設在 7/21。" }] },
      },
    );

    const events = await collect(
      runOpsAgentStream("7/20 跟進 改21", [], undefined, undefined, undefined, 2550004, 1),
    );

    // 1. The REAL write executed with the resolved absolute date.
    expect(mockUpdateSet).toHaveBeenCalledWith({ followUpDate: "2026-07-21" });

    // 2. The stream emitted the deterministic echo, message carried verbatim.
    const echo = events.find((e) => e.type === "tool_result");
    expect(echo).toBeDefined();
    expect(echo).toMatchObject({
      type: "tool_result",
      name: "set_follow_up_date",
      ok: true,
      message: "跟進日設為 2026-07-21",
    });

    // 3. done carries the turn's write outcomes for persistence.
    const done = events.find((e) => e.type === "done")!;
    expect(done.toolResults).toEqual([
      { name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" },
    ]);
    expect(done.finalAnswer).toContain("跟進日");

    // 4. Fed through the REAL persistence consumers (what the route does at
    //    completion): the agent row's context.tools is the ground truth.
    const rows = customerChatCompletionRows(
      { kind: "guest", customerProfileId: 2550004 },
      null,
      "7/20 跟進 改21",
      done.finalAnswer!,
      false,
      opsTurnContextJson(done.suggestedActions ?? [], done.cards ?? [], done.toolResults ?? []),
    );
    expect(rows).toHaveLength(2);
    const persisted = JSON.parse(rows[1].context!);
    expect(persisted.tools).toEqual([
      { name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" },
    ]);
  });

  it("a REJECTED date → ok:false echo streams + persists; no DB write happens", async () => {
    roundQueue.push(
      {
        deltas: [],
        final: {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "set_follow_up_date",
              input: { followUpDate: "下週二" }, // still invalid even post-fix
            },
          ],
        },
      },
      {
        deltas: ["日期我看不懂,你要 7/21 還是 7/28?"],
        final: {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "日期我看不懂,你要 7/21 還是 7/28?" }],
        },
      },
    );

    const events = await collect(
      runOpsAgentStream("下週二跟進", [], undefined, undefined, undefined, 2550004, 1),
    );

    // No write reached the DB.
    expect(mockUpdateSet).not.toHaveBeenCalled();

    // The failure is visible — streamed AND persisted, never swallowed.
    const echo = events.find((e) => e.type === "tool_result")!;
    expect(echo.ok).toBe(false);
    expect(echo.message).toContain("日期格式");

    const done = events.find((e) => e.type === "done")!;
    expect(done.toolResults).toHaveLength(1);
    expect(done.toolResults![0].ok).toBe(false);

    const persisted = JSON.parse(
      opsTurnContextJson(done.suggestedActions ?? [], done.cards ?? [], done.toolResults ?? []),
    );
    expect(persisted.tools[0]).toMatchObject({ name: "set_follow_up_date", ok: false });
  });

  it("a pure-text answer emits NO tool_result and persists NO tools key", async () => {
    roundQueue.push({
      deltas: ["Jenny 最後一封是 6/20,輪到你回。"],
      final: {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Jenny 最後一封是 6/20,輪到你回。" }],
      },
    });

    const events = await collect(
      runOpsAgentStream("Jenny 進度?", [], undefined, undefined, undefined, 2550004, 1),
    );
    expect(events.some((e) => e.type === "tool_result")).toBe(false);
    const done = events.find((e) => e.type === "done")!;
    expect(done.toolResults).toEqual([]);
    const persisted = JSON.parse(
      opsTurnContextJson(done.suggestedActions ?? [], done.cards ?? [], done.toolResults ?? []),
    );
    expect(persisted).not.toHaveProperty("tools");
  });
});

describe("create_customer tool gating (A5 — context-confusion fix, 2026-07-03)", () => {
  // Creating a NEW customer while already pinned to a specific one is a
  // context-confusion bug Jeff flagged: the tool must vanish from the list
  // (not just be discouraged in prose) whenever draftProfileId is set, and
  // must stay available in office-wide (unpinned) chat.
  function toolNames(callIndex = 0): string[] {
    return (streamCalls[callIndex]?.tools ?? []).map((t: any) => t.name);
  }

  it("pinned chat (draftProfileId set): create_customer is ABSENT, draft_followup IS present", async () => {
    roundQueue.push({
      deltas: ["好的"],
      final: { stop_reason: "end_turn", content: [{ type: "text", text: "好的" }] },
    });

    await collect(
      runOpsAgentStream("新增客人 小明", [], undefined, undefined, undefined, 2550004, 1),
    );

    const names = toolNames();
    expect(names).not.toContain("create_customer");
    expect(names).toContain("draft_followup");
  });

  it("office-wide chat (no draftProfileId): create_customer IS present, draft_followup is ABSENT", async () => {
    roundQueue.push({
      deltas: ["好的"],
      final: { stop_reason: "end_turn", content: [{ type: "text", text: "好的" }] },
    });

    await collect(runOpsAgentStream("新增客人 小明", [], undefined, undefined, undefined));

    const names = toolNames();
    expect(names).toContain("create_customer");
    expect(names).not.toContain("draft_followup");
  });

  it("staticSystem prompt text mirrors the tool list: 新增客人 instruction only appears when unpinned", async () => {
    roundQueue.push(
      { deltas: ["好的"], final: { stop_reason: "end_turn", content: [{ type: "text", text: "好的" }] } },
      { deltas: ["好的"], final: { stop_reason: "end_turn", content: [{ type: "text", text: "好的" }] } },
    );

    await collect(runOpsAgentStream("q1", [], undefined, undefined, undefined, 2550004, 1));
    await collect(runOpsAgentStream("q2", [], undefined, undefined, undefined));

    const pinnedSystem = streamCalls[0].system.map((b: any) => b.text).join("\n");
    const unpinnedSystem = streamCalls[1].system.map((b: any) => b.text).join("\n");

    expect(pinnedSystem).not.toContain("呼叫 create_customer");
    expect(pinnedSystem).toContain("沒有** create_customer 工具");
    expect(unpinnedSystem).toContain("呼叫 create_customer");
  });
});
