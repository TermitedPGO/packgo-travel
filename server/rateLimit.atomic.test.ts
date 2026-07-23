/**
 * checkAtomicRateLimit logic (protects the /go/trip telemetry write).
 *
 * The limiter intentionally SKIPS in the test env (no Redis in unit tests), which is
 * why an in-test concurrent burst sees all calls allowed — a harness artefact, not a
 * prod gap. These tests mock Redis and disable the env skip to assert the actual
 * logic. The implementation is a single Lua script (INCR + self-healing EXPIRE run
 * atomically inside Redis), so N concurrent callers get N distinct counts and a lost
 * TTL heals on the next call instead of stranding the key forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const redisMock = vi.hoisted(() => ({ eval: vi.fn() }));
vi.mock("./redis", () => ({ default: redisMock }));

import { checkAtomicRateLimit } from "./rateLimit";

const ORIG_VITEST = process.env.VITEST;
const ORIG_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  redisMock.eval.mockReset();
});
afterEach(() => {
  process.env.VITEST = ORIG_VITEST;
  process.env.NODE_ENV = ORIG_NODE_ENV;
});

describe("checkAtomicRateLimit", () => {
  it("skips (allows, no Redis touched) in the test environment", async () => {
    const r = await checkAtomicRateLimit({ key: "ip", limit: 60, window: 3600 });
    expect(r.allowed).toBe(true);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  describe("with the env skip disabled (prod-like)", () => {
    beforeEach(() => {
      delete process.env.VITEST;
      process.env.NODE_ENV = "production";
    });

    it("runs ONE Lua script carrying the key and window (INCR+EXPIRE atomic, no TTL race)", async () => {
      redisMock.eval.mockResolvedValueOnce([1, 3600]);
      await checkAtomicRateLimit({ key: "ip", limit: 60, window: 3600 });
      expect(redisMock.eval).toHaveBeenCalledTimes(1);
      const [script, numKeys, key, windowArg] = redisMock.eval.mock.calls[0];
      expect(String(script)).toContain("INCR");
      expect(String(script)).toContain("EXPIRE");
      expect(numKeys).toBe(1);
      expect(key).toBe("ratelimit:atomic:ip");
      expect(windowArg).toBe("3600");
    });

    it("the script self-heals a missing TTL (Codex P2: lost EXPIRE must not strand the key)", async () => {
      redisMock.eval.mockResolvedValueOnce([61, 3600]);
      await checkAtomicRateLimit({ key: "ip", limit: 60, window: 3600 });
      // The heal lives INSIDE the atomic script: TTL < 0 → EXPIRE ARGV[1]. It runs on
      // every call, not only the first INCR, so a stranded key repairs itself.
      const script = String(redisMock.eval.mock.calls[0][0]);
      expect(script).toMatch(/if t < 0 then[\s\S]*EXPIRE/);
    });

    it("allows exactly at the limit boundary", async () => {
      redisMock.eval.mockResolvedValueOnce([60, 1200]);
      expect((await checkAtomicRateLimit({ key: "ip", limit: 60, window: 3600 })).allowed).toBe(true);
    });

    it("blocks the moment the atomic count exceeds the limit", async () => {
      redisMock.eval.mockResolvedValueOnce([61, 1200]);
      const r = await checkAtomicRateLimit({ key: "ip", limit: 60, window: 3600 });
      expect(r.allowed).toBe(false);
      expect(r.remaining).toBe(0);
    });

    it("gives each of N concurrent callers a distinct count, so only `limit` pass", async () => {
      // Simulate Redis's single-threaded atomicity: each eval returns the next count.
      let n = 0;
      redisMock.eval.mockImplementation(async () => [++n, 3600]);
      const results = await Promise.all(
        Array.from({ length: 200 }, () => checkAtomicRateLimit({ key: "ip", limit: 60, window: 3600 })),
      );
      expect(results.filter((r) => r.allowed).length).toBe(60);
      expect(results.filter((r) => !r.allowed).length).toBe(140);
    });
  });
});
