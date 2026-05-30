/**
 * CORS origin allowlist + decision — extracted from `index.ts` so the
 * security-sensitive logic is unit-testable (the inline `cors()` config inside
 * `startServer()` can't be imported on its own).
 *
 * Security note: this is the guard the 2026-05-17 red-team rounds hardened.
 * Non-whitelisted Origins are REJECTED (the `cors()` origin callback then
 * errors the request), so keep the list tight — wildcards were deliberately
 * removed. Only add SPECIFIC origins.
 */

/**
 * Build the origin allowlist from the environment.
 *
 * Includes the loopback render origin (`http://127.0.0.1:<PORT>`): bot-prerender
 * drives a headless Chromium against the local server, and that browser attaches
 * the loopback origin to its JS/CSS sub-resource + tRPC requests. Without
 * whitelisting it, the CORS guard 500s every asset → React never hydrates →
 * the prerender caches an empty, schema-less shell. PORT is 8080 on Fly and is
 * also `renderForBot`'s fallback, so cover both the resolved port and 8080.
 */
export function buildAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const renderPort = env.PORT || "8080";
  const loopback = [
    `http://127.0.0.1:${renderPort}`,
    `http://localhost:${renderPort}`,
    // Explicit 8080 fallback — matches renderForBot's default when PORT is
    // unset, so the prerender origin is covered even outside Fly.
    "http://127.0.0.1:8080",
    "http://localhost:8080",
  ];
  return [
    // Round 80.18: production custom domain
    "https://packgoplay.com",
    "https://www.packgoplay.com",
    // Fly.io (origin alias — internal health checks + redirect source)
    "https://packgo-travel.fly.dev",
    // Development
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    // bot-prerender loopback render origin (see fn doc)
    ...loopback,
    // Allow BASE_URL from env if set
    ...(env.BASE_URL ? [env.BASE_URL] : []),
  ];
}

/**
 * Pattern-based origin whitelist.
 *
 * 2026-05-17 red-team round 1 — wildcards for `*.fly.dev` / `*.manus.*` were
 * removed (any attacker who registered a subdomain on those shared platforms
 * could pass the CORS check against authenticated /api/* requests). Add
 * specific preview-deploy patterns here ONLY when needed, e.g.:
 *   /^https:\/\/pr-\d+\.packgo-travel\.fly\.dev$/
 */
export const allowedOriginPatterns: RegExp[] = [];

/**
 * Decide whether an Origin may pass CORS.
 *
 * A missing origin (`undefined`) is allowed — that covers curl, server-to-
 * server calls, Stripe webhooks, and same-origin navigations that omit the
 * header. Anything present must match the allowlist or a pattern, else it is
 * rejected.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[],
  patterns: RegExp[] = allowedOriginPatterns,
): boolean {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  return patterns.some((p) => p.test(origin));
}
