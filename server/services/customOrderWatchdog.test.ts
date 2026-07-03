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
  extractInvoiceTotal,
  evaluateInvoiceMismatch,
  findInvoiceMismatchIssues,
  matchPaymentsToOrders,
  evaluateCommitment,
  findCommitmentIssues,
  type OrderMarginInput,
  type OrderPromiseInput,
  type OrderInvoiceMismatchInput,
  type OrderPaymentMatchInput,
  type BankTransactionInput,
  type CommitmentInput,
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

// ── 2a:訂單金額對 invoice 看門狗 ───────────────────────────────────────────

describe("extractInvoiceTotal — 抓文字裡的總額", () => {
  it("英文 Total: $1,234.56 → 抓到金額", () => {
    expect(extractInvoiceTotal("Subtotal: $1,000.00\nTotal: $1,234.56")).toBe(1234.56);
  });

  it("中文 合計:NT$ 或美金皆有時只認美金 — 純中文合計 6,621.40", () => {
    expect(extractInvoiceTotal("項目明細...\n合計: $6,621.40")).toBe(6621.40);
  });

  it("Grand Total 錨點也認得", () => {
    expect(extractInvoiceTotal("Item A $500\nGrand Total: $500.00")).toBe(500);
  });

  it("Amount Due 錨點也認得", () => {
    expect(extractInvoiceTotal("Amount Due: 999.99")).toBe(999.99);
  });

  it("找不到任何錨點金額 → null", () => {
    expect(extractInvoiceTotal("這是一份沒有總額的行程表,只有景點介紹。")).toBeNull();
  });

  it("空字串 → null", () => {
    expect(extractInvoiceTotal("")).toBeNull();
  });

  it("找到兩個不同數值的候選 → null(模糊,不猜)", () => {
    const text = "小計 Total: $100.00\n...\n總計: $200.00";
    expect(extractInvoiceTotal(text)).toBeNull();
  });

  it("同一數值出現兩次(小計行+頁尾)不算模糊,回傳那個值", () => {
    const text = "Total: $6,621.40\n...\n合計: $6,621.40";
    expect(extractInvoiceTotal(text)).toBe(6621.40);
  });

  it("NT$ 非美金幣別 → 不當候選,整份找不到就 null", () => {
    expect(extractInvoiceTotal("總計: NT$172,600")).toBeNull();
  });

  it("NT$ 候選被排除,但同時有一個 USD 候選 → 採 USD 那個", () => {
    const text = "供應商合計: NT$172,600\nTotal: $5,393.00";
    expect(extractInvoiceTotal(text)).toBe(5393);
  });

  it("同一行雙幣別「Grand Total: NT$X (approx US$Y)」→ 抓到補記的 US$ 金額", () => {
    expect(extractInvoiceTotal("Grand Total: NT$172,600 (approx US$5,393)")).toBe(5393);
  });

  it("同一行雙幣別中文「Total: NT$X(約合 US$Y)」→ 抓到補記的 US$ 金額", () => {
    expect(extractInvoiceTotal("Total: NT$172,600(約合 US$5,393)")).toBe(5393);
  });

  it("日圓/歐元/港幣符號同樣不當候選", () => {
    expect(extractInvoiceTotal("Total: ¥50,000")).toBeNull();
    expect(extractInvoiceTotal("Total: €500.00")).toBeNull();
    expect(extractInvoiceTotal("Total: HK$3,000")).toBeNull();
  });

  it("千分位逗號格式支援", () => {
    expect(extractInvoiceTotal("Total: $12,345.67")).toBe(12345.67);
  });

  it("無幣別符號的純數字也算 USD 候選", () => {
    expect(extractInvoiceTotal("應付總額 6635")).toBe(6635);
  });

  it("「total」錨點詞撞到計數語境(非金額)→ 不當候選,回 null", () => {
    expect(
      extractInvoiceTotal("Total number of travelers: 4. Please confirm before Friday."),
    ).toBeNull();
  });

  it("「total」錨點詞裸數字但帶千分位逗號 → 仍算合法金額候選", () => {
    expect(extractInvoiceTotal("Total: 1,234")).toBe(1234);
  });
});

function invoiceOrder(
  over: Partial<OrderInvoiceMismatchInput> = {},
): OrderInvoiceMismatchInput {
  return {
    id: 1,
    orderNumber: "ORD-2026-0001",
    title: "劉偉國家庭團",
    status: "confirmed",
    totalPrice: "6635.00",
    currency: "USD",
    ...over,
  };
}

