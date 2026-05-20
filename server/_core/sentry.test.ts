/**
 * Unit tests for server/_core/sentry.ts (v2 Wave 1 Module 1.1).
 *
 * Cases:
 *   1. Happy path: initSentry() with DSN set → Sentry.init called once
 *      with the expected DSN / env / release args.
 *   2. Idempotency: initSentry() called twice → Sentry.init called exactly
 *      once.
 *   3. Capture from a handler exception: captureException(err) wraps the
 *      Sentry SDK call in a scope and forwards the error.
 *   4. Capture when SENTRY_DSN unset: initSentry() must NOT crash, NOT call
 *      Sentry.init, and subsequent captureException calls must still work
 *      (Sentry SDK no-ops are the contract; we just verify our wrapper
 *      doesn't throw).
 *
 * @sentry/node is fully mocked — no network, no DSN required.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @sentry/node BEFORE importing our wrapper so the wrapper's import
// resolves to the spies.
vi.mock("@sentry/node", () => {
  const init = vi.fn();
  const captureException = vi.fn();
  const captureMessage = vi.fn();
  const setupExpressErrorHandler = vi.fn();
  const expressIntegration = vi.fn().mockReturnValue({ name: "express" });
  // withScope just calls the callback with a stub scope.
  const withScope = vi.fn().mockImplementation((cb: (scope: any) => void) => {
    const scope = {
      setTag: vi.fn(),
      setExtra: vi.fn(),
    };
    cb(scope);
    return scope;
  });
  return {
    init,
    captureException,
    captureMessage,
    setupExpressErrorHandler,
    expressIntegration,
    withScope,
  };
});

import * as Sentry from "@sentry/node";
import {
  initSentry,
  _resetSentryForTests,
  isSentryInitialized,
  captureException,
  captureMessage,
} from "./sentry";

describe("server/_core/sentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSentryForTests();
    // Reset env between tests so we control DSN presence per-case.
    delete process.env.SENTRY_DSN;
  });

  describe("initSentry()", () => {
    it("(case 1) calls Sentry.init exactly once with DSN/env/release args", () => {
      process.env.SENTRY_DSN = "https://abc123@o1.ingest.sentry.io/42";
      process.env.NODE_ENV = "production";
      process.env.FLY_MACHINE_VERSION = "v123";

      initSentry();

      expect(Sentry.init).toHaveBeenCalledTimes(1);
      const initArgs = (Sentry.init as any).mock.calls[0][0];
      expect(initArgs.dsn).toBe("https://abc123@o1.ingest.sentry.io/42");
      expect(initArgs.environment).toBe("production");
      expect(initArgs.release).toBe("v123");
      expect(initArgs.sampleRate).toBe(1.0);
      expect(initArgs.tracesSampleRate).toBe(0.1);
      expect(initArgs.sendDefaultPii).toBe(false);
      expect(Array.isArray(initArgs.integrations)).toBe(true);
      expect(initArgs.integrations.length).toBeGreaterThan(0);
      expect(isSentryInitialized()).toBe(true);

      // Cleanup
      delete process.env.FLY_MACHINE_VERSION;
    });

    it("(case 2) is idempotent — calling twice does NOT double-register", () => {
      process.env.SENTRY_DSN = "https://abc@example.com/1";

      initSentry();
      initSentry();
      initSentry();

      expect(Sentry.init).toHaveBeenCalledTimes(1);
    });

    it("(case 4) does NOT crash and does NOT call Sentry.init when SENTRY_DSN unset", () => {
      // DSN cleared by beforeEach
      expect(() => initSentry()).not.toThrow();
      expect(Sentry.init).not.toHaveBeenCalled();
      // Wrapper still marks itself initialized so we don't spam the warn.
      expect(isSentryInitialized()).toBe(true);
    });
  });

  describe("captureException / captureMessage", () => {
    it("(case 3) captureException wraps the error in a scope and forwards it", () => {
      process.env.SENTRY_DSN = "https://abc@example.com/1";
      initSentry();

      const err = new Error("simulated tRPC handler exception");
      captureException(err, {
        tags: { worker: "tour-generation", jobId: "job-7" },
        extras: { tourId: 42 },
      });

      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(err);
    });

    it("(case 3b) captureException is safe even without prior initSentry — does not throw", () => {
      // No init() call here.
      const err = new Error("uninitialized capture");
      expect(() => captureException(err)).not.toThrow();
      // Sentry SDK is responsible for no-op-on-uninit; we just verify our
      // wrapper passes through cleanly without exploding.
      expect(Sentry.captureException).toHaveBeenCalledWith(err);
    });

    it("(case 3c) captureException catches Sentry-internal errors and logs, does not rethrow", () => {
      // Make captureException itself throw, simulating a broken transport.
      (Sentry.captureException as any).mockImplementationOnce(() => {
        throw new Error("broken transport");
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const err = new Error("real error");
      expect(() => captureException(err)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("captureMessage forwards to Sentry.captureMessage with level", () => {
      captureMessage("hello", "warning");
      expect(Sentry.captureMessage).toHaveBeenCalledWith("hello", "warning");
    });

    it("captureMessage defaults level to info", () => {
      captureMessage("hello");
      expect(Sentry.captureMessage).toHaveBeenCalledWith("hello", "info");
    });
  });
});
