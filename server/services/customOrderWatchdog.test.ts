/**
 * customOrderWatchdog 測試 — Step 5 看門狗的純規則。
 *
 * 規則一(售價 vs 成本)蓋:健康不叫 / 過薄黃 / 零毛利紅 / 賠錢紅 / 門檻邊界 /
 * draft+cancelled 跳過 / 缺成本或售價就停 / 售價<=0 防除零 / decimal string(mysql2)/
 * 排序(紅在前最差在前)。
 *
 * 規則二/三(v2 答應了還沒寄)蓋:due / not-due 邊界 / 日期缺不叫 / draft·手動推進·
 * cancelled 跳過 / LA 曆日(不是 UTC)/ 排序(等最久在前)/ category 豁免
 * (visa 免確認書規則,ORD-2026-0004;flight/quote/general/NULL 照跑;
 * visa 的報價規則不豁免)。
 */
import { describe, it, expect } from "vitest";
import {
  evaluateOrderMargin,
  evaluateOrderPromise,
  findOrderMarginIssues,
  findOrderPromiseIssues,
  WATCHDOG_MARGIN_THRESHOLD,
  WATCHDOG_QUOTE_PROMISE_DAYS,
  WATCHDOG_CONFIRMATION_PROMISE_DAYS,
  WATCHDOG_CONFIRMATION_EXEMPT_CATEGORIES,
  type OrderMarginInput,
  type OrderPromiseInput,
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

  it("margin finding 帶 kind: 'margin'(跟 promise 類分流用)", () => {
    const f = evaluateOrderMargin(order({ totalPrice: "5000", supplierCost: "5600" }));
    expect(f!.kind).toBe("margin");
  });
});

