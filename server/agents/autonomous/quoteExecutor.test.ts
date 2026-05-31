/**
 * Tests for the 指揮中心 報價頁 executor (P2).
 *
 * Contract:
 *   - registered under taskType "quote_draft"; the spine can dispatch it.
 *   - success path: valid payload → marks 已報價 (log only in v1) → { status:"sent" }.
 *   - failure path: invalid / non-JSON payload → { status:"failed" } and NEVER
 *     throws (ApprovalExecutor contract).
 *   - buildQuoteMarkedRecord maps decidedBy (who approved) + the quoted price
 *     (finalPrice preferred over supplierPrice).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  quoteDraftExecutor,
  registerQuoteExecutors,
  buildQuoteMarkedRecord,
  QUOTE_DRAFT_TASK_TYPE,
} from "./quoteExecutor";
import {
  getApprovalExecutor,
  type ApprovalTask,
} from "../../_core/approvalTasks";

/** Build an approved quote task row with a valid quote_draft payload. */
function task(overrides: Partial<ApprovalTask> = {}): ApprovalTask {
  return {
    id: 1,
    lane: "quote",
    taskType: "quote_draft",
    riskLevel: "hard_gate",
    status: "approved",
    title: "北海道粉雪 5 日 · 陳先生 · $1880",
    summary: "USD 1880",
    payload: JSON.stringify({
      tourId: 7,
      tourTitle: "北海道粉雪 5 日",
      supplierPrice: 1880,
      currency: "USD",
      isCustomTrip: false,
    }),
    relatedType: "tour",
    relatedId: "7",
    createdBy: "QuoteAgent",
    decidedBy: 42,
    decidedAt: new Date(),
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ApprovalTask;
}

describe("registerQuoteExecutors — registration is dispatchable", () => {
  it("after registerQuoteExecutors() the spine resolves the executor by taskType", () => {
    // EXACT code path server/routers/commandCenter.ts runs at module load
    // (which runs at server boot). Calling it here proves approve() is
    // dispatchable to this executor.
    registerQuoteExecutors();
    expect(QUOTE_DRAFT_TASK_TYPE).toBe("quote_draft");
    expect(getApprovalExecutor("quote_draft")).toBe(quoteDraftExecutor);
  });

  it("registerQuoteExecutors() is idempotent (safe to call repeatedly)", () => {
    registerQuoteExecutors();
    registerQuoteExecutors();
    expect(getApprovalExecutor("quote_draft")).toBe(quoteDraftExecutor);
  });
});

describe("buildQuoteMarkedRecord — decidedBy + price mapping", () => {
  it("maps decidedBy (who approved) and prefers finalPrice over supplierPrice", () => {
    const payload = {
      tourId: 7,
      tourTitle: "北海道",
      supplierPrice: 1880,
      finalPrice: 1950,
      currency: "USD",
      isCustomTrip: false,
    };
    const rec = buildQuoteMarkedRecord(task({ decidedBy: 42 }), payload);
    expect(rec.decidedBy).toBe(42);
    expect(rec.quotedPrice).toBe(1950);
    expect(rec.tourId).toBe(7);
    expect(rec.currency).toBe("USD");
  });

  it("decidedBy null maps to null; falls back to supplierPrice; default currency USD", () => {
    const payload = {
      tourId: 7,
      tourTitle: "北海道",
      supplierPrice: 1880,
      isCustomTrip: false,
    };
    const rec = buildQuoteMarkedRecord(task({ decidedBy: null }), payload);
    expect(rec.decidedBy).toBeNull();
    expect(rec.quotedPrice).toBe(1880);
    expect(rec.currency).toBe("USD");
  });
});

describe("quoteDraftExecutor — success path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("valid payload → { status: 'sent' } (v1: log only, no PDF/email)", async () => {
    const res = await quoteDraftExecutor(task());
    expect(res).toEqual({ status: "sent" });
  });

  it("custom-trip payload (no prices) → sent", async () => {
    const res = await quoteDraftExecutor(
      task({
        payload: JSON.stringify({
          tourId: 9,
          tourTitle: "歐洲蜜月客製",
          isCustomTrip: true,
        }),
      }),
    );
    expect(res.status).toBe("sent");
  });
});

describe("quoteDraftExecutor — failure path (never throws)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalid payload (no tourTitle) → { status: 'failed' }, never throws", async () => {
    const res = await quoteDraftExecutor(
      task({ payload: JSON.stringify({ tourId: 7 }) }),
    );
    expect(res.status).toBe("failed");
  });

  it("empty tourTitle → { status: 'failed' }", async () => {
    const res = await quoteDraftExecutor(
      task({ payload: JSON.stringify({ tourId: 7, tourTitle: "   " }) }),
    );
    expect(res.status).toBe("failed");
  });

  it("non-JSON payload → { status: 'failed' }, never throws", async () => {
    const res = await quoteDraftExecutor(task({ payload: "not json at all" }));
    expect(res.status).toBe("failed");
  });
});
