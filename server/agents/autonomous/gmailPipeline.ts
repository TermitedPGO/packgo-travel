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
  customerDocuments,
} from "../../../drizzle/schema";
import { and, eq, sql, gt, isNotNull } from "drizzle-orm";
import { inquiryClassificationLabelZh } from "./inquiryLabels";
import {
  buildGmailClient,
  listUnreadMessages,
  listMessagesByIds,
  listHistoryMessageIds,
  selectIngestableMessages,
  ensureLabel,
  applyLabel,
  sendReplyInThread,
  fetchRawAttachments,
  type GmailMessageSummary,
} from "../../_core/gmail";
import { detectReceipt, extractReceipt, pickReceiptAttachment } from "../../_core/receiptExtractor";
import { scrubPii } from "../../_core/piiScrub";
import { touchLastInbound } from "../../_core/customerUnread";
import {
  createPendingExpense,
  getPendingExpenseByGmailMessageId,
} from "../../db";
import { storagePut } from "../../storage";
import { runInquiryAgent, DEFAULT_INQUIRY_POLICY } from "./inquiryAgent";
import { evaluateAutoSend } from "./autoSendGate";
import { runRefundAgent, DEFAULT_REFUND_POLICY } from "./refundAgent";
import { redis } from "../../redis";
import { createChildLogger } from "../../_core/logger";
const log = createChildLogger({ module: "gmailPipeline" });

const PROCESSED_LABEL = "PACKGO_AI_PROCESSED";

// ── push/poll cross-worker dedup (2026-07-01) ────────────────────────────────
// push (Pub/Sub) and the 3-min poll are two independent BullMQ workers with no
// shared lock. The PACKGO_AI_PROCESSED label is check-then-act: it's applied
// only AFTER processOneEmail's full LLM chain finishes (30–120s), so inside
// that window the other path still sees the same message as fresh and would
// double-process it (double LLM spend + duplicate office-inbox cards). A
// per-message Redis SET NX lock closes the window. TTL covers the slowest LLM
// chain. No explicit unlock: once processed the label gates every later cycle,
// and after a crash the lock simply expires so the next poll retries.
// FAIL-OPEN — a Redis blip must never drop customer mail; on error we process
// anyway (an occasional duplicate beats a lost email). Same SET NX pattern as
// enqueueCustomerSummaryRefresh in server/queue.ts.
const MESSAGE_LOCK_TTL_SECONDS = 300;

/**
 * Run `fn` only when this worker wins the per-message lock. Returns true when
 * fn ran (lock won, or Redis unavailable → fail-open), false when the other
 * push/poll path already holds the lock — the caller should SKIP, not retry:
 * the winner applies the processed label when it finishes. Errors from `fn`
 * propagate unchanged so the caller's existing failure accounting still works.
 */
export async function processWithMessageLock(
  messageId: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  let acquired = true;
  try {
    const ok = await redis.set(
      `gmail:msg-lock:${messageId}`,
      "1",
      "EX",
      MESSAGE_LOCK_TTL_SECONDS,
      "NX",
    );
    acquired = ok === "OK";
  } catch (e) {
    log.warn(
      { err: e, messageId },
      "[gmailPipeline] message lock unavailable — fail-open, processing anyway",
    );
    acquired = true;
  }
  if (!acquired) {
    log.info(
      { messageId },
      "[gmailPipeline] message locked by concurrent push/poll worker — skip",
    );
    return false;
  }
  await fn();
  return true;
}

/**
 * When set, only emails carrying this Gmail label are processed.
 * Jeff should create a Gmail filter: to:support@packgoplay.com → add label PACKGO_SUPPORT
 * Then set this env var on Fly so the agent ignores personal inbox noise.
 */
const POLL_FILTER_LABEL = process.env.GMAIL_POLL_LABEL || "";

// gmail-trailing-reconcile — re-sync customer threads active within this window
// every poll, regardless of read state, to back-fill already-read trailing
// replies the is:unread poll can never re-see. Bounded per cycle to stay cheap.
const RECONCILE_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // 4 days
const RECONCILE_MAX_THREADS = 40;

