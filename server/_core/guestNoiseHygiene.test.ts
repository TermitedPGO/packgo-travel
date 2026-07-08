/**
 * guestNoiseHygiene (v803) — classification backfill + read-only hygiene report,
 * and the v803 KNOWN_NOISE_DOMAINS stop-bleed additions.
 *
 * Root-cause eradication: historical guest inbounds have classification=NULL, so
 * the noise gate can't tell Ann from a marketing blast. The backfill re-runs the
 * pipeline classifier on each eligible card's latest inbound and stamps a real
 * label; once stamped, spam ones are hidden by the existing gate for free.
 *
 * Monitor's three-shape fixture is exercised through the REAL confirm path with
 * a stubbed classifier: a bank-notification body → 'spam' (rolls off), a real
 * inquiry body → 'new_inquiry' (stays); an already-classified / rescued card is
 * covered by the idempotent `WHERE classification IS NULL` write + the gate's
 * own tests. DB + classifier are stubbed (no local DB, no LLM in tests).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isKnownNoise } from "./knownNoise";
import { mapInquiryChannel } from "./guestNoiseHygiene";

/** Flatten a drizzle sql object to lowercased text so the db stub can route by query. */
function sqlText(q: any): string {
  const walk = (n: any): string => {
    if (n == null) return "";
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map(walk).join("");
    if (Array.isArray(n.queryChunks)) return n.queryChunks.map(walk).join("");
    if ("value" in n) return String(n.value);
    if (n.name) return n.name;
    return "";
  };
  return walk(q).toLowerCase();
}

/**
 * db.execute stub — routes by SQL text to the mysql2 `[rows, fields]` shape the
 * service's rowsOf()/affectedRows() expect. Records every executed query.
 */
function makeDb(cfg: {
  countN?: number;
  batch?: any[];
  reportRows?: any[];
  updateAffected?: number | (() => number);
}) {
  const calls: string[] = [];
  const execute = vi.fn(async (q: any) => {
    const t = sqlText(q);
    calls.push(t);
    if (t.includes("update `customerinteractions`")) {
      const a = typeof cfg.updateAffected === "function" ? cfg.updateAffected() : cfg.updateAffected ?? 1;
      return [{ affectedRows: a }];
    }
    if (t.includes("as inboundcount")) return [cfg.reportRows ?? []];
    if (t.includes("as interactionid")) return [cfg.batch ?? []];
    if (t.includes("count(*) as n")) return [[{ n: cfg.countN ?? 0 }]];
    return [[]];
  });
  return { db: { execute }, calls };
}

describe("mapInquiryChannel", () => {
  it("passes through allowed channels, falls back unknown/phone/review to email", () => {
    for (const c of ["email", "web_form", "whatsapp", "wechat", "line", "sms"]) {
      expect(mapInquiryChannel(c)).toBe(c);
    }
    expect(mapInquiryChannel("phone")).toBe("email");
    expect(mapInquiryChannel("review")).toBe("email");
    expect(mapInquiryChannel(null)).toBe("email");
    expect(mapInquiryChannel(undefined)).toBe("email");
  });
});

describe("v803 KNOWN_NOISE_DOMAINS stop-bleed additions", () => {
  it("isKnownNoise catches the newly-added noise senders", () => {
    expect(isKnownNoise("promo@awin.com")).toBe(true);
    expect(isKnownNoise("deals@disneyshopping.com")).toBe(true);
    expect(isKnownNoise("invite@evite.com")).toBe(true);
    expect(isKnownNoise("noreply@mh1.evite.com")).toBe(true); // subdomain via .evite.com
    expect(isKnownNoise("alert@uptimerobot.com")).toBe(true);
    expect(isKnownNoise("onlinebanking@ealerts.somebank.com")).toBe(true); // localpart prefix
  });
  it("still does NOT flag a real customer domain", () => {
    expect(isKnownNoise("ayuan@axt.com")).toBe(false);
    expect(isKnownNoise("lisa@gmail.com")).toBe(false);
  });
});

