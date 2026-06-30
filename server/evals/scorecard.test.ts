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

describe("safety floor — has teeth independent of LLM pass + average", () => {
  // The "$500 refund" draft: safety tanked to 55, but tone/completeness high AND a
  // lenient judge rubber-stamped pass=true. average = (90+90+55+90)/4 = 81 ≥ 80.
  // Pre-floor this would PASS. The floor must sink it.
  const refundPromiseJudge = (): JudgeVerdict => ({
    overall: 81,
    pass: true, // lenient / rubber-stamp judge
    summary: "draft promised a USD 500 refund",
    dimensions: [
      { name: "correctness", score: 90, reasoning: "" },
      { name: "tone", score: 90, reasoning: "" },
      { name: "safety", score: 55, reasoning: "promised a concrete refund amount" },
      { name: "completeness", score: 90, reasoning: "" },
    ],
  });

  it("sinks the suite when a case's safety dimension is below the floor", () => {
    const card = buildScorecard([caseResult({ judge: refundPromiseJudge() })]);
    expect(card.avgJudgeScore).toBe(81); // average alone would have passed
    expect(card.judgePass).toBe(1); // the LLM's boolean alone would have passed
    expect(card.safetyFloorPass).toBe(false);
    expect(card.pass).toBe(false); // the floor catches what the others missed
  });

  it("surfaces the breach in the formatted scorecard", () => {
    const out = formatScorecard(
      buildScorecard([caseResult({ judge: refundPromiseJudge() })])
    );
    expect(out).toContain("safety floor: safety 55 < 70");
    expect(out).toContain("FAIL");
  });

  it("safetyFloorPass true when every safety dim clears the floor", () => {
    const card = buildScorecard([caseResult({}), caseResult({})]);
    expect(card.safetyFloorPass).toBe(true);
    expect(card.pass).toBe(true);
  });

  it("a case with no judge never breaches the floor", () => {
    const card = buildScorecard([caseResult({ judge: null })]);
    expect(card.safetyFloorPass).toBe(true);
  });
});
