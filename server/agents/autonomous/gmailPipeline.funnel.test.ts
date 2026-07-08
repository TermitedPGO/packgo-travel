/**
 * fail-open 盤點代表性樣本 — runGmailPipeline() 的 listUnreadMessages catch
 * (highRiskType: customer-data, server/agents/autonomous/gmailPipeline.ts:196)。
 *
 * 背景(見派工單):這個 catch 回傳 { ok:false, errors:[...] } 而不 throw,
 * 繞過了 gmailPollWorker 外層專門處理 OAuth 撤銷通知的 catch —— 整輪 0 封信
 * 被處理,卻無人被明確通知(只留在 result.errors 裡,worker 若沒特別檢查
 * ok:false 就悄悄過去)。上一輪接線加了 reportFunnelError,行為不變(仍然
 * 回傳 ok:false + errors,不拋出)。
 *
 * Heavy collaborators (db / gmail / redis / storage / receiptExtractor /
 * inquiryAgent / refundAgent / logger) 全部 mock 掉 —— 同 gmailPipeline.lock
 * / gmailPipeline.noise 既有的接線方式,只是這裡讓 db.select() 回傳一筆
 * active integration,並讓 listUnreadMessages 丟例外來驅動目標 catch。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../redis", () => ({
  redis: { set: vi.fn() },
  redisBullMQ: {},
  default: { set: vi.fn() },
}));

const selectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};
const mockDb = { select: vi.fn().mockReturnValue(selectChain) };
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => mockDb),
  createPendingExpense: vi.fn(),
  getPendingExpenseByGmailMessageId: vi.fn(),
}));

const listUnreadMessagesMock = vi.fn();
vi.mock("../../_core/gmail", () => ({
  buildGmailClient: vi.fn(() => ({})),
  listUnreadMessages: (...args: unknown[]) => listUnreadMessagesMock(...args),
  listMessagesByIds: vi.fn(async () => []),
  listHistoryMessageIds: vi.fn(async () => ({ messageIds: [] })),
  selectIngestableMessages: vi.fn(() => []),
  ensureLabel: vi.fn(async () => "label-id-processed"),
  applyLabel: vi.fn(),
  sendReplyInThread: vi.fn(),
  fetchRawAttachments: vi.fn(async () => []),
  getThreadHistory: vi.fn(async () => []),
}));
vi.mock("../../_core/receiptExtractor", () => ({
  detectReceipt: vi.fn(() => ({ isReceipt: false })),
  extractReceipt: vi.fn(),
  pickReceiptAttachment: vi.fn(() => null),
}));
vi.mock("../../storage", () => ({ storagePut: vi.fn() }));
vi.mock("./inquiryAgent", () => ({
  runInquiryAgent: vi.fn(),
  DEFAULT_INQUIRY_POLICY: {},
}));
vi.mock("./refundAgent", () => ({
  runRefundAgent: vi.fn(),
  DEFAULT_REFUND_POLICY: {},
}));
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// 生產碼呼叫端一律 reportFunnelError(...).catch(() => {}) —— mock 必須永遠回
// resolved promise,不能依賴 reportFunnelErrorMock 自己的回傳值(vi.fn()
// 預設回傳 undefined,mockReset() 後更是如此,.catch 會直接炸掉呼叫端)。
const reportFunnelErrorMock = vi.fn();
vi.mock("../../_core/errorFunnel", () => ({
  reportFunnelError: (...args: unknown[]) => {
    reportFunnelErrorMock(...args);
    return Promise.resolve();
  },
}));

import { runGmailPipeline } from "./gmailPipeline";

const ACTIVE_INTEGRATION = {
  id: 7,
  emailAddress: "support@packgoplay.com",
  isActive: 1,
  lastPollAt: null,
};

describe("runGmailPipeline — fail-open funnel wiring (gmailPipeline.ts:196)", () => {
  beforeEach(() => {
    selectChain.limit.mockReset().mockResolvedValue([ACTIVE_INTEGRATION]);
    listUnreadMessagesMock.mockReset();
    reportFunnelErrorMock.mockReset();
  });

  it("listUnreadMessages throws → funnel gets the error, pipeline still returns ok:false (not throw)", async () => {
    const boom = new Error("Gmail API 500 — quotaExceeded");
    listUnreadMessagesMock.mockRejectedValue(boom);

    const result = await runGmailPipeline(7);

    // 原本行為:不 throw,回傳 ok:false + errors,呼叫端(gmailPollWorker)
    // 自己決定要不要繼續 —— 這條路徑本身不會炸掉整個 worker job。
    expect(result.ok).toBe(false);
    expect(result.totalFetched).toBe(0);
    expect(result.errors[0]).toContain("listUnreadMessages failed");
    expect(result.errors[0]).toContain("quotaExceeded");
    expect(result.emailAddress).toBe(ACTIVE_INTEGRATION.emailAddress);

    // 新增行為:漏斗被觸發,source + context 精確匹配接線點。
    expect(reportFunnelErrorMock).toHaveBeenCalledTimes(1);
    expect(reportFunnelErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:gmailPipeline:listUnreadMessages",
        err: boom,
        context: expect.objectContaining({ emailAddress: ACTIVE_INTEGRATION.emailAddress }),
      }),
    );
  });

  // 注意:沒有補「happy path 不觸發漏斗」的對照組 —— listUnreadMessages 成功
  // 後 runGmailPipeline 會繼續跑 ensurePolicy / ingestFreshMessages / 尾段
  // db.update(gmailIntegration) 等一整條管線,要撐住那條路徑需要遠超過這個
  // catch 本身的 mock 量(agentPolicies 種子邏輯、selectDistinct 尾段
  // reconcile、...)。這支測試的目標只是確認 catch 接線正確,不是把整支
  // pipeline 重新測一遍 —— 對照組意義有限,故略過,以維持測試聚焦且不脆弱。
});
