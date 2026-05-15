/**
 * featureFlags — single source of truth for runtime boolean flags.
 *
 * SECURITY_AUDIT_2026_05_14 P3-3: `process.env.X === "true"` was scattered
 * across the codebase. A typo in the env-var name (e.g.
 * `PLAID_TRUST_DEFERAL_ENABLED` — one R missing) silently evaluates to
 * `false`, which could silently disable a safety gate. Centralizing the
 * reads makes typos a TypeScript compile error.
 *
 * Add new flags here, never inline `process.env.*_ENABLED === "true"`
 * at call sites.
 *
 * Note: this module is read on every call (no caching). Fly secrets are
 * applied at boot via process.env, so changes require a redeploy — which
 * is what we want for flags that gate financial behavior (no surprise
 * mid-run flips). If you need hot-reloadable flags later, layer that on
 * top here.
 */

const isTrue = (v: string | undefined): boolean => v === "true";

/**
 * Master switch for the CST §17550 trust-deferral auto-match path. When
 * OFF, every customer payment is recognized as revenue on the booking
 * date (legacy behavior). When ON, deposits sit in `trustDeferredIncome`
 * until the matched departure date.
 *
 * Env: `PLAID_TRUST_DEFERRAL_ENABLED=true`
 */
export const trustDeferralEnabled = (): boolean =>
  isTrue(process.env.PLAID_TRUST_DEFERRAL_ENABLED);

/**
 * Number of integer days to subtract from the matched departure date
 * when recognizing trust revenue. 0 = recognize on the departure date
 * itself. Allows Jeff to tune a forward-looking buffer for CST audits
 * without code changes.
 *
 * Env: `PLAID_TRUST_RECOGNITION_OFFSET_DAYS` (integer, default 0)
 */
export const trustRecognitionOffsetDays = (): number => {
  const v = parseInt(process.env.PLAID_TRUST_RECOGNITION_OFFSET_DAYS ?? "0", 10);
  return Number.isFinite(v) && v >= 0 ? v : 0;
};

/**
 * Minimum auto-match confidence score below which a payment-to-booking
 * link is rejected (forced to manual review). 0-100. Lower = more
 * matches but more false positives.
 *
 * Env: `PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE` (integer 0-100, default 80)
 */
export const trustAutomatchMinConfidence = (): number => {
  const v = parseInt(
    process.env.PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE ?? "80",
    10
  );
  if (!Number.isFinite(v)) return 80;
  return Math.max(0, Math.min(100, v));
};
