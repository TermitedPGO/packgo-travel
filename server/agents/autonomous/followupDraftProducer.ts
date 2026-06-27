/**
 * followupDraftProducer — Step 4 (customer cockpit).
 *
 * Nightly: for each stale-QUOTED customer (we spoke last, quiet N days), read
 * the REAL filed conversation, draft a gentle follow-up in Jeff's voice, and
 * write it as an `agentMessages` (messageType="observation") row that the
 * cockpit 待審草稿 panel already surfaces (Source 3 / observationDraftCard) and
 * that Jeff sends with one click via the EXISTING `commandCenter.escalationReply`
 * path (reply into the original Gmail thread). NO new send path; AI never sends.
 *
 * The row shape is the load-bearing contract: it must carry, in context JSON,
 * the exact fields BOTH observationDraftCard (to surface the card) AND
 * parseEscalationReplyContext (to send) need — draftReply + gmailThreadId +
 * customerEmail + subject. buildFollowupDraftRow is pure + unit-tested against
 * those two real consumers so a drift breaks a test, not a customer send.
 *
 * Pure helpers are DB-free + unit-tested; runFollowupDraftScan (LLM + DB) is the
 * executor, verified live per the repo norm.
 */

import { createChildLogger } from "../../_core/logger";
import { findStaleQuotedCustomers, type Db } from "../../_core/followupScan";
import {
  draftFollowup,
  type FollowupDraftLanguage,
  type FollowupDrafterInput,
  type FollowupPromptVariant,
} from "./followupDrafter";
import { AUTO_SEND_HARD_EXCLUDED } from "./autoSendGate";
import { checkFollowupDraftCompliance } from "./followupDraftCompliance";

const log = createChildLogger({ module: "followupDraftProducer" });

/** agentName stamped on draft rows — distinct from the inbox-reminder scan
 * (agentName="followup") so the two systems never collide on dedup. */
export const FOLLOWUP_DRAFT_AGENT = "followup_draft";
/** classification on the card — NOT in AUTO_SEND_HARD_EXCLUDED, so a benign
 * "still interested?" note is non-sensitive (one-click send, no forced confirm). */
export const FOLLOWUP_DRAFT_CLASSIFICATION = "followup";
/** Re-draft suppression: same customer won't be re-drafted within this window. */
export const FOLLOWUP_DRAFT_DEDUP_DAYS = 7;

/** Live prompt A/B: assign one arm per draft, 50/50. Injectable rng keeps the
 * split unit-testable. The chosen arm is stamped on the row (context.promptVariant)
 * so the send path can later join it to Jeff's edit distance. */
export function pickFollowupVariant(rand: () => number = Math.random): FollowupPromptVariant {
  return rand() < 0.5 ? "A" : "B";
}
const DAY_MS = 24 * 60 * 60 * 1000;
/** How many recent email turns to feed the drafter as grounding. A professional
 * follow-up needs the real relationship + the actual open decisions, so we feed
 * a generous slice of the thread, not just the last couple of turns. */
const EXCERPT_TURNS = 12;
/** Per-turn char cap so the prompt stays bounded. */
const TURN_CHARS = 600;

export type InteractionDetailRow = {
  direction: "inbound" | "outbound";
  content: string;
  contentSummary: string | null;
  classification: string | null;
  gmailThreadId: string | null;
};

export type DraftSkipReason = "no_thread" | "sensitive" | "empty_conversation";

/** First non-null gmailThreadId scanning newest-first — the thread we last
 * spoke in, i.e. the one escalationReply will reply into. */
export function pickGmailThreadId(rowsNewestFirst: InteractionDetailRow[]): string | null {
  for (const r of rowsNewestFirst) {
    const t = r.gmailThreadId?.trim();
    if (t) return t;
  }
  return null;
}

/** Build a chronological (oldest-last) excerpt for the drafter from
 * newest-first rows. Uses contentSummary when present (shorter), else content,
 * each trimmed. Drops empty turns. */
