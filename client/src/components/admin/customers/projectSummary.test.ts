import { describe, it, expect } from "vitest"
import {
  deriveProjectActions,
  deriveProjectDelivered,
  projectDeliveredDocNames,
} from "./projectSummary"

const NONE = {
  quoteSentAt: null,
  collectionSentAt: null,
  depositPaidAt: null,
  balancePaidAt: null,
  confirmedAt: null,
}

describe("projectSummary — per-project deterministic 摘要三行", () => {
  describe("deriveProjectActions (做了什麼)", () => {
    it("returns nothing when no stamp fired (can't invent an action)", () => {
      expect(deriveProjectActions(NONE)).toEqual([])
    })

    it("emits verbs in lifecycle order, each carrying its real stamp", () => {
      const acts = deriveProjectActions({
        ...NONE,
        confirmedAt: "2026-06-25T10:00:00Z", // out of order on purpose
        quoteSentAt: "2026-06-18T10:00:00Z",
        depositPaidAt: "2026-06-22T10:00:00Z",
      })
      expect(acts.map((a) => a.key)).toEqual(["quoteSent", "depositPaid", "confirmed"])
      expect(acts[0].at).toBe("2026-06-18T10:00:00Z")
    })

    it("carries all five stamps when the full lifecycle ran", () => {
      const acts = deriveProjectActions({
        quoteSentAt: "a",
        collectionSentAt: "b",
        depositPaidAt: "c",
        balancePaidAt: "d",
        confirmedAt: "e",
      })
      expect(acts.map((a) => a.key)).toEqual([
        "quoteSent",
        "collectionSent",
        "depositPaid",
        "balancePaid",
        "confirmed",
      ])
    })
  })

  describe("deriveProjectDelivered (給了什麼, order half)", () => {
    it("is empty until a quote or confirmation actually went out", () => {
      expect(deriveProjectDelivered(NONE)).toEqual([])
      expect(deriveProjectDelivered({ ...NONE, depositPaidAt: "x" })).toEqual([])
    })

    it("emits 報價 on quoteSentAt and 確認書 on confirmedAt", () => {
      const d = deriveProjectDelivered({ ...NONE, quoteSentAt: "q", confirmedAt: "c" })
      expect(d.map((x) => x.key)).toEqual(["quote", "confirm"])
      expect(d[0].at).toBe("q")
    })
  })

  describe("projectDeliveredDocNames (給了什麼, doc half) — the outbound gate", () => {
    const docs = [
      { kind: "quote", name: "日本行程表_2026", customOrderId: 7 },
      { kind: "confirmation", name: "確認書_ORD-7", customOrderId: 7 },
      { kind: "passport", name: "王小明護照", customOrderId: 7 }, // inbound PII
      { kind: "visa", name: "簽證掃描", customOrderId: 7 }, // inbound PII
      { kind: "file", name: "隨手上傳", customOrderId: 7 }, // ambiguous
      { kind: "quote", name: "別的專案報價", customOrderId: 9 }, // other project
      { kind: "flight", name: "機票_未分類", customOrderId: null }, // unfiled
    ]

    it("lists only outbound-kind docs filed to THIS project", () => {
      expect(projectDeliveredDocNames(docs, 7)).toEqual(["日本行程表_2026", "確認書_ORD-7"])
    })

    it("never leaks an inbound passport/visa scan as「給了客人」", () => {
      const names = projectDeliveredDocNames(docs, 7)
      expect(names).not.toContain("王小明護照")
      expect(names).not.toContain("簽證掃描")
    })

    it("excludes ambiguous generic uploads (kind=file)", () => {
      expect(projectDeliveredDocNames(docs, 7)).not.toContain("隨手上傳")
    })

    it("scopes to the active project only (other projects + 未分類 excluded)", () => {
      expect(projectDeliveredDocNames(docs, 9)).toEqual(["別的專案報價"])
      // an unfiled outbound doc (customOrderId null) is not any project's delivery
      expect(projectDeliveredDocNames(docs, 7)).not.toContain("機票_未分類")
    })
  })
})
