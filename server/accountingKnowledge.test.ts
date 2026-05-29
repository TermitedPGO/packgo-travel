/**
 * M2 — accounting knowledge base (preClassify) tests.
 *
 * Locks Jeff's hand-corrected rules + the anti-guess invariants that protect
 * the books. Updated 2026-05-29 after the real-transaction eval (603 prod
 * txns, docs/features/bookkeeping-enhancement/eval-2026-05-28.md) and Jeff's
 * rule decisions:
 *   - owner rule is now OUTFLOW-ONLY. Owner-name INFLOWS 放生 to LLM/Jeff —
 *     they are customers paying tour fees via Jeff's personal account, not
 *     internal transfers. (The 29-row revenue bug: forcing transfer zeroed
 *     real booking income out of the P&L.)
 *   - Ann uses a phrase match on the description ("Zelle payment to Ann ...")
 *     because the counterparty field is null on those rows (Bug 2, 24 misses).
 *   - WF-card payoff (description) + software subscriptions → outflow rules.
 *   - known travel vendors' INFLOWS → refund (conf 90) — the ONLY deterministic
 *     refund; unknown inflows still return null.
 *
 * Invariants kept:
 *   (a) the knowledge base NEVER auto-asserts revenue (no >=90 income hit)
 *   (b) unknown inflows return null (no guessing) — owner-name inflows and
 *       unknown deposits must never silently become a deterministic category.
 */
import { describe, it, expect } from "vitest";
import {
  preClassify,
  summarizeKnowledgeForPrompt,
  OWNER_IDENTITIES,
  KNOWN_OUTFLOW_VENDORS,
  KNOWN_INFLOW_REFUND_VENDORS,
  CARD_PAYOFF_PATTERNS,
  type PreClassifyInput,
} from "./agents/autonomous/accountingKnowledge";

const mk = (o: Partial<PreClassifyInput>): PreClassifyInput => ({
  amount: 100, // default: outflow
  merchantName: null,
  description: null,
  originalDescription: null,
  counterparty: null,
  accountName: null,
  accountType: null,
  ...o,
});

describe("preClassify — owner identity (outflow-only after 2026-05-29 fix)", () => {
  it("owner OUTFLOW → transfer, conf 95, owner type", () => {
    const r = preClassify(mk({ amount: 3000, counterparty: "Chun Fu Hsieh" }));
    expect(r.category).toBe("transfer");
    expect(r.confidence).toBe(95);
    expect(r.source).toBe("owner");
    expect(r.counterpartyType).toBe("owner");
  });

  it("owner INFLOW → null (放生:客人用業主個人戶付的團費,不是內部轉帳)", () => {
    // The 29-row revenue bug. Inflows now fall through to LLM/Jeff review.
    const r = preClassify(mk({ amount: -5000, counterparty: "CHUN FU HSIEH" }));
    expect(r.category).toBeNull();
    expect(r.source).toBeNull();
  });

  it("owner OUTFLOW matches case + spelling variants and Chinese name", () => {
    for (const name of ["CHUNFU HSIEH", "jeff hsieh", "謝俊甫", "Jun Fu Hsieh"]) {
      const r = preClassify(mk({ amount: 100, counterparty: name }));
      expect(r.category, name).toBe("transfer");
    }
  });

  it('owner OUTFLOW matches owner in description ("Zelle payment to ...")', () => {
    const r = preClassify(
      mk({ amount: 200, description: "Zelle payment to CHUNFU HSIEH" }),
    );
    expect(r.category).toBe("transfer");
    expect(r.source).toBe("owner");
  });

  it("owner-name INFLOW with a tour-fee memo → income_booking HINT (conf 65), not transfer", () => {
    // Owner rule is silent on inflows now, so the memo hint takes over:
    // advisory income_booking at conf 65 → still routed to the LLM/Jeff.
    const r = preClassify(
      mk({ amount: -800, counterparty: "CHUN FU HSIEH", description: "tour fee" }),
    );
    expect(r.category).toBe("income_booking");
    expect(r.confidence).toBe(65);
    expect(r.source).toBe("memo");
  });
});

