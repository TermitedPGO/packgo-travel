/**
 * tokenCrypto — generic AES-256-GCM symmetric encryption for secrets we
 * have to persist (OAuth refresh tokens, third-party API access tokens).
 *
 * 2026-05-15 — extracted from server/_core/plaid.ts so Gmail OAuth tokens
 * can use the same envelope. Per SECURITY_AUDIT_2026_05_14.md P1-1: Gmail
 * access + refresh tokens were stored plaintext in `gmailIntegration`,
 * while the parallel Plaid integration encrypted them. This module is
 * the shared substrate so both go through the same primitive.
 *
 * Format on disk (one base64 string):
 *
 *     "enc:v1:" + base64( iv(12) | authTag(16) | ciphertext )
 *
 * The `enc:v1:` prefix is the version sentinel — `decryptToken` looks
 * for it and falls back to returning the input as-is if absent. That
 * "fallback to plaintext" path is how we transparently roll forward
 * from a populated-but-plaintext column without a one-shot migration:
 * legacy rows continue to work, new writes are encrypted, and the next
 * OAuth refresh re-encrypts in place. Remove the fallback once you can
 * prove no legacy rows remain.
 *
 * The encryption key comes from `APP_ENCRYPTION_KEY` (preferred) or
 * `PLAID_ENCRYPTION_KEY` (backward-compat). 32 raw bytes, base64-encoded
 * in the env var. Generate via:
 *
 *     node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"
 */

import crypto from "crypto";

const ENC_ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION_PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer {
  // Prefer APP_ENCRYPTION_KEY; fall back to PLAID_ENCRYPTION_KEY so existing
  // Plaid-only deployments keep working without a new env var.
  const k = process.env.APP_ENCRYPTION_KEY ?? process.env.PLAID_ENCRYPTION_KEY;
  if (!k) {
    throw new Error(
      "APP_ENCRYPTION_KEY (or PLAID_ENCRYPTION_KEY) not set. Generate via: " +
        `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `Encryption key must decode to 32 bytes, got ${buf.length}. ` +
        "Regenerate with the snippet in the error above."
    );
  }
  return buf;
}

/**
 * Encrypt a string. Returns `enc:v1:<base64>` so callers can distinguish
 * encrypted vs plaintext stored values.
 */
export function encryptToken(plain: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    VERSION_PREFIX +
    Buffer.concat([iv, tag, encrypted]).toString("base64")
  );
}

/**
 * Decrypt a value previously written by `encryptToken`. Legacy plaintext
 * (no `enc:v1:` prefix) is returned as-is so partially-migrated tables
 * keep working.
 */
export function decryptToken(stored: string): string {
  if (!stored.startsWith(VERSION_PREFIX)) {
    // Legacy plaintext — return as-is. After backfill we should switch
    // to throwing here so a regression in encryption gets caught.
    return stored;
  }
  const key = getEncryptionKey();
  const buf = Buffer.from(stored.slice(VERSION_PREFIX.length), "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("[tokenCrypto] ciphertext is truncated/malformed");
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

/**
 * Quick predicate: is this value encrypted (vs legacy plaintext)?
 * Useful for diagnostics + one-off migration scripts.
 */
export function isEncrypted(stored: string): boolean {
  return typeof stored === "string" && stored.startsWith(VERSION_PREFIX);
}
