/**
 * Unit tests for server/db/customerProfile.ts (2026-07-03, 任務7 對抗審查 P0 —
 * customerProfiles race-condition fix).
 *
 * insertCustomerProfileSafely — exercised against an in-memory mock db that
 * emulates the one real UNIQUE constraint it protects against in practice:
 * userId (uq_cp_user, migration 0064). email intentionally has NO unique
 * index (0109 監工裁決 — see that function's docstring), so its conflictColumn
 * branch is tested here as dead-code-in-practice defense-in-depth, not a
 * live constraint. mergedIntoProfileId pointer-follow on the recovered row
 * is also covered.
 *
 * withCustomerIntakeLock — the actual email-race defense (Redis per-email
 * lock). Exercised against a mocked ../redis client.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface StoredProfile {
  id: number;
  email: string | null;
  userId: number | null;
  createdAt: Date;
}

class MysqlDupEntryError extends Error {
  code = "ER_DUP_ENTRY";
  errno = 1062;
  constructor(message: string) {
    super(message);
    this.name = "MysqlDupEntryError";
  }
}

const store = {
  rows: [] as StoredProfile[],
  nextId: 1,
};

type EqToken = { _op: "eq"; args: [string, unknown] };

function buildMockDb() {
  return {
    insert(_table: unknown) {
      return {
        async values(row: any) {
          if (row.email != null && store.rows.some((r) => r.email === row.email)) {
            throw new MysqlDupEntryError(
              `Duplicate entry '${row.email}' for key 'customerProfiles.uq_cp_email'`,
            );
          }
          if (row.userId != null && store.rows.some((r) => r.userId === row.userId)) {
            throw new MysqlDupEntryError(
              `Duplicate entry '${row.userId}' for key 'customerProfiles.uq_cp_user'`,
            );
          }
          const inserted: StoredProfile = {
            id: store.nextId++,
            email: row.email ?? null,
            userId: row.userId ?? null,
            createdAt: new Date(),
          };
          store.rows.push(inserted);
          return [{ insertId: inserted.id }] as any;
        },
      };
    },
    select(_fields?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(token: EqToken) {
              const [field, value] = token.args;
              const matches = store.rows
                .filter((r) => (r as any)[field] === value)
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
              const resolved = { async limit(n: number) {
                return matches.slice(0, n).map((r) => ({ id: r.id }));
              } };
              return { ...resolved, orderBy: () => resolved };
            },
          };
        },
      };
    },
  };
}

const { mockFollowMergePointer, mockRedis } = vi.hoisted(() => ({
  mockFollowMergePointer: vi.fn(async (_db: unknown, id: number) => id),
  mockRedis: { set: vi.fn(), eval: vi.fn() },
}));

vi.mock("../_core/mergedProfile", () => ({
  followMergePointer: mockFollowMergePointer,
}));
vi.mock("../redis", () => ({ redis: mockRedis }));
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../../drizzle/schema", () => ({
  customerProfiles: { id: "id", email: "email", userId: "userId", createdAt: "createdAt" },
  users: { id: "id", email: "email" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => ({ _op: "eq", args: a })),
  or: vi.fn((...a: unknown[]) => ({ _op: "or", args: a })),
  sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({
    _op: "sql",
    strings,
    values,
  }), {}),
}));

import { insertCustomerProfileSafely, withCustomerIntakeLock } from "./customerProfile";

beforeEach(() => {
  store.rows = [];
  store.nextId = 1;
  mockFollowMergePointer.mockClear();
  mockFollowMergePointer.mockImplementation(async (_db: unknown, id: number) => id);
  mockRedis.set.mockReset();
  mockRedis.eval.mockReset();
});

describe("insertCustomerProfileSafely", () => {
  it("inserts normally when there is no conflict", async () => {
    const db = buildMockDb();
    const result = await insertCustomerProfileSafely(db as any, { email: "new@example.com" });
    expect(result).toEqual({ profileId: 1, recoveredFromRace: false });
    expect(store.rows).toHaveLength(1);
  });

  it("recovers the winner's id on an email race (oldest row wins)", async () => {
    const db = buildMockDb();
    store.rows.push({ id: 42, email: "race@example.com", userId: null, createdAt: new Date(0) });
    const result = await insertCustomerProfileSafely(db as any, { email: "race@example.com" });
    expect(result).toEqual({ profileId: 42, recoveredFromRace: true });
    // never actually inserted a second row
    expect(store.rows).toHaveLength(1);
  });

  it("recovers the winner's id on a userId race", async () => {
    const db = buildMockDb();
    store.rows.push({ id: 7, email: null, userId: 501, createdAt: new Date(0) });
    const result = await insertCustomerProfileSafely(
      db as any,
      { userId: 501, email: null },
      "userId",
    );
    expect(result).toEqual({ profileId: 7, recoveredFromRace: true });
  });

  it("follows the 0109 merge pointer on the recovered row", async () => {
    const db = buildMockDb();
    store.rows.push({ id: 42, email: "merged@example.com", userId: null, createdAt: new Date(0) });
    mockFollowMergePointer.mockResolvedValueOnce(99); // pretend #42 was merged into #99
    const result = await insertCustomerProfileSafely(db as any, { email: "merged@example.com" });
    expect(result).toEqual({ profileId: 99, recoveredFromRace: true });
    expect(mockFollowMergePointer).toHaveBeenCalledWith(db, 42);
  });

  it("rethrows a non-duplicate-key error untouched", async () => {
    const db = {
      insert: () => ({
        values: async () => {
          throw new Error("connection reset");
        },
      }),
    };
    await expect(
      insertCustomerProfileSafely(db as any, { email: "x@example.com" }),
    ).rejects.toThrow("connection reset");
  });

  it("rethrows the duplicate-key error when there is no identifier to recover by", async () => {
    const db = {
      insert: () => ({
        values: async () => {
          throw new MysqlDupEntryError("Duplicate entry");
        },
      }),
    };
    await expect(
      insertCustomerProfileSafely(db as any, { email: null }),
    ).rejects.toThrow("Duplicate entry");
  });

  it("rethrows the duplicate-key error if the winner row vanished by the time we re-select", async () => {
    // Race lost, but the winner got deleted between the failed insert and our re-select.
    const db = {
      insert: () => ({
        values: async () => {
          throw new MysqlDupEntryError("Duplicate entry");
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
        }),
      }),
    };
    await expect(
      insertCustomerProfileSafely(db as any, { email: "gone@example.com" }),
    ).rejects.toThrow("Duplicate entry");
  });
});

describe("withCustomerIntakeLock", () => {
  it("acquires the lock, runs fn once, and releases it with the same lockVal it set (via the compare-and-delete Lua script)", async () => {
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.eval.mockResolvedValue(1);
    const fn = vi.fn().mockResolvedValue("result");

    const result = await withCustomerIntakeLock("a@example.com", fn);

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      "intake-lock:a@example.com",
      expect.any(String),
      "EX",
      30,
      "NX",
    );
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    const [, , key, lockVal] = mockRedis.eval.mock.calls[0];
    expect(key).toBe("intake-lock:a@example.com");
    expect(lockVal).toBe(mockRedis.set.mock.calls[0][1]); // same random value used to acquire
  });

  it("contended lock (SET NX returns null — someone else holds it): waits briefly, then still runs fn exactly once, and does NOT attempt to release a lock it never acquired", async () => {
    mockRedis.set.mockResolvedValue(null);
    const fn = vi.fn().mockResolvedValue("result");

    const result = await withCustomerIntakeLock("busy@example.com", fn);

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("Redis error on SET fails open — runs fn anyway, without releasing", async () => {
    mockRedis.set.mockRejectedValue(new Error("ECONNREFUSED"));
    const fn = vi.fn().mockResolvedValue("result");

    const result = await withCustomerIntakeLock("down@example.com", fn);

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("releases the lock even when fn throws, and the error still propagates", async () => {
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.eval.mockResolvedValue(1);
    const fn = vi.fn().mockRejectedValue(new Error("resolveOrIdentifyCustomer blew up"));

    await expect(withCustomerIntakeLock("a@example.com", fn)).rejects.toThrow(
      "resolveOrIdentifyCustomer blew up",
    );
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  it("a failed release (eval rejects) never breaks the caller's result", async () => {
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.eval.mockRejectedValue(new Error("redis down mid-release"));
    const fn = vi.fn().mockResolvedValue("result");

    await expect(withCustomerIntakeLock("a@example.com", fn)).resolves.toBe("result");
  });
});
