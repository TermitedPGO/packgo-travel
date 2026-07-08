/**
 * Guest noise hygiene (v803, 2026-07-08) — eradicate the guest-list noise ROOT
 * cause, don't keep patching the gate.
 *
 * Root cause: historical backfill customerInteractions all have
 * classification = NULL, so a real inbound (Ann) and a marketing blast look
 * identical to the noise gate (isNoiseOnlyGuest keys on latestInboundIsSpam,
 * which needs a real 'spam' label). Two operations, both behind
 * /api/admin/* Express routes gated by LOCAL_SCRIPT_TOKEN (the DB has no local
 * URL — these run on prod/Fly):
 *
 *   1. runGuestClassificationBackfill(mode) — for each guest card that entered
 *      the list via the lastInboundAt branch AND whose LATEST inbound is
 *      unclassified, re-run the pipeline classifier (runInquiryAgent) on that
 *      inbound and stamp classification. Idempotent (UPDATE ... WHERE
 *      classification IS NULL). Once stamped, the existing spam gate hides the
 *      marketing ones for free — the eradication. dry_run reports the card count
 *      + estimated LLM calls and writes nothing; confirm processes up to `limit`
 *      cards (default 80) so a large batch stops for monitor review.
 *
 *   2. runGuestNoiseHygieneReport() — READ-ONLY. Guest cards whose EVERY inbound
 *      is effective spam OR whose email hits isKnownNoise → the bulk-block
 *      candidate list (counts + a 10-row sample + a domain histogram to curate
 *      KNOWN_NOISE_DOMAINS). Executes no writes; the monitor decides bulk-block.
 *
 * SQL uses raw fully-qualified `customerProfiles`.`x` literals + inner aliases
 * (ci/lci/iq/am/u) — interpolating a drizzle column into a subquery drops the
 * table prefix and misbinds (TiDB 雷). Verified via offline toSQL before commit.
 */

import { sql } from "drizzle-orm";
import { isKnownNoise } from "./knownNoise";

const DEFAULT_CAP = 80;
/** Absolute ceiling on one confirm run's LLM calls, even if the caller overrides
 *  `limit`. The 80 default "stops for monitor review"; this stops a runaway. */
export const GUEST_BACKFILL_HARD_MAX = 500;

const ALLOWED_INQUIRY_CHANNELS = new Set([
  "email",
  "web_form",
  "whatsapp",
  "wechat",
  "line",
  "sms",
]);

/** Map a stored customerInteractions.channel to an InquiryAgentInput.channel;
 *  phone / review (and anything unexpected) fall back to "email". Pure. */
export function mapInquiryChannel(
  channel: string | null | undefined,
): "email" | "web_form" | "whatsapp" | "wechat" | "line" | "sms" {
  return channel && ALLOWED_INQUIRY_CHANNELS.has(channel)
    ? (channel as "email" | "web_form" | "whatsapp" | "wechat" | "line" | "sms")
    : "email";
}

/**
 * Guest population predicate (userId null + contactable + email-not-registered)
 * — the three non-qualifying clauses shared by guestList / the badge. Raw
 * fully-qualified literals so it nests inside db.execute subqueries safely.
 * Callers append the qualifying arm (or the lastInboundAt branch) + FROM
 * `customerProfiles` UNALIASED.
 */
const GUEST_POPULATION_SQL = sql`
  \`customerProfiles\`.\`userId\` IS NULL
  AND (
    (\`customerProfiles\`.\`email\` IS NOT NULL AND \`customerProfiles\`.\`email\` <> '')
    OR (\`customerProfiles\`.\`phone\` IS NOT NULL AND \`customerProfiles\`.\`phone\` <> '')
  )
  AND (
    \`customerProfiles\`.\`email\` IS NULL OR \`customerProfiles\`.\`email\` = ''
    OR NOT EXISTS (SELECT 1 FROM \`users\` u WHERE u.\`email\` = \`customerProfiles\`.\`email\`)
  )
`;

/**
 * NOT content-qualified — the negation of the gate's qualifiesViaContent, with
 * explicit NULL handling for `source` (source IS NULL is the Ann case; a plain
 * NOT(source='manual' OR …) would evaluate to NULL and wrongly drop her). Only
 * inbound-only guests matter: a content-qualified guest is exempt from the gate,
 * so classifying / block-flagging them changes nothing and only burns budget.
 * Keeps 口徑一致 with isNoiseOnlyGuest's qualifiesViaContent.
 */
const NOT_CONTENT_QUALIFIED_SQL = sql`
  (\`customerProfiles\`.\`source\` IS NULL OR \`customerProfiles\`.\`source\` <> 'manual')
  AND \`customerProfiles\`.\`bookingCount\` = 0
  AND \`customerProfiles\`.\`totalSpend\` = 0
  AND NOT EXISTS (SELECT 1 FROM \`inquiries\` iq WHERE iq.customerEmail = \`customerProfiles\`.\`email\`)
  AND NOT EXISTS (SELECT 1 FROM \`agentMessages\` am WHERE am.relatedCustomerProfileId = \`customerProfiles\`.\`id\` AND am.messageType = 'escalation')
`;

