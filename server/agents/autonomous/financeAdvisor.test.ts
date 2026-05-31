import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the financial services (dynamically imported by the advisor)
vi.mock("../../services/bankPLService", () => ({
  generateBankPL: vi.fn().mockResolvedValue({
    income: { total: 10000 },
    expenses: { total: 5000, cogs: 3000, operating: 2000 },
    refunds: 100,
    trustDeferredIncome: 500,
    netProfit: 4400,
    profitMargin: 44,
    transactionCount: 25,
    needsReviewCount: 3,
    needsReviewAmount: 150,
  }),
}));

vi.mock("../../services/financialReportService", () => ({
  generateMonthlyTrend: vi.fn().mockResolvedValue([
    { month: "2026-05", income: 10000, expenses: 5000, trustDeferredIncome: 500, netProfit: 4500 },
  ]),
  generateTaxSummary: vi.fn().mockResolvedValue({
    totalIncome: 60000,
    totalExpenses: 30000,
    taxDeductibleExpenses: 28000,
    estimatedTaxableIncome: 32000,
  }),
}));

vi.mock("../../services/trustDeferralService", () => ({
  totalDeferredForUser: vi.fn().mockResolvedValue(5000),
  isTrustDeferralEnabled: vi.fn().mockReturnValue(true),
}));

// Capture the system prompt from invokeLLM
let capturedSystemPrompt = "";
const mockInvokeLLM = vi.fn().mockImplementation(async (params: any) => {
  capturedSystemPrompt = params.messages[0]?.content ?? "";
  return {
    choices: [
      { message: { content: "Your net profit this month is $4,400." } },
    ],
    model: "claude-haiku-4-5",
  };
});

vi.mock("../../_core/llm", () => ({
  invokeLLM: (...args: any[]) => mockInvokeLLM(...args),
}));

import { askFinanceAdvisor } from "./financeAdvisor";

beforeEach(() => {
  vi.clearAllMocks();
  capturedSystemPrompt = "";
});

describe("financeAdvisor", () => {
  it("returns an answer string", async () => {
    const answer = await askFinanceAdvisor("What is net profit this month?");
    expect(typeof answer).toBe("string");
    expect(answer.length).toBeGreaterThan(0);
  });

  it("calls invokeLLM with the question", async () => {
    await askFinanceAdvisor("What is net profit?");
    expect(mockInvokeLLM).toHaveBeenCalledOnce();
    const call = mockInvokeLLM.mock.calls[0][0];
    expect(call.messages[1].content).toBe("What is net profit?");
  });

  it("system prompt contains read-only safety directive", async () => {
    await askFinanceAdvisor("test");
    expect(capturedSystemPrompt).toContain("READ-ONLY");
    expect(capturedSystemPrompt).toContain("MUST NOT");
    expect(capturedSystemPrompt).toContain("money transfers");
  });

  it("system prompt contains real financial data", async () => {
    await askFinanceAdvisor("test");
    expect(capturedSystemPrompt).toContain("Net Profit");
    expect(capturedSystemPrompt).toContain("CURRENT MONTH P&L");
  });

  it("system prompt mentions CST §17550", async () => {
    await askFinanceAdvisor("test");
    expect(capturedSystemPrompt).toContain("CST §17550");
    expect(capturedSystemPrompt).toContain("Trust");
  });

  it("returns fallback when invokeLLM fails", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("network error"));
    const answer = await askFinanceAdvisor("test");
    expect(answer).toContain("unavailable");
  });

  it("uses haiku model for cost efficiency", async () => {
    await askFinanceAdvisor("test");
    const call = mockInvokeLLM.mock.calls[0][0];
    expect(call.model).toBe("claude-haiku-4-5");
  });
});
