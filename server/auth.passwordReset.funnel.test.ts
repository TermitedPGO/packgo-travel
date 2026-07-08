/**
 * fail-open 盤點代表性樣本 — server/auth.ts requestPasswordReset() 的
 * sendPasswordResetEmail catch(highRiskType: customer-output)。
 *
 * 背景(見派工單):emailService.ts 內部兩個管道(SendGrid / SMTP)已經各自
 * try/catch,這裡的 catch 理論上只在更底層意外情況觸發(例如 emailService
 * 本身拋出未預期例外)。舊行為:console.error 記錄後函式仍固定回傳
 * success:true 給前端 —— 客人以為信一定會寄達,Jeff 端除了 Fly log 的
 * console.error 外完全不會被告警。上一輪接線加了一行 reportFunnelError
 * (server/auth.ts:134),行為不變(仍然吞掉、仍然回 success:true)。
 *
 * 這支測試用 vi.mock 掉 ./db / ./emailService / ./_core/errorFunnel,直接
 * 驅動 sendPasswordResetEmail 拋出例外的路徑,斷言:
 *   (a) reportFunnelError 被呼叫且 source 符合預期
 *   (b) 原本的 fail-open 行為沒被破壞 —— 呼叫端仍拿到 success:true,不會
 *       意外把例外拋到路由層。
 * 對照組(不拋出)驗證正常路徑完全不觸碰漏斗,避免誤報。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserByEmailMock = vi.fn();
const setPasswordResetTokenMock = vi.fn();
vi.mock("./db", () => ({
  getUserByEmail: (...args: unknown[]) => getUserByEmailMock(...args),
  setPasswordResetToken: (...args: unknown[]) => setPasswordResetTokenMock(...args),
}));

const sendPasswordResetEmailMock = vi.fn();
vi.mock("./emailService", () => ({
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmailMock(...args),
}));

vi.mock("./_core/redact", () => ({
  redactEmail: (e: string) => e,
}));

// 生產碼呼叫端一律 reportFunnelError(...).catch(() => {}) —— mock 必須永遠回
// resolved promise,不能依賴 reportFunnelErrorMock 自己的回傳值(vi.fn()
// 預設回傳 undefined,mockReset() 後更是如此,.catch 會直接炸掉呼叫端)。
const reportFunnelErrorMock = vi.fn();
vi.mock("./_core/errorFunnel", () => ({
  reportFunnelError: (...args: unknown[]) => {
    reportFunnelErrorMock(...args);
    return Promise.resolve();
  },
}));

import { requestPasswordReset } from "./auth";

const TEST_USER = { id: 1, email: "customer@example.com", name: "王先生" };

describe("requestPasswordReset — fail-open funnel wiring (server/auth.ts:134)", () => {
  beforeEach(() => {
    getUserByEmailMock.mockReset().mockResolvedValue(TEST_USER);
    setPasswordResetTokenMock.mockReset().mockResolvedValue(undefined);
    sendPasswordResetEmailMock.mockReset();
    reportFunnelErrorMock.mockReset();
  });

  it("sendPasswordResetEmail throws → funnel gets the error, caller still sees success:true (fail-open unchanged)", async () => {
    const boom = new Error("SMTP + SendGrid both unreachable");
    sendPasswordResetEmailMock.mockRejectedValue(boom);

    const result = await requestPasswordReset(TEST_USER.email);

    // 原本行為:catch 吞掉、函式繼續往下、固定回傳 success:true。
    expect(result.success).toBe(true);
    expect(result.message).toContain("如果該電子郵件已註冊");

    // 新增行為:漏斗被觸發,source 精確匹配接線點。
    expect(reportFunnelErrorMock).toHaveBeenCalledTimes(1);
    expect(reportFunnelErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:auth:requestPasswordResetSendFailed",
        err: boom,
      }),
    );
  });

  it("sendPasswordResetEmail returns false (no throw) → funnel NOT triggered (only the throw path is wired)", async () => {
    sendPasswordResetEmailMock.mockResolvedValue(false);

    const result = await requestPasswordReset(TEST_USER.email);

    expect(result.success).toBe(true);
    expect(reportFunnelErrorMock).not.toHaveBeenCalled();
  });

  it("happy path → no funnel noise", async () => {
    sendPasswordResetEmailMock.mockResolvedValue(true);

    const result = await requestPasswordReset(TEST_USER.email);

    expect(result.success).toBe(true);
    expect(reportFunnelErrorMock).not.toHaveBeenCalled();
  });

  it("unknown email → short-circuits before ever calling sendPasswordResetEmail (no funnel call either)", async () => {
    getUserByEmailMock.mockResolvedValue(null);

    const result = await requestPasswordReset("nobody@example.com");

    expect(result.success).toBe(true);
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
    expect(reportFunnelErrorMock).not.toHaveBeenCalled();
  });
});
