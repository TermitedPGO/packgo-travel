/**
 * Tests for opsTools — the read-only query tools + PII redaction.
 * DB calls are mocked; we verify routing, shape, and the single-vs-bulk
 * PII redaction rule (Jeff 2026-06-01).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Chainable Drizzle query-builder mock. Each terminal (limit/groupBy/orderBy)
// resolves to whatever we queue in `nextRows`.
let nextRows: any[] = [];
function makeDb() {
  const chain: any = {};
  for (const m of ["select", "from", "leftJoin", "where", "orderBy", "groupBy"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => Promise.resolve(nextRows));
  // For COUNT queries that end at .where(...) with no limit, make where awaitable too.
  chain.where = vi.fn(() => {
    const p: any = Promise.resolve(nextRows);
    p.orderBy = () => chain;
    p.groupBy = () => chain;
    p.limit = () => Promise.resolve(nextRows);
    return p;
  });
  return chain;
}

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => makeDb()),
}));

vi.mock("../../../drizzle/schema", () => ({
  tours: { id: "id", title: "title", status: "status", destinationCountry: "dc", destinationCity: "city", duration: "dur" },
  tourDepartures: { id: "id", tourId: "tid", departureDate: "dd", adultPrice: "p", totalSlots: "ts", bookedSlots: "bs", opsStatus: "os", tourLeader: "tl" },
  bookings: { id: "id", customerName: "cn", customerEmail: "ce", customerPhone: "cp", tourId: "tid", departureId: "did", totalPrice: "tp", paymentStatus: "ps", bookingStatus: "bsx", createdAt: "ca" },
  customerProfiles: { id: "id", email: "e", phone: "ph", budgetTier: "bt", bookingCount: "bc", totalSpend: "tsp", vipScore: "vs", aiNotes: "an" },
}));

vi.mock("drizzle-orm", () => {
  const fn = (..._a: any[]) => ({ _op: true });
  return { eq: fn, and: fn, or: fn, gte: fn, lte: fn, sql: Object.assign(fn, { raw: fn }), desc: fn, like: fn };
});

import { READ_TOOLS, executeReadTool } from "./opsTools";

beforeEach(() => { nextRows = []; });

describe("READ_TOOLS definitions", () => {
  it("exposes the 8 curated tools", () => {
    const names = READ_TOOLS.map((t) => t.name);
    expect(names).toContain("count_records");
    expect(names).toContain("aggregate_departures");
    expect(names).toContain("get_finance_summary");
    expect(names).toContain("search_supplier_inventory");
    expect(READ_TOOLS.length).toBe(8);
  });
  it("every tool has a valid input_schema", () => {
    for (const t of READ_TOOLS) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).toHaveProperty("properties");
    }
  });
});

describe("count_records", () => {
  it("returns the real count, not a sample size", async () => {
    nextRows = [{ n: 165 }];
    const out = JSON.parse(await executeReadTool("count_records", { entity: "tours", status: "active" }));
    expect(out.count).toBe(165);
    expect(out.entity).toBe("tours");
  });
  it("counts departures within N days", async () => {
    nextRows = [{ n: 1742 }];
    const out = JSON.parse(await executeReadTool("count_records", { entity: "departures", withinDays: 30 }));
    expect(out.count).toBe(1742);
  });
  it("handles unknown entity", async () => {
    const out = JSON.parse(await executeReadTool("count_records", { entity: "spaceships" }));
    expect(out.error).toBeTruthy();
  });
});

describe("aggregate_departures", () => {
  it("groups by destination with counts", async () => {
    nextRows = [{ g: "日本", n: 4833 }, { g: "中國", n: 620 }];
    const out = JSON.parse(await executeReadTool("aggregate_departures", { groupBy: "destinationCountry" }));
    expect(out.groups[0]).toEqual({ group: "日本", count: 4833 });
    expect(out.groups[1].group).toBe("中國");
  });
});

describe("PII redaction (single full, bulk masked)", () => {
  it("shows full contact for a single booking match", async () => {
    nextRows = [{ id: 1, customerName: "李太太", email: "li@example.com", phone: "5106342307", paymentStatus: "deposit" }];
    const out = JSON.parse(await executeReadTool("search_bookings", { customerName: "李" }));
    expect(out.piiMasked).toBe(false);
    expect(out.bookings[0].email).toBe("li@example.com");
    expect(out.bookings[0].phone).toBe("5106342307");
  });
  it("masks contact when multiple bookings match", async () => {
    nextRows = [
      { id: 1, customerName: "李太太", email: "li@example.com", phone: "5106342307" },
      { id: 2, customerName: "李先生", email: "lee@gmail.com", phone: "4081234567" },
    ];
    const out = JSON.parse(await executeReadTool("search_bookings", { customerName: "李" }));
    expect(out.piiMasked).toBe(true);
    expect(out.bookings[0].email).toBe("l***@example.com");
    expect(out.bookings[0].phone).toBe("***307");
    expect(out.bookings[1].email).toBe("l***@gmail.com");
  });
  it("masks customer CRM contact in bulk", async () => {
    nextRows = [
      { id: 1, email: "a@x.com", phone: "1112223333", vipScore: 9 },
      { id: 2, email: "b@y.com", phone: "4445556666", vipScore: 5 },
    ];
    const out = JSON.parse(await executeReadTool("search_customers", { name: "test" }));
    expect(out.piiMasked).toBe(true);
    expect(out.customers[0].email).toBe("a***@x.com");
  });
});

describe("error safety", () => {
  it("never throws — returns error string for unknown tool", async () => {
    const out = JSON.parse(await executeReadTool("nonexistent_tool", {}));
    expect(out.error).toContain("unknown tool");
  });
});
