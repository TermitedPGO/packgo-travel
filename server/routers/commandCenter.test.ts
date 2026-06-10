/**
 * Tests for the 指揮中心 commandCenter tRPC router (S-3).
 *
 * design.md S-3 Vitest contract:
 *   - list passes the lane/status filter through to listApprovalTasks.
 *   - approve flips status then invokes the lane executor keyed by taskType
 *     (markApprovalTaskSent on success); no executor → stops at "approved".
 *   - bulkApprove BLOCKS hard_gate tasks (never approves them) while
 *     approving auto/review.
 *
 * The S-2 helper is mocked so we test router orchestration in isolation.
 * rateLimit + logger are mocked so adminProcedure runs without Redis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/approvalTasks", () => ({
  listApprovalTasks: vi.fn(),
  getApprovalStats: vi.fn(),
  getApprovalTaskById: vi.fn(),
  decideApprovalTask: vi.fn(),
  getApprovalExecutor: vi.fn(),
  markApprovalTaskSent: vi.fn(),
  markApprovalTaskFailed: vi.fn(),
  registerApprovalExecutor: vi.fn(),
}));

// The router registers the cs executor at module load via
// inquiryReplyExecutor.registerCsExecutors(). Mock that module so the router
// test stays isolated to router orchestration (no transitive db/agent load).
vi.mock("../agents/autonomous/inquiryReplyExecutor", () => ({
  registerCsExecutors: vi.fn(),
  INQUIRY_REPLY_TASK_TYPE: "inquiry_reply",
}));

// Same for the P2 quote executor (registered at module load by the router).
vi.mock("../agents/autonomous/quoteExecutor", () => ({
  registerQuoteExecutors: vi.fn(),
  QUOTE_DRAFT_TASK_TYPE: "quote_draft",
}));

// produceQuoteDraft dynamically imports these — mock them so the router test
// stays isolated to router orchestration (no real db / producer load).
vi.mock("../db", () => ({
  getTourById: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../agents/autonomous/quoteProducer", () => ({
  produceQuoteDraftTask: vi.fn(),
}));

vi.mock("../rateLimit", () => ({
  checkAdminMutationRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { commandCenterRouter } from "./commandCenter";
import {
  listApprovalTasks,
  getApprovalStats,
  getApprovalTaskById,
  decideApprovalTask,
  getApprovalExecutor,
  markApprovalTaskSent,
} from "../_core/approvalTasks";
import { getTourById, getDb } from "../db";
import { produceQuoteDraftTask } from "../agents/autonomous/quoteProducer";

const listMock = vi.mocked(listApprovalTasks);
const statsMock = vi.mocked(getApprovalStats);
const getByIdMock = vi.mocked(getApprovalTaskById);
const decideMock = vi.mocked(decideApprovalTask);
const getExecutorMock = vi.mocked(getApprovalExecutor);
const markSentMock = vi.mocked(markApprovalTaskSent);
const getTourByIdMock = vi.mocked(getTourById);
const getDbMock = vi.mocked(getDb);
const produceQuoteMock = vi.mocked(produceQuoteDraftTask);

/** Build a fake drizzle select chain that resolves to `rows` at .limit(). */
function fakeDbReturning(rows: any[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select } as any;
}

