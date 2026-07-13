/**
 * gmail-intake-ledger (2026-07-13) — the reconciliation tripwire (D, Codex 11
 * §4) + watch lifecycle health (§5). Runs every 5 minutes per non-legacy
 * integration and does a逐-message set-difference using the SAME eligibility
 * predicate the History engine uses (so a message one path ingests and another
 * skips can never masquerade as a漏接).
 *
 * Four P1 rules (design §4):
 *   1. eligible new mail > 10 min old with NO ledger row        → P1
 *   2. any ledger row pending/failed > 30 min                    → P1
 *   3. last successful history sync > 10 min (or never)          → channel P1
 *   4. watchExpiration NULL / expired → P1; < 24h → warning; topic unset → P1
 *
 * Incident fingerprint = integrationId + failureKind + firstMissingMessageId.
 * Same fingerprint updates the same incident, re-alerts at most once per 60 min,
 * and recovery auto-closes the incident recording its duration + missing count.
 * Every card carries ONLY ids / counts / kinds — never sender content or body
 * (attack surface 10). Pure engine over injected ports — tests use in-memory fakes.
 */
import { isEligibleForIntake } from "../_core/gmailEligibility";
import type { AlertPort, GmailIntakePort, LedgerStore, IntegrationCursor } from "./gmailHistorySync";

// ── ports ────────────────────────────────────────────────────────────────────

/** Incident lifecycle: dedup + 60-min re-alert cap + recovery-with-duration. */
export interface IncidentTracker {
  /** Record an active incident. Returns firstSeen + whether to (re)alert now. */
  onActive(
    fingerprint: string,
    nowMs: number,
    reAlertWindowMs: number,
  ): Promise<{ firstSeenMs: number; shouldAlert: boolean }>;
  /** Clear an incident on recovery. Returns its firstSeen (for duration) or null
   *  when there was no active incident (nothing to auto-close). */
  onRecovered(fingerprint: string, nowMs: number): Promise<{ firstSeenMs: number } | null>;
}

export interface ReconcileDeps {
  gmail: Pick<GmailIntakePort, "scanQueryMetadata">;
  store: LedgerStore;
  alerts: AlertPort;
  incidents: IncidentTracker;
  clock?: () => number;
  /** GMAIL_PUBSUB_TOPIC presence (env read by the adapter, injected here). */
  topicConfigured: boolean;
}

// ── tunables ─────────────────────────────────────────────────────────────────

const MISSING_LEDGER_MIN_AGE_MS = 10 * 60 * 1000; // rule 1: >10 min
const STUCK_MAX_AGE_MS = 30 * 60 * 1000; // rule 2: >30 min
const SYNC_STALE_MS = 10 * 60 * 1000; // rule 3: >10 min
const WATCH_WARN_MS = 24 * 60 * 60 * 1000; // rule 4: <24h → warning
const RECONCILE_LOOKBACK_MS = 60 * 60 * 1000; // rule 1 scan window
const RE_ALERT_WINDOW_MS = 60 * 60 * 1000; // ≤ 1 re-alert per 60 min

// ── watch health (pure, exported for the three-state test) ───────────────────

export type WatchHealth =
  | { level: "ok" }
  | { level: "warning"; reason: "expiring_soon" }
  | { level: "p1"; reason: "topic_unset" | "never_registered" | "expired" };

/**
 * Classify a mailbox's Gmail push-watch state (design §4 rule 4 / §5). The three
 * alerting states — never-registered (NULL), expired, expiring-soon — plus the
 * topic-unset case that used to silently `return` (requirement 8).
 */
export function checkWatchHealth(
  watchExpiration: number | null,
  topicConfigured: boolean,
  nowMs: number,
): WatchHealth {
  if (!topicConfigured) return { level: "p1", reason: "topic_unset" };
  if (watchExpiration == null) return { level: "p1", reason: "never_registered" };
  if (watchExpiration <= nowMs) return { level: "p1", reason: "expired" };
  if (watchExpiration - nowMs < WATCH_WARN_MS) return { level: "warning", reason: "expiring_soon" };
  return { level: "ok" };
}

