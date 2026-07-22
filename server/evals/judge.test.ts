/**
 * Vitest — judge 的純解析邏輯(parseJudgeVerdict)。不打真 LLM。
 * 驗:維度平均、分數 clamp、safety pass 透傳、缺欄位的容錯。
 */

import { describe, it, expect } from "vitest";
import { parseJudgeVerdict, JUDGE_DIMENSIONS } from "./judge";

describe("parseJudgeVerdict", () => {
  it("averages the four dimensions into overall", () => {
    const v = parseJudgeVerdict({
      correctness: 80,
      tone: 90,
      safety: 100,
      completeness: 70,
      pass: true,
      summary: "good",
    });
    expect(v.overall).toBe(85); // (80+90+100+70)/4
    expect(v.pass).toBe(true);
    expect(v.summary).toBe("good");
    expect(v.dimensions.map((d) => d.name)).toEqual([...JUDGE_DIMENSIONS]);
  });

  it("clamps out-of-range and non-numeric scores to 0–100", () => {
    const v = parseJudgeVerdict({
      correctness: 150,
      tone: -20,
      safety: "oops",
      completeness: 50.6,
      pass: false,
      summary: "x",
    });
    const byName = Object.fromEntries(v.dimensions.map((d) => [d.name, d.score]));
    expect(byName.correctness).toBe(100);
    expect(byName.tone).toBe(0);
    expect(byName.safety).toBe(0);
    expect(byName.completeness).toBe(51); // rounded
  });

  it("treats pass strictly: only boolean true passes", () => {
    expect(parseJudgeVerdict({ pass: "true", summary: "" }).pass).toBe(false);
    expect(parseJudgeVerdict({ pass: 1, summary: "" }).pass).toBe(false);
    expect(parseJudgeVerdict({ pass: true, summary: "" }).pass).toBe(true);
  });

  it("captures per-dimension reasoning when present, empty string otherwise", () => {
    const v = parseJudgeVerdict({
      correctness: 90,
      correctness_reason: "addresses the ask",
      pass: true,
      summary: "",
    });
    const c = v.dimensions.find((d) => d.name === "correctness")!;
    expect(c.reasoning).toBe("addresses the ask");
    const t = v.dimensions.find((d) => d.name === "tone")!;
    expect(t.reasoning).toBe("");
  });

  it("defaults missing scores to 0 (absent dimension)", () => {
    const v = parseJudgeVerdict({ pass: false, summary: "" });
    expect(v.overall).toBe(0);
    expect(v.dimensions.every((d) => d.score === 0)).toBe(true);
  });
});
