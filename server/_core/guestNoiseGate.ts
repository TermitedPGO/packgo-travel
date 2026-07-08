/**
 * Guest-list noise gate — single source of truth (v802, 2026-07-07).
 *
 * v801 added `OR lastInboundAt IS NOT NULL` to the guest qualification so a
 * real inbound-only customer (Ann) would appear. But that also readmitted the
 * historical NOISE cards — marketing / notification senders (substack, mailchimp,
 * newsletter@…, alerts@…, noreply@…) that emailed us long ago and carry a
 * lastInboundAt. They flooded the list and the nav badge (99+), drowning the
 * cockpit.
 *
 * This pure predicate is the ONE gate applied — VERBATIM — on every surface
 * that surfaces guests (v794 教訓 / 口徑一致):
 *   1. guestList          (the visible customer list)
 *   2. runGuestUnreadRankingQuery → customerUnreadCount (the nav badge)
 *   3. globalSearch.search + globalSearch.recentContacts (the mobile FAB)
 * A card the list hides must not be counted by the badge, nor surfaced by
 * search / recent contacts.
 *
 * Scope: only an INBOUND-ONLY guest is ever gated. A registered account
 * (`userId` set) is never a guest. A guest that earned a chip another way
 * (`qualifiesViaContent` — Jeff added them by hand, or a filed inquiry /
 * escalation) is a real customer. A profile with NO inbound at all
 * (`hasInbound` false — e.g. a booking-only lead reached search by contact) is
 * not an inbound-noise card either. Only then: hide if the sender is known
 * noise OR the most recent inbound is effective spam. `latestInboundIsSpam`
 * already folds in the rescue convention (classification='spam' AND
 * spamVerdict != 'rescued'), so a rescued interaction is NOT gated, and Ann's
 * NULL-classified inbound is not spam → she is let through.
 */

import { sql } from "drizzle-orm";
import { isKnownNoise } from "./knownNoise";

export interface GuestNoiseInput {
  /** customerProfiles.userId — non-null means a registered account (never gated). */
  userId: number | null;
  /** customerProfiles.email (may be null for a phone/WeChat-only lead). */
  email: string | null;
  /** True when the guest has a real business relationship: source='manual', a booking / spend, a filed inquiry, or an escalation. */
  qualifiesViaContent: boolean;
  /** True when the profile has any inbound mail (customerProfiles.lastInboundAt set). */
  hasInbound: boolean;
  /** True when the most recent inbound is spam AND not rescued (see rescue convention). */
  latestInboundIsSpam: boolean;
}

/**
 * True when this row is an inbound-only guest that should be HIDDEN as noise:
 * a known-noise sender, or one whose latest inbound is effective spam.
 * Registered accounts, content-qualified guests, and no-inbound profiles all
 * return false.
 */
export function isNoiseOnlyGuest(r: GuestNoiseInput): boolean {
  if (r.userId != null) return false; // registered account — always a real customer
  if (r.qualifiesViaContent) return false; // manual / inquiry / escalation — earned a chip
  if (!r.hasInbound) return false; // no inbound mail — not an inbound-noise card (e.g. booking-only)
  return isKnownNoise(r.email ?? "") || r.latestInboundIsSpam;
}

/**
 * The two noise-gate SELECT fragments, shared VERBATIM by every surface so each
 * feeds isNoiseOnlyGuest byte-identical signals (v794 口徑一致). Both use raw
 * fully-qualified `customerProfiles`.`x` literals + inner table aliases:
 * interpolating ${customerProfiles.id} DROPS the table prefix and misbinds to
 * the inner table's own `id` (TiDB 雷, verified via offline toSQL). Every caller
 * must `.from(customerProfiles)` UNALIASED for the correlation to resolve.
 *   - qualifiesViaContent: 1 when the guest has a real business relationship —
 *     Jeff added them by hand (source='manual'), they booked / spent
 *     (bookingCount / totalSpend cached columns), a filed inquiry, or an
 *     escalation. Never noise-gated. Including booking/spend is what stops a
 *     PAYING customer whose email is at a corporate domain in KNOWN_NOISE_DOMAINS
 *     (e.g. someone booking from a @google.com / @marriott.com work address)
 *     from being wrongly hidden.
 *   - latestInboundIsSpam: 1 when the most recent inbound is classification='spam'
 *     AND spamVerdict != 'rescued' (the codebase-wide rescue convention —
 *     adminCustomers guestOpenItems / customerChatContext). NULL when no inbound.
 */
export function guestNoiseSelectFragments(
  t: Pick<
    typeof import("../../drizzle/schema"),
    "inquiries" | "agentMessages" | "customerInteractions"
  >,
) {
  const { inquiries, agentMessages, customerInteractions } = t;
  return {
    qualifiesViaContent: sql<number>`(CASE WHEN (
        \`customerProfiles\`.\`source\` = 'manual'
        OR \`customerProfiles\`.\`bookingCount\` > 0
        OR \`customerProfiles\`.\`totalSpend\` > 0
        OR EXISTS (SELECT 1 FROM ${inquiries} iq WHERE iq.customerEmail = \`customerProfiles\`.\`email\`)
        OR EXISTS (SELECT 1 FROM ${agentMessages} am WHERE am.relatedCustomerProfileId = \`customerProfiles\`.\`id\` AND am.messageType = 'escalation')
      ) THEN 1 ELSE 0 END)`,
    latestInboundIsSpam: sql<number>`(
        SELECT CASE WHEN ci.classification = 'spam' AND COALESCE(ci.spamVerdict, '') <> 'rescued' THEN 1 ELSE 0 END
        FROM ${customerInteractions} ci
        WHERE ci.customerProfileId = \`customerProfiles\`.\`id\`
          AND ci.direction = 'inbound'
        ORDER BY ci.createdAt DESC, ci.id DESC
        LIMIT 1
      )`,
  };
}
