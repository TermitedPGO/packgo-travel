/**
 * Tests for the 指揮中心 客服頁 producer (P1-b).
 *
 * design.md §3 P1-b contract:
 *   - turns an InquiryAgent output into a createApprovalTask input with
 *     lane:"cs", taskType:"inquiry_reply", the right payload fields, and a
 *     riskLevel sourced from the P1-c classifier.
 *
 * createApprovalTask is mocked so we assert the row it would write without a DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../_core/approvalTasks", () => ({
  createApprovalTask: vi.fn(),
}));

vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  buildInquiryReplyTaskInput,
  produceInquiryReplyTask,
} from "./inquiryReplyProducer";
import { createApprovalTask } from "../../_core/approvalTasks";
import type { InquiryAgentOutput } from "./inquiryAgent";

const createMock = vi.mocked(createApprovalTask);

/** A benign agent output (classifies as review on neutral text). */
function agentOutput(
  overrides: Partial<InquiryAgentOutput> = {},
): InquiryAgentOutput {
  return {
    classification: "new_inquiry",
    intent: "Customer wants Hawaii tour options for August.",
    urgency: "normal",
    sentiment: "positive",
    shouldAutoReply: true,
    shouldEscalate: false,
    draftReply: "您好，感謝您的詢問，我們很樂意為您規劃夏威夷行程…",
    draftLanguage: "zh-TW",
    extractedCustomer: {},
    confidence: 82,
    reasoning: "Clear new inquiry.",
    ...overrides,
  };
}

const inquiry = {
  inquiryId: 10,
  customerEmail: "jane@example.com",
  customerName: "王小姐",
  subject: "夏威夷行程詢問",
  inquiryText: "夏威夷行程詢問\n想了解八月的夏威夷團",
};

describe("buildInquiryReplyTaskInput", () => {
  it("builds a cs / inquiry_reply task with the correct payload + refs", () => {
    const input = buildInquiryReplyTaskInput(inquiry, agentOutput());

    expect(input.lane).toBe("cs");
    expect(input.taskType).toBe("inquiry_reply");
    expect(input.createdBy).toBe("InquiryAgent");
    expect(input.relatedType).toBe("inquiry");
    expect(input.relatedId).toBe("10");
    expect(input.title).toContain("王小姐");
    expect(input.title).toContain("夏威夷行程詢問");

    const payload = JSON.parse(input.payload);
    expect(payload).toMatchObject({
      inquiryId: 10,
      draftBody: "您好，感謝您的詢問，我們很樂意為您規劃夏威夷行程…",
      customerEmail: "jane@example.com",
      customerName: "王小姐",
      subject: "夏威夷行程詢問",
      classification: "new_inquiry",
      confidence: 82,
      language: "zh-TW",
    });
  });

  it("benign inquiry → riskLevel review", () => {
    const input = buildInquiryReplyTaskInput(inquiry, agentOutput());
    expect(input.riskLevel).toBe("review");
  });

  it("refund keyword in inquiry text → riskLevel hard_gate", () => {
    const input = buildInquiryReplyTaskInput(
      { ...inquiry, inquiryText: "我要退款，行程取消了" },
      agentOutput(),
    );
    expect(input.riskLevel).toBe("hard_gate");
  });

  it("complaint classification → riskLevel hard_gate", () => {
    const input = buildInquiryReplyTaskInput(
      inquiry,
      agentOutput({ classification: "complaint" }),
    );
    expect(input.riskLevel).toBe("hard_gate");
  });

  it("critical urgency → riskLevel hard_gate", () => {
    const input = buildInquiryReplyTaskInput(
      inquiry,
      agentOutput({ urgency: "critical" }),
    );
    expect(input.riskLevel).toBe("hard_gate");
  });

  it("falls back to subject when inquiryText is omitted", () => {
    const { inquiryText, ...noText } = inquiry;
    const input = buildInquiryReplyTaskInput(noText, agentOutput());
    // Subject has no sensitive keyword → review.
    expect(input.riskLevel).toBe("review");
    expect(JSON.parse(input.payload).subject).toBe("夏威夷行程詢問");
  });

  it("never emits riskLevel auto for the cs lane", () => {
    const variants: Array<Partial<InquiryAgentOutput>> = [
      {},
      { classification: "complaint" },
      { classification: "refund_request" },
      { urgency: "critical" },
      { classification: "general_info", urgency: "low" },
    ];
    for (const v of variants) {
      const input = buildInquiryReplyTaskInput(inquiry, agentOutput(v));
      expect(input.riskLevel).not.toBe("auto");
    }
  });
});

describe("produceInquiryReplyTask", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes one task via createApprovalTask and returns its id + riskLevel", async () => {
    createMock.mockResolvedValue({ id: 77 });

    const res = await produceInquiryReplyTask(inquiry, agentOutput());

    expect(createMock).toHaveBeenCalledTimes(1);
    const row = createMock.mock.calls[0][0];
    expect(row.lane).toBe("cs");
    expect(row.taskType).toBe("inquiry_reply");
    expect(row.riskLevel).toBe("review");
    expect(res).toEqual({ id: 77, riskLevel: "review" });
  });

  it("passes ctx through to createApprovalTask for auditing", async () => {
    createMock.mockResolvedValue({ id: 78 });
    const ctx = { user: { id: 42, email: "jeff@packgo.com", role: "admin" } };

    await produceInquiryReplyTask(inquiry, agentOutput(), ctx);

    expect(createMock.mock.calls[0][1]).toBe(ctx);
  });
});
