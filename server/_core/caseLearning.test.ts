/**
 * caseLearning 測試 — customer-cockpit Phase5「學習閉環」。
 *
 * 覆蓋:
 *   a. extractCaseLesson — finish_reason length / JSON 解析失敗 / invokeLLM
 *      拋例外 / 正常萃取 / hasLesson:false 誠實回應。
 *   b. buildCaseLearningRow — 純函式:hasLesson false 或 lesson 空 → null。
 *   c. distillCaseLearning — 查重短路 / order 不存在 / 非終態擋下 / 正常路徑
 *      insert / DB 拋例外被吃掉。
 *   d. formatCaseLearningsBlock / getCaseLearningsForProfiles — 空陣列 → ""、
 *      無進行中訂單 → []、DB 掛掉 degrade。
 *   e. filterUndistilledOrderIds / runCaseLearningBacklogScan — 查重過濾 +
 *      批次協調。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvokeLLM, mockDb, selectChain, insertMock } = vi.hoisted(() => {
  const mockInvokeLLM = vi.fn();
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
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
  caseLearnings: {
    id: "id",
    caseType: "caseType",
    destination: "destination",
    lesson: "lesson",
    sourceOrderId: "sourceOrderId",
    createdAt: "createdAt",
  },
  customOrders: {
    id: "id",
    title: "title",
    category: "category",
    destination: "destination",
    status: "status",
    customerProfileId: "customerProfileId",
    updatedAt: "updatedAt",
  },
  customerInteractions: {
    content: "content",
    contentSummary: "contentSummary",
    customOrderId: "customOrderId",
    createdAt: "createdAt",
  },
  customerDocuments: {
    fileName: "fileName",
    customOrderId: "customOrderId",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => ({ _op: "eq", args: a })),
  and: vi.fn((...a: unknown[]) => ({ _op: "and", args: a })),
  inArray: vi.fn((...a: unknown[]) => ({ _op: "inArray", args: a })),
  notInArray: vi.fn((...a: unknown[]) => ({ _op: "notInArray", args: a })),
  gte: vi.fn((...a: unknown[]) => ({ _op: "gte", args: a })),
  desc: vi.fn((...a: unknown[]) => ({ _op: "desc", args: a })),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import {
  extractCaseLesson,
  buildCaseLearningRow,
  distillCaseLearning,
  formatCaseLearningsBlock,
  getCaseLearningsForProfiles,
  buildCaseLearningsContextBlock,
  filterUndistilledOrderIds,
  runCaseLearningBacklogScan,
} from "./caseLearning";

beforeEach(() => {
  vi.clearAllMocks();
  selectChain.from.mockReturnThis();
  selectChain.where.mockReturnThis();
  selectChain.orderBy.mockReturnThis();
  selectChain.limit.mockResolvedValue([]);
  insertMock.mockResolvedValue(undefined);
});

// ────────────────────────────────────────────────────────────────────────
// a) extractCaseLesson
// ────────────────────────────────────────────────────────────────────────

describe("extractCaseLesson", () => {
  const baseInput = {
    caseType: "quote",
    destination: "北海道",
    title: "某案",
    status: "completed" as const,
    interactionSummaries: ["客人詢問雪祭行程", "報價後三天內成交"],
    documentNames: ["行程表.pdf"],
  };

  it("abandons extraction and returns null when finish_reason is 'length'", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: "{}" }, finish_reason: "length" }],
    });
    const result = await extractCaseLesson(baseInput);
    expect(result).toBeNull();
  });

  it("returns null when the LLM response is not valid JSON", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: "not json {{{" }, finish_reason: "stop" }],
    });
    const result = await extractCaseLesson(baseInput);
    expect(result).toBeNull();
  });

  it("returns null (caught by the outer try/catch) when invokeLLM throws", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("network blip"));
    const result = await extractCaseLesson(baseInput);
    expect(result).toBeNull();
  });

  it("extracts a lesson when hasLesson:true", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              hasLesson: true,
              lesson: "某 12 月北海道家庭案:雪祭期間飯店要提前 2 個月訂,不然只剩郊區。",
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const result = await extractCaseLesson(baseInput);
    expect(result).toEqual({
      hasLesson: true,
      lesson: "某 12 月北海道家庭案:雪祭期間飯店要提前 2 個月訂,不然只剩郊區。",
    });
  });

  it("honestly returns hasLesson:false when there's nothing worth recording (not a failure)", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ hasLesson: false, lesson: null }) }, finish_reason: "stop" },
      ],
    });
    const result = await extractCaseLesson(baseInput);
    expect(result).toEqual({ hasLesson: false, lesson: null });
  });

  it("returns null when hasLesson:true but lesson is missing/empty (malformed output)", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ hasLesson: true, lesson: "  " }) }, finish_reason: "stop" },
      ],
    });
    const result = await extractCaseLesson(baseInput);
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// b) buildCaseLearningRow (pure)
// ────────────────────────────────────────────────────────────────────────

describe("buildCaseLearningRow", () => {
  const opts = { caseType: "quote", destination: "北海道", sourceOrderId: 42 };

  it("builds a row when hasLesson:true with a lesson", () => {
    const row = buildCaseLearningRow({ hasLesson: true, lesson: "教訓文字" }, opts);
    expect(row).toEqual({
      caseType: "quote",
      destination: "北海道",
      lesson: "教訓文字",
      sourceOrderId: 42,
    });
  });

  it("returns null when hasLesson:false", () => {
    expect(buildCaseLearningRow({ hasLesson: false, lesson: null }, opts)).toBeNull();
  });

  it("returns null when hasLesson:true but lesson is null (defensive)", () => {
    expect(buildCaseLearningRow({ hasLesson: true, lesson: null }, opts)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// c) distillCaseLearning (DB coordinator)
// ────────────────────────────────────────────────────────────────────────

describe("distillCaseLearning", () => {
  it("dedup hit: sourceOrderId already distilled → distilled:false, LLM never called", async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 1 }]); // existing caseLearnings row
    const result = await distillCaseLearning(42);
    expect(result).toEqual({ distilled: false, reason: "already_distilled" });
    expect(mockInvokeLLM).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("order not found → distilled:false, no LLM call", async () => {
    selectChain.limit
      .mockResolvedValueOnce([]) // dedup miss
      .mockResolvedValueOnce([]); // order lookup miss
    const result = await distillCaseLearning(999);
    expect(result).toEqual({ distilled: false, reason: "order_not_found" });
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("order still not terminal (defensive re-check) → distilled:false, no LLM call", async () => {
    selectChain.limit
      .mockResolvedValueOnce([]) // dedup miss
      .mockResolvedValueOnce([
        { id: 42, title: "x", category: "quote", destination: "北海道", status: "confirmed" },
      ]);
    const result = await distillCaseLearning(42);
    expect(result).toEqual({ distilled: false, reason: "not_terminal" });
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("normal path: dedup miss + terminal order → extracts + inserts", async () => {
    selectChain.limit
      .mockResolvedValueOnce([]) // dedup miss
      .mockResolvedValueOnce([
        { id: 42, title: "某案", category: "quote", destination: "北海道", status: "completed" },
      ])
      .mockResolvedValueOnce([{ content: "訂了雪祭行程", contentSummary: null }]) // interactions
      .mockResolvedValueOnce([{ fileName: "行程表.pdf" }]); // docs
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ hasLesson: true, lesson: "教訓文字" }) },
          finish_reason: "stop",
        },
      ],
    });
    const result = await distillCaseLearning(42);
    expect(result).toEqual({ distilled: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toEqual({
      caseType: "quote",
      destination: "北海道",
      lesson: "教訓文字",
      sourceOrderId: 42,
    });
  });

  it("extraction returns hasLesson:false → distilled:false, no_lesson, no insert", async () => {
    selectChain.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 42, title: "某案", category: "quote", destination: "北海道", status: "cancelled" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockInvokeLLM.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ hasLesson: false, lesson: null }) }, finish_reason: "stop" },
      ],
    });
    const result = await distillCaseLearning(42);
    expect(result).toEqual({ distilled: false, reason: "no_lesson" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("DB throwing anywhere is swallowed → distilled:false, never throws", async () => {
    selectChain.limit.mockRejectedValueOnce(new Error("db down"));
    await expect(distillCaseLearning(42)).resolves.toEqual({ distilled: false, reason: "error" });
  });
});

// ────────────────────────────────────────────────────────────────────────
// d) formatCaseLearningsBlock / getCaseLearningsForProfiles (injection side)
// ────────────────────────────────────────────────────────────────────────

describe("formatCaseLearningsBlock", () => {
  it("returns empty string for an empty lessons array (誠實邊界:教訓庫空,一個字都不注入)", () => {
    expect(formatCaseLearningsBlock([])).toBe("");
  });

  it("returns empty string when every lesson is blank/whitespace", () => {
    expect(formatCaseLearningsBlock(["  ", ""])).toBe("");
  });

  it("formats non-empty lessons with the internal-reference header", () => {
    const block = formatCaseLearningsBlock(["教訓一", "教訓二"]);
    expect(block).toContain("【同類案過往教訓(內部參考)】");
    expect(block).toContain("教訓一");
    expect(block).toContain("教訓二");
  });
});

describe("getCaseLearningsForProfiles", () => {
  it("returns [] immediately for an empty profileIds array (no query issued)", async () => {
    const result = await getCaseLearningsForProfiles([]);
    expect(result).toEqual([]);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns [] when the customer has no in-progress order", async () => {
    selectChain.limit.mockResolvedValueOnce([]); // no open order
    const result = await getCaseLearningsForProfiles([42]);
    expect(result).toEqual([]);
  });

  it("returns [] when the open order has no category (nothing to match on)", async () => {
    selectChain.limit.mockResolvedValueOnce([{ category: null, destination: "北海道" }]);
    const result = await getCaseLearningsForProfiles([42]);
    expect(result).toEqual([]);
  });

  it("returns matching lessons (up to 3) when an in-progress order matches", async () => {
    selectChain.limit
      .mockResolvedValueOnce([{ category: "quote", destination: "北海道" }])
      .mockResolvedValueOnce([{ lesson: "教訓一" }, { lesson: "教訓二" }]);
    const result = await getCaseLearningsForProfiles([42]);
    expect(result).toEqual(["教訓一", "教訓二"]);
  });

  it("degrades to [] when the DB throws (chat continues without it)", async () => {
    selectChain.limit.mockRejectedValueOnce(new Error("db down"));
    await expect(getCaseLearningsForProfiles([42])).resolves.toEqual([]);
  });
});

describe("buildCaseLearningsContextBlock", () => {
  it("composes lookup + format into one call", async () => {
    selectChain.limit
      .mockResolvedValueOnce([{ category: "quote", destination: "北海道" }])
      .mockResolvedValueOnce([{ lesson: "教訓文字" }]);
    const block = await buildCaseLearningsContextBlock([42]);
    expect(block).toContain("教訓文字");
  });

  it("returns '' end to end when there's nothing to inject", async () => {
    const block = await buildCaseLearningsContextBlock([]);
    expect(block).toBe("");
  });
});

// ────────────────────────────────────────────────────────────────────────
// e) filterUndistilledOrderIds (pure) / runCaseLearningBacklogScan
// ────────────────────────────────────────────────────────────────────────

describe("filterUndistilledOrderIds", () => {
  it("filters out ids already in the distilled set", () => {
    expect(filterUndistilledOrderIds([1, 2, 3], new Set([2]))).toEqual([1, 3]);
  });

  it("returns everything when the distilled set is empty", () => {
    expect(filterUndistilledOrderIds([1, 2, 3], new Set())).toEqual([1, 2, 3]);
  });

  it("returns empty when every candidate is already distilled", () => {
    expect(filterUndistilledOrderIds([1, 2], new Set([1, 2]))).toEqual([]);
  });
});

describe("runCaseLearningBacklogScan", () => {
  it("returns all-zero when there are no completed/cancelled orders in the window", async () => {
    selectChain.limit.mockResolvedValue([]);
    selectChain.where.mockReturnValueOnce(Promise.resolve([]));
    const result = await runCaseLearningBacklogScan(7);
    expect(result).toEqual({ scanned: 0, distilled: 0, skipped: 0 });
  });

  it("degrades to all-zero when the DB throws", async () => {
    mockDb.select.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    const result = await runCaseLearningBacklogScan(7);
    expect(result).toEqual({ scanned: 0, distilled: 0, skipped: 0 });
  });
});