describe("preClassify — known outflow vendors", () => {
  it("Jupiter Legend outflow → cogs_tour, conf 90", () => {
    const r = preClassify(mk({ amount: 1200, merchantName: "JUPITER LEGEND TRAVEL" }));
    expect(r.category).toBe("cogs_tour");
    expect(r.confidence).toBe(90);
    expect(r.source).toBe("vendor");
    expect(r.counterpartyType).toBe("vendor");
  });

  it("an outflow-only vendor (software) does NOT fire on an inflow (sign-aware)", () => {
    const r = preClassify(mk({ amount: -300, merchantName: "INTUIT" }));
    expect(r.category).toBeNull();
  });

  it('Ann visa vendor: "Zelle payment to Ann ..." in description → cogs_tour', () => {
    const r = preClassify(
      mk({ amount: 300, description: 'Zelle payment to Ann for "Chen visa"' }),
    );
    expect(r.category).toBe("cogs_tour");
    expect(r.source).toBe("vendor");
  });

  it('Ann phrase does NOT false-match "annual" / "Ann Arbor" / "channel"', () => {
    expect(
      preClassify(mk({ amount: 50, description: "ANNUAL CARD FEE" })).category,
    ).toBeNull();
    expect(
      preClassify(mk({ amount: 50, description: "Zelle payment to annual gym" }))
        .category,
    ).toBeNull();
    expect(
      preClassify(mk({ amount: 50, description: "Flight to Ann Arbor MI" }))
        .category,
    ).toBeNull();
    expect(
      preClassify(
        mk({ amount: 50, description: "CHANNEL ADS", counterparty: "channel co" }),
      ).category,
    ).toBeNull();
  });

  it("software subscriptions → expense_software (Xsolla/Suno/INTUIT/Moises/Creem)", () => {
    for (const m of ["XSOLLA *SUNO", "MANUS AI", "INTUIT *QBooks", "MOISES APP", "CREEM.IO"]) {
      const r = preClassify(mk({ amount: 20, description: m }));
      expect(r.category, m).toBe("expense_software");
      expect(r.source, m).toBe("vendor");
    }
  });

  it("WF-card payoff in the description (operating 戶 還款行) → cogs_tour", () => {
    const r = preClassify(
      mk({
        amount: 1500,
        description: "WELLS FARGO CARD AUTO CCPYMT",
        accountName: "BofA Operating",
      }),
    );
    expect(r.category).toBe("cogs_tour");
    expect(r.source).toBe("vendor");
  });
});

describe("preClassify — known travel-vendor inflows → refund (2026-05-29)", () => {
  it("United Airlines inflow → refund, conf 90, refund type", () => {
    const r = preClassify(mk({ amount: -640, merchantName: "UNITED AIRLINES" }));
    expect(r.category).toBe("refund");
    expect(r.confidence).toBe(90);
    expect(r.counterpartyType).toBe("refund");
  });

  it("Jupiter Legend inflow → refund (supplier refund in)", () => {
    const r = preClassify(mk({ amount: -1200, merchantName: "JUPITER LEGEND" }));
    expect(r.category).toBe("refund");
    expect(r.source).toBe("vendor");
  });

  it("refund rule does NOT fire on an outflow (United outflow ≠ refund)", () => {
    const r = preClassify(mk({ amount: 640, merchantName: "UNITED AIRLINES" }));
    expect(r.category).not.toBe("refund");
  });
});

describe("preClassify — Wells Fargo card account (代客機票)", () => {
  it("WF card outflow → cogs_tour", () => {
    const r = preClassify(
      mk({ amount: 640, accountName: "Wells Fargo Active Cash", accountType: "credit", merchantName: "EXPEDIA" }),
    );
    expect(r.category).toBe("cogs_tour");
    expect(r.source).toBe("wf_card");
    expect(r.counterpartyType).toBe("vendor");
  });

  it("WF card inflow is NOT auto cogs (outflow only)", () => {
    const r = preClassify(mk({ amount: -640, accountName: "Wells Fargo Active Cash" }));
    expect(r.category).toBeNull();
  });
});

