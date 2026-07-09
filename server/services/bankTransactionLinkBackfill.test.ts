/**
 * bankTransactionLinkBackfill 純函式測試(F1 對帳引擎 塊A 存量回填,2026-07-08)。
 *
 * 只測 buildBackfillReport —— 這支是「存量絕不逐筆出卡」的結構性保證:輸入
 * 任意筆數的 outcome,輸出永遠是「一份」彙總物件,不是可以逐一拿去建卡的
 * 陣列。runBackfillDryRun/runBackfillConfirm 是 DB-touching orchestration,
 * 本地無 DATABASE_URL 測不到,誠實列 T6 已知限制。
 */
import { describe, it, expect } from "vitest";
import { buildBackfillReport, type BackfillItemOutcome } from "./bankTransactionLinkBackfill";

describe("buildBackfillReport — 存量回填彙總(結構上保證單一份,不逐筆)", () => {
  it("全部 auto-link → pendingItems 空,autoLinkedByRule 依規則分桶計數", () => {
    const outcomes: BackfillItemOutcome[] = [
      { bankTransactionId: 1, amount: 100, date: "2026-06-01", status: "linked", rule: "stripe_payout" },
      { bankTransactionId: 2, amount: 200, date: "2026-06-02", status: "linked", rule: "stripe_payout" },
      { bankTransactionId: 3, amount: 50, date: "2026-06-03", status: "linked", rule: "order_ref" },
    ];
    const report = buildBackfillReport(outcomes);
    expect(report.totalScanned).toBe(3);
    expect(report.autoLinkedByRule).toEqual({ stripe_payout: 2, order_ref: 1 });
    expect(report.autoLinkedTotal).toBe(3);
    expect(report.pendingCount).toBe(0);
    expect(report.pendingTotalAmount).toBe(0);
    expect(report.pendingItems).toEqual([]);
  });

  it("混合 linked + pending_claim → pendingItems 列出明細,pendingTotalAmount 加總正確", () => {
    const outcomes: BackfillItemOutcome[] = [
      { bankTransactionId: 1, amount: 100, date: "2026-06-01", status: "linked", rule: "exact_amount" },
      { bankTransactionId: 2, amount: 250.5, date: "2026-06-02", status: "pending_claim" },
      { bankTransactionId: 3, amount: 99.5, date: "2026-06-03", status: "pending_claim" },
    ];
    const report = buildBackfillReport(outcomes);
    expect(report.autoLinkedTotal).toBe(1);
    expect(report.pendingCount).toBe(2);
    expect(report.pendingTotalAmount).toBe(350);
    expect(report.pendingItems.map((p) => p.bankTransactionId)).toEqual([2, 3]);
  });

  it("空輸入 → 全部歸零,仍是單一份物件", () => {
    const report = buildBackfillReport([]);
    expect(report.totalScanned).toBe(0);
    expect(report.autoLinkedByRule).toEqual({});
    expect(report.pendingCount).toBe(0);
    expect(report.pendingItems).toEqual([]);
  });

  it("回傳型別是單一物件(不是陣列)——呼叫端沒有天然的『逐筆建卡』迴圈可寫", () => {
    const report = buildBackfillReport([{ bankTransactionId: 1, amount: 100, date: "2026-06-01", status: "pending_claim" }]);
    expect(Array.isArray(report)).toBe(false);
    expect(typeof report).toBe("object");
  });
});
