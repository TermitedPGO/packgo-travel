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
// resolves to whatever we queue in `nextRows`. Multi-query flows (e.g.
// create_customer: dedup lookup → users lookup → insert) can instead queue
// per-query results in `rowQueue`; each `.limit()` shifts one entry off.
// `lastDb` captures the chain so tests can assert what was written.
let nextRows: any[] = [];
let rowQueue: any[][] = [];
let lastDb: any = null;
const takeRows = () => (rowQueue.length ? rowQueue.shift()! : nextRows);
function makeDb() {
  const chain: any = {};
  for (const m of ["select", "from", "leftJoin", "where", "orderBy", "groupBy", "insert", "values", "update", "set", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => Promise.resolve(takeRows()));
  chain.$returningId = vi.fn(async () => [{ id: 991 }]);
  // For COUNT queries that end at .where(...) with no limit, make where awaitable too.
  chain.where = vi.fn(() => {
    const p: any = Promise.resolve(nextRows);
    p.orderBy = () => chain;
    p.groupBy = () => chain;
    p.limit = () => Promise.resolve(takeRows());
    return p;
  });
  lastDb = chain;
  return chain;
}

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => makeDb()),
}));

vi.mock("../../../drizzle/schema", () => ({
  tours: { id: "id", title: "title", status: "status", destinationCountry: "dc", destinationCity: "city", duration: "dur" },
  tourDepartures: { id: "id", tourId: "tid", departureDate: "dd", adultPrice: "p", totalSlots: "ts", bookedSlots: "bs", opsStatus: "os", tourLeader: "tl" },
  bookings: { id: "id", customerName: "cn", customerEmail: "ce", customerPhone: "cp", tourId: "tid", departureId: "did", totalPrice: "tp", paymentStatus: "ps", bookingStatus: "bsx", createdAt: "ca" },
  bankTransactions: { id: "id", date: "d", merchantName: "mn", description: "desc", amount: "amt", agentCategory: "ac", jeffOverrideCategory: "joc", excludeFromAccounting: "efa", isPending: "ip", receiptUrl: "ru" },
  customerProfiles: { id: "id", name: "n", email: "e", phone: "ph", userId: "uid", status: "st", jeffPersonalNote: "jpn", createdAt: "ca", budgetTier: "bt", bookingCount: "bc", totalSpend: "tsp", vipScore: "vs", aiNotes: "an" },
  customerInteractions: { id: "id", customerProfileId: "cpid", direction: "dir", content: "c", contentSummary: "cs", createdAt: "ca", externalId: "eid" },
  customerDocuments: { customerProfileId: "cpid", type: "t", fileName: "fn", expiresAt: "ea", isCurrent: "ic", uploadedAt: "ua" },
  customOrders: { customerProfileId: "cpid" },
  customerChatMessages: { customerProfileId: "cpid" },
  customerPromises: {
    id: "id",
    customerProfileId: "cpid",
    promiseText: "pt",
    dueDate: "dd",
    sourceInteractionId: "siid",
    extractedAt: "ea",
    fulfilledAt: "fa",
    dismissedAt: "da",
  },
  users: { id: "id", email: "e", name: "n" },
}));

vi.mock("drizzle-orm", () => {
  // Operators are tagged with their name + args so tests can assert the SHAPE
  // of a where clause (e.g. create_customer dedup must OR email + phone).
  const tag = (op: string) => (...args: any[]) => ({ _op: op, args });
  const sql: any = (...args: any[]) => ({ _op: "sql", args });
  sql.raw = tag("raw");
  sql.join = tag("join");
  return {
    eq: tag("eq"), and: tag("and"), or: tag("or"), gte: tag("gte"), lte: tag("lte"),
    isNull: tag("isNull"), isNotNull: tag("isNotNull"), inArray: tag("inArray"),
    sql, desc: tag("desc"), like: tag("like"),
  };
});

const {
  mockCollect,
  mockGetBookingById,
  mockUpdateBooking,
  mockSnapshot,
  mockAudit,
  mockTouchLastInbound,
  mockResolveAndVerifySupplierCost,
  mockGetCustomOrderById,
  mockUpdateCustomOrder,
  mockCreateCustomOrder,
  mockGenerateOrderNumber,
  mockResolveCustomerProfileIds,
  mockOrderBelongsToProfiles,
} = vi.hoisted(() => ({
  mockCollect: vi.fn(),
  mockGetBookingById: vi.fn(),
  mockUpdateBooking: vi.fn(),
  mockSnapshot: vi.fn(),
  mockAudit: vi.fn(),
  mockTouchLastInbound: vi.fn(),
  mockResolveAndVerifySupplierCost: vi.fn(),
  mockGetCustomOrderById: vi.fn(),
  mockUpdateCustomOrder: vi.fn(),
  mockCreateCustomOrder: vi.fn(),
  mockGenerateOrderNumber: vi.fn(),
  mockResolveCustomerProfileIds: vi.fn(),
  mockOrderBelongsToProfiles: vi.fn(),
}));
// merge_into_customer recomputes the target's unread pointer via the shared
// touchLastInbound helper (forward-only semantics live + are unit-tested in
// server/_core/customerUnread).
vi.mock("../../_core/customerUnread", () => ({
  touchLastInbound: mockTouchLastInbound,
}));
vi.mock("./opsActions", () => ({ doCollectCustomerThreads: mockCollect }));
vi.mock("../../db/booking", () => ({
  getBookingById: mockGetBookingById,
  updateBooking: mockUpdateBooking,
}));
vi.mock("../../db/customOrder", () => ({
  getCustomerProfileSnapshot: mockSnapshot,
  getCustomOrderById: mockGetCustomOrderById,
  updateCustomOrder: mockUpdateCustomOrder,
  createCustomOrder: mockCreateCustomOrder,
  generateOrderNumber: mockGenerateOrderNumber,
  resolveCustomerProfileIds: mockResolveCustomerProfileIds,
  orderBelongsToProfiles: mockOrderBelongsToProfiles,
}));
vi.mock("../../_core/auditLog", () => ({ audit: mockAudit }));
vi.mock("../../_core/supplierCostVerification", () => ({
  resolveAndVerifySupplierCost: mockResolveAndVerifySupplierCost,
}));
// merge_into_customer's fire-and-forget summary refresh must not pull the real
// BullMQ/Redis queue into a unit test.
vi.mock("../../queue", () => ({ enqueueCustomerSummaryRefresh: vi.fn() }));

import {
  READ_TOOLS,
  WRITE_TOOLS,
  executeReadTool,
  executeWriteTool,
  resolveFollowUpDateArg,
  resolveCreateCustomOrderArgs,
  resolveUpdateCustomOrderArgs,
  resolveBookingStatusArgs,
  resolveMergeTargetArgs,
  bookingBelongsToCustomer,
  CUSTOM_ORDER_CATEGORIES,
  mergeCustomerNote,
  normalizePhoneForMatch,
} from "./opsTools";

beforeEach(() => {
  nextRows = [];
  rowQueue = [];
  lastDb = null;
  mockCollect.mockReset();
  mockGetBookingById.mockReset();
  mockUpdateBooking.mockReset();
  mockSnapshot.mockReset();
  mockAudit.mockReset();
  mockTouchLastInbound.mockReset();
  mockResolveAndVerifySupplierCost.mockReset();
  mockGetCustomOrderById.mockReset();
  mockUpdateCustomOrder.mockReset();
  mockCreateCustomOrder.mockReset();
  mockGenerateOrderNumber.mockReset();
  mockResolveCustomerProfileIds.mockReset();
  mockOrderBelongsToProfiles.mockReset();
});

describe("READ_TOOLS definitions", () => {
  it("exposes the 15 curated tools", () => {
    const names = READ_TOOLS.map((t) => t.name);
    expect(names).toContain("count_records");
    expect(names).toContain("aggregate_departures");
    expect(names).toContain("get_finance_summary");
    expect(names).toContain("search_supplier_inventory");
    expect(names).toContain("list_missing_receipts");
    expect(names).toContain("preview_customer_threads");
    expect(names).toContain("read_customer_conversation");
    expect(names).toContain("list_followups_needed");
    expect(names).toContain("get_customer_documents");
    expect(names).toContain("get_payment_history");
    expect(names).toContain("list_customer_promises");
    expect(READ_TOOLS.length).toBe(15);
  });
  it("every tool has a valid input_schema", () => {
    for (const t of READ_TOOLS) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).toHaveProperty("properties");
    }
  });
});

