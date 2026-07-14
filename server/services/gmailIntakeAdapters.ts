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
  fetchHistoryPage,
  scanQueryPage,
  listMessageMetadataForQuery,
  getMailboxHistoryId as gmailGetMailboxHistoryId,
} from "../_core/gmail";
import { detectReceipt } from "../_core/receiptExtractor";
import {
  runDownstreamForLedgerMessage,
  PROCESSED_LABEL,
} from "../agents/autonomous/gmailPipeline";
import { createChildLogger } from "../_core/logger";
import {
  syncHistoryForIntegration,
  classifyPendingLedger,
  feedPendingDownstream,
  type GmailIntakePort,
  type ClassifierPort,
  type LockPort,
  type LedgerStore,
  type AlertPort,
  type DownstreamPort,
  type HistorySyncDeps,
  type IntegrationCursor,
  type MinimalLedgerRow,
  type LedgerRow,
  type LedgerStatus,
  type FailureKind,
  type IntakeRoute,
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
    // ONE history page per call — the engine paginates + advances the cursor per
    // page (P0-2 逐頁前綴推進). No discovery cap here.
    fetchHistoryPage(startHistoryId, pageToken) {
      return fetchHistoryPage(gmail, startHistoryId, pageToken, { labelId: "INBOX" });
    },
    scanQueryPage(query, pageToken) {
      return scanQueryPage(gmail, query, pageToken);
    },
    scanQueryMetadata(query) {
      return listMessageMetadataForQuery(gmail, query);
    },
    getMailboxHistoryId() {
      return gmailGetMailboxHistoryId(gmail);
    },
  };
}

// ── Classifier port (hydrate From + rules-only receipt sniff) ────────────────

/**
 * The classification stage's hydration (P0-1). Fetches ONE message's summary
 * (subject/body/attachment metadata — NOT raw attachment bytes) and runs the SAME
 * rules-only receipt sniff the legacy poll uses, so the ledger's route decision
 * matches the legacy writer. Returns null when the message vanished (deleted/moved
 * between discovery + classification) → the engine leaves the row pending to retry.
 */
