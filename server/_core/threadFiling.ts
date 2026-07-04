/**
 * threadFiling — reconcile a whole Gmail thread into `customerInteractions`
 * (gmail-full-thread-filing [4]).
 *
 * One shared sync path used by the poll hook (and, next batch, the backfill
 * worker). For a given customer profile + the thread's messages it does
 * **claim-or-insert** so the result is idempotent and never duplicates the
 * existing ~453 legacy rows:
 *
 *   - already filed (externalId == this message's Message-ID) → skip
 *   - in Trash → skip (we never file deleted mail)
 *   - a legacy row (externalId IS NULL) with the SAME direction, a createdAt
 *     within ±1 day, and a matching body prefix → **claim** it: fill in the NULL
 *     key columns (externalId, gmailThreadId) and correct createdAt to the real
 *     Gmail time. NEVER touches `content`.
 *   - otherwise → **insert** a new row.
 *
 * Conservative by design: when there's no confident legacy match we INSERT
 * (寧可短暫多一列也不錯改 — plan §九). Pure搬運: no LLM, no classification; every
 * inserted body passes `scrubPii` so a live card number never lands at rest.
 *
 * The reconcile decision lives in the PURE `planThreadFiling` (exhaustively unit
 * tested); `syncThreadToInteractions` is the thin DB executor (Gmail fetch kept
 * in gmail.ts so this module stays pure-testable; the DB path is verified live
 * on deploy, per the repo's Gmail-pipeline norm).
 */

import { and, eq, isNull, isNotNull, asc } from "drizzle-orm";
import type { getDb } from "../db";
import { customerInteractions } from "../../drizzle/schema";
import { scrubPii } from "./piiScrub";
import { createChildLogger } from "./logger";
import { touchLastInbound } from "./customerUnread";
import { decideInteractionOrderAssignment } from "./interactionOrderAssignment";
import type { FilingMessage } from "./gmail";

const log = createChildLogger({ module: "threadFiling" });

/**
 * ±1 day window for matching a legacy (externalId IS NULL) row to a Gmail
 * message. Wide on purpose: legacy createdAt was frequently the FILING time
 * rather than the real send time — exactly the bug this feature corrects — so a
 * tight window would fail to recognise rows we must claim.
 */
const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * An already-filed row (externalId matches) is normally skipped. But legacy
 * outbound rows written by the pre-[6] sentMailFiling carry createdAt=now() (the
 * day filing ran) AND already have externalId set — so the plain skip locks in a
 * wrong date forever (Jenny's 6/10 + 6/15 replies all displayed 6/22, the day
 * sent-mail filing first ran). When a filed row's stored date is this far from
 * the real Gmail date, re-stamp createdAt to the truth. Far below the 7–12-day
 * real bug, far above the ~0 delta of a correctly-filed row (both threadFiling
 * and gmailPipeline store the exact Gmail time), so a good row never churns.
 */
const RESTAMP_STALE_MS = 2 * 60 * 60 * 1000;
/** How many chars of body we compare to decide a legacy row IS this message. */
const PREFIX_LEN = 64;
/** Body length cap on inserted rows (mirrors listThreadMessagesForFiling). */
const BODY_CAP = 20000;

/** Minimal existing-row shape the reconciler reads. */
export interface ExistingInteractionRow {
  id: number;
  externalId: string | null;
  direction: "inbound" | "outbound";
  content: string;
  createdAt: Date;
}

export type FilingAction =
  | { kind: "skip"; reason: "already_filed" | "in_trash"; messageId: string }
  | {
      kind: "claim";
      rowId: number;
      messageId: string;
      gmailThreadId: string;
      createdAt: Date;
    }
  // Already filed (externalId matches) but the stored date is the filing time,
  // not the real send time — correct just createdAt. See RESTAMP_STALE_MS.
  | { kind: "restamp"; rowId: number; messageId: string; createdAt: Date }
  | { kind: "insert"; message: FilingMessage };

export interface SyncThreadResult {
  inserted: number;
  claimed: number;
  restamped: number;
  skipped: number;
  trashSkipped: number;
}

/**
 * Normalize text for prefix comparison. The inbound filer prepends a
 * `From: …\nSubject: …\n\n` header block to its stored content (outbound rows
 * have none); strip it so a legacy inbound row lines up with the raw Gmail body.
 * Then collapse whitespace, lowercase, and take the first PREFIX_LEN chars.
 * Pure → unit-tested.
 */
