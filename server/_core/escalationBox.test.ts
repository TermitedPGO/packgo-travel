/**
 * Tests for escalationBox — escalation 進今日待辦 (批1 m3b).
 *
 * Key invariants under test:
 *   - unread escalations are listed regardless of age (no silent date window)
 *     and read ones come along dimmed (read=true) for undo context.
 *   - who resolution degrades honestly: registered user → name + userId,
 *     guest profile → email label with userId=null, no profile → who=null.
 *   - classification parse never throws on drifted/malformed context JSON.
 *   - ack only ever touches messageType="escalation" rows, both directions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getDb } from "../db";
import {
  listEscalations,
  countUnreadEscalations,
  ackEscalation,
  parseEscalationClassification,
  parseEscalationReplyTarget,
  sendEscalationReply,
} from "./escalationBox";

const getDbMock = vi.mocked(getDb);

/** Thenable drizzle-chain fake: every builder method returns itself and the
 *  whole chain resolves to `result` when awaited. set() captures its arg. */
function fakeChain(result: unknown, capture?: { set?: unknown }) {
  const p: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "update"]) {
    p[m] = () => p;
  }
  p.set = (arg: unknown) => {
    if (capture) capture.set = arg;
    return p;
  };
  p.then = (onOk: any, onErr: any) => Promise.resolve(result).then(onOk, onErr);
  return p;
}

/** db whose successive select()/update() calls resolve the queued results. */
function fakeDb(queue: unknown[], captures: Array<{ set?: unknown }> = []) {
  let i = 0;
  const next = () => fakeChain(queue[i] ?? [], captures[i++]);
  return { select: next, update: next } as any;
}

const BASE_MSG = {
  agentName: "inquiry",
  title: "客訴 · mei@example.com · \"行程取消\"",
  body: "客人在抱怨,這種我不自己回,先讓你看過。\n\n客人想問:退費",
  priority: "high" as const,
  createdAt: new Date("2026-06-09T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseEscalationClassification", () => {
  it("reads classification out of valid context", () => {
    expect(
      parseEscalationClassification(
        JSON.stringify({ classification: "complaint", confidence: 40 }),
      ),
    ).toBe("complaint");
  });

  it("returns null on malformed / missing / non-string instead of throwing", () => {
    expect(parseEscalationClassification(null)).toBeNull();
    expect(parseEscalationClassification("not json")).toBeNull();
    expect(parseEscalationClassification(JSON.stringify({ severity: "high" }))).toBeNull();
    expect(
      parseEscalationClassification(JSON.stringify({ classification: 42 })),
    ).toBeNull();
    expect(parseEscalationClassification(JSON.stringify(["a"]))).toBeNull();
  });
});

describe("listEscalations", () => {
  it("returns [] when db unavailable", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    expect(await listEscalations()).toEqual([]);
  });

  it("merges unread + read rows and resolves who through profile → user", async () => {
    const unread = [
      {
        ...BASE_MSG,
        id: 1,
        context: JSON.stringify({ classification: "complaint" }),
        readByJeff: 0,
        relatedCustomerProfileId: 11,
      },
    ];
    const read = [
      {
        ...BASE_MSG,
        id: 2,
        agentName: "refund",
        context: JSON.stringify({ severity: "high" }),
        readByJeff: 1,
        relatedCustomerProfileId: 12,
      },
    ];
    const profiles = [
      { id: 11, userId: 7, email: "mei@example.com" },
      { id: 12, userId: null, email: "guest@example.com" },
    ];
    const userRows = [{ id: 7, name: "陳美玲" }];
    getDbMock.mockResolvedValue(fakeDb([unread, read, profiles, userRows]));

    const rows = await listEscalations();
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      id: 1,
      classification: "complaint",
      read: false,
      who: { label: "陳美玲", userId: 7 },
    });
    // refund-agent context has no classification field → null, never a throw;
    // guest profile keeps the email label but no jump target.
    expect(rows[1]).toMatchObject({
      id: 2,
      agentName: "refund",
      classification: null,
      read: true,
      who: { label: "guest@example.com", userId: null },
    });
  });

  it("returns who=null when the message has no customer profile", async () => {
    const unread = [
      {
        ...BASE_MSG,
        id: 3,
        context: null,
        readByJeff: 0,
        relatedCustomerProfileId: null,
      },
    ];
    getDbMock.mockResolvedValue(fakeDb([unread, []]));
    const rows = await listEscalations();
    expect(rows).toHaveLength(1);
    expect(rows[0].who).toBeNull();
    expect(rows[0].classification).toBeNull();
  });
});

