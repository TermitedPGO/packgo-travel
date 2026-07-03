/**
 * Shared helpers + constants for the agent sub-routers.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from the 2,804-LOC
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. These helpers were defined at the bottom of the
 * original file and used across the demo procedures (review / marketing
 * / followup / refund). Centralising them here keeps the sub-routers
 * import-graph clean and reusable.
 */

import { z } from "zod";
import { eq, and } from "drizzle-orm";
import type { getDb } from "../../db";
import { agentPolicies, customerProfiles } from "../../../drizzle/schema";

export const AGENT_NAMES = [
  "inquiry",
  "review",
  "marketing",
  "followup",
  "refund",
  "self_retrospective",
  "books",
] as const;

export const channelEnum = z.enum([
  "email",
  "whatsapp",
  "wechat",
  "line",
  "sms",
  "phone",
  "web_form",
  "review",
]);

/**
 * Look up the active policy for an agent. If none exists, seed v1 with
 * the supplied defaults so subsequent calls always see a populated row.
 * Caller is guaranteed a non-null policy (mutation context — db is
 * present).
 */
export async function ensurePolicy(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  agentName: (typeof AGENT_NAMES)[number],
  defaults: unknown,
) {
  let policy = await db
    .select()
    .from(agentPolicies)
    .where(and(eq(agentPolicies.agentName, agentName), eq(agentPolicies.active, 1)))
    .limit(1)
    .then((r) => r[0]);
  if (!policy) {
    const result = await db.insert(agentPolicies).values({
      agentName,
      version: 1,
      rules: JSON.stringify(defaults, null, 2),
      active: 1,
      createdBy: "human",
      reasonNote: `Initial v1 default policy (cold-start seed by ${agentName} demo)`,
    });
    const seededId = Number((result as any)[0]?.insertId ?? 0);
    policy = await db
      .select()
      .from(agentPolicies)
      .where(eq(agentPolicies.id, seededId))
      .limit(1)
      .then((r) => r[0]);
  }
  return policy!;
}

/**
 * Resolve a customerProfile row by email, creating it if missing.
 * Used by the demo procedures to attach simulated customers to outcomes
 * without breaking the foreign-key constraint.
 */
export async function ensureCustomerByEmail(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  email: string,
): Promise<{ id: number; created: boolean }> {
  const existing = await db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.email, email))
    .limit(1);
  if (existing[0]) {
    // 0109:這張卡可能已整份併進別人(隱藏卡)。collect/backfill 走這裡認人,
    // 不跟指標的話「收」會把整段 Gmail 歷史堆回隱藏卡(review P1)。
    // 0702 auto-heal(G2):resolveCanonicalForFiling = followMergePointer +
    // 同 email 訪客卡+會員卡並存自癒(訪客先問價、後來註冊 → 訪客卡整份併進
    // 會員卡再落資料;heal 失敗自動退回原卡,「收」不會斷)。0909 那對卡免
    // 遷移 — 下一次進這裡就自癒。
    const { resolveCanonicalForFiling } = await import("../../_core/customerMerge");
    return { id: await resolveCanonicalForFiling(db, existing[0].id, email), created: false };
  }
  // insertCustomerProfileSafely (2026-07-03, 任務7 對抗審查 P0) — closes the
  // race window between the `existing` SELECT above and this INSERT.
  const { insertCustomerProfileSafely } = await import("../../db/customerProfile");
  const insertResult = await insertCustomerProfileSafely(db, { email });
  return { id: insertResult.profileId, created: !insertResult.recoveredFromRace };
}
