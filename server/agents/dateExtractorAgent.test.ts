/**
 * Round 79: Capacity (人數) extraction tests for dateExtractorAgent.
 * Covers Jeff-flagged precision regressions — regex strategies handle the
 * common ZH-TW headcount phrasings that the Vision model used to confuse
 * (max vs min, ranges, "X 人成行" mistaken for max).
 */
import { describe, it, expect } from "vitest";
import { extractCapacityFromText } from "./dateExtractorAgent";

describe("extractCapacityFromText", () => {
  it("extracts max from 「最多 X 人」", () => {
    expect(extractCapacityFromText("本團最多 32 人")).toEqual({
      maxParticipants: 32,
      minParticipants: undefined,
    });
  });

  it("extracts max from 「上限」 / 「不超過」", () => {
    expect(extractCapacityFromText("人數上限 28 人").maxParticipants).toBe(28);
    expect(extractCapacityFromText("不超過 24 位").maxParticipants).toBe(24);
  });

  it("extracts min from 「最少 X 人成團」", () => {
    expect(extractCapacityFromText("最少 16 人成團").minParticipants).toBe(16);
  });

  it("extracts min from 「X 人成行」 — was previously mistaken as max", () => {
    expect(extractCapacityFromText("2 人成行")).toEqual({
      maxParticipants: 0,
      minParticipants: 2,
    });
    expect(extractCapacityFromText("16 人成行").minParticipants).toBe(16);
  });

  it("extracts both from range 「16-32 人」", () => {
    expect(extractCapacityFromText("團體規模 16-32 人")).toEqual({
      maxParticipants: 32,
      minParticipants: 16,
    });
  });

  it("handles range with 〜 and 至", () => {
    expect(extractCapacityFromText("16~32 人")).toMatchObject({ minParticipants: 16, maxParticipants: 32 });
    expect(extractCapacityFromText("16 至 32 人")).toMatchObject({ minParticipants: 16, maxParticipants: 32 });
  });

  it("English 'maximum' / 'min' terms work", () => {
    expect(extractCapacityFromText("Maximum 30 people").maxParticipants).toBe(30);
    expect(extractCapacityFromText("Min 10 pax").minParticipants).toBe(10);
  });

  it("rejects unreasonable values (max > 200)", () => {
    expect(extractCapacityFromText("最多 9999 人").maxParticipants).toBe(0);
  });

  it("swaps reversed range (defensive)", () => {
    // If patterns ever produce min > max, the validator should swap rather
    // than persist nonsense.
    expect(extractCapacityFromText("最多 16 人，最少 32 人")).toMatchObject({
      maxParticipants: 32,
      minParticipants: 16,
    });
  });

  it("returns zeros when no headcount mentioned", () => {
    expect(extractCapacityFromText("這是一個美麗的日本行程，價格 $50,000")).toEqual({
      maxParticipants: 0,
      minParticipants: undefined,
    });
  });

  it("max-only with bare 「每團 X 人」", () => {
    expect(extractCapacityFromText("每團 30 人").maxParticipants).toBe(30);
  });
});
