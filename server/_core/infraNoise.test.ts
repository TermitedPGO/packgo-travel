// Unit tests for the shared infra-noise filter (server/_core/infraNoise.ts).
// This is the fix for the 2026-07 review finding: the tRPC onError noise
// gate originally only filtered EPIPE/ECONNRESET and missed the
// LLM_RATE_LIMITED/LLM_CIRCUIT_OPEN/LLM_TIMEOUT/lock-renew signals that
// sentry.ts already filtered — these tests pin down that both code-based
// (.code/.rateLimited/.circuitOpen) and message-substring detection work,
// and that real errors are NOT falsely classified as noise.
import { describe, it, expect } from "vitest";
import { isKnownInfraNoise, INFRA_NOISE_MESSAGE_SUBSTRINGS } from "./infraNoise";

describe("isKnownInfraNoise", () => {
  it("detects EPIPE / ECONNRESET via .code", () => {
    expect(isKnownInfraNoise(Object.assign(new Error("boom"), { code: "EPIPE" }))).toBe(true);
    expect(isKnownInfraNoise(Object.assign(new Error("boom"), { code: "ECONNRESET" }))).toBe(true);
  });

  it("detects LLM rate-limit / circuit-open via boolean flags (llm.ts shape — no .code)", () => {
    const rateLimited = Object.assign(new Error("LLM_RATE_LIMITED: Anthropic rate limit sustained"), {
      rateLimited: true,
      nonRetryable: true,
    });
    const circuitOpen = Object.assign(new Error("LLM_CIRCUIT_OPEN: Anthropic API circuit is open"), {
      circuitOpen: true,
      nonRetryable: true,
    });
    expect(isKnownInfraNoise(rateLimited)).toBe(true);
    expect(isKnownInfraNoise(circuitOpen)).toBe(true);
  });

  it("detects every known message substring even without a matching flag", () => {
    for (const substr of INFRA_NOISE_MESSAGE_SUBSTRINGS) {
      const err = new Error(`prefix ${substr} suffix`);
      expect(isKnownInfraNoise(err)).toBe(true);
    }
  });

  it("detects LLM_TIMEOUT even though the elapsed-ms suffix varies run to run", () => {
    const t1 = new Error("LLM_TIMEOUT: Anthropic API did not respond within 120s (elapsed: 120004ms)");
    const t2 = new Error("LLM_TIMEOUT: Anthropic API did not respond within 120s (elapsed: 120891ms)");
    expect(isKnownInfraNoise(t1)).toBe(true);
    expect(isKnownInfraNoise(t2)).toBe(true);
  });

  it("checks every candidate passed in — noise on the cause is still caught (tRPC wraps unhandled throws into .cause)", () => {
    const cause = Object.assign(new Error("LLM_CIRCUIT_OPEN: breaker open"), { circuitOpen: true });
    const wrapper = new Error("INTERNAL_SERVER_ERROR");
    expect(isKnownInfraNoise(wrapper, cause)).toBe(true);
  });

  it("returns false for a real bug — must NOT be swallowed as noise", () => {
    const real = new Error("Cannot read properties of undefined (reading 'id')");
    expect(isKnownInfraNoise(real)).toBe(false);
  });

  it("returns false for undefined / null / non-object candidates without throwing", () => {
    expect(isKnownInfraNoise(undefined)).toBe(false);
    expect(isKnownInfraNoise(null)).toBe(false);
    expect(isKnownInfraNoise("raw string error")).toBe(false);
    expect(isKnownInfraNoise(42)).toBe(false);
    expect(isKnownInfraNoise()).toBe(false);
  });
});