export function bodyPrefix(text: string): string {
  let s = text ?? "";
  const header = s.match(/^From:.*\r?\nSubject:.*\r?\n\r?\n/);
  if (header) s = s.slice(header[0].length);
  return s.replace(/\s+/g, " ").trim().slice(0, PREFIX_LEN).toLowerCase();
}

/**
 * Pure claim-or-insert planner. Deterministic + idempotent: applying the
 * returned actions and re-planning yields all skips (so列數不變). A legacy row is
 * claimed at most once (closest-in-time wins among same-direction matches).
 */
export function planThreadFiling(
  messages: FilingMessage[],
  existing: ExistingInteractionRow[],
): FilingAction[] {
  // Message-IDs already on a row (legacy NULLs excluded) → "already filed". The
  // map keeps the row so we can compare its stored date against the real Gmail
  // time and re-stamp a stale one instead of skipping it forever.
  const filedRowByExternalId = new Map<string, ExistingInteractionRow>();
  for (const r of existing) if (r.externalId) filedRowByExternalId.set(r.externalId, r);
  const filedExternalIds = new Set(filedRowByExternalId.keys());
  // Legacy rows without a key yet — each claimable once.
  const claimable = existing.filter((r) => r.externalId == null);
  const consumedRowIds = new Set<number>();
  const actions: FilingAction[] = [];

  for (const m of messages) {
    if (m.inTrash) {
      actions.push({ kind: "skip", reason: "in_trash", messageId: m.messageId });
      continue;
    }
    if (filedExternalIds.has(m.messageId)) {
      // Already filed — but if the stored date drifted far from the real Gmail
      // time (the legacy filing-time bug), correct just createdAt. `filed` is
      // undefined for a Message-ID added during THIS loop (a duplicate within
      // one thread) → plain skip, never a restamp.
      const filed = filedRowByExternalId.get(m.messageId);
      if (
        filed &&
        Math.abs(filed.createdAt.getTime() - m.date.getTime()) > RESTAMP_STALE_MS
      ) {
        actions.push({
          kind: "restamp",
          rowId: filed.id,
          messageId: m.messageId,
          createdAt: m.date,
        });
      } else {
        actions.push({ kind: "skip", reason: "already_filed", messageId: m.messageId });
      }
      continue;
    }

    const msgPrefix = bodyPrefix(m.body);
    let best: ExistingInteractionRow | null = null;
    let bestDelta = Infinity;
    for (const r of claimable) {
      if (consumedRowIds.has(r.id)) continue;
      if (r.direction !== m.direction) continue;
      const delta = Math.abs(r.createdAt.getTime() - m.date.getTime());
      if (delta > CLAIM_WINDOW_MS) continue;
      if (bodyPrefix(r.content) !== msgPrefix) continue;
      if (delta < bestDelta) {
        best = r;
        bestDelta = delta;
      }
    }

    if (best) {
      consumedRowIds.add(best.id);
      filedExternalIds.add(m.messageId);
      actions.push({
        kind: "claim",
        rowId: best.id,
        messageId: m.messageId,
        gmailThreadId: m.threadId,
        createdAt: m.date,
      });
    } else {
      // Guard against the same Message-ID appearing twice within one thread.
      filedExternalIds.add(m.messageId);
      actions.push({ kind: "insert", message: m });
    }
  }
  return actions;
}

/**
 * Reconcile one Gmail thread into `customerInteractions` for `profileId`.
 * Idempotent (re-running files nothing new). Never mutates an existing row's
 * content. Caller fetches `messages` via `listThreadMessagesForFiling`.
 */