describe("set_follow_up_date — AI sets the cockpit follow-up date", () => {
  it("is exposed as a customer-page write tool", () => {
    expect(WRITE_TOOLS.map((t) => t.name)).toContain("set_follow_up_date");
  });

  describe("resolveFollowUpDateArg", () => {
    it("accepts a real YYYY-MM-DD day", () => {
      expect(resolveFollowUpDateArg({ followUpDate: "2026-07-15" })).toEqual({
        ok: true,
        value: "2026-07-15",
      });
    });
    it("clear:true → null (clear), ignoring any date", () => {
      expect(resolveFollowUpDateArg({ clear: true })).toEqual({ ok: true, value: null });
      expect(resolveFollowUpDateArg({ clear: true, followUpDate: "2026-07-15" })).toEqual({
        ok: true,
        value: null,
      });
    });
    it("trims surrounding whitespace", () => {
      expect(resolveFollowUpDateArg({ followUpDate: "  2026-07-15 " })).toEqual({
        ok: true,
        value: "2026-07-15",
      });
    });
    it("rejects a non-calendar day (2026-02-30)", () => {
      const r = resolveFollowUpDateArg({ followUpDate: "2026-02-30" });
      expect(r.ok).toBe(false);
    });
    it("rejects a malformed date", () => {
      expect(resolveFollowUpDateArg({ followUpDate: "next wed" }).ok).toBe(false);
      expect(resolveFollowUpDateArg({ followUpDate: "2026/07/15" }).ok).toBe(false);
    });
    it("rejects missing input (no date, no clear) so the model retries", () => {
      expect(resolveFollowUpDateArg({}).ok).toBe(false);
      expect(resolveFollowUpDateArg(null).ok).toBe(false);
    });

    describe("M/D shorthand (2026-07-01 事故 — model 傳「7/21」被拒後吞掉失敗)", () => {
      // LA noon on 2026-07-01 — the incident day.
      const now = new Date("2026-07-01T12:00:00-07:00");

      it('"7/21" → 2026-07-21 (該月日還沒過 → 今年)', () => {
        expect(resolveFollowUpDateArg({ followUpDate: "7/21" }, now)).toEqual({
          ok: true,
          value: "2026-07-21",
        });
      });
      it('"MM/DD" and "M-D" spellings normalize the same way', () => {
        expect(resolveFollowUpDateArg({ followUpDate: "07/21" }, now)).toEqual({
          ok: true,
          value: "2026-07-21",
        });
        expect(resolveFollowUpDateArg({ followUpDate: "7-21" }, now)).toEqual({
          ok: true,
          value: "2026-07-21",
        });
      });
      it('"1/5" → 2027-01-05 (今年已過 → 明年)', () => {
        expect(resolveFollowUpDateArg({ followUpDate: "1/5" }, now)).toEqual({
          ok: true,
          value: "2027-01-05",
        });
      });
      it("today itself counts as this year", () => {
        expect(resolveFollowUpDateArg({ followUpDate: "7/1" }, now)).toEqual({
          ok: true,
          value: "2026-07-01",
        });
      });
      it('"2/30" still rejected after year inference (非法日照樣拒)', () => {
        const r = resolveFollowUpDateArg({ followUpDate: "2/30" }, now);
        expect(r.ok).toBe(false);
      });
      it("an impossible month is rejected", () => {
        expect(resolveFollowUpDateArg({ followUpDate: "13/5" }, now).ok).toBe(false);
      });
      it("year inference uses the LA calendar day, not UTC", () => {
        // 02:00 UTC on 7/2 is still 19:00 on 7/1 in LA → "7/1" is today, this year.
        const utcAhead = new Date("2026-07-02T02:00:00Z");
        expect(resolveFollowUpDateArg({ followUpDate: "7/1" }, utcAhead)).toEqual({
          ok: true,
          value: "2026-07-01",
        });
      });
      it("full YYYY-MM-DD input is untouched by the shorthand path", () => {
        expect(resolveFollowUpDateArg({ followUpDate: "2026-07-21" }, now)).toEqual({
          ok: true,
          value: "2026-07-21",
        });
      });
    });
  });
});

describe("create_custom_order — AI builds a standalone project for this customer", () => {
  it("is exposed as a customer-page write tool", () => {
    expect(WRITE_TOOLS.map((t) => t.name)).toContain("create_custom_order");
  });

  it("the tool's category enum matches CUSTOM_ORDER_CATEGORIES", () => {
    const tool = WRITE_TOOLS.find((t) => t.name === "create_custom_order")!;
    const enumVals = (tool.input_schema as any).properties.category.enum;
    expect(enumVals).toEqual([...CUSTOM_ORDER_CATEGORIES]);
  });

  describe("resolveCreateCustomOrderArgs", () => {
    it("accepts a minimal order (title only) → sensible defaults", () => {
      const r = resolveCreateCustomOrderArgs({ title: "劉衛國 PEK-SFO 商務艙機票" });
      expect(r).toEqual({
        ok: true,
        value: {
          title: "劉衛國 PEK-SFO 商務艙機票",
          category: null,
          destination: null,
          totalPrice: null,
          supplierCost: null,
          departureDate: null,
          returnDate: null,
          needsQuote: 0,
          notes: null,
        },
      });
    });

    it("normalizes money to a decimal string and keeps a valid category", () => {
      const r = resolveCreateCustomOrderArgs({
        title: "Jeff Green 中國簽證",
        category: "visa",
        totalPrice: 290,
        supplierCost: 180,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.category).toBe("visa");
        expect(r.value.totalPrice).toBe("290");
        expect(r.value.supplierCost).toBe("180");
      }
    });

    it("trims title and rejects an empty / whitespace-only title", () => {
      expect(resolveCreateCustomOrderArgs({ title: "  Air China 機票 " })).toMatchObject({
        ok: true,
        value: { title: "Air China 機票" },
      });
      expect(resolveCreateCustomOrderArgs({ title: "   " }).ok).toBe(false);
      expect(resolveCreateCustomOrderArgs({}).ok).toBe(false);
      expect(resolveCreateCustomOrderArgs(null).ok).toBe(false);
    });

    it("rejects a category outside the whitelist so the model retries", () => {
      const r = resolveCreateCustomOrderArgs({ title: "x", category: "hotel" });
      expect(r.ok).toBe(false);
    });

    it("rejects negative or non-numeric money (never silently coerces to 0)", () => {
      expect(resolveCreateCustomOrderArgs({ title: "x", totalPrice: -5 }).ok).toBe(false);
      expect(resolveCreateCustomOrderArgs({ title: "x", supplierCost: "abc" }).ok).toBe(false);
    });

    it("empty-string money → null (not 0), so a blank stays blank", () => {
      const r = resolveCreateCustomOrderArgs({ title: "x", totalPrice: "", supplierCost: null });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.totalPrice).toBeNull();
        expect(r.value.supplierCost).toBeNull();
      }
    });

    it("accepts a real YYYY-MM-DD but rejects a non-calendar / malformed date", () => {
      expect(resolveCreateCustomOrderArgs({ title: "x", departureDate: "2026-07-04" })).toMatchObject({
        ok: true,
        value: { departureDate: "2026-07-04" },
      });
      expect(resolveCreateCustomOrderArgs({ title: "x", departureDate: "2026-02-30" }).ok).toBe(false);
      expect(resolveCreateCustomOrderArgs({ title: "x", returnDate: "07/04/2026" }).ok).toBe(false);
    });

    it("needsQuote defaults to 0 and is only 1 when explicitly true", () => {
      expect((resolveCreateCustomOrderArgs({ title: "x" }) as any).value.needsQuote).toBe(0);
      expect((resolveCreateCustomOrderArgs({ title: "x", needsQuote: false }) as any).value.needsQuote).toBe(0);
      expect((resolveCreateCustomOrderArgs({ title: "x", needsQuote: true }) as any).value.needsQuote).toBe(1);
    });
  });

  it("executeWriteTool blocks create_custom_order with no customer selected", async () => {
    const out = JSON.parse(
      await executeWriteTool("create_custom_order", { title: "x" }, undefined, 42),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("客人");
  });

  it("executeWriteTool blocks create_custom_order with no admin userId (createdBy)", async () => {
    const out = JSON.parse(
      await executeWriteTool("create_custom_order", { title: "x" }, 2760016, undefined),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("建立者");
  });
});