describe("preClassify — credit-card payoff (還卡費 → transfer, 2026-05-29)", () => {
  it('"THANK YOU" payoff outflow → transfer, conf 90, card_payoff/transfer', () => {
    const r = preClassify(
      mk({ amount: 4668.24, description: "AUTOMATIC PAYMENT - THANK YOU" }),
    );
    expect(r.category).toBe("transfer");
    expect(r.confidence).toBe(90);
    expect(r.source).toBe("card_payoff");
    expect(r.counterpartyType).toBe("transfer");
  });

  it('bare "PAYMENT - THANK YOU" + "AUTOMATIC PAYMENT" both fire', () => {
    for (const d of ["PAYMENT - THANK YOU", "Automatic Payment", "Thank You"]) {
      expect(preClassify(mk({ amount: 100, description: d })).category, d).toBe(
        "transfer",
      );
    }
  });

  it("card payoff is outflow-only (inflow with the phrase does NOT fire)", () => {
    const r = preClassify(mk({ amount: -100, description: "PAYMENT - THANK YOU" }));
    expect(r.source).not.toBe("card_payoff");
    expect(r.category).not.toBe("transfer");
  });

  it("ORDERING: WF-card payoff still cogs_tour even if it also says THANK YOU", () => {
    // The WF exception must win — vendor rule (rule 2) runs before card_payoff.
    const r = preClassify(
      mk({ amount: 1500, description: "WELLS FARGO CARD CCPYMT - THANK YOU" }),
    );
    expect(r.category).toBe("cogs_tour");
    expect(r.source).toBe("vendor");
  });

  it("does NOT false-match an unrelated expense", () => {
    expect(
      preClassify(mk({ amount: 30, description: "Starbucks coffee" })).category,
    ).toBeNull();
  });
});

describe("preClassify — memo hints (medium confidence, not authoritative)", () => {
  it("inflow with visa/tour memo → income_booking HINT at conf 65 (< 90)", () => {
    const r = preClassify(mk({ amount: -450, description: "CHINA VISA SERVICE FEE" }));
    expect(r.category).toBe("income_booking");
    expect(r.confidence).toBe(65);
    expect(r.source).toBe("memo");
    expect(r.confidence).toBeLessThan(90); // never skips the LLM
  });

  it("income memo does NOT fire on an outflow", () => {
    const r = preClassify(mk({ amount: 450, description: "china visa" }));
    expect(r.category).toBeNull();
  });
});

describe("preClassify — anti-guess invariants (不準猜)", () => {
  it("unknown inflow with no signal → null (never guesses income)", () => {
    const r = preClassify(mk({ amount: -2500, description: "MOBILE DEPOSIT", merchantName: null }));
    expect(r.category).toBeNull();
    expect(r.source).toBeNull();
  });

  it("NEVER auto-asserts income_booking deterministically (>=90), either direction", () => {
    // Sweep every owner name + every vendor token (outflow + refund lists),
    // both directions. No deterministic (>=90) result may be income_booking —
    // revenue is the dangerous one; it must always go through the LLM/Jeff.
    const probes: PreClassifyInput[] = [];
    for (const name of OWNER_IDENTITIES) {
      probes.push(mk({ amount: -999, counterparty: name }));
      probes.push(mk({ amount: 999, counterparty: name }));
    }
    for (const v of [...KNOWN_OUTFLOW_VENDORS, ...KNOWN_INFLOW_REFUND_VENDORS]) {
      for (const m of v.match) {
        probes.push(mk({ amount: -999, counterparty: m, merchantName: m, description: m }));
        probes.push(mk({ amount: 999, counterparty: m, merchantName: m, description: m }));
      }
    }
    for (const p of CARD_PAYOFF_PATTERNS) {
      probes.push(mk({ amount: -999, description: p }));
      probes.push(mk({ amount: 999, description: p }));
    }
    for (const p of probes) {
      const r = preClassify(p);
      if (r.confidence >= 90) {
        expect(r.category).not.toBe("income_booking");
      }
    }
  });

  it("refund is reserved for the known-vendor allowlist — unknown inflows never become refund", () => {
    const unknowns = [
      mk({ amount: -999, merchantName: "RANDOM CO", description: "ACH CREDIT" }),
      mk({ amount: -999, description: "MOBILE DEPOSIT" }),
      mk({ amount: -999, counterparty: "某個陌生人" }),
    ];
    for (const p of unknowns) {
      expect(preClassify(p).category).not.toBe("refund");
    }
    // the approved exception still works:
    expect(
      preClassify(mk({ amount: -999, merchantName: "UNITED AIRLINES" })).category,
    ).toBe("refund");
  });
});

describe("summarizeKnowledgeForPrompt — prompt-cache safety", () => {
  it("is deterministic (byte-identical across calls)", () => {
    expect(summarizeKnowledgeForPrompt()).toBe(summarizeKnowledgeForPrompt());
  });
  it("mentions owner-transfer + WF-card + refund + no-guess rules", () => {
    const s = summarizeKnowledgeForPrompt();
    expect(s).toContain("transfer");
    expect(s).toContain("Wells Fargo");
    expect(s).toContain("refund");
    expect(s).toContain("other_review");
  });
});
