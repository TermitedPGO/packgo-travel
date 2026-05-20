/**
 * Vitest for client/src/_core/analytics.ts (v2 Wave 1 Module 1.4).
 *
 * Covers four behaviors locked at task-spec time:
 *  1. env-absent → `track()` is a no-op (dev / preview / test stay clean,
 *     never burn PostHog quota).
 *  2. env-present → `track()` calls `posthog.capture` with the correct
 *     event name + properties shape.
 *  3. PII strip — when a property contains a URL with `?email=` (or
 *     phone / token / passport*), the `sanitize_properties` config
 *     scrubs those keys before capture.
 *  4. `reset()` → forwards to `posthog.reset` on logout.
 *
 * Note: type-safety of the `AnalyticsEvent` union is validated by tsc,
 * not by a runtime test — that's the whole point of the union. Putting
 * `track("typo", {...})` here as a "test" wouldn't catch anything at run
 * time (TypeScript erases types) and would also fail tsc, blocking the
 * suite. The compile-time check IS the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock factory — vi.mock is hoisted above imports, so we expose
// the captured spy via vi.hoisted() to access it from test bodies.
const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js/dist/module.slim", () => ({
  default: {
    init: mocks.init,
    capture: mocks.capture,
    identify: mocks.identify,
    reset: mocks.reset,
  },
}));

// Sentry mock so init-failure path doesn't trigger real captures during tests.
vi.mock("@sentry/react", () => ({
  captureMessage: vi.fn(),
}));

describe("client/_core/analytics", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the module-internal initialized flag so each test starts fresh.
    const mod = await import("./analytics");
    mod.__resetForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("env gating", () => {
    it("track() is a no-op when VITE_POSTHOG_KEY is unset", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "");
      const { initAnalytics, track } = await import("./analytics");

      initAnalytics();
      track("tour_view", {
        tourId: 42,
        tourTitle: "Hokkaido Spring",
      });

      expect(mocks.init).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    });

    it("reset() is a no-op when VITE_POSTHOG_KEY is unset", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "");
      const { reset } = await import("./analytics");
      reset();
      expect(mocks.reset).not.toHaveBeenCalled();
    });
  });

  describe("env present — capture shape", () => {
    it("initAnalytics() calls posthog.init with locked config", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
      vi.stubEnv("VITE_POSTHOG_HOST", "https://us.i.posthog.com");
      const { initAnalytics } = await import("./analytics");

      initAnalytics();

      expect(mocks.init).toHaveBeenCalledTimes(1);
      const [keyArg, configArg] = mocks.init.mock.calls[0]!;
      expect(keyArg).toBe("phc_test_key");
      expect(configArg).toMatchObject({
        api_host: "https://us.i.posthog.com",
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        person_profiles: "identified_only",
        disable_session_recording: true,
      });
      expect(typeof configArg.sanitize_properties).toBe("function");
    });

    it("initAnalytics() is idempotent (second call no-ops)", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
      const { initAnalytics } = await import("./analytics");
      initAnalytics();
      initAnalytics();
      expect(mocks.init).toHaveBeenCalledTimes(1);
    });

    it("track('tour_view', ...) calls posthog.capture with event + props", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
      const { initAnalytics, track } = await import("./analytics");
      initAnalytics();

      track("tour_view", {
        tourId: 7,
        tourTitle: "Kyoto Autumn",
        sourceList: "search",
      });

      expect(mocks.capture).toHaveBeenCalledTimes(1);
      expect(mocks.capture).toHaveBeenCalledWith("tour_view", {
        tourId: 7,
        tourTitle: "Kyoto Autumn",
        sourceList: "search",
      });
    });

    it("track('booking_complete', ...) carries full booking shape", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
      const { initAnalytics, track } = await import("./analytics");
      initAnalytics();

      track("booking_complete", {
        tourId: 7,
        bookingId: 1234,
        totalAmount: 65000,
        participantCount: 2,
      });

      expect(mocks.capture).toHaveBeenCalledWith("booking_complete", {
        tourId: 7,
        bookingId: 1234,
        totalAmount: 65000,
        participantCount: 2,
      });
    });

    it("identify() forwards id + traits to posthog.identify", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
      const { initAnalytics, identify } = await import("./analytics");
      initAnalytics();

      identify("42", { role: "user" });

      expect(mocks.identify).toHaveBeenCalledTimes(1);
      expect(mocks.identify).toHaveBeenCalledWith("42", { role: "user" });
    });

    it("reset() forwards to posthog.reset on logout", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
      const { initAnalytics, reset } = await import("./analytics");
      initAnalytics();

      reset();

      expect(mocks.reset).toHaveBeenCalledTimes(1);
    });
  });

  describe("PII sanitization", () => {
    it("strips ?email / ?phone / ?token / ?passport* from URL properties", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
      const { initAnalytics } = await import("./analytics");
      initAnalytics();

      // Pull the sanitize_properties fn that was passed into posthog.init.
      const [, configArg] = mocks.init.mock.calls[0]!;
      const sanitize = configArg.sanitize_properties as (
        p: Record<string, unknown> | undefined,
        e: string,
      ) => Record<string, unknown> | undefined;

      const sanitized = sanitize(
        {
          $current_url:
            "https://packgo09.manus.space/booking?email=alice@example.com&phone=5551234&token=abc&passportNumber=AB12345&keep=visible",
          $referrer: "https://google.com/?q=tokyo",
          tourId: 42,
        },
        "tour_view",
      );

      expect(sanitized).toBeDefined();
      const url = String(sanitized!.$current_url);
      expect(url).not.toContain("email=");
      expect(url).not.toContain("phone=");
      expect(url).not.toContain("token=");
      expect(url).not.toContain("passportNumber=");
      // Non-PII keys survive — these are real conversion-attribution signals.
      expect(url).toContain("keep=visible");
      // Untouched referrer (no PII keys) round-trips intact.
      expect(sanitized!.$referrer).toBe("https://google.com/?q=tokyo");
      // Non-string properties pass through.
      expect(sanitized!.tourId).toBe(42);
    });

    it("returns properties unchanged when no PII present", async () => {
      vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
      const { initAnalytics } = await import("./analytics");
      initAnalytics();

      const [, configArg] = mocks.init.mock.calls[0]!;
      const sanitize = configArg.sanitize_properties as (
        p: Record<string, unknown> | undefined,
        e: string,
      ) => Record<string, unknown> | undefined;

      const input = {
        $current_url: "https://packgo09.manus.space/tours/42?source=search",
        tourId: 42,
      };
      const sanitized = sanitize(input, "tour_view");

      expect(sanitized!.$current_url).toBe(
        "https://packgo09.manus.space/tours/42?source=search",
      );
      expect(sanitized!.tourId).toBe(42);
    });
  });
});
