import { describe, it, expect } from "vitest";
import {
  classifyFinanceAlertRisk,
  assertFinanceRiskLevel,
} from "./financeAlertClassifier";

describe("financeAlertClassifier", () => {
  it("always returns review", () => {
    const result = classifyFinanceAlertRisk();
    expect(result.riskLevel).toBe("review");
    expect(result.reason).toContain("review");
  });

  it("never returns auto", () => {
    const result = classifyFinanceAlertRisk();
    expect(result.riskLevel).not.toBe("auto");
  });

  it("never returns hard_gate", () => {
    const result = classifyFinanceAlertRisk();
    expect(result.riskLevel).not.toBe("hard_gate");
  });

  it("assertFinanceRiskLevel accepts review", () => {
    expect(assertFinanceRiskLevel("review")).toBe(true);
  });

  it("assertFinanceRiskLevel rejects auto", () => {
    expect(assertFinanceRiskLevel("auto")).toBe(false);
  });

  it("assertFinanceRiskLevel rejects hard_gate", () => {
    expect(assertFinanceRiskLevel("hard_gate")).toBe(false);
  });
});