/** db.execute returns either [rows, fields] (mysql2) or rows — normalize. */
function rowsOf(res: unknown): any[] {
  const r = res as any;
  return Array.isArray(r?.[0]) ? r[0] : Array.isArray(r) ? r : [];
}

/** UPDATE/INSERT ResultSetHeader may be [header, ...] or the header — read affectedRows. */
function affectedRows(res: unknown): number {
  const r = res as any;
  const header = Array.isArray(r) ? r[0] : r;
  return Number(header?.affectedRows ?? 0);
}

/** Drizzle wraps the driver error as "Failed query: …" and hides the real MySQL
 *  reason on `.cause`. Surface the errno + sqlMessage so a failure is diagnosable
 *  from the endpoint response (v803 回爐 lesson). */
function describeErr(err: unknown): string {
  const e = err as any;
  const cause = e?.cause;
  if (cause?.sqlMessage || cause?.code) {
    return `${cause.code ?? "DB"}: ${cause.sqlMessage ?? cause.message ?? ""}`.trim();
  }
  return (e as Error)?.message ?? String(err);
}

export interface GuestBackfillResult {
  status: "ok" | "error";
  mode: "dry_run" | "confirm";
  /** guest cards via the lastInboundAt branch whose latest inbound is unclassified. */
  eligibleCount?: number;
  /** one LLM (runInquiryAgent) call per eligible card. */
  estimatedLlmCalls?: number;
  /** per-run cap (default 80). */
  cap?: number;
  /** eligibleCount exceeds the cap → confirm processes one cap-sized batch, re-run for the rest. */
  exceedsCap?: boolean;
  /** confirm: cards fetched this run (<= cap). */
  processed?: number;
  /** confirm: rows actually stamped (still-NULL at write time). */
  updatedCount?: number;
  /** confirm: how many were classified 'spam' (now hidden by the gate). */
  becameSpam?: number;
  /** confirm: cards still unclassified after this run. */
  remaining?: number;
  error?: string;
}

/**
 * FROM/WHERE selecting each eligible guest's LATEST inbound row (unclassified).
 *
 * v803 回爐: the first cut picked the latest inbound with a correlated
 * `ORDER BY … LIMIT 1` subquery inside the JOIN … ON — prod TiDB 500'd on it
 * ("Failed query"), while the hygiene report (which uses NOT EXISTS) ran fine.
 * So "lci is the latest inbound" is expressed as NOT EXISTS a strictly-newer
 * inbound — a construct already proven on prod (the qualification's NOT EXISTS
 * clauses). The (createdAt, id) tiebreak matches the gate's latestInboundIsSpam,
 * so both pick the same row; id is a unique PK so the ordering is total → exactly
 * one lci per profile.
 */
function eligibleLatestInboundFrom() {
  return sql`
    FROM \`customerInteractions\` lci
    JOIN \`customerProfiles\` ON \`customerProfiles\`.\`id\` = lci.customerProfileId
    WHERE lci.direction = 'inbound'
      AND lci.classification IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM \`customerInteractions\` ci
        WHERE ci.customerProfileId = lci.customerProfileId
          AND ci.direction = 'inbound'
          AND (
            ci.createdAt > lci.createdAt
            OR (ci.createdAt = lci.createdAt AND ci.id > lci.id)
          )
      )
      AND ${GUEST_POPULATION_SQL}
      AND \`customerProfiles\`.\`lastInboundAt\` IS NOT NULL
      AND ${NOT_CONTENT_QUALIFIED_SQL}
  `;
}

