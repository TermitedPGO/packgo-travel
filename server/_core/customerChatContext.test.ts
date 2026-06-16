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
  buildGuestChatContext,
  type CustomerContextData,
} from "./customerChatContext";

const getDbMock = vi.mocked(getDb);

/** Thenable chain whose terminal await resolves the next queued result.
 *  Mirrors the escalationBox.test.ts helper — args are ignored, so the real
 *  drizzle eq/and/sql/desc run against the real schema without a DB. */
function fakeChain(result: unknown) {
  const p: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit"]) {
    p[m] = () => p;
  }
  p.then = (onOk: any, onErr: any) =>
    Promise.resolve(result).then(onOk, onErr);
  return p;
}
function fakeDb(queue: unknown[]) {
  let i = 0;
  return { select: () => fakeChain(queue[i++] ?? []) } as any;
}

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

describe("formatCustomerContext — guest mode (guest-customer-chat)", () => {
  it("renders a guest header and drops the PackPoint/booking membership line", () => {
    const block = formatCustomerContext({
      ...BASE,
      user: { ...BASE.user, name: null },
      isGuest: true,
    });
    expect(block).toContain("現在聊的訪客");
    expect(block).toContain("mei@example.com");
    expect(block).toContain("尚未註冊帳號");
    // the membership line (PackPoint / 歷史訂單 N 筆) is meaningless for a
    // not-yet-registered guest and must be suppressed.
    expect(block).not.toContain("PackPoint");
    expect(block).not.toContain("歷史訂單");
  });

  it("renders the 近期來信 section from recentInteractions", () => {
    const block = formatCustomerContext({
      ...BASE,
      isGuest: true,
      recentInteractions: [
        { direction: "inbound", summary: "想問九月日本團報價", snippet: "Hi…" },
        { direction: "outbound", summary: null, snippet: "我們已回覆報價" },
      ],
    });
    expect(block).toContain("【近期來信】");
    expect(block).toContain("客人來信: 想問九月日本團報價");
    // outbound with no summary falls back to the snippet
    expect(block).toContain("我們回覆: 我們已回覆報價");
  });

  it("registered (non-guest) mode still prints the membership line", () => {
    const block = formatCustomerContext(BASE);
    expect(block).toContain("PackPoint 2400");
    expect(block).not.toContain("現在聊的訪客");
  });
});

describe("buildGuestChatContext (guest-customer-chat)", () => {
  it("returns null when the db is unavailable", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    expect(await buildGuestChatContext(2550004)).toBeNull();
  });

  it("returns null when the profile is gone", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]])); // profile lookup → no row
    expect(await buildGuestChatContext(999)).toBeNull();
  });

  it("pins the guest by profileId with email + open inquiry + 來信 history", async () => {
    // Query order: profile → inquiries → interactions → quotes.
    getDbMock.mockResolvedValue(
      fakeDb([
        [{ id: 2550004, email: "jenny@example.com" }],
        [{ subject: "九月日本團", destination: "日本", status: "new" }],
        [
          {
            direction: "inbound",
            contentSummary: "想問九月日本團報價",
            content: "Hi, I'd like a quote...",
          },
        ],
        [], // no AI quotes
      ]),
    );
    const block = await buildGuestChatContext(2550004);
    expect(block).not.toBeNull();
    expect(block).toContain("jenny@example.com");
    expect(block).toContain("尚未註冊帳號");
    expect(block).toContain("九月日本團");
    expect(block).toContain("【近期來信】");
    expect(block).toContain("想問九月日本團報價");
    expect(block).not.toContain("PackPoint");
  });

  it("filters out closed inquiries from the pinned 開著的詢問 list", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        [{ id: 1, email: "jenny@example.com" }],
        [
          { subject: "舊的已結團", destination: "日本", status: "closed" },
          { subject: "新的開著團", destination: "日本", status: "new" },
        ],
        [],
        [],
      ]),
    );
    const block = await buildGuestChatContext(1);
    expect(block).toContain("新的開著團");
    expect(block).not.toContain("舊的已結團");
  });
});
