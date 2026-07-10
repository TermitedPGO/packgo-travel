/**
 * Tests for opsActions — focusing on the 4 new commandCenter action types.
 * Existing action types (sendCustomerEmail etc.) are already exercised via
 * manual testing; these tests cover the new integration surface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock finance producers/advisors (dynamically imported by the actions)
const mockProduceFinanceAlerts = vi.fn();
const mockAskFinanceAdvisor = vi.fn();
const mockGenerateTaxCsv = vi.fn();
const mockRunInquiryAgent = vi.fn();
const mockProduceInquiryReplyTask = vi.fn();
const mockGetInquiryById = vi.fn();
// getDb 走一個可控 mock(預設 resolve null,保既有 no_db 測試;cancelBooking 測試逐條覆寫)。
const mockGetDb = vi.fn();

vi.mock("./financeAlertProducer", () => ({
  produceFinanceAlerts: (...args: any[]) => mockProduceFinanceAlerts(...args),
}));

vi.mock("./financeAdvisor", () => ({
  askFinanceAdvisor: (...args: any[]) => mockAskFinanceAdvisor(...args),
}));

vi.mock("../../services/taxCsvService", () => ({
  generateTaxCsv: (...args: any[]) => mockGenerateTaxCsv(...args),
}));

vi.mock("./inquiryAgent", () => ({
  runInquiryAgent: (...args: any[]) => mockRunInquiryAgent(...args),
}));

vi.mock("./inquiryReplyProducer", () => ({
  produceInquiryReplyTask: (...args: any[]) => mockProduceInquiryReplyTask(...args),
}));

vi.mock("../../db", () => ({
  getInquiryById: (...args: any[]) => mockGetInquiryById(...args),
  getDb: (...args: any[]) => mockGetDb(...args),
}));

import { MySqlDialect } from "drizzle-orm/mysql-core";
import { bookings, tourDepartures } from "../../../drizzle/schema";
import {
  executeOpsAction,
  ActionTypeEnum,
  buildCancelAuditNote,
  cancelMessageSql,
} from "./opsActions";

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks 不重置 implementation → 顯式回預設 null(既有 no_db 測試靠這個)。
  mockGetDb.mockResolvedValue(null);
});

describe("ActionTypeEnum includes commandCenter types", () => {
  it("accepts runFinanceAlerts", () => {
    expect(ActionTypeEnum.safeParse("runFinanceAlerts").success).toBe(true);
  });
  it("accepts askFinanceAdvisor", () => {
    expect(ActionTypeEnum.safeParse("askFinanceAdvisor").success).toBe(true);
  });
  it("accepts produceInquiryReply", () => {
    expect(ActionTypeEnum.safeParse("produceInquiryReply").success).toBe(true);
  });
  it("accepts downloadTaxCsv", () => {
    expect(ActionTypeEnum.safeParse("downloadTaxCsv").success).toBe(true);
  });
  it("rejects unknown", () => {
    expect(ActionTypeEnum.safeParse("foobar").success).toBe(false);
  });
  // Existing types still accepted
  it("still accepts sendCustomerEmail", () => {
    expect(ActionTypeEnum.safeParse("sendCustomerEmail").success).toBe(true);
  });
});

describe("executeOpsAction — runFinanceAlerts", () => {
  it("returns ok with produced count", async () => {
    mockProduceFinanceAlerts.mockResolvedValue({ produced: 3 });
    const result = await executeOpsAction("runFinanceAlerts", {});
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("3");
    expect(result.details).toEqual({ produced: 3 });
  });

  it("handles error gracefully", async () => {
    mockProduceFinanceAlerts.mockRejectedValue(new Error("db down"));
    const result = await executeOpsAction("runFinanceAlerts", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("db down");
  });
});

describe("executeOpsAction — askFinanceAdvisor", () => {
  it("returns advisor answer in summary", async () => {
    mockAskFinanceAdvisor.mockResolvedValue("Your net profit is $4,400.");
    const result = await executeOpsAction("askFinanceAdvisor", {
      question: "net profit?",
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("$4,400");
  });

  it("truncates long answers in summary", async () => {
    mockAskFinanceAdvisor.mockResolvedValue("A".repeat(300));
    const result = await executeOpsAction("askFinanceAdvisor", {
      question: "test",
    });
    expect(result.ok).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(204); // 200 + "…"
  });

  it("validates question arg", async () => {
    const result = await executeOpsAction("askFinanceAdvisor", {});
    expect(result.ok).toBe(false);
  });
});

describe("executeOpsAction — produceInquiryReply", () => {
  it("returns ok with task details", async () => {
    mockGetInquiryById.mockResolvedValue({
      id: 42,
      subject: "Test inquiry",
      message: "I want to book a tour",
      customerEmail: "test@example.com",
      customerName: "Test User",
    });
    mockRunInquiryAgent.mockResolvedValue({
      draftReply: "Thank you for your interest!",
      classification: "new_inquiry",
      confidence: 0.9,
      urgency: "normal",
      intent: "booking inquiry",
      draftLanguage: "en",
    });
    mockProduceInquiryReplyTask.mockResolvedValue({ id: 100, riskLevel: "review" });

    const result = await executeOpsAction("produceInquiryReply", { inquiryId: 42 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("#42");
    expect(result.summary).toContain("#100");
  });

  it("returns error when inquiry not found", async () => {
    mockGetInquiryById.mockResolvedValue(null);
    const result = await executeOpsAction("produceInquiryReply", { inquiryId: 999 });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("999");
  });
});

describe("executeOpsAction — downloadTaxCsv", () => {
  it("returns ok with CSV metadata", async () => {
    mockGenerateTaxCsv.mockResolvedValue("Category,Jan,...\nIncome,1000,...");
    const result = await executeOpsAction("downloadTaxCsv", { year: 2026 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("2026");
    expect(result.details).toHaveProperty("filename", "packgo-schedule-c-2026.csv");
  });

  it("validates year range", async () => {
    const result = await executeOpsAction("downloadTaxCsv", { year: 2010 });
    expect(result.ok).toBe(false); // zod validation fails
  });
});

// ── PACK&GO Agent expansion (2026-06-01) ────────────────────────────────

const mockClassifyBatch = vi.fn();
const mockDraftReply = vi.fn();

vi.mock("../../services/accountingAgentService", () => ({
  classifyUncategorizedBatch: (...args: any[]) => mockClassifyBatch(...args),
}));

vi.mock("../../services/wechatAssistService", () => ({
  draftReply: (...args: any[]) => mockDraftReply(...args),
}));

describe("ActionTypeEnum includes expansion types", () => {
  it("accepts classifyBankTransactions", () => {
    expect(ActionTypeEnum.safeParse("classifyBankTransactions").success).toBe(true);
  });
  it("accepts draftWechatReply", () => {
    expect(ActionTypeEnum.safeParse("draftWechatReply").success).toBe(true);
  });
});

describe("executeOpsAction — classifyBankTransactions", () => {
  it("returns ok with classify results", async () => {
    mockClassifyBatch.mockResolvedValue({
      processed: 13,
      succeeded: 10,
      failed: 3,
      needsReviewCount: 4,
      byCategory: { cogs_tour: 5, transfer: 3, other_review: 2 },
    });
    const result = await executeOpsAction("classifyBankTransactions", { limit: 20 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("10");
    expect(result.details).toHaveProperty("processed", 13);
  });

  it("works with no args (default limit)", async () => {
    mockClassifyBatch.mockResolvedValue({
      processed: 0, succeeded: 0, failed: 0, needsReviewCount: 0, byCategory: {},
    });
    const result = await executeOpsAction("classifyBankTransactions", undefined);
    expect(result.ok).toBe(true);
  });

  it("handles error gracefully", async () => {
    mockClassifyBatch.mockRejectedValue(new Error("db down"));
    const result = await executeOpsAction("classifyBankTransactions", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("db down");
  });
});

describe("executeOpsAction — draftWechatReply", () => {
  it("returns ok with draft text", async () => {
    mockDraftReply.mockResolvedValue({
      draftText: "Hi there, thanks for your interest!",
      confidence: 85,
      detectedIntent: ["booking_inquiry"],
      messageId: null,
    });
    const result = await executeOpsAction("draftWechatReply", {
      customerName: "Test",
      incomingMessage: "I want to book a tour",
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Hi there");
  });

  it("validates required args", async () => {
    const result = await executeOpsAction("draftWechatReply", {});
    expect(result.ok).toBe(false);
  });

  it("handles service error", async () => {
    mockDraftReply.mockRejectedValue(new Error("LLM timeout"));
    const result = await executeOpsAction("draftWechatReply", {
      customerName: "X",
      incomingMessage: "Hello",
    });
    expect(result.ok).toBe(false);
  });
});

// ── gmail-full-thread-filing: 指名收客人 ─────────────────────────────────

describe("ActionTypeEnum includes collectCustomerThreads", () => {
  it("accepts collectCustomerThreads", () => {
    expect(ActionTypeEnum.safeParse("collectCustomerThreads").success).toBe(true);
  });
});

describe("executeOpsAction — collectCustomerThreads", () => {
  it("rejects a bad email arg (zod)", async () => {
    const result = await executeOpsAction("collectCustomerThreads", { email: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("degrades gracefully when the DB is unavailable", async () => {
    // ../../db getDb is mocked to resolve null in this file.
    const result = await executeOpsAction("collectCustomerThreads", { email: "eyoung@axt.com" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_db");
  });
});

// ── cancelBooking latent bug P1(Wave2,2026-07-09)─────────────────────────
//
// bug:`sql\`... '\n[cancelled by OpsAgent ${date}] ' ...\`` 把日期戳內插在未關閉的字串
// 常量中間 → drizzle 渲成 `'...OpsAgent ?] '`(? 卡引號裡)佔位對位破壞 → cancel 失敗;
// 且回傳無條件 ok:true + 固定「已取消·釋出座位」摘要,把失敗講成成功。
//
// 說明:doCancelBooking 全程 await(select→update→釋座 update),無 fire-and-forget 副作用,
// 不需要 vi.waitFor。仍照派工單要求單檔連跑 5 次證穩。

/** 可鏈式 fake db:select 回指定 booking 列;update 依 table 回 affectedRows,記錄更新過哪些 table。 */
function makeFakeDb(opts: { bookingRow: unknown | null; bookingUpdateAffected: number }) {
  const updatedTables: unknown[] = [];
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (opts.bookingRow ? [opts.bookingRow] : []) }) }),
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: async () => {
          updatedTables.push(table);
          if (table === bookings) return [{ affectedRows: opts.bookingUpdateAffected }];
          return [{ affectedRows: 1 }]; // tourDepartures 釋座,結果不被用
        },
      }),
    }),
    _updatedTables: updatedTables,
  };
}

