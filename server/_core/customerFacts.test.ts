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
// Marker-object mocks so the spam-filter test can assert WHICH condition was
// attached to WHICH query (same pattern as customerPreferenceExtractor.test.ts).
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ kind: "eq", a, b })),
  or: vi.fn((...args: any[]) => ({ kind: "or", args })),
  and: vi.fn((...args: any[]) => ({ kind: "and", args })),
  inArray: vi.fn((a: any, b: any) => ({ kind: "inArray", a, b })),
  desc: vi.fn((c: any) => c),
  sql: vi.fn((strings: TemplateStringsArray, ...vals: any[]) => ({
    kind: "sql",
    text: strings.join("?"),
    vals,
  })),
}));
vi.mock("../../drizzle/schema", () => ({
  users: { id: "u.id", email: "u.email" },
  customerProfiles: { id: "cp.id", userId: "cp.userId", email: "cp.email" },
  customOrders: {
    orderNumber: "co.orderNumber", title: "co.title", status: "co.status",
    currency: "co.currency", quoteSentAt: "co.quoteSentAt",
    collectionSentAt: "co.collectionSentAt", depositPaidAt: "co.depositPaidAt",
    balancePaidAt: "co.balancePaidAt", confirmedAt: "co.confirmedAt",
    customerProfileId: "co.customerProfileId", createdAt: "co.createdAt",
  },
  aiQuotes: {
    quoteNumber: "aq.quoteNumber", status: "aq.status", createdAt: "aq.createdAt",
    userId: "aq.userId", customerEmail: "aq.customerEmail",
  },
  invoices: {
    invoiceNumber: "inv.invoiceNumber", status: "inv.status", sentAt: "inv.sentAt",
    paidAt: "inv.paidAt", userId: "inv.userId", customerEmail: "inv.customerEmail",
    createdAt: "inv.createdAt",
  },
  customerInteractions: {
    customerProfileId: "ci.customerProfileId", direction: "ci.direction",
    createdAt: "ci.createdAt", classification: "ci.classification",
    spamVerdict: "ci.spamVerdict",
  },
  customerDocuments: {
    customerProfileId: "cd.customerProfileId", uploadedBy: "cd.uploadedBy",
    type: "cd.type", fileName: "cd.fileName", uploadedAt: "cd.uploadedAt",
  },
  bookings: { userId: "b.userId", bookingStatus: "b.bookingStatus" },
}));

