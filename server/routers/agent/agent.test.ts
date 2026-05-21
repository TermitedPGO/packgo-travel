/**
 * Tests for the agent.* composed router.
 *
 * History:
 *   - v2 Wave 2 Module 2.10 (2026-05-21): structural smoke covering the
 *     50 procedures originally at server/routers/agentRouter.ts (2,804
 *     LOC) before the eight-way domain split. The same surface is now
 *     served by `agentRouter` composing eleven sub-routers (10 domain +
 *     _shared helpers); this test verifies every public name is still
 *     present + composed under the `agent` namespace.
 *
 * Mirror of the structural smoke pattern established in
 * server/routers/inquiries.test.ts (Phase 4C extraction).
 */
import { describe, it, expect, vi } from "vitest";

// Mock heavy collaborators BEFORE importing the router so the module
// graph stays cheap. The composed router file only references its
// sub-routers + tRPC helpers — db / LLM / Gmail are only touched at
// procedure-call time, but each sub-router's import path pulls in
// those modules and they shouldn't try to connect at import.
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
}));
vi.mock("../../_core/gmail", () => ({
  getGmailAuthUrl: vi.fn(),
  verifyConnection: vi.fn(),
}));
vi.mock("../../agents/autonomous/gmailPipeline", () => ({
  runGmailPipeline: vi.fn(),
}));
vi.mock("../../agents/autonomous/agentChat", () => ({
  runAgentChat: vi.fn(),
}));
vi.mock("../../agents/autonomous/agentReport", () => ({
  runAgentReport: vi.fn(),
  formatReportAsMessage: vi.fn(),
}));
vi.mock("../../agents/autonomous/officeAssistant", () => ({
  runOfficeAssistant: vi.fn(),
}));
vi.mock("../../agents/autonomous/selfRetrospective", () => ({
  runSelfRetrospective: vi.fn(),
  formatRetrospectiveAsMessage: vi.fn(),
}));
vi.mock("../../agents/autonomous/inquiryAgent", () => ({
  runInquiryAgent: vi.fn(),
  DEFAULT_INQUIRY_POLICY: {},
}));
vi.mock("../../agents/autonomous/reviewAgent", () => ({
  runReviewAgent: vi.fn(),
  DEFAULT_REVIEW_POLICY: {},
}));
vi.mock("../../agents/autonomous/marketingAgent", () => ({
  runMarketingAgent: vi.fn(),
  DEFAULT_MARKETING_POLICY: {},
}));
vi.mock("../../agents/autonomous/followupAgent", () => ({
  runFollowupAgent: vi.fn(),
  DEFAULT_FOLLOWUP_POLICY: {},
}));
vi.mock("../../agents/autonomous/refundAgent", () => ({
  runRefundAgent: vi.fn(),
  DEFAULT_REFUND_POLICY: {},
}));

import { agentRouter } from "../agentRouter";

describe("agentRouter (v2 Wave 2 Module 2.10 composition shell)", () => {
  it("exposes all 50 procedures from the pre-split monolith", () => {
    const procs = Object.keys((agentRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        // profiles (5)
        "findProfile",
        "upsertByIdentifier",
        "getProfileWithContext",
        "updateLearnedPreferences",
        "logInteraction",
        // outcomes (4)
        "recordAction",
        "updateOutcome",
        "recentOutcomes",
        "snapshot",
        // policy (8)
        "getAutoSendSettings",
        "setAutoSendSettings",
        "getActivePolicy",
        "upsertPolicy",
        "rollbackPolicy",
        "listPolicyProposals",
        "markProposal",
        "applyRetrospectiveProposal",
        // office (5)
        "recentMetrics",
        "pendingForJeff",
        "recentActivity",
        "acknowledge",
        "agentOffice",
        // overview (1)
        "officeOverview",
        // demo (5)
        "demoInquiry",
        "demoReview",
        "demoMarketing",
        "demoFollowup",
        "demoRefund",
        // inbox (4)
        "listMessages",
        "unreadMessageCount",
        "replyToMessage",
        "postMessage",
        // chat (8)
        "listGeneralChannel",
        "postToGeneralChannel",
        "generalChannelUnread",
        "markGeneralChannelRead",
        "markAgentChannelRead",
        "listConversation",
        "unreadPerAgent",
        "sendToAgent",
        // reports (2)
        "requestAgentReport",
        "requestAllAgentReports",
        // ops (3)
        "askOps",
        "executeOpsAction",
        "runRetrospective",
        // gmail (5)
        "gmailGetAuthUrl",
        "gmailStatus",
        "gmailVerify",
        "gmailRunNow",
        "gmailDisconnect",
      ].sort(),
    );
    expect(procs).toHaveLength(50);
  });
});

describe("agentRouter — happy-path query smoke", () => {
  /**
   * Minimal context shape for adminProcedure callers. The agent.* routes
   * only check `ctx.user.role === 'admin'` (via adminProcedure middleware)
   * — they don't touch the request/response objects in queries.
   */
  function makeAdminContext() {
    return {
      req: { headers: {}, socket: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
      user: { id: 1, role: "admin" as const, email: "admin@test" },
      ip: "127.0.0.1",
    };
  }

  it("snapshot returns [] when db is unavailable (mocked getDb→null)", async () => {
    const caller = (agentRouter as any).createCaller(makeAdminContext());
    const result = await caller.snapshot();
    expect(result).toEqual([]);
  });

  it("unreadMessageCount returns zero-filled breakdown when db is unavailable", async () => {
    const caller = (agentRouter as any).createCaller(makeAdminContext());
    const result = await caller.unreadMessageCount();
    expect(result).toEqual({
      total: 0,
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    });
  });

  it("officeOverview returns empty department list when db is unavailable", async () => {
    const caller = (agentRouter as any).createCaller(makeAdminContext());
    const result = await caller.officeOverview();
    expect(result).toEqual({ departments: [] });
  });
});
