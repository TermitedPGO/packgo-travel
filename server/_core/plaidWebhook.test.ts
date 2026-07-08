/**
 * fail-open 盤點代表性樣本 — handlePlaidWebhook() 的 handlerDispatch catch
 * (highRiskType: money, server/_core/plaidWebhook.ts:166)。
 *
 * 背景(見派工單):webhook 類型分派(觸發交易同步 / 處理 ITEM 錯誤 / Hosted
 * Link)整段失敗,舊行為只 log.error + 把失敗寫進 plaidWebhookEvents.processedError
 * 欄位(沒人主動看的稽核表),完全沒有 notifyOwner —— 銀行交易同步斷了 Jeff
 * 不會知道。上一輪接線加了 reportFunnelError,行為不變(仍然吞掉、response
 * 早在分派之前就已經 200 回給 Plaid,不會因為分派失敗而重試風暴)。
 *
 * 用 ITEM/ERROR 分支驅動:handleItemError() 內部呼叫 notifyOwner,這裡讓
 * notifyOwner 丟例外,冒泡到外層 handlerDispatch catch。PLAID_ENV 未設 →
 * verifyPlaidWebhook 走 sandbox 短路徑(不驗簽、不打 Plaid API),用真實模組
 * 即可,不需要另外 mock。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const mockDb = {
  insert: vi.fn(),
  update: vi.fn(),
};
vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

const notifyOwnerMock = vi.fn();
vi.mock("./notification", () => ({
  notifyOwner: (...args: unknown[]) => notifyOwnerMock(...args),
}));

vi.mock("./logger", () => ({
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
vi.mock("./errorFunnel", () => ({
  reportFunnelError: (...args: unknown[]) => {
    reportFunnelErrorMock(...args);
    return Promise.resolve();
  },
}));

import { handlePlaidWebhook } from "./plaidWebhook";

function makeReqRes(payload: Record<string, unknown>) {
  const req = {
    headers: {},
    body: Buffer.from(JSON.stringify(payload), "utf8"),
  } as unknown as Request;
  const statusCalls: number[] = [];
  const jsonCalls: unknown[] = [];
  const res = {
    status: vi.fn((code: number) => {
      statusCalls.push(code);
      return res;
    }),
    json: vi.fn((body: unknown) => {
      jsonCalls.push(body);
      return res;
    }),
  } as unknown as Response;
  return { req, res, statusCalls, jsonCalls };
}

function makeUpdateChain() {
  const set = vi.fn();
  const where = vi.fn().mockResolvedValue(undefined);
  set.mockReturnValue({ where });
  return { set, where };
}

describe("handlePlaidWebhook — fail-open funnel wiring (plaidWebhook.ts:166)", () => {
  beforeEach(() => {
    mockDb.insert.mockReset().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ insertId: 42 }]),
    });
    mockDb.update.mockReset();
    notifyOwnerMock.mockReset();
    reportFunnelErrorMock.mockReset();
    delete process.env.PLAID_ENV; // sandbox default → verifyPlaidWebhook 短路徑
  });

  it("ITEM/ERROR 分派時 notifyOwner 丟例外 → funnel 收到錯誤,webhook 仍然 200 且不 throw(fail-open 不變)", async () => {
    const linkedBankAccountsChain = makeUpdateChain();
    const plaidWebhookEventsChain = makeUpdateChain();
    let updateCallCount = 0;
    mockDb.update.mockImplementation(() => {
      updateCallCount++;
      // 第一次 update 是 handleItemError 對 linkedBankAccounts,第二次是外層
      // catch 對 plaidWebhookEvents 標記 processedError。順序照 production
      // 程式碼實際呼叫順序走。
      return updateCallCount === 1 ? linkedBankAccountsChain : plaidWebhookEventsChain;
    });

    const boom = new Error("notifyOwner SMTP unreachable");
    notifyOwnerMock.mockRejectedValue(boom);

    const { req, res, statusCalls } = makeReqRes({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      item_id: "item-abc123",
      error: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "bad creds" },
    });

    // 原本行為:整段函式不拋出到呼叫端(express route handler 不會看到
    // unhandled rejection)。
    await expect(handlePlaidWebhook(req, res)).resolves.toBeUndefined();

    // ack 仍然是先 200 回給 Plaid(在分派失敗之前就已經送出)。
    expect(statusCalls[0]).toBe(200);

    // 新增行為:漏斗被觸發,source + context 精確匹配接線點。
    expect(reportFunnelErrorMock).toHaveBeenCalledTimes(1);
    expect(reportFunnelErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:plaidWebhook:handlerDispatch",
        err: boom,
        context: { webhookType: "ITEM", webhookCode: "ERROR" },
      }),
    );

    // 原本行為:稽核表仍然被標記失敗(processedSuccess:0 + processedError),
    // 這是舊有「沒人主動看的稽核表」那條路徑,接線後沒有被拿掉。
    expect(plaidWebhookEventsChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        processedSuccess: 0,
        processedError: expect.stringContaining("notifyOwner SMTP unreachable"),
      }),
    );
  });

  it("happy path(notifyOwner 成功)→ 沒有漏斗噪音", async () => {
    const chain = makeUpdateChain();
    mockDb.update.mockReturnValue(chain);
    notifyOwnerMock.mockResolvedValue(undefined);

    const { req, res, statusCalls } = makeReqRes({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      item_id: "item-ok",
      error: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "bad creds" },
    });

    await handlePlaidWebhook(req, res);

    expect(statusCalls[0]).toBe(200);
    expect(reportFunnelErrorMock).not.toHaveBeenCalled();
  });
});
