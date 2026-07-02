/**
 * cockpitUiGuards.regression — source-scan tests for the 2026-07-01 customer
 * cockpit P3 batch (防閃資料 / expanded overlay CSS / 專案摘要誤讀防護 /
 * 訂製單點哪張開哪張 / 死 code 清除).
 *
 * The repo has no React component/hook test rig (vitest env=node, no
 * testing-library), so these follow the source-scan precedent
 * (customerChatReset.regression.test.ts): parse the source and assert the
 * load-bearing pattern exists and the buggy one is gone — red before each fix,
 * green after, red again if a refactor reintroduces the bug. The pure logic
 * behind fix C/E lives in projectSummary.ts / adapters.ts and is unit-tested
 * there; this file guards the JSX wiring those units plug into.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8")
const adminCustomers = read("../../../pages/AdminCustomers.tsx")
const customerChat = read("CustomerChat.tsx")
const customerList = read("CustomerList.tsx")
const detailTabs = read("DetailTabs.tsx")
const orderSheet = read("CustomOrderSheet.tsx")
const orderDetail = read("CustomOrderDetail.tsx")
const useCustomerDataSrc = read("useCustomerData.ts")
const zh = read("../../../i18n/zh-TW.ts")
const en = read("../../../i18n/en.ts")

describe("A — activeProjectId resets synchronously on customer switch (防閃資料)", () => {
  it("no paint-later useEffect resets activeProjectId (that commits one stale frame)", () => {
    // An effect-based reset runs AFTER paint, so one committed frame still
    // carries the PREVIOUS customer's project id — OverviewTab hits the React
    // Query cache with that stale orderId and flashes the previous customer's
    // 售價/已收 facts card on the new customer.
    expect(adminCustomers).not.toMatch(
      /useEffect\(\(\) => \{\s*setActiveProjectId/,
    )
  })

  it("resets during render behind a prev-key guard (adjust-state-on-props pattern)", () => {
    expect(adminCustomers).toMatch(
      /if \(resetKey !== prevResetKey\) \{[\s\S]*?setPrevResetKey\(resetKey\)[\s\S]*?setActiveProjectId\(/,
    )
  })
})

describe("B — expanded chat panel is a viewport overlay (fixed), not in-flow (relative)", () => {
  // The ONE string-literal ternary on `expanded` is the panel className.
  const m = customerChat.match(/expanded\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/)
  const expandedCls = (m?.[1] ?? "").split(/\s+/)
  const collapsedCls = (m?.[2] ?? "").split(/\s+/)

  it("finds the panel className ternary (scanner sanity)", () => {
    expect(m, "expanded ? \"...\" : \"...\" className ternary not found").toBeTruthy()
  })

  it("expanded → fixed only; a trailing `relative` would win in the compiled CSS and squeeze the middle column instead of overlaying", () => {
    expect(expandedCls).toContain("fixed")
    expect(expandedCls).not.toContain("relative")
  })

  it("collapsed → relative (anchors the drag overlay), never fixed", () => {
    expect(collapsedCls).toContain("relative")
    expect(collapsedCls).not.toContain("fixed")
  })
})

describe("C — project summary never silently impersonates the whole-customer blend", () => {
  it("OverviewTab derives loading/fallback via the unit-tested deriveProjectSummaryState", () => {
    expect(detailTabs).toContain("deriveProjectSummaryState")
  })

  it("query failed / order gone → the whole-customer summary is labeled 整體 (overallCaption)", () => {
    expect(detailTabs).toContain("summary.overallCaption")
  })

  it("order still loading → skeleton, not unlabeled whole-customer text", () => {
    expect(detailTabs).toContain("animate-pulse")
  })
})

describe("D — 訂製單列表點哪張開哪張", () => {
  it("CustomOrderSheet honors an initialOrderId", () => {
    expect(orderSheet).toContain("initialOrderId")
  })

  it("row click passes THAT order's id (not open-newest)", () => {
    expect(detailTabs).toMatch(/setSheet\(\{ open: true, orderId: o\.id \}\)/)
  })
})

describe("E — approveDraft email branch sends the draft's attachments", () => {
  it("goes through buildEscalationReplyInput (zod-shaped, unit-tested in escalationReplyPayload.test.ts)", () => {
    expect(useCustomerDataSrc).toContain("buildEscalationReplyInput")
  })
})

describe("F — dead code removed", () => {
  it("client-side createManualCustomer (彈窗已刪, no caller) is gone", () => {
    expect(useCustomerDataSrc).not.toContain("createManualCustomer")
  })

  it("focusSection scroll logic (no caller ever passes it) is gone", () => {
    expect(orderDetail).not.toContain("focusSection")
    expect(orderSheet).not.toContain("focusSection")
  })

  it("orphan addModal i18n keys removed from BOTH locales", () => {
    expect(zh).not.toMatch(/\baddModal:/)
    expect(en).not.toMatch(/\baddModal:/)
  })
})

describe("G — create_customer 之後左欄清單要刷新(2026-07-01「新增客人也沒用」)", () => {
  // prod repro: chat「新增客人:測試二號…」→ create_customer 成功(tool chip 綠、
  // DB 有 row),但左欄 customerList/guestList 沒被 invalidate,新客人要 F5 才
  // 出現 → Jeff 讀成「沒用」。handleSend 的 finally 必須連清單一起刷新。
  const finallyBlock = customerChat.slice(customerChat.indexOf("} finally {"))

  it("handleSend finally invalidates admin.customerList", () => {
    expect(finallyBlock).toContain("utils.admin.customerList.invalidate()")
  })

  it("handleSend finally invalidates admin.guestList", () => {
    expect(finallyBlock).toContain("utils.admin.guestList.invalidate()")
  })
})

describe("H — slash 指令選單取代新增客人按鈕 (2026-07-01, Jeff:「slash 指令其實也ok…不需要新增客人按鈕」)", () => {
  it("CustomerList: the 新增客人 button and its onAddCustomer prop are gone", () => {
    expect(customerList).not.toContain("onAddCustomer")
    expect(customerList).not.toContain("admin.customers.add.")
  })

  it("AdminCustomers: chatFocusRef / onAddCustomer / onFocusReady wiring removed", () => {
    expect(adminCustomers).not.toContain("chatFocusRef")
    expect(adminCustomers).not.toContain("onAddCustomer")
    expect(adminCustomers).not.toContain("onFocusReady")
  })

  it("CustomerChat: onFocusReady prop fully removed (slash menu replaced its only use)", () => {
    expect(customerChat).not.toContain("onFocusReady")
  })

  it("CustomerChat: composer wires the unit-tested slash logic (filter + resolve + wrap-around nav)", () => {
    expect(customerChat).toContain("filterSlashCommands")
    expect(customerChat).toContain("resolveSlashSelection")
    expect(customerChat).toContain("moveSlashIndex")
  })

  it("keyboard: ArrowUp/ArrowDown/Enter/Escape are handled while the menu is open", () => {
    for (const key of ['"ArrowDown"', '"ArrowUp"', '"Enter"', '"Escape"']) {
      expect(customerChat).toContain(`e.key === ${key}`)
    }
  })

  it("IME 組字中 (isComposing) never intercepts keys — early return BEFORE the menu branch", () => {
    // The composing guard must run first, or Enter mid-組字 picks a command.
    const kd = customerChat.indexOf("e.nativeEvent.isComposing")
    const menuBranch = customerChat.indexOf("slashMatches.length > 0) {")
    expect(kd).toBeGreaterThan(-1)
    expect(menuBranch).toBeGreaterThan(-1)
    expect(kd).toBeLessThan(menuBranch)
  })

  it("menu card: rounded-xl overlay above the composer (bottom-full + z + shadow)", () => {
    expect(customerChat).toMatch(
      /role="listbox"[\s\S]{0,300}?absolute bottom-full[^"]*rounded-xl[^"]*border[^"]*bg-white[^"]*shadow-sm/,
    )
  })

  it("mouse: rows are clickable and mousedown keeps the textarea focused", () => {
    expect(customerChat).toContain("onClick={() => pickSlashCommand(cmd)}")
    expect(customerChat).toContain("onMouseDown={(e) => e.preventDefault()}")
  })

  it("操作說明 panel: rounded-xl overlay, closes on outside click and Esc", () => {
    expect(customerChat).toContain("admin.customers.slash.helpPanel.title")
    expect(customerChat).toMatch(/helpOpen[\s\S]{0,400}?onClick=\{\(\) => setHelpOpen\(false\)\}/)
    expect(customerChat).toMatch(/if \(e\.key === "Escape"\) setHelpOpen\(false\)/)
  })

  it("i18n: the slash block exists in BOTH locales, orphan add/addCustomerPrefill keys are gone", () => {
    for (const src of [zh, en]) {
      expect(src).toMatch(/\bslash:/)
      expect(src).toMatch(/\bhelpPanel:/)
      // Whole 新增客人 modal/button block is orphan now (modal died earlier,
      // button died with the slash menu).
      expect(src).not.toMatch(/\bbuttonTooltip:/)
      expect(src).not.toContain("addCustomerPrefill")
    }
  })
})
