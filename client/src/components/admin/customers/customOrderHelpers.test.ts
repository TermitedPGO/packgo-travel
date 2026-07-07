// 批十二-2 (P1) — advanceableStatuses 的權威測試。重點:client 硬編的前進子集必須
// 跟 server 狀態機 TRANSITIONS 一致(用 canTransition 交叉核對),不然按鈕會提供非法轉移。
import { describe, it, expect } from "vitest"
import { advanceableStatuses } from "./customOrderHelpers"
import {
  canTransition,
  CUSTOM_ORDER_STATUSES,
  type CustomOrderStatus,
} from "../../../../../server/routers/customOrderStateMachine"

describe("advanceableStatuses — 訂製單詳情頁前進按鈕", () => {
  it.each([
    ["arranged", ["confirmed"]],
    ["deposit_paid", ["confirmed"]],
    ["paid", ["confirmed"]],
    ["confirmed", ["departed"]],
    ["departed", ["completed"]],
  ] as const)("%s → %j", (status, expected) => {
    expect(advanceableStatuses(status)).toEqual(expected)
  })

  it.each([["draft"], ["quoted"], ["completed"], ["cancelled"]] as const)(
    "%s → [] (無前進按鈕:草稿未成單 / 終態)",
    (status) => {
      expect(advanceableStatuses(status)).toEqual([])
    },
  )

  it("每個提供的下一步都是 server 合法轉移(canTransition 交叉核對,防漂移)", () => {
    for (const s of CUSTOM_ORDER_STATUSES) {
      for (const next of advanceableStatuses(s)) {
        expect(canTransition(s as CustomOrderStatus, next)).toBe(true)
      }
    }
  })

  it("每個回傳值都是合法的 CustomOrderStatus", () => {
    const valid = new Set<string>(CUSTOM_ORDER_STATUSES)
    for (const s of CUSTOM_ORDER_STATUSES) {
      for (const next of advanceableStatuses(s)) {
        expect(valid.has(next)).toBe(true)
      }
    }
  })

  it("cancelled 不在任何前進集合裡(取消走既有的取消連結)", () => {
    for (const s of CUSTOM_ORDER_STATUSES) {
      expect(advanceableStatuses(s)).not.toContain("cancelled")
    }
  })

  it("未知狀態安全回 []", () => {
    expect(advanceableStatuses("bogus")).toEqual([])
  })
})
