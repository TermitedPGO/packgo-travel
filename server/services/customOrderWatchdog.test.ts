/**
 * customOrderWatchdog 測試 — Step 5 看門狗第一條(售價 vs 成本)的純規則。
 *
 * 蓋:健康不叫 / 過薄黃 / 零毛利紅 / 賠錢紅 / 門檻邊界 / draft+cancelled 跳過 /
 * 缺成本或售價就停 / 售價<=0 防除零 / decimal string(mysql2)/ 排序(紅在前最差在前)。
 */
import { describe, it, expect } from "vitest";
import {
  evaluateOrderMargin,
  findOrderMarginIssues,
  WATCHDOG_MARGIN_THRESHOLD,
  type OrderMarginInput,
} from "./customOrderWatchdog";

function order(over: Partial<OrderMarginInput> = {}): OrderMarginInput {
  return {
    id: 1,
    orderNumber: "ORD-2026-0001",
    title: "台灣12天",
    status: "quoted",
    totalPrice: "5000.00",
    supplierCost: "4000.00",
    currency: "USD",
    ...over,
  };
}

describe("evaluateOrderMargin — 單張規則", () => {
  it("健康毛利(20%)不叫", () => {
    // (5000-4000)/5000 = 0.20 >= 0.15
    expect(evaluateOrderMargin(order())).toBeNull();
  });

  it("毛利過薄(10%)→ 黃燈 thin", () => {
    const f = evaluateOrderMargin(order({ totalPrice: "5000", supplierCost: "4500" }));
    expect(f).not.toBeNull();
    expect(f!.level).toBe("yellow");
    expect(f!.reason).toBe("thin");
    expect(f!.marginPct).toBe(0.1);
    expect(f!.totalPrice).toBe(5000);
    expect(f!.supplierCost).toBe(4500);
  });

  it("零毛利(成本=售價)→ 紅燈 breakeven", () => {
    const f = evaluateOrderMargin(order({ totalPrice: "5000", supplierCost: "5000" }));
    expect(f!.level).toBe("red");
    expect(f!.reason).toBe("breakeven");
    expect(f!.marginPct).toBe(0);
  });

  it("賠錢(成本>售價)→ 紅燈 loss(David 那種)", () => {
    const f = evaluateOrderMargin(order({ totalPrice: "5000", supplierCost: "5600" }));
    expect(f!.level).toBe("red");
    expect(f!.reason).toBe("loss");
    expect(f!.marginPct).toBe(-0.12);
  });

  it("剛好門檻(15%)= 健康,不叫", () => {
    const f = evaluateOrderMargin(order({ totalPrice: "1000", supplierCost: "850" }));
    expect(f).toBeNull(); // margin 0.15 >= threshold
  });

  it("門檻下一點(14.9%)→ 黃燈", () => {
    const f = evaluateOrderMargin(order({ totalPrice: "1000", supplierCost: "851" }));
    expect(f!.level).toBe("yellow");
    expect(f!.marginPct).toBe(0.149);
  });

  it("draft 跳過(數字還在喬)", () => {
    expect(
      evaluateOrderMargin(order({ status: "draft", supplierCost: "9999" })),
    ).toBeNull();
  });

  it("cancelled 跳過", () => {
    expect(
      evaluateOrderMargin(order({ status: "cancelled", supplierCost: "9999" })),
    ).toBeNull();
  });

  it("成本未填 → 停手不叫", () => {
    expect(evaluateOrderMargin(order({ supplierCost: null }))).toBeNull();
    expect(evaluateOrderMargin(order({ supplierCost: "" }))).toBeNull();
  });

  it("售價未填 → 停手不叫", () => {
    expect(evaluateOrderMargin(order({ totalPrice: null }))).toBeNull();
  });

  it("售價<=0 → 防除零,停手", () => {
    expect(evaluateOrderMargin(order({ totalPrice: "0", supplierCost: "100" }))).toBeNull();
    expect(evaluateOrderMargin(order({ totalPrice: "-50", supplierCost: "100" }))).toBeNull();
  });

  it("成本為負(壞資料)→ 停手", () => {
    expect(evaluateOrderMargin(order({ supplierCost: "-100" }))).toBeNull();
  });

  it("吃 number 型也行(非只 decimal string)", () => {
    const f = evaluateOrderMargin(order({ totalPrice: 5000, supplierCost: 5600 }));
    expect(f!.reason).toBe("loss");
  });

  it("departed/completed 仍會檢查(出團後的賠錢也要讓 Jeff 知道)", () => {
    expect(
      evaluateOrderMargin(order({ status: "completed", totalPrice: "5000", supplierCost: "5600" }))!
        .reason,
    ).toBe("loss");
  });

  it("threshold 0.15 是預設常數", () => {
    expect(WATCHDOG_MARGIN_THRESHOLD).toBe(0.15);
  });
});

describe("findOrderMarginIssues — 多張排序", () => {
  it("只回有問題的,紅在前、最賠錢的最上面", () => {
    const orders: OrderMarginInput[] = [
      order({ id: 1, totalPrice: "5000", supplierCost: "4500" }), // 黃 10%
      order({ id: 2, totalPrice: "5000", supplierCost: "4000" }), // 健康 20%(不叫)
      order({ id: 3, totalPrice: "5000", supplierCost: "5600" }), // 紅 -12% loss
      order({ id: 4, totalPrice: "5000", supplierCost: "5000" }), // 紅 0% breakeven
      order({ id: 5, status: "draft", supplierCost: "9999" }), // 跳過
    ];
    const out = findOrderMarginIssues(orders);
    expect(out.map((f) => f.orderId)).toEqual([3, 4, 1]);
    expect(out.map((f) => f.level)).toEqual(["red", "red", "yellow"]);
  });

  it("全健康 → 空陣列", () => {
    expect(findOrderMarginIssues([order(), order({ id: 2 })])).toEqual([]);
  });

  it("空輸入 → 空陣列", () => {
    expect(findOrderMarginIssues([])).toEqual([]);
  });
});
