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
  runIntakeStages,
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

// P0-3 — releasing the lease is part of EVERY terminal/retry write, so the row is
// immediately re-claimable and never holds a stale token.
const CLAIM_CLEAR = { claimToken: null, claimExpiresAt: null, claimStage: null } as const;

/** mysql2 (via drizzle) returns [ResultSetHeader, fields] for an UPDATE — pull
 *  affectedRows so a CAS/token-gated write can report whether it actually landed. */
function affectedRows(res: unknown): number {
  return (res as any)?.[0]?.affectedRows ?? 0;
}

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
      // State-aware upsert (Codex 15 輪 P0-2 + 16 輪事件級冪等 + 17 輪 §四 事件消耗水位),
      // done as TWO ordering-hazard-free statements under the per-integration fencing lock
      // (the sole writer, so no concurrent-upsert race). Both idempotent → duplicate
      // labelAdded / crash-replay converge with ZERO duplication.
      //
      // ⚠ STATEMENT ORDER — REQUEUE runs FIRST (Codex 17 輪 §四.1 自遮蔽修正). The old
      // order (INSERT/lastSeen bump first, then requeue) self-shadowed: statement 1 raised
      // lastSeenHistoryId to include THIS event, so the requeue gate — comparing against
      // COALESCE(lastRequeueEventId, lastSeenHistoryId) — always saw a watermark already
      // ≥ this event →永 false. Reordering makes the requeue read the watermark BEFORE this
      // event's own bump. (The alternative was merging into one ODKU with hand-ordered SET
      // assignments — rejected as fragile.)
      //
      // Statement 1 — REQUEUE gate (§四.1). ONLY a discovery carrying a labelAdded(INBOX)
      // event id (labelEventId non-null; message_added / fallback / bootstrap / backfill
      // scans carry null → never reach here — 重排風暴閘門) may resurrect a terminal-ignored
      // row, and ONLY when that label event id is STRICTLY GREATER than the CONSUMED
      // watermark COALESCE(lastRequeueEventId, lastSeenHistoryId) — the highest event id
      // already consumed BEFORE this one. Each candidate carries its OWN labelEventId, so
      // this is a per-message conditional CAS UPDATE: the strict-greater guard makes
      // replaying the SAME (or older) label event — even after the row cycled back to
      // ignored — a no-op (affectedRows=0), so requeueCount can NEVER double-count. On a
      // real requeue: flip ignored→pending, clear the classification, reset retry/claim
      // track, and — ATOMICALLY in the one UPDATE (no先記消耗後重排 crash gap) — bump
      // requeueCount, record consumption (lastRequeueEventId=labelEventId), advance the
      // monotonic lastSeenHistoryId, stamp the audit trail. `WHERE status='ignored'` keeps
      // processed/failed/pending a no-op (§四 3/4). A NULL watermark (scan-created row, no
      // event id yet) → X > NULL → NULL → no requeue (fail-closed: never resurrect on an
      // incomparable watermark). No SET column references `status`, so no assignment hazard.
      const requeueCandidates = rows.filter(
        (r) => r.eventKind === "label_added_inbox" && r.labelEventId !== null,
      );
      for (const r of requeueCandidates) {
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
            // record THIS label event as consumed (§四.1) …
            lastRequeueEventId: r.labelEventId,
            // … and advance the seen watermark monotonically in the SAME statement —
            // GREATEST(current, maxSeenEventId), BigInt CAST UNSIGNED, NULL-safe, never
            // regressing (§四.1 「lastSeenHistoryId=GREATEST(單調)」).
            lastSeenHistoryId: sql`case when ${gmailIngestionLedger.lastSeenHistoryId} is null then ${r.maxSeenEventId} when ${r.maxSeenEventId} is null then ${gmailIngestionLedger.lastSeenHistoryId} when cast(${r.maxSeenEventId} as unsigned) > cast(${gmailIngestionLedger.lastSeenHistoryId} as unsigned) then ${r.maxSeenEventId} else ${gmailIngestionLedger.lastSeenHistoryId} end`,
            // an ignored row shouldn't hold a live lease, but clear defensively so the
            // re-classification round can claim the freshly-pending row.
            claimToken: null,
            claimExpiresAt: null,
            claimStage: null,
          })
          .where(
            and(
              eq(gmailIngestionLedger.integrationId, r.integrationId),
              eq(gmailIngestionLedger.gmailMessageId, r.gmailMessageId),
              eq(gmailIngestionLedger.status, "ignored"),
              sql`cast(${r.labelEventId} as unsigned) > cast(coalesce(${gmailIngestionLedger.lastRequeueEventId}, ${gmailIngestionLedger.lastSeenHistoryId}) as unsigned)`,
            ),
          );
      }

      // Statement 2 — idempotent INSERT + FORWARD-ONLY lastSeen (§四.2/.3). Minimal
      // discovery row (P0-1): fromAddress/route/classifiedAt NULL, internalDateMs 0 until
      // classification hydrates them. gmailHistoryId + lastSeenHistoryId land maxSeenEventId
      // (this message's own MAX record id; Codex 17 §四.3) — never a page boundary / mailbox
      // snapshot. A FIRST-by-label discovery seeds lastRequeueEventId=labelEventId (§四.2:
      // that event already drove the row to pending → a replay must not count as a fresh
      // requeue); a message_added / scan discovery leaves it NULL. On a duplicate we advance
      // lastSeenHistoryId ONLY when the incoming id is strictly greater (BigInt CAST UNSIGNED),
      // NULL-safe both ways (a scan re-discovery carries NULL → never clobbers; a reordered/
      // older event → never regresses) — idempotent for a just-requeued row (statement 1
      // already bumped it). ODKU set NEVER touches lastRequeueEventId or `status` (requeue is
      // statement 1), so no ODKU assignment-order hazard.
      await db
        .insert(gmailIngestionLedger)
        .values(
          rows.map((r) => ({
            integrationId: r.integrationId,
            gmailMessageId: r.gmailMessageId,
            gmailThreadId: r.gmailThreadId,
            gmailHistoryId: r.maxSeenEventId,
            lastSeenHistoryId: r.maxSeenEventId,
            lastRequeueEventId: r.labelEventId,
            discoveryReason: "initial" as const,
            internalDateMs: 0,
            source: r.source,
            status: "pending" as const,
          })),
        )
        .onDuplicateKeyUpdate({
          set: {
            lastSeenHistoryId: sql`case when values(\`lastSeenHistoryId\`) is null then \`lastSeenHistoryId\` when \`lastSeenHistoryId\` is null then values(\`lastSeenHistoryId\`) when cast(values(\`lastSeenHistoryId\`) as unsigned) > cast(\`lastSeenHistoryId\` as unsigned) then values(\`lastSeenHistoryId\`) else \`lastSeenHistoryId\` end`,
          },
        });

      return rows.length;
    },

    async claimUnclassified(integrationId, claimToken, leaseExpiresAt, nowMs) {
      const now = new Date(nowMs);
      // P0-3 — atomic CAS claim: stamp OUR token on up to a batch of candidate rows
      // that are free (unclaimed) or whose lease expired. A concurrent classifier with
      // a different token matches a DISJOINT set (already-leased rows fall out of the
      // WHERE), so the two never claim the same row. affectedRows = # we won.
      await db
        .update(gmailIngestionLedger)
        .set({ claimToken, claimExpiresAt: leaseExpiresAt, claimStage: "classify" })
        .where(
          and(
            eq(gmailIngestionLedger.integrationId, integrationId),
            eq(gmailIngestionLedger.status, "pending"),
            isNull(gmailIngestionLedger.route),
            // classify-retry backoff gate: fresh rows have nextRetryAt NULL; a row
            // whose hydrate/sniff threw waits out its F-skeleton backoff here.
            or(isNull(gmailIngestionLedger.nextRetryAt), lte(gmailIngestionLedger.nextRetryAt, now)),
            // lease-free: unclaimed, or a prior lease already lapsed.
            or(isNull(gmailIngestionLedger.claimToken), lte(gmailIngestionLedger.claimExpiresAt, now)),
          ),
        )
        .orderBy(asc(gmailIngestionLedger.firstSeenAt))
        .limit(LEDGER_CLASSIFY_BATCH);
      // read back EXACTLY the rows this token now owns.
      const rows = await db
        .select()
        .from(gmailIngestionLedger)
        .where(
          and(
            eq(gmailIngestionLedger.integrationId, integrationId),
            eq(gmailIngestionLedger.claimToken, claimToken),
          ),
        )
        .orderBy(asc(gmailIngestionLedger.firstSeenAt))
        .limit(LEDGER_CLASSIFY_BATCH);
      return rows.map(mapLedgerRow);
    },

    async renewClaim(ledgerId, claimToken, leaseExpiresAt) {
      const res = await db
        .update(gmailIngestionLedger)
        .set({ claimExpiresAt: leaseExpiresAt })
        .where(and(eq(gmailIngestionLedger.id, ledgerId), eq(gmailIngestionLedger.claimToken, claimToken)));
      return affectedRows(res) > 0;
    },

    async releaseClaim(ledgerId, claimToken) {
      const res = await db
        .update(gmailIngestionLedger)
        .set(CLAIM_CLEAR)
        .where(and(eq(gmailIngestionLedger.id, ledgerId), eq(gmailIngestionLedger.claimToken, claimToken)));
      return affectedRows(res) > 0;
    },

    async recordClassifyFailure(ledgerId, cls, retryCount, nextRetryAt, at, claimToken) {
      // NON-terminal (對抗審查修正 2): status stays pending + route stays NULL so the
      // row is re-classified after the backoff — never noise'd by a sniff error. Gated
      // by claimToken (a lost lease → affectedRows=0 → false); releases the lease.
      const res = await db
        .update(gmailIngestionLedger)
        .set({
          failureKind: cls.failureKind,
          httpStatus: cls.httpStatus,
          errorDetail: cls.errorDetail,
          retryCount,
          nextRetryAt,
          lastAttemptAt: at,
          ...CLAIM_CLEAR,
        })
        .where(and(eq(gmailIngestionLedger.id, ledgerId), eq(gmailIngestionLedger.claimToken, claimToken)));
      return affectedRows(res) > 0;
    },

    async classify(ledgerId, fields, claimToken) {
      const res = await db
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
          // release the classify lease — a history-mode customer/receipt row then
          // becomes free for the feeder to claim; a terminal ignored row is done.
          ...CLAIM_CLEAR,
        })
        .where(and(eq(gmailIngestionLedger.id, ledgerId), eq(gmailIngestionLedger.claimToken, claimToken)));
      return affectedRows(res) > 0;
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

    async claimActionable(integrationId, claimToken, leaseExpiresAt, nowMs) {
      const now = new Date(nowMs);
      // P0-3 — atomic CAS claim of the feeder's actionable batch. This claim is the
      // LAST gate before a downstream side effect: a concurrent feeder gets a disjoint
      // set. HONEST scope (對抗審查修正): token-gated writes make the LEDGER outcome
      // exactly-once; the downstream side effect itself is at-least-once — if a lease
      // lapses mid-flight (heartbeat-failure window) a peer may re-claim and re-process
      // the same message, deduped by the downstream external-id idempotency (design §5,
      // processOneEmail / receipt chain keyed on gmailMessageId/external key).
      await db
        .update(gmailIngestionLedger)
        .set({ claimToken, claimExpiresAt: leaseExpiresAt, claimStage: "feed" })
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
            // lease-free: unclaimed, or a prior lease already lapsed.
            or(isNull(gmailIngestionLedger.claimToken), lte(gmailIngestionLedger.claimExpiresAt, now)),
          ),
        )
        .orderBy(asc(gmailIngestionLedger.firstSeenAt))
        .limit(LEDGER_FEED_BATCH);
      const rows = await db
        .select()
        .from(gmailIngestionLedger)
        .where(
          and(
            eq(gmailIngestionLedger.integrationId, integrationId),
            eq(gmailIngestionLedger.claimToken, claimToken),
          ),
        )
        .orderBy(asc(gmailIngestionLedger.firstSeenAt))
        .limit(LEDGER_FEED_BATCH);
      return rows.map(mapLedgerRow);
    },

    async markProcessed(ledgerId, interactionId, at, claimToken) {
      // Gated by claimToken (§五 corruption guard): a runner whose lease was re-taken by
      // a peer can NOT write here, so a stale success never clobbers the peer's outcome.
      const res = await db
        .update(gmailIngestionLedger)
        .set({
          status: "processed",
          interactionId: interactionId ?? null,
          processedAt: at,
          lastAttemptAt: at,
          nextRetryAt: null,
          ...CLAIM_CLEAR,
        })
        .where(and(eq(gmailIngestionLedger.id, ledgerId), eq(gmailIngestionLedger.claimToken, claimToken)));
      return affectedRows(res) > 0;
    },

    async markIgnored(ledgerId, failureKind, at, claimToken) {
      const res = await db
        .update(gmailIngestionLedger)
        .set({ status: "ignored", failureKind, processedAt: at, lastAttemptAt: at, nextRetryAt: null, ...CLAIM_CLEAR })
        .where(and(eq(gmailIngestionLedger.id, ledgerId), eq(gmailIngestionLedger.claimToken, claimToken)));
      return affectedRows(res) > 0;
    },

    async markFailed(ledgerId, cls, retryCount, nextRetryAt, at, claimToken) {
      // §五 THE state-corruption guard: if A already markProcessed (clearing the lease),
      // B's UNIQUE-key-collision markFailed carries a token the row no longer holds →
      // affectedRows=0 → B can NEVER flip A's processed back to failed.
      const res = await db
        .update(gmailIngestionLedger)
        .set({
          status: "failed",
          failureKind: cls.failureKind,
          httpStatus: cls.httpStatus,
          errorDetail: cls.errorDetail,
          retryCount,
          nextRetryAt,
          lastAttemptAt: at,
          ...CLAIM_CLEAR,
        })
        .where(and(eq(gmailIngestionLedger.id, ledgerId), eq(gmailIngestionLedger.claimToken, claimToken)));
      return affectedRows(res) > 0;
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
    lastRequeueEventId: r.lastRequeueEventId ?? null,
    claimToken: r.claimToken ?? null,
    claimExpiresAt: r.claimExpiresAt ?? null,
    claimStage: r.claimStage ?? null,
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

  // P0-3 orchestration fencing (Codex 16 輪 §六.3) — the sync→gate→classify→feed
  // composition lives in the pure engine (runIntakeStages), so the fencing gate is
  // unit-tested with fakes; this adapter only wires deps + shapes the run result.
  const stages = await runIntakeStages(deps, integrationId, cursor.intakeMode);
  return {
    ran: true,
    mode: cursor.intakeMode,
    sync: stages.sync,
    classify: stages.classify,
    feed: stages.feed,
  };
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
