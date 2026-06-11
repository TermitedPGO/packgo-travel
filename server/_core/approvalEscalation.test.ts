/**
 * Tests for the executor-failure escalation (指揮中心 M5).
 *
 * Contract: insert an unread high-priority agentMessages escalation for a
 * failed approval task; dedup while an unread one for the same task exists;
 * NEVER throw (db unavailable / insert failure both resolve silently).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb: any = { insert: vi.fn(), select: vi.fn() };

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
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
  escalateFailedApprovalTask,
  ESCALATION_AGENT_NAME,
} from "./approvalEscalation";
import { getDb } from "../db";

const task = {
  id: 31,
  lane: "cs",
  title: "陳美玲 · 沖繩行程詢問",
  taskType: "inquiry_reply",
} as any;

/** select().from().where().limit() chain resolving to `rows`. */
function selectChain(rows: any[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("escalateFailedApprovalTask", () => {
  it("inserts an unread high-priority escalation with the task ref in context", async () => {
    mockDb.select = vi.fn().mockReturnValueOnce(selectChain([]));
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    mockDb.insert = vi.fn(() => ({ values: valuesMock }));

    await escalateFailedApprovalTask(task, "smtp 550 bounced");

    expect(valuesMock).toHaveBeenCalledTimes(1);
    const row = valuesMock.mock.calls[0][0];
    expect(row.agentName).toBe(ESCALATION_AGENT_NAME);
    expect(row.messageType).toBe("escalation");
    expect(row.priority).toBe("high");
    expect(row.readByJeff).toBe(0);
    expect(row.title).toContain("cs");
    expect(row.title).toContain("陳美玲 · 沖繩行程詢問");
    expect(row.body).toBe("smtp 550 bounced");
    expect(JSON.parse(row.context)).toEqual({
      ref: "approvalTask:31",
      lane: "cs",
      taskType: "inquiry_reply",
    });
  });

  it("skips the insert while an unread escalation for the task exists", async () => {
    mockDb.select = vi.fn().mockReturnValueOnce(selectChain([{ id: 5 }]));
    mockDb.insert = vi.fn();

    await escalateFailedApprovalTask(task, "fail again");

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("resolves silently when the database is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    await expect(
      escalateFailedApprovalTask(task, "x"),
    ).resolves.toBeUndefined();
  });

  it("swallows insert failures (never throws)", async () => {
    mockDb.select = vi.fn().mockReturnValueOnce(selectChain([]));
    mockDb.insert = vi.fn(() => ({
      values: vi.fn().mockRejectedValue(new Error("disk full")),
    }));

    await expect(
      escalateFailedApprovalTask(task, "x"),
    ).resolves.toBeUndefined();
  });

  it("truncates the title to the 200-char column limit", async () => {
    mockDb.select = vi.fn().mockReturnValueOnce(selectChain([]));
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    mockDb.insert = vi.fn(() => ({ values: valuesMock }));

    await escalateFailedApprovalTask(
      { ...task, title: "長".repeat(300) },
      "x",
    );

    expect(valuesMock.mock.calls[0][0].title.length).toBeLessThanOrEqual(200);
  });
});
