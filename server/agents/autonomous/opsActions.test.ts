/**
 * Tests for opsActions — focusing on the 4 new commandCenter action types.
 * Existing action types (sendCustomerEmail etc.) are already exercised via
 * manual testing; these tests cover the new integration surface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock finance producers/advisors (dynamically imported by the actions)
const mockProduceFinanceAlerts = vi.fn();
const mockAskFinanceAdvisor = vi.fn();
const mockGenerateTaxCsv = vi.fn();
const mockRunInquiryAgent = vi.fn();
const mockProduceInquiryReplyTask = vi.fn();
const mockGetInquiryById = vi.fn();

vi.mock("./financeAlertProducer", () => ({
  produceFinanceAlerts: (...args: any[]) => mockProduceFinanceAlerts(...args),
}));

vi.mock("./financeAdvisor", () => ({
  askFinanceAdvisor: (...args: any[]) => mockAskFinanceAdvisor(...args),
}));

vi.mock("../../services/taxCsvService", () => ({
  generateTaxCsv: (...args: any[]) => mockGenerateTaxCsv(...args),
}));

vi.mock("./inquiryAgent", () => ({
  runInquiryAgent: (...args: any[]) => mockRunInquiryAgent(...args),
}));

vi.mock("./inquiryReplyProducer", () => ({
  produceInquiryReplyTask: (...args: any[]) => mockProduceInquiryReplyTask(...args),
}));

vi.mock("../../db", () => ({
  getInquiryById: (...args: any[]) => mockGetInquiryById(...args),
  getDb: vi.fn().mockResolvedValue(null),
}));

import { executeOpsAction, ActionTypeEnum } from "./opsActions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ActionTypeEnum includes commandCenter types", () => {
  it("accepts runFinanceAlerts", () => {
    expect(ActionTypeEnum.safeParse("runFinanceAlerts").success).toBe(true);
  });
  it("accepts askFinanceAdvisor", () => {
    expect(ActionTypeEnum.safeParse("askFinanceAdvisor").success).toBe(true);
  });
  it("accepts produceInquiryReply", () => {
    expect(ActionTypeEnum.safeParse("produceInquiryReply").success).toBe(true);
  });
  it("accepts downloadTaxCsv", () => {
    expect(ActionTypeEnum.safeParse("downloadTaxCsv").success).toBe(true);
  });
  it("rejects unknown", () => {
    expect(ActionTypeEnum.safeParse("foobar").success).toBe(false);
  });
  // Existing types still accepted
  it("still accepts sendCustomerEmail", () => {
    expect(ActionTypeEnum.safeParse("sendCustomerEmail").success).toBe(true);
  });
});

describe("executeOpsAction — runFinanceAlerts", () => {
  it("returns ok with produced count", async () => {
    mockProduceFinanceAlerts.mockResolvedValue({ produced: 3 });
    const result = await executeOpsAction("runFinanceAlerts", {});
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("3");
    expect(result.details).toEqual({ produced: 3 });
  });

  it("handles error gracefully", async () => {
    mockProduceFinanceAlerts.mockRejectedValue(new Error("db down"));
    const result = await executeOpsAction("runFinanceAlerts", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("db down");
  });
});

describe("executeOpsAction — askFinanceAdvisor", () => {
  it("returns advisor answer in summary", async () => {
    mockAskFinanceAdvisor.mockResolvedValue("Your net profit is $4,400.");
    const result = await executeOpsAction("askFinanceAdvisor", {
      question: "net profit?",
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("$4,400");
  });

  it("truncates long answers in summary", async () => {
    mockAskFinanceAdvisor.mockResolvedValue("A".repeat(300));
    const result = await executeOpsAction("askFinanceAdvisor", {
      question: "test",
    });
    expect(result.ok).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(204); // 200 + "…"
  });

  it("validates question arg", async () => {
    const result = await executeOpsAction("askFinanceAdvisor", {});
    expect(result.ok).toBe(false);
  });
});

describe("executeOpsAction — produceInquiryReply", () => {
  it("returns ok with task details", async () => {
    mockGetInquiryById.mockResolvedValue({
      id: 42,
      subject: "Test inquiry",
      message: "I want to book a tour",
      customerEmail: "test@example.com",
      customerName: "Test User",
    });
    mockRunInquiryAgent.mockResolvedValue({
      draftReply: "Thank you for your interest!",
      classification: "new_inquiry",
      confidence: 0.9,
      urgency: "normal",
      intent: "booking inquiry",
      draftLanguage: "en",
    });
    mockProduceInquiryReplyTask.mockResolvedValue({ id: 100, riskLevel: "review" });

    const result = await executeOpsAction("produceInquiryReply", { inquiryId: 42 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("#42");
    expect(result.summary).toContain("#100");
  });

  it("returns error when inquiry not found", async () => {
    mockGetInquiryById.mockResolvedValue(null);
    const result = await executeOpsAction("produceInquiryReply", { inquiryId: 999 });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("999");
  });
});

describe("executeOpsAction — downloadTaxCsv", () => {
  it("returns ok with CSV metadata", async () => {
    mockGenerateTaxCsv.mockResolvedValue("Category,Jan,...\nIncome,1000,...");
    const result = await executeOpsAction("downloadTaxCsv", { year: 2026 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("2026");
    expect(result.details).toHaveProperty("filename", "packgo-schedule-c-2026.csv");
  });

  it("validates year range", async () => {
    const result = await executeOpsAction("downloadTaxCsv", { year: 2010 });
    expect(result.ok).toBe(false); // zod validation fails
  });
});

// ── PACK&GO Agent expansion (2026-06-01) ────────────────────────────────

const mockClassifyBatch = vi.fn();
const mockDraftReply = vi.fn();

vi.mock("../../services/accountingAgentService", () => ({
  classifyUncategorizedBatch: (...args: any[]) => mockClassifyBatch(...args),
}));

vi.mock("../../services/wechatAssistService", () => ({
  draftReply: (...args: any[]) => mockDraftReply(...args),
}));

describe("ActionTypeEnum includes expansion types", () => {
  it("accepts classifyBankTransactions", () => {
    expect(ActionTypeEnum.safeParse("classifyBankTransactions").success).toBe(true);
  });
  it("accepts draftWechatReply", () => {
    expect(ActionTypeEnum.safeParse("draftWechatReply").success).toBe(true);
  });
});

describe("executeOpsAction — classifyBankTransactions", () => {
  it("returns ok with classify results", async () => {
    mockClassifyBatch.mockResolvedValue({
      processed: 13,
      succeeded: 10,
      failed: 3,
      needsReviewCount: 4,
      byCategory: { cogs_tour: 5, transfer: 3, other_review: 2 },
    });
    const result = await executeOpsAction("classifyBankTransactions", { limit: 20 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("10");
    expect(result.details).toHaveProperty("processed", 13);
  });

  it("works with no args (default limit)", async () => {
    mockClassifyBatch.mockResolvedValue({
      processed: 0, succeeded: 0, failed: 0, needsReviewCount: 0, byCategory: {},
    });
    const result = await executeOpsAction("classifyBankTransactions", undefined);
    expect(result.ok).toBe(true);
  });

  it("handles error gracefully", async () => {
    mockClassifyBatch.mockRejectedValue(new Error("db down"));
    const result = await executeOpsAction("classifyBankTransactions", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("db down");
  });
});

describe("executeOpsAction — draftWechatReply", () => {
  it("returns ok with draft text", async () => {
    mockDraftReply.mockResolvedValue({
      draftText: "Hi there, thanks for your interest!",
      confidence: 85,
      detectedIntent: ["booking_inquiry"],
      messageId: null,
    });
    const result = await executeOpsAction("draftWechatReply", {
      customerName: "Test",
      incomingMessage: "I want to book a tour",
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Hi there");
  });

  it("validates required args", async () => {
    const result = await executeOpsAction("draftWechatReply", {});
    expect(result.ok).toBe(false);
  });

  it("handles service error", async () => {
    mockDraftReply.mockRejectedValue(new Error("LLM timeout"));
    const result = await executeOpsAction("draftWechatReply", {
      customerName: "X",
      incomingMessage: "Hello",
    });
    expect(result.ok).toBe(false);
  });
});

// ── gmail-full-thread-filing: 指名收客人 ─────────────────────────────────

describe("ActionTypeEnum includes collectCustomerThreads", () => {
  it("accepts collectCustomerThreads", () => {
    expect(ActionTypeEnum.safeParse("collectCustomerThreads").success).toBe(true);
  });
});

describe("executeOpsAction — collectCustomerThreads", () => {
  it("rejects a bad email arg (zod)", async () => {
    const result = await executeOpsAction("collectCustomerThreads", { email: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("degrades gracefully when the DB is unavailable", async () => {
    // ../../db getDb is mocked to resolve null in this file.
    const result = await executeOpsAction("collectCustomerThreads", { email: "eyoung@axt.com" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_db");
  });
});