const WATCH_REASON_ZH: Record<string, string> = {
  topic_unset: "GMAIL_PUBSUB_TOPIC 未設定 —— push 通道從未啟用,只靠 poll/reconcile 兜底",
  never_registered: "watchExpiration 為 NULL —— 從未成功註冊 watch,push 不會送達",
  expired: "watch 已過期 —— push 已停止送達,新信只靠 reconcile 兜底",
  expiring_soon: "watch 將於 24 小時內過期 —— 續期排程應盡快重註冊",
};

// ── the reconcile pass ───────────────────────────────────────────────────────

export interface ReconcileReport {
  missingFromLedger: number;
  stuck: number;
  syncStale: boolean;
  watch: WatchHealth;
  cardsPosted: number;
  incidentsRecovered: number;
}

/**
 * One reconciliation round for one integration. Legacy integrations are the
 * caller's responsibility to skip (this runs only for shadow/history mailboxes).
 */
export async function reconcileIntegration(
  deps: ReconcileDeps,
  integration: IntegrationCursor,
): Promise<ReconcileReport> {
  const nowMs = deps.clock ? deps.clock() : Date.now();
  const report: ReconcileReport = {
    missingFromLedger: 0,
    stuck: 0,
    syncStale: false,
    watch: { level: "ok" },
    cardsPosted: 0,
    incidentsRecovered: 0,
  };

  // ── Rule 1 — eligible mail with no ledger row (the core漏接 tripwire) ───────
  {
    const sinceSeconds = Math.floor((nowMs - RECONCILE_LOOKBACK_MS) / 1000);
    // scanQueryMetadata now reports truncation; reconcile is the backstop tripwire
    // (a 1h lookback rarely caps), so it consumes the metas subset — a truncated
    // scan only under-reports, never advances a cursor, so it stays fail-safe.
    const { metas } = await deps.gmail.scanQueryMetadata(`after:${sinceSeconds} in:inbox`);
    const eligibleOldEnough = metas.filter(
      (m) =>
        m.id &&
        isEligibleForIntake(m.from) &&
        m.internalDateMs > 0 &&
        nowMs - m.internalDateMs > MISSING_LEDGER_MIN_AGE_MS,
    );
    const ids = eligibleOldEnough.map((m) => m.id);
    const known = ids.length
      ? await deps.store.existingMessageIds(integration.id, ids)
      : new Set<string>();
    const missing = eligibleOldEnough
      .filter((m) => !known.has(m.id))
      .sort((a, b) => a.internalDateMs - b.internalDateMs); // oldest first → firstMissing
    report.missingFromLedger = missing.length;
    const firstMissing = missing[0]?.id ?? null;
    // Fingerprint is STABLE per (integration, rule) for the incident lifecycle
    // so recovery can auto-close it; the specific firstMissing id lives in the
    // card body for triage (design §4 "事故指紋…恢復自動關卡" — a per-message id
    // in the key would never match on recovery when nothing is missing).
    const fp = `gmail-reconcile:${integration.id}:missing_ledger`;
    if (missing.length > 0 && firstMissing) {
      const posted = await maybeAlert(deps, nowMs, fp, {
        priority: "high",
        title: `客戶信未進 ledger(${missing.length} 封)`,
        body:
          `對帳發現 ${missing.length} 封合格客戶信超過 10 分鐘仍無 ledger 紀錄(疑似漏接)。\n` +
          `integrationId:${integration.id}\n` +
          `最早缺件 messageId:${firstMissing}\n` +
          `(卡片只含 id/計數,不含寄件人或內容)`,
      });
      if (posted) report.cardsPosted++;
    } else if (await recover(deps, nowMs, fp)) {
      report.incidentsRecovered++;
    }
  }

  // ── Rule 2 — ledger rows stuck pending/failed > 30 min ─────────────────────
  {
    const stuck = await deps.store.oldestStuck(
      integration.id,
      ["pending", "failed"],
      STUCK_MAX_AGE_MS,
      nowMs,
    );
    const fp = `gmail-reconcile:${integration.id}:stuck`;
    if (stuck) {
      report.stuck = 1;
      const posted = await maybeAlert(deps, nowMs, fp, {
        priority: "high",
        title: `ledger 有卡住的攝取列(${stuck.failureKind ?? "pending"})`,
        body:
          `對帳發現 ledger 有 pending/failed 列超過 30 分鐘未達終態。\n` +
          `integrationId:${integration.id}\n` +
          `最舊卡住 messageId:${stuck.gmailMessageId}\n` +
          `失敗分類:${stuck.failureKind ?? "(仍 pending)"}\n` +
          `已卡約 ${Math.floor(stuck.ageMs / 60000)} 分鐘`,
      });
      if (posted) report.cardsPosted++;
    } else if (await recover(deps, nowMs, fp)) {
      report.incidentsRecovered++;
    }
  }

  // ── Rule 3 — last successful history sync stale (channel down) ─────────────
  {
    const lastSync = integration.lastSuccessfulSyncAt?.getTime() ?? null;
    const stale = lastSync == null || nowMs - lastSync > SYNC_STALE_MS;
    report.syncStale = stale;
    const fp = `gmail-reconcile:${integration.id}:sync_stale`;
    if (stale) {
      const posted = await maybeAlert(deps, nowMs, fp, {
        priority: "high",
        title: `History 同步通道停擺`,
        body:
          `對帳發現 History 同步已超過 10 分鐘未成功前進游標(或從未成功)。\n` +
          `integrationId:${integration.id}\n` +
          `lastSuccessfulSyncAt:${integration.lastSuccessfulSyncAt?.toISOString() ?? "(從未)"}`,
      });
      if (posted) report.cardsPosted++;
    } else if (await recover(deps, nowMs, fp)) {
      report.incidentsRecovered++;
    }
  }

  // ── Rule 4 — watch lifecycle (three-state, no more silent return) ──────────
  {
    const health = checkWatchHealth(integration.watchExpiration, deps.topicConfigured, nowMs);
    report.watch = health;
    const reason = health.level === "ok" ? null : health.reason;
    const fp = `gmail-reconcile:${integration.id}:watch:${reason ?? "ok"}`;
    if (health.level !== "ok") {
      const posted = await maybeAlert(deps, nowMs, fp, {
        priority: health.level === "p1" ? "high" : "normal",
        title: `Gmail push watch 異常(${health.reason})`,
        body:
          `${WATCH_REASON_ZH[health.reason]}\n` +
          `integrationId:${integration.id}\n` +
          `watchExpiration:${integration.watchExpiration != null ? new Date(integration.watchExpiration).toISOString() : "NULL"}`,
      });
      if (posted) report.cardsPosted++;
    } else {
      // clear all watch fingerprints on recovery (any of the three states).
      for (const r of ["topic_unset", "never_registered", "expired", "expiring_soon"]) {
        if (await recover(deps, nowMs, `gmail-reconcile:${integration.id}:watch:${r}`)) {
          report.incidentsRecovered++;
        }
      }
    }
  }

  return report;
}