import { getDb } from "../db";
import {
  deriveActions,
  deriveDelivered,
  formatFactsLedger,
  gatherCustomerFacts,
  todayLA,
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

// Fixed instants whose Pacific (business tz) calendar date is unambiguous on any
// CI runner: 18:00Z = 11:00 PDT, same day in both UTC and LA — so md() renders
// 6/18 / 6/22 regardless of the runner's own timezone.
const JUN18 = new Date("2026-06-18T18:00:00Z"); // → 6/18
const JUN22 = new Date("2026-06-22T18:00:00Z"); // → 6/22

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

  it("lists files we emailed the customer, by name (extension stripped), NO date", () => {
    // customerDocuments.uploadedAt is filing/backfill time, never the real send
    // date (Jenny's whole thread backfilled 6/22 but went out 6/10–6/15). A
    // filing-time date next to a doc reads as a send date and lies, so we show
    // the name only. sentAt is carried in the fact but deliberately not rendered.
    const r = deriveDelivered(
      facts({
        deliveredDocs: [
          { fileName: "Jenny_台灣環島13天12夜_報價與行程_2026.pdf" },
          { fileName: "2026_Taiwan_Group_Tour_Itinerary_EN.pdf" },
        ],
      }),
    );
    expect(r).toContain("Jenny_台灣環島13天12夜_報價與行程_2026");
    expect(r).toContain("2026_Taiwan_Group_Tour_Itinerary_EN");
    expect(r).not.toContain(".pdf");
    expect(r).not.toContain("(6/22)");
  });

  it("an inquiry customer with only email-sent docs is NOT reported as 還沒交付 (the Jenny regression)", () => {
    const r = deriveDelivered(
      facts({ deliveredDocs: [{ fileName: "Jenny_報價與行程_2026.pdf" }] }),
    );
    expect(r).not.toContain("還沒有交付");
    expect(r).toContain("Jenny_報價與行程_2026");
  });

  it("dates ORDER actions in PACK&GO's business tz, not the server's UTC", () => {
    // Order/quote dates come from authoritative action stamps (quoteSentAt) so
    // they DO render. 02:00Z on 6/23 = 19:00 PDT on 6/22 — Jeff's calendar day,
    // and the 文件 tab, both say 6/22. A naive UTC getDate() would print 6/23.
    const lateEveningPdt = new Date("2026-06-23T02:00:00Z");
    const r = deriveDelivered(
      facts({ orders: [order({ quoteSentAt: lateEveningPdt })] }),
    );
    expect(r).toContain("報價(ORD-2026-0001,6/22)");
    expect(r).not.toContain("6/23");
  });

  it("combines a sent order quote (dated) with separately-emailed docs (name only)", () => {
    const r = deriveDelivered(
      facts({
        orders: [order({ quoteSentAt: JUN18 })],
        deliveredDocs: [{ fileName: "英文行程表.pdf" }],
      }),
    );
    expect(r).toContain("報價(ORD-2026-0001,6/18)");
    expect(r).toContain("英文行程表");
    expect(r).not.toContain("英文行程表(");
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
      facts({ deliveredDocs: [{ fileName: "Jenny_報價與行程_2026.pdf" }] }),
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

describe("inbound counts exclude unrescued spam (ledger must match what Jeff sees)", () => {
  /** Minimal fake db: records each query's target table + where clause, resolves
   *  the profile lookup so the run reaches the interactions aggregation, and
   *  returns aggRows for the customerInteractions groupBy query. */
  function makeFakeDb(schema: any, aggRows: any[]) {
    const captured: { table: any; where: any }[] = [];
    const db = {
      select: () => {
        const rec: { table: any; where: any } = { table: null, where: null };
        const chain: any = {
          from(t: any) { rec.table = t; captured.push(rec); return chain; },
          where(w: any) { rec.where = w; return chain; },
          orderBy() { return chain; },
          limit() {
            return Promise.resolve(
              rec.table === schema.customerProfiles ? [{ id: 11, email: null }] : [],
            );
          },
          groupBy() {
            return Promise.resolve(
              rec.table === schema.customerInteractions ? aggRows : [],
            );
          },
        };
        return chain;
      },
    };
    return { db, captured };
  }

  it("applies the same NULL-safe spam filter as the sister readers (customerChatContext / adminCustomers) to the direction aggregation", async () => {
    const schema: any = await import("../../drizzle/schema");
    const { db, captured } = makeFakeDb(schema, [
      { direction: "inbound", cnt: 3, last: "2026-06-18T18:00:00.000Z" },
    ]);
    vi.mocked(getDb).mockResolvedValueOnce(db as any);

    const result = await gatherCustomerFacts({ profileId: 11 });
    // counts flow from the (filtered) SQL aggregation — if the fake db shape
    // drifted, gather would swallow the error and return EMPTY_FACTS instead.
    expect(result.inboundCount).toBe(3);

    const agg = captured.find((c) => c.table === schema.customerInteractions);
    expect(agg).toBeDefined();
    // Must be inArray AND the spam exclusion — a bare inArray lets unrescued
    // spam inflate inboundCount/inboundLastAt with mail Jeff never sees.
    const where: any = agg!.where;
    expect(where?.kind).toBe("and");
    const spam = (where.args as any[]).find((a: any) => a?.kind === "sql");
    expect(spam).toBeDefined();
    expect(spam.text).toContain("NOT (COALESCE(");
    expect(spam.text).toContain("= 'spam'");
    expect(spam.text).toContain("!= 'rescued'");
    expect(spam.vals).toContain(schema.customerInteractions.classification);
    expect(spam.vals).toContain(schema.customerInteractions.spamVerdict);
  });
});

describe("todayLA (摘要日期 grounding,2026-07-02)", () => {
  it("回傳美西日曆的 YYYY-MM-DD", () => {
    // 12:00 UTC = 美西早上(同一天)
    expect(todayLA(new Date("2026-07-02T12:00:00Z"))).toBe("2026-07-02");
  });

  it("UTC 已過午夜但美西還是前一天 → 用美西日曆(Fly=UTC 的核心用例)", () => {
    // 2026-07-03 02:00 UTC = 2026-07-02 19:00 PDT
    expect(todayLA(new Date("2026-07-03T02:00:00Z"))).toBe("2026-07-02");
  });

  it("無參數也回 YYYY-MM-DD 形狀", () => {
    expect(todayLA()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
