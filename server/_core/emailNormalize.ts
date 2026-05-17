/**
 * Round 81 red-team round 1 (2026-05-17) — Gmail normalization.
 *
 * Gmail's address aliasing: `j.e.f.f@gmail.com`, `jeff+tag@gmail.com`,
 * `jeff@googlemail.com` all deliver to the same inbox. Attackers exploit
 * this to register N accounts with the same physical mailbox and abuse
 * per-account limits (free trials, voucher redemption, packpoint signup
 * bonus, etc.).
 *
 * Normalize:
 *   - Lowercase everything
 *   - Trim whitespace
 *   - gmail.com / googlemail.com: strip dots in local part, strip everything
 *     after `+`, force domain to `gmail.com`
 *   - Other providers (yahoo, outlook, etc.): just lowercase + trim
 *
 * Used at:
 *   - User signup (auth.ts) — store normalizedEmail as a dedup key alongside
 *     the original email for display
 *   - Trial creation (membership routes) — check users.email = normalized
 *   - Inquiry intake — same customer_profile lookup
 *
 * Tests in emailNormalize.test.ts.
 */
export function normalizeEmail(rawEmail: string | null | undefined): string {
  if (!rawEmail) return "";
  const lower = rawEmail.toString().trim().toLowerCase();
  const atIdx = lower.indexOf("@");
  if (atIdx <= 0 || atIdx === lower.length - 1) return lower;

  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);

  // Strip everything after `+` (Gmail + Outlook + Fastmail support +tag)
  const beforeTag = local.split("+")[0];

  // Gmail-specific normalisation
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const noDots = beforeTag.replace(/\./g, "");
    return `${noDots}@gmail.com`;
  }

  // Outlook also supports +tag (since 2017) but NOT dot-stripping
  if (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com"
  ) {
    return `${beforeTag}@${domain}`;
  }

  // Default: just lowercase + trim
  return lower;
}

/**
 * Check if two emails resolve to the same physical inbox after normalization.
 * Convenience helper for dedup checks.
 */
export function isSameInbox(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}
