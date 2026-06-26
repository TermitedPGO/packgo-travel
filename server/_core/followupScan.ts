/**
 * followupScan — proactively surface customers who went quiet after WE spoke
 * last (typically: quote / itinerary sent, no reply), so Jeff gets reminded to
 * follow up instead of having to remember.
 *
 * Why (2026-06-23 Jenny): Jeff sent Jenny the English itinerary + English-guide
 * pricing on 6/15-6/16; she said "Thank you" and went quiet for a week. Nobody
 * told Jeff to follow up. This scan reads the REAL filed conversation
 * (customerInteractions, now populated by gmail-thread-filing) and, for each
 * customer whose newest message is OUTBOUND (ball in the customer's court) and
 * has been silent N..M days, posts a reminder into Jeff's office inbox
 * (agentMessages). It NEVER emails the customer — Jeff decides and sends.
 *
 * The selection logic is the pure `selectStaleQuoted` (unit-tested); the DB read
 * + inbox post + dedup is the executor (verified live, per the repo norm).
 */

import type { getDb } from "../db";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "followupScan" });

const DAY_MS = 24 * 60 * 60 * 1000;
/** Don't nag before this many days of silence. */
const DEFAULT_MIN_DAYS = 3;
/** Don't surface customers gone quiet longer than this (treat as cold, not a
 * fresh follow-up). */
const DEFAULT_MAX_DAYS = 21;
/** Cap reminders per scan so one quiet week never floods the inbox. */
const DEFAULT_LIMIT = 20;
/** Re-post suppression window: same customer won't be re-surfaced within this. */
const DEDUP_DAYS = 7;

export interface InteractionRow {
  customerProfileId: number;
  direction: "inbound" | "outbound";
  createdAt: Date;
}

export interface StaleCandidate {
  profileId: number;
  lastDate: Date;
  daysSince: number;
}

/**
 * Pure: from interactions ordered NEWEST-FIRST (globally), keep each customer's
 * newest message; a customer is a follow-up candidate when that newest message
 * is OUTBOUND (we spoke last, ball in their court) and the silence is within
 * [minDays, maxDays]. Most-overdue first.
 */
export function selectStaleQuoted(
  rowsNewestFirst: InteractionRow[],
  nowMs: number,
  opts: { minDays: number; maxDays: number },
): StaleCandidate[] {
  const seen = new Set<number>();
  const out: StaleCandidate[] = [];
  for (const r of rowsNewestFirst) {
    if (seen.has(r.customerProfileId)) continue; // only the newest row per customer
    seen.add(r.customerProfileId);
    if (r.direction !== "outbound") continue; // customer spoke last → not "waiting on them"
    const days = (nowMs - new Date(r.createdAt).getTime()) / DAY_MS;
    if (days < opts.minDays || days > opts.maxDays) continue;
    out.push({
      profileId: r.customerProfileId,
      lastDate: new Date(r.createdAt),
      daysSince: Math.floor(days),
    });
  }
  out.sort((a, b) => b.daysSince - a.daysSince);
  return out;
}

export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Read-only: customers waiting on a reply after we spoke last, enriched with
 * email (only real, email-bearing profiles — drops noise/guest rows). Used by
 * both the daily scan and the on-demand ops tool.
 */
