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
import { stripMarkdownForEmail } from "../../_core/plainTextReply";
import {
  draftFollowup,
  type FollowupDraftLanguage,
  type FollowupDrafterInput,
  type FollowupPromptVariant,
} from "./followupDrafter";
import {
  checkFollowupDraftCompliance,
  type ComplianceViolation,
} from "./followupDraftCompliance";
import { detectLanguageFromText } from "./customerLanguage";

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
 * so this only needs to be roughly right.
 * 2026-07-01:實作抽到 customerLanguage.ts(detectLanguageFromText),讓
 * inquiry 升級/observation 草稿鏈共用同一套規則(客人 inbound 零 CJK → en)。
 * 這裡保留同名 export 委派過去,既有 caller / 測試不動。 */
export function detectLanguage(text: string | null | undefined): FollowupDraftLanguage {
  return detectLanguageFromText(text);
}

/**
 * Language to REPLY in = the CUSTOMER's language, i.e. the most recent INBOUND
 * turn's language. detectLanguage(rows[0]) alone is wrong for follow-ups: rows
 * are newest-first and the newest turn is usually OUR outbound (the quote we
 * sent), so a customer who wrote in English but got a Chinese reply from us
 * would be drafted to in Chinese. Scan newest-first for the latest inbound turn;
 * fall back to the newest turn, then zh-TW (detectLanguage handles null).
 */
export function detectCustomerLanguage(
  rowsNewestFirst: Array<Pick<InteractionDetailRow, "direction" | "content" | "contentSummary">>,
): FollowupDraftLanguage {
  const lastInbound = rowsNewestFirst.find((r) => r.direction === "inbound");
  const source =
    lastInbound?.content?.trim() ||
    lastInbound?.contentSummary?.trim() ||
    rowsNewestFirst[0]?.content?.trim() ||
    rowsNewestFirst[0]?.contentSummary?.trim() ||
    null;
  return detectLanguage(source);
}

/**
 * Sensitive gate for follow-ups: never draft a warm「還在考慮嗎」nudge while the
 * customer's CURRENT state is a dispute. Deliberately NARROWER than
 * AUTO_SEND_HARD_EXCLUDED: that set is about never AUTO-ANSWERING money/legal
 * questions (quote / deposit / visa need Jeff's numbers), but a follow-up
 * answers nothing — and quote_request is the very state this feature exists to
 * follow up on (stale-QUOTED = they asked for a quote, we sent it). Only the
 * conflict classes make the nudge tone itself wrong → human handles those
 * (mirrors inquiryAgent alwaysEscalate: refund_request / complaint).
 */
export const FOLLOWUP_SENSITIVE_CLASSES: ReadonlySet<string> = new Set([
  "refund_request",
  "complaint",
]);

/**
 * The customer's current state = the classification of their most recent
 * CLASSIFIED inbound turn. rows[0] is, by stale-quoted definition, OUR
 * outbound, and no outbound write site stamps classification (always null), so
 * reading rows[0].classification made the sensitive gate dead. We scan
 * newest-first for the first INBOUND row; backfilled rows (threadFiling files
 * without an LLM pass) carry classification=null, so we walk past unclassified
 * inbounds to the newest one that HAS a classification — an unclassified
 * "here's my account number" follow-up must not hide the refund_request under
 * it. Window = the rows the caller fetched (recent 20), so a long-resolved
 * complaint naturally ages out of the window instead of skipping forever.
 */
export function pickLatestInboundClassification(
  rowsNewestFirst: Array<Pick<InteractionDetailRow, "direction" | "classification">>,
): string | null {
  for (const r of rowsNewestFirst) {
    if (r.direction !== "inbound") continue;
    const c = r.classification?.trim();
    if (c) return c;
  }
  return null;
}

/** Why this stale customer is NOT draftable (→ falls back to inbox reminder),
 * or null when a draft should be produced. */
