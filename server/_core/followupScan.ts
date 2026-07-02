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

/**
 * Reminder wording, deterministic (誠實度 gate 3): the old title said
 * 「報價發了 N 天沒回」unconditionally, even for customers who never got a
 * quote (6/29 Emerald: no quote record anywhere, card still claimed 報價).
 * hasQuoteEvidence comes from real records (customOrders.quoteSentAt / sent
 * aiQuotes); without it the wording stays neutral. Pure → unit-tested.
 */
export function buildFollowupReminderText(input: {
  email: string;
  daysSince: number;
  hasQuoteEvidence: boolean;
}): { title: string; body: string } {
  const staleLabel = input.hasQuoteEvidence
    ? `報價發了 ${input.daysSince} 天沒回`
    : `上次聯絡後 ${input.daysSince} 天沒回`;
  return {
    title: `跟進提醒:${input.email} ${staleLabel}`,
    body:
      `最後一封是你寄給 ${input.email} 的,到現在 ${input.daysSince} 天沒下文,現在輪到客人回。\n\n` +
      `要不要跟進一下?在對話裡打「收 ${input.email}」可以先把完整往來收進來看清楚,再請我照真實內容幫你草擬一封溫和的跟進信。`,
  };
}

/**
 * Batch: which of these candidates provably received a quote (any
 * customOrders.quoteSentAt, or an aiQuotes row in sent/viewed/converted under
 * their email)? Returns the profileId set. A failed lookup returns the empty
 * set + warn — wording then stays neutral (never claim 報價 without a record),
 * and nothing blocks the scan.
 */
async function findQuoteEvidenceProfileIds(
  db: Db,
  cands: Array<{ profileId: number; email: string }>,
): Promise<Set<number>> {
  const out = new Set<number>();
  if (cands.length === 0) return out;
  try {
    const { customOrders, aiQuotes } = await import("../../drizzle/schema");
    const { and, inArray, isNotNull } = await import("drizzle-orm");

    const ids = cands.map((c) => c.profileId);
    const orderRows = (await db
      .select({ pid: customOrders.customerProfileId })
      .from(customOrders)
      .where(
        and(inArray(customOrders.customerProfileId, ids), isNotNull(customOrders.quoteSentAt)),
      )) as Array<{ pid: number | null }>;
    for (const r of orderRows) if (r.pid != null) out.add(r.pid);

    const emails = [...new Set(cands.map((c) => c.email))];
    const quoteRows = (await db
      .select({ email: aiQuotes.customerEmail })
      .from(aiQuotes)
      .where(
        and(
          inArray(aiQuotes.customerEmail, emails),
          inArray(aiQuotes.status, ["sent", "viewed", "converted"]),
        ),
      )) as Array<{ email: string | null }>;
    const sentEmails = new Set(
      quoteRows.map((r) => r.email?.toLowerCase()).filter((e): e is string => !!e),
    );
    for (const c of cands) if (sentEmails.has(c.email.toLowerCase())) out.add(c.profileId);
    return out;
  } catch (e) {
    log.warn({ err: e }, "[followupScan] quote-evidence lookup failed — neutral wording for all");
    return out;
  }
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

  // 誠實度 gate 3:只有真的寄過報價的客人,提醒才能說「報價發了」。
  const quoteEvidence = await findQuoteEvidenceProfileIds(db, cands);

  let posted = 0;
  let skipped = 0;
  for (const c of cands) {
    if (already.has(c.profileId)) {
      skipped++;
      continue;
    }
    try {
      const { title, body } = buildFollowupReminderText({
        email: c.email,
        daysSince: c.daysSince,
        hasQuoteEvidence: quoteEvidence.has(c.profileId),
      });
      await db.insert(agentMessages).values({
        agentName: "followup",
        messageType: "proposal",
        title,
        body,
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
