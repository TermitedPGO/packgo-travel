/**
 * Tests for the 指揮中心 報價頁 producer (P2).
 *
 * Contract:
 *   - turns a resolved quote request into a createApprovalTask input with
 *     lane:"quote", taskType:"quote_draft", riskLevel ALWAYS "hard_gate", the
 *     right payload fields, and the two routing paths:
 *       · 供應商團 → title `{tour} · {who} · ${price}`, payload carries prices.
 *       · 客製遊  → title prefixed 📋, summary 需手動報價, prices omitted.
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
  buildQuoteDraftTaskInput,
  produceQuoteDraftTask,
} from "./quoteProducer";
import { createApprovalTask } from "../../_core/approvalTasks";

const createMock = vi.mocked(createApprovalTask);

describe("buildQuoteDraftTaskInput — 供應商團", () => {
  it("builds a quote / quote_draft hard_gate task with the right payload + refs", () => {
    const input = buildQuoteDraftTaskInput({
      tourId: 7,
      departureId: 55,
      tourTitle: "北海道粉雪 5 日",
      customerName: "陳先生",
      customerEmail: "chen@example.com",
      customerChannel: "wechat",
      supplierPrice: 1880,
      currency: "USD",
      isCustomTrip: false,
    });

    expect(input.lane).toBe("quote");
    expect(input.taskType).toBe("quote_draft");
    expect(input.riskLevel).toBe("hard_gate");
    expect(input.createdBy).toBe("QuoteAgent");
    expect(input.relatedType).toBe("tour");
    expect(input.relatedId).toBe("7");
    expect(input.title).toContain("北海道粉雪 5 日");
    expect(input.title).toContain("陳先生");
    expect(input.title).toContain("1880");

    const payload = JSON.parse(input.payload);
    expect(payload).toMatchObject({
      tourId: 7,
      departureId: 55,
      tourTitle: "北海道粉雪 5 日",
      customerName: "陳先生",
      customerEmail: "chen@example.com",
      customerChannel: "wechat",
      supplierPrice: 1880,
      currency: "USD",
      isCustomTrip: false,
    });
    // aiEstimate stays undefined in v1.
    expect(payload.aiEstimate).toBeUndefined();
  });

  it("title omits the price segment when supplierPrice is absent", () => {
    const input = buildQuoteDraftTaskInput({
      tourId: 7,
      tourTitle: "東京自由行",
      isCustomTrip: false,
    });
    expect(input.title).toBe("東京自由行 · —");
    expect(input.riskLevel).toBe("hard_gate");
  });

  it("defaults currency to USD and ignores non-finite prices", () => {
    const input = buildQuoteDraftTaskInput({
      tourId: 7,
      tourTitle: "沖繩",
      supplierPrice: Number.NaN,
      isCustomTrip: false,
    });
    const payload = JSON.parse(input.payload);
    expect(payload.currency).toBe("USD");
    expect(payload.supplierPrice).toBeUndefined();
  });
});

describe("buildQuoteDraftTaskInput — 客製遊", () => {
  it("plain title (no emoji), summary 需手動報價, omits prices from payload", () => {
    const input = buildQuoteDraftTaskInput({
      tourId: 12,
      tourTitle: "歐洲蜜月客製",
      customerName: "林小姐",
      // even if a price is passed, the custom path must drop it.
      supplierPrice: 9999,
      isCustomTrip: true,
    });

    expect(input.title).toBe("歐洲蜜月客製 · 林小姐");
    expect(input.summary).toContain("需手動報價");
    expect(input.riskLevel).toBe("hard_gate");

    const payload = JSON.parse(input.payload);
    expect(payload.isCustomTrip).toBe(true);
    expect(payload.supplierPrice).toBeUndefined();
    expect(payload.aiEstimate).toBeUndefined();
  });
});

describe("buildQuoteDraftTaskInput — always hard_gate", () => {
  it("both paths, with or without prices, never auto/review", () => {
    const variants = [
      { tourId: 1, tourTitle: "A", isCustomTrip: false },
      { tourId: 1, tourTitle: "A", isCustomTrip: true },
      {
        tourId: 1,
        tourTitle: "A",
        isCustomTrip: false,
        supplierPrice: 100,
        aiEstimate: 200,
      },
    ];
    for (const v of variants) {
      const r = buildQuoteDraftTaskInput(v);
      expect(r.riskLevel).toBe("hard_gate");
    }
  });
});

describe("produceQuoteDraftTask", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes one task via createApprovalTask and returns its id + riskLevel", async () => {
    createMock.mockResolvedValue({ id: 88 });

    const res = await produceQuoteDraftTask({
      tourId: 7,
      tourTitle: "北海道粉雪 5 日",
      supplierPrice: 1880,
      isCustomTrip: false,
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const row = createMock.mock.calls[0][0];
    expect(row.lane).toBe("quote");
    expect(row.taskType).toBe("quote_draft");
    expect(row.riskLevel).toBe("hard_gate");
    expect(res).toEqual({ id: 88, riskLevel: "hard_gate" });
  });

  it("passes ctx through to createApprovalTask for auditing", async () => {
    createMock.mockResolvedValue({ id: 89 });
    const ctx = { user: { id: 42, email: "jeff@packgo.com", role: "admin" } };

    await produceQuoteDraftTask(
      { tourId: 7, tourTitle: "北海道", isCustomTrip: true },
      ctx,
    );

    expect(createMock.mock.calls[0][1]).toBe(ctx);
  });
});
