/**
 * followupAbReport — read-only scoreboard for the live followupDrafter prompt
 * A/B (arm A = frozen baseline, arm B = voice-distilled; see followupDrafter.ts).
 *
 * The whole measurement is a PURE READ over agentMessages — the send path
 * already stamps everything we need on the row, so this never mutates the
 * safety-critical send:
 *   - context.promptVariant  = which arm drafted it           (followupDraftProducer)
 *   - context.draftReply     = the original AI draft           (followupDraftProducer)
 *   - jeffResponse           = what Jeff actually sent          (escalationBox send path)
 *   - readByJeff === 1       = it was sent                      (escalationBox send path)
 *
 * The headline signal is meanEditRatioSent: among drafts Jeff actually sent,
 * how much did he have to rewrite? Lower = the prompt got closer to his voice
 * = the better arm. summarizeFollowupAb is pure so it is unit-tested without a DB.
 */
import { getDb } from "../db";
import type { FollowupPromptVariant } from "../agents/autonomous/followupDrafter";
import { FOLLOWUP_DRAFT_AGENT } from "../agents/autonomous/followupDraftProducer";

/** Longest string we bother diffing — drafts are short; this caps the O(n·m)
 * Levenshtein on a pathological row so the report can't blow up. */
const EDIT_DISTANCE_CHAR_CAP = 4000;

/**
 * Normalized Levenshtein distance in [0,1]: edits / max(len). 0 = identical
 * (Jeff sent the draft verbatim), 1 = completely rewritten. Inputs are capped.
 */
export function normalizedEditDistance(a: string, b: string): number {
  const s = a.slice(0, EDIT_DISTANCE_CHAR_CAP);
  const t = b.slice(0, EDIT_DISTANCE_CHAR_CAP);
  if (s === t) return 0;
  if (s.length === 0 || t.length === 0) return 1;

  // Two-row Levenshtein (O(min) memory).
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  let curr = new Array<number>(t.length + 1);
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  const dist = prev[t.length];
  return Math.min(1, dist / Math.max(s.length, t.length));
}

export type FollowupAbRow = {
  context: string | null;
  jeffResponse: string | null;
  readByJeff: number;
};

export type FollowupArmStats = {
  variant: FollowupPromptVariant;
  /** drafts produced by this arm */
  drafted: number;
  /** drafts Jeff actually sent */
  sent: number;
  /** sent / drafted, 0 when nothing drafted */
  sendRate: number;
  /** mean normalized edit distance (draft → what Jeff sent) among SENT drafts;
   * null when this arm has no sent drafts yet. LOWER IS BETTER. */
  meanEditRatioSent: number | null;
};

export type FollowupAbReport = {
  arms: FollowupArmStats[]; // always [A, B]
  /** "A" | "B" | null — arm with the lower meanEditRatioSent, null if not yet decidable */
  leader: FollowupPromptVariant | null;
};

type Acc = { drafted: number; sent: number; editSum: number };

/** Pure aggregator over raw rows. Rows without a recognized promptVariant
 * (old pre-A/B drafts) are ignored. */
export function summarizeFollowupAb(rows: FollowupAbRow[]): FollowupAbReport {
  const acc: Record<FollowupPromptVariant, Acc> = {
    A: { drafted: 0, sent: 0, editSum: 0 },
    B: { drafted: 0, sent: 0, editSum: 0 },
  };

  for (const row of rows) {
    if (!row.context) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.context) as Record<string, unknown>;
    } catch {
      continue;
    }
    const variant = parsed.promptVariant;
    if (variant !== "A" && variant !== "B") continue;
    const a = acc[variant];
    a.drafted++;

    const draftReply = typeof parsed.draftReply === "string" ? parsed.draftReply : "";
    const sentBody = row.jeffResponse?.trim() ?? "";
    if (row.readByJeff === 1 && sentBody && draftReply) {
      a.sent++;
      a.editSum += normalizedEditDistance(draftReply, sentBody);
    }
  }

  const arms: FollowupArmStats[] = (["A", "B"] as const).map((variant) => {
    const a = acc[variant];
    return {
      variant,
      drafted: a.drafted,
      sent: a.sent,
      sendRate: a.drafted === 0 ? 0 : a.sent / a.drafted,
      meanEditRatioSent: a.sent === 0 ? null : a.editSum / a.sent,
    };
  });

  // Leader = lower mean edit ratio, but only once BOTH arms have sent data.
  const [armA, armB] = arms;
  let leader: FollowupPromptVariant | null = null;
  if (armA.meanEditRatioSent !== null && armB.meanEditRatioSent !== null) {
    if (armA.meanEditRatioSent < armB.meanEditRatioSent) leader = "A";
    else if (armB.meanEditRatioSent < armA.meanEditRatioSent) leader = "B";
  }

  return { arms, leader };
}

/** Live read: pull every followup_draft row and summarize by arm. */
export async function getFollowupAbReport(): Promise<FollowupAbReport> {
  const db = await getDb();
  if (!db) return summarizeFollowupAb([]);
  const { agentMessages } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const rows = (await db
    .select({
      context: agentMessages.context,
      jeffResponse: agentMessages.jeffResponse,
      readByJeff: agentMessages.readByJeff,
    })
    .from(agentMessages)
    .where(eq(agentMessages.agentName, FOLLOWUP_DRAFT_AGENT))) as FollowupAbRow[];
  return summarizeFollowupAb(rows);
}
