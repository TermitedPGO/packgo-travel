/**
 * promiseExtraction 測試 — customer-cockpit Phase3 3a「承諾追蹤」。
 *
 * 覆蓋:
 *   a. extractPromisesFromEmail — finish_reason length / JSON parse 失敗 /
 *      invokeLLM 拋例外 / 正常抽出多個承諾 / 沒有承諾回空陣列。
 *   b. buildPromiseRows — 純函式:解得出來時 dueDate 正確、解不出來時 dueDate
 *      為 null 但承諾仍在陣列裡、customOrderId 傳 null 時正確帶入。
 *   c. recordPromisesForInteraction — 查重短路 / 正常路徑插入 / LLM 空陣列 /
 *      DB 拋例外被吃掉回 recorded:0。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvokeLLM, mockDb, selectChain, insertMock } = vi.hoisted(() => {
  const mockInvokeLLM = vi.fn();
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertMock = vi.fn().mockResolvedValue(undefined);
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue({ values: insertMock }),
  };
  return { mockInvokeLLM, mockDb, selectChain, insertMock };
});

vi.mock("./llm", () => ({ invokeLLM: mockInvokeLLM }));
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("../../drizzle/schema", () => ({
  customerPromises: {
    id: "id",
    sourceInteractionId: "sourceInteractionId",
    customerProfileId: "customerProfileId",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => a),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import {
  extractPromisesFromEmail,
  buildPromiseRows,
  recordPromisesForInteraction,
  stripDateModifierSuffix,
} from "./promiseExtraction";

beforeEach(() => {
  vi.clearAllMocks();
  selectChain.from.mockReturnThis();
  selectChain.where.mockReturnThis();
  selectChain.limit.mockResolvedValue([]);
  insertMock.mockResolvedValue(undefined);
});

const TODAY_LA = "2026-07-03";

// ────────────────────────────────────────────────────────────────────────
// a) extractPromisesFromEmail
// ────────────────────────────────────────────────────────────────────────

describe("extractPromisesFromEmail", () => {
  it("abandons extraction and returns null when finish_reason is 'length'", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: "{}" }, finish_reason: "length" }],
    });
    const result = await extractPromisesFromEmail("週五可以取件", TODAY_LA);
    expect(result).toBeNull();
  });

  it("returns null when the LLM response is not valid JSON", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: "not json at all {{{" }, finish_reason: "stop" }],
    });
    const result = await extractPromisesFromEmail("週五可以取件", TODAY_LA);
    expect(result).toBeNull();
  });

  it("returns null (caught by the outer try/catch) when invokeLLM throws", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("network blip"));
    const result = await extractPromisesFromEmail("週五可以取件", TODAY_LA);
    expect(result).toBeNull();
  });

  it("extracts multiple promises with promiseText + rawDateText", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              promises: [
                { promiseText: "週五可以取件", rawDateText: "週五" },
                { promiseText: "明天會發報價給您", rawDateText: "明天" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await extractPromisesFromEmail(
      "週五可以取件,明天會發報價給您",
      TODAY_LA,
    );
    expect(result).toEqual([
      { promiseText: "週五可以取件", rawDateText: "週五" },
      { promiseText: "明天會發報價給您", rawDateText: "明天" },
    ]);
  });

  it("returns an empty array when no commitments are found (honest, not a failure)", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ promises: [] }) }, finish_reason: "stop" },
      ],
    });
    const result = await extractPromisesFromEmail("謝謝您的耐心等候", TODAY_LA);
    expect(result).toEqual([]);
  });

  it("empty body short-circuits to an empty array without calling the LLM", async () => {
    const result = await extractPromisesFromEmail("", TODAY_LA);
    expect(result).toEqual([]);
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────
// stripDateModifierSuffix (pure) — 2026-07-03 P1 prod 修復 layer 2 防線
// ────────────────────────────────────────────────────────────────────────

describe("stripDateModifierSuffix", () => {
  it("strips 之前 suffix", () => {
    expect(stripDateModifierSuffix("7/8之前")).toBe("7/8");
  });

  it("strips 之前 suffix with a space before it", () => {
    expect(stripDateModifierSuffix("7/8 之前")).toBe("7/8");
  });

  it("strips a trailing parenthetical weekday annotation", () => {
    expect(stripDateModifierSuffix("今天(星期五)")).toBe("今天");
  });

  it("strips 以前/左右/前後 suffixes", () => {
    expect(stripDateModifierSuffix("7月10日以前")).toBe("7月10日");
    expect(stripDateModifierSuffix("7/10左右")).toBe("7/10");
    expect(stripDateModifierSuffix("7/10前後")).toBe("7/10");
  });

  it("leaves a plain date untouched", () => {
    expect(stripDateModifierSuffix("7/10")).toBe("7/10");
  });

  it("only strips the trailing modifier, not text in the middle", () => {
    expect(stripDateModifierSuffix("週五之前")).toBe("週五");
  });

  it("2026-07-03 對抗審查 P1修復:strips a STACKED parenthetical + trailing modifier ('7/8(星期三)之前')", () => {
    // A single pass used to fail here: stripping the trailing paren requires
    // the string to END at ")", but "之前" comes after it, so that pass no-ops;
    // the modifier-strip pass then only removes "之前", leaving "7/8(星期三)"
    // un-stripped and unparseable. The loop must converge to "7/8".
    expect(stripDateModifierSuffix("7/8(星期三)之前")).toBe("7/8");
  });

  it("strips bare 前/後 suffixes (not just the compound 之前/前後 forms)", () => {
    expect(stripDateModifierSuffix("7/8前")).toBe("7/8");
    expect(stripDateModifierSuffix("7/10後")).toBe("7/10");
  });

  it("strips leading 大概/最晚/預計-style hedging words", () => {
    expect(stripDateModifierSuffix("大概7/8")).toBe("7/8");
    expect(stripDateModifierSuffix("最晚7/10")).toBe("7/10");
    expect(stripDateModifierSuffix("預計明天")).toBe("明天");
  });

  it("strips trailing colloquial particles (吧/囉)", () => {
    expect(stripDateModifierSuffix("明天之前吧")).toBe("明天");
    expect(stripDateModifierSuffix("7/8囉")).toBe("7/8");
  });

  it("returns an empty string when the LLM extracted only a modifier with no date body (honest, not a crash)", () => {
    expect(stripDateModifierSuffix("之前")).toBe("");
    expect(stripDateModifierSuffix("(星期五)")).toBe("");
  });
});

// ────────────────────────────────────────────────────────────────────────
// b) buildPromiseRows (pure)
// ────────────────────────────────────────────────────────────────────────

describe("buildPromiseRows", () => {
  const opts = { customerProfileId: 42, customOrderId: 7, sourceInteractionId: 999 };

  it("prod fixture (customerPromises id 1): '7/8之前' resolves through the strip+resolve pipeline", () => {
    const rows = buildPromiseRows(
      [{ promiseText: "7/8之前可以取件", rawDateText: "7/8之前" }],
      "2026-07-03",
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe("2026-07-08");
    // Original rawDateText is preserved verbatim for display — only the
    // resolveEventDate INPUT is stripped, not the stored field.
    expect(rows[0].rawDateText).toBe("7/8之前");
  });

  it("prod fixture (customerPromises id 2): '今天(星期五)' resolves to todayLA", () => {
    const rows = buildPromiseRows(
      [{ promiseText: "今天(星期五)會處理", rawDateText: "今天(星期五)" }],
      "2026-07-03",
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe("2026-07-03");
    expect(rows[0].rawDateText).toBe("今天(星期五)");
  });

  it("rawDateText that strips down to empty (LLM extracted only a modifier, no date body) → dueDate:null, no crash", () => {
    const rows = buildPromiseRows(
      [{ promiseText: "之前可以取件", rawDateText: "之前" }],
      TODAY_LA,
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBeNull();
    expect(rows[0].rawDateText).toBe("之前");
  });

  it("resolves dueDate correctly when rawDateText parses — a near-future date within the same year (via resolveEventDate bias:future)", () => {
    // "7/10" with no year, evaluated against todayLA 2026-07-03 — a promise due
    // date is forward-looking (bias:"future"), so a date AFTER today stays in
    // the CURRENT year (unlike chatLogImport's retrospective default, which
    // would roll this back to last year — exercised separately in
    // chatLogImport.test.ts).
    const rows = buildPromiseRows(
      [{ promiseText: "週五可以取件", rawDateText: "7/10" }],
      TODAY_LA,
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe("2026-07-10");
    expect(rows[0].promiseText).toBe("週五可以取件");
    expect(rows[0].rawDateText).toBe("7/10");
  });

  it("rolls FORWARD to next year when the naive current-year date already passed (bias:future's mirror of chatLogImport's roll-BACK rule)", () => {
    // "7/1" is two days before todayLA 2026-07-03 — a promise can't already be
    // due in the past at the moment it's extracted, so this must mean next
    // year's July 1st, not this year's (which already passed).
    const rows = buildPromiseRows(
      [{ promiseText: "週五可以取件", rawDateText: "7/1" }],
      TODAY_LA,
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe("2027-07-01");
  });

  it("keeps the current year when the date is exactly today (boundary, not treated as past)", () => {
    const rows = buildPromiseRows(
      [{ promiseText: "今天可以取件", rawDateText: "7/3" }],
      TODAY_LA,
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe("2026-07-03");
  });

  it("keeps the promise with dueDate:null when rawDateText can't be resolved", () => {
    const rows = buildPromiseRows(
      [{ promiseText: "會盡快處理", rawDateText: "快點" }],
      TODAY_LA,
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBeNull();
  });

  it("keeps the promise with dueDate:null when rawDateText is null", () => {
    const rows = buildPromiseRows(
      [{ promiseText: "會盡快處理", rawDateText: null }],
      TODAY_LA,
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBeNull();
  });

  it("passes customOrderId:null through correctly", () => {
    const rows = buildPromiseRows(
      [{ promiseText: "週五可以取件", rawDateText: "7/10" }],
      TODAY_LA,
      { customerProfileId: 42, customOrderId: null, sourceInteractionId: 999 },
    );
    expect(rows[0].customOrderId).toBeNull();
  });

  it("carries customerProfileId and sourceInteractionId through unchanged", () => {
    const rows = buildPromiseRows(
      [{ promiseText: "週五可以取件", rawDateText: "7/10" }],
      TODAY_LA,
      opts,
    );
    expect(rows[0].customerProfileId).toBe(42);
    expect(rows[0].sourceInteractionId).toBe(999);
  });

  it("returns an empty array for an empty input array", () => {
    expect(buildPromiseRows([], TODAY_LA, opts)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// c) recordPromisesForInteraction (DB coordinator)
// ────────────────────────────────────────────────────────────────────────

describe("recordPromisesForInteraction", () => {
  const baseParams = {
    sourceInteractionId: 999,
    customerProfileId: 42,
    customOrderId: null,
    emailBody: "週五可以取件",
    todayLA: TODAY_LA,
  };

  it("dedup hit: sourceInteractionId already recorded → recorded:0, LLM never called", async () => {
    selectChain.limit.mockResolvedValue([{ id: 1 }]);
    const result = await recordPromisesForInteraction(baseParams);
    expect(result).toEqual({ recorded: 0 });
    expect(mockInvokeLLM).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("normal path: calls the LLM and inserts the correct row count", async () => {
    selectChain.limit.mockResolvedValue([]); // no dup
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              promises: [
                { promiseText: "週五可以取件", rawDateText: "週五" },
                { promiseText: "明天會發報價", rawDateText: "明天" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await recordPromisesForInteraction(baseParams);
    expect(result).toEqual({ recorded: 2 });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
  });

  it("LLM returns an empty array → recorded:0, no insert", async () => {
    selectChain.limit.mockResolvedValue([]);
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ promises: [] }) }, finish_reason: "stop" }],
    });
    const result = await recordPromisesForInteraction(baseParams);
    expect(result).toEqual({ recorded: 0 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("DB throwing on the dedup check is swallowed → recorded:0, never throws", async () => {
    selectChain.limit.mockRejectedValue(new Error("db down"));
    await expect(recordPromisesForInteraction(baseParams)).resolves.toEqual({ recorded: 0 });
  });

  it("DB throwing on insert is swallowed → recorded:0, never throws", async () => {
    selectChain.limit.mockResolvedValue([]);
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ promises: [{ promiseText: "x", rawDateText: null }] }) },
          finish_reason: "stop",
        },
      ],
    });
    insertMock.mockRejectedValue(new Error("insert failed"));
    await expect(recordPromisesForInteraction(baseParams)).resolves.toEqual({ recorded: 0 });
  });
});
