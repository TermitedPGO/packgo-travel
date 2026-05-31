/**
 * Tests for the 指揮中心 客服頁 executor (P1-d).
 *
 * design.md §3 P1-d contract:
 *   - registered under taskType "inquiry_reply"; the spine can dispatch it.
 *   - success path: parses payload → sendAdminInquiryReply → { status:"sent" }.
 *   - failure path: send returns false / rejects → { status:"failed" } and
 *     NEVER throws (ApprovalExecutor contract).
 *   - invalid payload → { status:"failed" } without throwing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the shared reply helper — the executor's only real collaborator.
vi.mock("../../_core/inquiryReply", () => ({
  sendAdminInquiryReply: vi.fn(),
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
  inquiryReplyExecutor,
  registerCsExecutors,
  INQUIRY_REPLY_TASK_TYPE,
} from "./inquiryReplyExecutor";
import { sendAdminInquiryReply } from "../../_core/inquiryReply";
import {
  getApprovalExecutor,
  type ApprovalTask,
} from "../../_core/approvalTasks";

const sendMock = vi.mocked(sendAdminInquiryReply);

/** Build an approved cs task row with a valid inquiry_reply payload. */
function task(overrides: Partial<ApprovalTask> = {}): ApprovalTask {
  return {
    id: 1,
    lane: "cs",
    taskType: "inquiry_reply",
    riskLevel: "review",
    status: "approved",
    title: "王小姐 · 夏威夷行程詢問",
    summary: null,
    payload: JSON.stringify({
      inquiryId: 10,
      draftBody: "您好，這是我們的回覆內容。",
      customerEmail: "jane@example.com",
      customerName: "王小姐",
      subject: "夏威夷行程詢問",
    }),
    relatedType: "inquiry",
    relatedId: "10",
    createdBy: "InquiryAgent",
    decidedBy: 42,
    decidedAt: new Date(),
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ApprovalTask;
}

describe("registerCsExecutors — registration is dispatchable", () => {
  it("after registerCsExecutors() the spine resolves the executor by taskType", () => {
    // This is the EXACT code path server/routers/commandCenter.ts runs at
    // module load (which runs at server boot, since routers.ts imports the
    // commandCenter router to build appRouter). Calling it here proves the
    // wiring makes approve() dispatchable to this executor.
    registerCsExecutors();
    expect(INQUIRY_REPLY_TASK_TYPE).toBe("inquiry_reply");
    expect(getApprovalExecutor("inquiry_reply")).toBe(inquiryReplyExecutor);
  });

  it("registerCsExecutors() is idempotent (safe to call repeatedly)", () => {
    // Calling again must not throw and must keep the same executor mapped.
    registerCsExecutors();
    registerCsExecutors();
    expect(getApprovalExecutor("inquiry_reply")).toBe(inquiryReplyExecutor);
  });
});

describe("inquiryReplyExecutor — success path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the reply and returns { status: 'sent' }", async () => {
    sendMock.mockResolvedValue({ emailSent: true, messageId: 500 });

    const res = await inquiryReplyExecutor(task());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toEqual({
      inquiryId: 10,
      body: "您好，這是我們的回覆內容。",
      senderId: 42,
    });
    expect(res).toEqual({ status: "sent" });
  });

  it("uses the EDITED draftBody from the (possibly edited) payload", async () => {
    sendMock.mockResolvedValue({ emailSent: true, messageId: 501 });

    const edited = task({
      payload: JSON.stringify({
        inquiryId: 10,
        draftBody: "這是 Jeff 改過的內容。",
      }),
    });
    await inquiryReplyExecutor(edited);

    expect(sendMock.mock.calls[0][0].body).toBe("這是 Jeff 改過的內容。");
  });
});

describe("inquiryReplyExecutor — failure path (never throws)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("email not sent (returns false) → { status: 'failed' }, no throw", async () => {
    sendMock.mockResolvedValue({ emailSent: false, errorMessage: "bounced" });

    const res = await inquiryReplyExecutor(task());

    expect(res.status).toBe("failed");
    expect(res.errorMessage).toBeDefined();
  });

  it("sendAdminInquiryReply rejects → { status: 'failed' }, no throw", async () => {
    sendMock.mockRejectedValue(new Error("db exploded"));

    // Must resolve, not throw.
    const res = await inquiryReplyExecutor(task());

    expect(res.status).toBe("failed");
    expect(res.errorMessage).toContain("db exploded");
  });

  it("invalid payload (no draftBody) → { status: 'failed' }, never calls send", async () => {
    const bad = task({ payload: JSON.stringify({ inquiryId: 10 }) });

    const res = await inquiryReplyExecutor(bad);

    expect(res.status).toBe("failed");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("non-JSON payload → { status: 'failed' }, never calls send", async () => {
    const bad = task({ payload: "not json at all" });

    const res = await inquiryReplyExecutor(bad);

    expect(res.status).toBe("failed");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
