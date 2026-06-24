/**
 * customerFacts tests — the DETERMINISTIC half of the customer summary.
 *
 * The whole point of this module is that「做了什麼 / 給了什麼」cannot lie, so the
 * pure derivers are tested hard: every authoritative signal maps to the right
 * line, non-delivered statuses are excluded, empty → a friendly fallback (never
 * a blank or a hallucinated「待交付」). gatherCustomerFacts's db-down path is
 * covered too. No LLM, no real DB.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import {
  deriveActions,
  deriveDelivered,
  formatFactsLedger,
  gatherCustomerFacts,
  EMPTY_FACTS,
  type CustomerFacts,
  type OrderFact,
} from "./customerFacts";

function facts(over: Partial<CustomerFacts> = {}): CustomerFacts {
  return { ...EMPTY_FACTS, ...over };
}

function order(over: Partial<OrderFact> = {}): OrderFact {
  return {
    orderNumber: "ORD-2026-0001",
    title: "台灣 12 天",
    status: "draft",
    currency: "USD",
    quoteSentAt: null,
    collectionSentAt: null,
    depositPaidAt: null,
    balancePaidAt: null,
    confirmedAt: null,
    ...over,
  };
}

const JUN18 = new Date(2026, 5, 18); // month is 0-based → 6/18
const JUN22 = new Date(2026, 5, 22);

describe("deriveActions (做了什麼)", () => {
  it("empty facts → friendly fallback, never blank", () => {
    expect(deriveActions(facts())).toBe("目前還沒有對外動作記錄");
  });

  it("counts our outbound replies with the last date", () => {
    expect(
      deriveActions(facts({ outboundCount: 3, outboundLastAt: JUN18 })),
    ).toBe("回了 3 封信,最後 6/18");
  });

  it("reads each system timestamp as a distinct verb", () => {
    const r = deriveActions(
      facts({
        orders: [
          order({ quoteSentAt: JUN18, depositPaidAt: JUN22, confirmedAt: JUN22 }),
        ],
      }),
    );
    expect(r).toContain("寄了報價");
    expect(r).toContain("收了訂金");
    expect(r).toContain("出了確認書");
  });

  it("combines replies + order verbs", () => {
    const r = deriveActions(
      facts({
        outboundCount: 2,
        outboundLastAt: JUN18,
        orders: [order({ quoteSentAt: JUN18 })],
      }),
    );
    expect(r).toContain("回了 2 封信");
    expect(r).toContain("寄了報價");
  });
});

describe("deriveDelivered (給了什麼)", () => {
  it("empty facts → friendly fallback, never 待交付/blank", () => {
    expect(deriveDelivered(facts())).toBe("目前還沒有交付任何文件給客人");
  });

  it("lists the quote + confirmation an order actually sent, with order# and date", () => {
    const r = deriveDelivered(
      facts({ orders: [order({ quoteSentAt: JUN18, confirmedAt: JUN22 })] }),
    );
    expect(r).toContain("報價(ORD-2026-0001,6/18)");
    expect(r).toContain("確認書(ORD-2026-0001,6/22)");
  });

  it("includes only delivered-status aiQuotes (sent/viewed/converted), not generated", () => {
    const r = deriveDelivered(
      facts({
        quotes: [
          { quoteNumber: "QUOTE-9", status: "sent", createdAt: null },
          { quoteNumber: "QUOTE-8", status: "generated", createdAt: null },
        ],
      }),
    );
    expect(r).toContain("報價單 QUOTE-9");
    expect(r).not.toContain("QUOTE-8");
  });

  it("includes only sent/paid/overdue invoices, not drafts", () => {
    const r = deriveDelivered(
      facts({
        invoices: [
          { invoiceNumber: "INV-1", status: "paid", sentAt: null, paidAt: JUN22 },
          { invoiceNumber: "INV-2", status: "draft", sentAt: null, paidAt: null },
        ],
      }),
    );
    expect(r).toContain("發票 INV-1");
    expect(r).not.toContain("INV-2");
  });

  it("does not duplicate identical parts", () => {
    const r = deriveDelivered(
      facts({
        orders: [
          order({ orderNumber: "", quoteSentAt: null, confirmedAt: null }),
        ],
        quotes: [
          { quoteNumber: "QUOTE-1", status: "sent", createdAt: null },
          { quoteNumber: "QUOTE-1", status: "viewed", createdAt: null },
        ],
      }),
    );
    expect(r.match(/報價單 QUOTE-1/g)?.length ?? 0).toBe(1);
  });

  it("lists files we emailed the customer, by name with the extension stripped", () => {
    const r = deriveDelivered(
      facts({
        deliveredDocs: [
          { fileName: "Jenny_台灣環島13天12夜_報價與行程_2026.pdf", sentAt: JUN22 },
          { fileName: "2026_Taiwan_Group_Tour_Itinerary_EN.pdf", sentAt: JUN22 },
        ],
      }),
    );
    expect(r).toContain("Jenny_台灣環島13天12夜_報價與行程_2026");
    expect(r).toContain("2026_Taiwan_Group_Tour_Itinerary_EN");
    expect(r).not.toContain(".pdf");
  });

  it("an inquiry customer with only email-sent docs is NOT reported as 還沒交付 (the Jenny regression)", () => {
    const r = deriveDelivered(
      facts({ deliveredDocs: [{ fileName: "Jenny_報價與行程_2026.pdf", sentAt: JUN22 }] }),
    );
    expect(r).not.toContain("還沒有交付");
    expect(r).toContain("Jenny_報價與行程_2026");
  });

  it("combines a sent order quote with separately-emailed docs", () => {
    const r = deriveDelivered(
      facts({
        orders: [order({ quoteSentAt: JUN18 })],
        deliveredDocs: [{ fileName: "英文行程表.pdf", sentAt: JUN22 }],
      }),
    );
    expect(r).toContain("報價(ORD-2026-0001,6/18)");
    expect(r).toContain("英文行程表");
  });
});

describe("formatFactsLedger (LLM grounding)", () => {
  it("states there is no order when there are none", () => {
    expect(formatFactsLedger(facts())).toContain("目前沒有訂製單");
  });

  it("surfaces the authoritative stamps so nextStep cannot re-suggest done work", () => {
    const r = formatFactsLedger(
      facts({ orders: [order({ status: "quoted", quoteSentAt: JUN18 })] }),
    );
    expect(r).toContain("狀態=quoted");
    expect(r).toContain("報價已寄 6/18");
  });

  it("lists delivered quotes and the inbound/outbound counts", () => {
    const r = formatFactsLedger(
      facts({
        quotes: [{ quoteNumber: "QUOTE-5", status: "sent", createdAt: null }],
        outboundCount: 4,
        inboundCount: 2,
        outboundLastAt: JUN18,
      }),
    );
    expect(r).toContain("已送出報價單:QUOTE-5");
    expect(r).toContain("我們回了 4 封,客人來了 2 封");
  });

  it("surfaces emailed docs so nextStep cannot re-suggest sending them", () => {
    const r = formatFactsLedger(
      facts({ deliveredDocs: [{ fileName: "Jenny_報價與行程_2026.pdf", sentAt: JUN22 }] }),
    );
    expect(r).toContain("已 email 寄給客人的文件");
    expect(r).toContain("Jenny_報價與行程_2026");
  });
});

describe("gatherCustomerFacts (IO)", () => {
  it("returns EMPTY_FACTS when the DB is unavailable (summary still renders)", async () => {
    expect(await gatherCustomerFacts({ profileId: 1 })).toEqual(EMPTY_FACTS);
    expect(await gatherCustomerFacts({ userId: 7 })).toEqual(EMPTY_FACTS);
  });
});
