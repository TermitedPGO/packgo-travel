/**
 * Plaid webhook receiver (Phase 1.4).
 *
 * Mounted at POST /api/plaid/webhook BEFORE express.json() so we have
 * raw body for signature verification.
 *
 * Plaid sends webhooks for:
 *   TRANSACTIONS / SYNC_UPDATES_AVAILABLE  → new txns ready to pull
 *   TRANSACTIONS / INITIAL_UPDATE          → initial 30-day sync done
 *   TRANSACTIONS / HISTORICAL_UPDATE       → full history backfill done
 *   TRANSACTIONS / DEFAULT_UPDATE          → new txns during steady-state
 *   TRANSACTIONS / TRANSACTIONS_REMOVED    → some txns were reversed
 *   ITEM         / ERROR                   → login required / etc.
 *   ITEM         / PENDING_EXPIRATION      → access token will expire soon
 *   ITEM         / USER_PERMISSION_REVOKED → user pulled the plug
 *
 * Our response strategy:
 *   - Always 200 OK fast (< 1s). Heavy work happens async.
 *   - Record every event in plaidWebhookEvents for audit trail.
 *   - SYNC_UPDATES_AVAILABLE → enqueue immediate sync for that item.
 *   - ITEM errors → notifyOwner so Jeff knows to re-link.
 *
 * Signature verification:
 *   Plaid signs every production webhook with an ES256 JWT in the
 *   `plaid-verification` header. See plaidWebhookVerify.ts for the
 *   full implementation. Sandbox webhooks are NOT signed; we skip
 *   verification only when PLAID_ENV=sandbox. Any other env requires
 *   a valid signature or we 400 the request and do NOT record it.
 */

import type { Request, Response } from "express";
import { getDb } from "../db";
import { plaidWebhookEvents, linkedBankAccounts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "./notification";
import { verifyPlaidWebhook } from "./plaidWebhookVerify";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "plaidWebhook" });

