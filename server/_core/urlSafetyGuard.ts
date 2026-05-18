/**
 * Round 81 red-team round 7 (2026-05-17) — SSRF defense for user-supplied URLs.
 *
 * Pages like /admin tour generation accept a URL and fetch it server-side
 * (LionTravel API, supplier websites, PDF URLs, etc.). Without validation:
 *   - http://169.254.169.254/latest/meta-data/ → AWS/Fly metadata service →
 *     instance credentials
 *   - http://127.0.0.1:6379 / http://localhost:5432 → internal Redis/DB
 *   - http://internal-service.fly.dev → lateral movement to private Fly net
 *   - file:///etc/passwd → local file read (Node fetch blocks file:// by
 *     default, but defense-in-depth)
 *   - gopher:// / dict:// / etc. → exotic schemes
 *
 * Defenses (apply BEFORE any fetch):
 *   1. Allowlist allowed hostnames (liontravel, uvbookings, R2 domains,
 *      packgoplay self-references, etc.)
 *   2. Block private/loopback/metadata IPs even if hostname resolves to them
 *   3. Only allow http/https schemes
 *
 * Used by: tour-generation pipeline (submitAsyncGeneration), Lion API
 * client (extra defense even though its base URL is hard-coded), supplier
 * scrape paths.
 */

const ALLOWED_HOSTNAMES = new Set<string>([
  // Lion Travel
  "travel.liontravel.com",
  "www.liontravel.com",
  "liontravel.com",
  // UV Bookings (Ctrip SOA2 gateway) — adjust based on actual host
  "soa2.uvbookings.com",
  "uvbookings.com",
  // PACK&GO own surfaces (PDF URLs from our R2)
  "packgoplay.com",
  "www.packgoplay.com",
  "packgo-travel.fly.dev",
  "fly.storage.tigris.dev",
  // Cloudflare R2 / S3
  // Match by suffix — see ALLOWED_HOST_SUFFIXES
]);

const ALLOWED_HOST_SUFFIXES = [
  ".r2.cloudflarestorage.com",
  ".r2.dev",
  ".manus.space",  // Legacy — kept during migration
  ".s3.amazonaws.com",
  ".s3.us-west-1.amazonaws.com",
  ".s3-website.us-west-1.amazonaws.com",
];

const BLOCKED_IP_PATTERNS = [
  // IPv4 loopback / metadata / RFC1918 private
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,             // link-local + AWS metadata
  /^0\.0\.0\.0$/,
  // IPv6 loopback / link-local / ULA
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd00:/i,
];

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
  normalizedUrl?: string;
}

/**
 * Validate a URL is safe to fetch server-side. Returns { safe, reason }.
 *
 * Strict: only http/https, allow-listed hostname, no embedded creds.
 * Even with allowlist passed, DNS resolution at fetch time could resolve
 * the hostname to a private IP (DNS rebinding). Mitigate via:
 *   - Hostname allowlist (this function)
 *   - + at fetch time, follow with no redirects and validate Host header
 *     (caller's responsibility; not always practical for Lion/UV)
 *   - + run fetch behind a NetworkPolicy if your infra supports it
 */
export function validateUrl(input: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { safe: false, reason: "Not a valid URL" };
  }

  // Only http/https
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: `Scheme not allowed: ${url.protocol}` };
  }

  // Reject embedded credentials (https://attacker:pass@target.com tricks)
  if (url.username || url.password) {
    return { safe: false, reason: "Embedded credentials not allowed in URL" };
  }

  const hostname = url.hostname.toLowerCase();

  // Block raw IP addresses entirely — forces hostname-based attacks
  // through DNS, which is harder to spoof and easier to allowlist.
  if (BLOCKED_IP_PATTERNS.some((p) => p.test(hostname))) {
    return { safe: false, reason: `Private/metadata IP: ${hostname}` };
  }

  // If it looks like an IPv4 (4 dot-separated octets), block (even non-private)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { safe: false, reason: `Raw IPv4 not allowed: ${hostname}` };
  }

  // Allowlist check: exact match OR suffix match
  const inAllowlist = ALLOWED_HOSTNAMES.has(hostname);
  const inSuffixList = ALLOWED_HOST_SUFFIXES.some((suffix) =>
    hostname.endsWith(suffix)
  );
  if (!inAllowlist && !inSuffixList) {
    return {
      safe: false,
      reason: `Hostname not in allowlist: ${hostname}`,
    };
  }

  return { safe: true, normalizedUrl: url.toString() };
}