const baseBooking = {
  id: 42,
  bookingStatus: "confirmed",
  departureId: 7,
  numberOfAdults: 2,
  numberOfChildrenWithBed: 0,
  numberOfChildrenNoBed: 1,
  customerName: "測試客",
  message: null,
};

describe("cancelMessageSql — 佔位符 regression(P1 bug 守門,舊寫法會紅)", () => {
  const dialect = new MySqlDialect();

  it("渲染後只有一個 `?`、佔位符數==綁定數、且沒有任何 `?` 落在字串字面內", () => {
    const { sql, params } = dialect.sqlToQuery(cancelMessageSql(bookings.message, "客人要求", "2026-07-09"));
    expect((sql.match(/\?/g) || []).length).toBe(1);
    expect((sql.match(/\?/g) || []).length).toBe(params.length);
    // 舊寫法 `'...OpsAgent ?] '` 會命中這個 regex(? 夾在單引號字串常量內);修法不會。
    expect(sql).not.toMatch(/'[^']*\?[^']*'/);
    // 綁定值是整條稽核字串(日期戳 + reason 都在裡面,不進 SQL 字面)
    expect(params).toEqual(["\n[cancelled by OpsAgent 2026-07-09] 客人要求"]);
  });

  it("buildCancelAuditNote 把日期戳與 reason 併成單一字串", () => {
    expect(buildCancelAuditNote("退團", "2026-01-01")).toBe("\n[cancelled by OpsAgent 2026-01-01] 退團");
  });
});

