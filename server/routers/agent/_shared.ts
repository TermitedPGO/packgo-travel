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
  if (existing[0]) return { id: existing[0].id, created: false };
  const ins = await db.insert(customerProfiles).values({ email });
  return { id: Number((ins as any)[0]?.insertId ?? 0), created: true };
}
