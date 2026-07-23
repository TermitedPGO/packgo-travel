/**
 * Tests for the REAL /go/trip/:source handler — handleTripRedirect is exactly what
 * _core/index.ts mounts (via mountTripRedirect):
 *
 *   - each of the 4 closed sources 302s to the approved entry
 *   - an unknown source is a 400, never a redirect
 *   - the 302 is sent BEFORE telemetry starts: a limiter or DB that NEVER settles
 *     (not just an immediate reject) cannot delay or block the redirect
 *   - telemetry stores only the closed enum (no free text fields exist)
 *   - a replay is just another redirect-request row — nothing claims "unique click"
 *
 * Full middleware-order behaviour (access log, body parser) lives in
 * tripRedirect.integration.test.ts — this file is the handler contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const createAffiliateClick = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({ createAffiliateClick }));
const checkAtomicRateLimit = vi.hoisted(() => vi.fn());
vi.mock("../rateLimit", () => ({ checkAtomicRateLimit }));

import { handleTripRedirect, parseRedirectSource, redirectTarget } from "./tripRedirect";
import { APPROVED_HOMEPAGE_ENTRY } from "./affiliateLinkService";

function fakeReq(source: unknown): Request {
  return {
    params: { source },
    headers: { "x-forwarded-for": "203.0.113.7" },
    socket: { remoteAddress: "203.0.113.7" },
  } as unknown as Request;
}

function fakeRes() {
  const res = {
    statusCode: 0,
    redirectedTo: "",
    body: "",
    status(code: number) { this.statusCode = code; return this; },
    send(body: string) { this.body = body; return this; },
    redirect(code: number, url: string) { this.statusCode = code; this.redirectedTo = url; },
  };
  return res as unknown as Response & { statusCode: number; redirectedTo: string; body: string };
}

/** Let the fire-and-forget telemetry chain flush. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  createAffiliateClick.mockReset().mockResolvedValue(undefined);
  checkAtomicRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 59, resetAt: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parseRedirectSource", () => {
  it.each(["flight_search", "hotel_search", "tour_flight", "tour_hotel"])("accepts %s", (s) => {
    expect(parseRedirectSource(s)).toBe(s);
  });

  it.each([
    "homepage", "FLIGHT_SEARCH", "flight_search ", "../etc/passwd",
    "constructor", "__proto__", "", undefined, null, 42,
  ])("rejects %o", (s) => {
    expect(parseRedirectSource(s)).toBeNull();
  });
});

describe("redirectTarget", () => {
  it("is the approved entry, byte-for-byte", () => {
    expect(redirectTarget()).toBe(APPROVED_HOMEPAGE_ENTRY);
  });
});

describe("handleTripRedirect (the mounted handler)", () => {
  it.each(["flight_search", "hotel_search", "tour_flight", "tour_hotel"] as const)(
    "302s %s to the approved entry and logs the enum",
    async (source) => {
      const res = fakeRes();
      handleTripRedirect(fakeReq(source), res);
      expect(res.statusCode).toBe(302);
      expect(res.redirectedTo).toBe(APPROVED_HOMEPAGE_ENTRY);
      await flush();
      expect(createAffiliateClick).toHaveBeenCalledTimes(1);
      const row = createAffiliateClick.mock.calls[0][0];
      expect(row.referrerPage).toBe(source);
      expect(row.platform).toBe("trip_homepage");
      expect(row.userId).toBeNull();
      expect(row.ipAddress).toBeNull();
      expect(row.userAgent).toBeNull();
    },
  );

  it("400s an unknown source and does not redirect or log", async () => {
    const res = fakeRes();
    handleTripRedirect(fakeReq("paypal_me"), res);
    await flush();
    expect(res.statusCode).toBe(400);
    expect(res.redirectedTo).toBe("");
    expect(createAffiliateClick).not.toHaveBeenCalled();
  });

  it("the 302 is already sent when the limiter NEVER settles (Codex P1-1)", () => {
    // Not an immediate reject — a promise that never resolves, like a hung Redis
    // command. The response must not wait on it.
    checkAtomicRateLimit.mockImplementation(() => new Promise(() => {}));
    const res = fakeRes();
    handleTripRedirect(fakeReq("flight_search"), res);
    // Synchronously after the call — the promise is still pending, yet:
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe(APPROVED_HOMEPAGE_ENTRY);
  });

  it("the 302 is already sent when the DB write NEVER settles (Codex P1-1)", async () => {
    checkAtomicRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: 0 });
    createAffiliateClick.mockImplementation(() => new Promise(() => {}));
    const res = fakeRes();
    handleTripRedirect(fakeReq("hotel_search"), res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe(APPROVED_HOMEPAGE_ENTRY);
    await flush(); // telemetry chain starts but never settles — nothing to assert on it
  });

  it("still redirects when the telemetry write rejects (DB down)", async () => {
    createAffiliateClick.mockRejectedValue(new Error("db down"));
    const res = fakeRes();
    handleTripRedirect(fakeReq("flight_search"), res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe(APPROVED_HOMEPAGE_ENTRY);
    await flush(); // rejection is swallowed inside the telemetry chain
  });

  it("still redirects when the rate limiter rejects (Redis down)", async () => {
    checkAtomicRateLimit.mockRejectedValue(new Error("redis down"));
    const res = fakeRes();
    handleTripRedirect(fakeReq("hotel_search"), res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe(APPROVED_HOMEPAGE_ENTRY);
    await flush();
  });

  it("throttled: skips the write but never blocks the redirect", async () => {
    checkAtomicRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 0 });
    const res = fakeRes();
    handleTripRedirect(fakeReq("tour_flight"), res);
    expect(res.statusCode).toBe(302);
    await flush();
    expect(createAffiliateClick).not.toHaveBeenCalled();
  });

  it("a replay is just another redirect-request row — same enum, no uniqueness claim", async () => {
    const res1 = fakeRes();
    const res2 = fakeRes();
    handleTripRedirect(fakeReq("flight_search"), res1);
    handleTripRedirect(fakeReq("flight_search"), res2);
    expect(res1.statusCode).toBe(302);
    expect(res2.statusCode).toBe(302);
    await flush();
    expect(createAffiliateClick).toHaveBeenCalledTimes(2);
    expect(createAffiliateClick.mock.calls[0][0]).toEqual(createAffiliateClick.mock.calls[1][0]);
  });

  it("nothing browser-supplied reaches the log — the row is fully server-composed", async () => {
    const res = fakeRes();
    const req = fakeReq("flight_search");
    (req as unknown as { query: unknown }).query = { referrerPage: "/users/jeff", tourId: "-17", target: "https://evil.com" };
    (req as unknown as { body: unknown }).body = { targetUrl: "https://evil.com" };
    handleTripRedirect(req, res);
    await flush();
    const row = createAffiliateClick.mock.calls[0][0];
    expect(JSON.stringify(row)).not.toContain("evil.com");
    expect(JSON.stringify(row)).not.toContain("/users/jeff");
    expect(row.tourId).toBeNull();
    expect(row.targetUrl).toBe(APPROVED_HOMEPAGE_ENTRY);
  });
});
