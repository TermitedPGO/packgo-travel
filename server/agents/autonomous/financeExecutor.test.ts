import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  financeAlertExecutor,
  FINANCE_ALERT_TASK_TYPE,
} from "./financeExecutor";

// Mock logger to avoid side effects
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeTask(overrides: Partial<any> = {}) {
  return {
    id: 1,
    lane: "finance" as const,
    taskType: FINANCE_ALERT_TASK_TYPE,
    riskLevel: "review" as const,
    status: "approved" as const,
    title: "test alert",
    summary: null,
    payload: JSON.stringify({ alertType: "profit_drop", severity: "warning", headline: "test" }),
    relatedType: null,
    relatedId: null,
    createdBy: "FinanceAlertProducer",
    decidedBy: 1,
    decidedAt: new Date(),
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("financeExecutor", () => {
  it("returns sent (acknowledge-only)", async () => {
    const result = await financeAlertExecutor(makeTask());
    expect(result.status).toBe("sent");
  });

  it("never throws", async () => {
    // Even with bad payload, should not throw
    const result = await financeAlertExecutor(makeTask({ payload: "invalid" }));
    expect(result.status).toBe("sent");
  });

  it("taskType matches the producer constant", () => {
    expect(FINANCE_ALERT_TASK_TYPE).toBe("finance_alert");
  });
});
