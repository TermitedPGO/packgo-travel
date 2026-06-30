/**
 * gmail-push (2026-06-29) — Cloud Pub/Sub push webhook for Gmail notifications.
 *
 * Mounted at POST /api/gmail/push (express.raw, so we can read the exact body
 * the way Plaid/Stripe webhooks do). Pub/Sub push-delivers a JSON envelope:
 *
 *   { "message": { "data": base64(JSON{emailAddress,historyId}),
 *                  "messageId": "...", "publishTime": "..." },
 *     "subscription": "projects/<p>/subscriptions/<s>" }
 *
 * SECURITY — we MUST prove the request is really from Google before acting on
 * it (the URL is public; anyone could POST a forged historyId to make us hammer
 * Gmail). Pub/Sub push can attach an OIDC token: it arrives as
 * `Authorization: Bearer <JWT>`, signed by Google, with `aud` = the audience we
 * configured on the subscription and `email` = the service account we set.
 * We verify the JWT signature + audience + expiration via
 * OAuth2Client.verifyIdToken (which fetches + caches Google's public keys),
 * then additionally assert email_verified === true and (optionally) the SA
 * email matches GMAIL_PUSH_SA. Anything that fails → 401, no processing.
 *
 * Fast-ack: once verified + parsed, we enqueue ONE BullMQ job and return 204
 * immediately. The heavy history.list diff + ingest happens in
 * gmailPushWorker so a slow ingest never makes Pub/Sub time out and redeliver
 * (which causes a retry storm). A malformed/poison body is 204-acked (not 500)
 * so Pub/Sub drops it instead of redelivering forever.
 */

import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import {
  decodePubSubPushBody,
  extractBearerToken,
} from "./gmail";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "gmailPushWebhook" });

// Reuse one verifier (it caches Google's public certs internally).
let _verifier: OAuth2Client | null = null;
function getVerifier(): OAuth2Client {
  if (!_verifier) _verifier = new OAuth2Client();
  return _verifier;
}

export type PushAuthResult =
  | { ok: true; email: string | undefined }
  | { ok: false; reason: string };

/**
 * Verify the Pub/Sub OIDC bearer token. Exported for unit tests (the verifier
 * is injected so a test never hits the network). When `expectedAudience` is
 * unset we still verify the signature + expiration but skip the audience check
 * (logged) — prod MUST set GMAIL_PUSH_AUDIENCE. When `expectedServiceAccount`
 * is set, the token's `email` claim must match it.
 */
