/**
 * emailCustomerMatch — 批9 m2:email 歸戶(微信 wechatCustomerMatch 模式平移)。
 *
 * Inbound email senders were auto-profiled (customerProfiles, email-only)
 * but never linked to registered accounts — a logged-in customer writing
 * from their account email still showed up as a nameless guest. This
 * helper closes that: sender email → users.email exact match → userId.
 *
 * Matching is exact + case-insensitive on the normalized address. No fuzzy
 * matching on purpose: a wrong link puts one customer's email history in
 * another customer's inbox, which is worse than a guest chip.
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { users, customerProfiles } from "../../drizzle/schema";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "emailCustomerMatch" });

/** Lowercase + trim; returns null for junk so callers can skip cleanly. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.length > 320) return null;
  return e;
}

/** Registered user whose account email matches the sender; null = guest. */
export async function findUserIdByEmail(
  email: string | null | undefined,
): Promise<number | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  const u = rows[0];
  // Never link an inbound customer email to an ADMIN account — Jeff
  // emailing himself during tests must stay a guest, not become a
  // customer inbox pointing at his own admin user.
  if (!u || u.role === "admin") return null;
  return u.id;
}

/**
 * Link a guest profile to its registered user when the emails match.
 * No-op when already linked or no user matches. Returns the linked
 * userId (existing or new) so the pipeline can use it downstream.
 */
export async function linkProfileToUserByEmail(
  profileId: number,
  email: string | null | undefined,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const profRows = await db
    .select({ id: customerProfiles.id, userId: customerProfiles.userId })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, profileId))
    .limit(1);
  const profile = profRows[0];
  if (!profile) return null;
  if (profile.userId != null) return profile.userId; // already linked

  const userId = await findUserIdByEmail(email);
  if (userId == null) return null;

  // Guard: one user ↔ one profile (customerProfiles.userId is unique).
  // If another profile already claimed this user (e.g. created by the
  // WeChat path), leave this email-only profile unlinked rather than
  // violating the constraint — honest split beats a crash.
  const claimed = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, userId))
    .limit(1);
  if (claimed[0] && claimed[0].id !== profileId) {
    log.warn(
      { profileId, userId, claimedBy: claimed[0].id },
      "[emailCustomerMatch] user already linked to another profile — skipping",
    );
    return userId;
  }

  await db
    .update(customerProfiles)
    .set({ userId })
    .where(
      and(eq(customerProfiles.id, profileId)),
    );
  log.info(
    { profileId, userId },
    "[emailCustomerMatch] guest profile linked to registered user",
  );
  return userId;
}
