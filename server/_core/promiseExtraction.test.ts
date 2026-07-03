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
// b) buildPromiseRows (pure)
// ────────────────────────────────────────────────────────────────────────

describe("buildPromiseRows", () => {
  const opts = { customerProfileId: 42, customOrderId: 7, sourceInteractionId: 999 };

  it("resolves dueDate correctly when rawDateText parses (via resolveEventDate)", () => {
    // "7/1" with no year, evaluated against todayLA 2026-07-03 — resolveEventDate's
    // "cannot be from the future" rule keeps this in the CURRENT year since 7/1
    // is on-or-before today's 7/3 (a rawDateText later than today would roll back
    // a year instead, which is exercised in chatLogImport.test.ts already).
    const rows = buildPromiseRows(
      [{ promiseText: "週五可以取件", rawDateText: "7/1" }],
      TODAY_LA,
      opts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe("2026-07-01");
    expect(rows[0].promiseText).toBe("週五可以取件");
    expect(rows[0].rawDateText).toBe("7/1");
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
