/**
 * push/poll 併發重複處理同一封信 (P1, 2026-07-01) — tests for the per-message
 * Redis SET NX lock (processWithMessageLock) that closes the check-then-act
 * window between the Pub/Sub push worker and the 3-min poll worker: the
 * PACKGO_AI_PROCESSED label is only applied AFTER processOneEmail's full LLM
 * chain (30–120s), so without the lock both paths process the same message
 * as fresh (double LLM spend + duplicate office-inbox cards).
 *
 * Heavy collaborators (db / gmail / LLM agents / storage / redis) are mocked
 * BEFORE importing gmailPipeline so the module graph stays cheap — same
 * pattern as routers/agent/agent.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const redisSet = vi.fn();
vi.mock("../../redis", () => ({
  redis: { set: (...args: unknown[]) => redisSet(...args) },
  redisBullMQ: {},
  default: { set: (...args: unknown[]) => redisSet(...args) },
}));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  createPendingExpense: vi.fn(),
  getPendingExpenseByGmailMessageId: vi.fn(),
}));
vi.mock("../../_core/gmail", () => ({
  buildGmailClient: vi.fn(),
  listUnreadMessages: vi.fn(),
  listMessagesByIds: vi.fn(),
  listHistoryMessageIds: vi.fn(),
  selectIngestableMessages: vi.fn(),
  ensureLabel: vi.fn(),
  applyLabel: vi.fn(),
  sendReplyInThread: vi.fn(),
  fetchRawAttachments: vi.fn(),
}));
vi.mock("../../_core/receiptExtractor", () => ({
  detectReceipt: vi.fn(),
  extractReceipt: vi.fn(),
  pickReceiptAttachment: vi.fn(),
}));
vi.mock("../../storage", () => ({ storagePut: vi.fn() }));
vi.mock("./inquiryAgent", () => ({
  runInquiryAgent: vi.fn(),
  DEFAULT_INQUIRY_POLICY: {},
}));
vi.mock("./refundAgent", () => ({
  runRefundAgent: vi.fn(),
  DEFAULT_REFUND_POLICY: {},
}));
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { processWithMessageLock } from "./gmailPipeline";

describe("processWithMessageLock (push/poll cross-worker dedup)", () => {
  beforeEach(() => {
    redisSet.mockReset();
  });

  it("lock free → acquires SET NX EX lock (keyed by gmail message id) and processes", async () => {
    redisSet.mockResolvedValue("OK");
    const fn = vi.fn(async () => {});
    const ran = await processWithMessageLock("msg-123", fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(redisSet).toHaveBeenCalledWith(
      "gmail:msg-lock:msg-123",
      "1",
      "EX",
      300,
      "NX",
    );
  });

  it("lock held by the other path → skips (fn never runs, no retry)", async () => {
    // ioredis SET ... NX returns null when the key already exists
    redisSet.mockResolvedValue(null);
    const fn = vi.fn(async () => {});
    const ran = await processWithMessageLock("msg-123", fn);
    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("Redis down → fail-open: processes anyway (never drop customer mail)", async () => {
    redisSet.mockRejectedValue(new Error("ECONNREFUSED"));
    const fn = vi.fn(async () => {});
    const ran = await processWithMessageLock("msg-123", fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fn errors propagate unchanged (caller's totalFailed accounting intact)", async () => {
    redisSet.mockResolvedValue("OK");
    await expect(
      processWithMessageLock("msg-123", async () => {
        throw new Error("LLM exploded");
      }),
    ).rejects.toThrow("LLM exploded");
  });

  it("push + poll racing on the SAME message → exactly one path processes", async () => {
    // Simulate real SET NX semantics: first caller wins, second sees the key.
    const held = new Set<string>();
    redisSet.mockImplementation(async (key: string) => {
      if (held.has(key)) return null;
      held.add(key);
      return "OK";
    });
    const runs: string[] = [];
    const [pushRan, pollRan] = await Promise.all([
      processWithMessageLock("msg-dup", async () => {
        runs.push("push");
      }),
      processWithMessageLock("msg-dup", async () => {
        runs.push("poll");
      }),
    ]);
    expect([pushRan, pollRan].filter(Boolean)).toHaveLength(1);
    expect(runs).toHaveLength(1);
  });

  it("different messages don't block each other", async () => {
    const held = new Set<string>();
    redisSet.mockImplementation(async (key: string) => {
      if (held.has(key)) return null;
      held.add(key);
      return "OK";
    });
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    expect(await processWithMessageLock("msg-a", a)).toBe(true);
    expect(await processWithMessageLock("msg-b", b)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
