/**
 * Unit tests for profilesRouter.upsertByIdentifier's INSERT race handling.
 *
 * 2026-07-03 任務7 對抗審查 P0 — this mutation matches on up to 6 identifiers
 * (userId/email/phone/wechatId/lineId/whatsappPhone) but only userId
 * (uq_cp_user) and email (uq_cp_email, migration 0112) have a real DB
 * UNIQUE constraint. A concurrent call sharing either could previously
 * both pass the `existing` SELECT and both INSERT; the mutation now
 * catches the duplicate-key error and retries the same OR-across-
 * identifiers lookup to find and merge into the winner instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../rateLimit", () => ({
  checkAdminMutationRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59 })),
}));
vi.mock("../../_core/customerUnread", () => ({
  touchLastInbound: vi.fn(async () => {}),
  isUnreadInbound: vi.fn(() => false),
}));

const selectQueue: unknown[][] = [];
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};
vi.mock("../../db", () => ({ getDb: vi.fn(async () => mockDb) }));

import { profilesRouter } from "./profiles";

function adminCtx() {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    ip: "127.0.0.1",
  };
}
const caller = () => (profilesRouter as any).createCaller(adminCtx());

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  mockDb.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => selectQueue.shift() ?? [],
      }),
    }),
  }));
  mockDb.update.mockImplementation(() => ({
    set: () => ({ where: async () => [{ affectedRows: 1 }] }),
  }));
});

describe("upsertByIdentifier", () => {
  it("no existing match: inserts a fresh profile", async () => {
    selectQueue.push([]); // existing lookup: none
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue([{ insertId: 501 }]),
    });
    const result = await caller().upsertByIdentifier({ email: "new@example.com" });
    expect(result).toEqual({ id: 501, created: true });
  });

  it("existing match: merges missing identifiers, does not insert", async () => {
    selectQueue.push([{ id: 42, userId: null, email: "a@example.com", phone: null }]);
    const result = await caller().upsertByIdentifier({
      email: "a@example.com",
      phone: "510-333-1234",
    });
    expect(result).toEqual({ id: 42, created: false });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("a concurrent call wins the insert race (uq_cp_email): retries the OR-lookup and merges into the winner instead of throwing", async () => {
    selectQueue.push([]); // existing lookup: none → attempts insert
    selectQueue.push([{ id: 909, userId: null, email: "raced@example.com", phone: null }]); // race-recovery re-lookup
    const dupErr = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(dupErr),
    });
    const result = await caller().upsertByIdentifier({
      email: "raced@example.com",
      phone: "510-333-9999",
    });
    expect(result).toEqual({ id: 909, created: false });
    // the phone this call carried, missing on the winner, still gets merged in
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("a non-duplicate-key insert error still propagates", async () => {
    selectQueue.push([]); // existing lookup: none
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("connection reset")),
    });
    await expect(
      caller().upsertByIdentifier({ email: "x@example.com" }),
    ).rejects.toThrow("connection reset");
  });
});
