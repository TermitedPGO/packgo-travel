/**
 * customerDocumentRender.test — 批八 塊一。純函式 + 三道閘紅綠例 + renderDocumentHtml
 * 讀真實模板整合。io(puppeteer/storage/db/logger)全 mock,gate 一律在 io 前短路,
 * 故整份不啟動瀏覽器、不連 DB。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./puppeteerPool", () => ({ acquirePage: vi.fn(), releasePage: vi.fn() }));
vi.mock("../storage", () => ({ storagePut: vi.fn() }));
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../../drizzle/schema", () => ({ customerDocuments: { __table: "customerDocuments" } }));

import {
  parseAmountToCents,
  formatCents,
  escapeHtml,
  fillTemplate,
  CustomerDocumentError,
  assertAmountWhitelist,
  assertNoCostLeak,
  checkRequiredFields,
  checkHonestyGate,
  checkCurrencyGate,
  computeReceiptAmounts,
  formatCalendarDate,
  formatDateRange,
  termsToHtml,
  buildDocumentValues,
  renderDocumentHtml,
  generateCustomerDocument,
  type OrderForDocument,
} from "./customerDocumentRender";

const baseOrder: OrderForDocument = {
  id: 501,
  orderNumber: "ORD-2026-0501",
  title: "芝加哥 + 尼加拉瀑布 5 日精緻私人遊",
  customerName: "HUANG DAVID XIAO",
  destination: "美國",
  departureDate: "2026-08-22",
  returnDate: "2026-08-26",
  totalPrice: "7196.00",
  currency: "USD",
  supplierCost: "3498.00",
  depositPaidAt: new Date("2026-07-01T00:00:00Z"),
  balancePaidAt: null,
};
const now = new Date("2026-07-05T12:00:00Z");
const LOGOS = { white: "WHITEB64", black: "BLACKB64" };

describe("金額工具", () => {
  it("parseAmountToCents 容錯逗號/空值", () => {
    expect(parseAmountToCents("7196.00")).toBe(719600);
    expect(parseAmountToCents("7,196.5")).toBe(719650);
    expect(parseAmountToCents(null)).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
  });
  it("formatCents 千分位 + 固定兩位", () => {
    expect(formatCents(719600)).toBe("7,196.00");
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(215880)).toBe("2,158.80");
    expect(formatCents(100000000)).toBe("1,000,000.00");
  });
});

describe("computeReceiptAmounts 三態", () => {
  it("deposit_receipt 50% → 已收訂金,餘款 = 售價-訂金", () => {
    const r = computeReceiptAmounts("deposit_receipt", 719600, "50%");
    expect(r.depositCents).toBe(359800);
    expect(r.balanceCents).toBe(359800);
    expect(r.midLabel).toBe("已收訂金（50%）");
    expect(r.balanceLabel).toBe("應付餘款");
    expect(r.whitelist).toEqual(["7,196.00", "3,598.00", "3,598.00"]);
  });
  it("payment_request 30% → 應付訂金,餘款出發前付清", () => {
    const r = computeReceiptAmounts("payment_request", 719600, "30%");
    expect(r.depositCents).toBe(215880);
    expect(r.balanceCents).toBe(503720);
    expect(r.midLabel).toBe("應付訂金（30%）");
    expect(r.balanceLabel).toBe("餘款(出發前付清)");
  });
  it("paid_receipt → 全額,餘款 0,忽略 ratio", () => {
    const r = computeReceiptAmounts("paid_receipt", 719600, undefined);
    expect(r.depositCents).toBe(719600);
    expect(r.balanceCents).toBe(0);
    expect(r.midLabel).toBe("已收款項·全額");
    expect(r.whitelist).toEqual(["7,196.00", "0.00"]);
  });
  it("deposit_receipt 沒給 ratio → 丟 missing_ratio", () => {
    expect(() => computeReceiptAmounts("deposit_receipt", 719600, undefined)).toThrow(
      CustomerDocumentError,
    );
  });
});

describe("閘 3:佔位完整性(fillTemplate)", () => {
  it("殘留 {{ → 丟 placeholder_incomplete", () => {
    try {
      fillTemplate("<p>{{A}} {{B}}</p>", { A: "x" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CustomerDocumentError);
      expect((e as CustomerDocumentError).gate).toBe("placeholder_incomplete");
      expect((e as CustomerDocumentError).message).toContain("{{B}}");
    }
  });
  it("全部填滿 → 替換所有出現位置", () => {
    expect(fillTemplate("<p>{{A}}-{{A}}</p>", { A: "x" })).toBe("<p>x-x</p>");
  });
  it("值含 $ 特殊字元也安全(split/join)", () => {
    expect(fillTemplate("<p>{{A}}</p>", { A: "US$ 5" })).toBe("<p>US$ 5</p>");
  });
});

describe("閘 1:數字白名單(assertAmountWhitelist)", () => {
  it("全部在白名單 → 通過", () => {
    expect(() =>
      assertAmountWhitelist("總價 US$ 7,196.00 訂金 US$ 3,598.00", ["7,196.00", "3,598.00"]),
    ).not.toThrow();
  });
  it("白名單外金額 → 丟 amount_whitelist", () => {
    try {
      assertAmountWhitelist("US$ 7,196.00 混進 US$ 9,999.00", ["7,196.00"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CustomerDocumentError).gate).toBe("amount_whitelist");
      expect((e as CustomerDocumentError).message).toContain("9,999.00");
    }
  });
  it("US$0.00 無空格也能比對", () => {
    expect(() => assertAmountWhitelist("餘款 US$0.00", ["0.00"])).not.toThrow();
  });
});

describe("閘 2:成本防漏(assertNoCostLeak)", () => {
  it("小數形 3,498.00 出現 → 擋", () => {
    try {
      assertNoCostLeak("供應商 US$ 3,498.00 混進來", [349800]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CustomerDocumentError).gate).toBe("cost_leak");
    }
  });
  it("整數形 3498 出現 → 擋", () => {
    expect(() => assertNoCostLeak("成本 3498 元", [349800])).toThrow(CustomerDocumentError);
  });
  it("千分位 3,498 出現 → 擋(去逗號後比對)", () => {
    expect(() => assertNoCostLeak("cost 3,498", [349800])).toThrow(CustomerDocumentError);
  });
  it("成本數字沒出現 → 通過", () => {
    expect(() => assertNoCostLeak("總價 US$ 7,196.00 訂金 US$ 3,598.00", [349800])).not.toThrow();
  });
  it("空 forbidden → 通過", () => {
    expect(() => assertNoCostLeak("任何內容 3498", [])).not.toThrow();
  });
  it("不誤擋更長數字串的子字串(35, 349 不擋 3498)", () => {
    expect(() => assertNoCostLeak("電話 3498765 郵編 34980", [3500 /* $35.00 */])).not.toThrow();
  });
});