export async function syncThreadToInteractions(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  profileId: number,
  messages: FilingMessage[],
): Promise<SyncThreadResult> {
  const result: SyncThreadResult = {
    inserted: 0,
    claimed: 0,
    restamped: 0,
    skipped: 0,
    trashSkipped: 0,
  };
  if (!profileId || messages.length === 0) return result;

  const existing = (await db
    .select({
      id: customerInteractions.id,
      externalId: customerInteractions.externalId,
      direction: customerInteractions.direction,
      content: customerInteractions.content,
      createdAt: customerInteractions.createdAt,
    })
    .from(customerInteractions)
    .where(
      eq(customerInteractions.customerProfileId, profileId),
    )) as ExistingInteractionRow[];

  const actions = planThreadFiling(messages, existing);

  // customer-cockpit Phase6 B1 — rule ① ONLY (thread-inheritance, pure code,
  // no LLM): a thread already carrying a customOrderId on another row should
  // have that id stamped onto any row this reconcile newly inserts. This is a
  // lower-stakes backfill-adjacent path (historical sync), so it deliberately
  // does NOT do rule ②/③ (in-progress-order lookup / LLM pick) — those stay
  // exclusive to the live gmailPipeline.ts inbound path. One query, keyed by
  // gmailThreadId, built once before the loop (not per-message).
  const threadOrderRows = await db
    .select({
      gmailThreadId: customerInteractions.gmailThreadId,
      customOrderId: customerInteractions.customOrderId,
    })
    .from(customerInteractions)
    .where(
      and(
        eq(customerInteractions.customerProfileId, profileId),
        isNotNull(customerInteractions.gmailThreadId),
        isNotNull(customerInteractions.customOrderId),
      ),
    )
    .orderBy(asc(customerInteractions.id));
  // First-wins (not last-wins): if a thread's sibling rows carry conflicting
  // customOrderId values (e.g. Jeff manually re-assigned one row later), pick
  // the earliest-assigned order deterministically instead of letting row
  // iteration order silently decide. Matches gmailPipeline.ts's ORDER BY id ASC
  // + LIMIT 1 tiebreak and B4 interactionBackfill.ts's `if (!m.has(...))` guard.
  const threadOrderMap = new Map<string, number>();
  for (const r of threadOrderRows) {
    if (r.gmailThreadId && r.customOrderId != null && !threadOrderMap.has(r.gmailThreadId)) {
      threadOrderMap.set(r.gmailThreadId, r.customOrderId);
    }
  }

  // customer-unread (0108) — newest inbound message this sync actually FILED
  // (inserted). Touched once after the loop; touchLastInbound is monotonic, so
  // backfilling an old thread never regresses a fresher lastInboundAt.
  let newestInboundAt: Date | null = null;

  for (const a of actions) {
    if (a.kind === "skip") {
      if (a.reason === "in_trash") result.trashSkipped++;
      else result.skipped++;
      continue;
    }

    if (a.kind === "claim") {
      // `externalId IS NULL` guard so a concurrent claim (backfill vs poll) can't
      // double-write — the loser's UPDATE simply matches 0 rows. Only the NULL
      // key columns + createdAt are set; content is left exactly as-is.
      await db
        .update(customerInteractions)
        .set({
          externalId: a.messageId,
          gmailThreadId: a.gmailThreadId,
          createdAt: a.createdAt,
        })
        .where(
          and(
            eq(customerInteractions.id, a.rowId),
            isNull(customerInteractions.externalId),
          ),
        );
      result.claimed++;
      continue;
    }

    if (a.kind === "restamp") {
      // Touch ONLY createdAt — the row's key columns + content are already
      // correct; we just heal the filing-time date. Idempotent: after this the
      // delta is 0, so the next reconcile skips it.
      await db
        .update(customerInteractions)
        .set({ createdAt: a.createdAt })
        .where(eq(customerInteractions.id, a.rowId));
      result.restamped++;
      continue;
    }

    // insert — onDuplicateKeyUpdate guards the poll-vs-backfill race on the same
    // thread: a colliding (profileId, externalId) collapses into a no-op update
    // instead of throwing.
    const inheritedOrderId = decideInteractionOrderAssignment({
      priorThreadOrderId: threadOrderMap.get(a.message.threadId) ?? null,
      candidates: [],
    }).customOrderId;
    await db
      .insert(customerInteractions)
      .values({
        customerProfileId: profileId,
        channel: "email",
        direction: a.message.direction,
        content: scrubPii(a.message.body.slice(0, BODY_CAP)),
        generatedBy: "human",
        externalId: a.message.messageId,
        gmailThreadId: a.message.threadId,
        customOrderId: inheritedOrderId,
        createdAt: a.message.date,
      })
      .onDuplicateKeyUpdate({
        set: { gmailThreadId: a.message.threadId },
      });
    result.inserted++;
    if (
      a.message.direction === "inbound" &&
      (newestInboundAt == null || a.message.date > newestInboundAt)
    ) {
      newestInboundAt = a.message.date;
    }
  }

  // customer-unread (0108) — advance the profile's lastInboundAt pointer.
  // Best-effort (touchLastInbound never throws), monotonic (old mail can't
  // regress it), after the loop so one thread touches at most once.
  if (newestInboundAt) await touchLastInbound(db, profileId, newestInboundAt);

  log.info({ profileId, ...result }, "[threadFiling] thread reconciled");
  return result;
}