describe("countUnreadEscalations", () => {
  it("returns 0 when db unavailable", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    expect(await countUnreadEscalations()).toBe(0);
  });

  it("returns the COUNT(*) value", async () => {
    getDbMock.mockResolvedValue(fakeDb([[{ c: 4 }]]));
    expect(await countUnreadEscalations()).toBe(4);
  });
});

describe("ackEscalation", () => {
  it("throws when the message is missing", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]]));
    await expect(ackEscalation(99, true)).rejects.toThrow("not found");
  });

  it("refuses to touch non-escalation messages", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 5, messageType: "observation" }]]),
    );
    await expect(ackEscalation(5, true)).rejects.toThrow(
      "not an escalation",
    );
  });

  it("handled=true marks read with a readAt timestamp", async () => {
    const captures: Array<{ set?: any }> = [{}, {}];
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 5, messageType: "escalation" }], []], captures),
    );
    const res = await ackEscalation(5, true);
    expect(res).toEqual({ id: 5, read: true });
    expect(captures[1].set.readByJeff).toBe(1);
    expect(captures[1].set.readAt).toBeInstanceOf(Date);
  });

  it("handled=false puts it back to unread and clears readAt", async () => {
    const captures: Array<{ set?: any }> = [{}, {}];
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 6, messageType: "escalation" }], []], captures),
    );
    const res = await ackEscalation(6, false);
    expect(res).toEqual({ id: 6, read: false });
    expect(captures[1].set.readByJeff).toBe(0);
    expect(captures[1].set.readAt).toBeNull();
  });
});

describe("parseEscalationReplyTarget (批9 m1)", () => {
  it("returns full target when context has the structured fields", () => {
    const ctx = JSON.stringify({
      classification: "complaint",
      gmailThreadId: "t-123",
      gmailMessageId: "m-456",
      customerEmail: "mei@example.com",
      subject: "行程取消",
      draftReply: "您好,關於退費…",
    });
    expect(parseEscalationReplyTarget(ctx)).toEqual({
      gmailThreadId: "t-123",
      gmailMessageId: "m-456",
      customerEmail: "mei@example.com",
      subject: "行程取消",
      draftReply: "您好,關於退費…",
    });
  });

  it("old rows without customerEmail degrade to null (view-only)", () => {
    const ctx = JSON.stringify({
      classification: "other",
      gmailThreadId: "t-123",
      gmailMessageId: "m-456",
    });
    expect(parseEscalationReplyTarget(ctx)).toBeNull();
  });

  it("missing gmailThreadId degrades to null", () => {
    const ctx = JSON.stringify({ customerEmail: "a@b.com" });
    expect(parseEscalationReplyTarget(ctx)).toBeNull();
  });

  it("bad JSON / null context degrade to null, never throw", () => {
    expect(parseEscalationReplyTarget("not json")).toBeNull();
    expect(parseEscalationReplyTarget(null)).toBeNull();
    expect(parseEscalationReplyTarget(JSON.stringify([1]))).toBeNull();
  });

  it("blank draftReply becomes null (dialog opens empty, still replyable)", () => {
    const ctx = JSON.stringify({
      gmailThreadId: "t-1",
      customerEmail: "a@b.com",
      draftReply: "   ",
    });
    const target = parseEscalationReplyTarget(ctx);
    expect(target).not.toBeNull();
    expect(target!.draftReply).toBeNull();
    expect(target!.subject).toBe("");
  });
});

describe("sendEscalationReply guards (批9 m1)", () => {
  it("unsupported message types are rejected honestly (digest)", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 7, messageType: "digest", context: null }]]),
    );
    const res = await sendEscalationReply(7, "hello");
    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("不支援");
  });

  it("observation rows ARE allowed (email-auto-reply m2 跟進更正) — only the missing target blocks", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 7, messageType: "observation", context: null }]]),
    );
    const res = await sendEscalationReply(7, "hello");
    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("Gmail"); // 缺收件資訊 fallback,而非類型拒絕
  });

  it("old row without reply target is rejected with the Gmail hint", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        [
          {
            id: 8,
            messageType: "escalation",
            context: JSON.stringify({ classification: "other" }),
          },
        ],
      ]),
    );
    const res = await sendEscalationReply(8, "hello");
    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("Gmail");
  });

  it("missing message is rejected", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]]));
    const res = await sendEscalationReply(999, "hello");
    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("找不到");
  });
});