describe("閘門強化(對抗審查修補:替代寫法 / 空白千分位 / cents 誤擋 / base64)", () => {
  const wl = ["7,196.00", "3,598.00"];
  it("白名單:替代寫法金額一律擋(US $ / USD / 裸$ / 全形$ / 全形數字)", () => {
    for (const inject of ["US $500", "USD 500", "$500", "US＄500", "US$ ９９９"]) {
      expect(() => assertAmountWhitelist(`合法 US$ 7,196.00,注入 ${inject}`, wl)).toThrow(
        CustomerDocumentError,
      );
    }
  });
  it("白名單:合法金額不同寫法(無小數 / 逗號)以值(cents)比對放行", () => {
    expect(() => assertAmountWhitelist("US$ 7196 與 US$ 3,598.00", wl)).not.toThrow();
  });
  it("成本防漏:空白千分位與 NBSP 都擋", () => {
    expect(() => assertNoCostLeak("成本 3 498 元", [349800])).toThrow(CustomerDocumentError);
    expect(() => assertNoCostLeak("成本 3 498 元", [349800])).toThrow(CustomerDocumentError);
  });
  it("成本防漏:3498.50 的成本不誤擋合法 US$ 3,498.00 售價(finding #3)", () => {
    expect(() => assertNoCostLeak("售價 US$ 3,498.00", [349850])).not.toThrow();
  });
  it("成本防漏:不掃 base64 logo 位元組(finding #4,避免誤擊)", () => {
    const html = `<img src="data:image/png;base64,AAA3498BBB3498CCC" /> 售價 US$ 7,196.00`;
    expect(() => assertNoCostLeak(html, [349800])).not.toThrow();
  });
});

