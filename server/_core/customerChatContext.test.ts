/**
 * Tests for customerChatContext — the pinned customer block in the
 * per-customer chat system prompt (批2 m3). Pure formatter only; the IO
 * wrapper degrades to null on missing db/user (covered via mock).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getDb } from "../db";
import {
  formatCustomerContext,
  buildCustomerChatContext,
  type CustomerContextData,
} from "./customerChatContext";

const getDbMock = vi.mocked(getDb);

const BASE: CustomerContextData = {
  user: {
    id: 7,
    name: "陳美玲",
    email: "mei@example.com",
    tier: "concierge",
    packpointBalance: 2400,
    bookingCount: 5,
  },
  openBookings: [
    {
      tourTitle: "北海道溫泉 6 日",
      bookingStatus: "confirmed",
      paymentStatus: "deposit",
      totalPrice: 8760,
      currency: "USD",
    },
  ],
  openInquiries: [{ subject: "九月日本團", destination: "日本", status: "new" }],
  recentQuotes: [
    { quoteNumber: "QUOTE-2026-0001", estimatedTotal: 6560, currency: "USD", status: "generated" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formatCustomerContext", () => {
  it("pins who the conversation is about + lists open work", () => {
    const block = formatCustomerContext(BASE);
    expect(block).toContain("陳美玲");
    expect(block).toContain("mei@example.com");
    expect(block).toContain("北海道溫泉 6 日");
    expect(block).toContain("九月日本團");
    expect(block).toContain("QUOTE-2026-0001");
    expect(block).toContain("只關於這位客人");
  });

  it("tells the agent the true chip mechanics (m3b: click → confirm → run)", () => {
    const block = formatCustomerContext(BASE);
    expect(block).toContain("再確認一次才會執行");
    expect(block).not.toContain("不會顯示任何動作按鈕");
  });

  it("omits empty sections instead of printing empty headers", () => {
    const block = formatCustomerContext({
      ...BASE,
      openBookings: [],
      openInquiries: [],
      recentQuotes: [],
    });
    expect(block).not.toContain("【進行中訂單】");
    expect(block).not.toContain("【開著的詢問】");
    expect(block).not.toContain("【近期報價】");
  });

  it("caps each list at 5 entries", () => {
    const block = formatCustomerContext({
      ...BASE,
      openInquiries: Array.from({ length: 9 }, (_, i) => ({
        subject: `INQ-${i}`,
        destination: null,
        status: "new",
      })),
    });
    expect(block).toContain("INQ-4");
    expect(block).not.toContain("INQ-5");
  });

  it("hard-caps the whole block length", () => {
    const block = formatCustomerContext({
      ...BASE,
      openBookings: Array.from({ length: 5 }, () => ({
        tourTitle: "X".repeat(900),
        bookingStatus: "confirmed",
        paymentStatus: "paid",
        totalPrice: 1,
        currency: "USD",
      })),
    });
    expect(block.length).toBeLessThanOrEqual(2400);
  });

  it("falls back to email / #id when the name is missing", () => {
    const noName = formatCustomerContext({
      ...BASE,
      user: { ...BASE.user, name: null },
    });
    expect(noName).toContain("mei@example.com");
    const bare = formatCustomerContext({
      ...BASE,
      user: { ...BASE.user, name: null, email: null },
    });
    expect(bare).toContain("#7");
  });
});

describe("buildCustomerChatContext", () => {
  it("returns null when the db is unavailable (chat continues unpinned)", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    expect(await buildCustomerChatContext(7)).toBeNull();
  });
});