function adminCaller() {
  return commandCenterRouter.createCaller({
    user: { id: 42, role: "admin", email: "jeff@packgo.com" },
    req: { headers: {} },
    res: {},
    ip: "127.0.0.1",
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("commandCenter.list", () => {
  it("passes the lane/status filter through to listApprovalTasks", async () => {
    listMock.mockResolvedValue([{ id: 1 } as any]);

    const caller = adminCaller();
    const result = await caller.list({ lane: "cs", status: "pending" });

    expect(listMock).toHaveBeenCalledWith({ lane: "cs", status: "pending" });
    // rows pass through enrichTasksWithWho — non-customer rows get who: null
    expect(result).toEqual([{ id: 1, who: null }]);
  });

  it("defaults to an empty filter when no input is given", async () => {
    listMock.mockResolvedValue([]);

    const caller = adminCaller();
    await caller.list();

    expect(listMock).toHaveBeenCalledWith({});
  });

  it("enriches cs rows with who from the payload (db unavailable → label only)", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    listMock.mockResolvedValue([
      {
        id: 2,
        lane: "cs",
        payload: JSON.stringify({
          inquiryId: 9,
          customerName: "陳美玲",
          customerEmail: "mei@example.com",
        }),
      } as any,
    ]);

    const caller = adminCaller();
    const result = await caller.list();

    expect(result[0].who).toEqual({ label: "陳美玲", userId: null });
  });
});

describe("commandCenter.stats", () => {
  it("returns getApprovalStats output", async () => {
    statsMock.mockResolvedValue({
      pendingByLane: { cs: 2, quote: 0, marketing: 0, finance: 1 },
      totalPending: 3,
    });

    const caller = adminCaller();
    const result = await caller.stats();

    expect(result.totalPending).toBe(3);
    expect(result.pendingByLane.cs).toBe(2);
    // 批1 m3b additive field — db unavailable here → honest 0, never a throw
    expect(result.escalationUnread).toBe(0);
  });
});

describe("commandCenter.approve", () => {
  it("flips status then invokes the executor keyed by taskType (marks sent)", async () => {
    const task = {
      id: 1,
      status: "approved",
      taskType: "cs.reply_inquiry",
    } as any;
    decideMock.mockResolvedValue(task);
    const executor = vi.fn().mockResolvedValue({ status: "sent" });
    getExecutorMock.mockReturnValue(executor);

    const caller = adminCaller();
    const result = await caller.approve({ id: 1 });

    expect(decideMock).toHaveBeenCalledWith(
      { id: 1, decision: "approve", decidedBy: 42, editedPayload: undefined },
      expect.anything(),
    );
    expect(getExecutorMock).toHaveBeenCalledWith("cs.reply_inquiry");
    expect(executor).toHaveBeenCalledWith(task, expect.anything());
    expect(markSentMock).toHaveBeenCalledWith(1);
    expect(result).toEqual({ id: 1, status: "sent", executed: true });
  });

  it("stops at 'approved' when no executor is registered (v1 spine)", async () => {
    decideMock.mockResolvedValue({
      id: 5,
      status: "approved",
      taskType: "quote.none",
    } as any);
    getExecutorMock.mockReturnValue(undefined);

    const caller = adminCaller();
    const result = await caller.approve({ id: 5 });

    expect(result).toEqual({ id: 5, status: "approved", executed: false });
    expect(markSentMock).not.toHaveBeenCalled();
  });
});

describe("commandCenter.bulkApprove", () => {
  it("BLOCKS hard_gate tasks and approves auto/review ones", async () => {
    getByIdMock.mockImplementation(async (id: number) => {
      if (id === 1)
        return {
          id: 1,
          riskLevel: "hard_gate",
          status: "pending",
          taskType: "finance.recognize",
        } as any;
      return {
        id: 2,
        riskLevel: "auto",
        status: "pending",
        taskType: "marketing.post",
      } as any;
    });
    decideMock.mockResolvedValue({
      id: 2,
      status: "approved",
      taskType: "marketing.post",
    } as any);
    getExecutorMock.mockReturnValue(undefined);

    const caller = adminCaller();
    const result = await caller.bulkApprove({ ids: [1, 2] });

    // hard_gate id 1 is reported blocked and never decided.
    expect(result.blocked).toContainEqual({ id: 1, reason: "hard_gate" });
    expect(result.approved).toContainEqual({
      id: 2,
      status: "approved",
      executed: false,
    });
    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(decideMock).toHaveBeenCalledWith(
      { id: 2, decision: "approve", decidedBy: 42, editedPayload: undefined },
      expect.anything(),
    );
  });

  it("reports not_found and already-decided ids as blocked", async () => {
    getByIdMock.mockImplementation(async (id: number) => {
      if (id === 1) return undefined;
      return {
        id: 2,
        riskLevel: "review",
        status: "sent",
        taskType: "cs.reply_inquiry",
      } as any;
    });

    const caller = adminCaller();
    const result = await caller.bulkApprove({ ids: [1, 2] });

    expect(result.blocked).toContainEqual({ id: 1, reason: "not_found" });
    expect(result.blocked).toContainEqual({ id: 2, reason: "already_sent" });
    expect(decideMock).not.toHaveBeenCalled();
  });
});

describe("commandCenter.produceQuoteDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws NOT_FOUND when the tour does not exist", async () => {
    getTourByIdMock.mockResolvedValue(undefined);

    const caller = adminCaller();
    await expect(caller.produceQuoteDraft({ tourId: 999 })).rejects.toThrow(
      /not found/i,
    );
    expect(produceQuoteMock).not.toHaveBeenCalled();
  });

  it("custom trip → no supplier lookup, passes isCustomTrip + tourTitle", async () => {
    getTourByIdMock.mockResolvedValue({ id: 12, title: "歐洲蜜月客製" } as any);
    produceQuoteMock.mockResolvedValue({ id: 88, riskLevel: "hard_gate" });

    const caller = adminCaller();
    const res = await caller.produceQuoteDraft({
      tourId: 12,
      isCustomTrip: true,
    });

    expect(getDbMock).not.toHaveBeenCalled();
    expect(produceQuoteMock).toHaveBeenCalledTimes(1);
    const arg = produceQuoteMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      tourId: 12,
      tourTitle: "歐洲蜜月客製",
      isCustomTrip: true,
    });
    expect(arg.supplierPrice).toBeUndefined();
    expect(res).toEqual({ taskId: 88, riskLevel: "hard_gate" });
  });

  it("supplier trip → resolves retailPrice (直客價) + currency from supplierDepartures", async () => {
    getTourByIdMock.mockResolvedValue({
      id: 7,
      title: "北海道粉雪 5 日",
    } as any);
    produceQuoteMock.mockResolvedValue({ id: 90, riskLevel: "hard_gate" });
    // decimal columns come back as strings — Number("1880.00") === 1880.
    getDbMock.mockResolvedValue(
      fakeDbReturning([{ retailPrice: "1880.00", currency: "USD" }]),
    );

    const caller = adminCaller();
    const res = await caller.produceQuoteDraft({
      tourId: 7,
      departureId: 55,
      customerChannel: "wechat",
    });

    expect(getDbMock).toHaveBeenCalled();
    const arg = produceQuoteMock.mock.calls[0][0];
    expect(arg.supplierPrice).toBe(1880);
    expect(arg.currency).toBe("USD");
    expect(arg.isCustomTrip).toBe(false);
    expect(arg.customerChannel).toBe("wechat");
    expect(res).toEqual({ taskId: 90, riskLevel: "hard_gate" });
  });

  it("supplier trip with no matching departure row → supplierPrice undefined", async () => {
    getTourByIdMock.mockResolvedValue({ id: 7, title: "北海道" } as any);
    produceQuoteMock.mockResolvedValue({ id: 91, riskLevel: "hard_gate" });
    getDbMock.mockResolvedValue(fakeDbReturning([]));

    const caller = adminCaller();
    await caller.produceQuoteDraft({ tourId: 7, departureId: 55 });

    expect(produceQuoteMock.mock.calls[0][0].supplierPrice).toBeUndefined();
  });
});