export function createClassifierPort(
  gmail: ReturnType<typeof buildGmailClient>,
): ClassifierPort {
  return {
    async hydrateSignals(gmailMessageId) {
      const [msg] = await listMessagesByIds(gmail, [gmailMessageId]);
      if (!msg) return null;
      // 對抗審查修正 2 — detectReceipt throws PROPAGATE. Swallowing a sniff error
      // here would silently classify a potential receipt as noise (terminal); the
      // engine instead schedules a non-terminal retry (F skeleton) and, after
      // exhaustion, a manual-review card. Never guess a route from a failed sniff.
      const isReceipt = detectReceipt({
        subject: msg.subject,
        body: msg.body,
        attachments: msg.attachments ?? [],
      }).isReceipt;
      return {
        from: msg.from,
        isReceipt,
        internalDateMs: msg.receivedAt instanceof Date ? msg.receivedAt.getTime() : 0,
      };
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
// P0-2: these caps bound DOWNSTREAM classification/processing batches ONLY — never
// discovery (the engine paginates history.list unbounded, guarded by its own valve).
const LEDGER_CLASSIFY_BATCH = 100;
const LEDGER_FEED_BATCH = 100;

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

    async insertMinimalIgnore(rows) {
      if (rows.length === 0) return 0;
      // State-aware upsert (Codex 15 輪 P0-2), done as TWO ordering-hazard-free
      // statements under the per-integration fencing lock (the sole writer, so no
      // concurrent-upsert race). Both are idempotent → duplicate labelAdded / crash-
      // replay converge with zero duplication.
      //
      // Statement 1 — idempotent INSERT + ALWAYS track the latest inbox-arrival
      // historyId (every eventKind / every status branch). Minimal discovery row
      // (P0-1): fromAddress/route/classifiedAt stay NULL, internalDateMs 0 until the
      // classification stage hydrates them. On a duplicate key we only refresh
      // lastSeenHistoryId — COALESCE'd so a fallback-scan re-discovery (which carries
      // gmailHistoryId=NULL) never clobbers a real value; the requeue itself is
      // statement 2 so no SET clause here references `status`.
      await db
        .insert(gmailIngestionLedger)
        .values(
          rows.map((r) => ({
            integrationId: r.integrationId,
            gmailMessageId: r.gmailMessageId,
            gmailThreadId: r.gmailThreadId,
            gmailHistoryId: r.gmailHistoryId,
            lastSeenHistoryId: r.gmailHistoryId,
            discoveryReason: "initial" as const,
            internalDateMs: 0,
            source: r.source,
            status: "pending" as const,
          })),
        )
        .onDuplicateKeyUpdate({
          set: {
            lastSeenHistoryId: sql`coalesce(values(\`lastSeenHistoryId\`), \`lastSeenHistoryId\`)`,
          },
        });

      // Statement 2 — REQUEUE gate (Codex 15 輪 §四.1 修正): ONLY discoveries whose
      // eventKind is 'label_added_inbox' (an explicit labelAdded event carrying INBOX)
      // may resurrect a terminal-ignored row. messagesAdded replays and fallback/
      // bootstrap/backfill scans are 'message_added' → they never reach this statement,
      // so a 404 full-inbox re-scan cannot mass-requeue historical noise (重排風暴閘門).
      // For the gated ids: flip ignored→pending, clear the classification (route/
      // wouldRoute → re-classify from scratch), reset the retry/classify track, and
      // stamp the audit trail. The `WHERE status='ignored'` gate makes this a no-op
      // for processed/failed/pending rows (§四 3/4) and idempotent on replay (a re-hit
      // finds status='pending'). No SET column references `status`, so there is NO
      // ODKU-style assignment-order hazard — every RHS reads the pre-update row.
      const requeueIds = rows
        .filter((r) => r.eventKind === "label_added_inbox")
        .map((r) => r.gmailMessageId);
      if (requeueIds.length === 0) return rows.length;
      const integrationId = rows[0]!.integrationId;
      await db
        .update(gmailIngestionLedger)
        .set({
          status: "pending",
          route: null,
          wouldRoute: null,
          classifiedAt: null,
          fromAddress: null,
          internalDateMs: 0,
          failureKind: null,
          errorDetail: null,
          httpStatus: null,
          retryCount: 0,
          nextRetryAt: null,
          processedAt: null,
          interactionId: null,
          discoveryReason: "inbox_requeue",
          lastRequeuedAt: new Date(),
          requeueCount: sql`${gmailIngestionLedger.requeueCount} + 1`,
        })
        .where(
          and(
            eq(gmailIngestionLedger.integrationId, integrationId),
            inArray(gmailIngestionLedger.gmailMessageId, requeueIds),
            eq(gmailIngestionLedger.status, "ignored"),
          ),
        );
      return rows.length;
    },

    async listUnclassified(integrationId, nowMs) {
      const now = new Date(nowMs);
      const rows = await db
        .select()
        .from(gmailIngestionLedger)
        .where(
          and(
            eq(gmailIngestionLedger.integrationId, integrationId),
            eq(gmailIngestionLedger.status, "pending"),
            isNull(gmailIngestionLedger.route),
            // classify-retry backoff gate: fresh rows have nextRetryAt NULL; a row
            // whose hydrate/sniff threw waits out its F-skeleton backoff here.
            or(
              isNull(gmailIngestionLedger.nextRetryAt),
              lte(gmailIngestionLedger.nextRetryAt, now),
            ),
          ),
        )
        .orderBy(asc(gmailIngestionLedger.firstSeenAt))
        .limit(LEDGER_CLASSIFY_BATCH);
      return rows.map(mapLedgerRow);
    },

    async recordClassifyFailure(ledgerId, cls, retryCount, nextRetryAt, at) {
      // NON-terminal (對抗審查修正 2): status stays pending + route stays NULL so
      // the row is re-classified after the backoff — never noise'd by a sniff error.
      await db
        .update(gmailIngestionLedger)
        .set({
          failureKind: cls.failureKind,
          httpStatus: cls.httpStatus,
          errorDetail: cls.errorDetail,
          retryCount,
          nextRetryAt,
          lastAttemptAt: at,
        })
        .where(eq(gmailIngestionLedger.id, ledgerId));
    },

    async classify(ledgerId, fields) {
      await db
        .update(gmailIngestionLedger)
        .set({
          fromAddress: fields.fromAddress,
          route: fields.route,
          wouldRoute: fields.wouldRoute,
          internalDateMs: fields.internalDateMs,
          classifiedAt: fields.classifiedAt,
          status: fields.status,
          lastAttemptAt: fields.classifiedAt,
          // a terminal ignored classification also stamps processedAt (audit).
          ...(fields.status === "ignored" ? { processedAt: fields.classifiedAt } : {}),
        })
        .where(eq(gmailIngestionLedger.id, ledgerId));
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
              // classified customer/receipt still pending (P0-1: never an unclassified
              // route-NULL row — the feeder only ever acts on a decided row).
              and(
                eq(gmailIngestionLedger.status, "pending"),
                inArray(gmailIngestionLedger.route, ["customer", "receipt"]),
              ),
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
        .limit(LEDGER_FEED_BATCH);
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
    fromAddress: r.fromAddress ?? null,
    source: r.source,
    status: r.status as LedgerStatus,
    route: (r.route as IntakeRoute | null) ?? null,
    wouldRoute: (r.wouldRoute as IntakeRoute | null) ?? null,
    failureKind: (r.failureKind as FailureKind | null) ?? null,
    httpStatus: r.httpStatus ?? null,
    retryCount: r.retryCount,
    nextRetryAt: r.nextRetryAt ?? null,
    interactionId: r.interactionId ?? null,
    lastSeenHistoryId: r.lastSeenHistoryId ?? null,
    discoveryReason: r.discoveryReason ?? null,
    requeueCount: r.requeueCount,
    lastRequeuedAt: r.lastRequeuedAt ?? null,
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
  classify?: Awaited<ReturnType<typeof classifyPendingLedger>>;
  feed?: Awaited<ReturnType<typeof feedPendingDownstream>>;
}

/**
 * Run the History ledger engine for ONE integration. Returns ran=false for
 * legacy integrations (the caller keeps running the legacy poll/push, unchanged).
 * All non-legacy modes: sync (discover + land + advance) → classify (route). shadow
 * classification is terminal-only (observes wouldRoute, NO side effect — legacy
 * stays the唯一副作用 writer). history additionally feeds classified rows downstream.
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
    classifier: createClassifierPort(gmail),
    downstream: cursor.intakeMode === "history" ? createDownstreamPort(cursor) : undefined,
  };

  const sync = await syncHistoryForIntegration(deps, integrationId);
  const classify = await classifyPendingLedger(deps, integrationId);
  const result: IntakeRunResult = { ran: true, mode: cursor.intakeMode, sync, classify };
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