describe("evaluateInvoiceMismatch — scorecard 真實案例重現", () => {
  it("系統 $6,635 vs 文件 $6,621.40(差 $13.60)→ 叫,黃燈", () => {
    const f = evaluateInvoiceMismatch(invoiceOrder(), [6621.4]);
    expect(f).not.toBeNull();
    expect(f!.kind).toBe("invoiceMismatch");
    expect(f!.level).toBe("yellow");
    expect(f!.systemAmount).toBe(6635);
    expect(f!.documentAmount).toBe(6621.4);
  });

  it("只差 0.5(小於 1 容差)→ 不叫", () => {
    expect(
      evaluateInvoiceMismatch(invoiceOrder({ totalPrice: "6635.00" }), [6634.5]),
    ).toBeNull();
  });

  it("invoiceTotals 空陣列(沒有可信文件金額)→ 不叫", () => {
    expect(evaluateInvoiceMismatch(invoiceOrder(), [])).toBeNull();
  });

  it("invoiceTotals 有兩個不同數值(模糊)→ 不叫", () => {
    expect(evaluateInvoiceMismatch(invoiceOrder(), [6621.4, 6600])).toBeNull();
  });

  it("draft 狀態 → 不叫", () => {
    expect(
      evaluateInvoiceMismatch(invoiceOrder({ status: "draft" }), [6621.4]),
    ).toBeNull();
  });

  it("cancelled 狀態 → 不叫", () => {
    expect(
      evaluateInvoiceMismatch(invoiceOrder({ status: "cancelled" }), [6621.4]),
    ).toBeNull();
  });

  it("非 USD 幣別 → 不叫(不比對非美金訂單)", () => {
    expect(
      evaluateInvoiceMismatch(invoiceOrder({ currency: "TWD" }), [6621.4]),
    ).toBeNull();
  });

  it("totalPrice 缺 → 不叫", () => {
    expect(evaluateInvoiceMismatch(invoiceOrder({ totalPrice: null }), [6621.4])).toBeNull();
  });

  it("totalPrice 空字串 → 不叫", () => {
    expect(evaluateInvoiceMismatch(invoiceOrder({ totalPrice: "" }), [6621.4])).toBeNull();
  });

  it("totalPrice 與唯一候選完全吻合 → 不叫", () => {
    expect(evaluateInvoiceMismatch(invoiceOrder({ totalPrice: "6621.40" }), [6621.4])).toBeNull();
  });

  it("吃 number 型 totalPrice 也行", () => {
    const f = evaluateInvoiceMismatch(invoiceOrder({ totalPrice: 6635 }), [6621.4]);
    expect(f!.systemAmount).toBe(6635);
  });
});

describe("findInvoiceMismatchIssues — 多張單混合", () => {
  it("只回該叫的那些,落差大的排前面", () => {
    const orders: OrderInvoiceMismatchInput[] = [
      invoiceOrder({ id: 1, totalPrice: "6635.00" }), // 差 13.60 → 叫
      invoiceOrder({ id: 2, totalPrice: "1000.00" }), // 吻合 → 不叫
      invoiceOrder({ id: 3, totalPrice: "5000.00" }), // 差 100 → 叫(落差更大)
      invoiceOrder({ id: 4, status: "draft", totalPrice: "9999.00" }), // 跳過
      invoiceOrder({ id: 5, totalPrice: "2000.00" }), // 沒有文件金額 → 不叫
    ];
    const docTotals = new Map<number, number[]>([
      [1, [6621.4]],
      [2, [1000.0]],
      [3, [4900.0]],
      [4, [9000.0]],
      [5, []],
    ]);
    const out = findInvoiceMismatchIssues(orders, docTotals);
    expect(out.map((f) => f.orderId)).toEqual([3, 1]);
  });

  it("空輸入 → 空陣列", () => {
    expect(findInvoiceMismatchIssues([], new Map())).toEqual([]);
  });

  it("訂單沒有對應 docTotals key(未查過)→ 視為空陣列,不叫", () => {
    expect(
      findInvoiceMismatchIssues([invoiceOrder()], new Map()),
    ).toEqual([]);
  });
});

// ── 2c:matchPaymentsToOrders(Plaid 收款建議) ────────────────────────────────

function payOrder(over: Partial<OrderPaymentMatchInput> = {}): OrderPaymentMatchInput {
  return {
    id: 1,
    orderNumber: "ORD-2026-0001",
    title: "台灣12天",
    status: "quoted",
    currency: "USD",
    totalPrice: "5000.00",
    depositAmount: "1000.00",
    balanceAmount: "4000.00",
    depositPaidAt: null,
    balancePaidAt: null,
    ...over,
  };
}

