import { describe, it, expect } from "vitest"
import {
  deriveProjectActions,
  deriveProjectDelivered,
  deriveProjectSummaryState,
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
      { kind: "file", name: "隨手上傳", customOrderId: 7 }, // ambiguous (chat_upload / email attachments land here)
      { kind: "quote", name: "別的專案報價", customOrderId: 9 }, // other project
      { kind: "flight", name: "機票_未分類", customOrderId: null }, // unfiled
    ]
    // both stamps fired → quote + confirmation docs are real deliveries
    const SENT = { quoteSentAt: "2026-06-18T10:00:00Z", confirmedAt: "2026-06-25T10:00:00Z" }
    const UNSENT = { quoteSentAt: null, confirmedAt: null }

    it("lists only outbound-kind docs filed to THIS project", () => {
      expect(projectDeliveredDocNames(docs, 7, SENT)).toEqual(["日本行程表_2026", "確認書_ORD-7"])
    })

    it("never leaks an inbound passport/visa scan as「給了客人」", () => {
      const names = projectDeliveredDocNames(docs, 7, SENT)
      expect(names).not.toContain("王小明護照")
      expect(names).not.toContain("簽證掃描")
    })

    it("excludes ambiguous generic uploads (kind=file, incl. chat_upload drops)", () => {
      // chat_upload / email-attachment rows are type="other" → kind="file" on the
      // client, so a file Jeff dropped into chat can never read as 給了客人.
      expect(projectDeliveredDocNames(docs, 7, SENT)).not.toContain("隨手上傳")
    })

    it("scopes to the active project only (other projects + 未分類 excluded)", () => {
      expect(projectDeliveredDocNames(docs, 9, SENT)).toEqual(["別的專案報價"])
      // an unfiled outbound doc (customOrderId null) is not any project's delivery
      expect(projectDeliveredDocNames(docs, 7, SENT)).not.toContain("機票_未分類")
    })

    describe("已寄出 gate — uploaded-but-unsent PDFs are NOT deliveries", () => {
      it("hides an uploaded quote PDF while quoteSentAt is still null", () => {
        // quotePdfUrl set → co-quote doc exists, but Jeff has not sent it yet.
        // Must match deriveProjectDelivered (empty) — the two halves can't disagree.
        expect(projectDeliveredDocNames(docs, 7, UNSENT)).toEqual([])
        expect(deriveProjectDelivered({ ...NONE })).toEqual([])
      })

      it("lists the quote PDF once quoteSentAt fired (confirmation still gated)", () => {
        const names = projectDeliveredDocNames(docs, 7, {
          quoteSentAt: "2026-06-18T10:00:00Z",
          confirmedAt: null,
        })
        expect(names).toEqual(["日本行程表_2026"])
        expect(names).not.toContain("確認書_ORD-7")
      })

      it("lists the confirmation PDF only once confirmedAt fired", () => {
        const names = projectDeliveredDocNames(docs, 7, {
          quoteSentAt: null,
          confirmedAt: "2026-06-25T10:00:00Z",
        })
        expect(names).toEqual(["確認書_ORD-7"])
        expect(names).not.toContain("日本行程表_2026")
      })

      it("does not gate other outbound kinds (invoice keeps its own lifecycle)", () => {
        const withInvoice = [...docs, { kind: "invoice", name: "INV-001", customOrderId: 7 }]
        expect(projectDeliveredDocNames(withInvoice, 7, UNSENT)).toEqual(["INV-001"])
      })
    })
  })

  describe("deriveProjectSummaryState — 誤讀防護 (chip active, order not there yet)", () => {
    it("no chip → none (whole-customer summary, no caption needed)", () => {
      expect(
        deriveProjectSummaryState({ activeProjectId: null, hasOrder: false, isFetching: false }),
      ).toBe("none")
    })

    it("chip + order loaded → project (the deterministic 摘要三行)", () => {
      expect(
        deriveProjectSummaryState({ activeProjectId: 7, hasOrder: true, isFetching: false }),
      ).toBe("project")
    })

    it("chip + order still loading → loading (skeleton), NEVER unlabeled whole-customer text", () => {
      // The bug: customerOrders.get in flight → projectOrder undefined → the
      // three summary rows silently rendered the whole-customer blend as if it
      // were this project. loading forces a skeleton instead.
      expect(
        deriveProjectSummaryState({ activeProjectId: 7, hasOrder: false, isFetching: true }),
      ).toBe("loading")
    })

    it("chip + query settled without an order (failed/deleted) → fallback (整體 caption)", () => {
      // Whole-customer content may render here ONLY because the JSX labels it
      // with summary.overallCaption — it must never pose as the project.
      expect(
        deriveProjectSummaryState({ activeProjectId: 7, hasOrder: false, isFetching: false }),
      ).toBe("fallback")
    })

    it("a loaded order beats a background refetch (no skeleton flicker on refresh)", () => {
      expect(
        deriveProjectSummaryState({ activeProjectId: 7, hasOrder: true, isFetching: true }),
      ).toBe("project")
    })
  })
})
