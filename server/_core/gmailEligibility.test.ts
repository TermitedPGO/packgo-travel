/**
 * gmail-intake-ledger — the SINGLE eligibility predicate shared by the History
 * engine, its 404 fallback scan, and the reconciliation tripwire. These tests
 * pin (a) each verdict + reason and (b) EXACT parity with the legacy pipeline's
 * own-email / noreply / known-noise predicates, so the three new consumers can
 * never drift from what the legacy poll already excludes (attack surfaces 7+8).
 *
 * Pure functions, zero I/O — no mocks needed.
 */
import { describe, it, expect } from "vitest";
import { classifyIntakeEligibility, isEligibleForIntake } from "./gmailEligibility";
import { parseEmailAddress, isNoreplySender, isKnownNoise } from "./knownNoise";
import { OWN_EMAILS } from "./testAccounts";

/** The legacy union: what the poll + push firewall together exclude. */
function legacyEligible(from: string): boolean {
  const email = parseEmailAddress(from);
  const own = typeof email === "string" && OWN_EMAILS.has(email.trim().toLowerCase());
  return !own && !isNoreplySender(from) && !isKnownNoise(from);
}

const CASES: Array<{ from: string; eligible: boolean; reason?: string }> = [
  { from: "customer@example.com", eligible: true },
  { from: "Alice Chen <alice@gmail.com>", eligible: true },
  { from: "王小明 <wang@outlook.com>", eligible: true },
  { from: "support@packgoplay.com", eligible: false, reason: "own_email" },
  { from: "Jeff <jeffhsieh09@gmail.com>", eligible: false, reason: "own_email" },
  { from: "noreply@united.com", eligible: false, reason: "noreply" },
  { from: "Delta <no-reply@delta.com>", eligible: false, reason: "noreply" },
  { from: "deals@marriott.com", eligible: false, reason: "known_noise" },
  { from: "news@substack.com", eligible: false, reason: "known_noise" },
  { from: "alerts@bank.com", eligible: false, reason: "known_noise" },
];

describe("classifyIntakeEligibility", () => {
  for (const c of CASES) {
    it(`${c.from} → ${c.eligible ? "eligible" : `ineligible(${c.reason})`}`, () => {
      const v = classifyIntakeEligibility(c.from);
      expect(v.eligible).toBe(c.eligible);
      if (!v.eligible) {
        expect(v.reason).toBe(c.reason);
      }
    });
  }

  it("own-email is checked BEFORE noreply/noise (a self-sent notice reports own_email)", () => {
    // support@packgoplay.com is BOTH an OWN_EMAIL and a known-noise domain —
    // the own-email reason must win (matches the legacy own→noise sequencing).
    const v = classifyIntakeEligibility("support@packgoplay.com");
    expect(v).toEqual({ eligible: false, reason: "own_email" });
  });
});

describe("three-way consistency — parity with the legacy predicates", () => {
  // The whole point: history / fallback / reconcile all call ONE function, and
  // that function's boolean equals the legacy union for every sender. If this
  // holds, the set-difference reconciliation can never false-alarm on mail one
  // path keeps and another drops.
  const senders = [
    ...CASES.map((c) => c.from),
    "RANDOM Marketing <promo@awin.com>",
    "hotel@hilton.com",
    "a.customer+tag@company.co.uk",
    "notifications@github.com",
    "",
    "not-an-email",
  ];
  for (const from of senders) {
    it(`isEligibleForIntake matches legacy union for: ${JSON.stringify(from)}`, () => {
      expect(isEligibleForIntake(from)).toBe(legacyEligible(from));
    });
  }
});