export function detectDraftSkip(input: {
  gmailThreadId: string | null;
  /** From pickLatestInboundClassification — the customer's latest classified
   * inbound, NOT rows[0] (which is our own outbound, classification null). */
  lastInboundClassification: string | null;
  conversationLen: number;
}): DraftSkipReason | null {
  if (!input.gmailThreadId) return "no_thread"; // can't send → don't make a dead card
  if (
    typeof input.lastInboundClassification === "string" &&
    FOLLOWUP_SENSITIVE_CLASSES.has(input.lastInboundClassification)
  ) {
    return "sensitive"; // refund / complaint → human, never a warm nudge
  }
  if (input.conversationLen === 0) return "empty_conversation";
  return null;
}

/**
 * Wash an LLM draft body BEFORE it is stored on the card (Finding: the one-click
 * send chain — observationDraftCard → approveDraft → sendEscalationReply — sends
 * the stored body verbatim, it never strips). stripMarkdownForEmail includes the
 * em-dash normalization (Leslie case), so the card shows exactly the clean text
 * that will be sent. `blocked` = em dash / markdown SURVIVED the wash
 * (theoretically impossible) → caller must skip the draft and log.error.
 * Remaining soft violations (你/您, emoji) are returned for the warn log only —
 * Jeff reviews every draft. Pure → unit-tested; both A/B prompt arms and both
 * producers (nightly scan + on-demand) go through this one function.
 */
export interface SanitizedFollowupDraft {
  /** Cleaned, trimmed body. Empty string when the raw draft was empty. */
  body: string;
  /** True when em dash / markdown remain AFTER the wash → do not store. */
  blocked: boolean;
  /** All compliance violations found on the CLEANED body. */
  violations: ComplianceViolation[];
}

export function sanitizeFollowupDraftBody(
  raw: string | null | undefined,
  /** detectCustomerLanguage result — "en" skips the 你/您 address-form rules
   * (an English letter never contains 您); omitted → compliance falls back to
   * content-based CJK detection. */
  language?: FollowupDraftLanguage,
): SanitizedFollowupDraft {
  const body = stripMarkdownForEmail(raw);
  if (!body) return { body: "", blocked: false, violations: [] };
  const { violations } = checkFollowupDraftCompliance(body, language);
  const blocked = violations.some((v) => v === "em_dash" || v === "markdown");
  return { body, blocked, violations };
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
        lastInboundClassification: pickLatestInboundClassification(rows),
        conversationLen: excerpt.length,
      });
      if (skip) {
        result.skipped[skip]++;
        continue;
      }

      const promptVariant = pickFollowupVariant();
      const drafterInput: FollowupDrafterInput = {
        daysSince: c.daysSince,
        language: detectCustomerLanguage(rows),
        conversationExcerpt: excerpt,
        promptVariant,
      };
      const draft = await draftFollowup(drafterInput);
      // Wash BEFORE storing: the card must show exactly what the one-click send
      // chain will send (that chain sends the stored body verbatim, no strip).
      // Pass the detected language so en drafts skip the 你/您 rules.
      const cleaned = sanitizeFollowupDraftBody(draft.body, drafterInput.language);
      if (!cleaned.body) {
        result.skipped.error++;
        continue;
      }
      if (cleaned.blocked) {
        // em dash / markdown survived the wash — theoretically impossible; never
        // land a dirty draft on a one-click-sendable card.
        log.error(
          { profileId: c.profileId, violations: cleaned.violations },
          "[followupDraftProducer] draft still dirty after wash, not storing",
        );
        result.skipped.error++;
        continue;
      }
      // Hard-rule guard (測 AI 回應): remaining soft violations (你/您, emoji)
      // are surfaced in logs so the eval catches drift. Not blocked — Jeff
      // reviews every draft before it can be sent.
      if (cleaned.violations.length > 0) {
        log.warn(
          { profileId: c.profileId, violations: cleaned.violations },
          "[followupDraftProducer] draft tripped hard-rule guard",
        );
      }

      await db.insert(agentMessages).values(
        buildFollowupDraftRow({
          profileId: c.profileId,
          customerEmail: c.email,
          daysSince: c.daysSince,
          gmailThreadId: gmailThreadId as string, // non-null past detectDraftSkip
          // Subject rides the send too (sendReplyInThread subject) → same wash.
          subject: stripMarkdownForEmail(draft.subject) || `跟進:${c.email}`,
          draftBody: cleaned.body,
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
