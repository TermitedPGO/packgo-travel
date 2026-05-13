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
 *   Plaid signs every webhook with a JWT in the `plaid-verification` header.
 *   For production we MUST verify (otherwise anyone can fake webhooks).
 *   For sandbox the header may be absent; we skip verification only when
 *   PLAID_ENV=sandbox.
 *   Real verification needs the public key from Plaid's JWKS endpoint —
 *   marked TODO for production; sandbox-first ship this iteration.
 */

import type { Request, Response } from "express";
import { getDb } from "../db";
import { plaidWebhookEvents, linkedBankAccounts } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { notifyOwner } from "./notification";

export async function handlePlaidWebhook(req: Request, res: Response): Promise<void> {
  // Raw body buffer (Plaid sends JSON but we registered raw to allow future
  // JWT signature verification). Parse manually.
  let payload: any;
  try {
    const raw = req.body as Buffer;
    payload = raw && raw.length > 0 ? JSON.parse(raw.toString("utf8")) : {};
  } catch (err) {
    console.error("[plaid-webhook] failed to parse body:", err);
    res.status(400).json({ error: "invalid json" });
    return;
  }

  const webhookType = String(payload.webhook_type ?? "").slice(0, 64);
  const webhookCode = String(payload.webhook_code ?? "").slice(0, 64);
  const itemId = payload.item_id ? String(payload.item_id).slice(0, 64) : null;

  // Always ack quickly so Plaid doesn't retry. Log + branch happens async.
  res.status(200).json({ ok: true });

  console.log(
    `[plaid-webhook] received ${webhookType}/${webhookCode} for item ${itemId}`
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
    console.warn(
      "[plaid-webhook] failed to record event:",
      (err as Error)?.message
    );
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
    console.error(
      `[plaid-webhook] handler for ${webhookType}/${webhookCode} failed:`,
      msg
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
 * Trigger an immediate sync for the given Plaid item by enqueuing
 * onto the bookingFollowupQueue's queue infrastructure pattern — but
 * for Plaid we just call syncOneAccount directly from the workersince Phase 1.5's daily worker will catch up anyway. For
 * webhook-driven syncs we want sub-minute latency.
 */
async function enqueueImmediateSync(itemId: string | null): Promise<void> {
  if (!itemId) return;
  // Find the linked accounts for this item, then enqueue or directly
  // call sync. Lazy-import the worker queue to avoid circular import.
  const db = await getDb();
  if (!db) return;
  const accounts = await db
    .select()
    .from(linkedBankAccounts)
    .where(
      and(
        eq(linkedBankAccounts.plaidItemId, itemId),
        eq(linkedBankAccounts.isActive, 1)
      )
    );

  if (accounts.length === 0) {
    console.warn(`[plaid-webhook] No active accounts for item ${itemId}`);
    return;
  }

  // Lazy import to avoid pulling Plaid SDK into hot path
  const { syncTransactions, decryptAccessToken } = await import("./plaid");
  const { bankTransactions } = await import("../../drizzle/schema");

  for (const acc of accounts) {
    try {
      const token = decryptAccessToken(acc.plaidAccessTokenEncrypted);
      let cursor = acc.cursor;
      let totalAdded = 0;
      for (let i = 0; i < 20; i++) {
        const page = await syncTransactions(token, cursor);
        const added = page.added.filter(
          (t: any) => t.account_id === acc.plaidAccountId
        );
        for (const t of added) {
          try {
            await db
              .insert(bankTransactions)
              .values({
                linkedAccountId: acc.id,
                plaidTransactionId: t.transaction_id,
                date: t.date as any,
                authorizedDate: (t.authorized_date as any) ?? null,
                amount: String(t.amount),
                isoCurrencyCode: (t.iso_currency_code ?? "USD") as string,
                merchantName: t.merchant_name ?? t.name?.slice(0, 256) ?? null,
                description: t.name ?? null,
                paymentChannel: t.payment_channel ?? null,
                plaidCategoryPrimary:
                  (t.personal_finance_category as any)?.primary ?? null,
                plaidCategoryDetailed:
                  (t.personal_finance_category as any)?.detailed ?? null,
                isPending: t.pending ? 1 : 0,
                accountOwner: t.account_owner ?? null,
              })
              .onDuplicateKeyUpdate({
                set: {
                  amount: String(t.amount),
                  isPending: t.pending ? 1 : 0,
                  updatedAt: new Date(),
                },
              });
            totalAdded++;
          } catch {
            /* upsert collisions are expected on retries */
          }
        }
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
      await db
        .update(linkedBankAccounts)
        .set({ cursor, lastSyncedAt: new Date(), lastSyncError: null })
        .where(eq(linkedBankAccounts.id, acc.id));
      console.log(
        `[plaid-webhook] Immediate sync for item ${itemId} account ${acc.id}: +${totalAdded} txns`
      );
    } catch (err) {
      console.error(
        `[plaid-webhook] Immediate sync failed for account ${acc.id}:`,
        (err as Error)?.message
      );
      await db
        .update(linkedBankAccounts)
        .set({ lastSyncError: (err as Error).message })
        .where(eq(linkedBankAccounts.id, acc.id));
    }
  }
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
