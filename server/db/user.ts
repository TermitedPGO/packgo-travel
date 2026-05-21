// server/db/user.ts — extracted from server/db.ts in v2 Wave 2 Module 2.3 (D2 locked split).
//
// Owns: users CRUD + auth helpers (password reset + login-attempt tracking
// + Google OAuth linking) + user profile/avatar updates + favorites
// (userFavorites) + browsing history (userBrowsingHistory).
//
// Out of scope (intentionally stays in db.ts):
//   - Newsletter subscribers (createNewsletterSubscriber, etc.)
//     → kept in db.ts residual, may move to its own module later.
//   - Customer profiles + membership (not used by db.ts directly today).
//   - Inquiry helpers (separate domain, residual until later module).
//
// Re-exported from server/db.ts via `export * from "./db/user"` so all
// existing callers (sub-routers, autonomous agents, services) continue
// importing from "../db" unchanged.

import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  users, InsertUser,
  userFavorites,
  userBrowsingHistory,
  tours, Tour,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { ENV } from "../_core/env";

// ============================================
// Users CRUD + auth helpers
// ============================================

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId && !user.email) {
    throw new Error("User openId or email is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId ?? null,
      email: user.email,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    // Email is already set in values, update if provided
    if (user.email && user.email !== values.email) {
      values.email = user.email;
      updateSet.email = user.email;
    }

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return null;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByGoogleId(googleId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByResetToken(token: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.resetPasswordToken, token)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createUserWithPassword(data: { email: string; password: string; name: string }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(users).values({
    email: data.email,
    password: data.password,
    name: data.name,
    loginMethod: 'email',
    role: 'user',
  });

  // Get the created user
  const user = await getUserByEmail(data.email);
  if (!user) {
    throw new Error("Failed to create user");
  }

  // Round 80.22: signup bonus +50 Packpoint. Best-effort — failures shouldn't
  // block account creation. Idempotency at user level (only awarded once
  // since this is the only place users are created via password flow).
  try {
    const { awardPackpoint } = await import("../_core/packpoint");
    await awardPackpoint({
      userId: user.id,
      delta: 50,
      reason: "signup_bonus",
      description: "Welcome bonus for signing up",
    });
  } catch (err) {
    console.error("[Packpoint] Signup bonus failed for user", user.id, err);
  }

  // Round 80.22 Phase D: assign unique referral code so the user can share
  // their link immediately. Best-effort.
  try {
    const { ensureReferralCode } = await import("../_core/referral");
    await ensureReferralCode(user.id);
  } catch (err) {
    console.error("[Referral] Code generation failed for user", user.id, err);
  }

  return user;
}

export async function createUserWithGoogle(data: { googleId: string; email: string; name: string }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(users).values({
    googleId: data.googleId,
    email: data.email,
    name: data.name,
    loginMethod: 'google',
    role: 'user',
  });

  // Get the created user
  const user = await getUserByGoogleId(data.googleId);
  if (!user) {
    throw new Error("Failed to create user");
  }

  // Round 80.22: signup bonus +50 Packpoint (same as password flow).
  try {
    const { awardPackpoint } = await import("../_core/packpoint");
    await awardPackpoint({
      userId: user.id,
      delta: 50,
      reason: "signup_bonus",
      description: "Welcome bonus for signing up via Google",
    });
  } catch (err) {
    console.error("[Packpoint] Signup bonus failed for user", user.id, err);
  }

  // Round 80.22 Phase D: assign unique referral code on Google signup too.
  try {
    const { ensureReferralCode } = await import("../_core/referral");
    await ensureReferralCode(user.id);
  } catch (err) {
    console.error("[Referral] Code generation failed for user", user.id, err);
  }

  return user;
}

export async function linkGoogleAccount(userId: number, googleId: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({ googleId }).where(eq(users.id, userId));

  // Return updated user
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function setPasswordResetToken(userId: number, token: string, expires: Date) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    resetPasswordToken: token,
    resetPasswordExpires: expires,
  }).where(eq(users.id, userId));
}

export async function updatePassword(userId: number, hashedPassword: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
}

export async function clearPasswordResetToken(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    resetPasswordToken: null,
    resetPasswordExpires: null,
  }).where(eq(users.id, userId));
}

/**
 * Increment login attempts for a user
 */
export async function incrementLoginAttempts(userId: number, attempts: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    loginAttempts: attempts,
  }).where(eq(users.id, userId));
}

/**
 * Lock user account until specified time
 */
export async function lockUserAccount(userId: number, lockoutUntil: Date) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    loginAttempts: 0, // Reset attempts when locking
    lockoutUntil,
  }).where(eq(users.id, userId));
}

/**
 * Reset login attempts for a user (on successful login)
 */
export async function resetLoginAttempts(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    loginAttempts: 0,
    lockoutUntil: null,
  }).where(eq(users.id, userId));
}

export async function deleteUser(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(users).where(eq(users.id, userId));
}

