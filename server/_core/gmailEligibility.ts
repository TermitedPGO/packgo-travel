/**
 * gmail-intake-ledger (2026-07-13) — the SINGLE eligibility predicate shared by
 * the three new intake consumers (Codex 11 §四 "single eligibility 函式,
 * history/fallback/對帳三方共用"):
 *
 *   1. the History sync engine (server/services/gmailHistorySync.ts),
 *   2. its 404 bounded-fallback scan, and
 *   3. the 5-minute reconciliation tripwire (server/services/gmailReconcile.ts).
 *
 * Attack surface 7 (self/forward/auto-reply/bounce loops) and 8 (read/archive/
 * filter drift) both reduce to "does this sender count as customer mail" — so
 * every path MUST decide identically or the set-difference reconciliation would
 * false-alarm on mail one path ingests and another ignores.
 *
 * The rules are the EXACT union of what the legacy pipeline already excludes,
 * kept as a zero-heavy-dependency leaf so importing it never drags in the
 * gmailPipeline db/redis/gmail chain:
 *   - own-email  → OWN_EMAILS (self / system sender) — same set gmailPipeline.isOwnEmail uses.
 *   - noreply    → isNoreplySender — the poll query's `-from:noreply` + push firewall.
 *   - knownNoise → isKnownNoise — the pre-LLM domain noise gate.
 *
 * Legacy path behavior is UNCHANGED — this module is new and consumed only by the
 * new paths; gmailEligibility.test.ts pins parity against the legacy predicates.
 */
import {
  parseEmailAddress,
  isNoreplySender,
  isKnownNoise,
} from "./knownNoise";
import { OWN_EMAILS } from "./testAccounts";

/** Why a sender was ruled out — the ledger records this as failureKind='noise'
 *  context, and the reconciliation card never needs anything finer. */
export type IneligibleReason = "own_email" | "noreply" | "known_noise";

export type EligibilityVerdict =
  | { eligible: true }
  | { eligible: false; reason: IneligibleReason };

/**
 * Case-insensitive own-address check — mirrors gmailPipeline.isOwnEmail exactly
 * (OWN_EMAILS.has(lowercased-trimmed)), re-implemented here so the leaf module
 * carries no gmailPipeline import. `email` is the already-parsed bare address.
 */
function isOwnAddress(email: string | null | undefined): boolean {
  return typeof email === "string" && OWN_EMAILS.has(email.trim().toLowerCase());
}

/**
 * The one intake-eligibility decision. Takes a raw `From` header (or a bare
 * address). Pure — no I/O, deterministic, unit-tested for three-way parity.
 *
 * Exclusion order fixes only the REPORTED reason (the boolean is order-free):
 * own-email → noreply → known-noise, matching the legacy firewall's own→noise
 * sequencing so a self-sent noreply reports own_email, not noreply.
 */
export function classifyIntakeEligibility(fromHeader: string): EligibilityVerdict {
  const email = parseEmailAddress(fromHeader);
  if (isOwnAddress(email)) return { eligible: false, reason: "own_email" };
  if (isNoreplySender(fromHeader)) return { eligible: false, reason: "noreply" };
  if (isKnownNoise(fromHeader)) return { eligible: false, reason: "known_noise" };
  return { eligible: true };
}

/** Convenience boolean for the common "keep this message?" filter. */
export function isEligibleForIntake(fromHeader: string): boolean {
  return classifyIntakeEligibility(fromHeader).eligible;
}