describe("update_custom_order — AI patches an existing project for this customer", () => {
  it("is exposed as a customer-page write tool", () => {
    expect(WRITE_TOOLS.map((t) => t.name)).toContain("update_custom_order");
  });

  describe("resolveUpdateCustomOrderArgs", () => {
    it("requires a positive orderId", () => {
      expect(resolveUpdateCustomOrderArgs({ title: "x" }).ok).toBe(false);
      expect(resolveUpdateCustomOrderArgs({ orderId: 0, title: "x" }).ok).toBe(false);
      expect(resolveUpdateCustomOrderArgs({ orderId: -3, title: "x" }).ok).toBe(false);
    });

    it("requires at least one field to change", () => {
      expect(resolveUpdateCustomOrderArgs({ orderId: 5 }).ok).toBe(false);
    });

    it("builds a PARTIAL patch of only the provided fields (missing = untouched)", () => {
      // The Morris-Young case: fill only the blank price, leave title/etc alone.
      const r = resolveUpdateCustomOrderArgs({ orderId: 42, totalPrice: 1234 });
      expect(r).toEqual({ ok: true, value: { orderId: 42, patch: { totalPrice: "1234" } } });
    });

    it("accepts orderId as a numeric string", () => {
      const r = resolveUpdateCustomOrderArgs({ orderId: "42", notes: "已付清待標記" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.orderId).toBe(42);
    });

    it("normalizes multiple fields and keeps a valid category", () => {
      const r = resolveUpdateCustomOrderArgs({
        orderId: 7,
        category: "flight",
        totalPrice: 6635,
        departureDate: "2026-07-15",
      });
      expect(r).toEqual({
        ok: true,
        value: {
          orderId: 7,
          patch: { category: "flight", totalPrice: "6635", departureDate: "2026-07-15" },
        },
      });
    });

    it("empty-string destination/notes → null (explicit clear)", () => {
      const r = resolveUpdateCustomOrderArgs({ orderId: 7, destination: "", notes: "" });
      expect(r).toEqual({ ok: true, value: { orderId: 7, patch: { destination: null, notes: null } } });
    });

    it("rejects a blank title (cannot clear the title)", () => {
      expect(resolveUpdateCustomOrderArgs({ orderId: 7, title: "   " }).ok).toBe(false);
    });

    it("rejects bad category / negative money / non-calendar date, model retries", () => {
      expect(resolveUpdateCustomOrderArgs({ orderId: 7, category: "hotel" }).ok).toBe(false);
      expect(resolveUpdateCustomOrderArgs({ orderId: 7, supplierCost: -1 }).ok).toBe(false);
      expect(resolveUpdateCustomOrderArgs({ orderId: 7, departureDate: "2026-02-30" }).ok).toBe(false);
    });
  });

  it("executeWriteTool blocks update_custom_order with no customer selected", async () => {
    const out = JSON.parse(
      await executeWriteTool("update_custom_order", { orderId: 1, notes: "x" }, undefined),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("客人");
  });

  it("executeWriteTool surfaces the validator error (no field to change)", async () => {
    const out = JSON.parse(
      await executeWriteTool("update_custom_order", { orderId: 1 }, 2760016),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("沒有要改的欄位");
  });
});

describe("supplierCost write gate (Phase2 2b) — sourceDocId required + server-verified", () => {
  it("create_custom_order: supplierCost with NO sourceDocId is rejected, other fields still write", async () => {
    mockSnapshot.mockResolvedValue({ userId: null, name: "劉衛國", email: "liu@example.com" });
    mockGenerateOrderNumber.mockResolvedValue("ORD-2026-0099");
    mockCreateCustomOrder.mockImplementation(async (fields: any) => ({ id: 501, ...fields }));

    const out = JSON.parse(
      await executeWriteTool(
        "create_custom_order",
        { title: "劉衛國機票", totalPrice: 500, supplierCost: 300 },
        7001,
        2760016,
      ),
    );

    expect(out.success).toBe(true);
    expect(mockResolveAndVerifySupplierCost).not.toHaveBeenCalled();
    // supplierCost must NOT reach the DB write.
    expect(mockCreateCustomOrder).toHaveBeenCalledWith(
      expect.objectContaining({ supplierCost: null, totalPrice: "500" }),
    );
    expect(out.message).toContain("sourceDocId");
  });

  it("create_custom_order: supplierCost + sourceDocId that FAILS verification is rejected, order still created", async () => {
    mockSnapshot.mockResolvedValue({ userId: null, name: "劉衛國", email: "liu@example.com" });
    mockGenerateOrderNumber.mockResolvedValue("ORD-2026-0100");
    mockCreateCustomOrder.mockImplementation(async (fields: any) => ({ id: 502, ...fields }));
    mockResolveAndVerifySupplierCost.mockResolvedValue({ ok: false, reason: "這個金額沒有出現在指定文件裡" });

    const out = JSON.parse(
      await executeWriteTool(
        "create_custom_order",
        { title: "劉衛國機票", supplierCost: 300, sourceDocId: 55 },
        7001,
        2760016,
      ),
    );

    expect(out.success).toBe(true);
    expect(mockResolveAndVerifySupplierCost).toHaveBeenCalledWith({
      claimedAmount: 300,
      sourceDocId: 55,
      customerProfileId: 7001,
    });
    expect(mockCreateCustomOrder).toHaveBeenCalledWith(expect.objectContaining({ supplierCost: null }));
    expect(out.message).toContain("這個金額沒有出現在指定文件裡");
  });

  it("create_custom_order: supplierCost + sourceDocId that PASSES verification is written", async () => {
    mockSnapshot.mockResolvedValue({ userId: null, name: "劉衛國", email: "liu@example.com" });
    mockGenerateOrderNumber.mockResolvedValue("ORD-2026-0101");
    mockCreateCustomOrder.mockImplementation(async (fields: any) => ({ id: 503, ...fields }));
    mockResolveAndVerifySupplierCost.mockResolvedValue({ ok: true });

    const out = JSON.parse(
      await executeWriteTool(
        "create_custom_order",
        { title: "劉衛國機票", supplierCost: 300, sourceDocId: 55 },
        7001,
        2760016,
      ),
    );

    expect(out.success).toBe(true);
    expect(mockCreateCustomOrder).toHaveBeenCalledWith(expect.objectContaining({ supplierCost: "300" }));
    expect(out.message).not.toContain("sourceDocId");
  });

  it("update_custom_order: supplierCost with NO sourceDocId is rejected, other fields still patch", async () => {
    mockGetCustomOrderById.mockResolvedValue({ id: 42, customerProfileId: 7001, orderNumber: "ORD-2026-0042" });
    mockSnapshot.mockResolvedValue({ userId: null, name: "x", email: "x@example.com" });
    mockOrderBelongsToProfiles.mockReturnValue(true);
    mockUpdateCustomOrder.mockResolvedValue({ orderNumber: "ORD-2026-0042" });

    const out = JSON.parse(
      await executeWriteTool(
        "update_custom_order",
        { orderId: 42, notes: "補票價", supplierCost: 300 },
        7001,
      ),
    );

    expect(out.success).toBe(true);
    expect(mockResolveAndVerifySupplierCost).not.toHaveBeenCalled();
    expect(mockUpdateCustomOrder).toHaveBeenCalledWith(42, expect.objectContaining({ notes: "補票價" }));
    const [, patchArg] = mockUpdateCustomOrder.mock.calls[0];
    expect(patchArg.supplierCost).toBeUndefined();
    expect(out.message).toContain("sourceDocId");
  });

  it("update_custom_order: supplierCost + sourceDocId verified against the ORDER's own customerProfileId", async () => {
    mockGetCustomOrderById.mockResolvedValue({ id: 42, customerProfileId: 8888, orderNumber: "ORD-2026-0042" });
    mockSnapshot.mockResolvedValue({ userId: null, name: "x", email: "x@example.com" });
    mockOrderBelongsToProfiles.mockReturnValue(true);
    mockUpdateCustomOrder.mockResolvedValue({ orderNumber: "ORD-2026-0042" });
    mockResolveAndVerifySupplierCost.mockResolvedValue({ ok: true });

    const out = JSON.parse(
      await executeWriteTool(
        "update_custom_order",
        { orderId: 42, supplierCost: 6621.4, sourceDocId: 9 },
        7001, // pinned profileId differs from the order's own customerProfileId
      ),
    );

    expect(out.success).toBe(true);
    expect(mockResolveAndVerifySupplierCost).toHaveBeenCalledWith({
      claimedAmount: 6621.4,
      sourceDocId: 9,
      customerProfileId: 8888, // the ORDER's profile, not the pinned one
    });
    expect(mockUpdateCustomOrder).toHaveBeenCalledWith(42, expect.objectContaining({ supplierCost: "6621.4" }));
  });

  it("update_custom_order: supplierCost is the ONLY field and verification fails → nothing to patch, clear error", async () => {
    mockGetCustomOrderById.mockResolvedValue({ id: 42, customerProfileId: 7001, orderNumber: "ORD-2026-0042" });
    mockSnapshot.mockResolvedValue({ userId: null, name: "x", email: "x@example.com" });
    mockOrderBelongsToProfiles.mockReturnValue(true);
    mockResolveAndVerifySupplierCost.mockResolvedValue({ ok: false, reason: "找不到指定的文件" });

    const out = JSON.parse(
      await executeWriteTool(
        "update_custom_order",
        { orderId: 42, supplierCost: 300, sourceDocId: 999 },
        7001,
      ),
    );

    expect(out.success).toBeUndefined();
    expect(mockUpdateCustomOrder).not.toHaveBeenCalled();
    expect(out.error).toContain("找不到指定的文件");
  });
});

describe("update_booking_status — cross-customer guard + enum whitelist + audit (P1 2026-07-01)", () => {
  const PROFILE_ID = 500;
  const ADMIN_ID = 42;

  it("tool schema does NOT offer refunded (refunds go through suggest_action)", () => {
    const tool = WRITE_TOOLS.find((t) => t.name === "update_booking_status")!;
    const pay = (tool.input_schema as any).properties.paymentStatus;
    expect(pay.enum).toEqual(["unpaid", "deposit", "paid"]);
    expect(pay.enum).not.toContain("refunded");
  });

  it("blocks with no customer selected (global chat can never write bookings)", async () => {
    const out = JSON.parse(
      await executeWriteTool(
        "update_booking_status",
        { bookingId: 9, paymentStatus: "paid" },
        undefined,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("客人");
    expect(mockUpdateBooking).not.toHaveBeenCalled();
  });

  it("blocks with no admin userId (the audit trail requires an actor)", async () => {
    const out = JSON.parse(
      await executeWriteTool(
        "update_booking_status",
        { bookingId: 9, paymentStatus: "paid" },
        PROFILE_ID,
        undefined,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("操作者");
    expect(mockUpdateBooking).not.toHaveBeenCalled();
  });

  it("rejects someone ELSE's booking (userId and email both mismatch) without writing", async () => {
    mockGetBookingById.mockResolvedValue({
      id: 9,
      userId: 777,
      customerEmail: "other@x.com",
      bookingStatus: "confirmed",
      paymentStatus: "deposit",
    });
    mockSnapshot.mockResolvedValue({ name: "Jenny", email: "jenny@example.com", userId: 111 });
    const out = JSON.parse(
      await executeWriteTool(
        "update_booking_status",
        { bookingId: 9, paymentStatus: "paid" },
        PROFILE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("不是這位客人的");
    expect(mockUpdateBooking).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("rejects an off-enum bookingStatus string BEFORE touching the DB", async () => {
    const out = JSON.parse(
      await executeWriteTool(
        "update_booking_status",
        { bookingId: 9, bookingStatus: "definitely-paid" },
        PROFILE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("bookingStatus");
    expect(mockGetBookingById).not.toHaveBeenCalled();
    expect(mockUpdateBooking).not.toHaveBeenCalled();
  });

  it("rejects paymentStatus=refunded — refunds are Jeff-review only", async () => {
    const out = JSON.parse(
      await executeWriteTool(
        "update_booking_status",
        { bookingId: 9, paymentStatus: "refunded" },
        PROFILE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("suggest_action");
    expect(mockUpdateBooking).not.toHaveBeenCalled();
  });

  it("happy path: pinned customer's own booking → paid, with an audit row (old→new)", async () => {
    mockGetBookingById.mockResolvedValue({
      id: 9,
      userId: 111,
      customerEmail: "jenny@example.com",
      bookingStatus: "confirmed",
      paymentStatus: "deposit",
    });
    mockSnapshot.mockResolvedValue({ name: "Jenny", email: "jenny@example.com", userId: 111 });
    mockUpdateBooking.mockResolvedValue({
      id: 9,
      bookingStatus: "confirmed",
      paymentStatus: "paid",
    });
    const out = JSON.parse(
      await executeWriteTool(
        "update_booking_status",
        { bookingId: 9, paymentStatus: "paid" },
        PROFILE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(out.paymentStatus).toBe("paid");
    expect(mockUpdateBooking).toHaveBeenCalledWith(9, { paymentStatus: "paid" });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const arg = mockAudit.mock.calls[0][0];
    expect(arg.action).toBe("booking.updateStatus");
    expect(arg.targetType).toBe("booking");
    expect(arg.targetId).toBe(9);
    expect(arg.ctx.user.id).toBe(ADMIN_ID);
    expect(arg.changes.before.paymentStatus).toBe("deposit");
    expect(arg.changes.after.paymentStatus).toBe("paid");
    expect(arg.reason).toContain(`profileId=${PROFILE_ID}`);
  });

  it("guest booking (no userId) matches by customerEmail, case-insensitively", async () => {
    mockGetBookingById.mockResolvedValue({
      id: 12,
      userId: null,
      customerEmail: "Jenny@Example.com",
      bookingStatus: "pending",
      paymentStatus: "unpaid",
    });
    mockSnapshot.mockResolvedValue({ name: "Jenny", email: "jenny@example.com", userId: null });
    mockUpdateBooking.mockResolvedValue({
      id: 12,
      bookingStatus: "confirmed",
      paymentStatus: "unpaid",
    });
    const out = JSON.parse(
      await executeWriteTool(
        "update_booking_status",
        { bookingId: 12, bookingStatus: "confirmed" },
        PROFILE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(mockUpdateBooking).toHaveBeenCalledWith(12, { bookingStatus: "confirmed" });
  });

  describe("resolveBookingStatusArgs (pure)", () => {
    it("requires a positive bookingId", () => {
      expect(resolveBookingStatusArgs({ paymentStatus: "paid" }).ok).toBe(false);
      expect(resolveBookingStatusArgs({ bookingId: 0, paymentStatus: "paid" }).ok).toBe(false);
      expect(resolveBookingStatusArgs({ bookingId: -2, paymentStatus: "paid" }).ok).toBe(false);
    });

    it("requires at least one status field", () => {
      expect(resolveBookingStatusArgs({ bookingId: 5 }).ok).toBe(false);
    });

    it("whitelists both enums server-side (schema enum is only a hint)", () => {
      expect(resolveBookingStatusArgs({ bookingId: 5, bookingStatus: "shipped" }).ok).toBe(false);
      expect(resolveBookingStatusArgs({ bookingId: 5, paymentStatus: "partial" }).ok).toBe(false);
      const r = resolveBookingStatusArgs({ bookingId: 5, bookingStatus: "cancelled", paymentStatus: "deposit" });
      expect(r).toEqual({
        ok: true,
        value: { bookingId: 5, updates: { bookingStatus: "cancelled", paymentStatus: "deposit" } },
      });
    });

    it("rejects refunded with a suggest_action pointer", () => {
      const r = resolveBookingStatusArgs({ bookingId: 5, paymentStatus: "refunded" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("suggest_action");
    });
  });

  describe("bookingBelongsToCustomer (pure ownership rule)", () => {
    it("matches on userId", () => {
      expect(
        bookingBelongsToCustomer(
          { userId: 111, customerEmail: "whatever@x.com" },
          { userId: 111, email: null },
        ),
      ).toBe(true);
    });

    it("matches on email (trimmed, case-insensitive) for guest bookings", () => {
      expect(
        bookingBelongsToCustomer(
          { userId: null, customerEmail: " Jenny@Example.com " },
          { userId: null, email: "jenny@example.com" },
        ),
      ).toBe(true);
    });

    it("never matches when both sides have no usable identity (empty ≠ empty)", () => {
      expect(
        bookingBelongsToCustomer(
          { userId: null, customerEmail: "" },
          { userId: null, email: null },
        ),
      ).toBe(false);
    });

    it("rejects a different customer's booking", () => {
      expect(
        bookingBelongsToCustomer(
          { userId: 777, customerEmail: "other@x.com" },
          { userId: 111, email: "jenny@example.com" },
        ),
      ).toBe(false);
    });
  });
});

describe("read_customer_conversation — reads real filed data, never guesses", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("reports ball-in-court=customer when WE sent the last message", async () => {
    // Combined row satisfies both the profile lookup and the interactions read
    // (the chainable mock returns the same nextRows for every query).
    nextRows = [
      {
        id: 100,
        email: "jenny@example.com",
        direction: "outbound",
        content: "From: Jeff\nSubject: 報價\n\n英文導遊全程多 US$2,260",
        contentSummary: "英文導遊報價",
        createdAt: new Date(Date.now() - 7 * DAY),
      },
    ];
    const out = JSON.parse(await executeReadTool("read_customer_conversation", { customer: "jenny@example.com" }));
    expect(out.found).toBe(true);
    expect(out.lastMessage.direction).toBe("outbound");
    expect(out.ballInCourt).toBe("customer");
    expect(out.lastMessage.daysSinceLast).toBe(7);
    expect(out.ballHint).toContain("等客人回");
  });

  it("reports ball-in-court=us when the CUSTOMER sent the last message", async () => {
    nextRows = [
      {
        id: 100,
        email: "jenny@example.com",
        direction: "inbound",
        content: "Thank you",
        contentSummary: null,
        createdAt: new Date(Date.now() - 2 * DAY),
      },
    ];
    const out = JSON.parse(await executeReadTool("read_customer_conversation", { customer: "jenny@example.com" }));
    expect(out.ballInCourt).toBe("us");
    expect(out.ballHint).toContain("還沒回");
  });

  it("refuses to guess when the customer has no filed conversation", async () => {
    nextRows = []; // no profile match
    const out = JSON.parse(await executeReadTool("read_customer_conversation", { customer: "nobody@example.com" }));
    expect(out.found).toBe(false);
    expect(out.note).toContain("collectCustomerThreads");
    expect(out.note).toContain("不要憑印象");
  });
});

describe("list_followups_needed — quiet customers we spoke to last", () => {
  it("returns customers whose last message was outbound and silent", async () => {
    // Combined row satisfies both the interactions scan and the profile-email
    // lookup (the chainable mock returns the same nextRows for every query).
    nextRows = [
      {
        customerProfileId: 1,
        direction: "outbound",
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        id: 1,
        email: "jenny@example.com",
      },
    ];
    const out = JSON.parse(await executeReadTool("list_followups_needed", {}));
    expect(out.count).toBe(1);
    expect(out.customers[0].email).toBe("jenny@example.com");
    expect(out.customers[0].daysSilent).toBe(7);
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

describe("list_missing_receipts", () => {
  it("returns expenses lacking a receipt with total count", async () => {
    // First query (count) returns count; second (rows) returns the rows.
    // The chainable mock resolves both .where() and .limit() to nextRows, so
    // we shape nextRows to satisfy the count read ({n}) then rows read.
    nextRows = [{ n: 7 }];
    const out = JSON.parse(await executeReadTool("list_missing_receipts", { limit: 5 }));
    // count came from {n:7}; rows came from the same nextRows (best-effort mock)
    expect(out).toHaveProperty("totalMissing");
    expect(out).toHaveProperty("transactions");
    expect(out.note).toContain("receipt");
  });
});

describe("error safety", () => {
  it("never throws — returns error string for unknown tool", async () => {
    const out = JSON.parse(await executeReadTool("nonexistent_tool", {}));
    expect(out.error).toContain("unknown tool");
  });
});

describe("collect_customer_threads — 收 runs the backfill directly", () => {
  it("is a write tool with an email param", () => {
    const tool = WRITE_TOOLS.find((t) => t.name === "collect_customer_threads");
    expect(tool).toBeTruthy();
    expect((tool!.input_schema as any).required).toContain("email");
  });

  it("rejects an invalid email without touching the backfill", async () => {
    const out = JSON.parse(await executeWriteTool("collect_customer_threads", { email: "not-an-email" }, undefined));
    expect(out.error).toBeTruthy();
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it("routes a valid email to doCollectCustomerThreads and reports its summary", async () => {
    mockCollect.mockResolvedValue({ ok: true, summary: "✓ 已收 eyoung@axt.com · 8 條 thread", details: { inserted: 8 } });
    const out = JSON.parse(await executeWriteTool("collect_customer_threads", { email: "eyoung@axt.com" }, undefined));
    expect(mockCollect).toHaveBeenCalledWith({ email: "eyoung@axt.com" });
    expect(out.success).toBe(true);
    expect(out.message).toContain("8 條");
  });

  it("surfaces a backfill failure as an error (never fakes success)", async () => {
    mockCollect.mockResolvedValue({ ok: false, summary: "沒有連線中的 Gmail 帳號" });
    const out = JSON.parse(await executeWriteTool("collect_customer_threads", { email: "eyoung@axt.com" }, undefined));
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("Gmail");
  });
});

describe("collect_customer_threads — pin guard (P2 2026-07-01: cc 第三方地址會收錯人)", () => {
  it("rejects an email that doesn't match the pinned customer's, naming BOTH addresses", async () => {
    mockSnapshot.mockResolvedValue({ name: "Emerald", email: "eyoung@axt.com", userId: null });
    const out = JSON.parse(
      await executeWriteTool("collect_customer_threads", { email: "third@party.com" }, 123),
    );
    expect(out.error).toContain("eyoung@axt.com");
    expect(out.error).toContain("third@party.com");
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it("case/whitespace differences are NOT a mismatch; collect runs pinned to the profile", async () => {
    mockSnapshot.mockResolvedValue({ name: "Emerald", email: "  EYoung@AXT.com ", userId: null });
    mockCollect.mockResolvedValue({ ok: true, summary: "✓ 已收 eyoung@axt.com · 8 條 thread", details: {} });
    const out = JSON.parse(
      await executeWriteTool("collect_customer_threads", { email: "eyoung@axt.com" }, 123),
    );
    expect(mockCollect).toHaveBeenCalledWith({ email: "eyoung@axt.com", profileId: 123 });
    expect(out.success).toBe(true);
  });

  it("phone-only pinned profile → free email allowed, message says it files into THIS customer", async () => {
    mockSnapshot.mockResolvedValue({ name: "陳先生", email: null, userId: null });
    mockCollect.mockResolvedValue({ ok: true, summary: "✓ 已收 someone@x.com · 3 條 thread", details: {} });
    const out = JSON.parse(
      await executeWriteTool("collect_customer_threads", { email: "someone@x.com" }, 77),
    );
    expect(mockCollect).toHaveBeenCalledWith({ email: "someone@x.com", profileId: 77 });
    expect(out.success).toBe(true);
    expect(out.message).toContain("收進目前這位客人");
    expect(out.message).toContain("someone@x.com");
  });
});

describe("create_customer — §4.2 dedup red line (email OR phone + registered-member guard)", () => {
  it("dedup lookup ORs BOTH identifiers when email and phone are given (not email-only)", async () => {
    rowQueue = [[], []]; // dedup miss → users miss → insert
    await executeWriteTool("create_customer", {
      name: "王小姐",
      email: "wang@x.com",
      phone: "510-333-1234",
    });
    const firstWhere = lastDb.where.mock.calls[0][0];
    expect(firstWhere._op).toBe("or");
    expect(firstWhere.args).toHaveLength(2);
    expect(firstWhere.args[0]._op).toBe("eq"); // email equality
    expect(firstWhere.args[1]._op).toBe("sql"); // normalized-phone comparison
  });

  it("a hit (e.g. same phone, different email) returns the existing profile and does NOT insert", async () => {
    rowQueue = [[{ id: 55, name: "王小姐" }]];
    const out = JSON.parse(
      await executeWriteTool("create_customer", {
        name: "王小姐",
        email: "brand-new@x.com",
        phone: "5103331234",
      }),
    );
    expect(out.success).toBe(true);
    expect(out.deduped).toBe(true);
    expect(out.profileId).toBe(55);
    expect(lastDb.insert).not.toHaveBeenCalled();
  });

  it("phone-only input dedups by normalized phone (single condition, no or-wrapper)", async () => {
    rowQueue = [[{ id: 9, name: "陳先生" }]];
    const out = JSON.parse(
      await executeWriteTool("create_customer", { name: "陳先生", phone: "(510) 333-1234" }),
    );
    expect(out.deduped).toBe(true);
    expect(out.profileId).toBe(9);
    expect(lastDb.where.mock.calls[0][0]._op).toBe("sql");
  });

  it("a registered member's email is rejected — no guest profile created (email_exists_registered parity)", async () => {
    rowQueue = [[], [{ id: 7 }]]; // no profile dup, but a users row exists
    const out = JSON.parse(
      await executeWriteTool("create_customer", { name: "Jeff Green", email: "member@x.com" }),
    );
    expect(out.error).toContain("註冊會員");
    expect(out.error).toContain("member@x.com");
    expect(lastDb.insert).not.toHaveBeenCalled();
  });

  it("no hit anywhere → inserts a manual guest profile", async () => {
    rowQueue = [[], []];
    const out = JSON.parse(
      await executeWriteTool("create_customer", {
        name: "新客",
        email: "fresh@x.com",
        phone: "111-2222",
      }),
    );
    expect(out.success).toBe(true);
    expect(out.profileId).toBe(991);
    expect(lastDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ name: "新客", email: "fresh@x.com", source: "manual" }),
    );
  });

  it("normalizePhoneForMatch strips formatting but keeps '+' (country code is a real difference)", () => {
    expect(normalizePhoneForMatch("(510) 333-1234")).toBe("5103331234");
    expect(normalizePhoneForMatch("510.333.1234")).toBe("5103331234");
    expect(normalizePhoneForMatch("+1 510-333-1234")).toBe("+15103331234");
  });
});

describe("update_customer_note — append semantics (P2 2026-07-01: 覆寫毀掉舊備註)", () => {
  const LA_NOON = new Date("2026-07-01T12:00:00-07:00");

  describe("mergeCustomerNote (pure)", () => {
    it("appends under a non-empty old note as a dated [M/D] line", () => {
      expect(mergeCustomerNote("愛吃辣", "對蝦過敏", false, LA_NOON)).toBe(
        "愛吃辣\n[7/1] 對蝦過敏",
      );
    });
    it("dates the appended line by the LA calendar day, not UTC", () => {
      // 02:00 UTC on 7/2 is still the evening of 7/1 in LA.
      expect(mergeCustomerNote("A", "B", false, new Date("2026-07-02T02:00:00Z"))).toBe(
        "A\n[7/1] B",
      );
    });
    it("replace:true overwrites the whole note", () => {
      expect(mergeCustomerNote("愛吃辣", "全新內容", true, LA_NOON)).toBe("全新內容");
    });
    it("empty old note → new text becomes the note, no date tag", () => {
      expect(mergeCustomerNote(null, "第一條", false, LA_NOON)).toBe("第一條");
      expect(mergeCustomerNote("   ", "第一條", false, LA_NOON)).toBe("第一條");
    });
    it("empty new text without replace keeps the old note untouched", () => {
      expect(mergeCustomerNote("舊的", "", false, LA_NOON)).toBe("舊的");
    });
    it("replace:true with empty text clears the note", () => {
      expect(mergeCustomerNote("舊的", "", true, LA_NOON)).toBe("");
    });
  });

  it("executor appends: the old note survives and the write carries the merged text", async () => {
    rowQueue = [[{ note: "愛吃辣" }]];
    const out = JSON.parse(await executeWriteTool("update_customer_note", { note: "對蝦過敏" }, 5));
    expect(out.success).toBe(true);
    expect(out.note).toMatch(/^愛吃辣\n\[\d{1,2}\/\d{1,2}\] 對蝦過敏$/);
    expect(lastDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ jeffPersonalNote: out.note }),
    );
  });

  it("the chip message echoes the FULL merged note so Jeff sees what it says now", async () => {
    rowQueue = [[{ note: "愛吃辣" }]];
    const out = JSON.parse(await executeWriteTool("update_customer_note", { note: "對蝦過敏" }, 5));
    expect(out.message).toContain("愛吃辣");
    expect(out.message).toContain("對蝦過敏");
  });

  it("executor replace:true overwrites the field entirely", async () => {
    rowQueue = [[{ note: "舊的內容" }]];
    const out = JSON.parse(
      await executeWriteTool("update_customer_note", { note: "全新", replace: true }, 5),
    );
    expect(out.note).toBe("全新");
    expect(lastDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ jeffPersonalNote: "全新" }),
    );
  });

  it("still refuses without a pinned customer", async () => {
    const out = JSON.parse(await executeWriteTool("update_customer_note", { note: "x" }, undefined));
    expect(out.error).toBeTruthy();
  });

  it("the tool schema exposes the replace flag and describes append semantics", () => {
    const tool = WRITE_TOOLS.find((t) => t.name === "update_customer_note")!;
    expect((tool.input_schema as any).properties.replace).toBeTruthy();
    expect(tool.description).toContain("append");
  });
});

describe("merge_into_customer — 同案聯絡人併檔 (2026-07-01: leslie@ 其實是 Emerald/AXT 的聯絡窗口)", () => {
  const SOURCE_ID = 5;
  const ADMIN_ID = 42;
  const TARGET = { id: 9, name: "Emerald Young", email: "eyoung@axt.com" };
  const SOURCE = {
    id: SOURCE_ID,
    userId: null,
    name: "Leslie",
    email: "leslie@greencommunicationsllc.com",
    status: "active",
    jeffPersonalNote: null,
  };

  it("is exposed as a customer-page write tool (only pinned chats get WRITE_TOOLS)", () => {
    const tool = WRITE_TOOLS.find((t) => t.name === "merge_into_customer");
    expect(tool).toBeTruthy();
    // The model names only the TARGET; there is no source field to lie about.
    const props = (tool!.input_schema as any).properties;
    expect(props.targetEmail).toBeTruthy();
    expect(props.targetProfileId).toBeTruthy();
    expect(props.targetName).toBeTruthy();
    expect(props.source).toBeUndefined();
    expect(props.sourceProfileId).toBeUndefined();
    // 2026-07-01 實測:目標是隱藏檔時搜尋不到 — 工具說明必須告訴 model
    // targetName/targetProfileId 直達檔案(含隱藏),別在搜尋失敗後放棄。
    expect(tool!.description).toContain("targetName");
    expect(tool!.description).toContain("隱藏");
  });

  describe("resolveMergeTargetArgs (pure)", () => {
    it("requires targetEmail, targetProfileId or targetName", () => {
      expect(resolveMergeTargetArgs({}).ok).toBe(false);
      expect(resolveMergeTargetArgs(null).ok).toBe(false);
      expect(resolveMergeTargetArgs({ targetEmail: "   " }).ok).toBe(false);
      expect(resolveMergeTargetArgs({ targetName: "   " }).ok).toBe(false);
    });
    it("targetProfileId must be a positive integer (numeric string ok)", () => {
      expect(resolveMergeTargetArgs({ targetProfileId: 0 }).ok).toBe(false);
      expect(resolveMergeTargetArgs({ targetProfileId: -2 }).ok).toBe(false);
      expect(resolveMergeTargetArgs({ targetProfileId: 1.5 }).ok).toBe(false);
      expect(resolveMergeTargetArgs({ targetProfileId: 9 })).toEqual({
        ok: true,
        value: { targetProfileId: 9, targetEmail: null, targetName: null },
      });
      expect(resolveMergeTargetArgs({ targetProfileId: "9" })).toEqual({
        ok: true,
        value: { targetProfileId: 9, targetEmail: null, targetName: null },
      });
    });
    it("targetEmail is trimmed + lowercased and must look like an email", () => {
      expect(resolveMergeTargetArgs({ targetEmail: "not-an-email" }).ok).toBe(false);
      expect(resolveMergeTargetArgs({ targetEmail: "  EYoung@AXT.com " })).toEqual({
        ok: true,
        value: { targetProfileId: null, targetEmail: "eyoung@axt.com", targetName: null },
      });
    });
    it("targetName is trimmed and kept verbatim (exact-match key, never fuzzed)", () => {
      expect(resolveMergeTargetArgs({ targetName: " 測試三號 " })).toEqual({
        ok: true,
        value: { targetProfileId: null, targetEmail: null, targetName: "測試三號" },
      });
    });
    it("precedence: targetProfileId > targetEmail > targetName", () => {
      expect(resolveMergeTargetArgs({ targetProfileId: 9, targetEmail: "x@y.com" })).toEqual({
        ok: true,
        value: { targetProfileId: 9, targetEmail: null, targetName: null },
      });
      expect(
        resolveMergeTargetArgs({ targetEmail: "x@y.com", targetName: "測試三號" }),
      ).toEqual({
        ok: true,
        value: { targetProfileId: null, targetEmail: "x@y.com", targetName: null },
      });
    });
    it("an invalid email still errors even when a name is also given (never silently fall through)", () => {
      expect(resolveMergeTargetArgs({ targetEmail: "not-an-email", targetName: "測試三號" }).ok).toBe(
        false,
      );
    });
  });

  it("rejects when no customer is pinned (source is NEVER model-chosen)", async () => {
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "eyoung@axt.com" },
        undefined,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("客人");
    expect(lastDb.update).not.toHaveBeenCalled();
  });

  it("rejects with no admin userId (the audit trail requires an actor)", async () => {
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "eyoung@axt.com" },
        SOURCE_ID,
        undefined,
      ),
    );
    expect(out.error).toContain("操作者");
    expect(lastDb.update).not.toHaveBeenCalled();
  });

  it("rejects when the target does not exist, without moving anything", async () => {
    rowQueue = [[]]; // target lookup misses
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "nobody@nowhere.com" },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("找不到");
    expect(out.error).toContain("nobody@nowhere.com");
    expect(lastDb.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("rejects a self-merge (target resolves to the pinned customer)", async () => {
    rowQueue = [[{ id: SOURCE_ID, name: "Leslie", email: "leslie@greencommunicationsllc.com" }]];
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetProfileId: SOURCE_ID },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("自己");
    expect(lastDb.update).not.toHaveBeenCalled();
  });

  it("rejects a registered-member SOURCE (a member's history stays on the account)", async () => {
    rowQueue = [[TARGET], [{ ...SOURCE, userId: 777 }]];
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetProfileId: TARGET.id },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("註冊會員");
    expect(lastDb.update).not.toHaveBeenCalled();
    expect(lastDb.delete).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("happy path: moves the four tables to the target, hides the source, audits", async () => {
    // target lookup → source lookup → dup-scan (no shared threads)
    rowQueue = [[TARGET], [{ ...SOURCE }], []];
    nextRows = [{ affectedRows: 2 }]; // each UPDATE ... WHERE reports 2 rows moved
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "eyoung@axt.com" },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(out.targetProfileId).toBe(TARGET.id);
    expect(out.moved).toEqual({ interactions: 2, documents: 2, orders: 2, chatMessages: 2 });
    // No shared threads → nothing deleted.
    expect(lastDb.delete).not.toHaveBeenCalled();
    // The four moves re-point customerProfileId to the target.
    expect(lastDb.set).toHaveBeenCalledWith({ customerProfileId: TARGET.id });
    // The source profile is hidden and Jeff's note gets the dated merge line.
    expect(lastDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "blocked",
        jeffPersonalNote: expect.stringContaining("已併入 Emerald Young (#9)"),
      }),
    );
    // Chip message carries the real counts (工具憑證,不是 model 嘴上說).
    expect(out.message).toContain("已把「Leslie」併入「Emerald Young」(#9)");
    expect(out.message).toContain("互動 2 筆");
    expect(out.message).toContain("原檔已隱藏");
    // Audit row (same pattern as update_booking_status).
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const arg = mockAudit.mock.calls[0][0];
    expect(arg.action).toBe("customer.mergeInto");
    expect(arg.targetType).toBe("customerProfile");
    expect(arg.targetId).toBe(SOURCE_ID);
    expect(arg.ctx.user.id).toBe(ADMIN_ID);
    expect(arg.changes.after.mergedInto).toBe(TARGET.id);
    expect(arg.reason).toContain(`source=${SOURCE_ID}`);
    expect(arg.reason).toContain(`target=${TARGET.id}`);
  });

  it("an existing note survives: the merge line is APPENDED with a [M/D] date tag", async () => {
    rowQueue = [[TARGET], [{ ...SOURCE, jeffPersonalNote: "同案聯絡人,先觀察" }], []];
    nextRows = [{ affectedRows: 0 }];
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetProfileId: TARGET.id },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(lastDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        jeffPersonalNote: expect.stringMatching(
          /^同案聯絡人,先觀察\n\[\d{1,2}\/\d{1,2}\] 已併入 Emerald Young \(#9\)$/,
        ),
      }),
    );
  });

  it("shared email threads (uq profile+externalId) are dropped from the source first", async () => {
    // dup-scan finds one thread the target already filed.
    rowQueue = [[TARGET], [{ ...SOURCE }], [{ externalId: "<msg-1@mail.gmail.com>" }]];
    nextRows = [{ affectedRows: 1 }];
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "eyoung@axt.com" },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(lastDb.delete).toHaveBeenCalledTimes(1);
    expect(out.duplicatesDropped).toBe(1);
    expect(out.message).toContain("略過 1 筆");
  });

  it("merge 後紅點 (2026-07-02): recomputes the target's lastInboundAt from MAX(inbound createdAt) via touchLastInbound", async () => {
    // 實案:leslie 7/1 的護照 inbound 併進 Emerald 後,Emerald 的未讀紅點
    // 沒亮 — 合併只搬 rows,沒人推 lastInboundAt。
    rowQueue = [[TARGET], [{ ...SOURCE }], []];
    // Shared terminal rows: the four moves read affectedRows, the MAX(inbound
    // createdAt) recompute reads maxAt off the same row.
    const MAX_AT = new Date("2026-07-01T18:30:00Z");
    nextRows = [{ affectedRows: 2, maxAt: MAX_AT }];
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "eyoung@axt.com" },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    // Forward-only semantics are delegated to the shared helper — the tool
    // must hand it the TARGET profile + the recomputed max inbound time.
    expect(mockTouchLastInbound).toHaveBeenCalledTimes(1);
    expect(mockTouchLastInbound).toHaveBeenCalledWith(expect.anything(), TARGET.id, MAX_AT);
  });

  it("merge 後紅點: no inbound on the target (MAX is NULL) → pointer untouched", async () => {
    rowQueue = [[TARGET], [{ ...SOURCE }], []];
    nextRows = [{ affectedRows: 0, maxAt: null }];
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "eyoung@axt.com" },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(mockTouchLastInbound).not.toHaveBeenCalled();
  });

  it("merge 後紅點: a string timestamp from the driver is normalized to a Date", async () => {
    rowQueue = [[TARGET], [{ ...SOURCE }], []];
    nextRows = [{ affectedRows: 1, maxAt: "2026-07-01T18:30:00Z" }];
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "eyoung@axt.com" },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(mockTouchLastInbound).toHaveBeenCalledWith(
      expect.anything(),
      TARGET.id,
      new Date("2026-07-01T18:30:00Z"),
    );
  });

  it("re-run is safe: an already-emptied source moves 0 rows and still succeeds", async () => {
    rowQueue = [[TARGET], [{ ...SOURCE, status: "blocked" }], []];
    nextRows = [{ affectedRows: 0 }];
    const out = JSON.parse(
      await executeWriteTool(
        "merge_into_customer",
        { targetEmail: "eyoung@axt.com" },
        SOURCE_ID,
        ADMIN_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(out.moved).toEqual({ interactions: 0, documents: 0, orders: 0, chatMessages: 0 });
    expect(out.message).toContain("互動 0 筆");
  });

  it("surfaces the validator error when neither target field is given", async () => {
    const out = JSON.parse(
      await executeWriteTool("merge_into_customer", {}, SOURCE_ID, ADMIN_ID),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("targetEmail");
  });

  describe("targetName resolution (2026-07-01 實測:目標 status=blocked 被搜尋濾掉,改名字直達)", () => {
    it("finds a HIDDEN (blocked) target by exact name — no status filter in the lookup", async () => {
      // name lookup → source lookup → dup-scan
      rowQueue = [[{ id: 9, name: "測試三號", email: "t3@example.com" }], [{ ...SOURCE }], []];
      nextRows = [{ affectedRows: 1 }];
      const out = JSON.parse(
        await executeWriteTool(
          "merge_into_customer",
          { targetName: "測試三號" },
          SOURCE_ID,
          ADMIN_ID,
        ),
      );
      expect(out.success).toBe(true);
      expect(out.targetProfileId).toBe(9);
      expect(out.message).toContain("測試三號");
      // The name lookup is a bare eq(name, …) — no status/blocked condition,
      // so a hidden profile resolves. (customerProfiles.name is mocked as "n".)
      expect(lastDb.where.mock.calls[0][0]).toEqual({ _op: "eq", args: ["n", "測試三號"] });
    });

    it("multiple same-name profiles → error listing the candidates (id+名字), never auto-picks", async () => {
      rowQueue = [
        [
          { id: 9, name: "測試三號", email: "t3@example.com" },
          { id: 31, name: "測試三號", email: null },
        ],
      ];
      const out = JSON.parse(
        await executeWriteTool(
          "merge_into_customer",
          { targetName: "測試三號" },
          SOURCE_ID,
          ADMIN_ID,
        ),
      );
      expect(out.success).toBeUndefined();
      expect(out.error).toContain("同名");
      expect(out.error).toContain("#9 測試三號 <t3@example.com>");
      expect(out.error).toContain("#31 測試三號");
      expect(out.error).toContain("targetProfileId");
      // Nothing moved, nothing hidden, no audit row.
      expect(lastDb.update).not.toHaveBeenCalled();
      expect(lastDb.delete).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it("no profile with that exact name → 找不到 error naming the name", async () => {
      rowQueue = [[]];
      const out = JSON.parse(
        await executeWriteTool(
          "merge_into_customer",
          { targetName: "查無此人" },
          SOURCE_ID,
          ADMIN_ID,
        ),
      );
      expect(out.success).toBeUndefined();
      expect(out.error).toContain("找不到");
      expect(out.error).toContain("查無此人");
      expect(lastDb.update).not.toHaveBeenCalled();
    });
  });
});

describe("mark_promise — customer-cockpit Phase3 3a 承諾兌現/撤銷 (2026-07-03)", () => {
  const PINNED_PROFILE_ID = 42;

  it("action:fulfilled 正確寫入 fulfilledAt", async () => {
    rowQueue = [[{ id: 7, customerProfileId: PINNED_PROFILE_ID }]];
    const out = JSON.parse(
      await executeWriteTool("mark_promise", { promiseId: 7, action: "fulfilled" }, PINNED_PROFILE_ID),
    );
    expect(out.success).toBe(true);
    expect(out.action).toBe("fulfilled");
    expect(lastDb.update).toHaveBeenCalled();
    expect(lastDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ fulfilledAt: expect.any(Date) }),
    );
    expect(lastDb.set.mock.calls[0][0]).not.toHaveProperty("dismissedAt");
  });

  it("action:dismissed 正確寫入 dismissedAt", async () => {
    rowQueue = [[{ id: 8, customerProfileId: PINNED_PROFILE_ID }]];
    const out = JSON.parse(
      await executeWriteTool("mark_promise", { promiseId: 8, action: "dismissed" }, PINNED_PROFILE_ID),
    );
    expect(out.success).toBe(true);
    expect(out.action).toBe("dismissed");
    expect(lastDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ dismissedAt: expect.any(Date) }),
    );
    expect(lastDb.set.mock.calls[0][0]).not.toHaveProperty("fulfilledAt");
  });

  it("跨客戶守門:promise 屬於別的客人時拒絕,不寫入", async () => {
    rowQueue = [[{ id: 9, customerProfileId: 999 }]]; // belongs to a different customer
    const out = JSON.parse(
      await executeWriteTool("mark_promise", { promiseId: 9, action: "fulfilled" }, PINNED_PROFILE_ID),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toBeTruthy();
    expect(lastDb.update).not.toHaveBeenCalled();
  });

  it("promiseId 不存在 → 結構化錯誤,不寫入", async () => {
    rowQueue = [[]]; // lookup misses
    const out = JSON.parse(
      await executeWriteTool("mark_promise", { promiseId: 12345, action: "fulfilled" }, PINNED_PROFILE_ID),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toContain("12345");
    expect(lastDb.update).not.toHaveBeenCalled();
  });

  it("沒有釘住客人 → 拒絕,不查 DB", async () => {
    const out = JSON.parse(
      await executeWriteTool("mark_promise", { promiseId: 7, action: "fulfilled" }, undefined),
    );
    expect(out.error).toBeTruthy();
    expect(lastDb.update).not.toHaveBeenCalled();
  });

  it("action 不是 fulfilled/dismissed → 結構化錯誤", async () => {
    rowQueue = [[{ id: 7, customerProfileId: PINNED_PROFILE_ID }]];
    const out = JSON.parse(
      await executeWriteTool("mark_promise", { promiseId: 7, action: "cancelled" }, PINNED_PROFILE_ID),
    );
    expect(out.success).toBeUndefined();
    expect(out.error).toBeTruthy();
    expect(lastDb.update).not.toHaveBeenCalled();
  });

  it("工具描述提到讓 LLM 知道 Jeff 明確表達兌現/撤銷時才呼叫", () => {
    const tool = WRITE_TOOLS.find((t) => t.name === "mark_promise")!;
    expect(tool).toBeTruthy();
    expect(tool.description).toContain("明確");
    const props = (tool.input_schema as any).properties;
    expect(props.promiseId).toBeTruthy();
    expect(props.action).toBeTruthy();
  });
});

describe("get_customer_documents — dual-source profileId regression (2026-07-03 對抗審查)", () => {
  // executeReadTool/runTool grew a 3rd `profileId` param (the trusted pinned
  // customer, used by list_customer_promises). get_customer_documents predates
  // that change and reads profileId from LLM-supplied `input` instead — this
  // locks in that the two sources stay independent and don't get confused.
  it("still resolves using input.profileId when no pinned profileId is passed", async () => {
    rowQueue = [[{ type: "passport", fileName: "passport.pdf", expiresAt: null, isCurrent: true }]];
    const out = JSON.parse(
      await executeReadTool("get_customer_documents", { profileId: 55 }, undefined),
    );
    expect(out.found).toBe(true);
  });

  it("does NOT fall back to the pinned 3rd-arg profileId when input.profileId is missing", async () => {
    const out = JSON.parse(
      await executeReadTool("get_customer_documents", {}, 55 /* pinned, but irrelevant here */),
    );
    expect(out.error).toBe("missing profileId");
  });
});

describe("list_customer_promises — customer-cockpit Phase0b 唯讀查詢 (2026-07-03)", () => {
  const PINNED_PROFILE_ID = 42;

  it("回傳未兌現/未撤銷的承諾,含 id / 原文 / 到期日 / 來源信日期", async () => {
    rowQueue = [
      [
        {
          id: 3,
          promiseText: "7/8之前可以取件",
          dueDate: "2026-07-08",
          sourceDate: new Date("2026-07-03T12:00:00Z"),
        },
      ],
    ];
    const out = JSON.parse(await executeReadTool("list_customer_promises", {}, PINNED_PROFILE_ID));
    expect(out.count).toBe(1);
    expect(out.promises[0]).toMatchObject({
      id: 3,
      promiseText: "7/8之前可以取件",
      dueDate: "2026-07-08",
      sourceDate: "2026-07-03",
    });
  });

  it("沒有未兌現承諾 → 誠實回空陣列,不是省略欄位", async () => {
    rowQueue = [[]];
    const out = JSON.parse(await executeReadTool("list_customer_promises", {}, PINNED_PROFILE_ID));
    expect(out.count).toBe(0);
    expect(out.promises).toEqual([]);
    expect(out.note).toBeTruthy();
  });

  it("dueDate 是 null 時原樣回傳(承諾仍列出,只是看門狗不會因它跳卡)", async () => {
    rowQueue = [[{ id: 5, promiseText: "會盡快處理", dueDate: null, sourceDate: null }]];
    const out = JSON.parse(await executeReadTool("list_customer_promises", {}, PINNED_PROFILE_ID));
    expect(out.promises[0].dueDate).toBeNull();
    expect(out.promises[0].sourceDate).toBeNull();
  });

  it("沒有釘住客人 → 拒絕,不查 DB", async () => {
    const out = JSON.parse(await executeReadTool("list_customer_promises", {}, undefined));
    expect(out.error).toBeTruthy();
    expect(lastDb.select).not.toHaveBeenCalled();
  });

  it("工具 schema 不宣告 profileId 欄位(靜態保證,防日後不小心加回去)", () => {
    const tool = READ_TOOLS.find((t) => t.name === "list_customer_promises")!;
    expect((tool.input_schema as any).properties).toEqual({});
  });

  it("2026-07-03 對抗審查:input 帶了假冒的 profileId 在執行時也會被忽略 — 只認第三個參數(釘住的這位)", async () => {
    rowQueue = [[{ id: 3, promiseText: "測試承諾", dueDate: "2026-07-08", sourceDate: null }]];
    // A rogue profileId inside `input` (as if the LLM tried to specify a
    // DIFFERENT customer) must be a no-op at runtime — runTool's case never
    // reads input.profileId, only the trusted 3rd positional param.
    const out = JSON.parse(
      await executeReadTool("list_customer_promises", { profileId: 999, customerProfileId: 999 }, PINNED_PROFILE_ID),
    );
    expect(out.error).toBeUndefined();
    expect(out.count).toBe(1);
    // The WHERE clause was built from PINNED_PROFILE_ID, not the rogue 999 —
    // inspect the actual (tagged) condition object passed to .where(...).
    const whereArg = JSON.stringify(lastDb.where.mock.calls[0][0]);
    expect(whereArg).toContain(String(PINNED_PROFILE_ID));
    expect(whereArg).not.toContain("999");
  });

  it("工具描述教 LLM 先查再標記,不要用猜的編號呼叫 mark_promise", () => {
    const tool = READ_TOOLS.find((t) => t.name === "list_customer_promises")!;
    expect(tool).toBeTruthy();
    expect(tool.description).toContain("mark_promise");
    expect(tool.description).toContain("猜");
  });
});
