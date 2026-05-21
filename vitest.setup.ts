/**
 * Vitest global setup — runs ONCE per test process before any test file loads.
 *
 * Critical: this sets env vars that production modules read at IMPORT TIME,
 * not call time. E.g., `server/jwt.ts:10` reads `process.env.JWT_SECRET`
 * when first imported; if unset, falls back to a per-process random secret
 * which causes flaky behavior across vitest worker reloads.
 *
 * Add new test-only env defaults here as needed.
 */

// Stable JWT secret so createToken / verifyToken roundtrip is deterministic
// across all test files. Real prod secret never touches the test environment.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-prod-deterministic-roundtrip";

// Ensure NODE_ENV isn't accidentally "production" during local test runs
// (which would make jwt.ts throw on the missing-secret path before our
// default above gets a chance).
if (process.env.NODE_ENV === "production") {
  process.env.NODE_ENV = "test";
}
