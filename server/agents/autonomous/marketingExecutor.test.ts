/**
 * Tests for the 指揮���心 行銷頁 executor (P3).
 *
 * Contract (ApprovalExecutor):
 *   - MUST NOT THROW for any expected failure.
 *   - Valid payload → { status: "sent" } (v1 does not auto-publish).
 *   - Invalid/empty payload → { status: "failed", errorMessage }.
 *   - Unexpected internal error → { status: "failed" } (never propagates).
 */

import { describe, it, expect } from "vitest";
import { marketingDraftExecutor, MARKETING_DRAFT_TASK_TYPE } from "./marketingExecutor";
import type { ApprovalTask } from "../../_core/approvalTasks";

/** Helper to build a minimal task row for the executor. */
function makeTask(payloadOverride?: string): ApprovalTask {
  return {
    id: 1,
    lane: "marketing",
    taskType: MARKETING_DRAFT_TASK_TYPE,
    riskLevel: "review",
    status: "approved",
    title: "test task",
    summary: null,
    payload:
      payloadOverride ??
      JSON.stringify({
        contentType: "xhs_post",
        title: "美西攻略",
        body: "第一天行程...",
        platform: "xiaohongshu",
      }),
    relatedType: null,
    relatedId: null,
    createdBy: "admin:manual",
    decidedBy: 1,
    decidedAt: new Date(),
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ApprovalTask;
}

describe("marketingDraftExecutor — never-throw contract", () => {
  it("valid payload → status sent (v1 manual publish)", async () => {
    const result = await marketingDraftExecutor(makeTask());
    expect(result.status).toBe("sent");
    expect(result.errorMessage).toBeUndefined();
  });

  it("invalid JSON payload → status failed (no throw)", async () => {
    const result = await marketingDraftExecutor(makeTask("not-json{{{"));
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("invalid");
  });

  it("empty body in payload → status failed (no throw)", async () => {
    const result = await marketingDraftExecutor(
      makeTask(
        JSON.stringify({
          contentType: "edm",
          title: "Some title",
          body: "   ", // whitespace-only = effectively empty
        }),
      ),
    );
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("invalid");
  });

  it("missing required fields → status failed (no throw)", async () => {
    const result = await marketingDraftExecutor(
      makeTask(JSON.stringify({ contentType: "edm" })),
    );
    expect(result.status).toBe("failed");
  });

  it("MARKETING_DRAFT_TASK_TYPE matches expected string", () => {
    expect(MARKETING_DRAFT_TASK_TYPE).toBe("marketing_draft");
  });
});
