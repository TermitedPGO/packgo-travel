/**
 * M3 tests (customer-ai-sessions) — customerAiSummary.
 *
 * LLM + context + db are mocked: no Anthropic call, no DB. Covers the pure
 * parse + staleness rules and the generate path (context → LLM → 4 fields).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./customerChatContext", () => ({
  buildCustomerChatContext: vi.fn(),
  buildGuestChatContext: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { invokeLLM } from "./llm";
import {
  buildCustomerChatContext,
  buildGuestChatContext,
} from "./customerChatContext";
import {
  parseSummaryResult,
  isSummaryStale,
  generateCustomerAiSummary,
  pickStaleProfiles,
  SUMMARY_TTL_MS,
  type ScanRow,
} from "./customerAiSummary";

const invokeLLMMock = vi.mocked(invokeLLM);
const buildCustomerChatContextMock = vi.mocked(buildCustomerChatContext);
const buildGuestChatContextMock = vi.mocked(buildGuestChatContext);

function llmResult(content: string) {
  return {
    id: "x",
    created: 0,
    model: "claude-haiku-4-5",
    choices: [{ index: 0, message: { role: "assistant" as const, content }, finish_reason: "stop" }],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("parseSummaryResult", () => {
  it("parses the four fields from JSON", () => {
    const r = parseSummaryResult(
      JSON.stringify({ wants: "12月台灣團", actions: "已報價", delivered: "報價單", nextStep: "補早鳥價" }),
    );
    expect(r).toEqual({
      wants: "12月台灣團",
      actions: "已報價",
      delivered: "報價單",
      nextStep: "補早鳥價",
    });
  });

  it("degrades to empty strings on bad JSON or missing fields", () => {
    expect(parseSummaryResult("not json")).toEqual({
      wants: "",
      actions: "",
      delivered: "",
      nextStep: "",
    });
    expect(parseSummaryResult(JSON.stringify({ wants: 123 }))).toEqual({
      wants: "",
      actions: "",
      delivered: "",
      nextStep: "",
    });
  });
});

describe("isSummaryStale", () => {
  const now = 1_000_000_000_000;
  it("is stale when never generated", () => {
    expect(isSummaryStale(null, null, now)).toBe(true);
  });
  it("is stale past the TTL", () => {
    expect(isSummaryStale(new Date(now - SUMMARY_TTL_MS - 1), null, now)).toBe(true);
  });
  it("is stale when there is newer activity than the summary", () => {
    const gen = new Date(now - 1000);
    const newerActivity = new Date(now - 500);
    expect(isSummaryStale(gen, newerActivity, now)).toBe(true);
  });
  it("is fresh when recent and no newer activity", () => {
    const gen = new Date(now - 1000);
    const olderActivity = new Date(now - 5000);
    expect(isSummaryStale(gen, olderActivity, now)).toBe(false);
  });
});

describe("pickStaleProfiles (cron selection)", () => {
  const now = 2_000_000_000_000;
  const fresh = new Date(now - 1000);
  const old = new Date(now - SUMMARY_TTL_MS - 1000);
  const rows: ScanRow[] = [
    // registered, never computed → stale → {userId}
    { id: 10, userId: 7, lastInteractionAt: fresh, aiSummaryAt: null },
    // guest, summary older than its activity → stale → {profileId}
    { id: 11, userId: null, lastInteractionAt: fresh, aiSummaryAt: old },
    // fresh summary, no newer activity → NOT stale → skipped
    { id: 12, userId: null, lastInteractionAt: old, aiSummaryAt: fresh },
  ];

  it("returns scopes only for stale rows, mapping userId vs profileId", () => {
    const scopes = pickStaleProfiles(rows, now, 50);
    expect(scopes).toEqual([{ userId: 7 }, { profileId: 11 }]);
  });

  it("caps at maxRefresh", () => {
    expect(pickStaleProfiles(rows, now, 1)).toEqual([{ userId: 7 }]);
  });
});

describe("generateCustomerAiSummary", () => {
  it("feeds the guest context to the LLM and returns the parsed summary", async () => {
    buildGuestChatContextMock.mockResolvedValue("【訪客】jenny… 文件:台灣報價");
    invokeLLMMock.mockResolvedValue(
      llmResult(
        JSON.stringify({
          wants: "想要12月台灣團",
          actions: "已寄兩份報價",
          delivered: "台灣12天報價單",
          nextStep: "跟進她對行程的回覆",
        }) as any,
      ) as any,
    );

    const r = await generateCustomerAiSummary({ profileId: 2550004 });
    expect(r.wants).toContain("台灣團");
    expect(r.nextStep).toContain("跟進");
    // context was actually passed into the prompt
    const arg = invokeLLMMock.mock.calls[0][0] as any;
    expect(JSON.stringify(arg.messages)).toContain("台灣報價");
    expect(arg.model).toBe("claude-haiku-4-5");
  });

  it("uses the registered builder for a userId scope", async () => {
    buildCustomerChatContextMock.mockResolvedValue("【客人】#7 …");
    invokeLLMMock.mockResolvedValue(
      llmResult(JSON.stringify({ wants: "a", actions: "b", delivered: "c", nextStep: "d" }) as any) as any,
    );
    await generateCustomerAiSummary({ userId: 7 });
    expect(buildCustomerChatContextMock).toHaveBeenCalledWith(7);
    expect(buildGuestChatContextMock).not.toHaveBeenCalled();
  });

  it("throws when no context (db down / customer gone)", async () => {
    buildGuestChatContextMock.mockResolvedValue(null);
    await expect(generateCustomerAiSummary({ profileId: 1 })).rejects.toThrow();
  });
});
