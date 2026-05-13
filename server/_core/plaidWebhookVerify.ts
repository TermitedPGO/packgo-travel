/**
 * Plaid webhook JWT signature verification.
 *
 * Plaid signs every webhook with an ES256 JWT placed in the
 * `plaid-verification` header. To verify:
 *
 *   1. Decode the JWT header to read `kid` (key id)
 *   2. Fetch the corresponding JWK public key from Plaid via
 *      `/webhook_verification_key/get` (or use a 24h in-memory cache)
 *   3. Verify the JWT's ES256 signature using that key
 *   4. Check the JWT's `request_body_sha256` claim matches SHA-256(raw body)
 *   5. Check the JWT's `iat` (issued-at) is within the last 5 minutes
 *      (Plaid's documented replay-attack window)
 *
 * Sandbox skip: Plaid does NOT sign sandbox webhooks (no `plaid-verification`
 * header). When PLAID_ENV=sandbox we skip verification entirely. In any
 * other env (development, production) verification is required.
 *
 * Reference: https://plaid.com/docs/api/webhooks/webhook-verification/
 */

import crypto from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";

// In-memory JWK cache. Plaid rotates these keys, but the cache TTL of 24h
// means we'll re-fetch at most once per day per kid. Each fetch is a single
// HTTPS call to Plaid; not expensive but pointless to do per webhook.
interface CachedKey {
  jwk: any;
  fetchedAtMs: number;
}
const KEY_CACHE = new Map<string, CachedKey>();
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Plaid's documented replay window for webhook JWTs.
const MAX_JWT_AGE_SECONDS = 5 * 60;

export interface VerifyOptions {
  /** The full raw body bytes that came in on the request. */
  rawBody: Buffer;
  /** The `plaid-verification` header value (the JWT). */
  jwt: string | undefined;
  /** Plaid env name from process.env.PLAID_ENV — controls skip behavior. */
  env: string;
  /**
   * Optional override for the JWK fetcher (used by tests). If unset we
   * lazy-import the Plaid SDK and call webhookVerificationKeyGet.
   */
  fetchJwk?: (keyId: string) => Promise<any>;
  /** Optional override for "now" to enable deterministic age tests. */
  nowMs?: number;
}

export interface VerifyResult {
  valid: boolean;
  /** Reason for rejection (only set when valid=false). */
  reason?: string;
  /** Whether the verification was skipped (sandbox). */
  skipped?: boolean;
  /** The kid we matched against (for logging). */
  kid?: string;
}

/**
 * Verify a Plaid webhook JWT. Returns { valid: true } if the request
 * should be accepted; { valid: false, reason } otherwise.
 */
export async function verifyPlaidWebhook(
  opts: VerifyOptions
): Promise<VerifyResult> {
  const env = (opts.env || "sandbox").toLowerCase();

  // Sandbox: Plaid doesn't sign these. Accept without verification.
  if (env === "sandbox") {
    return { valid: true, skipped: true };
  }

  // Non-sandbox: the JWT header is required.
  if (!opts.jwt || typeof opts.jwt !== "string") {
    return {
      valid: false,
      reason: "missing plaid-verification header",
    };
  }

  // 1. Decode the JWT header (no verification yet) to read `kid`.
  let kid: string | undefined;
  try {
    const header = decodeProtectedHeader(opts.jwt);
    if (header.alg !== "ES256") {
      return {
        valid: false,
        reason: `unexpected JWT algorithm ${header.alg}; want ES256`,
      };
    }
    kid = header.kid;
    if (!kid || typeof kid !== "string") {
      return { valid: false, reason: "JWT header missing kid" };
    }
  } catch (err) {
    return {
      valid: false,
      reason: `malformed JWT header: ${(err as Error)?.message ?? "unknown"}`,
    };
  }

  // 2. Fetch / load JWK from cache.
  let jwk: any;
  try {
    jwk = await loadJwk(kid, opts.fetchJwk);
  } catch (err) {
    return {
      valid: false,
      reason: `failed to load JWK for kid=${kid}: ${(err as Error)?.message}`,
      kid,
    };
  }

  // 3. Convert JWK to a key object usable by jose, then verify signature.
  let payload: Record<string, any>;
  try {
    const key = await importJWK(jwk, "ES256");
    const result = await jwtVerify(opts.jwt, key, {
      // Plaid issues without aud/iss claims, so we just check signature
      // + algorithm + freshness ourselves below.
      algorithms: ["ES256"],
    });
    payload = result.payload as Record<string, any>;
  } catch (err) {
    return {
      valid: false,
      reason: `JWT signature verification failed: ${(err as Error)?.message}`,
      kid,
    };
  }

  // 4. Compare body hash. Plaid puts a SHA-256 hex digest of the request
  //    body in the `request_body_sha256` claim.
  const expectedHash = String(payload.request_body_sha256 ?? "");
  if (!expectedHash) {
    return {
      valid: false,
      reason: "JWT payload missing request_body_sha256",
      kid,
    };
  }
  const actualHash = crypto
    .createHash("sha256")
    .update(opts.rawBody)
    .digest("hex");
  if (actualHash !== expectedHash) {
    return {
      valid: false,
      reason: "body SHA-256 mismatch (request tampered or replayed)",
      kid,
    };
  }

  // 5. Check JWT age. Plaid says reject if older than 5 min.
  const iat = Number(payload.iat ?? 0);
  if (!iat || Number.isNaN(iat)) {
    return { valid: false, reason: "JWT missing iat claim", kid };
  }
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const age = now - iat;
  if (age > MAX_JWT_AGE_SECONDS) {
    return {
      valid: false,
      reason: `JWT is ${age}s old; replay window is ${MAX_JWT_AGE_SECONDS}s`,
      kid,
    };
  }
  if (age < -60) {
    // 1 min clock-skew tolerance for future-dated JWTs
    return {
      valid: false,
      reason: `JWT iat ${iat} is ${-age}s in the future`,
      kid,
    };
  }

  return { valid: true, kid };
}

async function loadJwk(
  kid: string,
  override?: (keyId: string) => Promise<any>
): Promise<any> {
  const cached = KEY_CACHE.get(kid);
  if (cached && Date.now() - cached.fetchedAtMs < KEY_CACHE_TTL_MS) {
    return cached.jwk;
  }
  let jwk: any;
  if (override) {
    jwk = await override(kid);
  } else {
    // Lazy import the Plaid SDK so this module doesn't pull in plaid on
    // every cold start of unrelated code paths.
    const { getPlaidClient } = await import("./plaid");
    const client = getPlaidClient();
    const res = await client.webhookVerificationKeyGet({ key_id: kid });
    jwk = res.data.key;
  }
  KEY_CACHE.set(kid, { jwk, fetchedAtMs: Date.now() });
  return jwk;
}

/**
 * Test-only helper: clear the in-memory key cache between tests.
 */
export function _clearKeyCache(): void {
  KEY_CACHE.clear();
}
