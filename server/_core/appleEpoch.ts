/**
 * appleEpoch — convert macOS Messages' `message.date` raw integer into an ISO
 * timestamp string.
 *
 * THE LANDMINE (Phase1c design doc, 案件跟 Phase1a 日期教訓同類): the Messages
 * SQLite database (~/Library/Messages/chat.db) has stored `message.date` in
 * TWO different units across macOS history, both anchored to the Apple epoch
 * (2001-01-01T00:00:00Z, NOT the Unix epoch 1970-01-01):
 *   - macOS Big Sur (11, ~2020) onward: NANOSECONDS since the Apple epoch.
 *   - Earlier macOS: SECONDS since the Apple epoch.
 * There is no version flag in the row itself — every reader has to guess by
 * magnitude and then sanity-check the result actually lands in a plausible
 * calendar range. Silently guessing wrong produces a wrong-but-valid-looking
 * Date (e.g. year 1970 or year 33658), which is worse than throwing — a
 * customer-timeline entry with a garbage date is a trust-destroying bug that
 * looks fine until someone notices the sort order is insane.
 *
 * Apple epoch offset from Unix epoch, computed (not hand-copied — hand-copied
 * constants are exactly how Phase1a died twice per CLAUDE.md history):
 *   new Date("2001-01-01T00:00:00Z").getTime() / 1000 === 978307200
 *
 * ── DUAL-MAINTENANCE WARNING ──────────────────────────────────────────────
 * scripts/imessage-sync.mjs duplicates this ENTIRE function verbatim (it's a
 * plain Node script with no TS build step, so it cannot import this file).
 * If you change ANY constant or branch here (offset, plausible-year window,
 * nanosecond/second branch order, error message), open
 * scripts/imessage-sync.mjs's appleEpochToIso and make the identical change
 * there, then re-run this file's test suite AND manually re-verify the
 * script's copy — there is no automated test covering the .mjs copy.
 */
const APPLE_EPOCH_OFFSET_SECONDS =
  new Date("2001-01-01T00:00:00Z").getTime() / 1000; // 978307200

/** Plausible calendar-year window used to disambiguate seconds vs
 * nanoseconds and to reject garbage input. iMessage predates 2015 in
 * practice, but we leave headroom on both ends per the design doc's
 * 2015-2035 guidance rather than hard-coding iMessage's actual launch year. */
const MIN_PLAUSIBLE_YEAR = 2015;
const MAX_PLAUSIBLE_YEAR = 2035;

function yearOfUnixSeconds(unixSeconds: number): number {
  return new Date(unixSeconds * 1000).getUTCFullYear();
}

function isPlausibleYear(unixSeconds: number): boolean {
  if (!Number.isFinite(unixSeconds)) return false;
  const year = yearOfUnixSeconds(unixSeconds);
  return year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR;
}

/**
 * Convert a raw `message.date` value from chat.db into an ISO-8601 string.
 *
 * Strategy: try treating rawValue as NANOSECONDS since the Apple epoch first
 * (this is the current/modern format, Big Sur+); if the resulting date lands
 * in the plausible window, use it. Otherwise try SECONDS since the Apple
 * epoch (legacy format); if that lands in the plausible window, use it.
 * If neither interpretation produces a plausible date, throw a clear error —
 * callers (the local sync script) must catch this per-message and skip the
 * row rather than let a single malformed timestamp abort the whole batch.
 *
 * rawValue=0 is the Apple epoch itself (2001-01-01T00:00:00.000Z) under
 * EITHER unit — both interpretations agree at that single point, so it
 * resolves unambiguously without needing the plausibility window at all.
 */
export function appleEpochToIso(rawValue: number): string {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    throw new Error(
      `appleEpochToIso: rawValue must be a finite number, got ${String(rawValue)}`,
    );
  }

  // rawValue=0 is the Apple epoch itself under EITHER unit interpretation —
  // handle it directly rather than through the plausibility window, which is
  // centered on 2015-2035 and would otherwise reject the boundary the design
  // doc explicitly calls out (2001-01-01T00:00:00.000Z falls outside that
  // window on both interpretations).
  if (rawValue === 0) {
    return new Date(APPLE_EPOCH_OFFSET_SECONDS * 1000).toISOString();
  }

  // Nanoseconds interpretation (modern macOS, Big Sur+).
  const asNanoUnixSeconds = APPLE_EPOCH_OFFSET_SECONDS + rawValue / 1e9;
  if (isPlausibleYear(asNanoUnixSeconds)) {
    return new Date(asNanoUnixSeconds * 1000).toISOString();
  }

  // Seconds interpretation (legacy macOS).
  const asSecUnixSeconds = APPLE_EPOCH_OFFSET_SECONDS + rawValue;
  if (isPlausibleYear(asSecUnixSeconds)) {
    return new Date(asSecUnixSeconds * 1000).toISOString();
  }

  throw new Error(
    `appleEpochToIso: could not resolve rawValue=${rawValue} to a plausible date ` +
      `(tried nanoseconds → year ${yearOfUnixSeconds(asNanoUnixSeconds)}, ` +
      `seconds → year ${Number.isFinite(asSecUnixSeconds) ? yearOfUnixSeconds(asSecUnixSeconds) : "N/A"}; ` +
      `expected ${MIN_PLAUSIBLE_YEAR}-${MAX_PLAUSIBLE_YEAR}). Skip this message, do not guess.`,
  );
}