export type PipelineResult = {
  ok: boolean;
  emailAddress: string;
  totalFetched: number;
  totalProcessed: number;
  totalFailed: number;
  totalEscalated: number;
  /** email-receipt-intake — receipts queued into pendingExpenses this run. */
  totalReceipts: number;
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
      totalReceipts: 0,
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
    totalFetched: 0,
    totalProcessed: 0,
    totalFailed: 0,
    totalEscalated: 0,
    totalReceipts: 0,
    errors: [],
  };

  // gmail-push (2026-06-29) — the receipt pass + noise filter + per-email
  // ingest loop is now shared with the push path (runGmailPipelineForMessageIds)
  // via ingestFreshMessages. Behavior is byte-identical to the previous inline
  // block; it mutates `result` in place and returns the per-cycle syncedThreads
  // set so the poll-only trailing-reconcile below can dedup against it.
  const syncedThreads = await ingestFreshMessages(db, fresh, result, {
    gmail,
    labelId,
    fromEmail,
    integrationId,
  });

  // ── gmail-trailing-reconcile ──────────────────────────────────────────────
  // The unread poll (is:unread) never re-sees a message Jeff already opened, and
  // the per-inbound thread sync (processOneEmail [5]) only fires when a NEW
  // inbound arrives. So a thread whose LAST message is an already-read reply —
  // e.g. a customer's closing「謝謝🙏」read before the next 10-min tick — silently
  // never gets filed (root cause of "還是少了一則訊息"). Re-sync every recently
  // active customer thread regardless of read state. syncThreadToInteractions is
  // idempotent (claim-or-insert on Message-ID), so re-running only back-fills the
  // gap. Best-effort: a failure here must never break mail processing. Cheap at
  // PACK&GO scale (≤40 threads × 1 thread.get, 20×/hr ≪ Gmail quota).
  try {
    const since = new Date(Date.now() - RECONCILE_WINDOW_MS);
    const recentThreads = await db
      .selectDistinct({
        profileId: customerInteractions.customerProfileId,
        threadId: customerInteractions.gmailThreadId,
      })
      .from(customerInteractions)
      .where(
        and(
          isNotNull(customerInteractions.gmailThreadId),
          gt(customerInteractions.createdAt, since),
        ),
      )
      .limit(RECONCILE_MAX_THREADS);

    const [{ listThreadMessagesForFiling }, { syncThreadToInteractions }] =
      await Promise.all([
        import("../../_core/gmail"),
        import("../../_core/threadFiling"),
      ]);

    let reconciled = 0;
    let backfilled = 0;
    for (const t of recentThreads) {
      // Skip threads already synced this cycle off a fresh inbound (dedup).
      if (!t.threadId || syncedThreads.has(t.threadId)) continue;
      syncedThreads.add(t.threadId);
      try {
        const filingMsgs = await listThreadMessagesForFiling(
          gmail,
          t.threadId,
          fromEmail,
        );
        const synced = await syncThreadToInteractions(db, t.profileId, filingMsgs);
        reconciled++;
        backfilled += synced.inserted + synced.claimed;
      } catch {
        // A thread id from a different mailbox 404s on this client, or a
        // transient Gmail error — skip it, the next tick retries.
      }
    }
    if (backfilled > 0) {
      log.info(
        { reconciled, backfilled },
        "[gmailPipeline] trailing-reconcile back-filled read-but-unfiled messages",
      );
    }
  } catch (e) {
    log.warn(
      { err: e },
      "[gmailPipeline] trailing-reconcile failed (non-fatal)",
    );
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

// ── Pre-LLM noise filtering (module-scope pure functions, unit-tested in
//    gmailPipeline.noise.test.ts) ────────────────────────────────────────────

/**
 * gmail-push noreply firewall (P2, 2026-07-01) — pure sender check shared by
 * the push path (runGmailPipelineForMessageIds) and the isKnownNoise fallback
 * below. The 3-min poll's Gmail query already carries `-from:noreply`
 * (listUnreadMessages, server/_core/gmail.ts), so noreply notifications never
 * reach the pipeline via poll; the push history-diff has no Gmail query, so
 * it must apply the same gate in JS — otherwise, with GMAIL_POLL_LABEL unset,
 * every noreply notification (noreply@united.com …) enters the full
 * InquiryAgent pipeline seconds after arrival: one LLM chain burned per
 * email + a junk card in the office inbox.
 *
 * Matches the LOCALPART (before the @) containing noreply / no-reply /
 * no_reply, case-insensitive. Deliberately narrow — noreply-class only, no
 * broader blacklist (that's KNOWN_NOISE_DOMAINS' job below).
 */
export function isNoreplySender(from: string): boolean {
  // From header may be `Name <local@domain>` or bare `local@domain`;
  // parseEmailAddress extracts + lowercases, falls back for malformed input.
  const email = parseEmailAddress(from) ?? from.toLowerCase();
  const at = email.indexOf("@");
  const localpart = at === -1 ? email : email.slice(0, at);
  return /no[-_]?reply/.test(localpart);
}

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
  // NOTE: these three only ever match DOMAIN forms (@noreply…/.noreply…) via
  // the loop below; noreply-class LOCALPARTS (noreply@united.com) are handled
  // by the isNoreplySender check at the top of isKnownNoise.
  "noreply", "no-reply", "donotreply",
  "alerts@", "notifications@", "newsletter@", "digest@",
]);

/**
 * 自家信箱防火牆 (2026-07-02) — Jeff 自己/系統的寄件地址絕不建客人檔。真實
 * 案例:jeffhsieh0909@gmail.com 寄的「Better way To survive」信被建成幽靈
 * 客人卡。這不是 noise filter(KNOWN_NOISE_DOMAINS 是整封信直接跳過,而且
 * 它只能擋整個網域 — 自家 gmail 地址擋 gmail.com 會誤殺所有 gmail 客人;
 * support@packgoplay.com 的網域雖已在該表,防線仍以這裡的全字比對為準)。
 * 命中時信照常跑 receipt/inquiry 流程,只跳過 profile 建檔+歸戶 — 行為
 * 等同寄件人解析不到(profileId undefined)那條既有路徑。
 */
const OWN_EMAILS = new Set([
  "jeffhsieh09@gmail.com",
  // jeffhsieh0909 刻意「不在」黑名單:它是專職 E2E 測試客人(Google 顯示名
  // Better way To survive,Jeff 2026-07-02 拍板)。從它寄進來的信要走完整
  // 客人管線(建卡/歸檔/摘要/草稿),用來對客戶頁做真實驗收。
  "support@packgoplay.com",
]);

/** Case-insensitive own-address check (pure; unit-tested in gmailPipeline.sender.test.ts). */
export function isOwnEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && OWN_EMAILS.has(email.trim().toLowerCase());
}

export function isKnownNoise(from: string): boolean {
  // noreply-class localparts (noreply@united.com, no-reply@delta.com …) —
  // shared pure check with the push-path firewall. P2 fix (2026-07-01): the
  // domain-match branch below (`@noreply` / `.noreply`) can never match a
  // noreply LOCALPART, which let these leak into the LLM pipeline whenever a
  // message bypassed the poll's `-from:noreply` query (the push path).
  if (isNoreplySender(from)) return true;
  const lower = from.toLowerCase();
  for (const pattern of KNOWN_NOISE_DOMAINS) {
    if (pattern.includes("@")) {
      // Prefix match (e.g. "alerts@" matches "alerts@anything.com")
      if (lower.includes(pattern)) return true;
    } else {
      // Domain match
      if (lower.includes(`@${pattern}`) || lower.includes(`.${pattern}`)) return true;
    }
  }
  return false;
}

/**
 * gmail-push — shared ingest core. Takes a set of fresh (not-yet-labeled)
 * GmailMessageSummary and runs the SAME three gates the poll always used:
 *   1. receipt pass (rules-only sniff → vision extract → pendingExpenses)
 *   2. known-noise sender filter (saves LLM tokens)
 *   3. per-email InquiryAgent pipeline (processOneEmail) + PACKGO_AI_PROCESSED
 *      label so the same email is never re-processed (the idempotency gate that
 *      makes push + poll safe to both touch one message).
 *
 * Mutates `result` in place (counters + errors) and returns the per-cycle
 * `syncedThreads` set so the poll's trailing-reconcile can dedup against it.
 * Pure-logic-wise identical to the old inline block in runGmailPipeline.
 */
