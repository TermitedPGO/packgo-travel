/**
 * Pre-LLM noise-sender filter — leaf module (2026-07-07, v802).
 *
 * These pure sender checks were extracted verbatim from gmailPipeline.ts so
 * they can be reused OUTSIDE the pipeline (the customer-list noise gate in
 * server/routers/adminCustomers.ts + globalSearch.ts) WITHOUT dragging in
 * gmailPipeline's heavy import chain (db / redis / gmail / receiptExtractor /
 * inquiryAgent). Same leaf-module discipline as _core/testAccounts.ts.
 *
 * gmailPipeline.ts now imports these from here and re-exports isKnownNoise /
 * isNoreplySender for its existing callers + unit tests. Single source of
 * truth for KNOWN_NOISE_DOMAINS — do NOT duplicate the list anywhere.
 */

export function parseEmailAddress(fromHeader: string): string | undefined {
  // "Lisa Chen <lisa@example.com>" → "lisa@example.com"
  // "lisa@example.com" → "lisa@example.com"
  const match = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s]+@[^\s]+)/);
  if (!match) return undefined;
  const email = match[1].trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

/**
 * gmail-push noreply firewall (P2, 2026-07-01) — pure sender check shared by
 * the push path (runGmailPipelineForMessageIds) and the isKnownNoise fallback
 * below. The 3-min poll's Gmail query already carries `-from:noreply`
 * (listUnreadMessages, server/_core/gmail.ts), so noreply notifications never
 * reach the pipeline via poll; the push history-diff has no Gmail query, so
 * it must apply the same gate in JS — otherwise, with GMAIL_POLL_LABEL unset,
 * every noreply notification (noreply@united.com …) enters the full
 * InquiryAgent pipeline seconds after arrival: one LLM chain burned per
 * email + a junk card in the office inbox.
 *
 * Matches the LOCALPART (before the @) containing noreply / no-reply /
 * no_reply, case-insensitive. Deliberately narrow — noreply-class only, no
 * broader blacklist (that's KNOWN_NOISE_DOMAINS' job below).
 */
export function isNoreplySender(from: string): boolean {
  // From header may be `Name <local@domain>` or bare `local@domain`;
  // parseEmailAddress extracts + lowercases, falls back for malformed input.
  const email = parseEmailAddress(from) ?? from.toLowerCase();
  const at = email.indexOf("@");
  const localpart = at === -1 ? email : email.slice(0, at);
  return /no[-_]?reply/.test(localpart);
}

// ── Pre-LLM spam filter: skip known non-customer senders ──
// These domains send automated notifications to Jeff's personal inbox.
// Skipping them saves LLM tokens without losing training value — they
// are never real customer emails. Unknown senders still go through the
// full InquiryAgent pipeline.
const KNOWN_NOISE_DOMAINS = new Set([
  // Our own system emails (self-sent notifications, monitor alerts)
  "packgoplay.com", "packgo-travel.fly.dev",
  "venmo.com", "paypal.com", "cash.app",
  "substack.com", "beehiiv.com", "mailchimp.com", "convertkit.com",
  "mgmresorts.com", "hilton.com", "marriott.com",
  "linkedin.com", "facebook.com", "twitter.com", "x.com",
  "google.com", "youtube.com", "apple.com", "microsoft.com",
  "github.com", "notion.so", "slack.com",
  "robly.com", "constantcontact.com", "mailerlite.com",
  // v803 (2026-07-08) — marketing / notification senders observed flooding the
  // guest list this round (從 prod 實測 email 定域名). Root fix is the
  // classification backfill (guestNoiseHygiene) + spam gate; these entries are
  // the immediate TS stop-bleed for cards not yet reclassified or not labelled
  // 'spam'. `.evite.com` domain-match also covers subdomains like mh1.evite.com.
  "awin.com", "disneyshopping.com", "evite.com", "uptimerobot.com",
  // NOTE: these three only ever match DOMAIN forms (@noreply…/.noreply…) via
  // the loop below; noreply-class LOCALPARTS (noreply@united.com) are handled
  // by the isNoreplySender check at the top of isKnownNoise.
  "noreply", "no-reply", "donotreply",
  // localpart-prefix patterns (match "<prefix>@anything"): automated senders.
  "alerts@", "notifications@", "newsletter@", "digest@", "onlinebanking@",
]);

export function isKnownNoise(from: string): boolean {
  // noreply-class localparts (noreply@united.com, no-reply@delta.com …) —
  // shared pure check with the push-path firewall. P2 fix (2026-07-01): the
  // domain-match branch below (`@noreply` / `.noreply`) can never match a
  // noreply LOCALPART, which let these leak into the LLM pipeline whenever a
  // message bypassed the poll's `-from:noreply` query (the push path).
  if (isNoreplySender(from)) return true;
  const lower = from.toLowerCase();
  for (const pattern of KNOWN_NOISE_DOMAINS) {
    if (pattern.includes("@")) {
      // Prefix match (e.g. "alerts@" matches "alerts@anything.com")
      if (lower.includes(pattern)) return true;
    } else {
      // Domain match
      if (lower.includes(`@${pattern}`) || lower.includes(`.${pattern}`)) return true;
    }
  }
  return false;
}