function txn(over: Partial<BankTransactionInput> = {}): BankTransactionInput {
  return {
    id: 1,
    amount: "-1000.00", // 入帳
    date: "2026-06-15",
    accountMask: "1234",
    ...over,
  };
}

describe("matchPaymentsToOrders — 方向守門(頭號地雷)", () => {
  it("amount 為正(支出)絕不匹配,就算絕對值剛好吻合", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ depositAmount: "1000.00" })],
      [txn({ amount: "1000.00" })], // 正號 = 支出
    );
    expect(out).toEqual([]);
  });

  it("amount 為 0 也不匹配(只認嚴格 < 0)", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ depositAmount: "0.00" })],
      [txn({ amount: "0.00" })],
    );
    expect(out).toEqual([]);
  });

  it("amount 為負(入帳)且金額吻合 → 匹配成功", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ depositAmount: "1000.00" })],
      [txn({ amount: "-1000.00" })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].legKind).toBe("deposit");
    expect(out[0].matchedAmount).toBe(1000);
  });
});

describe("matchPaymentsToOrders — 決定還欠哪一段", () => {
  it("depositPaidAt 空且 depositAmount 有值 → 比對 deposit", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ depositAmount: "1000.00", balanceAmount: "4000.00" })],
      [txn({ amount: "-1000.00" })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].legKind).toBe("deposit");
  });

  it("depositPaidAt 已填、balancePaidAt 空且 balanceAmount 有值 → 比對 balance", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ depositPaidAt: "2026-05-01", balanceAmount: "4000.00" })],
      [txn({ amount: "-4000.00" })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].legKind).toBe("balance");
  });

  it("沒有分期欄位、兩個 paidAt 都空、totalPrice 有值 → 比對 total", () => {
    const out = matchPaymentsToOrders(
      [
        payOrder({
          depositAmount: null,
          balanceAmount: null,
          totalPrice: "5000.00",
        }),
      ],
      [txn({ amount: "-5000.00" })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].legKind).toBe("total");
  });

  it("已收款那條腿不再叫:depositPaidAt 已填,即使交易金額吻合 depositAmount 也不出現 deposit finding(轉去比對 balance,balance 也已收完 → 完全不叫)", () => {
    const out = matchPaymentsToOrders(
      [
        payOrder({
          depositAmount: "1000.00",
          balanceAmount: "4000.00",
          depositPaidAt: "2026-05-01",
          balancePaidAt: "2026-05-20",
        }),
      ],
      [txn({ amount: "-1000.00" })], // 剛好等於 depositAmount,但訂金早已收完
    );
    expect(out).toEqual([]);
  });

  it("兩段都收完(depositPaidAt/balancePaidAt 都有值)且沒有其他欄位可用 → 不參與比對", () => {
    const out = matchPaymentsToOrders(
      [
        payOrder({
          depositPaidAt: "2026-05-01",
          balancePaidAt: "2026-05-20",
        }),
      ],
      [txn({ amount: "-5000.00" })],
    );
    expect(out).toEqual([]);
  });
});

describe("matchPaymentsToOrders — 同額多單", () => {
  it("兩張訂單都欠同一金額,同一筆交易吻合兩張 → 兩條 finding,candidateOrderIds 都含兩張單", () => {
    const orders = [
      payOrder({ id: 1, orderNumber: "ORD-1", depositAmount: "1000.00" }),
      payOrder({ id: 2, orderNumber: "ORD-2", depositAmount: "1000.00" }),
    ];
    const out = matchPaymentsToOrders(orders, [txn({ amount: "-1000.00" })]);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.orderId).sort()).toEqual([1, 2]);
    for (const f of out) {
      expect(f.candidateOrderIds.sort()).toEqual([1, 2]);
    }
  });

  it("三張以上同額訂單 → candidateOrderIds 含全部三張", () => {
    const orders = [
      payOrder({ id: 1, orderNumber: "ORD-1", depositAmount: "1000.00" }),
      payOrder({ id: 2, orderNumber: "ORD-2", depositAmount: "1000.00" }),
      payOrder({ id: 3, orderNumber: "ORD-3", depositAmount: "1000.00" }),
    ];
    const out = matchPaymentsToOrders(orders, [txn({ amount: "-1000.00" })]);
    expect(out).toHaveLength(3);
    for (const f of out) {
      expect(f.candidateOrderIds.sort()).toEqual([1, 2, 3]);
    }
  });

  it("同金額但不同 legKind(一張欠 deposit、一張欠 total)純屬巧合同額 → 不應互相牽連,candidateOrderIds 各自只含自己", () => {
    const orders = [
      // 訂單1:deposit 還沒收,目標金額 1000(deposit leg)
      payOrder({
        id: 1,
        orderNumber: "ORD-1",
        depositAmount: "1000.00",
        balanceAmount: "4000.00",
      }),
      // 訂單2:沒有分期欄位,total 剛好也是 1000(total leg)—— 純屬巧合同額
      payOrder({
        id: 2,
        orderNumber: "ORD-2",
        totalPrice: "1000.00",
        depositAmount: null,
        balanceAmount: null,
      }),
    ];
    const out = matchPaymentsToOrders(orders, [txn({ amount: "-1000.00" })]);
    expect(out).toHaveLength(2);
    const byId = new Map(out.map((f) => [f.orderId, f]));
    expect(byId.get(1)!.legKind).toBe("deposit");
    expect(byId.get(1)!.candidateOrderIds).toEqual([1]);
    expect(byId.get(2)!.legKind).toBe("total");
    expect(byId.get(2)!.candidateOrderIds).toEqual([2]);
  });
});

