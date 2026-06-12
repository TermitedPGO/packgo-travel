/**
 * Tests for emailCustomerMatch (批9 m2) — email 歸戶 guards.
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
  normalizeEmail,
  findUserIdByEmail,
  linkProfileToUserByEmail,
} from "./emailCustomerMatch";

const getDbMock = vi.mocked(getDb);

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

function fakeDb(queue: unknown[], captures: Array<{ set?: unknown }> = []) {
  let i = 0;
  const next = () => fakeChain(queue[i] ?? [], captures[i++]);
  return { select: next, update: next } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Mei@Example.COM ")).toBe("mei@example.com");
  });
  it("junk → null", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("a".repeat(330) + "@x.com")).toBeNull();
  });
});

describe("findUserIdByEmail", () => {
  it("registered customer matches", async () => {
    getDbMock.mockResolvedValue(fakeDb([[{ id: 42, role: "user" }]]));
    expect(await findUserIdByEmail("mei@example.com")).toBe(42);
  });

  it("admin accounts never match (Jeff 測試信不歸戶到自己)", async () => {
    getDbMock.mockResolvedValue(fakeDb([[{ id: 1, role: "admin" }]]));
    expect(await findUserIdByEmail("jeff@packgoplay.com")).toBeNull();
  });

  it("unknown email → null", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]]));
    expect(await findUserIdByEmail("ghost@example.com")).toBeNull();
  });

  it("junk email short-circuits without touching db", async () => {
    expect(await findUserIdByEmail("junk")).toBeNull();
    expect(getDbMock).not.toHaveBeenCalled();
  });
});

describe("linkProfileToUserByEmail", () => {
  it("links a guest profile to the matching registered user", async () => {
    const captures: Array<{ set?: any }> = [{}, {}, {}, {}];
    getDbMock.mockResolvedValue(
      fakeDb(
        [
          [{ id: 9, userId: null }], // profile lookup
          [{ id: 42, role: "user" }], // user match
          [], // no other profile claims this user
          [], // update
        ],
        captures,
      ),
    );
    expect(await linkProfileToUserByEmail(9, "mei@example.com")).toBe(42);
    expect(captures[3].set).toEqual({ userId: 42 });
  });

  it("already-linked profile is a no-op returning the existing link", async () => {
    getDbMock.mockResolvedValue(fakeDb([[{ id: 9, userId: 7 }]]));
    expect(await linkProfileToUserByEmail(9, "mei@example.com")).toBe(7);
  });

  it("user already claimed by ANOTHER profile → skip link (no constraint crash)", async () => {
    const captures: Array<{ set?: any }> = [{}, {}, {}, {}];
    getDbMock.mockResolvedValue(
      fakeDb(
        [
          [{ id: 9, userId: null }],
          [{ id: 42, role: "user" }],
          [{ id: 3 }], // wechat-path profile already owns user 42
        ],
        captures,
      ),
    );
    expect(await linkProfileToUserByEmail(9, "mei@example.com")).toBe(42);
    expect(captures[3]?.set).toBeUndefined(); // no update fired
  });

  it("no matching user → stays guest", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 9, userId: null }], []]),
    );
    expect(await linkProfileToUserByEmail(9, "ghost@example.com")).toBeNull();
  });
});
