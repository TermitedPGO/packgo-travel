/**
 * F2 塊A — 接線測試(runBackfillConfirm)。
 *
 * backfill-bank-transaction-links confirm 是 LOCAL_SCRIPT_TOKEN 端點的存量寫入
 * (自動 link + 聚合卡),無 ctx.user。釘死 confirm 跑完發一筆 systemAudit
 * (actor=system:bankLinkBackfill、action=bank.backfill_links_confirm、
 * pendingTotalAmount=真實金額)。fire-and-forget → 依 T2 地雷 #6 用 vi.waitFor。
 *
 * mock 策略:掃出 1 筆待認領($447.73)→ pendingCount>0,但 hasOpenCardFor→true
 * (當日聚合卡已存在)讓建卡分支整段跳過,aggregateCardId 保持 null,不必 mock
 * createApprovalTask / classifyFinanceAlertRisk。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const systemAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("../_core/auditLog", () => ({ systemAudit: (...a: unknown[]) => systemAudit(...a) }));

vi.mock("./bankTransactionLinkEngine", () => ({
  scanUnlinkedInflows: vi.fn().mockResolvedValue([
    { id: 1, amount: "447.73", date: "2026-07-01", remainingAmount: 447.73 },
  ]),
  processInboundTransaction: vi.fn().mockResolvedValue({ status: "pending_claim" }),
}));

vi.mock("../agents/autonomous/bankTransactionLinkAlerts", () => ({
  hasOpenCardFor: vi.fn().mockResolvedValue(true), // 當日聚合卡已存在 → 跳過建卡
  laDay: vi.fn().mockReturnValue("2026-07-01"),
}));

import { runBackfillConfirm } from "./bankTransactionLinkBackfill";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runBackfillConfirm → systemAudit(bank.backfill_links_confirm)", () => {
  it("confirm 跑完發稽核:actor/action 正確、pendingTotalAmount 為真實金額", async () => {
    const report = await runBackfillConfirm();
    expect(report.pendingCount).toBe(1);
    expect(report.pendingTotalAmount).toBe(447.73);
    expect(report.aggregateCardId).toBeNull(); // 建卡分支被 hasOpenCardFor 擋掉

    await vi.waitFor(() => {
      expect(systemAudit).toHaveBeenCalledWith(
        "system:bankLinkBackfill",
        "bank.backfill_links_confirm",
        null, // aggregateCardId
        expect.objectContaining({
          pendingCount: 1,
          pendingTotalAmount: 447.73,
          totalScanned: 1,
          autoLinkedTotal: 0,
        }),
      );
    });
  });
});
