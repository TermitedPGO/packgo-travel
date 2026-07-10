/**
 * observabilityCounters tests (Wave1 Block C — D1 週稽核觀測計數器).
 *
 * Covers each of the three never-throwing collectors independently
 * (gatherMessagesFailedWeeklyDelta / gatherQueueFailedCounts /
 * gatherLlmCircuitStats), plus formatObservabilitySection's pure text
 * assembly across all the "healthy" / "⚠ alarm" / "couldn't read" states.
 *
 * No real Redis or DB — every collector's IO surface is mocked directly.
 * Fully independent of weeklyCorrectnessAudit.test.ts's own mocks (different
 * test file → different vi.mock registry).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const redisGetMock = vi.fn();
const redisSetMock = vi.fn().mockResolvedValue("OK");
const redisHmgetMock = vi.fn();
vi.mock("../redis", () => ({
  redis: {
    get: (...args: unknown[]) => redisGetMock(...args),
    set: (...args: unknown[]) => redisSetMock(...args),
    hmget: (...args: unknown[]) => redisHmgetMock(...args),
  },
}));

// gatherQueueFailedCounts's queue-module fan-out: "../queue" carries three
// fake Queue-like exports (good / always-zero / rejecting) plus one
// non-queue export to prove isQueueLike() actually filters. Every other
// queue-definition module is stubbed empty EXCEPT supplierSyncQueue, whose
// factory deliberately throws — proving one module's import failure never
// blocks the other modules' queues from being collected.
//
// 近 7 天口徑:mock 的是 getFailed(start,end)(回 job 本體帶 finishedOn),不是
// getFailedCount()。固定 now = 2026-07-09;recent = 近 7 天內、old = 30 天前。
const TEST_NOW = new Date("2026-07-09T00:00:00Z");
const RECENT = TEST_NOW.getTime() - 1 * 24 * 60 * 60 * 1000; // 1 天前(窗內)
const OLD = TEST_NOW.getTime() - 30 * 24 * 60 * 60 * 1000; // 30 天前(窗外,如 gmail-poll 6/17 殘留)
// fake-good-queue:3 筆近期 + 2 筆舊殘留 → 近 7 天口徑只該數到 3(舊的被濾掉)。
const fakeGoodQueueGetFailed = vi
  .fn()
  .mockResolvedValue([
    { finishedOn: RECENT },
    { finishedOn: RECENT },
    { finishedOn: RECENT },
    { finishedOn: OLD },
    { finishedOn: OLD },
  ]);
// fake-zero-queue:只有舊殘留(模擬 gmail-poll:36 筆全是 6/17 的舊 failed)→ 近 7 天口徑=0,假警告消。
const fakeZeroQueueGetFailed = vi.fn().mockResolvedValue([{ finishedOn: OLD }, { finishedOn: OLD }]);
const fakeBadQueueGetFailed = vi.fn().mockRejectedValue(new Error("redis down for this one queue"));
vi.mock("../queue", () => ({
  fakeGoodQueue: { name: "fake-good-queue", getFailed: (...a: unknown[]) => fakeGoodQueueGetFailed(...a) },
  fakeZeroQueue: { name: "fake-zero-queue", getFailed: (...a: unknown[]) => fakeZeroQueueGetFailed(...a) },
  fakeBadQueue: { name: "fake-bad-queue", getFailed: (...a: unknown[]) => fakeBadQueueGetFailed(...a) },
  someUnrelatedExport: "not a queue — isQueueLike() must ignore this",
}));
vi.mock("../queues/abandonmentRecoveryQueue", () => ({}));
vi.mock("../queues/packpointMaintenanceQueue", () => ({}));
vi.mock("../queues/posterProcessingQueue", () => ({}));
vi.mock("../queues/priorityRewriteCron", () => ({}));
vi.mock("../queues/quoteFollowUpQueue", () => ({}));
vi.mock("../queues/supplierSyncQueue", () => {
  throw new Error("simulated module-load failure for supplierSyncQueue");
});

import {
  gatherMessagesFailedWeeklyDelta,
  gatherQueueFailedCounts,
  gatherLlmCircuitStats,
  formatObservabilitySection,
  WEEKLY_AUDIT_MESSAGES_FAILED_SNAPSHOT_KEY,
  type Db,
} from "./observabilityCounters";

function fakeDbWithRows(rows: Array<{ messagesFailed: number }>): Db {
  return {
    select: () => ({
      from: () => Promise.resolve(rows),
    }),
  } as unknown as Db;
}

describe("gatherMessagesFailedWeeklyDelta", () => {
  beforeEach(() => {
    redisGetMock.mockReset();
    redisSetMock.mockReset().mockResolvedValue("OK");
  });

  it("first call (no prior snapshot in Redis) → {kind:'first-run'}, and writes the current total as the new snapshot", async () => {
    redisGetMock.mockResolvedValueOnce(null);
    const db = fakeDbWithRows([{ messagesFailed: 5 }, { messagesFailed: 3 }]); // total 8
    const result = await gatherMessagesFailedWeeklyDelta(db, new Date("2026-07-06T12:00:00Z"));
    expect(result).toEqual({ kind: "first-run" });
    expect(redisSetMock).toHaveBeenCalledWith(WEEKLY_AUDIT_MESSAGES_FAILED_SNAPSHOT_KEY, "8");
  });

  it("second call (prior snapshot exists) → correct delta (current - previous), and rewrites the snapshot to the new total", async () => {
    redisGetMock.mockResolvedValueOnce("8");
    const db = fakeDbWithRows([{ messagesFailed: 6 }, { messagesFailed: 5 }]); // total 11
    const result = await gatherMessagesFailedWeeklyDelta(db, new Date("2026-07-13T12:00:00Z"));
    expect(result).toEqual({ kind: "delta", value: 3 });
    expect(redisSetMock).toHaveBeenCalledWith(WEEKLY_AUDIT_MESSAGES_FAILED_SNAPSHOT_KEY, "11");
  });

  it("multiple gmailIntegration rows are summed, not just the first row read", async () => {
    redisGetMock.mockResolvedValueOnce("0");
    const db = fakeDbWithRows([{ messagesFailed: 1 }, { messagesFailed: 2 }, { messagesFailed: 4 }]);
    const result = await gatherMessagesFailedWeeklyDelta(db, new Date());
    expect(result).toEqual({ kind: "delta", value: 7 });
  });

  it("DB read failure → {kind:'error'}, function never throws", async () => {
    const db = { select: () => ({ from: () => Promise.reject(new Error("DB blip")) }) } as unknown as Db;
    const result = await gatherMessagesFailedWeeklyDelta(db, new Date());
    expect(result).toEqual({ kind: "error" });
  });

  it("Redis read failure → {kind:'error'}, function never throws", async () => {
    redisGetMock.mockRejectedValueOnce(new Error("redis down"));
    const db = fakeDbWithRows([{ messagesFailed: 1 }]);
    const result = await gatherMessagesFailedWeeklyDelta(db, new Date());
    expect(result).toEqual({ kind: "error" });
  });

  it("Redis write failure → {kind:'error'}, function never throws", async () => {
    redisGetMock.mockResolvedValueOnce("0");
    redisSetMock.mockRejectedValueOnce(new Error("redis write blip"));
    const db = fakeDbWithRows([{ messagesFailed: 1 }]);
    const result = await gatherMessagesFailedWeeklyDelta(db, new Date());
    expect(result).toEqual({ kind: "error" });
  });
});

describe("gatherQueueFailedCounts (近 7 天口徑)", () => {
  it("只數 finishedOn 落在近 7 天內的 failed job — 舊殘留被濾掉;per-queue / per-module 獨立 try/catch,never throws", async () => {
    const results = await gatherQueueFailedCounts(TEST_NOW);
    const byName = Object.fromEntries(results.map((r) => [r.queueName, r.failed]));

    // fake-good:3 近期 + 2 舊 → 只數到 3(舊的在窗外)。
    expect(byName["fake-good-queue"]).toBe(3);
    // fake-zero:全是舊殘留(gmail-poll 6/17 那類)→ 近 7 天=0,不再是永久假警告。
    expect(byName["fake-zero-queue"]).toBe(0);
    // 這個 queue 自己的 getFailed() rejected → null(明確「沒讀到」),不是被吞、也不是 throw 出去。
    expect(byName["fake-bad-queue"]).toBeNull();
    // "../queue" 的非 Queue export 不該被當 queue。
    expect(Object.keys(byName)).not.toContain("someUnrelatedExport");
    // supplierSyncQueue 模組載入自己 reject;它(mock 空)貢獻 0 個 queue,且不擋上面三個
    // (來自另一個成功載入的模組)被收集。
    expect(results).toHaveLength(3);
  });

  it("單 queue 掃描上限 500(getFailed 以 (0, 499) 呼叫,防 failed 集合爆量)", async () => {
    await gatherQueueFailedCounts(TEST_NOW);
    expect(fakeGoodQueueGetFailed).toHaveBeenCalledWith(0, 499);
  });

  it("finishedOn 缺失 / 非數字的 job 不計入(只認明確落在窗內的 finishedOn)", async () => {
    fakeGoodQueueGetFailed.mockResolvedValueOnce([
      { finishedOn: RECENT }, // 計
      { finishedOn: OLD }, // 不計(窗外)
      { finishedOn: null }, // 不計(缺)
      {}, // 不計(缺)
    ]);
    const results = await gatherQueueFailedCounts(TEST_NOW);
    expect(results.find((r) => r.queueName === "fake-good-queue")?.failed).toBe(1);
  });

  it("queueName is the actual BullMQ queue name (the .name property), never a source-level variable name", async () => {
    const results = await gatherQueueFailedCounts(TEST_NOW);
    expect(results.some((r) => r.queueName === "fake-good-queue")).toBe(true);
    expect(results.some((r) => r.queueName === "fakeGoodQueue")).toBe(false);
  });
});

describe("gatherLlmCircuitStats", () => {
  beforeEach(() => {
    redisHmgetMock.mockReset();
  });

  it("sums circuit_opened/rate_limit_429/calls_total across exactly the past 7 UTC calendar days (today + 6 before), matching bumpStat's UTC-only key derivation", async () => {
    const now = new Date("2026-07-08T03:00:00Z"); // UTC calendar day = 2026-07-08
    const seenKeys: string[] = [];
    redisHmgetMock.mockImplementation((key: string) => {
      seenKeys.push(key);
      if (key === "llm:stats:2026-07-08") return Promise.resolve(["1", "2", "10"]);
      if (key === "llm:stats:2026-07-02") return Promise.resolve(["0", "1", "5"]); // exactly 6 days back
      return Promise.resolve([null, null, null]); // missing day = normal, counts as 0
    });

    const result = await gatherLlmCircuitStats(now);

    expect(result).toEqual({ kind: "ok", circuitOpened: 1, rateLimit429: 3, callsTotal: 15 });
    expect(seenKeys.slice().sort()).toEqual(
      ["2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08"]
        .map((d) => `llm:stats:${d}`)
        .sort(),
    );
  });

  it("a UTC day boundary near midnight is NOT shifted by any local/LA timezone math (bumpStat writes pure UTC calendar days, so reads must too)", async () => {
    // 03:00 UTC on 2026-01-01 is still 2026-01-01 in UTC, but is already
    // 2025-12-31 (19:00 previous evening) in US Pacific (todayLA()). If this
    // function ever used LA-day logic instead of bumpStat's actual UTC-day
    // logic, "today" would resolve to 2025-12-31 and the 7-day window would
    // shift one day older across the board — reaching all the way back to
    // 2025-12-25 instead of the correct 2025-12-26, and never touching
    // 2026-01-01 (today in UTC) at all.
    const now = new Date("2026-01-01T03:00:00Z");
    redisHmgetMock.mockResolvedValue([null, null, null]);
    await gatherLlmCircuitStats(now);
    const calledKeys = redisHmgetMock.mock.calls.map((c) => c[0]);
    expect(calledKeys).toContain("llm:stats:2026-01-01"); // correct UTC "today"
    expect(calledKeys).not.toContain("llm:stats:2025-12-25"); // only reachable via wrong LA-shifted "today"
    expect(calledKeys.slice().sort()).toEqual(
      ["2025-12-26", "2025-12-27", "2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01"]
        .map((d) => `llm:stats:${d}`)
        .sort(),
    );
  });

  it("Redis failure → {kind:'error'}, function never throws", async () => {
    redisHmgetMock.mockRejectedValue(new Error("redis down"));
    const result = await gatherLlmCircuitStats(new Date());
    expect(result).toEqual({ kind: "error" });
  });
});

describe("formatObservabilitySection", () => {
  it("all-healthy inputs → exactly a header + three plain lines, NO ⚠ anywhere, zeros shown explicitly (never omitted)", () => {
    const text = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: 0 },
      queueFailedCounts: [
        { queueName: "q1", failed: 0 },
        { queueName: "q2", failed: 0 },
      ],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 42 },
    });
    const lines = text.split("\n");
    expect(lines).toHaveLength(4); // header line + 3 counter lines, always
    expect(lines[0]).toBe("觀測計數器");
    expect(text).not.toContain("⚠");
    expect(text).toContain("messagesFailed 週增量:0");
    expect(text).toContain("各 queue failed 數:全部 queue failed=0");
    expect(text).toContain("calls_total=42");
  });

  it("first-run messagesFailed baseline is distinguishable text, never conflated with a genuine delta of 0", () => {
    const text = formatObservabilitySection({
      messagesFailedDelta: { kind: "first-run" },
      queueFailedCounts: [],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 0 },
    });
    expect(text).toContain("首次基線");
    expect(text).not.toContain("messagesFailed 週增量:0");
  });

  it("non-zero messagesFailed delta gets a ⚠ prefix; a negative delta does not", () => {
    const grew = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: 7 },
      queueFailedCounts: [],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 0 },
    });
    expect(grew).toContain("⚠ messagesFailed 週增量:7");

    const shrank = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: -2 },
      queueFailedCounts: [],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 0 },
    });
    expect(shrank).toContain("messagesFailed 週增量:-2");
    expect(shrank).not.toContain("⚠ messagesFailed");
  });

  it("some queues non-zero → ⚠ line lists ONLY the non-zero ones, healthy queues are omitted from the listing", () => {
    const text = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: 0 },
      queueFailedCounts: [
        { queueName: "tour-generation", failed: 0 },
        { queueName: "gmail-poll", failed: 4 },
        { queueName: "weekly-canary", failed: 0 },
      ],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 0 },
    });
    expect(text).toContain("⚠ 各 queue failed 數:gmail-poll=4");
    expect(text).not.toContain("tour-generation");
    expect(text).not.toContain("weekly-canary");
  });

  it("a queue whose failed count couldn't be read (null) shows as name=? and still triggers the ⚠ line even with zero real failures elsewhere", () => {
    const text = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: 0 },
      queueFailedCounts: [
        { queueName: "supplier-sync", failed: null },
        { queueName: "marketing", failed: 0 },
      ],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 0 },
    });
    expect(text).toContain("⚠ 各 queue failed 數:supplier-sync=?");
    expect(text).not.toContain("marketing");
  });

  it("F2 塊B:trustInvariantLine 提供時附加為第 5 行;省略時輸出 byte-identical 於三行版(向後相容)", () => {
    const base = {
      messagesFailedDelta: { kind: "delta", value: 0 } as const,
      queueFailedCounts: [],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 0 } as const,
    };
    const without = formatObservabilitySection(base);
    const withLine = formatObservabilitySection({
      ...base,
      trustInvariantLine: "Trust 勾稽:餘額 $100.00 vs 遞延帳 $100.00(未認列 $100.00 + 已認列未轉出 $0.00)→ 漂移 $0.00",
    });
    expect(withLine.split("\n")).toHaveLength(5);
    expect(withLine).toContain("Trust 勾稽");
    expect(withLine.startsWith(without)).toBe(true); // 前四行 byte-identical
    expect(formatObservabilitySection({ ...base, trustInvariantLine: undefined })).toBe(without);
  });

  it("messagesFailed read failure → distinguishable 'couldn't read' text, never silently shown as 0", () => {
    const text = formatObservabilitySection({
      messagesFailedDelta: { kind: "error" },
      queueFailedCounts: [],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 0 },
    });
    expect(text).toContain("無法讀取");
    expect(text).not.toContain("messagesFailed 週增量:0");
  });

  it("LLM circuit read failure → distinguishable 'couldn't read' text, never silently shown as 0", () => {
    const text = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: 0 },
      queueFailedCounts: [],
      llmCircuitStats: { kind: "error" },
    });
    expect(text).toContain("LLM circuit 統計(近 7 天):無法讀取");
  });

  it("circuit_opened>0 or rate_limit_429>0 → ⚠ prefix on the LLM line; calls_total alone never triggers it", () => {
    const circuitTripped = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: 0 },
      queueFailedCounts: [],
      llmCircuitStats: { kind: "ok", circuitOpened: 2, rateLimit429: 0, callsTotal: 50 },
    });
    expect(circuitTripped).toContain("⚠ LLM circuit 統計");

    const rateLimited = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: 0 },
      queueFailedCounts: [],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 3, callsTotal: 50 },
    });
    expect(rateLimited).toContain("⚠ LLM circuit 統計");

    const busyButHealthy = formatObservabilitySection({
      messagesFailedDelta: { kind: "delta", value: 0 },
      queueFailedCounts: [],
      llmCircuitStats: { kind: "ok", circuitOpened: 0, rateLimit429: 0, callsTotal: 9999 },
    });
    expect(busyButHealthy).not.toContain("⚠ LLM circuit 統計");
  });
});
