import { describe, it, expect } from "vitest";
import {
  mergeOpenItems,
  mergeClosedBookings,
  type OpenItemsData,
  type RecentBooking,
} from "./customerInbox.helpers";

const empty: OpenItemsData = {
  openBookings: [],
  openInquiries: [],
  pendingTasks: [],
};

describe("mergeOpenItems", () => {
  it("returns [] for an all-empty customer", () => {
    expect(mergeOpenItems(empty)).toEqual([]);
  });

  it("merges all three buckets into one list", () => {
    const out = mergeOpenItems({
      openBookings: [
        {
          id: 1,
          tourTitle: "北海道 6 日",
          bookingStatus: "confirmed",
          paymentStatus: "deposit",
          totalPrice: 8760,
          currency: "USD",
          createdAt: new Date("2026-06-01"),
        },
      ],
      openInquiries: [
        {
          id: 2,
          status: "new",
          destination: "日本",
          subject: "九月日本團",
          createdAt: new Date("2026-06-03"),
        },
      ],
      pendingTasks: [
        {
          id: 3,
          lane: "quote",
          taskType: "quote.draft",
          riskLevel: "hard_gate",
          title: "報價待確認",
          summary: null,
          createdAt: new Date("2026-06-02"),
        },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.kind).sort()).toEqual([
      "booking",
      "inquiry",
      "task",
    ]);
  });

  it("sorts newest first by createdAt", () => {
    const out = mergeOpenItems({
      ...empty,
      openInquiries: [
        { id: 1, status: "new", destination: null, subject: "舊", createdAt: new Date("2026-01-01") },
        { id: 2, status: "new", destination: null, subject: "新", createdAt: new Date("2026-06-01") },
      ],
    });
    expect(out[0].title).toBe("新");
    expect(out[1].title).toBe("舊");
  });

  it("keys are unique across kinds even when ids collide", () => {
    const out = mergeOpenItems({
      openBookings: [
        { id: 1, tourTitle: "T", bookingStatus: "pending", paymentStatus: "unpaid", totalPrice: 0, currency: "USD", createdAt: 0 },
      ],
      openInquiries: [
        { id: 1, status: "new", destination: null, subject: "Q", createdAt: 0 },
      ],
      pendingTasks: [
        { id: 1, lane: "cs", taskType: "x", riskLevel: "review", title: "Task", summary: null, createdAt: 0 },
      ],
    });
    const keys = out.map((i) => i.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toContain("booking:1");
    expect(keys).toContain("inquiry:1");
    expect(keys).toContain("task:1");
  });

  it("null titles carry an i18n fallback key instead of hardcoded zh (批2 m1 還債)", () => {
    const out = mergeOpenItems({
      ...empty,
      openBookings: [
        { id: 5, tourTitle: null, bookingStatus: "pending", paymentStatus: "unpaid", totalPrice: 0, currency: "USD", createdAt: 0 },
      ],
      openInquiries: [
        { id: 6, status: "new", destination: null, subject: null, createdAt: 0 },
      ],
    });
    const booking = out.find((i) => i.kind === "booking")!;
    const inquiry = out.find((i) => i.kind === "inquiry")!;
    expect(booking.title).toBeNull();
    expect(booking.titleKey).toBe("workspace.tours");
    expect(inquiry.title).toBeNull();
    expect(inquiry.titleKey).toBe("workspace.kindInquiry");
  });

  it("flags trustNote on money-received open bookings only (鐵律可見化)", () => {
    const out = mergeOpenItems({
      ...empty,
      openBookings: [
        { id: 1, tourTitle: "A", bookingStatus: "confirmed", paymentStatus: "deposit", totalPrice: 100, currency: "USD", createdAt: 0 },
        { id: 2, tourTitle: "B", bookingStatus: "confirmed", paymentStatus: "paid", totalPrice: 100, currency: "USD", createdAt: 0 },
        { id: 3, tourTitle: "C", bookingStatus: "pending", paymentStatus: "unpaid", totalPrice: 100, currency: "USD", createdAt: 0 },
      ],
    });
    const byId = (id: number) => out.find((i) => i.id === id)!;
    expect(byId(1).trustNote).toBe(true);
    expect(byId(2).trustNote).toBe(true);
    expect(byId(3).trustNote).toBe(false);
  });

  it("marks tasks reviewable and inquiries draftable (批2 m1 actions)", () => {
    const out = mergeOpenItems({
      ...empty,
      openInquiries: [
        { id: 1, status: "new", destination: null, subject: "Q", createdAt: 0 },
      ],
      pendingTasks: [
        { id: 2, lane: "cs", taskType: "x", riskLevel: "review", title: "T", summary: null, createdAt: 0 },
      ],
    });
    expect(out.find((i) => i.kind === "inquiry")?.draftable).toBe(true);
    expect(out.find((i) => i.kind === "inquiry")?.reviewable).toBeUndefined();
    expect(out.find((i) => i.kind === "task")?.reviewable).toBe(true);
    expect(out.find((i) => i.kind === "task")?.draftable).toBeUndefined();
  });

  it("passes lane + payload through on task items (批2 m2 quote block)", () => {
    const payload = JSON.stringify({ tourTitle: "T", supplierPrice: 100 });
    const out = mergeOpenItems({
      ...empty,
      pendingTasks: [
        { id: 2, lane: "quote", taskType: "quote_draft", riskLevel: "hard_gate", title: "T", summary: null, payload, createdAt: 0 },
      ],
    });
    expect(out[0].lane).toBe("quote");
    expect(out[0].payload).toBe(payload);
  });

  it("sinks handled (處理好了) items below unhandled, even if newer", () => {
    const out = mergeOpenItems({
      ...empty,
      openInquiries: [
        // handled but NEWEST → should still sink below the unhandled one
        { id: 1, status: "new", destination: null, subject: "已處理新的", createdAt: new Date("2026-06-10"), handled: true },
        { id: 2, status: "new", destination: null, subject: "未處理舊的", createdAt: new Date("2026-01-01"), handled: false },
      ],
    });
    expect(out[0].title).toBe("未處理舊的");
    expect(out[0].handled).toBe(false);
    expect(out[1].title).toBe("已處理新的");
    expect(out[1].handled).toBe(true);
  });

  it("defaults handled to false when the field is absent", () => {
    const out = mergeOpenItems({
      ...empty,
      openInquiries: [
        { id: 1, status: "new", destination: null, subject: "Q", createdAt: 0 },
      ],
    });
    expect(out[0].handled).toBe(false);
  });
});

describe("mergeClosedBookings (批2 m1 已結留底)", () => {
  const mk = (
    id: number,
    bookingStatus: string,
    createdAt: string,
  ): RecentBooking => ({
    id,
    tourTitle: `T${id}`,
    bookingStatus,
    paymentStatus: "paid",
    totalPrice: 100,
    currency: "USD",
    createdAt: new Date(createdAt),
  });

  it("keeps only completed/cancelled, as locked done items", () => {
    const out = mergeClosedBookings([
      mk(1, "completed", "2026-06-01"),
      mk(2, "confirmed", "2026-06-02"), // open → excluded
      mk(3, "cancelled", "2026-06-03"),
      mk(4, "pending", "2026-06-04"), // open → excluded
    ]);
    expect(out.map((i) => i.id).sort()).toEqual([1, 3]);
    for (const it of out) {
      expect(it.locked).toBe(true);
      expect(it.handled).toBe(true);
      expect(it.key.startsWith("closed:")).toBe(true); // never collides with booking:<id>
    }
  });

  it("bounds the tail (newest first, limit)", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      mk(i + 1, "completed", `2026-06-0${(i % 7) + 1}`),
    );
    const out = mergeClosedBookings(rows, 5);
    expect(out).toHaveLength(5);
    // newest first
    const ts = out.map((i) => i.ts);
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
  });
});
