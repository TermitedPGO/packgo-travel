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

import {
  selectStaleQuoted,
  buildFollowupReminderText,
  type InteractionRow,
} from "./followupScan";

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

describe("buildFollowupReminderText — 報價 wording only with real quote evidence (誠實度 gate 3)", () => {
  it("with quote evidence: keeps the 報價發了 N 天沒回 title", () => {
    const { title, body } = buildFollowupReminderText({
      email: "a@b.co",
      daysSince: 6,
      hasQuoteEvidence: true,
    });
    expect(title).toBe("跟進提醒:a@b.co 報價發了 6 天沒回");
    expect(body).toContain("最後一封是你寄給 a@b.co 的");
    expect(body).toContain("6 天沒下文");
  });

  it("WITHOUT quote evidence: neutral 上次聯絡後 wording, never claims 報價", () => {
    const { title, body } = buildFollowupReminderText({
      email: "eyoung@axt.com", // the 6/29 case: no quote record anywhere
      daysSince: 6,
      hasQuoteEvidence: false,
    });
    expect(title).toBe("跟進提醒:eyoung@axt.com 上次聯絡後 6 天沒回");
    expect(title).not.toContain("報價");
    expect(body).not.toContain("報價");
    expect(body).toContain("6 天沒下文");
  });
});