export function buildConversationExcerpt(
  rowsNewestFirst: InteractionDetailRow[],
  max = EXCERPT_TURNS,
): Array<{ direction: "inbound" | "outbound"; text: string }> {
  return rowsNewestFirst
    .slice(0, max)
    .map((r) => {
      const raw = (r.contentSummary?.trim() || r.content?.trim() || "").replace(/\s+/g, " ");
      return { direction: r.direction, text: raw.slice(0, TURN_CHARS) };
    })
    .filter((m) => m.text.length > 0)
    .reverse();
}

/** Crude language guess; the drafter also matches the conversation's language,
 * so this only needs to be roughly right. */
export function detectLanguage(text: string | null | undefined): FollowupDraftLanguage {
  if (!text) return "zh-TW";
  if (!/[一-鿿]/.test(text)) return "en";
  // A few high-frequency simplified-only forms → zh-CN; default繁中.
  if (/[这国说会们对应实现关闭东买卖优齐适会议]/.test(text)) return "zh-CN";
  return "zh-TW";
}

/** Why this stale customer is NOT draftable (→ falls back to inbox reminder),
 * or null when a draft should be produced. */
export function detectDraftSkip(input: {
  gmailThreadId: string | null;
  lastClassification: string | null;
  conversationLen: number;
}): DraftSkipReason | null {
  if (!input.gmailThreadId) return "no_thread"; // can't send → don't make a dead card
  if (
    typeof input.lastClassification === "string" &&
    AUTO_SEND_HARD_EXCLUDED.has(input.lastClassification)
  ) {
    return "sensitive"; // refund / complaint / quote / deposit / visa → human
  }
  if (input.conversationLen === 0) return "empty_conversation";
  return null;
}

/** The exact agentMessages insert. Pure so tests can run it through the REAL
 * consumers (observationDraftCard + parseEscalationReplyContext). */
export interface FollowupDraftRowInput {
  profileId: number;
  customerEmail: string;
  daysSince: number;
  gmailThreadId: string;
  subject: string;
  draftBody: string;
  /** Which prompt arm drafted this, for the live A/B. */
  promptVariant: FollowupPromptVariant;
}

export interface FollowupDraftRow {
  agentName: string;
  messageType: "observation";
  title: string;
  body: string;
  priority: "normal";
  relatedCustomerProfileId: number;
  readByJeff: number;
  context: string;
}

export function buildFollowupDraftRow(input: FollowupDraftRowInput): FollowupDraftRow {
  const context = JSON.stringify({
    draftReply: input.draftBody,
    gmailThreadId: input.gmailThreadId,
    customerEmail: input.customerEmail,
    subject: input.subject,
    classification: FOLLOWUP_DRAFT_CLASSIFICATION,
    // Live prompt A/B arm that produced draftReply. The send path joins this to
    // the edit distance between draftReply and what Jeff actually sent.
    promptVariant: input.promptVariant,
    // sendOutcome intentionally omitted (null) → observationDraftCard treats it
    // as awaiting send, not already-sent.
  });
  return {
    agentName: FOLLOWUP_DRAFT_AGENT,
    messageType: "observation",
    title: `跟進草稿:${input.customerEmail} 報價 ${input.daysSince} 天沒回`.slice(0, 200),
    body: `已幫你把給 ${input.customerEmail} 的跟進信草擬好(報價 ${input.daysSince} 天沒回),在客戶頁待審草稿區,看過就能一鍵寄。`,
    priority: "normal",
    relatedCustomerProfileId: input.profileId,
    readByJeff: 0,
    context,
  };
}

export interface FollowupDraftScanResult {
  candidates: number;
  drafted: number;
  /** profileIds we produced a draft for — pass to runFollowupScan as excludes
   * so the same customer isn't ALSO posted as an inbox reminder. */
  draftedProfileIds: number[];
  skipped: { no_thread: number; sensitive: number; empty_conversation: number; already_drafted: number; error: number };
}

const EMPTY_RESULT: FollowupDraftScanResult = {
  candidates: 0,
  drafted: 0,
  draftedProfileIds: [],
  skipped: { no_thread: 0, sensitive: 0, empty_conversation: 0, already_drafted: 0, error: 0 },
};

/**
 * Nightly executor. Drafts a gentle follow-up for each draftable stale-quoted
 * customer and lands it in the cockpit 待審草稿 panel. Never sends. Per-customer
 * failures are swallowed (one bad draft never kills the scan).
 */
