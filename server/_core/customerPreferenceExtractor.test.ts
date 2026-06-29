import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvokeLLM, mockDb, selectChain, updateChain } = vi.hoisted(() => {
  const mockInvokeLLM = vi.fn();
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue(updateChain),
  };
  return { mockInvokeLLM, mockDb, selectChain, updateChain };
});

vi.mock("./llm", () => ({ invokeLLM: mockInvokeLLM }));
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("../../drizzle/schema", () => ({
  customerProfiles: { id: "id", aiNotes: "aiNotes", keyFacts: "keyFacts", preferences: "preferences", email: "email", userId: "userId" },
  customerInteractions: { customerProfileId: "cpId", direction: "dir", content: "c", createdAt: "ca" },
  inquiryMessages: { inquiryId: "iId", senderType: "st", message: "m", createdAt: "ca" },
  inquiries: { id: "id", customerEmail: "ce" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: any[]) => a),
  desc: vi.fn((c: any) => c),
  and: vi.fn((...a: any[]) => a),
  inArray: vi.fn((...a: any[]) => a),
  isNull: vi.fn((c: any) => c),
  isNotNull: vi.fn((c: any) => c),
}));

import {
  extractCustomerPreferences,
  extractAfterReply,
  backfillMissingPreferences,
} from "./customerPreferenceExtractor";
import { getDb } from "../db";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(mockDb as any);
  mockDb.select.mockReturnValue(selectChain);
  mockDb.update.mockReturnValue(updateChain);
  selectChain.from.mockReturnThis();
  selectChain.where.mockReturnThis();
  selectChain.orderBy.mockReturnThis();
  selectChain.limit.mockResolvedValue([{ aiNotes: null, keyFacts: null, preferences: null }]);
  updateChain.set.mockReturnThis();
  updateChain.where.mockResolvedValue(undefined);
});

describe("extractCustomerPreferences", () => {
  it("returns null for empty messages", async () => {
    const result = await extractCustomerPreferences({
      profileId: 1,
      recentMessages: [],
    });
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("extracts preferences from conversation and saves to DB", async () => {
    const extraction = {
      aiNotes: "客人喜歡慢步調,對海鮮過敏",
      keyFacts: "- 海鮮過敏\n- 兩個小孩",
      preferences: { food: { dislikes: ["海鮮"] }, pace: "慢步調" },
    };
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(extraction) } }],
    });

    const result = await extractCustomerPreferences({
      profileId: 42,
      recentMessages: [
        { role: "customer", content: "我們有兩個小孩,不吃海鮮" },
        { role: "admin", content: "好的,我幫您安排適合的行程" },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.aiNotes).toContain("海鮮過敏");
    expect(result!.preferences.pace).toBe("慢步調");
    expect(mockInvokeLLM).toHaveBeenCalledOnce();
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        aiNotes: expect.stringContaining("海鮮過敏"),
        preferences: expect.objectContaining({ pace: "慢步調" }),
      }),
    );
  });

  it("includes existing notes in the prompt for merge", async () => {
    selectChain.limit.mockResolvedValue([{
      aiNotes: "客人很注重隱私",
      keyFacts: "- VIP 老客戶",
      preferences: { accommodation: { roomType: "套房" } },
    }]);
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        aiNotes: "客人很注重隱私。這次想帶家人去歐洲",
        keyFacts: "- VIP 老客戶\n- 計畫歐洲家庭旅行",
        preferences: { accommodation: { roomType: "套房" }, wishlist: ["歐洲"] },
      }) } }],
    });

    await extractCustomerPreferences({
      profileId: 42,
      recentMessages: [{ role: "customer", content: "想帶全家去歐洲走走" }],
    });

    // messages[0] is now the system message; the user prompt is messages[1].
    const msgs = mockInvokeLLM.mock.calls[0][0].messages;
    const prompt = msgs[msgs.length - 1].content;
    expect(prompt).toContain("客人很注重隱私");
    expect(prompt).toContain("VIP 老客戶");
  });

  it("handles LLM failure gracefully", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("API timeout"));

    const result = await extractCustomerPreferences({
      profileId: 42,
      recentMessages: [{ role: "customer", content: "hello" }],
    });

    expect(result).toBeNull();
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it("returns null when profile not found", async () => {
    selectChain.limit.mockResolvedValue([]);

    const result = await extractCustomerPreferences({
      profileId: 999,
      recentMessages: [{ role: "customer", content: "hi" }],
    });

    expect(result).toBeNull();
  });

  it("uses Opus model AND actually sends the anti-fabrication system prompt", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        aiNotes: "test", keyFacts: "- test", preferences: {},
      }) } }],
    });

    await extractCustomerPreferences({
      profileId: 42,
      recentMessages: [{ role: "customer", content: "hi" }],
    });

    const params = mockInvokeLLM.mock.calls[0][0];
    // Real `model` field (not the ignored `_model`) so it doesn't fall to Sonnet.
    expect(params.model).toContain("opus");
    expect(params._model).toBeUndefined();
    // EXTRACT_SYSTEM must ride a role:"system" message, or the 鐵律 never reaches
    // the model (invokeLLM ignores any top-level system field).
    expect(params.messages[0].role).toBe("system");
    expect(params.messages[0].content).toContain("絕對鐵律");
  });
});

describe("extractAfterReply — dedup + coalescing (M2 cost control)", () => {
  it("coalesces an overlapping trigger into exactly one extra run (no lost update)", async () => {
    // getDb resolves null → runExtraction no-ops cleanly (no DB chain).
    vi.mocked(getDb).mockResolvedValue(undefined as any);
    const p1 = extractAfterReply(7);
    const p2 = extractAfterReply(7); // arrives mid-run → remembered, not dropped
    await Promise.all([p1, p2]);
    // one original run + one coalesced re-run = 2. NOT 1 (would drop p2's data),
    // NOT 3+ (would mean no dedup, paying per overlapping trigger).
    expect(getDb).toHaveBeenCalledTimes(2);
  });

  it("re-extracts a later change (the lock clears in finally)", async () => {
    vi.mocked(getDb).mockResolvedValue(undefined as any);
    await extractAfterReply(7);
    await extractAfterReply(7);
    expect(getDb).toHaveBeenCalledTimes(2);
  });
});

describe("backfillMissingPreferences (M2 back-fill)", () => {
  it("returns zero when the db is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(undefined as any);
    expect(await backfillMissingPreferences()).toEqual({
      scanned: 0,
      extracted: 0,
    });
  });

  it("no-ops when no customer is missing preferences", async () => {
    selectChain.limit.mockResolvedValueOnce([]); // scan → none to back-fill
    expect(await backfillMissingPreferences(25)).toEqual({
      scanned: 0,
      extracted: 0,
    });
  });
});