describe("完整性/誠實/幣別閘", () => {
  it("checkRequiredFields 列出缺的欄位", () => {
    const bad: OrderForDocument = { ...baseOrder, totalPrice: null, departureDate: null };
    const missing = checkRequiredFields("deposit_receipt", bad);
    expect(missing).toContain("行程總價(totalPrice)");
    expect(missing).toContain("出發日期(departureDate)");
  });
  it("checkRequiredFields 齊全 → 空陣列", () => {
    expect(checkRequiredFields("quote_summary", baseOrder)).toEqual([]);
  });
  it("誠實閘:deposit_receipt 沒 depositPaidAt → 拒絕", () => {
    expect(checkHonestyGate("deposit_receipt", { ...baseOrder, depositPaidAt: null })).not.toBeNull();
  });
  it("誠實閘:deposit_receipt 有 depositPaidAt → 放行", () => {
    expect(checkHonestyGate("deposit_receipt", baseOrder)).toBeNull();
  });
  it("誠實閘:paid_receipt 沒 balancePaidAt → 拒絕", () => {
    expect(checkHonestyGate("paid_receipt", baseOrder)).not.toBeNull();
  });
  it("誠實閘:payment_request 不看收款(永遠放行)", () => {
    expect(checkHonestyGate("payment_request", { ...baseOrder, depositPaidAt: null })).toBeNull();
  });
  it("幣別閘:非 USD 拒絕,USD/大小寫放行", () => {
    expect(checkCurrencyGate({ ...baseOrder, currency: "TWD" })).not.toBeNull();
    expect(checkCurrencyGate({ ...baseOrder, currency: "usd" })).toBeNull();
    expect(checkCurrencyGate(baseOrder)).toBeNull();
  });
});

describe("日期/條款/逸出", () => {
  it("formatCalendarDate", () => {
    expect(formatCalendarDate("2026-08-22")).toBe("2026 年 8 月 22 日");
  });
  it("formatDateRange:同日不重覆,異日用 至", () => {
    expect(formatDateRange("2026-08-22", "2026-08-22")).toBe("2026 年 8 月 22 日");
    expect(formatDateRange("2026-08-22", "2026-08-26")).toContain("至");
    expect(formatDateRange("2026-08-22", null)).toBe("2026 年 8 月 22 日");
  });
  it("termsToHtml → <li>,逸出 & < >", () => {
    expect(termsToHtml(["A & B", "  ", "C"])).toBe("<li>A &amp; B</li><li>C</li>");
  });
  it("escapeHtml", () => {
    expect(escapeHtml("Pack & Go <x>")).toBe("Pack &amp; Go &lt;x&gt;");
  });
});

