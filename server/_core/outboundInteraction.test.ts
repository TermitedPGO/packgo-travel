/**
 * outboundInteraction.ts — F5(e2e-sweep-20260705 §F5)外寄回信沿同 thread 既有
 * 歸屬繼承 customOrderId。純 db-stub,無真連線。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
vi.mock("./mergedProfile", () => ({
  // followMergePointer:測試裡不併卡,原樣回傳。
  followMergePointer: vi.fn(async (_db: unknown, id: number) => id),
}));
vi.mock("../../drizzle/schema", () => ({
  customerProfiles: { id: "id", email: "email" },
  customerInteractions: {
    id: "id",
    customerProfileId: "customerProfileId",
    gmailThreadId: "gmailThreadId",
    customOrderId: "customOrderId",
  },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ _and: a }),
  eq: (...a: unknown[]) => ({ _eq: a }),
  asc: (...a: unknown[]) => ({ _asc: a }),
  isNotNull: (...a: unknown[]) => ({ _isNotNull: a }),
}));

// select() 回傳一條 chainable(.from/.where/.orderBy 都回自己),.limit() 解出
// 佇列裡的下一批 rows。insert().values() 記下 values 並回 [{insertId}]。
let selectQueue: unknown[][] = [];
let insertResult: unknown = [{ insertId: 0 }];
const capturedInsertValues: Record<string, unknown>[] = [];
let selectCallCount = 0;

const fakeDb = {
  select: vi.fn(() => {
    selectCallCount++;
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []));
    return chain;
  }),
  insert: vi.fn(() => ({
    values: vi.fn((v: Record<string, unknown>) => {
      capturedInsertValues.push(v);
      return Promise.resolve(insertResult);
    }),
  })),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { recordOutboundEmailInteraction } from "./outboundInteraction";

const baseArgs = {
  customerEmail: "cust@example.com",
  body: "您好,行程已排好",
  summary: "回覆:優勝美地(你核准寄出)",
  generatedBy: "ai_draft_human_approved" as const,
};

beforeEach(() => {
  selectQueue = [];
  insertResult = [{ insertId: 0 }];
  capturedInsertValues.length = 0;
  selectCallCount = 0;
  vi.clearAllMocks();
});

describe("recordOutboundEmailInteraction — F5 thread 歸屬繼承", () => {
  it("gmailThreadId 給了 + 同 thread 有既有 order → 繼承該 customOrderId(蓋進 insert + 回傳)", async () => {
    selectQueue = [
      [{ id: 100 }], // profile 查詢
      [{ customOrderId: 77 }], // 同 thread sibling 查詢 → 繼承 77
    ];
    insertResult = [{ insertId: 601 }];

    const res = await recordOutboundEmailInteraction({ ...baseArgs, gmailThreadId: "thr-1" });

    expect(res).toEqual({
      recorded: true,
      interactionId: 601,
      customerProfileId: 100,
      customOrderId: 77,
    });
    expect(capturedInsertValues[0]).toMatchObject({
      customerProfileId: 100,
      direction: "outbound",
      gmailThreadId: "thr-1",
      customOrderId: 77,
    });
  });

  it("gmailThreadId 給了但同 thread 沒有任何已歸戶 sibling → customOrderId 留 null(絕不猜)", async () => {
    selectQueue = [
      [{ id: 100 }], // profile
      [], // sibling 查不到
    ];
    insertResult = [{ insertId: 602 }];

    const res = await recordOutboundEmailInteraction({ ...baseArgs, gmailThreadId: "thr-x" });

    expect(res.customOrderId).toBeNull();
    expect(capturedInsertValues[0].customOrderId).toBeUndefined();
    expect(capturedInsertValues[0].gmailThreadId).toBe("thr-x");
  });

  it("沒給 gmailThreadId → 完全不查 thread(只查 profile 一次)、customOrderId null", async () => {
    selectQueue = [[{ id: 100 }]]; // 只有 profile 查詢
    insertResult = [{ insertId: 603 }];

    const res = await recordOutboundEmailInteraction({ ...baseArgs });

    expect(res.customOrderId).toBeNull();
    expect(selectCallCount).toBe(1); // 沒有 sibling 查詢
    expect(capturedInsertValues[0].customOrderId).toBeUndefined();
    expect(capturedInsertValues[0].gmailThreadId).toBeUndefined();
  });

  it("查不到 profile → recorded:false,不 insert", async () => {
    selectQueue = [[]]; // profile 查不到

    const res = await recordOutboundEmailInteraction({ ...baseArgs, gmailThreadId: "thr-1" });

    expect(res).toEqual({ recorded: false });
    expect(fakeDb.insert).not.toHaveBeenCalled();
  });
});
