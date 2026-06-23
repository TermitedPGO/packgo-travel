/**
 * piiScrub — redact payment-card numbers (PANs) from free text BEFORE it is
 * stored in the DB (customerInteractions.content etc.).
 *
 * Why: email bodies we file can contain a customer's full credit-card number
 * (e.g. a corporate booker pasting "book this flight, here's the card"). Storing
 * that verbatim puts a live PAN in the database in plaintext — a PCI / security
 * liability. Audit 2026-06-22 found 8 such rows already live; the Gmail
 * full-thread backfill would make it far worse. Scrub at every write so a PAN
 * never lands at rest.
 *
 * Approach: find 13-19 digit runs (allowing space/dash separators), Luhn-
 * validate to avoid masking innocent long numbers (order ids, phone, tracking),
 * and replace with a masked form keeping the last 4 so Jeff can still tell which
 * card it was. Pure + deterministic → unit-tested.
 *
 * Scope: the PAN is the critical PCI field. CVV (3-4 bare digits) and expiry are
 * intentionally NOT regex-scrubbed here — too generic to match without shredding
 * normal text, and useless to an attacker without the PAN. Passport numbers vary
 * by country and are handled separately (structured fields go through
 * passportEncryption); free-text passport scrubbing is a future extension.
 */

/** Luhn checksum — real card numbers pass; random digit runs almost never do. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const CARD_CANDIDATE = /\d(?:[ -]?\d){12,18}/g;

/** Redact every Luhn-valid 13-19 digit PAN in `text`, keeping the last 4. */
export function scrubPaymentCards(text: string): string {
  if (!text) return text;
  return text.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/[^\d]/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnValid(digits)) return match;
    return `[卡號已遮 / card redacted ****${digits.slice(-4)}]`;
  });
}

/** Whether `text` contains at least one Luhn-valid PAN (for audit/remediation). */
export function containsPaymentCard(text: string): boolean {
  if (!text) return false;
  CARD_CANDIDATE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CARD_CANDIDATE.exec(text)) !== null) {
    const digits = m[0].replace(/[^\d]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

/** The single entry callers use before storing free text. Today = card scrub;
 *  keep this name so adding passport/SSN later is a one-place change. */
export function scrubPii(text: string): string {
  return scrubPaymentCards(text);
}
