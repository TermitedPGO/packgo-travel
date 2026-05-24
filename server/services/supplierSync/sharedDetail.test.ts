/**
 * Unit tests for sharedDetail.ts — rate-limit + retry + result helpers.
 *
 * Doesn't test `upsertProductDetail` directly (requires DB connection
 * fixture; covered later in M5 integration tests).
 */

import { describe, expect, it, vi } from "vitest";
import {
  fail,
  missing,
  ok,
  rateLimitedCall,
  withRetry,
} from "./sharedDetail";

describe("rateLimitedCall", () => {
  it("waits jitter before invoking fn", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    const start = Date.now();
    await rateLimitedCall(fn, "test-label", 100, 200);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(95); // allow tiny slack
    expect(elapsed).toBeLessThan(300);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("returns the fn's result", async () => {
    const fn = vi.fn().mockResolvedValue({ data: 42 });
    const result = await rateLimitedCall(fn, "test", 10, 20);
    expect(result).toEqual({ data: 42 });
  });
});

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on transient error then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("bails immediately on 400-class error (except 408/429)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("404 Not Found"));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow("404");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on 429 (rate limit)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 408 (timeout)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("408 Request Timeout"))
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("503 always fails"));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce("ok");
    const start = Date.now();
    await withRetry(fn, 3, 50);
    const elapsed = Date.now() - start;
    // First retry after 50ms, second after 100ms → total ≥ 150ms
    expect(elapsed).toBeGreaterThanOrEqual(145);
  });
});

describe("ok / fail / missing", () => {
  it("ok with parsed marks status=parsed", () => {
    const r = ok("itinerary", { foo: 1 }, {
      totalDays: 5,
      days: [],
    });
    expect(r.status).toBe("parsed");
    expect(r.raw).toBe(JSON.stringify({ foo: 1 }));
    expect(r.parsed).toEqual({ totalDays: 5, days: [] });
    expect(r.fetchedAt).toBeInstanceOf(Date);
  });

  it("ok with null parsed marks status=parse_failed", () => {
    const r = ok("itinerary", { foo: 1 }, null);
    expect(r.status).toBe("parse_failed");
    expect(r.raw).toBe(JSON.stringify({ foo: 1 }));
    expect(r.parsed).toBeNull();
  });

  it("fail captures error message truncated to 500 chars", () => {
    const longMsg = "x".repeat(1000);
    const r = fail("itinerary", new Error(longMsg));
    expect(r.status).toBe("parse_failed");
    expect(r.raw).toBeNull();
    expect(r.parsed).toBeNull();
    expect(r.errorMessage?.length).toBe(500);
  });

  it("fail handles non-Error throws", () => {
    const r = fail("itinerary", "string error");
    expect(r.errorMessage).toBe("string error");
  });

  it("missing returns missing status with null raw/parsed", () => {
    const r = missing("tourInfo");
    expect(r.status).toBe("missing");
    expect(r.raw).toBeNull();
    expect(r.parsed).toBeNull();
    expect(r.kind).toBe("tourInfo");
  });
});
