/**
 * gmail-push (2026-06-29) — tests for verifyPushAuth, the OIDC gate that proves
 * an incoming /api/gmail/push request really came from Google's Pub/Sub.
 *
 * The verifier is INJECTED (a fake implementing verifyIdToken) so no network /
 * Google public-key fetch happens. We assert the four security decisions:
 *   - missing/non-Bearer header → reject
 *   - signature/audience failure (verifyIdToken throws) → reject
 *   - email_verified !== true → reject (forged-but-signed edge)
 *   - service-account mismatch → reject
 *   - all good → ok, returns the SA email
 *
 * gmail.ts is imported (for extractBearerToken via the SUT) so we keep the same
 * light mocks as the other gmail tests.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("googleapis", () => ({ google: {} }));
vi.mock("google-auth-library", () => ({ OAuth2Client: class {} }));
vi.mock("./env", () => ({ ENV: {} }));
vi.mock("./tokenCrypto", () => ({ decryptToken: (s: string) => s }));
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { verifyPushAuth, pushConfigError } from "./gmailPushWebhook";

/** A fake OAuth2Client.verifyIdToken. Returns a ticket whose getPayload() is
 *  the supplied claims, OR throws when `throwWith` is set (simulates a bad
 *  signature / audience mismatch / expired token). It also records the
 *  audience it was asked to enforce so we can assert it was passed through. */
function fakeVerifier(opts: {
  claims?: Record<string, unknown>;
  throwWith?: Error;
}) {
  const seen: { audience?: string } = {};
  return {
    seen,
    verifyIdToken: vi.fn(async ({ audience }: { audience?: string }) => {
      seen.audience = audience;
      if (opts.throwWith) throw opts.throwWith;
      return { getPayload: () => opts.claims };
    }),
  };
}

const SA = "gmail-push@packgo.iam.gserviceaccount.com";
const AUD = "https://packgoplay.com/api/gmail/push";

describe("verifyPushAuth", () => {
  it("rejects when the Authorization header is missing", async () => {
    const v = fakeVerifier({ claims: {} });
    const out = await verifyPushAuth(undefined, { verifier: v });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/missing bearer/i);
    expect(v.verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer scheme", async () => {
    const v = fakeVerifier({ claims: {} });
    const out = await verifyPushAuth("Basic abc", { verifier: v });
    expect(out.ok).toBe(false);
  });

  it("rejects when verifyIdToken throws (bad signature / aud mismatch / expired)", async () => {
    const v = fakeVerifier({ throwWith: new Error("Wrong recipient") });
    const out = await verifyPushAuth("Bearer tok", {
      expectedAudience: AUD,
      verifier: v,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/jwt verify failed/i);
  });

  it("passes the expected audience through to verifyIdToken", async () => {
    const v = fakeVerifier({
      claims: { email: SA, email_verified: true },
    });
    await verifyPushAuth("Bearer tok", {
      expectedAudience: AUD,
      verifier: v,
    });
    expect(v.seen.audience).toBe(AUD);
  });

  it("rejects when email_verified is not true (signed but untrusted)", async () => {
    const v = fakeVerifier({
      claims: { email: SA, email_verified: false },
    });
    const out = await verifyPushAuth("Bearer tok", {
      expectedAudience: AUD,
      expectedServiceAccount: SA,
      verifier: v,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/email_verified/);
  });

  it("rejects when the service account email does not match", async () => {
    const v = fakeVerifier({
      claims: { email: "attacker@evil.iam.gserviceaccount.com", email_verified: true },
    });
    const out = await verifyPushAuth("Bearer tok", {
      expectedAudience: AUD,
      expectedServiceAccount: SA,
      verifier: v,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/service account mismatch/i);
  });

  it("accepts a valid Google-signed token with matching SA + verified email", async () => {
    const v = fakeVerifier({
      claims: { email: SA, email_verified: true, aud: AUD },
    });
    const out = await verifyPushAuth("Bearer good.jwt.here", {
      expectedAudience: AUD,
      expectedServiceAccount: SA,
      verifier: v,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.email).toBe(SA);
  });

  it("primitive accepts when no SA is passed (SA check skipped) — enforcement of a configured SA lives in the handler's pushConfigError gate, not here", async () => {
    const v = fakeVerifier({
      claims: { email: SA, email_verified: true },
    });
    const out = await verifyPushAuth("Bearer tok", {
      expectedAudience: AUD,
      verifier: v,
    });
    expect(out.ok).toBe(true);
  });

  it("rejects an empty JWT payload", async () => {
    const v = fakeVerifier({ claims: undefined });
    const out = await verifyPushAuth("Bearer tok", {
      expectedAudience: AUD,
      verifier: v,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/empty jwt payload/i);
  });
});

describe("pushConfigError — fail-closed gate (handler refuses if unconfigured)", () => {
  it("passes only when BOTH audience and service account are set", () => {
    expect(pushConfigError(AUD, SA)).toBeNull();
  });
  it("rejects when the audience is unset (would skip the audience assertion)", () => {
    expect(pushConfigError(undefined, SA)).toMatch(/fail-closed/);
  });
  it("rejects when the service account is unset (would accept any GCP project's SA)", () => {
    expect(pushConfigError(AUD, undefined)).toMatch(/fail-closed/);
  });
  it("rejects when both are unset", () => {
    expect(pushConfigError(undefined, undefined)).toMatch(/fail-closed/);
  });
});
