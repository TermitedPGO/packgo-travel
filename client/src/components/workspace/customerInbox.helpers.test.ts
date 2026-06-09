import { describe, it, expect } from "vitest";
import { mergeOpenItems, type OpenItemsData } from "./customerInbox.helpers";

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

  it("falls back to a title when booking tourTitle / inquiry subject are null", () => {
    const out = mergeOpenItems({
      ...empty,
      openBookings: [
        { id: 5, tourTitle: null, bookingStatus: "pending", paymentStatus: "unpaid", totalPrice: 0, currency: "USD", createdAt: 0 },
      ],
      openInquiries: [
        { id: 6, status: "new", destination: null, subject: null, createdAt: 0 },
      ],
    });
    expect(out.find((i) => i.kind === "booking")?.title).toBe("行程");
    expect(out.find((i) => i.kind === "inquiry")?.title).toBe("詢問");
  });
});
