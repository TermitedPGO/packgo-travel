/**
 * gmail-intake-ledger (2026-07-13) — the ADAPTERS: real drizzle / ioredis /
 * gmail-client implementations of the ports the pure engines (gmailHistorySync +
 * gmailReconcile) depend on, plus the two orchestration entry points the workers
 * call (runIntakeForIntegration, runReconcileForIntegration). No engine logic
 * lives here — only I/O wiring — so the engines stay unit-testable with fakes.
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { redis } from "../redis";
import { getDb } from "../db";
import { gmailIngestionLedger, gmailIntegration, agentMessages } from "../../drizzle/schema";
import {
  buildGmailClient,
  ensureLabel,
  listMessagesByIds,
  listHistoryMessageIds,
  fetchMessagesMetadata,
  listMessageMetadataForQuery,
  getMailboxHistoryId as gmailGetMailboxHistoryId,
} from "../_core/gmail";
import {
  runDownstreamForLedgerMessage,
  PROCESSED_LABEL,
} from "../agents/autonomous/gmailPipeline";
import { createChildLogger } from "../_core/logger";
import {
  syncHistoryForIntegration,
  feedPendingDownstream,
  type GmailIntakePort,
  type LockPort,
  type LedgerStore,
  type AlertPort,
  type DownstreamPort,
  type HistorySyncDeps,
  type IntegrationCursor,
  type LedgerCandidate,
  type LedgerRow,
  type LedgerStatus,
  type FailureKind,
} from "./gmailHistorySync";
import {
  reconcileIntegration,
  type ReconcileDeps,
  type IncidentTracker,
} from "./gmailReconcile";

const log = createChildLogger({ module: "gmailIntakeAdapters" });

// ── mapping ──────────────────────────────────────────────────────────────────

type GmailIntegrationRow = typeof gmailIntegration.$inferSelect;

function toCursor(row: GmailIntegrationRow): IntegrationCursor {
  return {
    id: row.id,
    emailAddress: row.emailAddress,
    intakeMode: row.intakeMode,
    lastHistoryId: row.lastHistoryId ?? null,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt ?? null,
    watchExpiration: row.watchExpiration ?? null,
  };
}

// ── Gmail port ───────────────────────────────────────────────────────────────

export function createGmailIntakePort(
  gmail: ReturnType<typeof buildGmailClient>,
): GmailIntakePort {
  return {
    async collectHistoryAdded(startHistoryId) {
      // maxMessages high so ALL pages are walked for PACK&GO scale (順序鐵律 —
      // never stop mid-pagination and advance the cursor past uncollected ids).
      return listHistoryMessageIds(gmail, startHistoryId, {
        labelId: "INBOX",
        maxMessages: 5000,
      });
    },
    fetchMetadata(ids) {
      return fetchMessagesMetadata(gmail, ids);
    },
    scanQueryMetadata(query) {
      return listMessageMetadataForQuery(gmail, query);
    },
    getMailboxHistoryId() {
      return gmailGetMailboxHistoryId(gmail);
    },
  };
}

// ── Redis fencing lock port ──────────────────────────────────────────────────

const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export function createRedisLockPort(): LockPort {
  return {
    async acquire(key, token, ttlSeconds) {
      const ok = await redis.set(key, token, "EX", ttlSeconds, "NX");
      return ok === "OK";
    },
    async verify(key, token) {
      const v = await redis.get(key);
      return v === token;
    },
    async release(key, token) {
      try {
        await redis.eval(RELEASE_LUA, 1, key, token);
      } catch (e) {
        log.warn({ err: e, key }, "[gmailIntake] lock release failed (ttl will expire it)");
      }
    },
  };
}

// ── Ledger store (drizzle) ───────────────────────────────────────────────────

const LEDGER_MAX_RETRIES = 3;

export function createDrizzleLedgerStore(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): LedgerStore {
  return {
    async getIntegration(integrationId) {
      const [row] = await db
        .select()
        .from(gmailIntegration)
        .where(eq(gmailIntegration.id, integrationId))
        .limit(1);
      return row ? toCursor(row) : null;
    },

    async insertIgnore(rows) {
      if (rows.length === 0) return 0;
      // INSERT IGNORE via onDuplicateKeyUpdate no-op (set a non-key col to itself)
      // so a re-diff / duplicate push / crash-replay collapses to one row.
      await db
        .insert(gmailIngestionLedger)
        .values(
          rows.map((r) => ({
            integrationId: r.integrationId,
            gmailMessageId: r.gmailMessageId,
            gmailThreadId: r.gmailThreadId,
            gmailHistoryId: r.gmailHistoryId,
            internalDateMs: r.internalDateMs,
            fromAddress: r.fromAddress,
            source: r.source,
            status: "pending" as const,
          })),
        )
        .onDuplicateKeyUpdate({ set: { integrationId: sql`integrationId` } });
      return rows.length;
    },

    async advanceCursorCAS(integrationId, expectedHistoryId, newHistoryId, syncedAt) {
      const res = await db
        .update(gmailIntegration)
        .set({ lastHistoryId: newHistoryId, lastSuccessfulSyncAt: syncedAt })
        .where(
          and(
            eq(gmailIntegration.id, integrationId),
            expectedHistoryId === null
              ? isNull(gmailIntegration.lastHistoryId)
              : eq(gmailIntegration.lastHistoryId, expectedHistoryId),
          ),
        );
      return ((res as any)[0]?.affectedRows ?? 0) > 0;
    },

    async rebaselineCursor(integrationId, newHistoryId, syncedAt) {
      await db
        .update(gmailIntegration)
        .set({ lastHistoryId: newHistoryId, lastSuccessfulSyncAt: syncedAt })
        .where(eq(gmailIntegration.id, integrationId));
    },

    async listActionable(integrationId, nowMs) {
      const now = new Date(nowMs);
      const rows = await db
        .select()
        .from(gmailIngestionLedger)
        .where(
          and(
            eq(gmailIngestionLedger.integrationId, integrationId),
            or(
              eq(gmailIngestionLedger.status, "pending"),
              and(
                eq(gmailIngestionLedger.status, "failed"),
                lte(gmailIngestionLedger.retryCount, LEDGER_MAX_RETRIES - 1),
                sql`${gmailIngestionLedger.nextRetryAt} IS NOT NULL`,
                lte(gmailIngestionLedger.nextRetryAt, now),
              ),
            ),
          ),
        )
        .orderBy(asc(gmailIngestionLedger.firstSeenAt))
        .limit(100);
      return rows.map(mapLedgerRow);
    },

    async markProcessed(ledgerId, interactionId, at) {
      await db
        .update(gmailIngestionLedger)
        .set({
          status: "processed",
          interactionId: interactionId ?? null,
          processedAt: at,
          lastAttemptAt: at,
          nextRetryAt: null,
        })
        .where(eq(gmailIngestionLedger.id, ledgerId));
    },

    async markIgnored(ledgerId, failureKind, at) {
      await db
        .update(gmailIngestionLedger)
        .set({ status: "ignored", failureKind, processedAt: at, lastAttemptAt: at, nextRetryAt: null })
        .where(eq(gmailIngestionLedger.id, ledgerId));
    },

    async markFailed(ledgerId, cls, retryCount, nextRetryAt, at) {
      await db
        .update(gmailIngestionLedger)
        .set({
          status: "failed",
          failureKind: cls.failureKind,
          httpStatus: cls.httpStatus,
          errorDetail: cls.errorDetail,
          retryCount,
          nextRetryAt,
          lastAttemptAt: at,
        })
        .where(eq(gmailIngestionLedger.id, ledgerId));
    },

    async existingMessageIds(integrationId, gmailMessageIds) {
      if (gmailMessageIds.length === 0) return new Set<string>();
      const rows = await db
        .select({ gmailMessageId: gmailIngestionLedger.gmailMessageId })
        .from(gmailIngestionLedger)
        .where(
          and(
            eq(gmailIngestionLedger.integrationId, integrationId),
            inArray(gmailIngestionLedger.gmailMessageId, gmailMessageIds),
          ),
        );
      return new Set(rows.map((r) => r.gmailMessageId));
    },

    async oldestStuck(integrationId, statuses, olderThanMs, nowMs) {
      const cutoff = new Date(nowMs - olderThanMs);
      const [row] = await db
        .select({
          gmailMessageId: gmailIngestionLedger.gmailMessageId,
          failureKind: gmailIngestionLedger.failureKind,
          firstSeenAt: gmailIngestionLedger.firstSeenAt,
        })
        .from(gmailIngestionLedger)
        .where(
          and(
            eq(gmailIngestionLedger.integrationId, integrationId),
            inArray(gmailIngestionLedger.status, statuses),
            lte(gmailIngestionLedger.firstSeenAt, cutoff),
          ),
        )
        .orderBy(asc(gmailIngestionLedger.firstSeenAt))
        .limit(1);
      if (!row) return null;
      return {
        gmailMessageId: row.gmailMessageId,
        failureKind: (row.failureKind as FailureKind | null) ?? null,
        ageMs: nowMs - new Date(row.firstSeenAt).getTime(),
      };
    },
  };
}

type LedgerSelectRow = typeof gmailIngestionLedger.$inferSelect;
function mapLedgerRow(r: LedgerSelectRow): LedgerRow {
  return {
    id: r.id,
    integrationId: r.integrationId,
    gmailMessageId: r.gmailMessageId,
    gmailThreadId: r.gmailThreadId,
    gmailHistoryId: r.gmailHistoryId ?? null,
    internalDateMs: r.internalDateMs,
    fromAddress: r.fromAddress,
    source: r.source,
    status: r.status as LedgerStatus,
    failureKind: (r.failureKind as FailureKind | null) ?? null,
    httpStatus: r.httpStatus ?? null,
    retryCount: r.retryCount,
    nextRetryAt: r.nextRetryAt ?? null,
    interactionId: r.interactionId ?? null,
  };
}

// ── Alert port (agentMessages + Redis dedup) ─────────────────────────────────

export function createAlertPort(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): AlertPort {
  return {
    async postCard(card) {
      await db.insert(agentMessages).values({
        agentName: card.agentName,
        senderRole: "agent",
        messageType: "alert",
        title: card.title.slice(0, 200),
        body: card.body,
        priority: card.priority,
      });
    },
    async alreadyAlerted(fingerprint, windowSeconds) {
      // SET NX EX: fresh key → we should alert (return false); existing → skip.
      const ok = await redis
        .set(`gmail-intake-alert:${fingerprint}`, "1", "EX", windowSeconds, "NX")
        .catch(() => "OK"); // redis blip → don't spam: treat as already-alerted
      return ok !== "OK";
    },
  };
}

// ── Incident tracker (Redis, for reconcile lifecycle) ────────────────────────

const INCIDENT_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createIncidentTracker(): IncidentTracker {
  return {
    async onActive(fingerprint, nowMs, reAlertWindowMs) {
      const key = `gmail-intake-incident:${fingerprint}`;
      const raw = await redis.get(key).catch(() => null);
      if (!raw) {
        await redis
          .set(key, JSON.stringify({ firstSeenMs: nowMs, lastAlertMs: nowMs }), "EX", INCIDENT_TTL_SECONDS)
          .catch(() => null);
        return { firstSeenMs: nowMs, shouldAlert: true };
      }
      let parsed: { firstSeenMs: number; lastAlertMs: number };
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { firstSeenMs: nowMs, lastAlertMs: 0 };
      }
      const shouldAlert = nowMs - parsed.lastAlertMs >= reAlertWindowMs;
      if (shouldAlert) {
        await redis
          .set(
            key,
            JSON.stringify({ firstSeenMs: parsed.firstSeenMs, lastAlertMs: nowMs }),
            "EX",
            INCIDENT_TTL_SECONDS,
          )
          .catch(() => null);
      }
      return { firstSeenMs: parsed.firstSeenMs, shouldAlert };
    },
    async onRecovered(fingerprint, _nowMs) {
      const key = `gmail-intake-incident:${fingerprint}`;
      const raw = await redis.get(key).catch(() => null);
      if (!raw) return null;
      await redis.del(key).catch(() => null);
      try {
        const parsed = JSON.parse(raw) as { firstSeenMs: number };
        return { firstSeenMs: parsed.firstSeenMs };
      } catch {
        return { firstSeenMs: 0 };
      }
    },
  };
}

// ── Downstream port (history mode → real processOneEmail chain) ──────────────

export function createDownstreamPort(cursor: IntegrationCursor): DownstreamPort {
  return {
    async process(row: LedgerRow) {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      const [integration] = await db
        .select()
        .from(gmailIntegration)
        .where(eq(gmailIntegration.id, cursor.id))
        .limit(1);
      if (!integration) throw new Error("integration not found");
      const gmail = buildGmailClient(integration);
      const labelId = await ensureLabel(gmail, PROCESSED_LABEL);
      const [msg] = await listMessagesByIds(gmail, [row.gmailMessageId]);
      if (!msg) {
        // The message vanished (deleted/moved) between discovery and processing.
        const err = new Error(`gmail message ${row.gmailMessageId} not found on hydrate`);
        (err as any).code = 404;
        throw err;
      }
      const out = await runDownstreamForLedgerMessage(db, msg, {
        gmail,
        labelId,
        fromEmail: integration.emailAddress,
        integrationId: integration.id,
      });
      return { interactionId: out.interactionId };
    },
  };
}

// ── orchestration entry points (called by the workers) ───────────────────────

export interface IntakeRunResult {
  ran: boolean;
  mode: IntegrationCursor["intakeMode"];
  sync?: Awaited<ReturnType<typeof syncHistoryForIntegration>>;
  feed?: Awaited<ReturnType<typeof feedPendingDownstream>>;
}

/**
 * Run the History ledger engine for ONE integration. Returns ran=false for
 * legacy integrations (the caller keeps running the legacy poll/push, unchanged).
 * shadow → sync only (ledger, no downstream, no label). history → sync + feed.
 */
