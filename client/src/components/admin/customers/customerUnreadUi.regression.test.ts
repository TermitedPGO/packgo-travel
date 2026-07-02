/**
 * customerUnreadUi.regression — source-scan tests for the 2026-07-01 來訊未讀
 * 通知 + 訪客刪除 batch (Jeff:「每當客人來訊息 我還沒看到明顯得notification」
 * 「不只是隱藏 也可以選擇刪除」).
 *
 * Same precedent as cockpitUiGuards.regression.test.ts: the repo has no React
 * component test rig (vitest env=node), so we parse the source and assert the
 * load-bearing wiring exists and the forbidden patterns don't. The pure logic
 * lives server-side (customerUnread.ts / adminCustomersGuestDelete.ts) and is
 * unit-tested there; this file guards the JSX those units plug into.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8")
const customerList = read("CustomerList.tsx")
const useCustomerDataSrc = read("useCustomerData.ts")
const adminShell = read("../../../layouts/AdminShell.tsx")
const zh = read("../../../i18n/zh-TW.ts")
const en = read("../../../i18n/en.ts")

describe("A — 來訊未讀紅點 (CustomerList)", () => {
  it("unread row shows the avatar-corner red dot (w-2 h-2 bg-red-500 rounded-full)", () => {
    expect(customerList).toMatch(/c\.unread[\s\S]{0,120}?w-2 h-2 bg-red-500 rounded-full/)
  })

  it("unread row name goes font-semibold", () => {
    expect(customerList).toMatch(/c\.unread[^}]*font-semibold/)
  })
})

describe("B — 60s refetch keeps the dots honest without F5", () => {
  it("customerList query polls every 60s", () => {
    expect(useCustomerDataSrc).toMatch(
      /customerList\.useQuery\(\s*\{ includeHidden: showHidden \},\s*\{ refetchInterval: 60_000 \}/,
    )
  })

  it("guestList query polls every 60s", () => {
    expect(useCustomerDataSrc).toMatch(
      /guestList\.useQuery\(\s*\{ includeHidden: showHidden \},\s*\{ refetchInterval: 60_000 \}/,
    )
  })

  it("opening a customer fires markCustomerSeen and optimistically clears the row", () => {
    expect(useCustomerDataSrc).toContain("markCustomerSeen.useMutation")
    expect(useCustomerDataSrc).toMatch(/setData\([\s\S]{0,200}?unreadInbound: false/)
  })
})

describe("C — /ops nav rail 客人 icon 未讀數 badge (AdminShell)", () => {
  it("queries admin.customerUnreadCount with a 60s poll", () => {
    expect(adminShell).toContain("customerUnreadCount.useQuery")
    expect(adminShell).toContain("refetchInterval: 60_000")
  })

  it("count > 0 → red-bg white-text round badge on the customers item only", () => {
    expect(adminShell).toMatch(
      /item\.path === "\/ops\/customers" && customerUnread > 0[\s\S]{0,300}?rounded-full bg-red-500 text-white/,
    )
  })
})

describe("D — 訪客刪除 (CustomerList)", () => {
  it("Trash2 icon exists and is gated to guest rows only", () => {
    expect(customerList).toContain("Trash2")
    expect(customerList).toMatch(/c\.kind === "guest"[\s\S]{0,700}?Trash2/)
  })

  it("confirm is an in-app rounded-xl card, NEVER the native confirm()", () => {
    expect(customerList).toMatch(/confirmDelete[\s\S]{0,600}?rounded-xl/)
    expect(customerList).not.toMatch(/window\.confirm|[^\w.]confirm\(/)
  })

  it("card carries the irreversible warning + cancel + red confirm buttons", () => {
    expect(customerList).toContain("admin.customers.deleteConfirm.warning")
    expect(customerList).toContain("admin.customers.deleteConfirm.cancel")
    expect(customerList).toContain("admin.customers.deleteConfirm.confirm")
    expect(customerList).toMatch(/text-red-600[\s\S]{0,200}?deleteConfirm\.confirm/)
  })

  it("useCustomerData exposes deleteGuest via the audited server mutation", () => {
    expect(useCustomerDataSrc).toContain("deleteGuestCustomer.useMutation")
    expect(useCustomerDataSrc).toContain("deleteGuest:")
  })
})

describe("E — i18n: keys exist in BOTH locales, no em dash in UI copy", () => {
  it("deleteConfirm block exists in zh-TW and en", () => {
    // "deleteConfirm: {" (object) — NOT the unrelated flat destinations key
    // `deleteConfirm: '確定要刪除這個目的地嗎？'` that also lives in the locale files.
    for (const src of [zh, en]) {
      const start = src.search(/deleteConfirm:\s*\{/)
      expect(start).toBeGreaterThan(-1)
      const block = src.slice(start, start + 600)
      for (const k of ["action:", "title:", "warning:", "cancel:", "confirm:"]) {
        expect(block).toContain(k)
      }
    }
  })

  it("deleteConfirm copy carries no em dash (不用破折號鐵律)", () => {
    for (const src of [zh, en]) {
      const start = src.search(/deleteConfirm:\s*\{/)
      const block = src.slice(start, src.indexOf("}", start) + 1)
      expect(block).not.toContain("—")
    }
  })
})
