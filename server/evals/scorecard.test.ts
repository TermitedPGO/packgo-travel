/**
 * Vitest — scorecard 純彙整邏輯。完全不碰 LLM,窮舉門檻邊界。
 */

import { describe, it, expect } from "vitest";
import { buildScorecard, caseChecksPass, formatScorecard } from "./scorecard";
import type { CaseResult, JudgeVerdict } from "./types";

function judge(overall: number, pass: boolean): JudgeVerdict {
  return {
    overall,
    pass,
    summary: "test",
    dimensions: [
      { name: "correctness", score: overall, reasoning: "" },
      { name: "tone", score: overall, reasoning: "" },
      { name: "safety", score: overall, reasoning: "" },
      { name: "completeness", score: overall, reasoning: "" },
    ],
  };
}

function caseResult(over: Partial<CaseResult>): CaseResult {
  return {
    caseId: "c",
    description: "d",
    actualClassification: "quote_request",
    checks: [{ name: "classification", pass: true }],
    judge: judge(90, true),
    ...over,
  };
}

describe("caseChecksPass", () => {
  it("passes when every check passes and no error", () => {
    expect(caseChecksPass(caseResult({}))).toBe(true);
  });

  it("fails on error even if checks pass", () => {
    expect(caseChecksPass(caseResult({ error: "boom" }))).toBe(false);
  });

  it("fails when any check fails", () => {
    expect(
      caseChecksPass(
        caseResult({ checks: [{ name: "classification", pass: false }] })
      )
    ).toBe(false);
  });

  it("passes vacuously when there are no checks", () => {
    expect(caseChecksPass(caseResult({ checks: [] }))).toBe(true);
  });
});

describe("buildScorecard", () => {
  it("computes pass when all classifications correct and judge high", () => {
    const card = buildScorecard([caseResult({}), caseResult({})]);
    expect(card.total).toBe(2);
    expect(card.classificationPass).toBe(2);
    expect(card.avgJudgeScore).toBe(90);
    expect(card.judgePass).toBe(2);
    expect(card.pass).toBe(true);
  });

  it("fails overall when one classification is wrong (rate < 1.0)", () => {
    const card = buildScorecard([
      caseResult({}),
      caseResult({ checks: [{ name: "classification", pass: false }] }),
    ]);
    expect(card.classificationPass).toBe(1);
    expect(card.pass).toBe(false);
  });

  it("fails overall when avg judge score below threshold", () => {
    const card = buildScorecard([
      caseResult({ judge: judge(70, true) }),
      caseResult({ judge: judge(70, true) }),
    ]);
    expect(card.avgJudgeScore).toBe(70);
    expect(card.pass).toBe(false);
  });

  it("fails overall when any judge.pass is false (safety red line)", () => {
    const card = buildScorecard([
      caseResult({}),
      caseResult({ judge: judge(95, false) }),
    ]);
    // avg still high, classification fine, but a safety fail sinks the suite
    expect(card.pass).toBe(false);
  });

  it("handles cases with no judge (avgJudgeScore null, still gated on classification)", () => {
    const card = buildScorecard([caseResult({ judge: null })]);
    expect(card.judged).toBe(0);
    expect(card.avgJudgeScore).toBeNull();
    expect(card.pass).toBe(true);
  });

  it("empty input passes vacuously", () => {
    const card = buildScorecard([]);
    expect(card.total).toBe(0);
    expect(card.pass).toBe(true);
  });
});

describe("formatScorecard", () => {
  it("renders PASS/FAIL summary lines without throwing", () => {
    const out = formatScorecard(buildScorecard([caseResult({})]));
    expect(out).toContain("INQUIRY AGENT EVAL");
    expect(out).toContain("OVERALL:");
    expect(out).toContain("PASS");
  });

  it("surfaces error and failing-check detail lines", () => {
    const out = formatScorecard(
      buildScorecard([
        caseResult({
          error: "agent threw",
          checks: [{ name: "agent_run", pass: false, detail: "agent threw" }],
          judge: null,
        }),
      ])
    );
    expect(out).toContain("error: agent threw");
  });
});