export async function verifyPushAuth(
  authHeader: string | undefined,
  opts: {
    expectedAudience?: string;
    expectedServiceAccount?: string;
    verifier?: Pick<OAuth2Client, "verifyIdToken">;
  },
): Promise<PushAuthResult> {
  const token = extractBearerToken(authHeader);
  if (!token) return { ok: false, reason: "missing bearer token" };

  const verifier = opts.verifier ?? getVerifier();
  let payload: Record<string, any> | undefined;
  try {
    const ticket = await verifier.verifyIdToken({
      idToken: token,
      // When audience is provided, verifyIdToken enforces it (throws on
      // mismatch). When undefined, it verifies signature + expiry only.
      audience: opts.expectedAudience,
    });
    payload = ticket.getPayload() as Record<string, any> | undefined;
  } catch (e) {
    return {
      ok: false,
      reason: `jwt verify failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!payload) return { ok: false, reason: "empty jwt payload" };

  // Google OIDC tokens carry email + email_verified for the service account.
  if (payload.email_verified !== true) {
    return { ok: false, reason: "email_verified !== true" };
  }
  if (
    opts.expectedServiceAccount &&
    payload.email !== opts.expectedServiceAccount
  ) {
    return {
      ok: false,
      reason: `service account mismatch (got ${payload.email})`,
    };
  }
  return { ok: true, email: payload.email };
}

/**
 * Fail-CLOSED config gate. BOTH the audience and the service account must be set,
 * else the OIDC check skips the audience assertion (audience unset) and/or the SA
 * assertion (SA unset) — together that accepts ANY Google-signed token (any GCP
 * project's service account) on any internet-reachable deploy, not just prod.
 * Returns an error reason when unconfigured, null when safe. Pure + exported so
 * the gate is unit-tested without express/DB, and env-INDEPENDENT (a reachable
 * staging/preview host must fail closed too — NOT gated on NODE_ENV).
 */
export function pushConfigError(
  audience: string | undefined,
  serviceAccount: string | undefined,
): string | null {
  if (!audience || !serviceAccount) {
    return "GMAIL_PUSH_AUDIENCE / GMAIL_PUSH_SA unset — refusing (fail-closed)";
  }
  return null;
}

export async function handleGmailPushWebhook(req: Request, res: Response) {
  const expectedAudience = process.env.GMAIL_PUSH_AUDIENCE || undefined;
  const expectedServiceAccount = process.env.GMAIL_PUSH_SA || undefined;

  // 0. Fail closed if the push identity isn't fully configured — BEFORE verifying,
  // so an unconfigured-but-reachable deploy can never process a single request.
  const configErr = pushConfigError(expectedAudience, expectedServiceAccount);
  if (configErr) {
    log.error({}, `[gmailPush] ${configErr}`);
    return res.status(500).send("push not configured");
  }

  // 1. Verify the request really came from Google's Pub/Sub (signature + audience
  // + expiry + the exact service account — both guaranteed set past the gate).
  const auth = await verifyPushAuth(req.headers["authorization"], {
    expectedAudience,
    expectedServiceAccount,
  });
  if (!auth.ok) {
    log.warn({ reason: auth.reason }, "[gmailPush] rejected unverified push");
    // 401 → Pub/Sub treats as failure and (per its policy) retries; that's fine
    // for a transient key fetch, and a forged request just keeps getting 401.
    return res.status(401).send("unauthorized");
  }

  // 2. Parse the envelope. Malformed → 204 (drop, don't make Pub/Sub redeliver).
  const notification = decodePubSubPushBody(req.body);
  if (!notification) {
    log.warn({}, "[gmailPush] could not decode Pub/Sub body — acking + dropping");
    return res.status(204).end();
  }

  // 3. Resolve the integration by mailbox, enqueue the heavy work, 204 fast.
  try {
    const { getDb } = await import("../db");
    const { gmailIntegration } = await import("../../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      // DB down — let Pub/Sub retry later rather than silently dropping.
      log.error({}, "[gmailPush] DB unavailable — 500 so Pub/Sub retries");
      return res.status(500).send("db unavailable");
    }

    const [integration] = await db
      .select({ id: gmailIntegration.id, isActive: gmailIntegration.isActive })
      .from(gmailIntegration)
      .where(
        and(
          eq(gmailIntegration.emailAddress, notification.emailAddress),
          eq(gmailIntegration.isActive, 1),
        ),
      )
      .limit(1);

    if (!integration) {
      // Notification for a mailbox we don't (actively) track — ack + drop.
      log.info(
        { email: notification.emailAddress },
        "[gmailPush] no active integration for mailbox — acking + dropping",
      );
      return res.status(204).end();
    }

    const { gmailPushQueue } = await import("../queue");
    await gmailPushQueue.add(
      "push-notification",
      {
        integrationId: integration.id,
        notifiedHistoryId: notification.historyId,
        emailAddress: notification.emailAddress,
      },
      {
        // Collapse a burst for the same mailbox+historyId into one job — Pub/Sub
        // may deliver duplicates, and several notifications can fire in a tick.
        // The ingest is idempotent anyway, this just trims redundant runs.
        jobId: `push-${integration.id}-${notification.historyId}`,
      },
    );

    return res.status(204).end();
  } catch (e) {
    // Enqueue failed (Redis hiccup) — 500 so Pub/Sub retries; the poll also
    // backstops, so nothing is lost either way.
    log.error({ err: e }, "[gmailPush] enqueue failed — 500 for retry");
    return res.status(500).send("enqueue failed");
  }
}