export async function runFollowupDraftScan(
  db: Db,
  opts?: { minDays?: number; maxDays?: number; limit?: number },
): Promise<FollowupDraftScanResult> {
  const cands = await findStaleQuotedCustomers(db, opts);
  if (cands.length === 0) return EMPTY_RESULT;

  const { agentMessages, customerInteractions } = await import("../../../drizzle/schema");
  const { and, eq, gte, desc, inArray } = await import("drizzle-orm");

  // Dedup: skip customers with a still-unread followup_draft in the window.
  const dedupSince = new Date(Date.now() - FOLLOWUP_DRAFT_DEDUP_DAYS * DAY_MS);
  const existing = (await db
    .select({ pid: agentMessages.relatedCustomerProfileId })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.agentName, FOLLOWUP_DRAFT_AGENT),
        eq(agentMessages.readByJeff, 0),
        gte(agentMessages.createdAt, dedupSince),
        inArray(
          agentMessages.relatedCustomerProfileId,
          cands.map((c) => c.profileId),
        ),
      ),
    )) as Array<{ pid: number | null }>;
  const alreadyDrafted = new Set(existing.map((e) => e.pid));

  const result: FollowupDraftScanResult = {
    candidates: cands.length,
    drafted: 0,
    draftedProfileIds: [],
    skipped: { no_thread: 0, sensitive: 0, empty_conversation: 0, already_drafted: 0, error: 0 },
  };

  for (const c of cands) {
    if (alreadyDrafted.has(c.profileId)) {
      result.skipped.already_drafted++;
      continue;
    }
    try {
      const rows = (await db
        .select({
          direction: customerInteractions.direction,
          content: customerInteractions.content,
          contentSummary: customerInteractions.contentSummary,
          classification: customerInteractions.classification,
          gmailThreadId: customerInteractions.gmailThreadId,
        })
        .from(customerInteractions)
        .where(
          and(
            eq(customerInteractions.customerProfileId, c.profileId),
            eq(customerInteractions.channel, "email"),
          ),
        )
        .orderBy(desc(customerInteractions.createdAt))
        .limit(20)) as InteractionDetailRow[];

      const gmailThreadId = pickGmailThreadId(rows);
      const excerpt = buildConversationExcerpt(rows);
      const skip = detectDraftSkip({
        gmailThreadId,
        lastClassification: rows[0]?.classification ?? null,
        conversationLen: excerpt.length,
      });
      if (skip) {
        result.skipped[skip]++;
        continue;
      }

      const promptVariant = pickFollowupVariant();
      const drafterInput: FollowupDrafterInput = {
        daysSince: c.daysSince,
        language: detectLanguage(rows[0]?.content ?? null),
        conversationExcerpt: excerpt,
        promptVariant,
      };
      const draft = await draftFollowup(drafterInput);
      const body = draft.body?.trim();
      if (!body) {
        result.skipped.error++;
        continue;
      }

      // Hard-rule guard (測 AI 回應): a draft that breaks the no-em-dash / 您 /
      // plain-text rules is surfaced in logs so the eval catches drift. We don't
      // block it (Jeff reviews every draft, and the send path strips markdown),
      // but a clean model should never trip this.
      const compliance = checkFollowupDraftCompliance(body);
      if (!compliance.ok) {
        log.warn(
          { profileId: c.profileId, violations: compliance.violations },
          "[followupDraftProducer] draft tripped hard-rule guard",
        );
      }

      await db.insert(agentMessages).values(
        buildFollowupDraftRow({
          profileId: c.profileId,
          customerEmail: c.email,
          daysSince: c.daysSince,
          gmailThreadId: gmailThreadId as string, // non-null past detectDraftSkip
          subject: draft.subject?.trim() || `跟進:${c.email}`,
          draftBody: body,
          promptVariant,
        }),
      );
      result.drafted++;
      result.draftedProfileIds.push(c.profileId);
    } catch (e) {
      result.skipped.error++;
      log.warn({ err: e, profileId: c.profileId }, "[followupDraftProducer] one draft failed (non-fatal)");
    }
  }

  log.info(
    { candidates: result.candidates, drafted: result.drafted, skipped: result.skipped },
    "[followupDraftProducer] scan done",
  );
  return result;
}