async function ingestFreshMessages(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  fresh: GmailMessageSummary[],
  result: PipelineResult,
  ctx: {
    gmail: ReturnType<typeof buildGmailClient>;
    labelId: string;
    fromEmail: string;
    integrationId: number;
  },
): Promise<Set<string>> {
  const { gmail, labelId, fromEmail, integrationId } = ctx;

  // ── email-receipt-intake: receipt pass (runs BEFORE the noise filter) ──
  // Receipts/invoices often come from hotels, airlines, and vendors whose
  // domains the noise filter below would drop (marriott/hilton/…), so we sniff
  // for receipts FIRST. Detection is rules-only (no LLM); only the few that
  // pass get the (paid) vision extraction. Receipts are queued into
  // pendingExpenses and removed from the customer-inquiry flow — a vendor
  // invoice must never trigger a customer reply draft.
  const nonReceipt: GmailMessageSummary[] = [];
  for (const m of fresh) {
    let looksLikeReceipt = false;
    try {
      looksLikeReceipt = detectReceipt({
        subject: m.subject,
        body: m.body,
        attachments: m.attachments ?? [],
      }).isReceipt;
    } catch {
      looksLikeReceipt = false;
    }
    if (!looksLikeReceipt) {
      nonReceipt.push(m);
      continue;
    }
    try {
      const queued = await processReceiptEmail(db, m, { gmail, integrationId });
      // Only label (suppress re-poll) once the row is safely queued. The
      // gmailMessageId dedup guard inside processReceiptEmail makes a retry
      // after a partial failure harmless (no duplicate rows).
      await applyLabel(gmail, m.id, labelId);
      if (queued) result.totalReceipts++;
    } catch (e) {
      result.totalFailed++;
      const msgStr = e instanceof Error ? e.message : String(e);
      result.errors.push(`receipt ${m.id}: ${msgStr}`);
      log.error(
        { err: e, messageId: m.id, subject: m.subject?.slice(0, 60), from: m.from },
        "[gmailPipeline] Failed receipt",
      );
    }
  }

  // ── Pre-LLM spam filter — isKnownNoise + KNOWN_NOISE_DOMAINS live at
  // module scope (above) so the noreply check is shared with the push-path
  // firewall and unit-testable.
  const customerEmails = nonReceipt.filter((m) => {
    if (isKnownNoise(m.from)) {
      log.info({ from: m.from, subject: m.subject?.slice(0, 40) }, "[gmailPipeline] skipped known noise");
      return false;
    }
    return true;
  });
  const skippedNoise = nonReceipt.length - customerEmails.length;
  result.totalFetched = customerEmails.length;

  if (skippedNoise > 0) {
    log.info({ skippedNoise, remaining: customerEmails.length }, "[gmailPipeline] pre-filtered known noise senders");
  }

  // Apply processed label to skipped noise so they don't reappear next poll
  for (const m of nonReceipt) {
    if (isKnownNoise(m.from)) {
      try { await applyLabel(gmail, m.id, labelId); } catch {}
    }
  }

  // Get/seed v1 policies for inquiry + refund
  const inquiryPolicy = await ensurePolicy(db, "inquiry", DEFAULT_INQUIRY_POLICY);
  const refundPolicy = await ensurePolicy(db, "refund", DEFAULT_REFUND_POLICY);

  // gmail-full-thread-filing [5] — per-cycle set so several emails sharing one
  // thread only trigger a single (idempotent) thread sync this cycle.
  const syncedThreads = new Set<string>();

  for (const msg of customerEmails) {
    try {
      const ran = await processWithMessageLock(msg.id, () =>
        processOneEmail(db, msg, inquiryPolicy, refundPolicy, result, {
          gmail,
          fromEmail,
          syncedThreads,
        }),
      );
      // Lock held → the OTHER path (push vs poll) is mid-processing this exact
      // message. Skip, don't retry: the winner applies PACKGO_AI_PROCESSED when
      // it finishes, which gates every later cycle.
      if (!ran) continue;
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

  return syncedThreads;
}

/**
 * gmail-push (2026-06-29) — incremental ingest driven by a Gmail push
 * notification. Given the historyId carried in the Pub/Sub message, diff via
 * history.list to get the message ids added since lastHistoryId, hydrate them,
 * and run the SAME ingest gates as the poll (ingestFreshMessages). Updates
 * lastHistoryId to the newest seen so the next push diffs forward.
 *
 * Backward-compatible: the every-3-min runGmailPipeline is untouched and still
 * the fallback. This path is best-effort and idempotent — the PACKGO_AI_PROCESSED
 * label means a message touched by both push and poll is processed once.
 *
 * If history.list reports the stored historyId is expired (404, outside Gmail's
 * retention), we DON'T try to ingest a partial diff; we just advance the
 * baseline (when available) and let the time-window poll catch up. Returns
 * counters for the worker log.
 */
export async function runGmailPipelineForMessageIds(
  integrationId: number,
  notifiedHistoryId?: string,
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

  const result: PipelineResult = {
    ok: true,
    emailAddress: integration.emailAddress,
    totalFetched: 0,
    totalProcessed: 0,
    totalFailed: 0,
    totalEscalated: 0,
    totalReceipts: 0,
    errors: [],
  };

  // Baseline to diff from: prefer the stored lastHistoryId. If we have none yet
  // (e.g. watch registered but no prior diff), seed from the notification's
  // historyId so the NEXT push has a baseline; nothing to ingest this round.
  const startHistoryId = integration.lastHistoryId ?? null;
  if (!startHistoryId) {
    if (notifiedHistoryId) {
      await db
        .update(gmailIntegration)
        .set({ lastHistoryId: notifiedHistoryId })
        .where(eq(gmailIntegration.id, integrationId));
    }
    log.info(
      { integrationId, notifiedHistoryId },
      "[gmailPipeline] push: no baseline historyId yet — seeded, deferring to poll",
    );
    return result;
  }

  let diff: Awaited<ReturnType<typeof listHistoryMessageIds>>;
  try {
    diff = await listHistoryMessageIds(gmail, startHistoryId, { labelId: "INBOX" });
  } catch (e) {
    result.ok = false;
    result.errors.push(
      `history.list failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return result;
  }

  // Advance the baseline regardless of whether there were messages, so we never
  // re-diff the same window. On expiry (404) the poll's time-window covers the
  // gap; we still advance to the latest historyId when Gmail returned one.
  const newBaseline = diff.latestHistoryId ?? notifiedHistoryId ?? startHistoryId;

  if (diff.expired) {
    await db
      .update(gmailIntegration)
      .set({ lastHistoryId: newBaseline })
      .where(eq(gmailIntegration.id, integrationId));
    log.warn(
      { integrationId, startHistoryId },
      "[gmailPipeline] push: historyId expired — re-baselined, poll will reconcile",
    );
    return result;
  }

  // Hydrate the added ids → summaries, drop anything already PACKGO_AI_PROCESSED
  // (poll may have beaten us to it). CRITICAL: also mirror the poll's
  // GMAIL_POLL_LABEL firewall. The 3-min poll scopes its Gmail query to
  // POLL_FILTER_LABEL (line ~119) so the agent never reads Jeff's PERSONAL mail;
  // the push diff sees the whole INBOX, so without the same gate push would
  // ingest every personal email. When POLL_FILTER_LABEL is unset, neither path
  // filters (whole inbox) — they stay behaviorally identical.
  const summaries = diff.messageIds.length
    ? await listMessagesByIds(gmail, diff.messageIds)
    : [];
  const filterLabelId =
    summaries.length && POLL_FILTER_LABEL ? await ensureLabel(gmail, POLL_FILTER_LABEL) : null;
  // P2 noreply firewall (2026-07-01) — the poll's Gmail query ALSO carries
  // `-from:noreply`; mirror it here, BEFORE any ingest gate (receipt pass
  // included), so push/poll parity is exact: the poll never even sees these
  // messages. Without this, with GMAIL_POLL_LABEL unset, every noreply
  // notification pushed via Pub/Sub burned a full InquiryAgent LLM chain +
  // spammed the office inbox (isKnownNoise's localpart bug let them through).
  // Deliberately narrow: noreply-class senders only (see isNoreplySender).
  const fresh = selectIngestableMessages(summaries, labelId, filterLabelId).filter((m) => {
    if (!isNoreplySender(m.from)) return true;
    log.info(
      { from: m.from, subject: m.subject?.slice(0, 40) },
      "[gmailPipeline] push: skipped noreply sender (poll-parity firewall)",
    );
    return false;
  });

  if (fresh.length > 0) {
    await ingestFreshMessages(db, fresh, result, {
      gmail,
      labelId,
      fromEmail,
      integrationId,
    });
  }

  await db
    .update(gmailIntegration)
    .set({
      lastPollAt: new Date(),
      lastHistoryId: newBaseline,
      messagesProcessed: integration.messagesProcessed + result.totalProcessed,
      messagesFailed: integration.messagesFailed + result.totalFailed,
    })
    .where(eq(gmailIntegration.id, integrationId));

  log.info(
    {
      integrationId,
      added: diff.messageIds.length,
      ingested: fresh.length,
      processed: result.totalProcessed,
      receipts: result.totalReceipts,
    },
    "[gmailPipeline] push incremental ingest done",
  );

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
    /** Thread ids already synced this poll cycle (in-memory dedup). */
    syncedThreads: Set<string>;
  }
): Promise<void> {
  // Extract sender email
  const senderEmail = parseEmailAddress(msg.from);

  // Upsert customer profile
  let profileId: number | undefined;
  /** the card whose email literally equals the sender — user-account linking
   * must target THIS card, never a merge-canonicalized one (0109). */
  let emailMatchedProfileId: number | undefined;
  // 自家信箱 gate (2026-07-02):自己寄的信絕不建客人卡、不歸戶 — profileId
  // 留 undefined,下游(互動 filed 到 0、不 touch 紅點、不收文件、不連會員)
  // 全部走既有的「寄件人解析不到」路徑,信本身照常處理。
  if (senderEmail && !isOwnEmail(senderEmail)) {
    const existing = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.email, senderEmail))
      .limit(1);
    if (existing[0]) {
      // 0109:這張卡可能已被併進別人(隱藏卡),跟指標走到最終卡再落資料,
      // 否則被併走的 email 之後來信會消失在列表外(leslie→Emerald 案)。
      // 0702 auto-heal(G2):resolveCanonicalForFiling = followMergePointer
      // + 同 email「訪客卡+會員卡」並存自癒。真實事故:jeffhsieh0909 的訪客卡
      // #2730001(userId NULL,吃掉所有來信)與會員卡 #2760017(userId 60001)
      // 並存 → 列表只看得到會員卡,紅點永遠不亮。進信解析到訪客卡且恰有一張
      // 同 email 會員卡時,當場把訪客卡整份併進會員卡(與 chat 合併工具同一套
      // mergeCustomerProfiles 語意),新訊息 file 到會員卡。heal 失敗 helper
      // 內部 log.warn 後照舊回訪客卡 — 收信絕不因 heal 斷掉。0909 那對卡不需
      // 要資料遷移:下一封來信進來就自癒(heal 完訪客卡帶 0109 指標,之後
      // followMergePointer 直接轉到會員卡,不會併第二次)。
      const { resolveCanonicalForFiling } = await import("../../_core/customerMerge");
      profileId = await resolveCanonicalForFiling(db, existing[0].id, senderEmail);
      // 帳號連結只准綁「email 真正對上的那張卡」:指標走過之後 profileId 是
      // 別人的卡,綁上去會把整張同案卡變成寄件人的會員卡(review:跨身分
      // 汙染)。所以記下原卡 id,下面 linkProfileToUserByEmail 用它。
      emailMatchedProfileId = existing[0].id;
    } else {
      // 建檔帶 Gmail 顯示名 (2026-07-02) — brand-new sender 的卡片直接帶 From
      // header 的顯示名("Leslie Green <l@x>" → name: Leslie Green),列表不再
      // 只剩一串 email。只在「全新 INSERT」這一枝:既有卡的 name 絕不覆寫。
      const senderName = parseSenderName(msg.from);
      // insertCustomerProfileSafely (2026-07-03, 任務7 對抗審查 P0) — closes the
      // race window between the `existing` SELECT above and this INSERT; two
      // concurrent poll runs processing mail from the same brand-new sender
      // would otherwise both see "no match" and both insert.
      const { insertCustomerProfileSafely } = await import("../../db/customerProfile");
      const insertResult = await insertCustomerProfileSafely(db, {
        email: senderEmail,
        ...(senderName ? { name: senderName.slice(0, 255) } : {}),
      });
      profileId = insertResult.profileId;
      emailMatchedProfileId = profileId;

      // customer-cockpit Step 2 — a brand-new sender: auto-collect their entire
      // Gmail history into customerInteractions (fire-forget) so Jeff never has
      // to type「收」. Only NEW profiles reach this branch, so existing customers
      // are never re-backfilled; the backfill core is idempotent so a retry is
      // harmless. A queue hiccup must never break mail processing.
      if (profileId) {
        try {
          const { customerBackfillQueue } = await import("../../queue");
          void customerBackfillQueue.add(
            "auto-collect",
            { profileId, email: senderEmail },
            { jobId: `auto-collect-${profileId}` },
          );
        } catch (e) {
          log.warn(
            { err: e, profileId },
            "[gmailPipeline] auto-collect enqueue failed (non-fatal)",
          );
        }
      }
    }

    // 批9 m2 — email 歸戶: when the sender is a REGISTERED customer, link
    // the profile to their account (WeChat 歸戶 pattern moved to email).
    // Failure here must never kill mail processing — link is best-effort.
    if (emailMatchedProfileId) {
      try {
        const { linkProfileToUserByEmail } = await import(
          "../../_core/emailCustomerMatch"
        );
        await linkProfileToUserByEmail(emailMatchedProfileId, senderEmail);
      } catch (e) {
        log.warn(
          { err: e, profileId },
          "[gmailPipeline] email→user link failed (non-fatal)",
        );
      }
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
  const emailHeader = `From: ${msg.from}\nSubject: ${msg.subject}\n\n`;
  // Wrapped version → the LLM only (injection defense). Stored/displayed
  // content uses the CLEAN body — the <untrusted_input> wrapper must never
  // leak into Jeff's admin UI (2026-06-13 bug: guest card showed the tag).
  const rawMessage = `${emailHeader}${shielded.wrapped}`;
  const cleanMessage = `${emailHeader}${msg.body}`;

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

  // 2026-06-13 tour-reference-resolve m2 — resolve tour references BEFORE
  // drafting so the agent can name real tours / honestly ask when a code
  // (e.g. YG7) matches nothing. Bounded: extracts code/location tokens in JS
  // first, only queries the catalog when present. Best-effort — a resolver
  // failure must never block the reply.
  let tourCandidates: Awaited<
    ReturnType<typeof import("../../_core/tourReferenceResolver").resolveFromEmail>
  >["candidates"] = [];
  let unknownTourCodes: string[] = [];
  try {
    const { resolveFromEmail } = await import(
      "../../_core/tourReferenceResolver"
    );
    const resolved = await resolveFromEmail(`${msg.subject}\n${msg.body}`);
    tourCandidates = resolved.candidates;
    unknownTourCodes = resolved.unknownCodes;
  } catch (err) {
    log.warn({ err, senderEmail }, "[gmailPipeline] tour resolve failed (non-fatal)");
  }

  // 2026-06-13 (B) — fetch the full Gmail thread so the agent sees the whole
  // back-and-forth (Jeff's prior replies + the customer's follow-ups), not
  // just this one email. Best-effort; a thread-fetch failure must never block.
  let threadHistory: Array<{
    direction: "inbound" | "outbound";
    from?: string;
    body: string;
  }> = [];
  try {
    if (msg.threadId) {
      const { getThreadHistory } = await import("../../_core/gmail");
      const hist = await getThreadHistory(
        sendCtx.gmail,
        msg.threadId,
        sendCtx.fromEmail,
        { maxMessages: 12 },
      );
      threadHistory = hist.map((h) => ({
        direction: h.direction,
        from: h.from,
        body: h.body,
      }));
    }
  } catch (err) {
    log.warn({ err, senderEmail }, "[gmailPipeline] thread history fetch failed (non-fatal)");
  }

  // Run InquiryAgent
  const decision = await runInquiryAgent({
    rawMessage,
    channel: "email",
    customerProfile: profileId
      ? await (async () => {
          const [p] = await db
            .select({
              id: customerProfiles.id,
              email: customerProfiles.email,
              preferredLanguage: customerProfiles.preferredLanguage,
              communicationStyle: customerProfiles.communicationStyle,
              familyContext: customerProfiles.familyContext,
              aiNotes: customerProfiles.aiNotes,
              keyFacts: customerProfiles.keyFacts,
              preferences: customerProfiles.preferences,
              vipScore: customerProfiles.vipScore,
            })
            .from(customerProfiles)
            .where(eq(customerProfiles.id, profileId!))
            .limit(1);
          if (!p) return { id: profileId!, email: senderEmail };
          return {
            ...p,
            preferences: (p.preferences ?? null) as Record<string, unknown> | null,
          };
        })()
      : undefined,
    recentInteractions: recentInteractions.map((i) => ({
      direction: i.direction,
      contentSummary: i.contentSummary,
      sentiment: i.sentiment,
      createdAt: i.createdAt,
    })),
    policyRules: inquiryPolicy.rules,
    attachments: attachmentsForAgent,
    tourCandidates,
    unknownTourCodes,
    threadHistory,
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
  // gmail-full-thread-filing [3] — stamp the dedup key (RFC822 Message-ID) +
  // thread id at write time so (a) the end-of-poll thread sync recognises THIS
  // row and skips it instead of inserting a duplicate, and (b) a cross-account
  // copy of the same email collapses to one row via UNIQUE(profile, externalId).
  let interactionId = 0;
  try {
    const interactionIns = await db.insert(customerInteractions).values({
      customerProfileId: profileId ?? 0,
      channel: "email",
      direction: "inbound",
      // scrubPii: never store a live card number (PAN) at rest — customers paste
      // them in booking emails. See server/_core/piiScrub.ts (audit 2026-06-22).
      content: scrubPii(cleanMessage + attachmentSummary),
      contentSummary:
        decision.intent +
        (attachmentsForAgent.length > 0
          ? ` (附 ${attachmentsForAgent.length} 個檔案)`
          : ""),
      sentiment: decision.sentiment,
      classification: decision.classification,
      urgency: urgencyMap[decision.urgency] ?? 50,
      externalId: msg.messageId,
      gmailThreadId: msg.threadId,
      // Stamp with the email's actual received time, not the poll/filing time, so
      // the conversation shows the real date and stays in chronological order.
      // Without this it defaults to now() — a backlogged or late-polled email
      // showed "today" (the 時間/日期都不對 bug). Mirrors sentMailFiling's outbound
      // fix. msg.receivedAt = Gmail internalDate.
      createdAt: msg.receivedAt,
    });
    interactionId = Number((interactionIns as any)[0]?.insertId ?? 0);
  } catch (e: any) {
    // UNIQUE(customerProfileId, externalId) tripped — this exact email is already
    // filed (a retry after a mid-message failure left the row but never applied
    // the processed label, or a cross-account duplicate). Reuse the existing
    // row's id so the rest of processing (outcome, escalation) proceeds instead
    // of re-throwing every poll and getting permanently stuck. See plan §七 race note.
    // The lookup key must mirror what the INSERT wrote — (profileId ?? 0,
    // messageId) — so the own-email / unparseable-From path (profileId
    // undefined → row filed at profile 0) recovers too instead of rethrowing
    // every poll forever (dupRecoveryLookupId, G3 review P2).
    const dupLookupId = dupRecoveryLookupId(e, profileId);
    if (dupLookupId !== null) {
      const [dup] = await db
        .select({ id: customerInteractions.id })
        .from(customerInteractions)
        .where(
          and(
            eq(customerInteractions.customerProfileId, dupLookupId),
            eq(customerInteractions.externalId, msg.messageId),
          ),
        )
        .limit(1);
      interactionId = dup?.id ?? 0;
      log.info(
        { profileId: dupLookupId, externalId: msg.messageId },
        "[gmailPipeline] inbound already filed (dup key) — reusing row",
      );
    } else {
      throw e;
    }
  }

  // customer-unread (0108) — a customer message just landed: advance the
  // profile's lastInboundAt so the cockpit red dot lights up. Monotonic +
  // best-effort (never throws), and safe to call on the dup-key path too
  // (re-touching the same receivedAt matches 0 rows).
  if (profileId) await touchLastInbound(db, profileId, msg.receivedAt);

  // 2026-06-21 — file inbound DOCUMENT attachments (pdf/docx/xlsx/csv, or a
  // sizeable image such as a passport scan) as customerDocuments so they show
  // in the customer page 文件 tab. Previously attachments were parsed to text
  // only and the bytes discarded → the tab was always empty for email
  // customers. Best-effort: a filing failure must never block mail processing.
  // The R2 KEY is stored (not a URL); the docs route signs a short-TTL URL on
  // read since these can carry PII.
  if (profileId && (msg.attachments?.length ?? 0) > 0) {
    try {
      const [{ isCustomerDocAttachment, customerDocR2Key }, { detectAttachmentKind }] =
        await Promise.all([
          import("../../_core/customerDocFiling"),
          import("../../_core/attachmentParser"),
        ]);
      // Pre-filter on the cheap, already-parsed summary metadata (kind +
      // sizeBytes) so we only pay the heavy raw-bytes re-fetch when something
      // actually qualifies — an inline-logo-only email never triggers a fetch.
      const wanted = (msg.attachments ?? []).some((a) =>
        isCustomerDocAttachment(a.kind, a.sizeBytes),
      );
      if (wanted) {
        const raw = await fetchRawAttachments(sendCtx.gmail, msg.id);
        for (const a of raw) {
          const kind = detectAttachmentKind(a.filename, a.mimeType);
          if (!isCustomerDocAttachment(kind, a.bytes.length)) continue;
          // No filename dedup: a re-sent DIFFERENT file under the same name
          // (renewed passport.pdf, generic scan.pdf) must NOT be silently
          // dropped. Re-poll can't double-file — the worker is concurrency-1
          // and labels each message processed once. Per-attachment try/catch
          // so one failed upload/insert never drops the others.
          try {
            const key = customerDocR2Key(
              profileId,
              a.filename,
              Date.now(),
              Math.random().toString(36).slice(2, 8),
            );
            const put = await storagePut(
              key,
              a.bytes,
              a.mimeType || "application/octet-stream",
            );
            await db.insert(customerDocuments).values({
              customerProfileId: profileId,
              type: "other",
              fileName: a.filename.slice(0, 255),
              r2Url: put.key,
              uploadedBy: "email",
            });
          } catch (e) {
            log.warn(
              { err: e, profileId },
              "[gmailPipeline] one customer-doc attachment failed (non-fatal)",
            );
          }
        }
      }
    } catch (e) {
      log.warn(
        { err: e, profileId },
        "[gmailPipeline] customer-doc filing failed (non-fatal)",
      );
    }
  }

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
        // 2026-07-01 語言 gate — en 客人以 code 層偵測為準,免得 LLM 自報的
        // draftLanguage 標錯,讓通過語言 gate 的英文草稿又被貼上中文 CTA。
        language: decision.expectedLanguage === "en" ? "en" : decision.draftLanguage,
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
  // email-auto-reply m1 — the eight-step gate lives in autoSendGate.ts
  // (pure, unit-tested). The pipeline only counts today's sends and
  // executes the verdict. Shadow evidence records even while the master
  // switch is off (Stage A of the 信任階梯, 拍板 2026-06-12).
  let todaysAutoSent = 0;
  try {
    const [capRow] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(interactionOutcomes)
      .where(
        and(
          eq(interactionOutcomes.agentName, "inquiry"),
          eq(interactionOutcomes.actionTaken, "auto_replied"),
          sql`DATE(${interactionOutcomes.createdAt}) = CURDATE()`,
        ),
      );
    todaysAutoSent = Number(capRow?.c ?? 0);
  } catch {
    // count failure must fail SAFE: pretend the cap is hit
    todaysAutoSent = Number.MAX_SAFE_INTEGER;
  }

  let gate = evaluateAutoSend(
    {
      classification: decision.classification,
      confidence: decision.confidence,
      shouldEscalate: decision.shouldEscalate,
      hasAttachments: attachmentsForAgent.length > 0,
      todaysAutoSent,
    },
    parsedPolicy,
  );
  let meetsAutoSend = gate.verdict !== "draft";

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
      gate = { verdict: "draft", reason: "post-llm-blacklist" };
    }
  }

  // Phase 2.5: execute the verdict. "shadow" records the evidence and
  // sends NOTHING (decoupled from the global AGENT_DRY_RUN env, which
  // stays as the emergency stop for REAL sends only).
  let sendOutcome: "auto_replied" | "would_auto_send" | "send_failed" | null = null;
  let sentGmailMessageId: string | undefined;
  if (gate.verdict === "shadow" && senderEmail) {
    sendOutcome = "would_auto_send";
  } else if (gate.verdict === "send" && meetsAutoSend && senderEmail) {
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
      content: scrubPii(decision.draftReply),
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
    // ai-auto-quote-inquiry Slice 1 — surface the structured understanding
    // ("我理解你要 X、還缺 Y") on the card so Jeff sees the AI grasped the
    // request, not just a one-line intent. Empty when not a trip inquiry.
    const req = decision.extractedRequirements;
    const reqLine =
      req && req.applicable
        ? "\n\n我理解的需求:" +
          ([
            req.destination,
            req.days,
            req.partySize,
            req.roomType,
            req.dates,
            req.includesFlights,
            req.budget,
            req.specialNeeds,
          ]
            .filter((x): x is string => !!x)
            .join(" · ") || "(看不出具體要素)") +
          (req.missing.length > 0 ? `\n還缺:${req.missing.join("、")}` : "")
        : "";
    // 2026-07-01 語言 gate — en 客人的草稿兩次都夾中文時,inquiryAgent 已把
    // draftReply 丟成空字串(decision.draftDropped 帶人話理由,escalationReason
    // 也已含)。卡片仍浮出,但不掛髒草稿、也不渲染一個空的「建議回覆」區塊。
    const draftBlock = decision.draftReply
      ? `\n\n---\n建議回覆(還沒送出,給你過目):\n${decision.draftReply}`
      : decision.draftDropped
        ? `\n\n---\n(這封沒有附草稿:${decision.draftDropped.reason})`
        : "";
    await db.insert(agentMessages).values({
      agentName: "inquiry",
      messageType: "escalation",
      title: `${inquiryClassificationLabelZh(decision.classification)} · ${senderEmail ?? "未知寄件人"} · "${msg.subject.slice(0, 60)}"${attachmentsForAgent.length > 0 ? ` 📎×${attachmentsForAgent.length}` : ""}`,
      body: `${decision.escalationReason ?? "這封我不確定怎麼處理,先給你看。"}\n\n客人想問:${decision.intent}${reqLine}${attachmentLine}${draftBlock}`,
      context: JSON.stringify({
        classification: decision.classification,
        tripType: decision.tripType,
        extractedRequirements: decision.extractedRequirements,
        urgency: decision.urgency,
        sentiment: decision.sentiment,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        gmailMessageId: msg.id,
        gmailThreadId: msg.threadId,
        // 批9 m1 — structured fields so the workspace escalation card can
        // offer 編輯並回覆 (Jeff-gated send via sendReplyInThread). The
        // human-readable copy in `body` above stays unchanged.
        customerEmail: senderEmail ?? null,
        subject: msg.subject,
        // `|| null`(不是 ??):語言 gate 丟稿後是空字串,存 null 讓
        // workspace 卡不會拿一個空草稿去開「編輯並回覆」。
        draftReply: decision.draftReply || null,
        // 語言 gate 丟稿理由(有才帶)— 卡片/除錯都看得到為什麼沒草稿。
        draftDroppedReason: decision.draftDropped?.reason ?? null,
        attachments: attachmentsForAgent.map((a) => ({
          filename: a.filename,
          kind: a.kind,
          sizeBytes: a.sizeBytes,
          parseStatus: a.parseStatus,
        })),
        // 2026-06-13 tour-reference-resolve m3 — resolved tour candidates so
        // the escalation card can show a chip + jump to /tour/:id. draft-state
        // tours are included here (Jeff-only view); the customer-facing draft
        // never promises them. Capped list already (resolveFromEmail ≤8).
        resolvedTours: tourCandidates.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
        })),
        unknownTourCodes,
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
        // gate.reason is machine-readable; translate the common ones
        const reasonZh: Record<string, string> = {
          "hard-excluded-class": "此類別永不自動(碰錢/法律)",
          "below-confidence": `信心 ${decision.confidence} 未達門檻`,
          "has-attachments": "帶附件,人看",
          "daily-cap": "今日自動回上限已滿",
          "post-llm-blacklist": "草稿含敏感內容,強制人工",
          escalated: "已升級給你",
        };
        const zh = reasonZh[gate.reason];
        if (zh) draftReason = ` · (${zh})`;
      }
      const outcomeLabel =
        sendOutcome === "auto_replied"
          ? "✓ 已自動回覆"
          : sendOutcome === "would_auto_send"
          ? "🟦 影子:這封我本來會自動回(未寄,收證據中)"
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
          // email-auto-reply m2 — structured fields so the 今日待辦 自動回
          // 留底卡 can render content + reuse the gated 跟進更正 dialog
          customerEmail: senderEmail ?? null,
          subject: msg.subject,
          draftReply: decision.draftReply?.slice(0, 2000) ?? null,
          gmailMessageId: msg.id,
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

  // gmail-full-thread-filing [5] — file the WHOLE thread, not just this email:
  // Jeff's plain-text replies (which the has:attachment sent gate misses) and
  // any earlier messages that predate this poll. claim-or-insert keeps it
  // idempotent — the inbound row inserted above already carries its Message-ID,
  // so the sync recognises it instead of duplicating. The per-cycle Set above
  // dedups when several emails in one poll share a thread. Best-effort: a sync
  // failure must never break mail processing (the email is already handled).
  if (profileId && msg.threadId && !sendCtx.syncedThreads.has(msg.threadId)) {
    sendCtx.syncedThreads.add(msg.threadId);
    try {
      const [{ listThreadMessagesForFiling }, { syncThreadToInteractions }] =
        await Promise.all([
          import("../../_core/gmail"),
          import("../../_core/threadFiling"),
        ]);
      const filingMsgs = await listThreadMessagesForFiling(
        sendCtx.gmail,
        msg.threadId,
        sendCtx.fromEmail,
      );
      const synced = await syncThreadToInteractions(db, profileId, filingMsgs);
      log.info(
        { profileId, threadId: msg.threadId, ...synced },
        "[gmailPipeline] thread sync done",
      );
    } catch (e) {
      log.warn(
        { err: e, profileId, threadId: msg.threadId },
        "[gmailPipeline] thread sync failed (non-fatal)",
      );
    }
  }

  // customer-cockpit Step 3 — this email changed the conversation, so the card
  // summary may be stale: refresh it now (debounced) instead of waiting for the
  // nightly cron. Fire-forget; never breaks mail processing.
  if (profileId) {
    try {
      const { enqueueCustomerSummaryRefresh } = await import("../../queue");
      await enqueueCustomerSummaryRefresh(profileId);
    } catch (e) {
      log.warn(
        { err: e, profileId },
        "[gmailPipeline] summary refresh enqueue failed (non-fatal)",
      );
    }
  }

  // Extract/update customer preferences from the conversation (fire-forget).
  if (profileId) {
    import("../../_core/customerPreferenceExtractor")
      .then(({ extractAfterReply }) => extractAfterReply(profileId!))
      .catch((e) =>
        log.warn({ err: e, profileId }, "[gmailPipeline] preference extraction failed (non-fatal)"),
      );
  }
}

/**
 * email-receipt-intake — turn one receipt email into a `pendingExpenses` row.
 * AI ONLY receives + reads + queues. Jeff confirms each row later. Idempotent:
 * the gmailMessageId dedup guard means a re-poll never creates a second card.
 * Returns true when a new row was created, false when deduped.
 */
async function processReceiptEmail(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  msg: GmailMessageSummary,
  ctx: { gmail: ReturnType<typeof buildGmailClient>; integrationId: number },
): Promise<boolean> {
  // Dedup — re-polling the same email must never create a second card.
  const existing = await getPendingExpenseByGmailMessageId(msg.id);
  if (existing) {
    log.info({ messageId: msg.id }, "[gmailPipeline] receipt already queued — skip");
    return false;
  }

  // The poll summary kept only parsed TEXT; vision + R2 need the raw bytes.
  let rawAttachments: Awaited<ReturnType<typeof fetchRawAttachments>> = [];
  try {
    rawAttachments = await fetchRawAttachments(ctx.gmail, msg.id);
  } catch (err) {
    log.warn({ err, messageId: msg.id }, "[gmailPipeline] raw attachment fetch failed (non-fatal)");
  }

  // Store the primary receipt attachment in R2 (KEY only — viewed via a
  // short-TTL signed URL; receipts can carry PII like card last-4).
  let attachmentKey: string | undefined;
  let attachmentFilename: string | undefined;
  let attachmentMimeType: string | undefined;
  const picked = pickReceiptAttachment(rawAttachments);
  if (picked) {
    try {
      const safeName = (picked.filename.replace(/[^\w.\-]+/g, "_").slice(-80)) || "receipt";
      const rand = Math.random().toString(36).slice(2, 8);
      const key = `receipts/${ctx.integrationId}/${Date.now()}-${rand}-${safeName}`;
      const put = await storagePut(key, picked.bytes, picked.mimeType || "application/octet-stream");
      attachmentKey = put.key;
      attachmentFilename = picked.filename.slice(0, 512);
      attachmentMimeType = (picked.mimeType || "application/octet-stream").slice(0, 128);
    } catch (err) {
      log.warn({ err, messageId: msg.id }, "[gmailPipeline] receipt R2 upload failed (non-fatal)");
    }
  }

  // Read vendor / amount / currency / date with vision. Never throws — on a
  // failure it returns needsReview=true so we still queue a 請人工看 card.
  const extraction = await extractReceipt({
    subject: msg.subject,
    from: msg.from,
    body: msg.body,
    attachments: rawAttachments,
  });

  await createPendingExpense({
    source: "gmail",
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    integrationId: ctx.integrationId,
    fromAddress: (parseEmailAddress(msg.from) ?? msg.from).slice(0, 320),
    emailSubject: msg.subject?.slice(0, 500),
    vendor: extraction.vendor ?? undefined,
    amount: extraction.amount != null ? String(extraction.amount) : undefined,
    currency: extraction.currency ?? undefined,
    receiptDate: extraction.receiptDate ? new Date(extraction.receiptDate) : undefined,
    description: extraction.description ?? undefined,
    extractionConfidence: extraction.confidence,
    needsReview: extraction.needsReview ? 1 : 0,
    extractionRaw: extraction.raw ? extraction.raw.slice(0, 5000) : undefined,
    attachmentKey,
    attachmentFilename,
    attachmentMimeType,
    status: "pending",
  });

  log.info(
    {
      messageId: msg.id,
      vendor: extraction.vendor,
      amount: extraction.amount,
      currency: extraction.currency,
      needsReview: extraction.needsReview,
    },
    "[gmailPipeline] receipt queued to pendingExpenses",
  );
  return true;
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

/**
 * Display name from a From header (2026-07-02) —
 * "Leslie Green <leslie@x.com>" → "Leslie Green". Returns undefined when the
 * header carries no usable name: bare-address form, empty/quotes-only name,
 * or a "name" that is just the address again (equals/contains the email, or
 * is itself email-shaped) — a profile name must never be a duplicated email.
 * Pure; unit-tested in gmailPipeline.sender.test.ts.
 */
export function parseSenderName(fromHeader: string): string | undefined {
  const angle = fromHeader.indexOf("<");
  if (angle < 0) return undefined; // bare "lisa@example.com" — no display name
  let name = fromHeader.slice(0, angle).trim();
  // Strip RFC 5322 quoted display names: "Green, Leslie" → Green, Leslie
  if (
    name.length >= 2 &&
    ((name.startsWith('"') && name.endsWith('"')) ||
      (name.startsWith("'") && name.endsWith("'")))
  ) {
    name = name.slice(1, -1).trim();
  }
  if (!name) return undefined;
  const email = parseEmailAddress(fromHeader);
  if (email && name.toLowerCase().includes(email)) return undefined;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) return undefined;
  return name;
}

/**
 * ER_DUP_ENTRY 回復鍵 (2026-07-02, G3 review P2) — inbound interaction 的
 * dup-key 回復以前 gate 在 `e.code === "ER_DUP_ENTRY" && profileId`,但自家
 * 信箱/寄件人解析不到那條路徑 profileId 是 undefined,row 是 filed 到
 * customerProfileId 0 的。第一輪 filed 了 row 但在 PACKGO_AI_PROCESSED
 * label 前掛掉的信,之後每輪 poll 重跑整條 LLM、撞 dup、rethrow — 永久
 * 卡死+每輪燒 LLM。回復查詢的 key 必須跟 INSERT 寫的一模一樣
 * (profileId ?? 0),所以這裡回傳「該用哪個 profile id 去撈既有 row」,
 * 非 dup 錯誤回 null(caller rethrow)。Pure; unit-tested in
 * gmailPipeline.sender.test.ts.
 */
export function dupRecoveryLookupId(
  e: unknown,
  profileId: number | undefined,
): number | null {
  if ((e as { code?: unknown } | null | undefined)?.code !== "ER_DUP_ENTRY") {
    return null;
  }
  return profileId ?? 0;
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