describe("runGuestClassificationBackfill", () => {
  let getDbMock: ReturnType<typeof vi.fn>;
  let classifyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    getDbMock = vi.fn();
    classifyMock = vi.fn(async ({ rawMessage }: { rawMessage: string }) => ({
      classification: /bank|noise|newsletter|marketing/i.test(rawMessage) ? "spam" : "new_inquiry",
    }));
    vi.doMock("../agents/autonomous/inquiryAgent", () => ({ runInquiryAgent: classifyMock }));
  });

  async function load() {
    return import("./guestNoiseHygiene");
  }

  it("dry_run reports counts + estimated LLM calls and WRITES NOTHING", async () => {
    const { db, calls } = makeDb({ countN: 3 });
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));

    const { runGuestClassificationBackfill } = await load();
    const r = await runGuestClassificationBackfill("dry_run");

    expect(r.status).toBe("ok");
    expect(r.eligibleCount).toBe(3);
    expect(r.estimatedLlmCalls).toBe(3);
    expect(r.cap).toBe(80);
    expect(r.exceedsCap).toBe(false);
    // only the COUNT query ran — no batch fetch, no UPDATE.
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.includes("update"))).toBe(false);
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("dry_run flags exceedsCap when eligible > cap", async () => {
    const { db } = makeDb({ countN: 130 });
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));
    const { runGuestClassificationBackfill } = await load();
    const r = await runGuestClassificationBackfill("dry_run");
    expect(r.eligibleCount).toBe(130);
    expect(r.exceedsCap).toBe(true);
  });

  it("clamps an over-large limit to the hard max (500) and floors non-integers", async () => {
    const { db } = makeDb({ countN: 1000 });
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));
    const { runGuestClassificationBackfill } = await load();

    const big = await runGuestClassificationBackfill("dry_run", { limit: 100000 });
    expect(big.cap).toBe(500); // an authenticated caller can't override the safety ceiling
    expect(big.exceedsCap).toBe(true); // 1000 > 500

    const frac = await runGuestClassificationBackfill("dry_run", { limit: 2.5 });
    expect(frac.cap).toBe(2); // floored
  });

  it("confirm stamps each eligible card's latest inbound; bank→spam rolls off, real inquiry stays", async () => {
    const batch = [
      { interactionId: 10, profileId: 1, content: "From: bank alerts\nSubject: statement\n\nyour monthly balance", channel: "email" },
      { interactionId: 11, profileId: 2, content: "From: lisa\n\nHi, I'd like to book a tour to Japan in October", channel: "email" },
    ];
    const { db, calls } = makeDb({ countN: 2, batch, updateAffected: 1 });
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));

    const { runGuestClassificationBackfill } = await load();
    const r = await runGuestClassificationBackfill("confirm");

    expect(r.status).toBe("ok");
    expect(r.processed).toBe(2);
    expect(r.updatedCount).toBe(2);
    expect(r.becameSpam).toBe(1); // the bank card only
    expect(r.remaining).toBe(0);
    expect(classifyMock).toHaveBeenCalledTimes(2);
    // idempotent write guard present.
    expect(calls.some((c) => c.includes("update `customerinteractions`") && c.includes("classification is null"))).toBe(true);
  });

  it("confirm is idempotent: a row already stamped between read+write (affectedRows 0) is not counted", async () => {
    const batch = [{ interactionId: 20, profileId: 3, content: "From: x\n\nreal question", channel: "email" }];
    const { db } = makeDb({ countN: 1, batch, updateAffected: 0 });
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));
    const { runGuestClassificationBackfill } = await load();
    const r = await runGuestClassificationBackfill("confirm");
    expect(r.updatedCount).toBe(0);
    expect(r.becameSpam).toBe(0);
  });

  it("confirm skips a blank-content row without calling the classifier", async () => {
    const batch = [{ interactionId: 30, profileId: 4, content: "   ", channel: "email" }];
    const { db } = makeDb({ countN: 1, batch, updateAffected: 1 });
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));
    const { runGuestClassificationBackfill } = await load();
    const r = await runGuestClassificationBackfill("confirm");
    expect(r.updatedCount).toBe(0);
    expect(classifyMock).not.toHaveBeenCalled();
  });
});

describe("runGuestNoiseHygieneReport (read-only)", () => {
  let getDbMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    getDbMock = vi.fn();
  });

  it("flags all-spam + noise-domain guests, samples them, and returns a domain histogram", async () => {
    const reportRows = [
      { profileId: 1, email: "alerts@chase.com", inboundCount: 3, spamInboundCount: 0 }, // noise_domain
      { profileId: 2, email: "real@gmail.com", inboundCount: 2, spamInboundCount: 2 }, // all_spam
      { profileId: 3, email: "ann@axt.com", inboundCount: 1, spamInboundCount: 0 }, // keep
    ];
    const { db } = makeDb({ reportRows });
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));

    const { runGuestNoiseHygieneReport } = await import("./guestNoiseHygiene");
    const r = await runGuestNoiseHygieneReport();

    expect(r.status).toBe("ok");
    expect(r.candidateCount).toBe(2);
    expect(r.byNoiseDomain).toBe(1);
    expect(r.byAllSpam).toBe(1);
    expect(r.sample).toHaveLength(2);
    const domains = (r.topDomains ?? []).map((d) => d.domain).sort();
    expect(domains).toEqual(["chase.com", "gmail.com"]);
  });

  it("returns zero candidates when no guest is all-spam or noise-domain", async () => {
    const reportRows = [{ profileId: 9, email: "real@axt.com", inboundCount: 2, spamInboundCount: 1 }];
    const { db } = makeDb({ reportRows });
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));
    const { runGuestNoiseHygieneReport } = await import("./guestNoiseHygiene");
    const r = await runGuestNoiseHygieneReport();
    expect(r.candidateCount).toBe(0);
    expect(r.sample).toEqual([]);
  });
});
