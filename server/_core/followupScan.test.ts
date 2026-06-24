/**
 * followupScan tests — the pure `selectStaleQuoted` (where the "who needs a
 * follow-up" logic lives). The DB read + inbox-post executor is verified live
 * (repo norm). Rule under test: only a customer whose NEWEST message is
 * outbound (we spoke last) and silent within [minDays, maxDays] is a candidate;
 * most-overdue first.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { selectStaleQuoted, type InteractionRow } from "./followupScan";

const NOW = new Date("2026-06-23T00:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000);
const OPTS = { minDays: 3, maxDays: 21 };

describe("selectStaleQuoted", () => {
  it("flags a customer we spoke to last, silent within the window; ignores their older messages", () => {
    // newest-first overall
    const rows: InteractionRow[] = [
      { customerProfileId: 1, direction: "outbound", createdAt: daysAgo(7) }, // newest for 1 → candidate
      { customerProfileId: 1, direction: "inbound", createdAt: daysAgo(10) }, // older, ignored
    ];
    const out = selectStaleQuoted(rows, NOW, OPTS);
    expect(out).toHaveLength(1);
    expect(out[0].profileId).toBe(1);
    expect(out[0].daysSince).toBe(7);
  });

  it("does NOT flag when the customer replied last (ball is with us)", () => {
    const rows: InteractionRow[] = [
      { customerProfileId: 2, direction: "inbound", createdAt: daysAgo(5) }, // newest = customer replied
      { customerProfileId: 2, direction: "outbound", createdAt: daysAgo(8) }, // our older quote, ignored
    ];
    expect(selectStaleQuoted(rows, NOW, OPTS)).toHaveLength(0);
  });

  it("excludes too-fresh (< minDays) and too-old (> maxDays)", () => {
    const rows: InteractionRow[] = [
      { customerProfileId: 3, direction: "outbound", createdAt: daysAgo(1) }, // too fresh
      { customerProfileId: 4, direction: "outbound", createdAt: daysAgo(30) }, // too old
    ];
    expect(selectStaleQuoted(rows, NOW, OPTS)).toHaveLength(0);
  });

  it("returns most-overdue first", () => {
    const rows: InteractionRow[] = [
      { customerProfileId: 1, direction: "outbound", createdAt: daysAgo(7) },
      { customerProfileId: 5, direction: "outbound", createdAt: daysAgo(14) },
    ];
    const out = selectStaleQuoted(rows, NOW, OPTS);
    expect(out.map((c) => c.profileId)).toEqual([5, 1]);
    expect(out.map((c) => c.daysSince)).toEqual([14, 7]);
  });
});
