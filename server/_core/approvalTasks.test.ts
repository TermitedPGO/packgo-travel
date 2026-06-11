/**
 * Tests for the 指揮中心 approval-inbox spine helper (S-2).
 *
 * Covers the design.md S-2 contract:
 *   - createApprovalTask writes ONE pending row, returns its id, audits
 *     "approvalTask.create" (only when a ctx.user is present).
 *   - decideApprovalTask flips status (+ optional payload edit), audits
 *     approve/reject, and NEVER sends (no executor invoked here).
 *   - decideApprovalTask guards against deciding a non-pending row.
 *
 * db + auditLog are mocked — no MySQL, no real audit chain.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// mockDb is reconfigured per test by swapping insert/update/select.
const mockDb: any = { insert: vi.fn(), update: vi.fn(), select: vi.fn() };

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

vi.mock("./auditLog", () => ({
  audit: vi.fn(async () => undefined),
}));

vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  createApprovalTask,
  decideApprovalTask,
  findPendingApprovalTask,
  type ApprovalAuditCtx,
} from "./approvalTasks";
import { audit } from "./auditLog";

const auditMock = vi.mocked(audit);

const adminCtx: ApprovalAuditCtx = {
  user: { id: 42, email: "jeff@packgo.com", role: "admin" },
};

/** Chain stub matching getApprovalTaskById: select().from().where().limit(). */
function byIdChain(rows: any[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  };
}

describe("createApprovalTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a pending row and returns the new id", async () => {
    const valuesMock = vi.fn().mockResolvedValue([{ insertId: 7 }]);
    mockDb.insert = vi.fn(() => ({ values: valuesMock }));

    const result = await createApprovalTask(
      {
        lane: "cs",
        taskType: "cs.reply_inquiry",
        riskLevel: "review",
        title: "Reply to Jane Doe",
        payload: JSON.stringify({ inquiryId: 1, draftBody: "hi" }),
        createdBy: "InquiryAgent",
      },
      adminCtx,
    );

    expect(result).toEqual({ id: 7 });
    expect(valuesMock).toHaveBeenCalledTimes(1);
    const row = valuesMock.mock.calls[0][0];
    expect(row.status).toBe("pending");
    expect(row.lane).toBe("cs");
    expect(row.taskType).toBe("cs.reply_inquiry");
    expect(row.riskLevel).toBe("review");
  });

  it("audits approvalTask.create when a ctx.user is present", async () => {
    mockDb.insert = vi.fn(() => ({
      values: vi.fn().mockResolvedValue([{ insertId: 9 }]),
    }));

    await createApprovalTask(
      {
        lane: "finance",
        taskType: "finance.recognize",
        riskLevel: "hard_gate",
        title: "Recognize deposit",
        payload: "{}",
        createdBy: "system",
      },
      adminCtx,
    );

    expect(auditMock).toHaveBeenCalledTimes(1);
    const call = auditMock.mock.calls[0][0];
    expect(call.action).toBe("approvalTask.create");
    expect(call.targetType).toBe("approvalTask");
    expect(call.targetId).toBe(9);
  });

  it("does NOT audit when there is no ctx (system producer)", async () => {
    mockDb.insert = vi.fn(() => ({
      values: vi.fn().mockResolvedValue([{ insertId: 11 }]),
    }));

    const result = await createApprovalTask({
      lane: "marketing",
      taskType: "marketing.post",
      riskLevel: "auto",
      title: "Schedule post",
      payload: "{}",
      createdBy: "system",
    });

    expect(result).toEqual({ id: 11 });
    expect(auditMock).not.toHaveBeenCalled();
  });
});

/** Update chain stub matching db.update().set().where() → mysql2 result tuple. */
function updateChain(affectedRows: number) {
  const whereMock = vi.fn().mockResolvedValue([{ affectedRows }]);
  const setMock = vi.fn(() => ({ where: whereMock }));
  return { update: vi.fn(() => ({ set: setMock })), setMock, whereMock };
}