describe("matchPaymentsToOrders — 無吻合金額沉默 / 非 USD 跳過 / draft·cancelled 不參與", () => {
  it("無吻合金額 → 完全沉默(不出現在結果陣列)", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ depositAmount: "1000.00" })],
      [txn({ amount: "-950.00" })],
    );
    expect(out).toEqual([]);
  });

  it("非 USD 訂單 → 沉默跳過,即使金額數字剛好吻合", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ currency: "TWD", depositAmount: "1000.00" })],
      [txn({ amount: "-1000.00" })],
    );
    expect(out).toEqual([]);
  });

  it("draft 狀態不參與", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ status: "draft", depositAmount: "1000.00" })],
      [txn({ amount: "-1000.00" })],
    );
    expect(out).toEqual([]);
  });

  it("cancelled 狀態不參與", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ status: "cancelled", depositAmount: "1000.00" })],
      [txn({ amount: "-1000.00" })],
    );
    expect(out).toEqual([]);
  });
});

describe("matchPaymentsToOrders — 一張單被多筆交易命中,只取最新日期", () => {
  it("兩筆交易都吻合同一張單的目標金額 → 只出一條 finding,用日期較新的那筆", () => {
    const out = matchPaymentsToOrders(
      [payOrder({ depositAmount: "1000.00" })],
      [
        txn({ id: 1, amount: "-1000.00", date: "2026-06-01", accountMask: "1111" }),
        txn({ id: 2, amount: "-1000.00", date: "2026-06-20", accountMask: "2222" }),
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].transactionDate).toBe("2026-06-20");
    expect(out[0].accountMask).toBe("2222");
  });
});

describe("matchPaymentsToOrders — 空輸入", () => {
  it("空訂單 → 空陣列", () => {
    expect(matchPaymentsToOrders([], [txn()])).toEqual([]);
  });

  it("空交易 → 空陣列", () => {
    expect(matchPaymentsToOrders([payOrder()], [])).toEqual([]);
  });
});

// ── 3a:承諾追蹤(commitment)────────────────────────────────────────────────
//
// 蓋:已兌現不叫 / 已撤銷不叫 / dueDate 為 null 永不叫 / 剛好今天到期的邊界
// (定義:todayLA === dueDate 尚未算過期,daysOverdue 必須 >= 1)/ 明確過期
// daysOverdue 正確 / 多筆過期排序(最久過期在前)。

function promise(over: Partial<CommitmentInput> = {}): CommitmentInput {
  return {
    id: 1,
    customerProfileId: 42,
    customOrderId: null,
    promiseText: "週五可以取件",
    dueDate: "2026-06-25",
    fulfilledAt: null,
    dismissedAt: null,
    sourceInteractionId: 500,
    ...over,
  };
}

describe("evaluateCommitment — 已兌現/已撤銷不叫", () => {
  it("fulfilledAt 有值 → null(不管 dueDate 多過期)", () => {
    const out = evaluateCommitment(
      promise({ dueDate: "2026-01-01", fulfilledAt: new Date("2026-06-01") }),
      "2026-07-03",
    );
    expect(out).toBeNull();
  });

  it("dismissedAt 有值 → null(不管 dueDate 多過期)", () => {
    const out = evaluateCommitment(
      promise({ dueDate: "2026-01-01", dismissedAt: new Date("2026-06-01") }),
      "2026-07-03",
    );
    expect(out).toBeNull();
  });

  it("fulfilledAt 為字串也算有值 → null", () => {
    const out = evaluateCommitment(
      promise({ dueDate: "2026-01-01", fulfilledAt: "2026-06-01T00:00:00Z" }),
      "2026-07-03",
    );
    expect(out).toBeNull();
  });
});

