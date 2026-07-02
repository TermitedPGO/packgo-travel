/**
 * draftSendOutcome — 送信結果誠實化的純邏輯測試(2026-07-02)。
 *
 * 起因(prod 實錄):commandCenter.escalationReply 失敗時回 HTTP 200 +
 * {sent:false, errorMessage},mutateAsync 不 throw,approveDraft 把失敗
 * 當成功收掉 → Jeff 點確認發送、伺服器炸 "Requested entity was not
 * found",UI 什麼都沒顯示。這裡鎖:結果物件 → 失敗描述 → 卡片顯示文字
 * 的三段純轉換,伺服器的誠實訊息一路不失真。
 */
import { describe, expect, it } from "vitest"
import {
  escalationSendFailure,
  inquiryApproveFailure,
  draftSendErrorText,
  DraftSendFailedError,
} from "./adapters"

const T = { sendFailed: "送出失敗，請再試一次。", dryRun: "演練模式，沒有真的寄出。" }

describe("escalationSendFailure", () => {
  it("sent:true → null (成功不報錯)", () => {
    expect(escalationSendFailure({ sent: true, dryRun: false })).toBeNull()
  })

  it("sent:false + errorMessage → failed 帶伺服器原話", () => {
    expect(
      escalationSendFailure({
        sent: false,
        dryRun: false,
        errorMessage:
          "這封信不在任何連線中的 Gmail 帳號裡(已檢查:a@x.com、b@y.com),沒有寄出",
      }),
    ).toEqual({
      kind: "failed",
      serverMessage:
        "這封信不在任何連線中的 Gmail 帳號裡(已檢查:a@x.com、b@y.com),沒有寄出",
    })
  })

  it("dryRun:true → kind=dryRun(kill switch 降級不是成功)", () => {
    expect(
      escalationSendFailure({ sent: false, dryRun: true, errorMessage: "AGENT_DRY_RUN" }),
    ).toEqual({ kind: "dryRun", serverMessage: "AGENT_DRY_RUN" })
  })

  it("空白 errorMessage → serverMessage null(UI 用 i18n fallback)", () => {
    expect(
      escalationSendFailure({ sent: false, dryRun: false, errorMessage: "  " }),
    ).toEqual({ kind: "failed", serverMessage: null })
    expect(escalationSendFailure({ sent: false, dryRun: false })).toEqual({
      kind: "failed",
      serverMessage: null,
    })
  })
})

describe("inquiryApproveFailure", () => {
  it("sent / approved → null", () => {
    expect(inquiryApproveFailure({ status: "sent" })).toBeNull()
    expect(inquiryApproveFailure({ status: "approved" })).toBeNull()
  })

  it("failed → failed 帶 executor 的 errorMessage", () => {
    expect(
      inquiryApproveFailure({ status: "failed", errorMessage: "Gmail send 500" }),
    ).toEqual({ kind: "failed", serverMessage: "Gmail send 500" })
  })

  it("failed 無訊息 → serverMessage null", () => {
    expect(inquiryApproveFailure({ status: "failed" })).toEqual({
      kind: "failed",
      serverMessage: null,
    })
  })
})

describe("draftSendErrorText", () => {
  it("DraftSendFailedError 帶伺服器原話 → 原話直出", () => {
    const err = new DraftSendFailedError({
      kind: "failed",
      serverMessage: "Gmail 連線已失效,需要重新授權",
    })
    expect(draftSendErrorText(err, T)).toBe("Gmail 連線已失效,需要重新授權")
  })

  it("failed 無原話 → sendFailed fallback;dryRun 無原話 → dryRun fallback", () => {
    expect(
      draftSendErrorText(
        new DraftSendFailedError({ kind: "failed", serverMessage: null }),
        T,
      ),
    ).toBe(T.sendFailed)
    expect(
      draftSendErrorText(
        new DraftSendFailedError({ kind: "dryRun", serverMessage: null }),
        T,
      ),
    ).toBe(T.dryRun)
  })

  it("非 DraftSendFailedError(網路 / zod throw)→ 通用 sendFailed", () => {
    expect(draftSendErrorText(new Error("Failed to fetch"), T)).toBe(T.sendFailed)
    expect(draftSendErrorText("boom", T)).toBe(T.sendFailed)
  })
})
