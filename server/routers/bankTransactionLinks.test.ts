/**
 * bankTransactionLinks router 測試(F1 對帳引擎 塊A,2026-07-08)。
 * 蓋:procedure surface、listPending 過濾(只留 pending_claim)、claim 寫入 +
 * auditLog 斷言(dispatch-f1.md 驗收條件 3「認領寫入含 auditLog 斷言」)、
 * claim 輸入驗證(category 缺 categoryCode / 非 category 缺 targetId)、
 * 超額分配轉成 BAD_REQUEST(不是 500)。
 *
 * Mock collaborators BEFORE importing the router(vi.mock hoisted)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above the whole file — a class declared at
// module top-level here would throw "Cannot access before initialization"
// if referenced inside the factory, so it's declared INSIDE the factory.
vi.mock("../services/bankTransactionLinkEngine", () => {
  class FakeAllocationExceededError extends Error {
    constructor(bankTransactionId: number, existing: number, incoming: number, cap: number) {
      super(`bankTransactionId ${bankTransactionId}: existing $${existing} + new $${incoming} exceeds $${cap}`);
      this.name = "AllocationExceededError";
    }
  }
  return {
    scanUnlinkedInflows: vi.fn(async () => []),
    processInboundTransaction: vi.fn(),
    createBankTransactionLink: vi.fn(async () => ({ id: 999 })),
    AllocationExceededError: FakeAllocationExceededError,
  };
});
vi.mock("../_core/auditLog", () => ({ audit: vi.fn(async () => {}) }));
// pendingSummary 借用 runBackfillDryRun(唯讀彙總)—— mock 掉,只驗真相列要的
// count/totalAmount 直通,且是 dry-run(不寫路徑)。
vi.mock("../services/bankTransactionLinkBackfill", () => ({
  runBackfillDryRun: vi.fn(async () => ({
    totalScanned: 0,
    autoLinkedByRule: {},
    autoLinkedTotal: 0,
    pendingCount: 0,
    pendingTotalAmount: 0,
    pendingItems: [],
  })),
}));

import { bankTransactionLinksRouter } from "./bankTransactionLinks";
import { audit } from "../_core/auditLog";
import { runBackfillDryRun } from "../services/bankTransactionLinkBackfill";
import {
  scanUnlinkedInflows,
  processInboundTransaction,
  createBankTransactionLink,
  AllocationExceededError,
} from "../services/bankTransactionLinkEngine";

function adminCtx() {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    ip: "127.0.0.1",
  };
}
const caller = () => (bankTransactionLinksRouter as any).createCaller(adminCtx());

beforeEach(() => vi.clearAllMocks());

describe("surface", () => {
  it("exposes exactly listPending + pendingSummary + claim", () => {
    const procs = Object.keys((bankTransactionLinksRouter as any)._def.procedures).sort();
    expect(procs).toEqual(["claim", "listPending", "pendingSummary"]);
  });
});

describe("pendingSummary — 真相列「待認領」彙總(唯讀)", () => {
  it("直通 runBackfillDryRun 的 pendingCount / pendingTotalAmount(真相列一格數字)", async () => {
    (runBackfillDryRun as any).mockResolvedValueOnce({
      totalScanned: 373,
      autoLinkedByRule: { small_inflow: 53 },
      autoLinkedTotal: 53,
      pendingCount: 320,
      pendingTotalAmount: 447732,
      pendingItems: [],
    });
    const out = await caller().pendingSummary();
    expect(out).toEqual({ count: 320, totalAmount: 447732 });
  });

  it("唯讀:走 dry-run 彙總,不觸發 confirm 寫路徑(不建卡、不留審計)", async () => {
    (runBackfillDryRun as any).mockResolvedValueOnce({
      totalScanned: 0,
      autoLinkedByRule: {},
      autoLinkedTotal: 0,
      pendingCount: 0,
      pendingTotalAmount: 0,
      pendingItems: [],
    });
    await caller().pendingSummary();
    expect(runBackfillDryRun).toHaveBeenCalledTimes(1);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("listPending — 只留 dry-run 判定為 pending_claim 的入帳", () => {
  it("三筆入帳,dry-run 結果分別是 linked/pending_claim/already_handled → 只回傳 pending_claim 那筆", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([
      { id: 1, amount: "-500.00", date: "2026-06-01", remainingAmount: 500 },
      { id: 2, amount: "-80.00", date: "2026-06-02", remainingAmount: 80 },
      { id: 3, amount: "-30.00", date: "2026-06-03", remainingAmount: 30 },
    ]);
    (processInboundTransaction as any).mockImplementation(async (id: number) => {
      if (id === 1) return { status: "linked", rule: "exact_amount", link: {}, linkId: 10 };
      if (id === 2) return { status: "pending_claim", candidates: [{ orderId: 7, orderNumber: "ORD-2026-0007", title: "台灣團", legKind: "deposit", matchedAmount: 80 }] };
      return { status: "already_handled", existingAllocated: 30 };
    });

    const out = await caller().listPending({ limit: 10 });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].bankTransactionId).toBe(2);
    expect(out.items[0].amount).toBe(80);
    expect(out.items[0].candidates).toEqual([
      { orderId: 7, orderNumber: "ORD-2026-0007", title: "台灣團", legKind: "deposit", matchedAmount: 80 },
    ]);
  });

  it("2026-07-08 對抗審查 P1 修復:顯示的是剩餘未分配金額(remainingAmount),不是原始交易總額", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([
      { id: 5, amount: "-100.00", date: "2026-06-01", remainingAmount: 20 }, // 已部分認領 $80,剩 $20
    ]);
    (processInboundTransaction as any).mockResolvedValue({ status: "pending_claim", candidates: [] });
    const out = await caller().listPending({});
    expect(out.items[0].amount).toBe(20);
  });

  it("dry-run 呼叫時帶 { dryRun: true }(唯讀,不能真的寫入)", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([{ id: 1, amount: "-500.00", date: "2026-06-01", remainingAmount: 500 }]);
    (processInboundTransaction as any).mockResolvedValue({ status: "pending_claim", candidates: [] });
    await caller().listPending({});
    expect(processInboundTransaction).toHaveBeenCalledWith(1, { dryRun: true });
  });
});

describe("claim — 人工認領,唯一錢的真相寫入路徑", () => {
  it("認領到 custom_order → 呼叫 createBankTransactionLink(claimedBy='jeff') 並留 auditLog", async () => {
    const result = await caller().claim({
      bankTransactionId: 42,
      targetType: "custom_order",
      targetId: 7,
      amountAllocated: 300,
    });
    expect(result).toEqual({ id: 999 });
    expect(createBankTransactionLink).toHaveBeenCalledWith(
      expect.objectContaining({
        bankTransactionId: 42,
        targetType: "custom_order",
        targetId: 7,
        amountAllocated: 300,
        matchMethod: "manual",
        matchConfidence: 100,
        claimedBy: "jeff",
      }),
    );
    expect(audit).toHaveBeenCalledTimes(1);
    const auditArg = (audit as any).mock.calls[0][0];
    expect(auditArg.action).toBe("bankTransactionLink.claim");
    expect(auditArg.targetType).toBe("bankTransaction");
    expect(auditArg.targetId).toBe(42);
    expect(auditArg.changes).toEqual(
      expect.objectContaining({ linkId: 999, targetType: "custom_order", targetId: 7, amountAllocated: 300 }),
    );
  });

  it("認領到 category → categoryCode 必填,缺就 BAD_REQUEST 且不寫入不留審計", async () => {
    await expect(
      caller().claim({ bankTransactionId: 42, targetType: "category", amountAllocated: 50 }),
    ).rejects.toThrow(/categoryCode/);
    expect(createBankTransactionLink).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("認領到 custom_order 缺 targetId → BAD_REQUEST", async () => {
    await expect(
      caller().claim({ bankTransactionId: 42, targetType: "custom_order", amountAllocated: 50 }),
    ).rejects.toThrow(/targetId/);
  });

  it("超額分配(AllocationExceededError)轉成 BAD_REQUEST,不是 500,且不留審計", async () => {
    (createBankTransactionLink as any).mockRejectedValueOnce(
      new (AllocationExceededError as any)(42, 80, 30, 100),
    );
    await expect(
      caller().claim({ bankTransactionId: 42, targetType: "category", categoryCode: "interest", amountAllocated: 30 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(audit).not.toHaveBeenCalled();
  });
});
