/**
 * Unit tests for plaidWebhookVerify.ts.
 *
 * Covers:
 *   - sandbox env short-circuits to valid+skipped
 *   - missing header → invalid in production env
 *   - malformed JWT → invalid
 *   - wrong algorithm (HS256 instead of ES256) → invalid
 *   - tampered body (hash mismatch) → invalid
 *   - JWT older than 5 min → invalid
 *   - future-dated JWT (clock skew) → invalid
 *   - valid signed JWT + correct body hash → valid
 *
 * We generate a fresh ES256 keypair per test, sign a JWT with it, and
 * pass the matching public JWK via the `fetchJwk` override so we never
 * hit Plaid's real endpoint.
 */

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { SignJWT, exportJWK } from "jose";
import { verifyPlaidWebhook, _clearKeyCache } from "./plaidWebhookVerify";

async function makeTestKey() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-kid-1";
  publicJwk.alg = "ES256";
  return { publicKey, privateKey, publicJwk };
}

async function signTestJwt(opts: {
  privateKey: CryptoKey;
  rawBody: Buffer;
  iatOverrideSec?: number;
  kid?: string;
}): Promise<string> {
  const hash = crypto.createHash("sha256").update(opts.rawBody).digest("hex");
  return await new SignJWT({ request_body_sha256: hash })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "test-kid-1", typ: "JWT" })
    .setIssuedAt(opts.iatOverrideSec)
    .sign(opts.privateKey);
}

describe("verifyPlaidWebhook", () => {
  beforeEach(() => {
    _clearKeyCache();
  });

  it("sandbox env: skips verification even with no header", async () => {
    const result = await verifyPlaidWebhook({
      rawBody: Buffer.from(`{"webhook_type":"TRANSACTIONS"}`),
      jwt: undefined,
      env: "sandbox",
    });
    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("sandbox env: same skip when header IS present (still accepted)", async () => {
    const result = await verifyPlaidWebhook({
      rawBody: Buffer.from(`{}`),
      jwt: "this.does.notmatter",
      env: "sandbox",
    });
    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("production env: missing header → invalid", async () => {
    const result = await verifyPlaidWebhook({
      rawBody: Buffer.from(`{}`),
      jwt: undefined,
      env: "production",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing plaid-verification header");
  });

  it("production env: malformed JWT → invalid", async () => {
    const result = await verifyPlaidWebhook({
      rawBody: Buffer.from(`{}`),
      jwt: "not.a.jwt",
      env: "production",
    });
    expect(result.valid).toBe(false);
    // jose throws on malformed JWT during decodeProtectedHeader or jwtVerify;
    // either path produces a reason
    expect(result.reason).toBeTruthy();
  });

  it("production env: HS256 instead of ES256 → invalid", async () => {
    // Sign with HS256 — wrong algorithm
    const secret = new TextEncoder().encode("secret-for-test-only");
    const body = Buffer.from(`{"webhook_type":"TRANSACTIONS"}`);
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    const jwt = await new SignJWT({ request_body_sha256: hash })
      .setProtectedHeader({ alg: "HS256", kid: "test-kid-1" })
      .setIssuedAt()
      .sign(secret);

    const result = await verifyPlaidWebhook({
      rawBody: body,
      jwt,
      env: "production",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("unexpected JWT algorithm HS256");
  });

  it("production env: wrong signing key → invalid", async () => {
    const real = await makeTestKey();
    const decoy = await makeTestKey();
    const body = Buffer.from(`{"webhook_type":"TRANSACTIONS"}`);

    // Sign with REAL private key
    const jwt = await signTestJwt({ privateKey: real.privateKey, rawBody: body });

    // But hand the verifier the DECOY public key
    const result = await verifyPlaidWebhook({
      rawBody: body,
      jwt,
      env: "production",
      fetchJwk: async () => decoy.publicJwk,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("signature verification failed");
  });

  it("production env: tampered body (hash mismatch) → invalid", async () => {
    const { privateKey, publicJwk } = await makeTestKey();
    const originalBody = Buffer.from(`{"webhook_type":"TRANSACTIONS"}`);
    const jwt = await signTestJwt({ privateKey, rawBody: originalBody });
    // Pretend the body got swapped in transit
    const tamperedBody = Buffer.from(`{"webhook_type":"FAKE_INJECTED"}`);

    const result = await verifyPlaidWebhook({
      rawBody: tamperedBody,
      jwt,
      env: "production",
      fetchJwk: async () => publicJwk,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("body SHA-256 mismatch");
  });

  it("production env: JWT older than 5 min → invalid (replay protection)", async () => {
    const { privateKey, publicJwk } = await makeTestKey();
    const body = Buffer.from(`{"webhook_type":"TRANSACTIONS"}`);
    const tenMinAgo = Math.floor(Date.now() / 1000) - 600;
    const jwt = await signTestJwt({
      privateKey,
      rawBody: body,
      iatOverrideSec: tenMinAgo,
    });

    const result = await verifyPlaidWebhook({
      rawBody: body,
      jwt,
      env: "production",
      fetchJwk: async () => publicJwk,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/JWT is \d+s old/);
  });

  it("production env: future-dated JWT (clock skew > 1min) → invalid", async () => {
    const { privateKey, publicJwk } = await makeTestKey();
    const body = Buffer.from(`{}`);
    const fiveMinFromNow = Math.floor(Date.now() / 1000) + 300;
    const jwt = await signTestJwt({
      privateKey,
      rawBody: body,
      iatOverrideSec: fiveMinFromNow,
    });

    const result = await verifyPlaidWebhook({
      rawBody: body,
      jwt,
      env: "production",
      fetchJwk: async () => publicJwk,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("in the future");
  });

  it("production env: valid signed JWT + correct hash + fresh iat → VALID", async () => {
    const { privateKey, publicJwk } = await makeTestKey();
    const body = Buffer.from(`{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}`);
    const jwt = await signTestJwt({ privateKey, rawBody: body });

    const result = await verifyPlaidWebhook({
      rawBody: body,
      jwt,
      env: "production",
      fetchJwk: async () => publicJwk,
    });
    expect(result.valid).toBe(true);
    expect(result.skipped).toBeFalsy();
    expect(result.kid).toBe("test-kid-1");
  });

  it("development env: same strict verification as production", async () => {
    // Verify that any non-sandbox env (e.g. 'development') goes through
    // the same path as production. Plaid signs dev webhooks the same way.
    const { privateKey, publicJwk } = await makeTestKey();
    const body = Buffer.from(`{}`);
    const jwt = await signTestJwt({ privateKey, rawBody: body });

    const result = await verifyPlaidWebhook({
      rawBody: body,
      jwt,
      env: "development",
      fetchJwk: async () => publicJwk,
    });
    expect(result.valid).toBe(true);
  });

  it("key cache: second call with same kid does NOT re-fetch", async () => {
    const { privateKey, publicJwk } = await makeTestKey();
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount++;
      return publicJwk;
    };

    const body = Buffer.from(`{}`);
    const jwt1 = await signTestJwt({ privateKey, rawBody: body });

    await verifyPlaidWebhook({ rawBody: body, jwt: jwt1, env: "production", fetchJwk: fetcher });
    await verifyPlaidWebhook({ rawBody: body, jwt: jwt1, env: "production", fetchJwk: fetcher });
    await verifyPlaidWebhook({ rawBody: body, jwt: jwt1, env: "production", fetchJwk: fetcher });

    expect(fetchCount).toBe(1);
  });
});
