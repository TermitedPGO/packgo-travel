/**
 * Unit tests for ensureCustomerByEmail (server/routers/agent/_shared.ts).
 *
 * 2026-07-03 任務7 對抗審查 P0 — this helper's INSERT branch now goes through
 * insertCustomerProfileSafely instead of a bare db.insert(customerProfiles),
 * so a concurrent request racing the same new email recovers the winner's
 * id instead of creating a parallel card.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResolveCanonicalForFiling, mockInsertCustomerProfileSafely } = vi.hoisted(() => ({
  mockResolveCanonicalForFiling: vi.fn(),
  mockInsertCustomerProfileSafely: vi.fn(),
}));

vi.mock("../../_core/customerMerge", () => ({
  resolveCanonicalForFiling: mockResolveCanonicalForFiling,
}));
vi.mock("../../db/customerProfile", () => ({
  insertCustomerProfileSafely: mockInsertCustomerProfileSafely,
}));
vi.mock("../../../drizzle/schema", () => ({
  agentPolicies: {},
  customerProfiles: { id: "id", email: "email" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => ({ _op: "eq", args: a })),
  and: vi.fn((...a: unknown[]) => ({ _op: "and", args: a })),
}));

import { ensureCustomerByEmail } from "./_shared";

function fakeDb(existingRows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => existingRows,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureCustomerByEmail", () => {
  it("existing profile: delegates to resolveCanonicalForFiling, never inserts", async () => {
    const db = fakeDb([{ id: 42 }]);
    mockResolveCanonicalForFiling.mockResolvedValue(42);
    const result = await ensureCustomerByEmail(db as any, "a@example.com");
    expect(result).toEqual({ id: 42, created: false });
    expect(mockInsertCustomerProfileSafely).not.toHaveBeenCalled();
  });

  it("no existing profile: inserts via insertCustomerProfileSafely", async () => {
    const db = fakeDb([]);
    mockInsertCustomerProfileSafely.mockResolvedValue({ profileId: 555, recoveredFromRace: false });
    const result = await ensureCustomerByEmail(db as any, "new@example.com");
    expect(result).toEqual({ id: 555, created: true });
    expect(mockInsertCustomerProfileSafely).toHaveBeenCalledWith(db, { email: "new@example.com" });
  });

  it("a concurrent request wins the race: returns the recovered id with created:false (honest — it wasn't actually created here)", async () => {
    const db = fakeDb([]);
    mockInsertCustomerProfileSafely.mockResolvedValue({ profileId: 909, recoveredFromRace: true });
    const result = await ensureCustomerByEmail(db as any, "raced@example.com");
    expect(result).toEqual({ id: 909, created: false });
  });
});