describe("executeOpsAction('cancelBooking') — transitioned 決定成敗,不再無條件假成功", () => {
  it("正常路徑:未取消 + 條件式更新命中(affectedRows>0)→ ok:true『已取消·釋出座位』且真的釋座", async () => {
    const db = makeFakeDb({ bookingRow: { ...baseBooking }, bookingUpdateAffected: 1 });
    mockGetDb.mockResolvedValue(db);
    const res = await executeOpsAction("cancelBooking", { bookingId: 42, reason: "客人要求取消" });
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("已取消");
    expect(res.summary).toContain("釋出座位");
    expect(res.details?.transitioned).toBe(true);
    expect(db._updatedTables).toContain(bookings);
    expect(db._updatedTables).toContain(tourDepartures); // 有座位 → 有釋座
  });

  it("條件式更新沒命中(affectedRows=0,被搶先取消)→ 不假成功:摘要標『本次未變更』且不釋座", async () => {
    const db = makeFakeDb({ bookingRow: { ...baseBooking }, bookingUpdateAffected: 0 });
    mockGetDb.mockResolvedValue(db);
    const res = await executeOpsAction("cancelBooking", { bookingId: 42, reason: "客人要求取消" });
    expect(res.ok).toBe(true);
    expect(res.details?.transitioned).toBe(false);
    expect(res.summary).toContain("本次未變更");
    expect(res.summary).not.toContain("釋出座位");
    expect(db._updatedTables).not.toContain(tourDepartures); // 沒命中 → 絕不釋座
  });

  it("已是 cancelled → 早退,不做任何 update", async () => {
    const db = makeFakeDb({ bookingRow: { ...baseBooking, bookingStatus: "cancelled" }, bookingUpdateAffected: 0 });
    mockGetDb.mockResolvedValue(db);
    const res = await executeOpsAction("cancelBooking", { bookingId: 42, reason: "x" });
    expect(res.ok).toBe(true);
    expect(res.details?.alreadyCancelled).toBe(true);
    expect(db._updatedTables).toHaveLength(0);
  });

  it("booking 不存在 → ok:false booking_not_found", async () => {
    const db = makeFakeDb({ bookingRow: null, bookingUpdateAffected: 0 });
    mockGetDb.mockResolvedValue(db);
    const res = await executeOpsAction("cancelBooking", { bookingId: 999, reason: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("booking_not_found");
  });
});