export async function handlePlaidWebhook(req: Request, res: Response): Promise<void> {
  const rawBody: Buffer = (req.body as Buffer) ?? Buffer.alloc(0);

  // ─── Signature verification ─────────────────────────────────────────────
  // Done BEFORE we parse or persist anything. If verification fails we
  // reject with 400 and do NOT record the event (no audit-log pollution,
  // no work for downstream handlers). Sandbox env short-circuits to
  // "valid" since Plaid doesn't sign sandbox webhooks.
  const jwtHeader = req.headers["plaid-verification"];
  const verifyResult = await verifyPlaidWebhook({
    rawBody,
    jwt: Array.isArray(jwtHeader) ? jwtHeader[0] : jwtHeader,
    env: process.env.PLAID_ENV ?? "sandbox",
  });
  if (!verifyResult.valid) {
    log.warn(
      { reason: verifyResult.reason, kid: verifyResult.kid ?? null },
      "[plaid-webhook] rejected unverified request",
    );
    res.status(400).json({ error: "webhook verification failed" });
    return;
  }
  if (verifyResult.skipped) {
    // Sandbox path — no log spam needed for the normal case.
  }

  // ─── Parse body ─────────────────────────────────────────────────────────
  let payload: any;
  try {
    payload = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch (err) {
    log.error({ err }, "[plaid-webhook] failed to parse body");
    res.status(400).json({ error: "invalid json" });
    return;
  }

  const webhookType = String(payload.webhook_type ?? "").slice(0, 64);
  const webhookCode = String(payload.webhook_code ?? "").slice(0, 64);
  const itemId = payload.item_id ? String(payload.item_id).slice(0, 64) : null;

  // Always ack quickly so Plaid doesn't retry. Log + branch happens async.
  res.status(200).json({ ok: true });

  log.info(
    { webhookType, webhookCode, itemId },
    "[plaid-webhook] received",
  );

  // Persist event for audit trail. Best-effort — webhook ack doesn't depend
  // on this succeeding.
  let eventId: number | null = null;
  try {
    const db = await getDb();
    if (db) {
      const ins: any = await db.insert(plaidWebhookEvents).values({
        webhookType,
        webhookCode,
        plaidItemId: itemId,
        payload: JSON.stringify(payload).slice(0, 50_000),
      });
      eventId = Number(ins?.[0]?.insertId ?? 0) || null;
    }
  } catch (err) {
    log.warn({ err }, "[plaid-webhook] failed to record event");
  }

  // Branch on webhook type → actions
  try {
    if (webhookType === "TRANSACTIONS") {
      if (
        webhookCode === "SYNC_UPDATES_AVAILABLE" ||
        webhookCode === "DEFAULT_UPDATE" ||
        webhookCode === "INITIAL_UPDATE" ||
        webhookCode === "HISTORICAL_UPDATE"
      ) {
        await enqueueImmediateSync(itemId);
      } else if (webhookCode === "TRANSACTIONS_REMOVED") {
        // Will be picked up on next /transactions/sync call as `removed`
        // entries. No urgent action needed.
        await enqueueImmediateSync(itemId);
      }
    } else if (webhookType === "ITEM") {
      if (webhookCode === "ERROR") {
        await handleItemError(itemId, payload);
      } else if (webhookCode === "PENDING_EXPIRATION") {
        await notifyOwner({
          title: "⚠️ Plaid 連線即將過期",
          content:
            `Plaid item ${itemId} 的 access_token 即將過期。` +
            `請在 7 天內到 admin → 財務 → 銀行帳戶 重新連線。`,
        });
      } else if (webhookCode === "USER_PERMISSION_REVOKED") {
        await handlePermissionRevoked(itemId);
      } else if (webhookCode === "LOGIN_REPAIRED") {
        // Good news — user re-authed; clear any stored sync error
        await clearSyncError(itemId);
      }
    } else if (webhookType === "LINK") {
      // Hosted Link completed — exchange the public_tokens from the session.
      // Payload contains:
      //   link_session_id, link_token, public_tokens (array), status
      if (webhookCode === "SESSION_FINISHED" || webhookCode === "EVENTS") {
        await handleHostedLinkSessionFinished(payload);
      }
    }

    // Mark event as processed
    if (eventId !== null) {
      const db = await getDb();
      if (db) {
        await db
          .update(plaidWebhookEvents)
          .set({
            processedAt: new Date(),
            processedSuccess: 1,
          })
          .where(eq(plaidWebhookEvents.id, eventId));
      }
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? "unknown";
    log.error(
      { err, webhookType, webhookCode },
      "[plaid-webhook] handler failed",
    );
    if (eventId !== null) {
      const db = await getDb();
      if (db) {
        await db
          .update(plaidWebhookEvents)
          .set({
            processedAt: new Date(),
            processedSuccess: 0,
            processedError: msg,
          })
          .where(eq(plaidWebhookEvents.id, eventId));
      }
    }
  }
}

/**
 * Trigger an immediate sync for the given Plaid item.
 *
 * Phase 1.5 refactor: delegates to the shared plaidSyncService so the
 * webhook hot path, the daily cron worker, and the admin "Sync now"
 * button all funnel through one tested code path.
 */
async function enqueueImmediateSync(itemId: string | null): Promise<void> {
  if (!itemId) return;
  const { syncAllAccountsForItem } = await import(
    "../services/plaidSyncService"
  );
  const result = await syncAllAccountsForItem(itemId);
  log.info(
    {
      itemId,
      accounts: result.perAccount.length,
      added: result.totalAdded,
      failedAccounts: result.failedAccounts,
    },
    "[plaid-webhook] item sync complete",
  );
}

async function handleItemError(
  itemId: string | null,
  payload: any
): Promise<void> {
  if (!itemId) return;
  const errorCode = payload?.error?.error_code ?? "UNKNOWN";
  const errorMessage = payload?.error?.error_message ?? "";

  const db = await getDb();
  if (db) {
    await db
      .update(linkedBankAccounts)
      .set({ lastSyncError: `[${errorCode}] ${errorMessage}` })
      .where(eq(linkedBankAccounts.plaidItemId, itemId));
  }

  await notifyOwner({
    title: `⚠️ Plaid 連線錯誤 — ${errorCode}`,
    content:
      `Plaid item ${itemId} 出現錯誤,無法同步交易。\n\n` +
      `錯誤代碼: ${errorCode}\n錯誤訊息: ${errorMessage}\n\n` +
      `常見原因:\n` +
      `- ITEM_LOGIN_REQUIRED → 銀行密碼改了,進 admin → 財務 → 銀行帳戶 重新連\n` +
      `- INVALID_CREDENTIALS → 同上\n` +
      `- ITEM_LOCKED → 銀行帳號被鎖,先登入銀行 app 解鎖再回來重連`,
  });
}

async function handlePermissionRevoked(itemId: string | null): Promise<void> {
  if (!itemId) return;
  const db = await getDb();
  if (db) {
    await db
      .update(linkedBankAccounts)
      .set({
        isActive: 0,
        lastSyncError: "USER_PERMISSION_REVOKED",
      })
      .where(eq(linkedBankAccounts.plaidItemId, itemId));
  }
  await notifyOwner({
    title: "⚠️ Plaid 連線已被撤銷",
    content:
      `Plaid item ${itemId} 的使用者授權已被撤銷(可能你或銀行端取消了授權)。\n\n` +
      `連線已停用。如需繼續同步,請到 admin → 財務 → 銀行帳戶 重新連線。`,
  });
}

async function clearSyncError(itemId: string | null): Promise<void> {
  if (!itemId) return;
  const db = await getDb();
  if (db) {
    await db
      .update(linkedBankAccounts)
      .set({ lastSyncError: null })
      .where(eq(linkedBankAccounts.plaidItemId, itemId));
  }
}

/**
 * Handle LINK / SESSION_FINISHED webhook for Hosted Link.
 *
 * Plaid sends this after the user completes the Hosted Link flow. The payload
 * contains either:
 *   - public_tokens: [...] inline (newer API)
 *   - link_token: "..." — we then call /link/token/get to retrieve tokens
 *
 * We exchange each public_token for an access_token, persist a row in
 * linkedBankAccounts (per account under the item), and run an initial sync.
 *
 * Idempotency: linkedBankAccounts has UNIQUE(plaidAccountId) so re-runs of
 * the same SESSION_FINISHED webhook hit the duplicate-key path and skip.
 */
async function handleHostedLinkSessionFinished(payload: any): Promise<void> {
  log.info(
    { linkSession: payload?.link_session_id, status: payload?.status },
    "[plaid-webhook] LINK/SESSION_FINISHED",
  );

  // Pull public_tokens from inline payload first
  let publicTokens: string[] = [];
  if (Array.isArray(payload?.public_tokens)) {
    publicTokens = payload.public_tokens.filter(
      (t: any) => typeof t === "string"
    );
  }

  // Fallback: if not inline, fetch via /link/token/get
  if (publicTokens.length === 0 && payload?.link_token) {
    try {
      const { getLinkSessionPublicTokens } = await import("./plaid");
      publicTokens = await getLinkSessionPublicTokens(payload.link_token);
      log.info(
        { count: publicTokens.length },
        "[plaid-webhook] fetched public_tokens via linkTokenGet",
      );
    } catch (err) {
      log.error({ err }, "[plaid-webhook] linkTokenGet failed");
    }
  }

  if (publicTokens.length === 0) {
    log.warn(
      "[plaid-webhook] SESSION_FINISHED but no public_tokens — user may have abandoned flow",
    );
    return;
  }

  // Find Jeff's userId — Hosted Link sessions can land for any user, but in
  // PACK&GO we only have one admin. Look him up by role='admin' as a sane
  // default; if you ever have multiple admins, we'd need to pass userId
  // through the link_token client_user_id and read it back.
  const db = await getDb();
  if (!db) return;
  const { users } = await import("../../drizzle/schema");
  const [adminUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);
  if (!adminUser) {
    log.error(
      "[plaid-webhook] no admin user found; cannot attribute Hosted Link result",
    );
    return;
  }

  // Exchange each public_token and persist
  const {
    exchangePublicToken,
    listAccounts,
    getInstitutionByItem,
    encryptAccessToken,
  } = await import("./plaid");
  const { linkedBankAccounts } = await import("../../drizzle/schema");

  for (const publicToken of publicTokens) {
    try {
      const { accessToken, itemId: newItemId } =
        await exchangePublicToken(publicToken);
      const encrypted = encryptAccessToken(accessToken);
      const [accountsRes, institution] = await Promise.all([
        listAccounts(accessToken),
        getInstitutionByItem(accessToken),
      ]);

      // Map Plaid account.type to our 5-value enum, falling back to
      // "other" for anything we don't recognize. Plaid occasionally
      // returns "brokerage" or "payroll" which aren't in our schema —
      // bucketing them as "other" is fine for bookkeeping (Jeff can
      // re-classify via override if needed).
      const KNOWN_TYPES = new Set([
        "depository",
        "credit",
        "loan",
        "investment",
        "other",
      ]);

      const insertedIds: number[] = [];
      for (const a of accountsRes.accounts) {
        const rawType = String(a.type ?? "other");
        const accountType = (
          KNOWN_TYPES.has(rawType) ? rawType : "other"
        ) as "depository" | "credit" | "loan" | "investment" | "other";

        try {
          const ins: any = await db.insert(linkedBankAccounts).values({
            userId: adminUser.id,
            plaidItemId: newItemId,
            plaidAccountId: a.account_id,
            plaidAccessTokenEncrypted: encrypted,
            plaidInstitutionId: institution?.institution_id ?? null,
            institutionName:
              institution?.name ?? a.name?.slice(0, 128) ?? "Bank",
            institutionLogoUrl: institution?.logo
              ? `data:image/png;base64,${institution.logo}`
              : null,
            accountMask: a.mask ?? null,
            accountName: (a.name ?? "Account").slice(0, 128),
            accountOfficialName: a.official_name?.slice(0, 256) ?? null,
            accountType,
            accountSubtype: a.subtype ? String(a.subtype).slice(0, 32) : null,
            currentBalance:
              a.balances.current != null ? String(a.balances.current) : null,
            availableBalance:
              a.balances.available != null
                ? String(a.balances.available)
                : null,
            isoCurrencyCode: a.balances.iso_currency_code ?? "USD",
          });
          const newId = Number(ins?.[0]?.insertId ?? 0);
          if (newId > 0) insertedIds.push(newId);
        } catch (err) {
          const e = err as any;
          const msg = e?.message ?? "";
          const code = e?.code ?? e?.cause?.code ?? "";
          const sqlState = e?.sqlState ?? e?.cause?.sqlState ?? "";
          const fullMsg = `${msg} | code=${code} sqlState=${sqlState} | type=${rawType} subtype=${a.subtype}`;
          if (!msg.toLowerCase().includes("duplicate")) {
            log.error(
              { err: e, accountId: a.account_id, fullMsg },
              "[plaid-webhook] Hosted Link insert account failed",
            );
          }
        }
      }

      // Initial sync via shared service
      if (insertedIds.length > 0) {
        const { syncOneLinkedAccount } = await import(
          "../services/plaidSyncService"
        );
        for (const id of insertedIds) {
          const [row] = await db
            .select()
            .from(linkedBankAccounts)
            .where(eq(linkedBankAccounts.id, id))
            .limit(1);
          if (row) {
            const r = await syncOneLinkedAccount({
              id: row.id,
              plaidAccountId: row.plaidAccountId,
              plaidAccessTokenEncrypted: row.plaidAccessTokenEncrypted,
              cursor: row.cursor,
            });
            log.info(
              { id, added: r.added, error: r.error ?? null },
              "[plaid-webhook] Hosted Link initial sync",
            );
          }
        }
      }

      await notifyOwner({
        title: `✅ Plaid 連線成功 — ${institution?.name ?? "新銀行"}`,
        content:
          `透過 Hosted Link 連結了 ${accountsRes.accounts.length} 個帳戶。\n\n` +
          accountsRes.accounts
            .map((a) => `- ${a.name} (${a.subtype ?? a.type})`)
            .join("\n") +
          `\n\n進 admin → 財務 → 銀行帳戶 確認交易已抓進來。`,
      });
    } catch (err) {
      log.error({ err }, "[plaid-webhook] Hosted Link exchange failed");
    }
  }
}
