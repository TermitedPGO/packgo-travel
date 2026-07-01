/**
 * followupDraftOnDemand — produce ONE follow-up draft for a specific customer,
 * on demand, when Jeff asks the customer-page chat to "回信 / 跟進" this person.
 *
 * Mirrors runFollowupDraftScan's per-customer chain (read real conversation →
 * professional drafter → observation row in the 待審草稿 panel) but for a single,
 * explicitly chosen customer with NO staleness gate (Jeff asked, so we draft).
 * Reuses followupDraftProducer's pure helpers + the followupDrafter, so the
 * voice / grounding / A-B arm stay identical to the nightly scan. AI never sends;
 * the draft lands as a card Jeff reviews + one-click sends via escalationReply.
 */
import { createChildLogger } from "../../_core/logger";
import type { Db } from "../../_core/followupScan";
import { stripMarkdownForEmail } from "../../_core/plainTextReply";
import { draftFollowup, type FollowupDrafterInput } from "./followupDrafter";
import {
  buildConversationExcerpt,
  detectDraftSkip,
  pickGmailThreadId,
  pickLatestInboundClassification,
  detectCustomerLanguage,
  buildFollowupDraftRow,
  pickFollowupVariant,
  sanitizeFollowupDraftBody,
  type InteractionDetailRow,
  type DraftSkipReason,
} from "./followupDraftProducer";

const log = createChildLogger({ module: "followupDraftOnDemand" });
const DAY_MS = 24 * 60 * 60 * 1000;

export type OnDemandDraftResult =
  | { status: "drafted"; daysSince: number }
  | {
      status: "skipped";
      reason: DraftSkipReason | "no_email" | "no_history" | "empty_draft" | "unclean_draft";
    };

export async function produceFollowupDraftForProfile(
  db: Db,
  profileId: number,
): Promise<OnDemandDraftResult> {
  const { agentMessages, customerInteractions, customerProfiles } = await import(
    "../../../drizzle/schema"
  );
  const { and, eq, desc } = await import("drizzle-orm");

  const prof = (
    await db
      .select({ email: customerProfiles.email })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, profileId))
      .limit(1)
  )[0] as { email: string | null } | undefined;
  const email = prof?.email?.trim();
  if (!email) return { status: "skipped", reason: "no_email" };

  const rows = (await db
    .select({
      direction: customerInteractions.direction,
      content: customerInteractions.content,
      contentSummary: customerInteractions.contentSummary,
      classification: customerInteractions.classification,
      gmailThreadId: customerInteractions.gmailThreadId,
      createdAt: customerInteractions.createdAt,
    })
    .from(customerInteractions)
    .where(
      and(
        eq(customerInteractions.customerProfileId, profileId),
        eq(customerInteractions.channel, "email"),
      ),
    )
    .orderBy(desc(customerInteractions.createdAt))
    .limit(20)) as Array<InteractionDetailRow & { createdAt: Date }>;

  if (rows.length === 0) return { status: "skipped", reason: "no_history" };

  const gmailThreadId = pickGmailThreadId(rows);
  const excerpt = buildConversationExcerpt(rows);
  const skip = detectDraftSkip({
    gmailThreadId,
    lastInboundClassification: pickLatestInboundClassification(rows),
    conversationLen: excerpt.length,
  });
  if (skip) return { status: "skipped", reason: skip };

  const daysSince = Math.max(
    0,
    Math.floor((Date.now() - new Date(rows[0].createdAt).getTime()) / DAY_MS),
  );
  const promptVariant = pickFollowupVariant();
  const drafterInput: FollowupDrafterInput = {
    daysSince,
    language: detectCustomerLanguage(rows),
    conversationExcerpt: excerpt,
    promptVariant,
  };

  let draft;
  try {
    draft = await draftFollowup(drafterInput);
  } catch (e) {
    log.warn({ err: e, profileId }, "[followupDraftOnDemand] draftFollowup failed");
    return { status: "skipped", reason: "empty_draft" };
  }
  // Same wash as the nightly scan: the stored body is what the one-click send
  // chain sends verbatim, so it must already be clean (no markdown, no em dash).
  const cleaned = sanitizeFollowupDraftBody(draft.body);
  if (!cleaned.body) return { status: "skipped", reason: "empty_draft" };
  if (cleaned.blocked) {
    log.error(
      { profileId, violations: cleaned.violations },
      "[followupDraftOnDemand] draft still dirty after wash, not storing",
    );
    return { status: "skipped", reason: "unclean_draft" };
  }
  if (cleaned.violations.length > 0) {
    log.warn(
      { profileId, violations: cleaned.violations },
      "[followupDraftOnDemand] draft tripped hard-rule guard",
    );
  }

  await db.insert(agentMessages).values(
    buildFollowupDraftRow({
      profileId,
      customerEmail: email,
      daysSince,
      gmailThreadId: gmailThreadId as string, // non-null past detectDraftSkip
      subject: stripMarkdownForEmail(draft.subject) || `跟進:${email}`,
      draftBody: cleaned.body,
      promptVariant,
    }),
  );
  log.info({ profileId, daysSince }, "[followupDraftOnDemand] drafted on demand");
  return { status: "drafted", daysSince };
}