/** Post a card iff the incident is new or the 60-min re-alert window elapsed. */
async function maybeAlert(
  deps: ReconcileDeps,
  nowMs: number,
  fingerprint: string,
  card: { priority: "low" | "normal" | "high" | "critical"; title: string; body: string },
): Promise<boolean> {
  const { shouldAlert } = await deps.incidents.onActive(fingerprint, nowMs, RE_ALERT_WINDOW_MS);
  if (!shouldAlert) return false;
  await deps.alerts.postCard({ agentName: "gmail-intake", ...card });
  return true;
}

/** Auto-close an incident on recovery; posts a low-priority resolved note with
 *  the duration so Jeff sees it self-healed (design §4 "恢復自動關卡記持續時間"). */
async function recover(deps: ReconcileDeps, nowMs: number, fingerprint: string): Promise<boolean> {
  const cleared = await deps.incidents.onRecovered(fingerprint, nowMs);
  if (!cleared) return false;
  const durationMin = Math.max(0, Math.floor((nowMs - cleared.firstSeenMs) / 60000));
  await deps.alerts.postCard({
    agentName: "gmail-intake",
    priority: "low",
    title: `攝取異常已自動恢復`,
    body: `先前的攝取/通道異常已恢復,自動關閉。持續約 ${durationMin} 分鐘。\n指紋:${fingerprint}`,
  });
  return true;
}
