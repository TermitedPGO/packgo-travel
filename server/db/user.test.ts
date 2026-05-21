/**
 * v2 Wave 2 · Module 2.3 — server/db/user.ts smoke test.
 *
 * Sanity-check the extraction:
 *
 *   Case 1 (named exports)
 *     - The 26 user-domain functions exist and are typeof "function".
 *
 *   Case 2 (lazy-DB null path — read returns null/undefined)
 *     - getUserById(id) returns null when getDb() resolves to null.
 *     - getUserByEmail(email) returns undefined when getDb() resolves to null.
 *
 *   Case 3 (lazy-DB null path — write throws)
 *     - addFavorite() throws "Database not available" when getDb() is null.
 *       (Write helpers in this domain throw rather than no-op since auth-
 *       adjacent operations should fail loud, not silent.)
 *
 * Mocks `../db` to stub getDb() → null so we never need a real connection.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

import {
  // Users CRUD + auth
  upsertUser,
  getUserById,
  getUserByOpenId,
  getUserByEmail,
  getUserByGoogleId,
  getUserByResetToken,
  createUserWithPassword,
  createUserWithGoogle,
  linkGoogleAccount,
  setPasswordResetToken,
  updatePassword,
  clearPasswordResetToken,
  incrementLoginAttempts,
  lockUserAccount,
  resetLoginAttempts,
  deleteUser,
  // Profile + avatar
  updateUserProfile,
  updateUserAvatar,
  // Favorites
  addFavorite,
  removeFavorite,
  isFavorite,
  getUserFavorites,
  getUserFavoriteIds,
  // Browsing history
  recordBrowsingHistory,
  getUserBrowsingHistory,
  clearBrowsingHistory,
} from "./user";

describe("db/user — module surface", () => {
  it("exports the 26 user-domain functions", () => {
    // Users CRUD + auth (16)
    expect(typeof upsertUser).toBe("function");
    expect(typeof getUserById).toBe("function");
    expect(typeof getUserByOpenId).toBe("function");
    expect(typeof getUserByEmail).toBe("function");
    expect(typeof getUserByGoogleId).toBe("function");
    expect(typeof getUserByResetToken).toBe("function");
    expect(typeof createUserWithPassword).toBe("function");
    expect(typeof createUserWithGoogle).toBe("function");
    expect(typeof linkGoogleAccount).toBe("function");
    expect(typeof setPasswordResetToken).toBe("function");
    expect(typeof updatePassword).toBe("function");
    expect(typeof clearPasswordResetToken).toBe("function");
    expect(typeof incrementLoginAttempts).toBe("function");
    expect(typeof lockUserAccount).toBe("function");
    expect(typeof resetLoginAttempts).toBe("function");
    expect(typeof deleteUser).toBe("function");
    // Profile + avatar (2)
    expect(typeof updateUserProfile).toBe("function");
    expect(typeof updateUserAvatar).toBe("function");
    // Favorites (5)
    expect(typeof addFavorite).toBe("function");
    expect(typeof removeFavorite).toBe("function");
    expect(typeof isFavorite).toBe("function");
    expect(typeof getUserFavorites).toBe("function");
    expect(typeof getUserFavoriteIds).toBe("function");
    // Browsing history (3)
    expect(typeof recordBrowsingHistory).toBe("function");
    expect(typeof getUserBrowsingHistory).toBe("function");
    expect(typeof clearBrowsingHistory).toBe("function");
  });
});

describe("db/user — happy-path null-DB read behavior", () => {
  it("getUserById returns null when DB pool is null", async () => {
    const result = await getUserById(123);
    expect(result).toBeNull();
  });

  it("getUserByEmail returns undefined when DB pool is null", async () => {
    const result = await getUserByEmail("nobody@example.com");
    expect(result).toBeUndefined();
  });
});

describe("db/user — write helpers fail loud when DB is null", () => {
  it("addFavorite throws when DB pool is null", async () => {
    await expect(addFavorite(1, 1)).rejects.toThrow("Database not available");
  });
});
