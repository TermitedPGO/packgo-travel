/**
 * Tests for wechatCustomerMatch — 微信歸戶 lookup (批2 m5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getDb } from "../db";
import { findCustomerUserIdByOpenId } from "./wechatCustomerMatch";

const getDbMock = vi.mocked(getDb);

function fakeDb(rows: unknown[]) {
  const p: any = {};
  for (const m of ["select", "from", "where", "limit"]) p[m] = () => p;
  p.then = (ok: any, err: any) => Promise.resolve(rows).then(ok, err);
  return { select: () => p } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("findCustomerUserIdByOpenId", () => {
  it("returns the linked userId on a wechatId match", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ userId: 7 }]));
    expect(await findCustomerUserIdByOpenId("oABC123")).toBe(7);
  });

  it("returns null when there is no match", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    expect(await findCustomerUserIdByOpenId("oZZZ")).toBeNull();
  });

  it("returns null for empty openId / unavailable db (stays unassigned)", async () => {
    expect(await findCustomerUserIdByOpenId(null)).toBeNull();
    expect(await findCustomerUserIdByOpenId("  ")).toBeNull();
    getDbMock.mockResolvedValue(undefined as any);
    expect(await findCustomerUserIdByOpenId("oABC")).toBeNull();
  });
});
