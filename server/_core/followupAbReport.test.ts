/**
 * followupAbReport — pure scoreboard math. The DB read (getFollowupAbReport)
 * is a thin wrapper verified live; the load-bearing logic is the edit-distance
 * metric and the per-arm aggregation, both pure and asserted here.
 */
import { describe, it, expect } from "vitest";
import {
  normalizedEditDistance,
  summarizeFollowupAb,
  type FollowupAbRow,
} from "./followupAbReport";

const ctx = (o: Record<string, unknown>) => JSON.stringify({ promptVariant: "B", ...o });

describe("normalizedEditDistance", () => {
  it("is 0 for identical strings (sent verbatim)", () => {
    expect(normalizedEditDistance("早安王姊姊", "早安王姊姊")).toBe(0);
  });
  it("is 1 when one side is empty", () => {
    expect(normalizedEditDistance("", "abc")).toBe(1);
    expect(normalizedEditDistance("abc", "")).toBe(1);
  });
  it("grows with the amount rewritten", () => {
    const small = normalizedEditDistance("您好嗎", "您好嘛"); // 1 char of 3
    const big = normalizedEditDistance("您好嗎", "完全不同的一句話");
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(big);
    expect(big).toBeLessThanOrEqual(1);
  });
  it("is symmetric", () => {
    expect(normalizedEditDistance("abcd", "abce")).toBe(normalizedEditDistance("abce", "abcd"));
  });
});

describe("summarizeFollowupAb", () => {
  it("ignores rows without a recognized A/B variant", () => {
    const rows: FollowupAbRow[] = [
      { context: JSON.stringify({ draftReply: "x" }), jeffResponse: null, readByJeff: 0 }, // no variant
      { context: "not json", jeffResponse: null, readByJeff: 0 },
      { context: null, jeffResponse: null, readByJeff: 0 },
    ];
    const r = summarizeFollowupAb(rows);
    expect(r.arms.find((a) => a.variant === "A")!.drafted).toBe(0);
    expect(r.arms.find((a) => a.variant === "B")!.drafted).toBe(0);
    expect(r.leader).toBeNull();
  });

  it("counts drafted vs sent and computes send rate per arm", () => {
    const rows: FollowupAbRow[] = [
      // A: 2 drafted, 1 sent
      { context: JSON.stringify({ promptVariant: "A", draftReply: "您好" }), jeffResponse: "您好", readByJeff: 1 },
      { context: JSON.stringify({ promptVariant: "A", draftReply: "您好" }), jeffResponse: null, readByJeff: 0 },
      // B: 1 drafted, 1 sent
      { context: JSON.stringify({ promptVariant: "B", draftReply: "您好" }), jeffResponse: "您好", readByJeff: 1 },
    ];
    const r = summarizeFollowupAb(rows);
    const A = r.arms.find((a) => a.variant === "A")!;
    const B = r.arms.find((a) => a.variant === "B")!;
    expect(A.drafted).toBe(2);
    expect(A.sent).toBe(1);
    expect(A.sendRate).toBe(0.5);
    expect(B.drafted).toBe(1);
    expect(B.sendRate).toBe(1);
  });

  it("a verbatim send scores 0 edit ratio; a rewrite scores higher", () => {
    const rows: FollowupAbRow[] = [
      // A sent verbatim → edit 0
      { context: ctx({ promptVariant: "A", draftReply: "王姊姊最近好嗎" }), jeffResponse: "王姊姊最近好嗎", readByJeff: 1 },
      // B heavily rewritten → edit > 0
      { context: ctx({ promptVariant: "B", draftReply: "王姊姊最近好嗎" }), jeffResponse: "完全改寫成另一段話了啦", readByJeff: 1 },
    ];
    const r = summarizeFollowupAb(rows);
    const A = r.arms.find((a) => a.variant === "A")!;
    const B = r.arms.find((a) => a.variant === "B")!;
    expect(A.meanEditRatioSent).toBe(0);
    expect(B.meanEditRatioSent).toBeGreaterThan(0);
    // lower edit ratio wins
    expect(r.leader).toBe("A");
  });

  it("leader stays null until BOTH arms have sent data", () => {
    const rows: FollowupAbRow[] = [
      { context: ctx({ promptVariant: "B", draftReply: "您好" }), jeffResponse: "您好改一點", readByJeff: 1 },
    ];
    const r = summarizeFollowupAb(rows);
    expect(r.arms.find((a) => a.variant === "A")!.meanEditRatioSent).toBeNull();
    expect(r.leader).toBeNull();
  });

  it("does not count a draft as sent without both jeffResponse and a draftReply", () => {
    const rows: FollowupAbRow[] = [
      { context: ctx({ promptVariant: "B", draftReply: "您好" }), jeffResponse: "   ", readByJeff: 1 }, // blank send
      { context: ctx({ promptVariant: "B" }), jeffResponse: "有回覆", readByJeff: 1 }, // no draftReply
    ];
    const r = summarizeFollowupAb(rows);
    const B = r.arms.find((a) => a.variant === "B")!;
    expect(B.drafted).toBe(2);
    expect(B.sent).toBe(0);
    expect(B.meanEditRatioSent).toBeNull();
  });
});
