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
import { inquiryClassificationLabelZh } from "./inquiryLabels";
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

/**
 * When set, only emails carrying this Gmail label are processed.
 * Jeff should create a Gmail filter: to:support@packgoplay.com → add label PACKGO_SUPPORT
 * Then set this env var on Fly so the agent ignores personal inbox noise.
 */
const POLL_FILTER_LABEL = process.env.GMAIL_POLL_LABEL || "";

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
    messages = await listUnreadMessages(gmail, sinceSeconds, 25, POLL_FILTER_LABEL || undefined);
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

  // ── Pre-LLM spam filter: skip known non-customer senders ──
  // These domains send automated notifications to Jeff's personal inbox.
  // Skipping them saves LLM tokens without losing training value — they
  // are never real customer emails. Unknown senders still go through the
  // full InquiryAgent pipeline.
  const KNOWN_NOISE_DOMAINS = new Set([
    // Our own system emails (self-sent notifications, monitor alerts)
    "packgoplay.com", "packgo-travel.fly.dev",
    "venmo.com", "paypal.com", "cash.app",
    "substack.com", "beehiiv.com", "mailchimp.com", "convertkit.com",
    "mgmresorts.com", "hilton.com", "marriott.com",
    "linkedin.com", "facebook.com", "twitter.com", "x.com",
    "google.com", "youtube.com", "apple.com", "microsoft.com",
    "github.com", "notion.so", "slack.com",
    "robly.com", "constantcontact.com", "mailerlite.com",
    "noreply", "no-reply", "donotreply",
    "alerts@", "notifications@", "newsletter@", "digest@",
  ]);

  function isKnownNoise(from: string): boolean {
    const lower = from.toLowerCase();
    for (const pattern of KNOWN_NOISE_DOMAINS) {
      if (pattern.includes("@")) {
        // Prefix match (e.g. "noreply" matches "noreply@anything.com")
        if (lower.includes(pattern)) return true;
      } else {
        // Domain match
        if (lower.includes(`@${pattern}`) || lower.includes(`.${pattern}`)) return true;
      }
    }
    return false;
  }

  const customerEmails = fresh.filter((m) => {
    if (isKnownNoise(m.from)) {
      log.info({ from: m.from, subject: m.subject?.slice(0, 40) }, "[gmailPipeline] skipped known noise");
      return false;
    }
    return true;
  });
  const skippedNoise = fresh.length - customerEmails.length;

  const result: PipelineResult = {
    ok: true,
    emailAddress: integration.emailAddress,
    totalFetched: customerEmails.length,
    totalProcessed: 0,
    totalFailed: 0,
    totalEscalated: 0,
    errors: [],
  };

  if (skippedNoise > 0) {
    log.info({ skippedNoise, remaining: customerEmails.length }, "[gmailPipeline] pre-filtered known noise senders");
  }

  // Apply processed label to skipped noise so they don't reappear next poll
  for (const m of fresh) {
    if (isKnownNoise(m.from)) {
      try { await applyLabel(gmail, m.id, labelId); } catch {}
    }
  }

  // Get/seed v1 policies for inquiry + refund
  const inquiryPolicy = await ensurePolicy(db, "inquiry", DEFAULT_INQUIRY_POLICY);
  const refundPolicy = await ensurePolicy(db, "refund", DEFAULT_REFUND_POLICY);

  for (const msg of customerEmails) {
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

  // 2026-05-25 Phase 7 — pass parsed attachments to the agent so the
  // draft can actually reference customer-supplied PDFs/Excel/Word.
  // gmail.ts already capped + parsed; we just forward the per-attachment
  // shape the agent expects.
  const attachmentsForAgent = (msg.attachments || []).map((a) => ({
    filename: a.filename,
    kind: a.kind,
    sizeBytes: a.sizeBytes,
    text: a.text,
    parseStatus: a.parseStatus,
    parseError: a.parseError,
  }));

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
    attachments: attachmentsForAgent,
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
  // 2026-05-25 Phase 7 — append attachment summary to interaction content
  // so the audit trail shows what came in. Don't bloat content with full
  // attachment text (already in the agent prompt + LLM logs); just metadata.
  const attachmentSummary =
    attachmentsForAgent.length > 0
      ? "\n\n【附件】\n" +
        attachmentsForAgent
          .map(
            (a, i) =>
              `${i + 1}. ${a.filename} (${a.kind}, ${formatBytesShort(a.sizeBytes)}, ${a.parseStatus})`
          )
          .join("\n")
      : "";
  const interactionIns = await db.insert(customerInteractions).values({
    customerProfileId: profileId ?? 0,
    channel: "email",
    direction: "inbound",
    content: rawMessage + attachmentSummary,
    contentSummary:
      decision.intent +
      (attachmentsForAgent.length > 0
        ? ` (附 ${attachmentsForAgent.length} 個檔案)`
        : ""),
    sentiment: decision.sentiment,
    classification: decision.classification,
    urgency: urgencyMap[decision.urgency] ?? 50,
  });
  const interactionId = Number((interactionIns as any)[0]?.insertId ?? 0);

  // v2 Wave 3 Module 3.4-B — skill auto-dispatch.
  //
  // After the InquiryAgent has classified, give the skill registry a
  // chance to produce a richer draft (e.g. a tour-comparison PDF for
  // tour_comparison_request inquiries). The dispatcher itself gates on
  // confidence + shouldEscalate + skill-registered-and-ported, so a
  // skipped outcome here is normal and silent. A successful run posts
  // a proposal-type agentMessage so the draft shows up in Jeff's office
  // inbox; an escalated run flips `decision.shouldEscalate` so the
  // downstream legacy escalation path picks it up.
  try {
    const { dispatchAndPersistFromInquiry } = await import(
      "../skills/dispatcher"
    );
    const dispatchOutcome = await dispatchAndPersistFromInquiry({
      inquiry: decision,
      rawMessage,
      senderEmail: senderEmail ?? undefined,
      customerProfileId: profileId ?? undefined,
      interactionId,
      correlationId: `gmail-${interactionId}`,
    });
    if (dispatchOutcome.kind === "ran") {
      const { result, skillRunId, pdfStoragePath } = dispatchOutcome;
      if (result.ok) {
        // Drop a proposal message into Jeff's inbox so the draft is
        // reviewable + sendable from ChatsTab.
        const { notifyAgentMessage } = await import("../../_core/agentNotify");
        await notifyAgentMessage({
          agentName: "inquiry",
          messageType: "proposal",
          title: `📋 ${decision.classification} draft ready · ${senderEmail ?? "unknown sender"}`.slice(0, 200),
          body:
            `${result.draftBody}\n\n` +
            (pdfStoragePath ? `📎 PDF: ${pdfStoragePath}\n` : "") +
            `\n_skillRunId: ${skillRunId}_`,
          priority: decision.urgency === "critical" ? "critical" : decision.urgency === "high" ? "high" : "normal",
          context: {
            skillRunId,
            classification: decision.classification,
            confidence: decision.confidence,
            pdfStoragePath,
          },
          relatedInteractionId: interactionId,
          relatedCustomerProfileId: profileId ?? undefined,
        });
        log.info(
          {
            skillRunId,
            intent: decision.classification,
            pdfStoragePath,
            senderEmail,
          },
          "[gmailPipeline] Skill dispatch succeeded — draft posted to inbox",
        );
      } else {
        // Orchestrator returned ok=false — surface to Jeff via the same
        // legacy escalation channel below.
        decision.shouldEscalate = true;
        decision.escalationReason =
          (decision.escalationReason ?? "") +
          ` | skill dispatch escalation (run ${skillRunId}): ${result.reason}`;
        log.info(
          {
            skillRunId,
            intent: decision.classification,
            reason: result.reason,
            needsJeff: result.needsJeff,
          },
          "[gmailPipeline] Skill dispatch returned ok=false — escalating",
        );
      }
    }
    // dispatchOutcome.kind === "skipped" → no-op; existing draftReply
    // path handles it. Common reasons: confidence-below-threshold,
    // no-skill-registered (refund/complaint), agent-already-escalated.
  } catch (err) {
    // The dispatcher itself is no-throw, but the dynamic imports above
    // could fail if a build artifact is missing. Swallow so we don't
    // break the customer-facing draftReply path.
    log.warn(
      { err },
      "[gmailPipeline] Skill dispatch unexpectedly threw — continuing with legacy draft",
    );
  }

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

  // 2026-05-25 Phase 7 — surface attachments in inbox messages so Jeff
  // sees right away that an email had attachments and whether they parsed.
  const attachmentLine =
    attachmentsForAgent.length > 0
      ? "\n\n📎 附件: " +
        attachmentsForAgent
          .map((a) => {
            const status =
              a.parseStatus === "ok" || a.parseStatus === "ok_truncated"
                ? "✓ 已讀取"
                : `✗ ${a.parseStatus}`;
            return `${a.filename} (${a.kind}, ${status})`;
          })
          .join(" · ")
      : "";

  // If escalation, post to chatbox so Jeff sees it
  if (decision.shouldEscalate) {
    result.totalEscalated++;
    await db.insert(agentMessages).values({
      agentName: "inquiry",
      messageType: "escalation",
      title: `${inquiryClassificationLabelZh(decision.classification)} · ${senderEmail ?? "未知寄件人"} · "${msg.subject.slice(0, 60)}"${attachmentsForAgent.length > 0 ? ` 📎×${attachmentsForAgent.length}` : ""}`,
      body: `${decision.escalationReason ?? "這封我不確定怎麼處理,先給你看。"}\n\n客人想問:${decision.intent}${attachmentLine}\n\n---\n建議回覆(還沒送出,給你過目):\n${decision.draftReply}`,
      context: JSON.stringify({
        classification: decision.classification,
        urgency: decision.urgency,
        sentiment: decision.sentiment,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        gmailMessageId: msg.id,
        gmailThreadId: msg.threadId,
        attachments: attachmentsForAgent.map((a) => ({
          filename: a.filename,
          kind: a.kind,
          sizeBytes: a.sizeBytes,
          parseStatus: a.parseStatus,
        })),
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
      // 2026-05-25 Phase 7 — explain WHY we drafted-not-sent so Jeff
      // isn't surprised that an obviously valid email got escalated.
      // Three reasons we land in the no-sendOutcome path:
      //   (a) autoSendEnabled = false in policy (default — Jeff hasn't
      //       toggled it on yet)
      //   (b) confidence < autoSendMinConfidence (e.g. 70 < 85)
      //   (c) classification is in alwaysEscalate
      let draftReason = "";
      if (!sendOutcome) {
        if (!autoSendEnabled) {
          draftReason =
            " · (auto-send 全站關閉 — agentPolicies.inquiry.autoSendEnabled=false)";
        } else if (decision.confidence < autoSendThreshold) {
          draftReason = ` · (信心 ${decision.confidence} < 門檻 ${autoSendThreshold})`;
        }
      }
      const outcomeLabel =
        sendOutcome === "auto_replied"
          ? "✓ 已自動回覆"
          : sendOutcome === "would_auto_send"
          ? "✓ 已擬稿 (dry-run kill switch on)"
          : `📝 Draft 已存,等你 review${draftReason}`;
      await notifyAgentMessage({
        agentName: "inquiry",
        messageType: "observation",
        title: `${decision.classification} · ${senderEmail ?? "unknown"} · "${msg.subject.slice(0, 50)}"${attachmentsForAgent.length > 0 ? ` 📎×${attachmentsForAgent.length}` : ""}`,
        body:
          `${outcomeLabel}\n\n` +
          `Intent: ${decision.intent}\n` +
          `Urgency: ${decision.urgency} · Sentiment: ${decision.sentiment} · Confidence: ${decision.confidence}` +
          attachmentLine +
          (sendOutcome === "auto_replied"
            ? `\n\nReply sent:\n${decision.draftReply.slice(0, 500)}${decision.draftReply.length > 500 ? "..." : ""}`
            : `\n\nDraft:\n${decision.draftReply.slice(0, 500)}${decision.draftReply.length > 500 ? "..." : ""}`),
        priority: decision.urgency === "high" ? "high" : "low",
        relatedOutcomeId: outcomeId,
        relatedInteractionId: interactionId,
        relatedCustomerProfileId: profileId ?? undefined,
        context: {
          classification: decision.classification,
          confidence: decision.confidence,
          sendOutcome,
          gmailThreadId: msg.threadId,
          attachments: attachmentsForAgent.map((a) => ({
            filename: a.filename,
            kind: a.kind,
            sizeBytes: a.sizeBytes,
            parseStatus: a.parseStatus,
          })),
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

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
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
