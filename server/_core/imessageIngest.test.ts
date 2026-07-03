import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, selectChain, mockFollowMergePointer, mockTouchLastInbound } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ insertId: 501 }]) }),
  };
  const mockFollowMergePointer = vi.fn(async (_db: unknown, id: number) => id);
  const mockTouchLastInbound = vi.fn().mockResolvedValue(undefined);
  return { mockDb, selectChain, mockFollowMergePointer, mockTouchLastInbound };
});

vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("./mergedProfile", () => ({ followMergePointer: mockFollowMergePointer }));
vi.mock("./customerUnread", () => ({ touchLastInbound: mockTouchLastInbound }));
vi.mock("../../drizzle/schema", () => ({
  customerProfiles: { id: "id", phone: "phone" },
  customerInteractions: { customerProfileId: "customerProfileId" },
}));
vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ _op: "sql", strings, values }),
    {},
  ),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { ingestImessageBatch, checkKnownPhones, type IngestMessage } from "./imessageIngest";
import { getDb } from "../db";

const baseMessage = (overrides: Partial<IngestMessage> = {}): IngestMessage => ({
  externalId: "im-1",
  phone: "510-333-1234",
  direction: "inbound",
  text: "哈囉我想問行程",
  occurredAtIso: "2026-06-15T12:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(mockDb as any);
  mockDb.select.mockReturnValue(selectChain);
  selectChain.from.mockReturnThis();
  selectChain.where.mockReturnThis();
  selectChain.limit.mockResolvedValue([]);
  mockDb.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue([{ insertId: 501 }]),
  });
  mockFollowMergePointer.mockImplementation(async (_db: unknown, id: number) => id);
  mockTouchLastInbound.mockResolvedValue(undefined);
});

describe("ingestImessageBatch", () => {
  it("matches an existing profile by phone, inserts, and calls touchLastInbound for inbound", async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 42 }]); // profile lookup hit

    const result = await ingestImessageBatch([baseMessage()]);

    expect(result.claimed).toBe(1);
    expect(result.unclaimedPhones).toEqual([]);
    expect(result.errors).toBe(0);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const insertedValues = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.channel).toBe("sms");
    expect(insertedValues.direction).toBe("inbound");
    expect(insertedValues.content).toBe("哈囉我想問行程");
    expect(insertedValues.externalId).toBe("im-1");
    expect(mockTouchLastInbound).toHaveBeenCalledTimes(1);
    expect(mockTouchLastInbound).toHaveBeenCalledWith(mockDb, 42, expect.any(Date));
  });

  it("does NOT call touchLastInbound for an outbound message", async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 42 }]);

    const result = await ingestImessageBatch([
      baseMessage({ direction: "outbound", text: "好的幫您安排" }),
    ]);

    expect(result.claimed).toBe(1);
    expect(mockTouchLastInbound).not.toHaveBeenCalled();
  });

  it("phone with no match: does not write to DB, reports unclaimedPhones", async () => {
    selectChain.limit.mockResolvedValueOnce([]); // no profile found

    const result = await ingestImessageBatch([
      baseMessage({ phone: "999-999-9999", text: null }),
    ]);

    expect(result.claimed).toBe(0);
    expect(result.unclaimedPhones).toEqual(["999-999-9999"]);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockTouchLastInbound).not.toHaveBeenCalled();
  });

  it("duplicate externalId on repeat ingest does not duplicate-write (relies on unique index)", async () => {
    selectChain.limit.mockResolvedValue([{ id: 42 }]); // profile lookup hit every time

    const dupError = new Error(
      "Duplicate entry '42-im-1' for key 'customerInteractions.uq_ci_profile_external'",
    );
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValueOnce(dupError),
    });

    const result = await ingestImessageBatch([baseMessage()]);

    // Duplicate-key is treated as "already ingested" — counted as claimed,
    // not as an error, and does not throw.
    expect(result.claimed).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("a merged-away profile writes to the canonical target profile, not the stale id", async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 7 }]); // matched the OLD (merged) card
    mockFollowMergePointer.mockResolvedValueOnce(99); // pointer resolves to canonical card 99

    const result = await ingestImessageBatch([baseMessage()]);

    expect(result.claimed).toBe(1);
    expect(mockFollowMergePointer).toHaveBeenCalledWith(mockDb, 7);
    const insertedValues = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.customerProfileId).toBe(99);
    expect(mockTouchLastInbound).toHaveBeenCalledWith(mockDb, 99, expect.any(Date));
  });

  it("one failing message does not affect the others, and errors accumulate", async () => {
    // Message 1: malformed (missing phone) → error.
    // Message 2: valid, matches a profile → claimed.
    // Message 3: DB insert throws a non-duplicate error → error.
    selectChain.limit
      .mockResolvedValueOnce([{ id: 42 }]) // message 2's profile lookup
      .mockResolvedValueOnce([{ id: 42 }]); // message 3's profile lookup

    mockDb.insert
      .mockReturnValueOnce({ values: vi.fn().mockResolvedValueOnce([{ insertId: 1 }]) }) // msg2 ok
      .mockReturnValueOnce({ values: vi.fn().mockRejectedValueOnce(new Error("connection reset")) }); // msg3 fails

    const messages: IngestMessage[] = [
      baseMessage({ externalId: "bad", phone: "" }),
      baseMessage({ externalId: "ok", phone: "510-111-2222" }),
      baseMessage({ externalId: "fails", phone: "510-333-4444" }),
    ];

    const result = await ingestImessageBatch(messages);

    expect(result.claimed).toBe(1);
    expect(result.errors).toBe(2);
  });

  it("text=null for an otherwise-matched message inserts empty content (defensive, should not normally occur for claimed phones)", async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 42 }]);

    const result = await ingestImessageBatch([baseMessage({ text: null })]);

    expect(result.claimed).toBe(1);
    const insertedValues = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.content).toBe("");
  });

  it("returns all zero / empty on an empty batch", async () => {
    const result = await ingestImessageBatch([]);
    expect(result).toEqual({ claimed: 0, unclaimedPhones: [], errors: 0 });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("no DB available: every message is reported unclaimed, nothing throws", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const result = await ingestImessageBatch([baseMessage(), baseMessage({ phone: "111-222-3333" })]);
    expect(result.claimed).toBe(0);
    expect(result.unclaimedPhones).toEqual(["510-333-1234", "111-222-3333"]);
  });
});

describe("checkKnownPhones", () => {
  it("returns only the phones that match a customerProfile", async () => {
    selectChain.limit
      .mockResolvedValueOnce([{ id: 1 }]) // phone A known
      .mockResolvedValueOnce([]); // phone B unknown

    const result = await checkKnownPhones(["510-111-2222", "999-888-7777"]);
    expect(result).toEqual(["510-111-2222"]);
  });

  it("dedupes and ignores blank phones", async () => {
    selectChain.limit.mockResolvedValue([{ id: 1 }]);
    const result = await checkKnownPhones(["510-111-2222", "510-111-2222", "  ", ""]);
    expect(result).toEqual(["510-111-2222"]);
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when DB is unavailable (fail closed)", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const result = await checkKnownPhones(["510-111-2222"]);
    expect(result).toEqual([]);
  });

  it("one phone lookup failing does not affect the others", async () => {
    selectChain.limit
      .mockRejectedValueOnce(new Error("db blip"))
      .mockResolvedValueOnce([{ id: 2 }]);
    const result = await checkKnownPhones(["510-111-2222", "510-333-4444"]);
    expect(result).toEqual(["510-333-4444"]);
  });
});
