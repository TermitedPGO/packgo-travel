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
  bankTransactions: { id: "id", date: "d", merchantName: "mn", description: "desc", amount: "amt", agentCategory: "ac", jeffOverrideCategory: "joc", excludeFromAccounting: "efa", isPending: "ip", receiptUrl: "ru" },
  customerProfiles: { id: "id", email: "e", phone: "ph", budgetTier: "bt", bookingCount: "bc", totalSpend: "tsp", vipScore: "vs", aiNotes: "an" },
  customerInteractions: { customerProfileId: "cpid", direction: "dir", content: "c", contentSummary: "cs", createdAt: "ca" },
}));

vi.mock("drizzle-orm", () => {
  const fn = (..._a: any[]) => ({ _op: true });
  const sql: any = (..._a: any[]) => ({ _op: true });
  sql.raw = fn;
  sql.join = fn;
  return { eq: fn, and: fn, or: fn, gte: fn, lte: fn, isNull: fn, inArray: fn, sql, desc: fn, like: fn };
});

const { mockCollect, mockGetBookingById, mockUpdateBooking, mockSnapshot, mockAudit } =
  vi.hoisted(() => ({
    mockCollect: vi.fn(),
    mockGetBookingById: vi.fn(),
    mockUpdateBooking: vi.fn(),
    mockSnapshot: vi.fn(),
    mockAudit: vi.fn(),
  }));
vi.mock("./opsActions", () => ({ doCollectCustomerThreads: mockCollect }));
vi.mock("../../db/booking", () => ({
  getBookingById: mockGetBookingById,
  updateBooking: mockUpdateBooking,
}));
vi.mock("../../db/customOrder", () => ({
  getCustomerProfileSnapshot: mockSnapshot,
  getCustomOrderById: vi.fn(),
  updateCustomOrder: vi.fn(),
  createCustomOrder: vi.fn(),
  generateOrderNumber: vi.fn(),
  resolveCustomerProfileIds: vi.fn(),
  orderBelongsToProfiles: vi.fn(),
}));
vi.mock("../../_core/auditLog", () => ({ audit: mockAudit }));

import {
  READ_TOOLS,
  WRITE_TOOLS,
  executeReadTool,
  executeWriteTool,
  resolveFollowUpDateArg,
  resolveCreateCustomOrderArgs,
  resolveUpdateCustomOrderArgs,
  resolveBookingStatusArgs,
  bookingBelongsToCustomer,
  CUSTOM_ORDER_CATEGORIES,
} from "./opsTools";

beforeEach(() => {
  nextRows = [];
  mockCollect.mockReset();
  mockGetBookingById.mockReset();
  mockUpdateBooking.mockReset();
  mockSnapshot.mockReset();
  mockAudit.mockReset();
});

describe("READ_TOOLS definitions", () => {
  it("exposes the 14 curated tools", () => {
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
    expect(READ_TOOLS.length).toBe(14);
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
