/**
 * processorPayoutMapping 純函式測試 — F2 塊C(2026-07-10)。
 *
 * 撥款 = 銷售 − 手續費:費率帶(預設 1%-5%)+ 日窗(先收款後撥款)決定候選。
 * 只找候選不做決定 —— 人工確認式對映的資料來源。
 */
import { describe, it, expect } from "vitest";
import {
  findPayoutSaleCandidates,
  type SaleLegLike,
} from "./processorPayoutMapping";

function leg(o: Partial<SaleLegLike> & { orderId: number }): SaleLegLike {
  return {
    orderNumber: `ORD-2026-${String(o.orderId).padStart(4, "0")}`,
    legKind: "deposit",
    amountCents: 49000, // $490
    paidDate: "2026-07-04",
    ...o,
  };
}

// prod 真例形狀:ORD-2026-0011 收 $490,Square 2.9%+30¢ ≈ $14.51 → 撥款 $475.49
const PAYOUT = { amountCents: 47549, date: "2026-07-06", processor: "square" as const };

describe("findPayoutSaleCandidates — single 規則", () => {
  it("費率落帶內(2.9%)+ 先收款後撥款 → 候選,隱含費率/手續費釘死", () => {
    const cands = findPayoutSaleCandidates(PAYOUT, [leg({ orderId: 11 })]);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({
      processor: "square",
      rule: "single",
      orderIds: [11],
      saleTotalCents: 49000,
      impliedFeeCents: 1451,
    });
    expect(cands[0].impliedFeePct).toBeCloseTo(0.0296, 3);
  });

  it("撥款 >= 銷售(沒扣費)→ 不是候選", () => {
    const cands = findPayoutSaleCandidates(
      { amountCents: 49000, date: "2026-07-06", processor: "square" },
      [leg({ orderId: 11 })],
    );
    expect(cands).toEqual([]);
  });

  it("費率出帶(>5%)→ 不是候選(更像部分付款,不是手續費)", () => {
    const cands = findPayoutSaleCandidates(
      { amountCents: 40000, date: "2026-07-06", processor: "square" }, // 隱含 18%
      [leg({ orderId: 11 })],
    );
    expect(cands).toEqual([]);
  });

  it("收款日在撥款日之後(先撥後收,不合理)→ 不是候選", () => {
    const cands = findPayoutSaleCandidates(PAYOUT, [leg({ orderId: 11, paidDate: "2026-07-07" })]);
    expect(cands).toEqual([]);
  });

  it("收款日超出日窗(預設 7 天)→ 不是候選", () => {
    const cands = findPayoutSaleCandidates(PAYOUT, [leg({ orderId: 11, paidDate: "2026-06-20" })]);
    expect(cands).toEqual([]);
  });
});

describe("findPayoutSaleCandidates — day_group 規則(Square 按日批次撥款)", () => {
  it("同收款曆日兩腿加總落帶 → day_group 候選", () => {
    // $490 + $275 = $765;撥款 $742.81 → 費率 2.9%
    const cands = findPayoutSaleCandidates(
      { amountCents: 74281, date: "2026-07-06", processor: "square" },
      [
        leg({ orderId: 11, amountCents: 49000 }),
        leg({ orderId: 12, amountCents: 27500 }),
      ],
    );
    const group = cands.find((c) => c.rule === "day_group");
    expect(group).toBeDefined();
    expect(group!.orderIds.sort()).toEqual([11, 12]);
    expect(group!.saleTotalCents).toBe(76500);
    expect(group!.impliedFeePct).toBeCloseTo(0.029, 3);
  });

  it("不同收款日的腿不成組", () => {
    const cands = findPayoutSaleCandidates(
      { amountCents: 74281, date: "2026-07-06", processor: "square" },
      [
        leg({ orderId: 11, amountCents: 49000, paidDate: "2026-07-03" }),
        leg({ orderId: 12, amountCents: 27500, paidDate: "2026-07-04" }),
      ],
    );
    expect(cands.filter((c) => c.rule === "day_group")).toEqual([]);
  });
});

describe("findPayoutSaleCandidates — 排序與空態", () => {
  it("多候選按 |隱含費率 − 2.9%| 升冪(最像標準費率的排最前)", () => {
    const cands = findPayoutSaleCandidates(
      { amountCents: 47549, date: "2026-07-06", processor: "square" },
      [
        leg({ orderId: 21, amountCents: 49900 }), // 費率 ≈ 4.7%
        leg({ orderId: 11, amountCents: 49000 }), // 費率 ≈ 2.96%(最像)
      ],
    );
    expect(cands.length).toBeGreaterThanOrEqual(2);
    expect(cands[0].orderIds).toEqual([11]);
  });

  it("無銷售資料 → 空候選(誠實狀態,卡照出人照判)", () => {
    expect(findPayoutSaleCandidates(PAYOUT, [])).toEqual([]);
  });
});
