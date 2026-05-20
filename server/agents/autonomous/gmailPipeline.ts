/**
 * Round 81 — Gmail polling pipeline.
 *
 * Connects the email inbox to InquiryAgent. Pseudo-flow:
 *   1. Fetch unread emails since last poll (or last hour for first poll)
 *   2. For each: extract sender + content → run InquiryAgent
 *   3. If InquiryAgent classifies as refund_request → also run RefundAgent
 *      (which auto-posts to the agent chatbox)
 *   4. Log inbound interaction + outcome
 *   5. Apply "PACKGO_AI_PROCESSED" Gmail label (NEVER mark as read — Jeff
 *      still wants to see the original email indicator)
 *   6. Update gmailIntegration.lastPollAt + counters
 *
 * Safety: pipeline is idempotent (the Gmail label prevents re-processing)
 * and rate-limited via maxResults per poll.
 *
 * Demo mode: NEVER auto-sends a reply. Drafts are saved as outcomes; Jeff
 * approves/edits/sends manually via the office UI. We will only flip to
 * auto-send AFTER Jeff sees 30+ consecutive good drafts.
 */

import { getDb } from "../../db";
import {
  gmailIntegration,
  customerProfiles,
  customerInteractions,
  interactionOutcomes,
  agentPolicies,
  agentMessages,
} from "../../../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  buildGmailClient,
  listUnreadMessages,
  ensureLabel,
  applyLabel,
  sendReplyInThread,
  type GmailMessageSummary,
} from "../../_core/gmail";
import { runInquiryAgent, DEFAULT_INQUIRY_POLICY } from "./inquiryAgent";
import { runRefundAgent, DEFAULT_REFUND_POLICY } from "./refundAgent";
import { createChildLogger } from "../../_core/logger";
const log = createChildLogger({ module: "gmailPipeline" });

const PROCESSED_LABEL = "PACKGO_AI_PROCESSED";

export type PipelineResult = {
  ok: boolean;
  emailAddress: string;
  totalFetched: number;
  totalProcessed: number;
  totalFailed: number;
  totalEscalated: number;
  errors: string[];
};

/**
 * Run the pipeline once for a single integration. Returns counters for
 * the dashboard + any errors.
 */
