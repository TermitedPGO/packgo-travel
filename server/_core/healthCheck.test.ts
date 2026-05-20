/**
 * Unit tests for server/_core/healthCheck.ts (v2 Wave 1 Module 1.3).
 *
 * Cases:
 *   1. Happy: all 4 sub-checks return ok → overall: "ok".
 *   2. Redis fails → overall: "degraded", checks.redis.status: "fail".
 *   3. All 4 fail → overall: "down".
 *   4. Stripe cache: 2 calls within 5 min → only 1 real Stripe API call.
 *   5. LLM cache: 2 calls within 1 h → only 1 real Anthropic API call.
 *
 * All external SDKs and modules are mocked — no DB, no Redis, no Stripe,
 * no Anthropic call escapes the test process.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────
// Spy targets — defined at top so the factories below close over them.
const dbExecuteMock = vi.fn();
const redisPingMock = vi.fn();
const stripeBalanceRetrieveMock = vi.fn();
const anthropicModelsListMock = vi.fn();

// ../db: getDb returns an object whose .execute() runs the spy.
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    execute: dbExecuteMock,
  })),
}));

// ../redis: redis.ping() runs the spy.
vi.mock("../redis", () => ({
  redis: {
    ping: redisPingMock,
  },
}));

// stripe: default-import Stripe is a class; new Stripe(...).balance.retrieve
// runs the spy.
vi.mock("stripe", () => {
  const StripeCtor = vi.fn().mockImplementation(() => ({
    balance: { retrieve: stripeBalanceRetrieveMock },
  }));
  return { default: StripeCtor };
});

// @anthropic-ai/sdk: default-import Anthropic is a class; new
// Anthropic(...).models.list runs the spy.
vi.mock("@anthropic-ai/sdk", () => {
  const AnthropicCtor = vi.fn().mockImplementation(() => ({
    models: { list: anthropicModelsListMock },
  }));
  return { default: AnthropicCtor };
});

// ./env: provide stub keys so the sub-checks don't short-circuit on
// "secret not configured".
vi.mock("./env", () => ({
  ENV: {
    stripeSecretKey: "sk_test_stub",
    anthropicApiKey: "sk-ant-stub",
  },
}));

// Sentry — silent no-op so test failures don't try to phone home.
vi.mock("./sentry", () => ({
  captureException: vi.fn(),
}));

// Logger — silent no-op child logger.
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// drizzle-orm: the only thing healthCheck.ts pulls from it is the `sql`
// tagged-template builder; return a no-op tag so `sql\`SELECT 1\`` produces
// a sentinel db.execute can swallow.
vi.mock("drizzle-orm", () => ({
  sql: (..._args: unknown[]) => ({ __sql: true }),
}));

// Pull in the SUT AFTER the mocks are registered.
import { runHealthChecks, _resetCachesForTests } from "./healthCheck";

// ─── Test suite ───────────────────────────────────────────────────────────
describe("server/_core/healthCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCachesForTests();
    // Default: every dependency happy.
    dbExecuteMock.mockResolvedValue([{ "1": 1 }]);
    redisPingMock.mockResolvedValue("PONG");
    stripeBalanceRetrieveMock.mockResolvedValue({ available: [] });
    anthropicModelsListMock.mockResolvedValue({ data: [] });
  });

  it("(case 1) happy path — all 4 sub-checks ok → overall: ok", async () => {
    const result = await runHealthChecks();

    expect(result.overall).toBe("ok");
    expect(result.checks.db.status).toBe("ok");
    expect(result.checks.redis.status).toBe("ok");
    expect(result.checks.stripe.status).toBe("ok");
    expect(result.checks.llm.status).toBe("ok");

    // Each sub-check should have a non-negative latency (>=0 covers 0ms
    // microbenchmarks too).
    expect(result.checks.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checks.redis.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checks.stripe.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checks.llm.latencyMs).toBeGreaterThanOrEqual(0);

    // Real calls happened
    expect(dbExecuteMock).toHaveBeenCalledTimes(1);
    expect(redisPingMock).toHaveBeenCalledTimes(1);
    expect(stripeBalanceRetrieveMock).toHaveBeenCalledTimes(1);
    expect(anthropicModelsListMock).toHaveBeenCalledTimes(1);
  });

  it("(case 2) Redis fails → overall: degraded, redis.status: fail", async () => {
    redisPingMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await runHealthChecks();

    expect(result.overall).toBe("degraded");
    expect(result.checks.redis.status).toBe("fail");
    expect(result.checks.redis.error).toContain("ECONNREFUSED");
    // Other 3 still ok
    expect(result.checks.db.status).toBe("ok");
    expect(result.checks.stripe.status).toBe("ok");
    expect(result.checks.llm.status).toBe("ok");
  });

  it("(case 3) all 4 fail → overall: down", async () => {
    dbExecuteMock.mockRejectedValueOnce(new Error("db dead"));
    redisPingMock.mockRejectedValueOnce(new Error("redis dead"));
    stripeBalanceRetrieveMock.mockRejectedValueOnce(new Error("stripe dead"));
    anthropicModelsListMock.mockRejectedValueOnce(new Error("anthropic dead"));

    const result = await runHealthChecks();

    expect(result.overall).toBe("down");
    expect(result.checks.db.status).toBe("fail");
    expect(result.checks.redis.status).toBe("fail");
    expect(result.checks.stripe.status).toBe("fail");
    expect(result.checks.llm.status).toBe("fail");
    expect(result.checks.db.error).toContain("db dead");
    expect(result.checks.redis.error).toContain("redis dead");
    expect(result.checks.stripe.error).toContain("stripe dead");
    expect(result.checks.llm.error).toContain("anthropic dead");
  });

  it("(case 4) Stripe cache — 2 calls within 5 min → only 1 real Stripe call", async () => {
    // First call: cold cache → 1 real call.
    await runHealthChecks();
    expect(stripeBalanceRetrieveMock).toHaveBeenCalledTimes(1);

    // Second call: warm cache → no extra Stripe call.
    await runHealthChecks();
    expect(stripeBalanceRetrieveMock).toHaveBeenCalledTimes(1);

    // Sanity: other un-cached sub-checks did run twice.
    expect(dbExecuteMock).toHaveBeenCalledTimes(2);
    expect(redisPingMock).toHaveBeenCalledTimes(2);
  });

  it("(case 5) LLM cache — 2 calls within 1h → only 1 real Anthropic call", async () => {
    await runHealthChecks();
    expect(anthropicModelsListMock).toHaveBeenCalledTimes(1);

    await runHealthChecks();
    expect(anthropicModelsListMock).toHaveBeenCalledTimes(1);

    // Sanity: un-cached sub-checks ran twice.
    expect(dbExecuteMock).toHaveBeenCalledTimes(2);
    expect(redisPingMock).toHaveBeenCalledTimes(2);
  });
});
