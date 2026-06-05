/**
 * 2026-06-04 — Gmail token-revocation detection + throttled owner alert.
 *
 * Context: the gmail-poll worker caught every per-integration error and only
 * `console.error`'d it; the BullMQ job still completed "successfully", so the
 * worker's `failed`-event notifyOwner never fired for a revoked OAuth token.
 * support@packgoplay.com's refresh token died with `invalid_grant` on
 * 2026-06-03 and failed silently every 10 minutes after that.
 *
 * This module holds the PURE decision logic so it is unit-testable without
 * importing gmailPollWorker.ts (that file does `new Worker()` at import time,
 * which connects to Redis). The worker passes its DB + notifyOwner in as `io`.
 *
 * Owner decision (2026-06-04): do NOT auto-disable the account. Keep
 * isActive=1, just fire ONE throttled alert per revocation episode. The
 * `disconnectReason` column doubles as the dedup flag: we stamp it with the
 * `auth_revoked` prefix on the first failing tick, then stay quiet on
 * subsequent ticks. The OAuth callback clears `disconnectReason` on reconnect,
 * so a future re-revoke re-arms the alert.
 */

/** Stamped onto disconnectReason; also the dedup sentinel. */
export const REVOCATION_REASON_PREFIX = "auth_revoked";

/** Cap the stored reason so a giant error message can't bloat the text column. */
const MAX_REASON_LEN = 500;

/**
 * True only for a definitively revoked / expired OAuth grant. We match
 * narrowly on purpose: a transient network blip or a Google 5xx must NOT trip
 * the alert or auto-stamp, or we'd cry wolf and (worse) mask real outages
 * behind a "needs re-auth" message.
 */
export function isAuthRevocationError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("invalid_grant") ||
    msg.includes("token has been expired or revoked") ||
    msg.includes("token expired or revoked")
  );
}

/** Build the `disconnectReason` value (prefix = dedup sentinel). */
export function formatRevocationReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `${REVOCATION_REASON_PREFIX}: ${msg}`.slice(0, MAX_REASON_LEN);
}

/**
 * Owner alert copy. No em dashes (Jeff's rule). Actionable: includes the exact
 * re-auth URL, which account to pick, and that it only fires once.
 */
export function buildTokenRevocationAlert(
  emailAddress: string,
  baseUrl: string = process.env.BASE_URL || "https://packgoplay.com",
): { title: string; content: string } {
  const url = `${baseUrl.replace(/\/$/, "")}/api/admin/connect-gmail`;
  return {
    title: `Gmail 連線失效:${emailAddress} 需要重新授權`,
    content:
      `PACK&GO 的 Gmail 自動收信 token 被撤銷或過期,目前收不到這個帳號的新信` +
      `(每次輪詢都會失敗)。\n\n` +
      `帳號:${emailAddress}\n\n` +
      `請用 admin 登入 packgoplay.com 後打開下面網址重新授權:\n${url}\n\n` +
      `在 Google 選帳號畫面請選 ${emailAddress}。重新授權後系統會自動恢復收信。` +
      `這封提醒在你修好前只會寄這一次。`,
  };
}

export interface PollErrorIo {
  /** Persist disconnectReason (worker closes over its db + the row id). */
  markDisconnectReason: (integrationId: number, reason: string) => Promise<void>;
  /** Deliver the owner alert (worker passes notifyOwner). */
  notifyOwner: (payload: { title: string; content: string }) => Promise<unknown>;
}

export interface PollErrorOutcome {
  /** Was this a definitive token revocation (vs a generic / transient error)? */
  revoked: boolean;
  /** Did we send the owner alert this tick (false when deduped)? */
  alerted: boolean;
}

/**
 * Decide + perform the response to a per-integration poll error.
 *
 * - generic / transient error → no side effects, caller logs as before.
 * - revocation, not yet flagged → stamp disconnectReason + alert owner once.
 * - revocation, already flagged → stay quiet (dedup; one alert per episode).
 *
 * Never touches isActive (Jeff: keep polling, just don't spam the inbox).
 */
export async function handleIntegrationPollError(
  integration: { id: number; emailAddress: string; disconnectReason: string | null },
  err: unknown,
  io: PollErrorIo,
): Promise<PollErrorOutcome> {
  if (!isAuthRevocationError(err)) {
    return { revoked: false, alerted: false };
  }
  const alreadyFlagged = (integration.disconnectReason ?? "").startsWith(
    REVOCATION_REASON_PREFIX,
  );
  if (alreadyFlagged) {
    return { revoked: true, alerted: false };
  }
  await io.markDisconnectReason(integration.id, formatRevocationReason(err));
  await io.notifyOwner(buildTokenRevocationAlert(integration.emailAddress));
  return { revoked: true, alerted: true };
}
