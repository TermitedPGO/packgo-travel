/**
 * Unit tests for server/_core/trpc.ts (v2 Wave 1 Module 1.9).
 *
 * The adminProcedure middleware at lines 33-66 enforces two rules:
 *   1. ctx.user.role === "admin" or throw FORBIDDEN.
 *   2. type === "mutation" → throttle via checkAdminMutationRateLimit
 *      (60 req/min per admin user). Queries are unthrottled.
 *
 * Cases:
 *   1. (60 ok)  mutation when checkAdminMutationRateLimit → { allowed: true }
 *               → procedure resolves; rate-limit invoked exactly once.
 *   2. (61st)   mutation when checkAdminMutationRateLimit → { allowed: false }
 *               → throws TRPCError code "TOO_MANY_REQUESTS".
 *   3. (queries unthrottled) type === "query" → checkAdminMutationRateLimit
 *               NOT invoked; procedure resolves.
 *   4. (non-admin FORBIDDEN) role = "user" → throws FORBIDDEN regardless of
 *               rate-limit state (middleware runs the role check first).
 *
 * The rate-limit helper is mocked — no Redis required, no time wait.
 * The middleware itself is the unit under test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock the rate-limit helper BEFORE importing trpc.ts (which imports it).
vi.mock("../rateLimit", () => ({
  checkAdminMutationRateLimit: vi.fn(),
}));

// Mock logger so we don't write structured noise to test output.
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { adminProcedure, router } from "./trpc";
import { checkAdminMutationRateLimit } from "../rateLimit";
import { z } from "zod";

const rlMock = vi.mocked(checkAdminMutationRateLimit);

// Build a tiny sub-router exposing one mutation + one query through
// adminProcedure so we can exercise the middleware end-to-end.
const testRouter = router({
  doMutation: adminProcedure
    .input(z.object({ msg: z.string().optional() }).optional())
    .mutation(({ input }) => ({ ok: true, echo: input?.msg ?? null })),
  doQuery: adminProcedure
    .input(z.object({}).optional())
    .query(() => ({ ok: true })),
});

function adminCtx() {
  return {
    user: { id: 42, role: "admin" as const, email: "admin@example.com" },
  } as any;
}

function userCtx() {
  return {
    user: { id: 7, role: "user" as const, email: "user@example.com" },
  } as any;
}

describe("server/_core/trpc adminProcedure middleware", () => {
  beforeEach(() => {
    rlMock.mockReset();
  });

  it("(case 1) allows mutation when rate-limit reports allowed", async () => {
    rlMock.mockResolvedValue({ allowed: true } as any);

    const caller = testRouter.createCaller(adminCtx());
    const result = await caller.doMutation({ msg: "ping" });

    expect(result).toEqual({ ok: true, echo: "ping" });
    expect(rlMock).toHaveBeenCalledTimes(1);
    expect(rlMock).toHaveBeenCalledWith(42);
  });

  it("(case 2) throws TOO_MANY_REQUESTS on the 61st mutation (rate-limit denies)", async () => {
    rlMock.mockResolvedValue({ allowed: false } as any);

    const caller = testRouter.createCaller(adminCtx());

    await expect(caller.doMutation({ msg: "blocked" })).rejects.toThrow(TRPCError);
    await expect(caller.doMutation({ msg: "blocked" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("(case 3) queries are NOT rate-limited (helper not invoked)", async () => {
    const caller = testRouter.createCaller(adminCtx());

    // Fire many queries; rate-limit helper must never be called.
    for (let i = 0; i < 101; i++) {
      const result = await caller.doQuery();
      expect(result).toEqual({ ok: true });
    }
    expect(rlMock).not.toHaveBeenCalled();
  });

  it("(case 4) non-admin role throws FORBIDDEN before rate-limit runs", async () => {
    rlMock.mockResolvedValue({ allowed: true } as any);

    const caller = testRouter.createCaller(userCtx());

    await expect(caller.doMutation({ msg: "denied" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.doQuery()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Role check rejects before middleware ever calls the rate-limit helper.
    expect(rlMock).not.toHaveBeenCalled();
  });
});
