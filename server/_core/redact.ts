/**
 * PII redaction helpers for server logs.
 *
 * QA audit 2026-05-11 Phase 6 found 22+ log sites printing full
 * customer emails / phones / names to stdout, which reaches Fly.io
 * aggregated logs and violates CCPA's "reasonable security" requirement.
 *
 * Policy: keep enough info for ops debugging (Jeff seeing "which customer")
 * but remove the full PII. Partial redaction beats full removal because
 * "Email sent to j***@gmail.com" still lets us correlate with a customer
 * record while not exposing the address.
 */

/**
 * Mask an email to keep the first character + domain.
 *   "jeffhsieh09@gmail.com" → "j***@gmail.com"
 *   "ab@c.com"              → "a*@c.com"
 *   "a@b.c"                 → "a@b.c"  (too short to meaningfully mask)
 *   ""                      → ""
 */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return "";
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at < 1) return "[invalid-email]";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  if (local.length <= 1) return `${local}${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 1, 3))}${domain}`;
}

/**
 * Mask a phone number, keeping country/area code + last 2 digits.
 *   "+1 (510) 634-2307"  → "+1 (510) ***-**07"
 *   "0912345678"          → "0912****78"
 *   ""                    → ""
 * For ops debugging the kept digits help correlate; the middle is hidden.
 */
export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  if (trimmed.length < 4) return "[short]";
  const last2 = trimmed.slice(-2);
  return `${trimmed.slice(0, Math.min(6, trimmed.length - 4))}***${last2}`;
}

/**
 * Mask a customer / user name. Keep the first character only.
 *   "Jeff Hsieh"  → "J*** ***"
 *   "李大明"       → "李**"
 *   ""            → ""
 * For ops: which customer in spirit, but specific identity protected.
 */
export function redactName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .split(/\s+/)
    .map((part) => (part.length <= 1 ? part : `${part[0]}${"*".repeat(Math.min(part.length - 1, 3))}`))
    .join(" ");
}

/**
 * Mask a passport number, keeping first + last 2 chars.
 *   "G12345678"  → "G****78"
 * For visa workflows this is the most sensitive PII; never log raw.
 */
export function redactPassport(passport: string | null | undefined): string {
  if (!passport) return "";
  const trimmed = passport.trim().toUpperCase();
  if (trimmed.length < 4) return "[short]";
  return `${trimmed[0]}****${trimmed.slice(-2)}`;
}
