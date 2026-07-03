/**
 * websiteIntake 測試 — customer-cockpit 任務7「網站渠道進場」。
 *
 * 覆蓋:
 *   a. ensureCustomerProfileForWebsiteContact — userId 路徑(ensureProfileId)、
 *      existing/creatable/blocked_registered_member/blocked_no_identifier 四態、
 *      DB 掛掉/例外一律吞掉回 null。
 *   b. recordWebsiteInteraction — inbound 寫入 + touchLastInbound、outbound
 *      寫入不觸發 touchLastInbound、DB 掛掉/例外回 false 不 throw。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnsureProfileId, mockResolveOrIdentifyCustomer, mockTouchLastInbound, mockDb, insertMock } =
  vi.hoisted(() => {
    const mockEnsureProfileId = vi.fn();
    const mockResolveOrIdentifyCustomer = vi.fn();
    const mockTouchLastInbound = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn().mockResolvedValue([{ insertId: 555 }]);
    const mockDb = {
      insert: vi.fn().mockReturnValue({ values: insertMock }),
    };
    return { mockEnsureProfileId, mockResolveOrIdentifyCustomer, mockTouchLastInbound, mockDb, insertMock };
  });

vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("./customerAiSummary", () => ({ ensureProfileId: mockEnsureProfileId }));
vi.mock("../db/customerProfile", () => ({
  resolveOrIdentifyCustomer: mockResolveOrIdentifyCustomer,
}));
vi.mock("./customerUnread", () => ({ touchLastInbound: mockTouchLastInbound }));
vi.mock("../../drizzle/schema", () => ({
  customerProfiles: { email: "email", phone: "phone", name: "name", source: "source" },
  customerInteractions: {
    customerProfileId: "customerProfileId",
    channel: "channel",
    direction: "direction",
    content: "content",
    contentSummary: "contentSummary",
    generatedBy: "generatedBy",
    agentName: "agentName",
    createdAt: "createdAt",
  },
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import {
  ensureCustomerProfileForWebsiteContact,
  recordWebsiteInteraction,
  formatBookingInteractionContent,
} from "./websiteIntake";
import { getDb } from "../db";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(mockDb as any);
  mockDb.insert.mockReturnValue({ values: insertMock });
  insertMock.mockResolvedValue([{ insertId: 555 }]);
});

// ────────────────────────────────────────────────────────────────────────
// a) ensureCustomerProfileForWebsiteContact
// ────────────────────────────────────────────────────────────────────────

describe("ensureCustomerProfileForWebsiteContact", () => {
  it("logged-in user (userId present) delegates to ensureProfileId", async () => {
    mockEnsureProfileId.mockResolvedValue(42);
    const result = await ensureCustomerProfileForWebsiteContact({
      userId: 7,
      email: "a@example.com",
      phone: null,
      name: "A",
    });
    expect(result).toBe(42);
    expect(mockEnsureProfileId).toHaveBeenCalledWith({ userId: 7 });
    expect(mockResolveOrIdentifyCustomer).not.toHaveBeenCalled();
  });

  it("guest with an existing profile: returns the canonical profileId", async () => {
    mockResolveOrIdentifyCustomer.mockResolvedValue({ status: "existing", profileId: 99, matchedBy: "email" });
    const result = await ensureCustomerProfileForWebsiteContact({
      email: "a@example.com",
      phone: null,
      name: "A",
    });
    expect(result).toBe(99);
  });

  it("guest, creatable: inserts a new profile row with source:'web_form'", async () => {
    mockResolveOrIdentifyCustomer.mockResolvedValue({ status: "creatable" });
    const result = await ensureCustomerProfileForWebsiteContact({
      email: "New@Example.com",
      phone: "510-333-1234",
      name: "New Guy",
    });
    expect(result).toBe(555);
    expect(insertMock).toHaveBeenCalledWith({
      email: "new@example.com",
      phone: "510-333-1234",
      name: "New Guy",
      source: "web_form",
    });
  });

  it("email belongs to a registered member: attaches to the member's own profile via ensureProfileId, never a parallel guest card", async () => {
    mockResolveOrIdentifyCustomer.mockResolvedValue({
      status: "blocked_registered_member",
      registeredUserId: 321,
    });
    mockEnsureProfileId.mockResolvedValue(654);
    const result = await ensureCustomerProfileForWebsiteContact({
      email: "member@example.com",
      phone: null,
      name: "Member",
    });
    expect(result).toBe(654);
    expect(mockEnsureProfileId).toHaveBeenCalledWith({ userId: 321 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("blocked_no_identifier: returns null honestly, never fabricates an identity", async () => {
    mockResolveOrIdentifyCustomer.mockResolvedValue({ status: "blocked_no_identifier" });
    const result = await ensureCustomerProfileForWebsiteContact({
      email: "",
      phone: null,
      name: null,
    });
    expect(result).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("degrades to null (never throws) when resolveOrIdentifyCustomer rejects", async () => {
    mockResolveOrIdentifyCustomer.mockRejectedValue(new Error("db down"));
    await expect(
      ensureCustomerProfileForWebsiteContact({ email: "a@example.com", phone: null, name: null }),
    ).resolves.toBeNull();
  });

  it("degrades to null when the DB is unavailable at insert time", async () => {
    mockResolveOrIdentifyCustomer.mockResolvedValue({ status: "creatable" });
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const result = await ensureCustomerProfileForWebsiteContact({
      email: "a@example.com",
      phone: null,
      name: null,
    });
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// b) recordWebsiteInteraction
// ────────────────────────────────────────────────────────────────────────

describe("recordWebsiteInteraction", () => {
  it("inbound: inserts the interaction AND touches last-inbound", async () => {
    const ok = await recordWebsiteInteraction({
      profileId: 42,
      direction: "inbound",
      content: "行程詢問\n\n請問報價",
      contentSummary: "行程詢問",
      agentName: "website_inquiry",
    });
    expect(ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerProfileId: 42,
        channel: "web_form",
        direction: "inbound",
        content: "行程詢問\n\n請問報價",
        contentSummary: "行程詢問",
        generatedBy: "human",
        agentName: "website_inquiry",
      }),
    );
    expect(mockTouchLastInbound).toHaveBeenCalledTimes(1);
    expect(mockTouchLastInbound.mock.calls[0][1]).toBe(42);
  });

  it("outbound: inserts the interaction but does NOT touch last-inbound", async () => {
    const ok = await recordWebsiteInteraction({
      profileId: 42,
      direction: "outbound",
      content: "回覆內容",
      agentName: "website_inquiry_reply",
    });
    expect(ok).toBe(true);
    expect(mockTouchLastInbound).not.toHaveBeenCalled();
  });

  it("caps content at 10,000 chars and contentSummary at 500", async () => {
    await recordWebsiteInteraction({
      profileId: 1,
      direction: "inbound",
      content: "x".repeat(20_000),
      contentSummary: "y".repeat(1000),
      agentName: "test",
    });
    const inserted = insertMock.mock.calls[0][0];
    expect(inserted.content.length).toBe(10_000);
    expect(inserted.contentSummary.length).toBe(500);
  });

  it("defaults contentSummary to null when omitted", async () => {
    await recordWebsiteInteraction({
      profileId: 1,
      direction: "inbound",
      content: "hi",
      agentName: "test",
    });
    expect(insertMock.mock.calls[0][0].contentSummary).toBeNull();
  });

  it("degrades to false (never throws) when the DB is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const ok = await recordWebsiteInteraction({
      profileId: 1,
      direction: "inbound",
      content: "hi",
      agentName: "test",
    });
    expect(ok).toBe(false);
  });

  it("degrades to false (never throws) when the insert rejects", async () => {
    insertMock.mockRejectedValueOnce(new Error("insert failed"));
    const ok = await recordWebsiteInteraction({
      profileId: 1,
      direction: "inbound",
      content: "hi",
      agentName: "test",
    });
    expect(ok).toBe(false);
  });

  it("degrades to false (never throws) when touchLastInbound rejects", async () => {
    mockTouchLastInbound.mockRejectedValueOnce(new Error("touch failed"));
    const ok = await recordWebsiteInteraction({
      profileId: 1,
      direction: "inbound",
      content: "hi",
      agentName: "test",
    });
    expect(ok).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// c) formatBookingInteractionContent (pure) — customer-cockpit 任務7c
// ────────────────────────────────────────────────────────────────────────

describe("formatBookingInteractionContent", () => {
  const base = {
    tourTitle: "北海道雪祭 6 日",
    departureLabel: "2026/12/20",
    adults: 2,
    children: 0,
    infants: 0,
    paymentKindZh: "全額",
    amount: 5000,
    currency: "usd",
  };

  it("formats the full happy path", () => {
    expect(formatBookingInteractionContent(base)).toBe(
      "訂了「北海道雪祭 6 日」,出發日 2026/12/20,大人 2,已付全額 $5000.00 USD",
    );
  });

  it("omits the departure segment when departureLabel is null (fact not available, not guessed)", () => {
    expect(formatBookingInteractionContent({ ...base, departureLabel: null })).toBe(
      "訂了「北海道雪祭 6 日」,大人 2,已付全額 $5000.00 USD",
    );
  });

  it("includes children/infants only when non-zero", () => {
    expect(
      formatBookingInteractionContent({ ...base, children: 1, infants: 1 }),
    ).toBe("訂了「北海道雪祭 6 日」,出發日 2026/12/20,大人 2、小孩 1、嬰兒 1,已付全額 $5000.00 USD");
  });

  it("omits the whole pax segment when adults/children/infants are all zero", () => {
    expect(
      formatBookingInteractionContent({ ...base, adults: 0 }),
    ).toBe("訂了「北海道雪祭 6 日」,出發日 2026/12/20,已付全額 $5000.00 USD");
  });

  it("labels deposit and balance payment kinds correctly", () => {
    expect(formatBookingInteractionContent({ ...base, paymentKindZh: "訂金" })).toContain("已付訂金");
    expect(formatBookingInteractionContent({ ...base, paymentKindZh: "尾款" })).toContain("已付尾款");
  });

  it("uppercases the currency code", () => {
    expect(formatBookingInteractionContent({ ...base, currency: "twd" })).toContain("TWD");
  });
});
