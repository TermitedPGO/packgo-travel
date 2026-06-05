import { describe, it, expect } from "vitest";
import { toCard } from "./opsTools";

describe("toCard — slice 3 chat cards", () => {
  it("maps search_departures → departures card", () => {
    const card = toCard("search_departures", {
      count: 2,
      departures: [
        { id: 1, title: "加東楓葉 10 日", country: "加拿大", departureDate: "2026-10-12T00:00:00Z", seatsLeft: 5, totalSlots: 20, opsStatus: "confirmed", tourLeader: "張領隊" },
        { id: 2, title: "北海道 6 日", country: "日本", departureDate: "2026-02-05", seatsLeft: 0, totalSlots: 16, opsStatus: "pending", tourLeader: null },
      ],
    });
    expect(card?.type).toBe("departures");
    expect((card as any).items).toHaveLength(2);
    expect((card as any).items[0]).toMatchObject({ id: 1, title: "加東楓葉 10 日", seatsLeft: 5, totalSlots: 20 });
  });

  it("caps departures at 6 items", () => {
    const departures = Array.from({ length: 10 }, (_, i) => ({ id: i, title: "t" + i, departureDate: "2026-01-01", seatsLeft: 1, totalSlots: 2 }));
    expect((toCard("search_departures", { departures }) as any).items).toHaveLength(6);
  });

  it("returns null for empty departures", () => {
    expect(toCard("search_departures", { count: 0, departures: [] })).toBeNull();
  });

  it("maps get_finance_summary → finance card", () => {
    const card = toCard("get_finance_summary", {
      period: "this_month", income: 10000, expenses: 3000, netProfit: 7000, trustDeferredIncome: 2000, missingReceiptCount: 3,
    });
    expect(card).toMatchObject({ type: "finance", period: "this_month", netProfit: 7000, missingReceiptCount: 3 });
  });

  it("maps search_customers → customers card", () => {
    const card = toCard("search_customers", {
      customers: [{ id: 1, email: "a@b.com", budgetTier: "concierge", bookingCount: 5, totalSpend: 24000, vipScore: 90 }],
    });
    expect(card?.type).toBe("customers");
    expect((card as any).items[0].totalSpend).toBe(24000);
  });

  it("maps search_bookings → bookings card", () => {
    const card = toCard("search_bookings", {
      bookings: [{ id: 9, customerName: "王建國", tourTitle: "北海道 6 日", departureDate: "2026-02-05", totalPrice: 8760, paymentStatus: "deposit_paid", bookingStatus: "confirmed" }],
    });
    expect(card?.type).toBe("bookings");
    expect((card as any).items[0]).toMatchObject({ id: 9, tourTitle: "北海道 6 日", paymentStatus: "deposit_paid" });
  });

  it("returns null for non-cardable tools", () => {
    expect(toCard("count_records", { count: 42 })).toBeNull();
    expect(toCard("aggregate_departures", { groups: [] })).toBeNull();
  });

  it("returns null on error / nullish data", () => {
    expect(toCard("search_departures", { error: "boom" })).toBeNull();
    expect(toCard("search_departures", null)).toBeNull();
    expect(toCard("get_finance_summary", undefined)).toBeNull();
  });
});