describe("evaluateCommitment — dueDate 為 null 永不叫", () => {
  it("dueDate 為 null → null(抽不出日期就沒有判斷基準)", () => {
    const out = evaluateCommitment(promise({ dueDate: null }), "2026-07-03");
    expect(out).toBeNull();
  });
});

describe("evaluateCommitment — 剛好今天到期的邊界", () => {
  it("dueDate === todayLA(今天就是到期日當天)→ 尚未算過期,回 null", () => {
    const out = evaluateCommitment(promise({ dueDate: "2026-07-03" }), "2026-07-03");
    expect(out).toBeNull();
  });

  it("dueDate 是明天(還沒到期)→ null", () => {
    const out = evaluateCommitment(promise({ dueDate: "2026-07-04" }), "2026-07-03");
    expect(out).toBeNull();
  });

  it("dueDate 是昨天(隔天才算過期)→ 過期,daysOverdue = 1", () => {
    const out = evaluateCommitment(promise({ dueDate: "2026-07-02" }), "2026-07-03");
    expect(out).not.toBeNull();
    expect(out!.daysOverdue).toBe(1);
  });
});

describe("evaluateCommitment — 明確過期", () => {
  it("dueDate 是好幾天前 → 回 finding,daysOverdue 數字正確", () => {
    const out = evaluateCommitment(promise({ dueDate: "2026-06-25" }), "2026-07-03");
    expect(out).not.toBeNull();
    expect(out!.daysOverdue).toBe(8);
    expect(out!.kind).toBe("commitment");
    expect(out!.level).toBe("yellow");
    expect(out!.promiseId).toBe(1);
    expect(out!.customerProfileId).toBe(42);
    expect(out!.dueDate).toBe("2026-06-25");
  });

  it("回傳的 finding 不含 orderId/orderNumber/title(客人層級,不是訂單層級)", () => {
    const out = evaluateCommitment(promise({ dueDate: "2026-06-25" }), "2026-07-03");
    expect(out).not.toHaveProperty("orderId");
    expect(out).not.toHaveProperty("orderNumber");
    expect(out).not.toHaveProperty("title");
  });

  it("customOrderId 為 null 時原樣帶出", () => {
    const out = evaluateCommitment(
      promise({ dueDate: "2026-06-25", customOrderId: null }),
      "2026-07-03",
    );
    expect(out!.customOrderId).toBeNull();
  });

  it("customOrderId 有值時原樣帶出(承諾可以掛在某張訂製單上)", () => {
    const out = evaluateCommitment(
      promise({ dueDate: "2026-06-25", customOrderId: 88 }),
      "2026-07-03",
    );
    expect(out!.customOrderId).toBe(88);
  });
});

describe("findCommitmentIssues — 排序(最久過期在前)", () => {
  it("多筆過期承諾,daysOverdue 大的排最前面", () => {
    const promises = [
      promise({ id: 1, dueDate: "2026-07-01" }), // 2 天前
      promise({ id: 2, dueDate: "2026-06-01" }), // 32 天前
      promise({ id: 3, dueDate: "2026-07-02" }), // 1 天前
    ];
    const out = findCommitmentIssues(promises, "2026-07-03");
    expect(out.map((f) => f.promiseId)).toEqual([2, 1, 3]);
    expect(out.map((f) => f.daysOverdue)).toEqual([32, 2, 1]);
  });

  it("已兌現/已撤銷/dueDate 為 null/未到期 都被濾掉,不影響其餘排序", () => {
    const promises = [
      promise({ id: 1, dueDate: "2026-06-01" }), // 過期
      promise({ id: 2, dueDate: "2026-01-01", fulfilledAt: new Date() }), // 已兌現
      promise({ id: 3, dueDate: null }), // 無日期
      promise({ id: 4, dueDate: "2026-07-04" }), // 未到期
      promise({ id: 5, dueDate: "2026-06-20", dismissedAt: new Date() }), // 已撤銷
    ];
    const out = findCommitmentIssues(promises, "2026-07-03");
    expect(out.map((f) => f.promiseId)).toEqual([1]);
  });

  it("空輸入 → 空陣列", () => {
    expect(findCommitmentIssues([], "2026-07-03")).toEqual([]);
  });
});