// ============================================
// User Profile Updates
// ============================================

// Update user profile (name, phone, address)
export async function updateUserProfile(
  userId: number,
  data: { name?: string; phone?: string; address?: string }
): Promise<any> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;

  await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, userId));

  // Return updated user (filter sensitive fields)
  const [updated] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!updated) return null;
  const { password, resetPasswordToken, resetPasswordExpires, loginAttempts, lockoutUntil, ...safeUser } = updated as any;
  return safeUser;
}

// Update user avatar
export async function updateUserAvatar(
  userId: number,
  avatarUrl: string | null
): Promise<any> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(users)
    .set({ avatar: avatarUrl })
    .where(eq(users.id, userId));

  // Return updated user (filter sensitive fields)
  const [updated] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!updated) return null;
  const { password, resetPasswordToken, resetPasswordExpires, loginAttempts, lockoutUntil, ...safeUser } = updated as any;
  return safeUser;
}

// ============================================
// User Favorites
// ============================================

/**
 * Add a tour to user's favorites
 */
export async function addFavorite(userId: number, tourId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    await db.insert(userFavorites).values({
      userId,
      tourId,
    }).onDuplicateKeyUpdate({
      set: { userId }, // No-op update, just to handle duplicate
    });
  } catch (error) {
    console.error("[Database] Failed to add favorite:", error);
    throw error;
  }
}

/**
 * Remove a tour from user's favorites
 */
export async function removeFavorite(userId: number, tourId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    await db.delete(userFavorites).where(
      and(
        eq(userFavorites.userId, userId),
        eq(userFavorites.tourId, tourId)
      )
    );
  } catch (error) {
    console.error("[Database] Failed to remove favorite:", error);
    throw error;
  }
}

/**
 * Check if a tour is in user's favorites
 */
export async function isFavorite(userId: number, tourId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db
    .select()
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.userId, userId),
        eq(userFavorites.tourId, tourId)
      )
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Get user's favorite tours with tour details
 */
export async function getUserFavorites(userId: number): Promise<Tour[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const favorites = await db
    .select({
      tourId: userFavorites.tourId,
      createdAt: userFavorites.createdAt,
    })
    .from(userFavorites)
    .where(eq(userFavorites.userId, userId))
    .orderBy(desc(userFavorites.createdAt));

  if (favorites.length === 0) {
    return [];
  }

  const tourIds = favorites.map(f => f.tourId);
  const tourList = await db
    .select()
    .from(tours)
    .where(inArray(tours.id, tourIds));

  // Sort by favorite order
  const tourMap = new Map(tourList.map(t => [t.id, t]));
  return tourIds.map(id => tourMap.get(id)).filter(Boolean) as Tour[];
}

/**
 * Get user's favorite tour IDs (for quick checking)
 */
export async function getUserFavoriteIds(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const favorites = await db
    .select({ tourId: userFavorites.tourId })
    .from(userFavorites)
    .where(eq(userFavorites.userId, userId));

  return favorites.map(f => f.tourId);
}

// ============================================
// User Browsing History
// ============================================

/**
 * Record a tour view in user's browsing history
 */
export async function recordBrowsingHistory(userId: number, tourId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    // Check if entry exists
    const existing = await db
      .select()
      .from(userBrowsingHistory)
      .where(
        and(
          eq(userBrowsingHistory.userId, userId),
          eq(userBrowsingHistory.tourId, tourId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing entry
      await db
        .update(userBrowsingHistory)
        .set({
          viewedAt: new Date(),
          viewCount: sql`${userBrowsingHistory.viewCount} + 1`,
        })
        .where(eq(userBrowsingHistory.id, existing[0].id));
    } else {
      // Insert new entry
      await db.insert(userBrowsingHistory).values({
        userId,
        tourId,
      });
    }
  } catch (error) {
    console.error("[Database] Failed to record browsing history:", error);
    throw error;
  }
}

/**
 * Get user's browsing history with tour details
 */
export async function getUserBrowsingHistory(userId: number, limit: number = 20): Promise<Tour[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const history = await db
    .select({
      tourId: userBrowsingHistory.tourId,
      viewedAt: userBrowsingHistory.viewedAt,
    })
    .from(userBrowsingHistory)
    .where(eq(userBrowsingHistory.userId, userId))
    .orderBy(desc(userBrowsingHistory.viewedAt))
    .limit(limit);

  if (history.length === 0) {
    return [];
  }

  const tourIds = history.map(h => h.tourId);
  const tourList = await db
    .select()
    .from(tours)
    .where(inArray(tours.id, tourIds));

  // Sort by viewing order
  const tourMap = new Map(tourList.map(t => [t.id, t]));
  return tourIds.map(id => tourMap.get(id)).filter(Boolean) as Tour[];
}

/**
 * Clear user's browsing history
 */
export async function clearBrowsingHistory(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(userBrowsingHistory).where(eq(userBrowsingHistory.userId, userId));
}
