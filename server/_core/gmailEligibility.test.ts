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
import {
  classifyIntakeEligibility,
  isEligibleForIntake,
  decideIntakeRoute,
  normalizeFromAddress,
} from "./gmailEligibility";
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

// ── v2 (Codex 12 輪 P0-1) — the ledger-first ROUTE decision, at its source ─────

describe("decideIntakeRoute — receipt runs BEFORE the noise/self terminal (§五)", () => {
  it("a receipt from a noreply sender still routes to receipt (never dropped as noise)", () => {
    expect(decideIntakeRoute("noreply@marriott.com", true)).toEqual({
      route: "receipt",
      fromAddress: "noreply@marriott.com",
    });
  });
  it("a receipt from an OWN address still routes to receipt (Jeff forwards receipts to himself)", () => {
    expect(decideIntakeRoute("support@packgoplay.com", true).route).toBe("receipt");
  });
  it("a non-receipt noreply routes to noise", () => {
    expect(decideIntakeRoute("noreply@marriott.com", false).route).toBe("noise");
  });
  it("a non-receipt known-noise sender routes to noise", () => {
    expect(decideIntakeRoute("promo@awin.com", false).route).toBe("noise");
  });
  it("a non-receipt own address routes to self_or_outbound", () => {
    expect(decideIntakeRoute("support@packgoplay.com", false).route).toBe("self_or_outbound");
  });
  it("a non-receipt real customer routes to customer + a normalized bare address", () => {
    expect(decideIntakeRoute("Jane Doe <Jane.Doe@Example.COM>", false)).toEqual({
      route: "customer",
      fromAddress: "jane.doe@example.com",
    });
  });
  it("the route boolean stays parity: customer iff isEligibleForIntake (for non-receipts)", () => {
    const routeSenders = [
      "customer@example.com",
      "RANDOM Marketing <promo@awin.com>",
      "hotel@hilton.com",
      "notifications@github.com",
      "support@packgoplay.com",
      "not-an-email",
    ];
    for (const from of routeSenders) {
      const route = decideIntakeRoute(from, false).route;
      expect(route === "customer").toBe(legacyEligible(from));
    }
  });
});

describe("normalizeFromAddress (moved to the classifier leaf)", () => {
  it("strips display name + lowercases + bounds to 320", () => {
    expect(normalizeFromAddress("Jeff <Jeff@X.COM>")).toBe("jeff@x.com");
    expect(normalizeFromAddress("x".repeat(400))).toHaveLength(320);
  });
});
