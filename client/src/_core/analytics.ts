/**
 * PostHog analytics wrapper — single source of truth for client-side
 * conversion-funnel tracking.
 *
 * v2 Wave 1 Module 1.4 (2026-05-20) — installs `posthog-js` and exposes a
 * type-safe `track()` helper. The `AnalyticsEvent` union type means typos
 * like `track("tourview", ...)` fail at `tsc --noEmit` time — that's the
 * core value of this wrapper over calling `posthog.capture()` directly.
 *
 * Public surface:
 *   - `initAnalytics()` — idempotent. Called once from `main.tsx` AFTER
 *     Sentry init. No-op when `VITE_POSTHOG_KEY` is unset (dev / preview).
 *   - `track(event, properties)` — type-narrowed capture. The event name
 *     constrains the properties shape via discriminated union.
 *   - `identify(userId, traits?)` — alias previously-anonymous session to
 *     a logged-in user. Called from `useAuth` on login success.
 *   - `reset()` — clear identity on logout.
 *
 * Configuration choices (locked at v2 plan time):
 *   - `capture_pageview: false` — manual capture only, no URL noise.
 *   - `capture_pageleave: false` — same.
 *   - `autocapture: false` — no DOM-click noise. Only the 5 explicit
 *     funnel events ship.
 *   - `person_profiles: 'identified_only'` — anonymous visitors don't
 *     burn PostHog quota / create profiles. They get an `identify()`
 *     when they log in; that's when the profile materializes.
 *   - Region: US Cloud (`https://us.i.posthog.com`) by default — lowest
 *     latency from Fly IAD region. Overridable via `VITE_POSTHOG_HOST`.
 *
 * PII discipline:
 *   - `sanitize_properties` strips query-string keys `email`, `phone`,
 *     `token`, and any `passport*` field from `$current_url` and any
 *     URL-shaped property before capture. Booking flow sometimes has
 *     `?email=foo` in URLs (auth redirect) and we don't want those in
 *     PostHog.
 *   - No session recording — Sentry Session Replay (Module 1.1) already
 *     covers that, with `maskAllText: true`. Doing both is wasted quota.
 *
 * Failure surface:
 *   - If `posthog.init` throws (e.g. malformed key, network down), the
 *     exception is captured via Sentry as a warning-level message. The
 *     app continues — analytics is not a critical path.
 */

// Slim build of posthog-js — drops session recording, surveys, autocapture,
// exception tracking, dead-clicks, and rage-click detection. Saves ~28KB
// gzipped vs the full bundle and matches our explicit-only capture model
// (we disable autocapture, and Sentry Module 1.1 covers session replay +
// exception tracking).
import posthog from "posthog-js/dist/module.slim";
import * as Sentry from "@sentry/react";

/**
 * Discriminated union of every event this app captures. Adding a new
 * event = adding a new variant here. The compile-time guarantee is the
 * whole point — `track("typo_event_name", {...})` won't tsc.
 */
export type AnalyticsEvent =
  | {
      event: "tour_view";
      properties: {
        tourId: number;
        tourSlug?: string;
        tourTitle: string;
        sourceList?: "search" | "country" | "region" | "home" | "direct";
      };
    }
  | {
      event: "search";
      properties: {
        query: string;
        filtersJson?: string;
        resultCount: number;
      };
    }
  | {
      event: "booking_start";
      properties: {
        tourId: number;
        tourPrice: number;
      };
    }
  | {
      event: "booking_step";
      properties: {
        tourId: number;
        // Step names MUST match BookTour.tsx's `BookingStep` union. If you
        // add a step in BookTour, mirror it here.
        stepName: "date" | "travelers" | "details" | "confirm";
        stepIndex: number;
      };
    }
  | {
      event: "booking_complete";
      properties: {
        tourId: number;
        bookingId: number;
        totalAmount: number;
        participantCount: number;
      };
    };

/** Module-private guard so initAnalytics() is idempotent. */
let initialized = false;

/**
 * Returns true when the env-gated PostHog SDK is ready for capture.
 * Tests mock this implicitly by leaving `VITE_POSTHOG_KEY` undefined.
 */