// ── v2:答應了還沒寄 ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** 固定 now:LA 2026-07-01 中午(避免曆日邊界),測試 deterministic。 */
const NOW = new Date("2026-07-01T19:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

function promiseOrder(over: Partial<OrderPromiseInput> = {}): OrderPromiseInput {
  return {
    id: 1,
    orderNumber: "ORD-2026-0001",
    title: "台灣12天",
    status: "draft",
    category: null, // 未標(schema NULL);豁免只認明確的 visa
    needsQuote: 1,
    quoteSentAt: null,
    depositPaidAt: null,
    confirmedAt: null,
    createdAt: daysAgo(10),
    ...over,
  };
}

describe("evaluateOrderPromise — 說好的報價還沒寄", () => {
  it("draft + needsQuote + 沒寄 + 超過 7 天 → 黃燈 quoteUnsent", () => {
    const f = evaluateOrderPromise(promiseOrder({ createdAt: daysAgo(8) }), NOW);
    expect(f).not.toBeNull();
    expect(f!.kind).toBe("promise");
    expect(f!.level).toBe("yellow");
    expect(f!.reason).toBe("quoteUnsent");
    expect(f!.daysWaiting).toBe(8);
  });

  it("剛好 7 天 → 還沒過期,不叫", () => {
    expect(evaluateOrderPromise(promiseOrder({ createdAt: daysAgo(7) }), NOW)).toBeNull();
  });

  it("needsQuote=0(沒答應要報價)→ 不叫", () => {
    expect(
      evaluateOrderPromise(promiseOrder({ needsQuote: 0, createdAt: daysAgo(30) }), NOW),
    ).toBeNull();
  });

  it("報價寄過了(quoteSentAt 有)→ 不叫", () => {
    expect(
      evaluateOrderPromise(
        promiseOrder({ quoteSentAt: daysAgo(2), createdAt: daysAgo(30) }),
        NOW,
      ),
    ).toBeNull();
  });

  it("createdAt 缺 → 日期缺就不叫(誠實)", () => {
    expect(evaluateOrderPromise(promiseOrder({ createdAt: null }), NOW)).toBeNull();
  });

  it("狀態被手動推進(quoted,沒 quoteSentAt)→ 系統外處理過,不誤報", () => {
    expect(
      evaluateOrderPromise(promiseOrder({ status: "quoted", createdAt: daysAgo(30) }), NOW),
    ).toBeNull();
  });

  it("cancelled → 不叫", () => {
    expect(
      evaluateOrderPromise(promiseOrder({ status: "cancelled", createdAt: daysAgo(30) }), NOW),
    ).toBeNull();
  });

  it("LA 曆日不是 UTC 曆日:UTC 差 8 天但 LA 差 7 天 → 不叫", () => {
    // created = UTC 06-23 12:00(LA 06-23 05:00);now = UTC 07-01 04:00(LA 06-30 21:00)。
    // UTC 曆日差 8(會誤叫),LA 曆日差 7(還沒過期)。
    const f = evaluateOrderPromise(
      promiseOrder({ createdAt: new Date("2026-06-23T12:00:00Z") }),
      new Date("2026-07-01T04:00:00Z"),
    );
    expect(f).toBeNull();
  });

  it("needsQuote 吃 boolean(list 投影)也行", () => {
    const f = evaluateOrderPromise(
      promiseOrder({ needsQuote: true, createdAt: daysAgo(9) }),
      NOW,
    );
    expect(f!.reason).toBe("quoteUnsent");
  });

  it("threshold 常數:報價 7 天、確認書 3 天", () => {
    expect(WATCHDOG_QUOTE_PROMISE_DAYS).toBe(7);
    expect(WATCHDOG_CONFIRMATION_PROMISE_DAYS).toBe(3);
  });
});

describe("evaluateOrderPromise — 訂金收了確認書還沒寄", () => {
  const paidOrder = (over: Partial<OrderPromiseInput> = {}) =>
    promiseOrder({ status: "deposit_paid", depositPaidAt: daysAgo(4), ...over });

  it("deposit_paid + 訂金收了 4 天 + 沒確認書 → 黃燈 confirmationUnsent", () => {
    const f = evaluateOrderPromise(paidOrder(), NOW);
    expect(f).not.toBeNull();
    expect(f!.kind).toBe("promise");
    expect(f!.level).toBe("yellow");
    expect(f!.reason).toBe("confirmationUnsent");
    expect(f!.daysWaiting).toBe(4);
  });

  it("paid(尾款也收了)一樣要叫", () => {
    const f = evaluateOrderPromise(paidOrder({ status: "paid" }), NOW);
    expect(f!.reason).toBe("confirmationUnsent");
  });

  it("剛好 3 天 → 還沒過期,不叫", () => {
    expect(evaluateOrderPromise(paidOrder({ depositPaidAt: daysAgo(3) }), NOW)).toBeNull();
  });

  it("確認書寄過了(confirmedAt 有)→ 不叫", () => {
    expect(
      evaluateOrderPromise(paidOrder({ confirmedAt: daysAgo(1), depositPaidAt: daysAgo(30) }), NOW),
    ).toBeNull();
  });

  it("depositPaidAt 缺 → 資料缺就不叫(誠實)", () => {
    expect(evaluateOrderPromise(paidOrder({ depositPaidAt: null }), NOW)).toBeNull();
  });

  it("confirmed(手動推進,沒 confirmedAt)→ 確認已處理,不誤報", () => {
    expect(
      evaluateOrderPromise(paidOrder({ status: "confirmed", depositPaidAt: daysAgo(30) }), NOW),
    ).toBeNull();
  });

  it("departed / completed → 出發後確認書沒意義,不叫", () => {
    expect(
      evaluateOrderPromise(paidOrder({ status: "departed", depositPaidAt: daysAgo(30) }), NOW),
    ).toBeNull();
    expect(
      evaluateOrderPromise(paidOrder({ status: "completed", depositPaidAt: daysAgo(30) }), NOW),
    ).toBeNull();
  });

  it("draft 帶 depositPaidAt(壞資料)→ 確認書規則不跑", () => {
    const f = evaluateOrderPromise(
      promiseOrder({ status: "draft", needsQuote: 0, depositPaidAt: daysAgo(30) }),
      NOW,
    );
    expect(f).toBeNull();
  });

  it("cancelled → 不叫", () => {
    expect(
      evaluateOrderPromise(paidOrder({ status: "cancelled", depositPaidAt: daysAgo(30) }), NOW),
    ).toBeNull();
  });

  it("吃 ISO string 日期(tRPC 序列化)也行", () => {
    const f = evaluateOrderPromise(
      paidOrder({ depositPaidAt: daysAgo(5).toISOString() }),
      NOW,
    );
    expect(f!.daysWaiting).toBe(5);
  });
});

describe("evaluateOrderPromise — category 豁免(visa 沒有確認單交付物)", () => {
  const paidOrder = (over: Partial<OrderPromiseInput> = {}) =>
    promiseOrder({ status: "deposit_paid", depositPaidAt: daysAgo(4), ...over });

  it("visa + deposit_paid 超過 3 天沒確認書 → 豁免不叫(ORD-2026-0004 那種)", () => {
    // 簽證單交付物是簽證/護照本身(手動追),confirmedAt 永遠不會寫;
    // 不豁免就是從第 4 天起永遠誤報。
    expect(evaluateOrderPromise(paidOrder({ category: "visa" }), NOW)).toBeNull();
    // 拖再久也一樣豁免(不是門檻問題,是規則不適用)
    expect(
      evaluateOrderPromise(paidOrder({ category: "visa", depositPaidAt: daysAgo(60) }), NOW),
    ).toBeNull();
  });

  it("visa + paid(尾款也收了)一樣豁免", () => {
    expect(
      evaluateOrderPromise(paidOrder({ category: "visa", status: "paid" }), NOW),
    ).toBeNull();
  });

  it("flight 同狀態照叫(機票有出票憑證,確認書規則適用)", () => {
    const f = evaluateOrderPromise(paidOrder({ category: "flight" }), NOW);
    expect(f).not.toBeNull();
    expect(f!.reason).toBe("confirmationUnsent");
    expect(f!.daysWaiting).toBe(4);
  });

  it("quote / general / NULL(未標)照叫 — fail-visible,只有明確 visa 才豁免", () => {
    expect(evaluateOrderPromise(paidOrder({ category: "quote" }), NOW)!.reason).toBe(
      "confirmationUnsent",
    );
    // general 是雜項桶:收得到訂金代表背後有真交付物,豁免會讓真單永遠沉默
    expect(evaluateOrderPromise(paidOrder({ category: "general" }), NOW)!.reason).toBe(
      "confirmationUnsent",
    );
    expect(evaluateOrderPromise(paidOrder({ category: null }), NOW)!.reason).toBe(
      "confirmationUnsent",
    );
  });

  it("visa 的報價規則(quoteUnsent)不豁免 — 答應了報價一樣要寄", () => {
    const f = evaluateOrderPromise(
      promiseOrder({ category: "visa", createdAt: daysAgo(8) }),
      NOW,
    );
    expect(f).not.toBeNull();
    expect(f!.reason).toBe("quoteUnsent");
    expect(f!.daysWaiting).toBe(8);
  });

  it("豁免名單目前只有 visa(新 category 預設不豁免)", () => {
    expect([...WATCHDOG_CONFIRMATION_EXEMPT_CATEGORIES]).toEqual(["visa"]);
  });
});

describe("findOrderPromiseIssues — 多張排序", () => {
  it("只回過期的,等最久的在前", () => {
    const orders: OrderPromiseInput[] = [
      promiseOrder({ id: 1, createdAt: daysAgo(8) }), // quote 8 天
      promiseOrder({ id: 2, createdAt: daysAgo(3) }), // 還沒過期
      promiseOrder({ id: 3, status: "deposit_paid", depositPaidAt: daysAgo(12) }), // 確認書 12 天
      promiseOrder({ id: 4, status: "cancelled", createdAt: daysAgo(30) }), // 跳過
    ];
    const out = findOrderPromiseIssues(orders, NOW);
    expect(out.map((f) => f.orderId)).toEqual([3, 1]);
    expect(out.map((f) => f.reason)).toEqual(["confirmationUnsent", "quoteUnsent"]);
  });

  it("全沒事 → 空陣列", () => {
    expect(findOrderPromiseIssues([promiseOrder({ createdAt: daysAgo(1) })], NOW)).toEqual([]);
  });

  it("空輸入 → 空陣列", () => {
    expect(findOrderPromiseIssues([], NOW)).toEqual([]);
  });
});