export async function findStaleQuotedCustomers(
  db: Db,
  opts?: { minDays?: number; maxDays?: number; limit?: number },
): Promise<Array<StaleCandidate & { email: string }>> {
  const minDays = opts?.minDays ?? DEFAULT_MIN_DAYS;
  const maxDays = opts?.maxDays ?? DEFAULT_MAX_DAYS;
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  const { customerInteractions, customerProfiles } = await import("../../drizzle/schema");
  const { gte, desc, inArray } = await import("drizzle-orm");

  const since = new Date(Date.now() - maxDays * DAY_MS);
  // Generous cap: a one-person agency's recent window fits easily; a customer
  // whose newest row falls outside this cap is simply older-than-maxDays anyway.
  const rows = (await db
    .select({
      customerProfileId: customerInteractions.customerProfileId,
      direction: customerInteractions.direction,
      createdAt: customerInteractions.createdAt,
    })
    .from(customerInteractions)
    .where(gte(customerInteractions.createdAt, since))
    .orderBy(desc(customerInteractions.createdAt))
    .limit(5000)) as InteractionRow[];

  const candidates = selectStaleQuoted(rows, Date.now(), { minDays, maxDays }).slice(0, limit);
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.profileId);
  const profs = (await db
    .select({ id: customerProfiles.id, email: customerProfiles.email })
    .from(customerProfiles)
    .where(inArray(customerProfiles.id, ids))) as Array<{ id: number; email: string | null }>;
  const emailById = new Map(profs.map((p) => [p.id, p.email]));

  return candidates
    .map((c) => ({ ...c, email: emailById.get(c.profileId) ?? null }))
    .filter((c): c is StaleCandidate & { email: string } => !!c.email);
}

export interface FollowupScanResult {
  candidates: number;
  posted: number;
  skipped: number;
}

/**
 * Daily executor: find stale-quoted customers and post a follow-up reminder
 * into Jeff's office inbox (agentMessages), deduped so the same customer isn't
 * re-surfaced within DEDUP_DAYS. Never emails the customer.
 */
export async function runFollowupScan(
  db: Db,
  opts?: { minDays?: number; maxDays?: number; limit?: number; excludeProfileIds?: number[] },
): Promise<FollowupScanResult> {
  let cands = await findStaleQuotedCustomers(db, opts);
  // Step 4: customers already drafted by the followup-draft producer are passed
  // here as excludes, so a customer with a ready draft isn't ALSO posted as a
  // "go draft one" inbox reminder (would be contradictory).
  if (opts?.excludeProfileIds?.length) {
    const ex = new Set(opts.excludeProfileIds);
    cands = cands.filter((c) => !ex.has(c.profileId));
  }
  if (cands.length === 0) return { candidates: 0, posted: 0, skipped: 0 };

  const { agentMessages } = await import("../../drizzle/schema");
  const { and, eq, gte, inArray } = await import("drizzle-orm");

  // Dedup: skip customers already surfaced in the last DEDUP_DAYS (read or not),
  // so a quiet customer isn't re-nagged every night.
  const dedupSince = new Date(Date.now() - DEDUP_DAYS * DAY_MS);
  const existing = (await db
    .select({ pid: agentMessages.relatedCustomerProfileId })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.agentName, "followup"),
        gte(agentMessages.createdAt, dedupSince),
        inArray(
          agentMessages.relatedCustomerProfileId,
          cands.map((c) => c.profileId),
        ),
      ),
    )) as Array<{ pid: number | null }>;
  const already = new Set(existing.map((e) => e.pid));

  let posted = 0;
  let skipped = 0;
  for (const c of cands) {
    if (already.has(c.profileId)) {
      skipped++;
      continue;
    }
    try {
      await db.insert(agentMessages).values({
        agentName: "followup",
        messageType: "proposal",
        title: `跟進提醒:${c.email} 報價發了 ${c.daysSince} 天沒回`,
        body:
          `最後一封是你寄給 ${c.email} 的,到現在 ${c.daysSince} 天沒下文,球在客人手上。\n\n` +
          `要不要跟進一下?在對話裡打「收 ${c.email}」可以先把完整往來收進來看清楚,再請我照真實內容幫你草擬一封溫和的跟進信。`,
        priority: "normal",
        relatedCustomerProfileId: c.profileId,
      });
      posted++;
    } catch (e) {
      log.warn({ err: e, profileId: c.profileId }, "[followupScan] one reminder insert failed (non-fatal)");
    }
  }
  log.info({ candidates: cands.length, posted, skipped }, "[followupScan] scan done");
  return { candidates: cands.length, posted, skipped };
}