export async function runGmailPipeline(
  integrationId: number
): Promise<PipelineResult> {
  const db = await getDb();
  if (!db) throw new Error("DB not initialized");

  const [integration] = await db
    .select()
    .from(gmailIntegration)
    .where(eq(gmailIntegration.id, integrationId))
    .limit(1);
  if (!integration) throw new Error("Gmail integration not found");
  if (integration.isActive !== 1) throw new Error("Integration is disabled");

  const gmail = buildGmailClient(integration);
  const labelId = await ensureLabel(gmail, PROCESSED_LABEL);
  const fromEmail = integration.emailAddress;

  // Determine "since" — first poll uses last hour; subsequent uses last poll - 5 min
  const lastPoll = integration.lastPollAt
    ? new Date(integration.lastPollAt)
    : null;
  const sinceMs = lastPoll
    ? lastPoll.getTime() - 5 * 60 * 1000
    : Date.now() - 60 * 60 * 1000;
  const sinceSeconds = Math.floor(sinceMs / 1000);

  // Fetch up to 25 new messages per run
  let messages: GmailMessageSummary[] = [];
  try {
    messages = await listUnreadMessages(gmail, sinceSeconds, 25);
  } catch (e) {
    return {
      ok: false,
      emailAddress: integration.emailAddress,
      totalFetched: 0,
      totalProcessed: 0,
      totalFailed: 0,
      totalEscalated: 0,
      errors: [
        `listUnreadMessages failed: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  // Filter out messages already labeled PACKGO_AI_PROCESSED
  const fresh = messages.filter((m) => !m.labels.includes(labelId));

  const result: PipelineResult = {
    ok: true,
    emailAddress: integration.emailAddress,
    totalFetched: fresh.length,
    totalProcessed: 0,
    totalFailed: 0,
    totalEscalated: 0,
    errors: [],
  };

  // Get/seed v1 policies for inquiry + refund
  const inquiryPolicy = await ensurePolicy(db, "inquiry", DEFAULT_INQUIRY_POLICY);
  const refundPolicy = await ensurePolicy(db, "refund", DEFAULT_REFUND_POLICY);

  for (const msg of fresh) {
    try {
      await processOneEmail(db, msg, inquiryPolicy, refundPolicy, result, {
        gmail,
        fromEmail,
      });
      // Apply processed label so this won't be picked up again
      await applyLabel(gmail, msg.id, labelId);
      result.totalProcessed++;
    } catch (e) {
      result.totalFailed++;
      const msgStr = e instanceof Error ? e.message : String(e);
      result.errors.push(`${msg.id}: ${msgStr}`);
      // 2026-05-17: log full per-message stack to fly logs so Jeff can
      // diagnose stuck failures (e.g. 295 failed / 0 processed means
      // SOMETHING consistently breaks — surface what).
      log.error(
        {
          err: e,
          messageId: msg.id,
          subject: msg.subject?.slice(0, 60),
          from: msg.from,
        },
        "[gmailPipeline] Failed thread",
      );
    }
  }

  // Update integration counters
  await db
    .update(gmailIntegration)
    .set({
      lastPollAt: new Date(),
      messagesProcessed: integration.messagesProcessed + result.totalProcessed,
      messagesFailed: integration.messagesFailed + result.totalFailed,
    })
    .where(eq(gmailIntegration.id, integrationId));

  return result;
}

async function processOneEmail(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  msg: GmailMessageSummary,
  inquiryPolicy: { id: number; version: number; rules: string },
  refundPolicy: { id: number; version: number; rules: string },
  result: PipelineResult,
  sendCtx: {
    gmail: ReturnType<typeof buildGmailClient>;
    fromEmail: string;
  }
): Promise<void> {
  // Extract sender email
  const senderEmail = parseEmailAddress(msg.from);

  // Upsert customer profile
  let profileId: number | undefined;
  if (senderEmail) {
    const existing = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.email, senderEmail))
      .limit(1);
    if (existing[0]) {
      profileId = existing[0].id;
    } else {
      const ins = await db.insert(customerProfiles).values({
        email: senderEmail,
      });
      profileId = Number((ins as any)[0]?.insertId ?? 0);
    }
  }

  // Pull recent interactions for context (last 5)
  const recentInteractions = profileId
    ? await db
        .select()
        .from(customerInteractions)
        .where(eq(customerInteractions.customerProfileId, profileId))
        .orderBy(sql`createdAt DESC`)
        .limit(5)
    : [];

  // 2026-05-17 red-team round 1 — wrap customer-supplied content with
  // promptInjectionGuard. Email body is the highest-volume untrusted-input
  // surface; we shield it before letting any LLM see it. If the body trips
  // injection heuristics, force-escalate (don't auto-reply).
  const { shieldUntrustedInput } = await import("../../_core/promptInjectionGuard");
  const shielded = shieldUntrustedInput(msg.body);
  const rawMessage = `From: ${msg.from}\nSubject: ${msg.subject}\n\n${shielded.wrapped}`;

  // Run InquiryAgent
  const decision = await runInquiryAgent({
    rawMessage,
    channel: "email",
    customerProfile: profileId
      ? { id: profileId, email: senderEmail }
      : undefined,
    recentInteractions: recentInteractions.map((i) => ({
      direction: i.direction,
      contentSummary: i.contentSummary,
      sentiment: i.sentiment,
      createdAt: i.createdAt,
    })),
    policyRules: inquiryPolicy.rules,
  });

  // 2026-05-17 red-team round 1 — if shieldUntrustedInput flagged the body
  // as possibly hostile (injection markers detected), force-escalate so a
  // human (Jeff) reviews before any auto-action.
  if (shielded.shouldEscalate) {
    decision.shouldEscalate = true;
    decision.escalationReason =
      `Prompt-injection guard tripped (patterns: ${shielded.detectedPatterns.slice(0, 3).join("; ")})` +
      (decision.escalationReason ? ` | ${decision.escalationReason}` : "");
    log.warn(
      { senderEmail, detectedPatterns: shielded.detectedPatterns },
      "[gmailPipeline] Force-escalated due to injection patterns in email",
    );
  }

  // Log inbound interaction
  const urgencyMap: Record<string, number> = {
    critical: 95,
    high: 80,
    normal: 50,
    low: 25,
  };
  const interactionIns = await db.insert(customerInteractions).values({
    customerProfileId: profileId ?? 0,
    channel: "email",
    direction: "inbound",
    content: rawMessage,
    contentSummary: decision.intent,
    sentiment: decision.sentiment,
    classification: decision.classification,
    urgency: urgencyMap[decision.urgency] ?? 50,
  });
  const interactionId = Number((interactionIns as any)[0]?.insertId ?? 0);

  // Round 81 / 2026-05-17 — Repurchase upgrade CTA append.
  // Runs BEFORE auto-send decision so the augmented draft goes through the
  // same safety regex check. If user is a returning free-tier customer who
  // hasn't been pitched yet, append a P.S. with PACK&GO Plus 10-day trial.
  if (decision.draftReply && senderEmail) {
    try {
      const { maybeAppendUpgradeCta } = await import("../../_core/repurchaseCta");
      const result_cta = await maybeAppendUpgradeCta({
        draftReply: decision.draftReply,
        senderEmail,
        language: decision.draftLanguage,
      });
      if (result_cta.appended) {
        decision.draftReply = result_cta.draftReply;
        log.info(
          { senderEmail },
          "[gmailPipeline] Appended Plus upgrade CTA to draft",
        );
      }
    } catch (err) {
      log.warn({ err }, "[gmailPipeline] maybeAppendUpgradeCta failed (non-fatal)");
    }
  }

  // Phase 2: respect autoSendEnabled + autoSendMinConfidence in policy
  // (When ON + conf ≥ threshold + agent says draft-not-escalate, the action
  //  is marked as "would_auto_send". Actually sending the email is gated by
  //  a separate hard switch in the gmail pipeline — Phase 2.5.)
  let parsedPolicy: any = {};
  try {
    parsedPolicy = JSON.parse(inquiryPolicy.rules);
  } catch {
    parsedPolicy = {};
  }
  const autoSendEnabled = parsedPolicy.autoSendEnabled === true;
  const autoSendThreshold =
    typeof parsedPolicy.autoSendMinConfidence === "number"
      ? parsedPolicy.autoSendMinConfidence
      : 85;
  let meetsAutoSend =
    autoSendEnabled &&
    !decision.shouldEscalate &&
    decision.confidence >= autoSendThreshold;

  // SECURITY_AUDIT_2026_05_14 P1-6: post-LLM sanity check on the draft.
  // Even with delimiters around the customer's raw email, a determined
  // injection could produce a draft that confirms a refund, includes
  // a password reset URL, or quotes a dollar amount — things only Jeff
  // should be saying to a customer. If the draft hits any of these
  // patterns, force-escalate instead of auto-sending. False positives
  // here just push the email back to Jeff for manual review, which is
  // the safe default.
  if (meetsAutoSend) {
    const draft = (decision.draftReply || "").toLowerCase();
    const blacklist = [
      /(?:refund|退款|退費).*(?:confirm|approved|processed|完成|核准|已退)/i,
      /(?:refund|退款|退費).*\$?\s*[\d,]+(?:\.\d+)?/i,
      /\$\s*[\d,]+(?:\.\d+)?/i, // any dollar amount
      /password\s*reset|reset\s*your\s*password|reset.*link/i,
      /密碼.*重設|重設.*密碼/i,
      /bank.*(?:routing|account|wire)|wire\s*transfer/i,
      /(?:visa|master\s*card|信用卡).*(?:number|號碼)\s*[:：]/i,
    ];
    const tripped = blacklist.find((re) => re.test(draft));
    if (tripped) {
      log.warn(
        { pattern: tripped.toString() },
        "[InquiryAgent] auto-send blocked: draft tripped safety regex",
      );
      decision.shouldEscalate = true;
      decision.escalationReason =
        (decision.escalationReason ?? "") +
        " | post-LLM safety: draft matched sensitive pattern " +
        tripped.toString();
      meetsAutoSend = false;
    }
  }

  // Phase 2.5: if all gates pass, attempt the actual send
  let sendOutcome: "auto_replied" | "would_auto_send" | "send_failed" | null = null;
  let sentGmailMessageId: string | undefined;
  if (meetsAutoSend && senderEmail) {
    try {
      const send = await sendReplyInThread(sendCtx.gmail, {
        threadId: msg.threadId,
        toEmail: senderEmail,
        subject: msg.subject,
        bodyText: decision.draftReply,
        fromEmail: sendCtx.fromEmail,
        confirmedAutoSendOk: true,
        inReplyToMessageId: msg.id,
      });
      if (send.ok && !send.dryRun) {
        sendOutcome = "auto_replied";
        sentGmailMessageId = send.messageId;
      } else if (send.ok && send.dryRun) {
        // System or per-call kill switch — mark as would-send for visibility
        sendOutcome = "would_auto_send";
      } else {
        sendOutcome = "send_failed";
        result.errors.push(`send failed for ${msg.id}: ${send.error}`);
      }
    } catch (e) {
      sendOutcome = "send_failed";
      result.errors.push(
        `send threw for ${msg.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Record outcome
  const action = decision.shouldEscalate
    ? "auto_escalate"
    : sendOutcome ?? "auto_draft";
  const outcomeIns = await db.insert(interactionOutcomes).values({
    agentName: "inquiry",
    interactionId,
    customerProfileId: profileId,
    actionTaken: action,
    confidence: decision.confidence,
    policyVersion: inquiryPolicy.version,
  });
  const outcomeId = Number((outcomeIns as any)[0]?.insertId ?? 0);

  // If we actually sent, log the outbound interaction too (so the customer
  // profile shows both directions of the conversation).
  if (sendOutcome === "auto_replied" && profileId) {
    await db.insert(customerInteractions).values({
      customerProfileId: profileId,
      channel: "email",
      direction: "outbound",
      content: decision.draftReply,
      contentSummary: `Auto-reply (conf=${decision.confidence})`,
      generatedBy: "ai_auto",
      agentName: "inquiry",
      outcomeId,
    });
  }

  // If escalation, post to chatbox so Jeff sees it
  if (decision.shouldEscalate) {
    result.totalEscalated++;
    await db.insert(agentMessages).values({
      agentName: "inquiry",
      messageType: "escalation",
      title: `${decision.classification} · ${senderEmail ?? "unknown"} · "${msg.subject.slice(0, 60)}"`,
      body: `Agent escalated because: ${decision.escalationReason ?? "see decision"}\n\n${decision.intent}\n\n---\nDraft (供你參考,**未送出**):\n${decision.draftReply}`,
      context: JSON.stringify({
        classification: decision.classification,
        urgency: decision.urgency,
        sentiment: decision.sentiment,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        gmailMessageId: msg.id,
        gmailThreadId: msg.threadId,
      }),
      priority:
        decision.urgency === "critical"
          ? "critical"
          : decision.urgency === "high"
          ? "high"
          : "normal",
      relatedOutcomeId: outcomeId,
      relatedInteractionId: interactionId,
      relatedCustomerProfileId: profileId,
    });
  } else {
    // Round 81 (2026-05-17): Post non-escalation outcomes (auto-replied,
    // would-auto-send, drafted) to #inquiry channel as well, so the
    // channel shows ALL email activity not just escalations.
    // Jeff can mute the channel or filter to unread if he doesn't want
    // every email; the per-agent unread counter handles that.
    try {
      const { notifyAgentMessage } = await import("../../_core/agentNotify");
      const outcomeLabel =
        sendOutcome === "auto_replied"
          ? "✓ 已自動回覆"
          : sendOutcome === "would_auto_send"
          ? "✓ 已擬稿 (dry-run kill switch on)"
          : "📝 Draft 已存,等你 review";
      await notifyAgentMessage({
        agentName: "inquiry",
        messageType: "observation",
        title: `${decision.classification} · ${senderEmail ?? "unknown"} · "${msg.subject.slice(0, 50)}"`,
        body:
          `${outcomeLabel}\n\n` +
          `Intent: ${decision.intent}\n` +
          `Urgency: ${decision.urgency} · Sentiment: ${decision.sentiment} · Confidence: ${decision.confidence}\n` +
          (sendOutcome === "auto_replied"
            ? `\nReply sent:\n${decision.draftReply.slice(0, 500)}${decision.draftReply.length > 500 ? "..." : ""}`
            : `\nDraft:\n${decision.draftReply.slice(0, 500)}${decision.draftReply.length > 500 ? "..." : ""}`),
        priority: decision.urgency === "high" ? "high" : "low",
        relatedOutcomeId: outcomeId,
        relatedInteractionId: interactionId,
        relatedCustomerProfileId: profileId ?? undefined,
        context: {
          classification: decision.classification,
          confidence: decision.confidence,
          sendOutcome,
          gmailThreadId: msg.threadId,
        },
      });
    } catch (err) {
      // Don't break the pipeline on notify failure
      log.warn({ err }, "[gmailPipeline] #inquiry channel notify failed");
    }
  }

  // If refund_request, run RefundAgent too for full triage
  if (decision.classification === "refund_request") {
    try {
      const refundDecision = await runRefundAgent({
        rawMessage,
        customerProfile: profileId
          ? { id: profileId, email: senderEmail }
          : undefined,
        policyRules: refundPolicy.rules,
      });

      // Record refund outcome (always escalates)
      const refOutcomeIns = await db.insert(interactionOutcomes).values({
        agentName: "refund",
        interactionId,
        customerProfileId: profileId,
        actionTaken: "auto_escalate",
        confidence: refundDecision.confidence,
        policyVersion: refundPolicy.version,
      });
      const refOutcomeId = Number((refOutcomeIns as any)[0]?.insertId ?? 0);

      // Post refund triage to chatbox (always — RefundAgent always escalates)
      await db.insert(agentMessages).values({
        agentName: "refund",
        messageType: "escalation",
        title: `退款 · ${refundDecision.severity} · ${refundDecision.reasonCategory} · ${senderEmail ?? "unknown"}`,
        body: refundDecision.jeffInternalBriefing,
        context: JSON.stringify({
          severity: refundDecision.severity,
          reasonCategory: refundDecision.reasonCategory,
          extractedFacts: refundDecision.extractedFacts,
          customerEmotionalState: refundDecision.customerEmotionalState,
          suggestedJeffActions: refundDecision.suggestedJeffActions,
          gmailMessageId: msg.id,
          gmailThreadId: msg.threadId,
        }),
        priority:
          refundDecision.severity === "critical"
            ? "critical"
            : refundDecision.severity === "high"
            ? "high"
            : "normal",
        relatedOutcomeId: refOutcomeId,
        relatedInteractionId: interactionId,
        relatedCustomerProfileId: profileId,
      });
    } catch (e) {
      result.errors.push(
        `RefundAgent for ${msg.id} failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Update profile last-interaction stamp
  if (profileId) {
    await db
      .update(customerProfiles)
      .set({ lastInteractionAt: new Date() })
      .where(eq(customerProfiles.id, profileId));
  }
}

function parseEmailAddress(fromHeader: string): string | undefined {
  // "Lisa Chen <lisa@example.com>" → "lisa@example.com"
  // "lisa@example.com" → "lisa@example.com"
  const match = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s]+@[^\s]+)/);
  if (!match) return undefined;
  const email = match[1].trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

async function ensurePolicy(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  agentName: string,
  defaults: unknown
): Promise<{ id: number; version: number; rules: string }> {
  const existing = await db
    .select()
    .from(agentPolicies)
    .where(and(eq(agentPolicies.agentName, agentName), eq(agentPolicies.active, 1)))
    .limit(1);
  if (existing[0]) return existing[0];

  const ins = await db.insert(agentPolicies).values({
    agentName,
    version: 1,
    rules: JSON.stringify(defaults, null, 2),
    active: 1,
    createdBy: "human",
    reasonNote: `Initial v1 default policy (cold-start seed by gmail pipeline)`,
  });
  const seededId = Number((ins as any)[0]?.insertId ?? 0);
  const [seeded] = await db
    .select()
    .from(agentPolicies)
    .where(eq(agentPolicies.id, seededId))
    .limit(1);
  return seeded!;
}
