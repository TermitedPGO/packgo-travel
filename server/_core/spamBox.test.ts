/**
 * Tests for spamBox — the 疑似垃圾匣 spine (批1 m3a).
 *
 * Key invariants under test (design.md §2 rule 4 + Jeff 2026-06-09 拍板):
 *   - rescue creates a REAL inquiry first, marks 'rescued' BEFORE the LLM
 *     call (no duplicate inquiry on retry), and reports agent failures
 *     honestly instead of pretending.
 *   - confirm never deletes; rescued rows cannot be re-confirmed as spam.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
  createInquiry: vi.fn(),
}));
vi.mock("../agents/autonomous/inquiryAgent", () => ({
  runInquiryAgent: vi.fn(),
}));
vi.mock("../agents/autonomous/inquiryReplyProducer", () => ({
  produceInquiryReplyTask: vi.fn(),
}));
vi.mock("./auditLog", () => ({
  audit: vi.fn(),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getDb, createInquiry } from "../db";
import { runInquiryAgent } from "../agents/autonomous/inquiryAgent";
import { produceInquiryReplyTask } from "../agents/autonomous/inquiryReplyProducer";
import {
  listSpamInteractions,
  rescueSpamInteraction,
  confirmSpamInteraction,
} from "./spamBox";

const getDbMock = vi.mocked(getDb);
const createInquiryMock = vi.mocked(createInquiry);
const runAgentMock = vi.mocked(runInquiryAgent);
const produceMock = vi.mocked(produceInquiryReplyTask);

/** Thenable drizzle-chain fake: every builder method returns itself and the
 *  whole chain resolves to `result` when awaited (at any depth). */
function fakeChain(result: unknown) {
  const p: any = {};
  for (const m of [
    "select",
    "from",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "update",
    "set",
  ]) {
    p[m] = () => p;
  }
  p.then = (onOk: any, onErr: any) =>
    Promise.resolve(result).then(onOk, onErr);
  return p;
}

/** db whose successive select()/update() calls resolve the queued results. */
function fakeDb(queue: unknown[]) {
  let i = 0;
  const next = () => fakeChain(queue[i++] ?? []);
  return { select: next, update: next } as any;
}

const SPAM_ROW = {
  id: 7,
  customerProfileId: 3,
  content: "九月想帶媽媽去日本,有推薦的團嗎",
  summary: "客人問九月日本團",
  verdict: null,
  classification: "spam",
  email: "mei@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSpamInteractions", () => {
  it("returns [] when db unavailable", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    expect(await listSpamInteractions()).toEqual([]);
  });

  it("returns spam rows newest first (passthrough)", async () => {
    const rows = [{ id: 9, email: "x@y.z", verdict: null }];
    getDbMock.mockResolvedValue(fakeDb([rows]));
    expect(await listSpamInteractions(10)).toEqual(rows);
  });
});

describe("rescueSpamInteraction", () => {
  it("throws for missing / non-spam / already-rescued rows", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]]));
    await expect(rescueSpamInteraction(1)).rejects.toThrow("not found");

    getDbMock.mockResolvedValue(
      fakeDb([[{ ...SPAM_ROW, classification: "new_inquiry" }]]),
    );
    await expect(rescueSpamInteraction(7)).rejects.toThrow(
      "not spam-classified",
    );

    getDbMock.mockResolvedValue(
      fakeDb([[{ ...SPAM_ROW, verdict: "rescued" }]]),
    );
    await expect(rescueSpamInteraction(7)).rejects.toThrow("already rescued");
  });

  it("creates the inquiry, marks rescued, then drafts via the normal cs path", async () => {
    getDbMock.mockResolvedValue(fakeDb([[SPAM_ROW], []]));
    createInquiryMock.mockResolvedValue({ id: 42 } as any);
    runAgentMock.mockResolvedValue({ classification: "new_inquiry" } as any);
    produceMock.mockResolvedValue({ id: 99, riskLevel: "review" } as any);

    const res = await rescueSpamInteraction(7);

    expect(createInquiryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inquiryType: "general",
        customerName: "mei@example.com",
        customerEmail: "mei@example.com",
        message: SPAM_ROW.content,
        status: "new",
      }),
    );
    expect(produceMock).toHaveBeenCalledWith(
      expect.objectContaining({ inquiryId: 42 }),
      expect.anything(),
      undefined,
    );
    expect(res).toEqual({
      inquiryId: 42,
      taskId: 99,
      riskLevel: "review",
      agentError: undefined,
    });
  });

  it("agent failure → inquiry still created, honest agentError, taskId null", async () => {
    getDbMock.mockResolvedValue(fakeDb([[SPAM_ROW], []]));
    createInquiryMock.mockResolvedValue({ id: 43 } as any);
    runAgentMock.mockRejectedValue(new Error("LLM down"));

    const res = await rescueSpamInteraction(7);

    expect(res.inquiryId).toBe(43);
    expect(res.taskId).toBeNull();
    expect(res.agentError).toContain("LLM down");
  });

  it("uses 未知寄件人 when the profile has no email", async () => {
    getDbMock.mockResolvedValue(fakeDb([[{ ...SPAM_ROW, email: null }], []]));
    createInquiryMock.mockResolvedValue({ id: 44 } as any);
    runAgentMock.mockResolvedValue({} as any);
    produceMock.mockResolvedValue({ id: 100, riskLevel: "review" } as any);

    await rescueSpamInteraction(7);

    expect(createInquiryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: "未知寄件人",
        customerEmail: "",
      }),
    );
  });
});

describe("confirmSpamInteraction", () => {
  it("throws for missing / non-spam / rescued rows", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]]));
    await expect(confirmSpamInteraction(1)).rejects.toThrow("not found");

    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 7, classification: "other", verdict: null }]]),
    );
    await expect(confirmSpamInteraction(7)).rejects.toThrow(
      "not spam-classified",
    );

    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 7, classification: "spam", verdict: "rescued" }]]),
    );
    await expect(confirmSpamInteraction(7)).rejects.toThrow("was rescued");
  });

  it("sets confirmed_spam (and is idempotent when already confirmed)", async () => {
    const db = fakeDb([
      [{ id: 7, classification: "spam", verdict: null }],
      [],
    ]);
    const updateSpy = vi.spyOn(db, "update");
    getDbMock.mockResolvedValue(db);
    expect(await confirmSpamInteraction(7)).toEqual({ id: 7 });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const db2 = fakeDb([
      [{ id: 7, classification: "spam", verdict: "confirmed_spam" }],
    ]);
    const updateSpy2 = vi.spyOn(db2, "update");
    getDbMock.mockResolvedValue(db2);
    expect(await confirmSpamInteraction(7)).toEqual({ id: 7 });
    expect(updateSpy2).not.toHaveBeenCalled();
  });
});