describe("buildDocumentValues", () => {
  it("deposit_receipt 值 + 白名單齊全", () => {
    const { values, whitelist } = buildDocumentValues(
      { kind: "deposit_receipt", order: baseOrder, depositRatio: "50%", now },
      LOGOS,
    );
    expect(values.TITLE).toBe("訂金收據");
    expect(values.MID_LABEL).toBe("已收訂金（50%）");
    expect(values.TOTAL).toBe("7,196.00");
    expect(values.DEPOSIT).toBe("3,598.00");
    expect(values.BALANCE).toBe("3,598.00");
    expect(values.PAYEE).toBe("Pack &amp; Go, LLC");
    expect(values.WHITE_LOGO).toBe("WHITEB64");
    expect(whitelist).toEqual(["7,196.00", "3,598.00", "3,598.00"]);
  });
  it("quote_summary:有人數帶 PAX_ROW,沒人數留空", () => {
    const withPax = buildDocumentValues(
      { kind: "quote_summary", order: baseOrder, now, paxCount: 4 },
      LOGOS,
    );
    expect(withPax.values.PAX_ROW).toContain("4 人");
    expect(withPax.whitelist).toEqual(["7,196.00"]);
    const noPax = buildDocumentValues({ kind: "quote_summary", order: baseOrder, now }, LOGOS);
    expect(noPax.values.PAX_ROW).toBe("");
  });
});

describe("renderDocumentHtml(讀真實模板 + 三道閘)", () => {
  it("deposit_receipt 綠例:填滿、金額對、無殘留佔位", () => {
    const html = renderDocumentHtml(
      { kind: "deposit_receipt", order: baseOrder, depositRatio: "50%", now },
      [349800], // supplierCost 在 forbidden,但不出現在文件 → 不擋
    );
    expect(html).toContain("訂金收據");
    expect(html).toContain("US$ 7,196.00");
    expect(html).toContain("US$ 3,598.00");
    expect(html).toContain("已收訂金（50%）");
    expect(html).not.toContain("{{");
    expect(html).not.toContain("3,498.00"); // 成本不在文件內
  });
  it("quote_summary 綠例:單頁報價,只有總價金額", () => {
    const html = renderDocumentHtml(
      { kind: "quote_summary", order: baseOrder, now, paxCount: 2 },
      [349800],
    );
    expect(html).toContain("報價摘要");
    expect(html).toContain("US$ 7,196.00");
    expect(html).toContain("2 人");
    expect(html).not.toContain("{{");
  });
  it("紅例:標題混進白名單外金額 → amount_whitelist 擋", () => {
    const evil: OrderForDocument = { ...baseOrder, title: "行程 US$ 9,999.00 特惠" };
    try {
      renderDocumentHtml({ kind: "deposit_receipt", order: evil, depositRatio: "50%", now }, []);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CustomerDocumentError).gate).toBe("amount_whitelist");
    }
  });
  it("紅例:標題含供應商成本數字 + supplierCost forbidden → cost_leak 擋", () => {
    const evil: OrderForDocument = { ...baseOrder, title: "團費 3498 的行程" };
    try {
      renderDocumentHtml({ kind: "deposit_receipt", order: evil, depositRatio: "50%", now }, [349800]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CustomerDocumentError).gate).toBe("cost_leak");
    }
  });
});

describe("generateCustomerDocument 閘門拒絕(io 前短路,不啟動瀏覽器)", () => {
  it("非 USD → currency 閘拒絕", async () => {
    await expect(
      generateCustomerDocument({
        kind: "deposit_receipt",
        order: { ...baseOrder, currency: "TWD" },
        profileId: 1,
        depositRatio: "50%",
        now,
      }),
    ).rejects.toMatchObject({ gate: "currency" });
  });
  it("缺總價 → incomplete 閘拒絕", async () => {
    await expect(
      generateCustomerDocument({
        kind: "deposit_receipt",
        order: { ...baseOrder, totalPrice: null },
        profileId: 1,
        depositRatio: "50%",
        now,
      }),
    ).rejects.toMatchObject({ gate: "incomplete" });
  });
  it("沒收訂金卻要出訂金收據 → honesty 閘拒絕", async () => {
    await expect(
      generateCustomerDocument({
        kind: "deposit_receipt",
        order: { ...baseOrder, depositPaidAt: null },
        profileId: 1,
        depositRatio: "50%",
        now,
      }),
    ).rejects.toMatchObject({ gate: "honesty" });
  });
});
