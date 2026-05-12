/**
 * Plaid integration wrapper for PACK&GO LLC bookkeeping (Phase 1).
 *
 * Architecture:
 *   1. Frontend calls accounting.createLinkToken → we mint a Plaid Link token
 *   2. Frontend launches Plaid Link (popup OAuth) using the token
 *   3. On success, Plaid returns a public_token to the frontend
 *   4. Frontend calls accounting.exchangePublicToken with public_token
 *   5. Server exchanges it for an access_token + item_id (long-lived)
 *   6. We persist the access_token AES-256-GCM encrypted to MySQL
 *   7. Daily worker calls /transactions/sync using each Item's cursor to
 *      pull new transactions incrementally
 *   8. Plaid webhooks fire on TRANSACTIONS_REMOVED / ITEM_LOGIN_REQUIRED /
 *      etc. and we record them in plaidWebhookEvents for follow-up
 *
 * Security:
 *   - access_token NEVER stored in plain text. AES-256-GCM at rest.
 *   - Encryption key from env PLAID_ENCRYPTION_KEY (32-byte base64-encoded).
 *     Generate once via `node -e "console.log(require('crypto').
 *     randomBytes(32).toString('base64'))"` and set as Fly secret.
 *   - Webhook verifier (Plaid signs JWT in webhook-verification header).
 *
 * Env required:
 *   PLAID_CLIENT_ID         — from Plaid dashboard → Team Settings → Keys
 *   PLAID_SECRET            — same page, environment-specific
 *   PLAID_ENV               — "sandbox" | "development" | "production"
 *   PLAID_ENCRYPTION_KEY    — 32 bytes, base64 encoded
 *   PLAID_WEBHOOK_URL       — optional, public URL to receive webhooks
 *                             (e.g. https://packgoplay.com/api/plaid/webhook)
 */

import crypto from "node:crypto";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type LinkTokenCreateRequest,
  type Transaction,
  type RemovedTransaction,
} from "plaid";

// ─── Configuration ────────────────────────────────────────────────────────

function getPlaidEnv(): keyof typeof PlaidEnvironments {
  const e = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  if (e === "sandbox" || e === "development" || e === "production") return e;
  console.warn(`[plaid] unknown PLAID_ENV "${e}", defaulting to sandbox`);
  return "sandbox";
}

let cachedClient: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (cachedClient) return cachedClient;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Plaid not configured: set PLAID_CLIENT_ID + PLAID_SECRET. " +
        "Sandbox keys are free at https://dashboard.plaid.com/team/keys"
    );
  }
  const env = getPlaidEnv();
  const cfg = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  cachedClient = new PlaidApi(cfg);
  console.log(`[plaid] Client initialized (env=${env})`);
  return cachedClient;
}

export function plaidIsConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

// ─── AES-256-GCM encryption for access tokens ──────────────────────────────
//
// Standard envelope: iv (12 bytes) | authTag (16 bytes) | ciphertext.
// Base64 encoded for storage in a TEXT column.

const ENC_ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getEncryptionKey(): Buffer {
  const k = process.env.PLAID_ENCRYPTION_KEY;
  if (!k) {
    throw new Error(
      "PLAID_ENCRYPTION_KEY not set. Generate via: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `PLAID_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}. ` +
        "Regenerate with the snippet in the error above."
    );
  }
  return buf;
}

export function encryptAccessToken(plain: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptAccessToken(encoded: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("[plaid] encrypted access token is truncated/malformed");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ENC_ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

// ─── High-level helpers (used by tRPC procedures + worker) ─────────────────

/**
 * Mint a link_token for the frontend Plaid Link component.
 * The frontend uses this in <PlaidLink token={...}> to open the OAuth modal.
 */
export async function createLinkToken(userId: number): Promise<string> {
  const client = getPlaidClient();
  const request: LinkTokenCreateRequest = {
    user: { client_user_id: String(userId) },
    client_name: "PACK&GO Travel",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  };
  if (process.env.PLAID_WEBHOOK_URL) {
    request.webhook = process.env.PLAID_WEBHOOK_URL;
  }
  const res = await client.linkTokenCreate(request);
  return res.data.link_token;
}

/**
 * Exchange a public_token (returned from frontend Plaid Link onSuccess) for
 * a long-lived access_token + item_id. Caller is responsible for persisting
 * the encrypted access_token in linkedBankAccounts.
 */
export async function exchangePublicToken(publicToken: string): Promise<{
  accessToken: string;
  itemId: string;
}> {
  const client = getPlaidClient();
  const res = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return {
    accessToken: res.data.access_token,
    itemId: res.data.item_id,
  };
}

/**
 * Fetch accounts under a Plaid Item (a single bank login). Used right after
 * exchangePublicToken to enumerate which accounts the user shared.
 */
export async function listAccounts(accessTokenPlain: string) {
  const client = getPlaidClient();
  const res = await client.accountsGet({ access_token: accessTokenPlain });
  return {
    item: res.data.item,
    accounts: res.data.accounts,
  };
}

/**
 * Get the institution metadata (name, logo) for an Item. Useful to display
 * "Chase" or "Bank of America" in the linked-accounts list.
 */
export async function getInstitutionByItem(accessTokenPlain: string) {
  const client = getPlaidClient();
  const itemRes = await client.itemGet({ access_token: accessTokenPlain });
  const institutionId = itemRes.data.item.institution_id;
  if (!institutionId) return null;
  const instRes = await client.institutionsGetById({
    institution_id: institutionId,
    country_codes: [CountryCode.Us],
    options: { include_optional_metadata: true },
  });
  return instRes.data.institution;
}

/**
 * Incremental transaction sync using Plaid's /transactions/sync endpoint.
 * Pass the previous cursor (or undefined for first call). Returns added /
 * modified / removed transactions and a new cursor to store.
 *
 * Plaid handles pagination — keep calling until has_more=false.
 */
export async function syncTransactions(
  accessTokenPlain: string,
  cursor?: string | null
): Promise<{
  added: Transaction[];
  modified: Transaction[];
  removed: RemovedTransaction[];
  nextCursor: string;
  hasMore: boolean;
}> {
  const client = getPlaidClient();
  const res = await client.transactionsSync({
    access_token: accessTokenPlain,
    cursor: cursor ?? undefined,
  });
  return {
    added: res.data.added,
    modified: res.data.modified,
    removed: res.data.removed,
    nextCursor: res.data.next_cursor,
    hasMore: res.data.has_more,
  };
}

/**
 * Detach a Plaid Item. Use when Jeff disconnects an account from the admin UI.
 */
export async function removeItem(accessTokenPlain: string): Promise<void> {
  const client = getPlaidClient();
  await client.itemRemove({ access_token: accessTokenPlain });
}
