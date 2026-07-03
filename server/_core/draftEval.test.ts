/**
 * draftEval 測試 — customer-cockpit Phase3 3b「月度草稿誠實度評分」。
 *
 * 覆蓋:
 *   c. aggregateDraftEvalScores — 純函式:全部評審都沒問題 / 只有一個評審標記
 *      某宗罪也算命中 / 維度分平均值計算正確且四捨五入正確。
 *   parseLastMonthScore — 純函式:正確格式抓數字 / 格式不對或空字串回 null /
 *      多節 markdown 抓最新一節不是第一節。
 *   a. selectEvalSampleCustomers — mock db,測 30 天篩選 + 上限 10 位。
 *   d. runMonthlyDraftEval — mock 掉 runInquiryAgent/invokeLLM/檔案讀寫:
 *      單一客人評分失敗不影響其餘客人跑完、劣化偵測正確觸發 high priority、
 *      agentMessages 正確寫入。
 *   絕無寄信路徑 — 明確斷言 sendEscalationReply/sendAdminInquiryReply 全程
 *   not.toHaveBeenCalled。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockInvokeLLM,
  mockRunInquiryAgent,
  mockDb,
  selectChain,
  insertMock,
  mockSendEscalationReply,
  mockSendAdminInquiryReply,
  mockReadFile,
  mockWriteFile,
  mockMkdir,
} = vi.hoisted(() => {
  const mockInvokeLLM = vi.fn();
  const mockRunInquiryAgent = vi.fn();
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertMock = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue({ values: insertMock }),
  };
  const mockSendEscalationReply = vi.fn();
  const mockSendAdminInquiryReply = vi.fn();
  const mockReadFile = vi.fn().mockResolvedValue("");
  const mockWriteFile = vi.fn().mockResolvedValue(undefined);
  const mockMkdir = vi.fn().mockResolvedValue(undefined);
  return {
    mockInvokeLLM,
    mockRunInquiryAgent,
    mockDb,
    selectChain,
    insertMock,
    mockSendEscalationReply,
    mockSendAdminInquiryReply,
    mockReadFile,
    mockWriteFile,
    mockMkdir,
  };
});

vi.mock("./llm", () => ({ invokeLLM: mockInvokeLLM }));
vi.mock("../agents/autonomous/inquiryAgent", () => ({
  runInquiryAgent: mockRunInquiryAgent,
}));
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("../../drizzle/schema", () => ({
  customerInteractions: {
    id: "id",
    customerProfileId: "customerProfileId",
    createdAt: "createdAt",
    direction: "direction",
    content: "content",
  },
  customerProfiles: {
    id: "id",
    email: "email",
    name: "name",
    preferredLanguage: "preferredLanguage",
    communicationStyle: "communicationStyle",
    familyContext: "familyContext",
    aiNotes: "aiNotes",
    keyFacts: "keyFacts",
    preferences: "preferences",
    vipScore: "vipScore",
    bookingCount: "bookingCount",
  },
  agentMessages: { id: "id" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => a),
  sql: Object.assign(
    vi.fn((...a: unknown[]) => a),
    { raw: vi.fn() },
  ),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
vi.mock("fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));
// 絕無寄信路徑斷言用的 mock — 這兩個函式在 draftEval 的任何路徑都不應被呼叫。
vi.mock("./escalationBox", () => ({ sendEscalationReply: mockSendEscalationReply }));
vi.mock("./inquiryReply", () => ({ sendAdminInquiryReply: mockSendAdminInquiryReply }));

import {
  aggregateDraftEvalScores,
  parseLastMonthScore,
  selectEvalSampleCustomers,
  runMonthlyDraftEval,
  type JudgeRawResult,
} from "./draftEval";

beforeEach(() => {
  vi.clearAllMocks();
  selectChain.from.mockReturnThis();
  selectChain.where.mockReturnThis();
  selectChain.orderBy.mockReturnThis();
  selectChain.groupBy.mockReturnThis();
  selectChain.limit.mockResolvedValue([]);
  insertMock.mockResolvedValue([{ insertId: 1 }]);
  mockReadFile.mockResolvedValue("");
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
});

function judge(overrides: Partial<JudgeRawResult> = {}): JudgeRawResult {
  return {
    accuracyScore: 9,
    toneScore: 9,
    completenessScore: 9,
    overbold: false,
    repeatsFulfilledPromise: false,
    wrongRecipient: false,
    notes: "",
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────
// aggregateDraftEvalScores (pure)
// ────────────────────────────────────────────────────────────────────────

describe("aggregateDraftEvalScores", () => {
  it("all judges clean → all three flags false", () => {
    const result = aggregateDraftEvalScores([judge(), judge(), judge()]);
    expect(result.overbold).toBe(false);
    expect(result.repeatsFulfilledPromise).toBe(false);
    expect(result.wrongRecipient).toBe(false);
  });

  it("only one judge flags overbold → still counts as a hit (not majority vote)", () => {
    const result = aggregateDraftEvalScores([
      judge({ overbold: true }),
      judge(),
      judge(),
    ]);
    expect(result.overbold).toBe(true);
  });

  it("only one judge flags repeatsFulfilledPromise → still counts as a hit", () => {
    const result = aggregateDraftEvalScores([
      judge(),
      judge({ repeatsFulfilledPromise: true }),
      judge(),
    ]);
    expect(result.repeatsFulfilledPromise).toBe(true);
  });

  it("only one judge flags wrongRecipient → still counts as a hit", () => {
    const result = aggregateDraftEvalScores([
      judge(),
      judge(),
      judge({ wrongRecipient: true }),
    ]);
    expect(result.wrongRecipient).toBe(true);
  });

  it("averages dimension scores and rounds to 1 decimal place", () => {
    const result = aggregateDraftEvalScores([
      judge({ accuracyScore: 10, toneScore: 8, completenessScore: 9 }),
      judge({ accuracyScore: 9, toneScore: 8, completenessScore: 8 }),
      judge({ accuracyScore: 8, toneScore: 8, completenessScore: 7 }),
    ]);
    // accuracy: (10+9+8)/3 = 9.0, tone: 8.0, completeness: (9+8+7)/3 = 8.0
    expect(result.accuracyScore).toBe(9);
    expect(result.toneScore).toBe(8);
    expect(result.completenessScore).toBe(8);
    // overall: avg(9, 8, 8) = 8.333... → rounds to 8.3
    expect(result.overallScore).toBe(8.3);
  });

  it("empty judge array → zeroed score, no flags", () => {
    const result = aggregateDraftEvalScores([]);
    expect(result.overallScore).toBe(0);
    expect(result.judgeCount).toBe(0);
    expect(result.overbold).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// parseLastMonthScore (pure)
// ────────────────────────────────────────────────────────────────────────

describe("parseLastMonthScore", () => {
  it("extracts the score from a single well-formed section", () => {
    const md = "## 2026-06-01 月度評分\n\n**綜合分:8.7/10**\n\n三宗罪計數:...\n";
    expect(parseLastMonthScore(md)).toBe(8.7);
  });

  it("returns null for empty string", () => {
    expect(parseLastMonthScore("")).toBeNull();
  });

  it("returns null when the format doesn't match", () => {
    expect(parseLastMonthScore("no score here at all")).toBeNull();
  });

  it("extracts the LATEST section's score, not the first, from multi-section markdown", () => {
    const md = [
      "## 2026-05-01 月度評分",
      "",
      "**綜合分:7.2/10**",
      "",
      "## 2026-06-01 月度評分",
      "",
      "**綜合分:8.9/10**",
      "",
    ].join("\n");
    expect(parseLastMonthScore(md)).toBe(8.9);
  });
});

// ────────────────────────────────────────────────────────────────────────
// selectEvalSampleCustomers (mock db)
// ────────────────────────────────────────────────────────────────────────

describe("selectEvalSampleCustomers", () => {
  it("returns customers from the (mocked) 30-day query, capped by the mocked limit", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      customerProfileId: i + 1,
      lastAt: new Date(),
    }));
    selectChain.limit.mockResolvedValue(rows);
    const result = await selectEvalSampleCustomers();
    expect(result).toHaveLength(10);
    expect(selectChain.limit).toHaveBeenCalledWith(10);
    expect(result[0].profileId).toBe(1);
  });

  it("filters out rows with a null customerProfileId", async () => {
    selectChain.limit.mockResolvedValue([
      { customerProfileId: 1, lastAt: new Date() },
      { customerProfileId: null, lastAt: new Date() },
    ]);
    const result = await selectEvalSampleCustomers();
    expect(result).toHaveLength(1);
  });

  it("returns an empty array when db is unavailable", async () => {
    const { getDb } = await import("../db");
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await selectEvalSampleCustomers();
    expect(result).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// runMonthlyDraftEval (coordinator)
// ────────────────────────────────────────────────────────────────────────

function mockJudgeLLMResponse(r: JudgeRawResult) {
  return {
    choices: [{ message: { content: JSON.stringify(r) }, finish_reason: "stop" }],
  };
}

describe("runMonthlyDraftEval", () => {
  it("one customer's eval failing does not prevent the others from completing", async () => {
    // Sample selection: two customers.
    selectChain.limit.mockImplementation(async () => {
      // First call (sample select) returns 2 customers; subsequent calls
      // (per-customer profile/interactions lookups) return varying shapes.
      return [];
    });

    // customer profile + interactions lookups are all driven off the same
    // mocked db chain; we special-case by call order using mockImplementationOnce.
    let selectCallCount = 0;
    mockDb.select.mockImplementation(() => {
      selectCallCount++;
      return selectChain;
    });

    selectChain.limit
      // 1) selectEvalSampleCustomers
      .mockResolvedValueOnce([
        { customerProfileId: 1, lastAt: new Date() },
        { customerProfileId: 2, lastAt: new Date() },
      ])
      // 2) profile lookup customer 1 → throws to simulate failure
      .mockRejectedValueOnce(new Error("profile lookup failed"))
      // customer 2 path: profile lookup
      .mockResolvedValueOnce([{ id: 2, email: "c2@example.com", name: "Customer Two" }])
      // customer 2 path: interactions lookup
      .mockResolvedValueOnce([
        { direction: "inbound", content: "請問明年五月台灣團還有位子嗎", contentSummary: null, sentiment: null, createdAt: new Date() },
      ]);

    mockRunInquiryAgent.mockResolvedValue({ draftReply: "您好,還有名額喔" });
    mockInvokeLLM.mockResolvedValue(mockJudgeLLMResponse(judge()));

    const report = await runMonthlyDraftEval();

    expect(report).not.toBeNull();
    expect(report!.sampleSize).toBe(1); // only customer 2 succeeded
    expect(report!.perCustomer[0].profileId).toBe(2);
  });

  it("degrade detection triggers high priority when this month drops >= 1 point vs last month", async () => {
    selectChain.limit
      .mockResolvedValueOnce([{ customerProfileId: 5, lastAt: new Date() }])
      .mockResolvedValueOnce([{ id: 5, email: "c5@example.com", name: "C5" }])
      .mockResolvedValueOnce([
        { direction: "inbound", content: "哈囉請問報價", contentSummary: null, sentiment: null, createdAt: new Date() },
      ]);
    mockRunInquiryAgent.mockResolvedValue({ draftReply: "您好" });
    // Score this month low (accuracy/tone/completeness = 5 → overall 5.0)
    mockInvokeLLM.mockResolvedValue(
      mockJudgeLLMResponse(judge({ accuracyScore: 5, toneScore: 5, completenessScore: 5 })),
    );
    mockReadFile.mockResolvedValue("## 2026-06-01 月度評分\n\n**綜合分:8.0/10**\n");

    const report = await runMonthlyDraftEval();

    expect(report).not.toBeNull();
    expect(report!.previousScore).toBe(8.0);
    expect(report!.degraded).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
    const insertedValues = insertMock.mock.calls[0][0];
    expect(insertedValues.priority).toBe("high");
    expect(insertedValues.messageType).toBe("digest");
  });

  it("writes an agentMessages card with priority normal when not degraded", async () => {
    selectChain.limit
      .mockResolvedValueOnce([{ customerProfileId: 9, lastAt: new Date() }])
      .mockResolvedValueOnce([{ id: 9, email: "c9@example.com", name: "C9" }])
      .mockResolvedValueOnce([
        { direction: "inbound", content: "哈囉", contentSummary: null, sentiment: null, createdAt: new Date() },
      ]);
    mockRunInquiryAgent.mockResolvedValue({ draftReply: "您好" });
    mockInvokeLLM.mockResolvedValue(mockJudgeLLMResponse(judge()));
    mockReadFile.mockResolvedValue(""); // no prior history → no degrade comparison

    const report = await runMonthlyDraftEval();

    expect(report!.degraded).toBe(false);
    expect(report!.previousScore).toBeNull();
    const insertedValues = insertMock.mock.calls[0][0];
    expect(insertedValues.priority).toBe("normal");
  });

  it("never calls any email-sending function anywhere in the flow (read-only eval)", async () => {
    selectChain.limit
      .mockResolvedValueOnce([{ customerProfileId: 3, lastAt: new Date() }])
      .mockResolvedValueOnce([{ id: 3, email: "c3@example.com", name: "C3" }])
      .mockResolvedValueOnce([
        { direction: "inbound", content: "你好", contentSummary: null, sentiment: null, createdAt: new Date() },
      ]);
    mockRunInquiryAgent.mockResolvedValue({ draftReply: "您好,收到了" });
    mockInvokeLLM.mockResolvedValue(mockJudgeLLMResponse(judge()));

    await runMonthlyDraftEval();

    expect(mockSendEscalationReply).not.toHaveBeenCalled();
    expect(mockSendAdminInquiryReply).not.toHaveBeenCalled();
  });
});