describe("decideApprovalTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve flips status to approved and audits approvalTask.approve", async () => {
    const approved = { id: 1, status: "approved", taskType: "cs.reply_inquiry" };

    const { update, setMock } = updateChain(1);
    mockDb.update = update;
    // Atomic decide: no pre-check read — only the post-update read remains.
    mockDb.select = vi.fn().mockReturnValueOnce(byIdChain([approved]));

    const result = await decideApprovalTask(
      { id: 1, decision: "approve", decidedBy: 42 },
      adminCtx,
    );

    expect(result.status).toBe("approved");
    const updateArg = setMock.mock.calls[0][0];
    expect(updateArg.status).toBe("approved");
    expect(updateArg.decidedBy).toBe(42);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0].action).toBe("approvalTask.approve");
    expect(auditMock.mock.calls[0][0].changes.from).toBe("pending");
  });

  it("persists editedPayload on approve", async () => {
    const { update, setMock } = updateChain(1);
    mockDb.update = update;
    mockDb.select = vi
      .fn()
      .mockReturnValueOnce(
        byIdChain([{ id: 2, status: "approved", taskType: "cs.reply_inquiry" }]),
      );

    await decideApprovalTask(
      { id: 2, decision: "approve", decidedBy: 42, editedPayload: '{"x":1}' },
      adminCtx,
    );

    expect(setMock.mock.calls[0][0].payload).toBe('{"x":1}');
  });

  it("reject flips status to rejected and audits approvalTask.reject", async () => {
    const { update } = updateChain(1);
    mockDb.update = update;
    mockDb.select = vi
      .fn()
      .mockReturnValueOnce(
        byIdChain([{ id: 3, status: "rejected", taskType: "cs.reply_inquiry" }]),
      );

    const result = await decideApprovalTask(
      { id: 3, decision: "reject", decidedBy: 42, reason: "off-brand" },
      adminCtx,
    );

    expect(result.status).toBe("rejected");
    expect(auditMock.mock.calls[0][0].action).toBe("approvalTask.reject");
    expect(auditMock.mock.calls[0][0].reason).toBe("off-brand");
  });

  it("throws when the task is not pending (double-decide guard)", async () => {
    // Conditional UPDATE loses (affectedRows=0) → one read for the error message.
    const { update } = updateChain(0);
    mockDb.update = update;
    mockDb.select = vi
      .fn()
      .mockReturnValueOnce(byIdChain([{ id: 4, status: "approved", taskType: "x" }]));

    await expect(
      decideApprovalTask({ id: 4, decision: "approve", decidedBy: 42 }, adminCtx),
    ).rejects.toThrow(/already approved/);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("throws when the task does not exist", async () => {
    const { update } = updateChain(0);
    mockDb.update = update;
    mockDb.select = vi.fn().mockReturnValueOnce(byIdChain([]));

    await expect(
      decideApprovalTask({ id: 999, decision: "approve", decidedBy: 42 }, adminCtx),
    ).rejects.toThrow(/not found/);
  });

  it("race: two concurrent approves → exactly one wins, one rejects, audit once", async () => {
    const approved = { id: 5, status: "approved", taskType: "cs.reply_inquiry" };

    // First UPDATE wins (affectedRows=1), second loses (affectedRows=0).
    const whereMock = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);
    mockDb.update = vi.fn(() => ({ set: vi.fn(() => ({ where: whereMock })) }));
    // Winner's post-update read + loser's error-message read.
    mockDb.select = vi
      .fn()
      .mockReturnValueOnce(byIdChain([approved]))
      .mockReturnValueOnce(byIdChain([approved]));

    const results = await Promise.allSettled([
      decideApprovalTask({ id: 5, decision: "approve", decidedBy: 42 }, adminCtx),
      decideApprovalTask({ id: 5, decision: "approve", decidedBy: 42 }, adminCtx),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<any>).value.status).toBe(
      "approved",
    );
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /already approved/,
    );
    // The loser never audits — exactly one decision row.
    expect(auditMock).toHaveBeenCalledTimes(1);
  });
});

describe("findPendingApprovalTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the pending row when the triple matches", async () => {
    const row = {
      id: 12,
      status: "pending",
      taskType: "finance_alert",
      relatedType: "finance_alert",
      relatedId: "profit_drop",
    };
    mockDb.select = vi.fn().mockReturnValueOnce(byIdChain([row]));

    const found = await findPendingApprovalTask(
      "finance_alert",
      "finance_alert",
      "profit_drop",
    );

    expect(found).toEqual(row);
  });

  it("returns undefined when nothing pending matches", async () => {
    mockDb.select = vi.fn().mockReturnValueOnce(byIdChain([]));

    const found = await findPendingApprovalTask("x", "y", "z");

    expect(found).toBeUndefined();
  });

  it("returns undefined (no throw) when the database is unavailable", async () => {
    const { getDb } = await import("../db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const found = await findPendingApprovalTask("x", "y", "z");

    expect(found).toBeUndefined();
  });
});