export async function runGuestClassificationBackfill(
  mode: "dry_run" | "confirm",
  options: { limit?: number } = {},
): Promise<GuestBackfillResult> {
  // Clamp to [1, HARD_MAX] even if the caller overrides the default — the cap is
  // a safety limit on LLM calls per run, not a free knob.
  const cap = Math.min(
    GUEST_BACKFILL_HARD_MAX,
    Math.max(1, Math.floor(options.limit ?? DEFAULT_CAP)),
  );
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { status: "error", mode, error: "no DB connection" };

    const countRes = await db.execute(
      sql`SELECT COUNT(*) AS n ${eligibleLatestInboundFrom()}`,
    );
    const eligibleCount = Number(rowsOf(countRes)[0]?.n ?? 0);

    if (mode === "dry_run") {
      return {
        status: "ok",
        mode,
        eligibleCount,
        estimatedLlmCalls: eligibleCount,
        cap,
        exceedsCap: eligibleCount > cap,
      };
    }

    // confirm — one cap-sized batch (newest contact first).
    const batchRes = await db.execute(sql`
      SELECT lci.id AS interactionId,
             \`customerProfiles\`.\`id\` AS profileId,
             lci.content AS content,
             lci.channel AS channel
      ${eligibleLatestInboundFrom()}
      ORDER BY \`customerProfiles\`.\`lastInboundAt\` DESC
      LIMIT ${cap}
    `);
    const batch = rowsOf(batchRes);

    const { runInquiryAgent } = await import("../agents/autonomous/inquiryAgent");
    let updatedCount = 0;
    let becameSpam = 0;
    for (const row of batch) {
      const content = String(row.content ?? "");
      if (!content.trim()) continue;
      let classification: string;
      try {
        const decision = await runInquiryAgent({
          rawMessage: content,
          channel: mapInquiryChannel(row.channel),
        });
        classification = decision.classification;
      } catch {
        continue; // classifier failed for this row — leave NULL, re-runnable
      }
      // Idempotent: only stamp if STILL null (a live classification may have
      // landed between our read and this write).
      const upd = await db.execute(sql`
        UPDATE \`customerInteractions\`
        SET classification = ${classification}
        WHERE id = ${Number(row.interactionId)} AND classification IS NULL
      `);
      if (affectedRows(upd) > 0) {
        updatedCount++;
        if (classification === "spam") becameSpam++;
      }
    }

    return {
      status: "ok",
      mode,
      eligibleCount,
      processed: batch.length,
      updatedCount,
      becameSpam,
      remaining: Math.max(0, eligibleCount - updatedCount),
      cap,
      exceedsCap: eligibleCount > cap,
    };
  } catch (err) {
    return { status: "error", mode, error: describeErr(err) };
  }
}

export interface GuestHygieneReport {
  status: "ok" | "error";
  /** guest cards where every inbound is effective spam OR the email hits isKnownNoise. */
  candidateCount?: number;
  byAllSpam?: number;
  byNoiseDomain?: number;
  sample?: Array<{ profileId: number; email: string | null; reason: string }>;
  /** domain histogram of the candidates — the real domains to curate into KNOWN_NOISE_DOMAINS. */
  topDomains?: Array<{ domain: string; count: number }>;
  error?: string;
}

export async function runGuestNoiseHygieneReport(): Promise<GuestHygieneReport> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { status: "error", error: "no DB connection" };

    // Full guest population + per-card inbound counts (total + effective-spam).
    const res = await db.execute(sql`
      SELECT \`customerProfiles\`.\`id\` AS profileId,
             \`customerProfiles\`.\`email\` AS email,
             (SELECT COUNT(*) FROM \`customerInteractions\` ci
                WHERE ci.customerProfileId = \`customerProfiles\`.\`id\` AND ci.direction = 'inbound') AS inboundCount,
             (SELECT COUNT(*) FROM \`customerInteractions\` ci
                WHERE ci.customerProfileId = \`customerProfiles\`.\`id\` AND ci.direction = 'inbound'
                  AND ci.classification = 'spam' AND COALESCE(ci.spamVerdict, '') <> 'rescued') AS spamInboundCount
      FROM \`customerProfiles\`
      WHERE ${GUEST_POPULATION_SQL}
        AND \`customerProfiles\`.\`lastInboundAt\` IS NOT NULL
        AND ${NOT_CONTENT_QUALIFIED_SQL}
    `);
    const rows = rowsOf(res);

    let candidateCount = 0;
    let byAllSpam = 0;
    let byNoiseDomain = 0;
    const sample: Array<{ profileId: number; email: string | null; reason: string }> = [];
    const domainCounts = new Map<string, number>();

    for (const r of rows) {
      const inbound = Number(r.inboundCount ?? 0);
      const spamInbound = Number(r.spamInboundCount ?? 0);
      const email = (r.email ?? null) as string | null;
      const allSpam = inbound > 0 && spamInbound === inbound;
      const noiseDomain = isKnownNoise(email ?? "");
      if (!allSpam && !noiseDomain) continue;

      candidateCount++;
      if (allSpam) byAllSpam++;
      if (noiseDomain) byNoiseDomain++;
      const reason =
        allSpam && noiseDomain ? "all_spam+noise_domain" : allSpam ? "all_spam" : "noise_domain";
      if (sample.length < 10) sample.push({ profileId: Number(r.profileId), email, reason });
      const dom =
        email && email.includes("@")
          ? email.slice(email.lastIndexOf("@") + 1).toLowerCase()
          : "(no-domain)";
      domainCounts.set(dom, (domainCounts.get(dom) ?? 0) + 1);
    }

    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([domain, count]) => ({ domain, count }));

    return { status: "ok", candidateCount, byAllSpam, byNoiseDomain, sample, topDomains };
  } catch (err) {
    return { status: "error", error: describeErr(err) };
  }
}
