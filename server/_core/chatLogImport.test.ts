import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvokeLLM, mockDb, selectChain } = vi.hoisted(() => {
  const mockInvokeLLM = vi.fn();
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  };
  return { mockInvokeLLM, mockDb, selectChain };
});

const mockEnqueueRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock("./llm", () => ({ invokeLLM: mockInvokeLLM }));
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("../queue", () => ({ enqueueCustomerSummaryRefresh: mockEnqueueRefresh }));
vi.mock("../../drizzle/schema", () => ({
  customerInteractions: {
    customerProfileId: "customerProfileId",
    content: "content",
    createdAt: "createdAt",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => a),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import {
  resolveEventDate,
  buildChatLogInteractionRows,
  importChatLogForCustomer,
  classifyAndExtractChatLog,
  type ChatLogExtraction,
} from "./chatLogImport";
import { getDb } from "../db";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(mockDb as any);
  mockDb.select.mockReturnValue(selectChain);
  selectChain.from.mockReturnThis();
  selectChain.where.mockResolvedValue([]);
  mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
});

// ────────────────────────────────────────────────────────────────────────
// resolveEventDate — the highest-risk logic in this file.
// ────────────────────────────────────────────────────────────────────────

describe("resolveEventDate", () => {
  it("uses explicit 4-digit year verbatim (ISO format)", () => {
    expect(resolveEventDate("2026-06-10", "2026-07-02")).toEqual({
      year: 2026,
      month: 6,
      day: 10,
    });
  });

  it("uses explicit year verbatim (Chinese format)", () => {
    expect(resolveEventDate("2025年12月31日", "2026-07-02")).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });

  it("uses explicit year verbatim (English month name)", () => {
    expect(resolveEventDate("June 10, 2026", "2026-07-02")).toEqual({
      year: 2026,
      month: 6,
      day: 10,
    });
  });

  it("no year + substituting current year lands in the past → keeps current year", () => {
    // today 2026-07-02, message "6月10日" → 2026-06-10 is in the past → keep 2026
    expect(resolveEventDate("6月10日", "2026-07-02")).toEqual({
      year: 2026,
      month: 6,
      day: 10,
    });
  });

  it("no year + substituting current year would be FUTURE → rolls back one year", () => {
    // today 2026-07-02, message "12月25日" → 2026-12-25 is in the future → must
    // resolve to 2025-12-25, not 2026 (conversation snippets can't be future).
    expect(resolveEventDate("12月25日", "2026-07-02")).toEqual({
      year: 2025,
      month: 12,
      day: 25,
    });
  });

  it("year-boundary: today is early January, message has no year and reads December → resolves to LAST year, not this year", () => {
    // today 2026-01-03, message "12月31日" → substituting 2026 gives 2026-12-31
    // which is future → roll back to 2025-12-31 (NOT accidentally stay 2026).
    expect(resolveEventDate("12月31日", "2026-01-03")).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });

  it("message date exactly equals todayLA → does not roll back (on-or-before is kept)", () => {
    expect(resolveEventDate("7月2日", "2026-07-02")).toEqual({
      year: 2026,
      month: 7,
      day: 2,
    });
  });

  it("handles US slash format without year (6/10)", () => {
    expect(resolveEventDate("6/10", "2026-07-02")).toEqual({
      year: 2026,
      month: 6,
      day: 10,
    });
  });

  it("handles dash format without year (06-10)", () => {
    expect(resolveEventDate("06-10", "2026-07-02")).toEqual({
      year: 2026,
      month: 6,
      day: 10,
    });
  });

  it("handles 'Jun 10' short month name without year", () => {
    expect(resolveEventDate("Jun 10", "2026-07-02")).toEqual({
      year: 2026,
      month: 6,
      day: 10,
    });
  });

  it("handles '10 Jun 2026' day-month-year order", () => {
    expect(resolveEventDate("10 Jun 2026", "2026-07-02")).toEqual({
      year: 2026,
      month: 6,
      day: 10,
    });
  });

  it("returns null for unparseable garbage input", () => {
    expect(resolveEventDate("asdkjaslkdj not a date at all", "2026-07-02")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolveEventDate("", "2026-07-02")).toBeNull();
  });

  it("returns null instead of throwing on malformed todayLA anchor", () => {
    expect(() => resolveEventDate("6/10", "not-a-date")).not.toThrow();
    expect(resolveEventDate("6/10", "not-a-date")).toBeNull();
  });

  it("returns null for an out-of-range calendar date (Feb 30)", () => {
    expect(resolveEventDate("2/30", "2026-07-02")).toBeNull();
  });

  it("2026-07-03 對抗審查 P1修復:Feb 29 rolled BACK a year lands on a non-leap year → null, not an invalid date", () => {
    // todayYear 2028 is a leap year (2/29 valid there) but the "future date,
    // roll back" fast path used to return {year: todayYear-1, ...} WITHOUT
    // re-validating that year — 2027 is not a leap year, so the old code
    // returned a calendar-impossible 2027-02-29. Must be null now.
    expect(resolveEventDate("2/29", "2028-01-15")).toBeNull();
  });

  it("never throws on null/undefined-like input", () => {
    expect(() => resolveEventDate(null as unknown as string, "2026-07-02")).not.toThrow();
    expect(resolveEventDate(null as unknown as string, "2026-07-02")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// resolveEventDate — relative dates (2026-07-03 P1 prod 修復,customer-cockpit
// Phase5.5)。100% 純 code 相對日推算,LLM 永不碰日期運算。錨點沿用既有測試的
// todayLA "2026-07-02"(星期四)方便交叉核對,不改既有格式的行為(前面整個
// describe block 全綠是硬條件)。
// ────────────────────────────────────────────────────────────────────────

describe("resolveEventDate — relative dates", () => {
  it("今天 resolves to todayLA itself", () => {
    expect(resolveEventDate("今天", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 2 });
  });

  it("今日 (alternate wording) resolves to todayLA itself", () => {
    expect(resolveEventDate("今日", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 2 });
  });

  it("明天 resolves to todayLA + 1 day", () => {
    expect(resolveEventDate("明天", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 3 });
  });

  it("後天 (traditional) resolves to todayLA + 2 days", () => {
    expect(resolveEventDate("後天", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 4 });
  });

  it("后天 (simplified) resolves to todayLA + 2 days", () => {
    expect(resolveEventDate("后天", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 4 });
  });

  it("明天 rolls over month/year correctly at a year boundary", () => {
    expect(resolveEventDate("明天", "2026-12-31")).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it("星期X for TODAY's own weekday resolves to today (含今天,不跳到下週)", () => {
    // todayLA 2026-07-02 is a Thursday (星期四).
    expect(resolveEventDate("星期四", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 2 });
  });

  it("星期X for a day already passed this week rolls to its NEXT occurrence", () => {
    // Wednesday (星期三) already passed this week relative to Thursday →
    // next occurrence is 6 days out (2026-07-08), not treated as -1 day in the past.
    expect(resolveEventDate("星期三", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 8 });
  });

  it("星期X for a day later this week resolves within the same week", () => {
    // Monday target from Thursday anchor → next Monday is 4 days out (2026-07-06).
    expect(resolveEventDate("星期一", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 6 });
  });

  it("週X / 周X / 禮拜X are accepted synonyms for 星期X", () => {
    expect(resolveEventDate("週一", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 6 });
    expect(resolveEventDate("周一", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 6 });
    expect(resolveEventDate("禮拜一", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 6 });
  });

  it("下週X always lands in the FOLLOWING week, even for today's own weekday", () => {
    // 下週四 from a Thursday anchor must NOT resolve to today — it's 7 days out.
    expect(resolveEventDate("下星期四", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 9 });
  });

  it("下週X for a day later this week still pushes a full week out", () => {
    // 下週一 from Thursday: bare 星期一 would be +4 days (this coming Monday);
    // 下週一 must be +11 days (the Monday AFTER that).
    expect(resolveEventDate("下週一", "2026-07-02")).toEqual({ year: 2026, month: 7, day: 13 });
  });

  it("does not misfire on plain weekday text without a recognizable date pattern", () => {
    expect(resolveEventDate("下星期", "2026-07-02")).toBeNull();
    expect(resolveEventDate("星期", "2026-07-02")).toBeNull();
  });

  it("does not misfire on a weekday-lookalike token with an unrecognized character", () => {
    // "星期1" uses an Arabic numeral instead of one of 一二三四五六日天 — falls
    // through to null rather than guessing, same as any other malformed input.
    expect(resolveEventDate("星期1", "2026-07-02")).toBeNull();
    expect(resolveEventDate("星期天天", "2026-07-02")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// resolveEventDate — opts.bias:"future" (2026-07-03 P1 prod 修復). Default
// (omitted opts, or bias:"past") behavior is asserted identical to every test
// above — this section only covers the NEW opt-in branch used by
// promiseExtraction.ts, never by chatLogImport itself.
// ────────────────────────────────────────────────────────────────────────

describe("resolveEventDate — opts.bias:'future'", () => {
  it("a date after today in the same year stays in the current year (no rollback)", () => {
    // Default/past bias would roll this back to 2025 (see the plain "handles
    // US slash format" tests above using the SAME kind of input under default
    // bias); future bias must not.
    expect(resolveEventDate("7/8", "2026-07-03", { bias: "future" })).toEqual({
      year: 2026,
      month: 7,
      day: 8,
    });
  });

  it("a date before today in the same year rolls FORWARD to next year", () => {
    expect(resolveEventDate("7/1", "2026-07-03", { bias: "future" })).toEqual({
      year: 2027,
      month: 7,
      day: 1,
    });
  });

  it("a date exactly equal to today is kept in the current year (boundary)", () => {
    expect(resolveEventDate("7/3", "2026-07-03", { bias: "future" })).toEqual({
      year: 2026,
      month: 7,
      day: 3,
    });
  });

  it("year-boundary: today is late December, message reads early January → rolls forward to NEXT year", () => {
    expect(resolveEventDate("1/5", "2026-12-20", { bias: "future" })).toEqual({
      year: 2027,
      month: 1,
      day: 5,
    });
  });

  it("explicit 4-digit year is trusted verbatim regardless of bias", () => {
    expect(resolveEventDate("2025-01-01", "2026-07-03", { bias: "future" })).toEqual({
      year: 2025,
      month: 1,
      day: 1,
    });
  });

  it("2026-07-03 對抗審查 P1修復:Feb 29 rolled FORWARD a year lands on a non-leap year → null, not an invalid date", () => {
    // todayYear 2028 is leap (2/29 valid there) and today is AFTER Feb 29, so
    // the future-bias fast path used to roll to todayYear+1 = 2029 WITHOUT
    // re-validating — 2029 isn't a leap year, so the old code returned a
    // calendar-impossible 2029-02-29. Must be null now.
    expect(resolveEventDate("2/29", "2028-03-01", { bias: "future" })).toBeNull();
  });

  it("default bias (opts omitted) is unchanged from the past-biased behavior used by chatLogImport", () => {
    expect(resolveEventDate("7/8", "2026-07-03")).toEqual({ year: 2025, month: 7, day: 8 });
    expect(resolveEventDate("7/8", "2026-07-03", { bias: "past" })).toEqual({
      year: 2025,
      month: 7,
      day: 8,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildChatLogInteractionRows
// ────────────────────────────────────────────────────────────────────────

describe("buildChatLogInteractionRows", () => {
  function extraction(overrides: Partial<ChatLogExtraction> = {}): ChatLogExtraction {
    return {
      isChatLog: true,
      participantMatch: "match",
      mismatchNote: null,
      channelGuess: null,
      messages: [],
      ...overrides,
    };
  }

  it("maps customer→inbound and jeff→outbound", () => {
    const ext = extraction({
      channelGuess: "wechat",
      messages: [
        { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "你好" },
        { speaker: "jeff", rawDateText: "6/10", hour: 9, minute: 5, text: "您好" },
      ],
    });
    const { rows } = buildChatLogInteractionRows(ext, {
      customerProfileId: 42,
      todayLA: "2026-07-02",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].direction).toBe("inbound");
    expect(rows[1].direction).toBe("outbound");
  });

  it("skips speaker unknown messages without counting them as dropped-for-date", () => {
    const ext = extraction({
      messages: [
        { speaker: "unknown", rawDateText: "6/10", hour: null, minute: null, text: "???" },
      ],
    });
    const { rows, droppedCount } = buildChatLogInteractionRows(ext, {
      customerProfileId: 1,
      todayLA: "2026-07-02",
    });
    expect(rows).toHaveLength(0);
    expect(droppedCount).toBe(0);
  });

  it("drops messages with no rawDateText and counts them, instead of stamping today", () => {
    const ext = extraction({
      messages: [
        { speaker: "customer", rawDateText: null, hour: null, minute: null, text: "沒有日期" },
      ],
    });
    const { rows, droppedCount } = buildChatLogInteractionRows(ext, {
      customerProfileId: 1,
      todayLA: "2026-07-02",
    });
    expect(rows).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });

  it("drops messages whose rawDateText fails to resolve", () => {
    const ext = extraction({
      messages: [
        { speaker: "customer", rawDateText: "garbage", hour: null, minute: null, text: "x" },
      ],
    });
    const { droppedCount } = buildChatLogInteractionRows(ext, {
      customerProfileId: 1,
      todayLA: "2026-07-02",
    });
    expect(droppedCount).toBe(1);
  });

  it("channel fallback order: channelOverride > extraction.channelGuess > wechat default", () => {
    const msgs: ChatLogExtraction["messages"] = [
      { speaker: "customer", rawDateText: "6/10", hour: null, minute: null, text: "hi" },
    ];

    const withOverride = buildChatLogInteractionRows(
      extraction({ channelGuess: "line", messages: msgs }),
      { customerProfileId: 1, todayLA: "2026-07-02", channelOverride: "sms" },
    );
    expect(withOverride.rows[0].channel).toBe("sms");

    const withGuessOnly = buildChatLogInteractionRows(
      extraction({ channelGuess: "line", messages: msgs }),
      { customerProfileId: 1, todayLA: "2026-07-02" },
    );
    expect(withGuessOnly.rows[0].channel).toBe("line");

    const withNeither = buildChatLogInteractionRows(
      extraction({ channelGuess: null, messages: msgs }),
      { customerProfileId: 1, todayLA: "2026-07-02" },
    );
    expect(withNeither.rows[0].channel).toBe("wechat");
  });

  it("defaults missing time-of-day to noon (12:00)", () => {
    const ext = extraction({
      messages: [
        { speaker: "customer", rawDateText: "6/10", hour: null, minute: null, text: "x" },
      ],
    });
    const { rows } = buildChatLogInteractionRows(ext, {
      customerProfileId: 1,
      todayLA: "2026-07-02",
    });
    expect(rows[0].createdAt.getHours()).toBe(12);
    expect(rows[0].createdAt.getMinutes()).toBe(0);
  });

  it("truncates content to 10000 chars", () => {
    const longText = "a".repeat(15_000);
    const ext = extraction({
      messages: [
        { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: longText },
      ],
    });
    const { rows } = buildChatLogInteractionRows(ext, {
      customerProfileId: 1,
      todayLA: "2026-07-02",
    });
    expect(rows[0].content.length).toBe(10_000);
  });

  it("sorts rows ascending by createdAt", () => {
    const ext = extraction({
      messages: [
        { speaker: "customer", rawDateText: "6/12", hour: 9, minute: 0, text: "later" },
        { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "earlier" },
      ],
    });
    const { rows } = buildChatLogInteractionRows(ext, {
      customerProfileId: 1,
      todayLA: "2026-07-02",
    });
    expect(rows[0].content).toBe("earlier");
    expect(rows[1].content).toBe("later");
  });

  it("computes dateRange from earliest/latest resolved dates; null when none resolve", () => {
    const ext = extraction({
      messages: [
        { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "a" },
        { speaker: "customer", rawDateText: "6/15", hour: 9, minute: 0, text: "b" },
      ],
    });
    const { dateRange } = buildChatLogInteractionRows(ext, {
      customerProfileId: 1,
      todayLA: "2026-07-02",
    });
    expect(dateRange).toEqual({ from: "2026-06-10", to: "2026-06-15" });

    const noDates = buildChatLogInteractionRows(
      extraction({
        messages: [{ speaker: "customer", rawDateText: null, hour: null, minute: null, text: "x" }],
      }),
      { customerProfileId: 1, todayLA: "2026-07-02" },
    );
    expect(noDates.dateRange).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// importChatLogForCustomer — DB-touching orchestrator
// ────────────────────────────────────────────────────────────────────────

describe("importChatLogForCustomer", () => {
  const baseParams = {
    customerProfileId: 7,
    text: "客人: 你好\nJeff: 您好",
    filename: "wechat.png",
    customerName: "王小姐",
  };

  it("not_a_chat_log short-circuits before touching DB", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: false,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: null,
              messages: [],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("not_a_chat_log");
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("mismatch short-circuits before touching DB", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "mismatch",
              mismatchNote: "對話裡提到的是李先生",
              channelGuess: "wechat",
              messages: [],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("mismatch");
    expect(result.note).toBe("對話裡提到的是李先生");
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("ambiguous short-circuits before touching DB", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "ambiguous",
              mismatchNote: "不確定",
              channelGuess: "wechat",
              messages: [],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("ambiguous");
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("duplicate content is deduped and not re-inserted", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "已經存在的訊息" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    selectChain.where.mockResolvedValue([
      { content: "已經存在的訊息", createdAt: new Date(2026, 5, 10, 9, 0, 0, 0) },
    ]);

    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("no_messages");
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockEnqueueRefresh).not.toHaveBeenCalled();
  });

  it("successful import calls enqueueCustomerSummaryRefresh exactly once", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "訊息一" },
                { speaker: "jeff", rawDateText: "6/10", hour: 9, minute: 5, text: "訊息二" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    selectChain.where.mockResolvedValue([]); // nothing existing

    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("imported");
    expect(result.importedCount).toBe(2);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(mockEnqueueRefresh).toHaveBeenCalledTimes(1);
    expect(mockEnqueueRefresh).toHaveBeenCalledWith(7);
  });

  it("LLM call throwing is swallowed and returns status error, not thrown", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("network blew up"));
    await expect(importChatLogForCustomer(baseParams)).resolves.toEqual({ status: "error" });
  });

  it("no_messages when all rows were dropped for missing dates", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: null, hour: null, minute: null, text: "沒日期" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("no_messages");
    expect(result.droppedCount).toBe(1);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── misfile-risk P1 fix — unverifiedNoName visibility ──────────────────
  it("flags unverifiedNoName=true when customerName is null (guest with no name on file)", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "hi" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await importChatLogForCustomer({ ...baseParams, customerName: null });
    expect(result.status).toBe("imported");
    expect(result.unverifiedNoName).toBe(true);
  });

  it("flags unverifiedNoName=false when a real customerName was checked", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "hi" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await importChatLogForCustomer(baseParams); // customerName: "王小姐"
    expect(result.status).toBe("imported");
    expect(result.unverifiedNoName).toBe(false);
  });

  // ── concurrency fix — timestamp-aware dedup ─────────────────────────────
  it("does NOT dedup two identical-text messages at different resolved times (repeated short replies like 好/謝謝)", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "好" },
                { speaker: "customer", rawDateText: "6/10", hour: 15, minute: 0, text: "好" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    selectChain.where.mockResolvedValue([]); // nothing existing yet
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("imported");
    expect(result.importedCount).toBe(2);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it("DOES dedup when content AND resolved timestamp both already exist (same screenshot dragged twice)", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "好" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const existingCreatedAt = new Date(2026, 5, 10, 9, 0, 0, 0);
    selectChain.where.mockResolvedValue([{ content: "好", createdAt: existingCreatedAt }]);
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("no_messages");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── concurrency fix — partial batch insert failure is reported, not lost ──
  it("one row's insert throwing does not discard already-committed rows into a bare error", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "訊息一" },
                { speaker: "customer", rawDateText: "6/11", hour: 9, minute: 0, text: "訊息二" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    selectChain.where.mockResolvedValue([]);
    let call = 0;
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockImplementation(() => {
        call++;
        if (call === 2) return Promise.reject(new Error("connection reset"));
        return Promise.resolve(undefined);
      }),
    });
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("imported");
    expect(result.importedCount).toBe(1);
    // the failed row should be reflected in droppedCount, not silently vanish
    expect(result.droppedCount).toBe(1);
  });

  it("ALL rows failing to insert returns status error (not a false no_messages)", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "訊息一" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    selectChain.where.mockResolvedValue([]);
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("error");
    expect(mockEnqueueRefresh).not.toHaveBeenCalled();
  });

  // ── redline-compliance gap fix — getDb() returning null ─────────────────
  it("getDb() returning null returns status error instead of throwing", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isChatLog: true,
              participantMatch: "match",
              mismatchNote: null,
              channelGuess: "wechat",
              messages: [
                { speaker: "customer", rawDateText: "6/10", hour: 9, minute: 0, text: "hi" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const result = await importChatLogForCustomer(baseParams);
    expect(result.status).toBe("error");
  });
});

// ────────────────────────────────────────────────────────────────────────
// classifyAndExtractChatLog — direct unit tests (redline-compliance gap fix)
// ────────────────────────────────────────────────────────────────────────

describe("classifyAndExtractChatLog", () => {
  const baseParams = {
    text: "客人: 你好\nJeff: 您好",
    filename: "wechat.png",
    customerName: "王小姐",
    todayLA: "2026-07-02",
  };

  it("abandons extraction and returns null when finish_reason is 'length'", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ isChatLog: true, participantMatch: "match", mismatchNote: null, channelGuess: null, messages: [] }) },
          finish_reason: "length",
        },
      ],
    });
    const result = await classifyAndExtractChatLog(baseParams);
    expect(result).toBeNull();
  });

  it("returns null on empty LLM response content", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: "" }, finish_reason: "stop" }],
    });
    const result = await classifyAndExtractChatLog(baseParams);
    expect(result).toBeNull();
  });

  it("returns null when parseLlmJson yields malformed/non-JSON text", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: "not valid json at all {{{" }, finish_reason: "stop" }],
    });
    const result = await classifyAndExtractChatLog(baseParams);
    expect(result).toBeNull();
  });

  it("returns null when isChatLog is missing/non-boolean in the parsed JSON", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ participantMatch: "match", mismatchNote: null, channelGuess: null, messages: [] }) },
          finish_reason: "stop",
        },
      ],
    });
    const result = await classifyAndExtractChatLog(baseParams);
    expect(result).toBeNull();
  });

  it("defensively coerces a missing/non-array messages field to an empty array", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ isChatLog: true, participantMatch: "match", mismatchNote: null, channelGuess: null }) },
          finish_reason: "stop",
        },
      ],
    });
    const result = await classifyAndExtractChatLog(baseParams);
    expect(result?.messages).toEqual([]);
  });

  it("returns null (via outer catch) when invokeLLM throws", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("network blew up"));
    const result = await classifyAndExtractChatLog(baseParams);
    expect(result).toBeNull();
  });

  it("returns null immediately for empty/whitespace-only input text without calling the LLM", async () => {
    const result = await classifyAndExtractChatLog({ ...baseParams, text: "   " });
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });
});