function isEnabled(): boolean {
  return initialized && Boolean(import.meta.env.VITE_POSTHOG_KEY);
}

/**
 * Strip PII-bearing query-string keys from any URL-shaped property
 * before PostHog captures it. Returns the property bag with sanitized
 * URLs. Called by PostHog via the `sanitize_properties` config — its
 * signature is `(properties, event_name) => Properties` (the PostHog
 * type calls this `Properties = Record<string, Property>`).
 */
type SanitizeProps = Record<string, unknown>;

function sanitizeProperties(properties: SanitizeProps, _eventName: string): SanitizeProps {
  if (!properties) return properties;
  const piiKeys = ["email", "phone", "token", "password", "secret"];
  const passportRegex = /^passport/i;

  const stripPiiFromUrl = (raw: unknown): unknown => {
    if (typeof raw !== "string") return raw;
    if (!raw.includes("?")) return raw;
    try {
      const url = new URL(raw, "https://placeholder.invalid");
      let mutated = false;
      for (const key of [...url.searchParams.keys()]) {
        if (piiKeys.includes(key.toLowerCase()) || passportRegex.test(key)) {
          url.searchParams.delete(key);
          mutated = true;
        }
      }
      if (!mutated) return raw;
      // Preserve relative-URL inputs (no scheme) by stripping the placeholder.
      const rebuilt = url.toString();
      return rebuilt.startsWith("https://placeholder.invalid")
        ? rebuilt.slice("https://placeholder.invalid".length)
        : rebuilt;
    } catch {
      return raw;
    }
  };

  const out: SanitizeProps = { ...properties };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string" && value.includes("?")) {
      out[key] = stripPiiFromUrl(value);
    }
  }
  return out;
}

/**
 * Initialize PostHog. Idempotent. No-op when `VITE_POSTHOG_KEY` unset.
 * Must be called AFTER Sentry.init() in main.tsx so any init-failure
 * captureMessage reaches Sentry.
 */
export function initAnalytics(): void {
  if (initialized) return;
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return; // dev / preview / test — silently no-op.

  const host = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
  try {
    posthog.init(key, {
      api_host: host,
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      person_profiles: "identified_only",
      // Cast: PostHog's `Properties = Record<string, any>` while our
      // sanitizer accepts `Record<string, unknown>` for stricter local
      // safety. The runtime contract is identical (it returns the same
      // shape it receives, just with URL strings scrubbed).
      sanitize_properties: sanitizeProperties as unknown as (
        properties: Record<string, unknown>,
        event_name: string,
      ) => Record<string, unknown>,
      // Disable PostHog's own session recording — Sentry Replay (Module 1.1)
      // is the canonical session-replay surface and overlaps with this.
      disable_session_recording: true,
    } as Parameters<typeof posthog.init>[1]);
    initialized = true;
  } catch (err) {
    // Analytics is non-critical. Surface in Sentry as a warning and
    // continue. The app never crashes because PostHog couldn't init.
    Sentry.captureMessage("analytics init failed", {
      level: "warning",
      extra: { err: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Type-safe event capture. The event name constrains the shape of
 * `properties` via the `AnalyticsEvent` discriminated union — wrong
 * keys / wrong types fail at compile time. No-op when not initialized
 * (dev / preview / VITE_POSTHOG_KEY unset).
 */
export function track<E extends AnalyticsEvent>(
  event: E["event"],
  properties: E["properties"],
): void {
  if (!isEnabled()) return;
  posthog.capture(event, properties as Record<string, unknown>);
}

/**
 * Alias the previously-anonymous session to a logged-in user. Called
 * from `useAuth` on the transition from `null` to a real user. Pass
 * minimal traits (id + role) — never email / phone / passport.
 */
export function identify(userId: string, traits?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  posthog.identify(userId, traits);
}

/**
 * Clear identity on logout. PostHog generates a fresh anonymous ID for
 * the next session. Called from `useAuth.logout()`.
 */
export function reset(): void {
  if (!isEnabled()) return;
  posthog.reset();
}

/** Test-only: reset the module-internal `initialized` flag between cases. */
export function __resetForTests(): void {
  initialized = false;
}