export async function runIntakeForIntegration(integrationId: number): Promise<IntakeRunResult> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const store = createDrizzleLedgerStore(db);
  const cursor = await store.getIntegration(integrationId);
  if (!cursor) throw new Error("integration not found");
  if (cursor.intakeMode === "legacy") return { ran: false, mode: "legacy" };

  const [integration] = await db
    .select()
    .from(gmailIntegration)
    .where(eq(gmailIntegration.id, integrationId))
    .limit(1);
  const gmail = buildGmailClient(integration!);

  const deps: HistorySyncDeps = {
    gmail: createGmailIntakePort(gmail),
    store,
    lock: createRedisLockPort(),
    alerts: createAlertPort(db),
    downstream: cursor.intakeMode === "history" ? createDownstreamPort(cursor) : undefined,
  };

  const sync = await syncHistoryForIntegration(deps, integrationId);
  const result: IntakeRunResult = { ran: true, mode: cursor.intakeMode, sync };
  if (cursor.intakeMode === "history") {
    result.feed = await feedPendingDownstream(deps, integrationId);
  }
  return result;
}

/** Run the 5-minute reconciliation for ONE (non-legacy) integration. */
export async function runReconcileForIntegration(integrationId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const store = createDrizzleLedgerStore(db);
  const cursor = await store.getIntegration(integrationId);
  if (!cursor || cursor.intakeMode === "legacy") return false;

  const [integration] = await db
    .select()
    .from(gmailIntegration)
    .where(eq(gmailIntegration.id, integrationId))
    .limit(1);
  const gmail = buildGmailClient(integration!);

  const deps: ReconcileDeps = {
    gmail: createGmailIntakePort(gmail),
    store,
    alerts: createAlertPort(db),
    incidents: createIncidentTracker(),
    topicConfigured: !!process.env.GMAIL_PUBSUB_TOPIC,
  };
  await reconcileIntegration(deps, cursor);
  return true;
}

/**
 * requirement 8 — when GMAIL_PUBSUB_TOPIC is unset the watch-renew cron used to
 * silently `return`. Post a deduped topic-unset alert for each non-legacy
 * integration instead. Same fingerprint the reconcile pass uses → one card only.
 */
export async function alertTopicUnsetForNonLegacy(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const alerts = createAlertPort(db);
  const incidents = createIncidentTracker();
  const rows = await db.select().from(gmailIntegration).where(eq(gmailIntegration.isActive, 1));
  let posted = 0;
  const nowMs = Date.now();
  for (const row of rows) {
    if (row.intakeMode === "legacy") continue;
    const fp = `gmail-reconcile:${row.id}:watch:topic_unset`;
    const { shouldAlert } = await incidents.onActive(fp, nowMs, 60 * 60 * 1000);
    if (!shouldAlert) continue;
    await alerts.postCard({
      agentName: "gmail-intake",
      priority: "high",
      title: "Gmail push watch 異常(topic_unset)",
      body:
        "GMAIL_PUBSUB_TOPIC 未設定 —— push 通道從未啟用,只靠 poll/reconcile 兜底。\n" +
        `integrationId:${row.id}`,
    });
    posted++;
  }
  return posted;
}
