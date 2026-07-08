/**
 * customerBackfill — targeted, Jeff-triggered "go collect this customer's whole
 * Gmail conversation" (gmail-full-thread-filing, on-demand slice).
 *
 * Why this exists: the poll hook only files a thread when an UNREAD inbound lands
 * in the poll window. Active customers whose mail Jeff reads before the poll
 * (e.g. Emerald / eyoung@axt.com) are therefore never captured. This module lets
 * Jeff name a customer in the ops chat and pull their entire history on demand —
 * a scoped version of the (deferred) mass backfill, one named person at a time,
 * so it never touches the 17k noise inbox and never burns LLM.
 *
 * Two entry points, both pure搬運 (no LLM):
 *   - previewCustomerThreads: READ-only. Counts that email's threads in a mailbox
 *     and returns a short, scrubbed sample so Jeff can confirm WHICH email before
 *     anything is written. Never writes.
 *   - backfillCustomerByEmail: the WRITE path. Reuses listThreadMessagesForFiling
 *     + syncThreadToInteractions (claim-or-insert, idempotent, scrubPii) per
 *     thread. Caller resolves the profileId first (ensure-create for Emerald-type
 *     customers who have no profile yet).
 *
 * Gmail is passed in (built by the caller per gmailIntegration row) so this stays
 * unit-testable with an injected client. Cross-account dedup is automatic: the
 * same email seen in two mailboxes carries the same RFC822 Message-ID, which
 * syncThreadToInteractions collapses via UNIQUE(customerProfileId, externalId).
 */

import type { getDb } from "../db";
import { listThreadMessagesForFiling, type buildGmailClient } from "./gmail";
import { syncThreadToInteractions } from "./threadFiling";
import { scrubPii } from "./piiScrub";
import { createChildLogger } from "./logger";
import { reportFunnelError } from "./errorFunnel";

const log = createChildLogger({ module: "customerBackfill" });

/** Per-mailbox thread cap. Real PACK&GO customers are well under this; a giant
 * history would risk the request timeout (this runs inside a tRPC mutation), so
 * we bound it and note the cap rather than paginate (v1). */
const DEFAULT_MAX_THREADS = 50;
/** Chars of each sampled message shown to Jeff for the confirm step. */
const SAMPLE_SNIPPET_CHARS = 160;
/** Messages sampled from the most recent thread for the preview. */
const SAMPLE_MESSAGES = 2;

type Gmail = ReturnType<typeof buildGmailClient>;

export interface BackfillResult {
  threadsSeen: number;
  inserted: number;
  claimed: number;
  /** Legacy rows whose filing-time date was corrected to the real Gmail time. */
  restamped: number;
  skipped: number;
  trashSkipped: number;
  threadIds: string[];
}

export interface ThreadPreview {
  threadsSeen: number;
  threadIds: string[];
  sample: Array<{ date: Date; direction: "inbound" | "outbound"; snippet: string }>;
}

/** Gmail search that finds every thread the target email is on (either side),
 * excluding Trash + Spam. */
export function buildThreadQuery(targetEmail: string): string {
  const e = targetEmail.trim();
  return `(from:${e} OR to:${e}) -in:trash -in:spam`;
}

/** List thread ids (newest first) involving `targetEmail`, capped. */
export async function searchThreadIds(
  gmail: Gmail,
  targetEmail: string,
  maxThreads = DEFAULT_MAX_THREADS,
): Promise<string[]> {
  const resp = await gmail.users.threads.list({
    userId: "me",
    q: buildThreadQuery(targetEmail),
    maxResults: maxThreads,
  });
  const threads = (resp.data.threads ?? []) as Array<{ id?: string | null }>;
  return threads.map((t) => t.id).filter((x): x is string => !!x);
}

/**
 * READ-only confirm step: how many threads this email has in `gmail`, plus a
 * short scrubbed sample from the most recent thread. Never writes. The sample is
 * scrubPii'd so no live card number is ever surfaced (it flows into the ops chat
 * which persists to agentMessages).
 */
export async function previewCustomerThreads(
  gmail: Gmail,
  selfEmail: string,
  targetEmail: string,
  opts?: { maxThreads?: number },
): Promise<ThreadPreview> {
  const maxThreads = opts?.maxThreads ?? DEFAULT_MAX_THREADS;
  const threadIds = await searchThreadIds(gmail, targetEmail, maxThreads);
  const sample: ThreadPreview["sample"] = [];
  if (threadIds.length > 0) {
    const msgs = await listThreadMessagesForFiling(gmail, threadIds[0], selfEmail);
    const recent = msgs.filter((m) => !m.inTrash).slice(-SAMPLE_MESSAGES);
    for (const m of recent) {
      sample.push({
        date: m.date,
        direction: m.direction,
        snippet: scrubPii(m.body).replace(/\s+/g, " ").trim().slice(0, SAMPLE_SNIPPET_CHARS),
      });
    }
  }
  return { threadsSeen: threadIds.length, threadIds, sample };
}

/**
 * WRITE path: file every thread involving `targetEmail` into `profileId` via the
 * shared claim-or-insert sync. Idempotent across re-runs and across mailboxes.
 * Caller must have resolved profileId (ensure-create) before calling.
 */
export async function backfillCustomerByEmail(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  gmail: Gmail,
  selfEmail: string,
  profileId: number,
  targetEmail: string,
  opts?: { maxThreads?: number },
): Promise<BackfillResult> {
  const maxThreads = opts?.maxThreads ?? DEFAULT_MAX_THREADS;
  const threadIds = await searchThreadIds(gmail, targetEmail, maxThreads);
  const result: BackfillResult = {
    threadsSeen: threadIds.length,
    inserted: 0,
    claimed: 0,
    restamped: 0,
    skipped: 0,
    trashSkipped: 0,
    threadIds,
  };
  for (const threadId of threadIds) {
    try {
      const msgs = await listThreadMessagesForFiling(gmail, threadId, selfEmail);
      const r = await syncThreadToInteractions(db, profileId, msgs);
      result.inserted += r.inserted;
      result.claimed += r.claimed;
      result.restamped += r.restamped;
      result.skipped += r.skipped;
      result.trashSkipped += r.trashSkipped;
    } catch (e) {
      // One bad thread must not abort the rest of the backfill.
      log.warn({ err: e, threadId, profileId }, "[customerBackfill] one thread failed (non-fatal)");
      reportFunnelError({
        source: "fail-open:customerBackfill:threadSync",
        err: e,
        context: { threadId, profileId },
      }).catch(() => {});
    }
  }
  log.info({ profileId, targetEmail, ...result, threadIds: undefined }, "[customerBackfill] done");
  return result;
}
