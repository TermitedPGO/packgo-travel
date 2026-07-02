/**
 * slashCommands — unit tests for the composer "/" command menu logic
 * (2026-07-01: 新增客人按鈕拆掉,改成 slash 指令 + 操作說明面板).
 *
 * Pure-module tests: a fake resolver stands in for t() so both locales'
 * behavior (filtering matches the TRANSLATED name/desc) is covered without
 * loading the i18n bundles. The real zh-TW/en keys are asserted to exist in
 * cockpitUiGuards.regression.test.ts (source scan of both locale files).
 */
import { describe, expect, it } from "vitest"
import {
  SLASH_COMMANDS,
  isSlashQuery,
  filterSlashCommands,
  resolveSlashSelection,
  moveSlashIndex,
} from "./slashCommands"

/** Fake t(): zh-ish strings keyed like the real i18n tree. */
const STRINGS: Record<string, string> = {
  "admin.customers.slash.addCustomer.name": "新增客人",
  "admin.customers.slash.addCustomer.desc": "建一位新客人",
  "admin.customers.slash.addCustomer.template": "新增客人：",
  "admin.customers.slash.collect.name": "收信",
  "admin.customers.slash.collect.desc": "收齊這位客人的 Gmail 往來",
  "admin.customers.slash.collect.template": "收齊這位客人的對話",
  "admin.customers.slash.followup.name": "跟進日",
  "admin.customers.slash.followup.desc": "設定跟進日",
  "admin.customers.slash.followup.template": "跟進日設 ",
  "admin.customers.slash.note.name": "備註",
  "admin.customers.slash.note.desc": "在備註加一條",
  "admin.customers.slash.note.template": "備註加上：",
  "admin.customers.slash.createOrder.name": "建單",
  "admin.customers.slash.createOrder.desc": "建一張訂製單",
  "admin.customers.slash.createOrder.template": "幫這位客人建一張訂製單：",
  "admin.customers.slash.merge.name": "合併",
  "admin.customers.slash.merge.desc": "把這位客人併進另一位",
  "admin.customers.slash.merge.template": "把這位客人併進 ",
  "admin.customers.slash.help.name": "說明",
  "admin.customers.slash.help.desc": "看這個工作台能做什麼",
}
const resolve = (key: string) => STRINGS[key] ?? key

describe("SLASH_COMMANDS registry", () => {
  it("covers the七個指令 in spec order", () => {
    expect(SLASH_COMMANDS.map((c) => c.id)).toEqual([
      "addCustomer",
      "collect",
      "followup",
      "note",
      "createOrder",
      "merge",
      "help",
    ])
  })

  it("only 新增客人 and 說明 work without a pinned customer", () => {
    const noCustomer = SLASH_COMMANDS.filter((c) => !c.requiresCustomer).map((c) => c.id)
    expect(noCustomer).toEqual(["addCustomer", "help"])
  })

  it("說明 is the only command without a template (opens the panel instead)", () => {
    expect(SLASH_COMMANDS.filter((c) => c.templateKey === null).map((c) => c.id)).toEqual([
      "help",
    ])
  })
})

describe("isSlashQuery", () => {
  it("true for '/' and '/收'", () => {
    expect(isSlashQuery("/")).toBe(true)
    expect(isSlashQuery("/收")).toBe(true)
  })

  it("false for plain text, empty, or slash mid-string", () => {
    expect(isSlashQuery("")).toBe(false)
    expect(isSlashQuery("收信")).toBe(false)
    expect(isSlashQuery("a/b")).toBe(false)
  })

  it("false once the input goes multi-line (a pasted message is not a command)", () => {
    expect(isSlashQuery("/收\n第二行")).toBe(false)
  })
})

describe("filterSlashCommands", () => {
  it("non-slash input → menu closed (empty)", () => {
    expect(filterSlashCommands("你好", true, resolve)).toEqual([])
    expect(filterSlashCommands("", true, resolve)).toEqual([])
  })

  it("bare '/' with a pinned customer → all 7 commands", () => {
    expect(filterSlashCommands("/", true, resolve)).toHaveLength(7)
  })

  it("bare '/' without a pinned customer → only 新增客人 + 說明", () => {
    expect(filterSlashCommands("/", false, resolve).map((c) => c.id)).toEqual([
      "addCustomer",
      "help",
    ])
  })

  it("text after '/' filters live against the command NAME", () => {
    expect(filterSlashCommands("/收信", true, resolve).map((c) => c.id)).toEqual(["collect"])
    expect(filterSlashCommands("/跟進", true, resolve).map((c) => c.id)).toEqual(["followup"])
  })

  it("text after '/' also matches the 說明 text (desc)", () => {
    // 「訂製單」 only appears in createOrder's desc, not its name.
    expect(filterSlashCommands("/訂製單", true, resolve).map((c) => c.id)).toEqual([
      "createOrder",
    ])
  })

  it("matching is case-insensitive (English locale)", () => {
    const en = (key: string) =>
      key === "admin.customers.slash.collect.name" ? "Collect emails" : ""
    expect(filterSlashCommands("/COLLECT", true, en).map((c) => c.id)).toEqual(["collect"])
  })

  it("customer-scoped commands never surface without a pinned customer, even on exact match", () => {
    expect(filterSlashCommands("/收信", false, resolve)).toEqual([])
  })

  it("garbage query → no matches", () => {
    expect(filterSlashCommands("/zzzz", true, resolve)).toEqual([])
  })
})

describe("resolveSlashSelection", () => {
  it("template commands insert the resolved template text", () => {
    const collect = SLASH_COMMANDS.find((c) => c.id === "collect")!
    expect(resolveSlashSelection(collect, resolve)).toEqual({
      kind: "insert",
      text: "收齊這位客人的對話",
    })
  })

  it("跟進日/合併 templates keep their trailing space (caret parks after it)", () => {
    const followup = SLASH_COMMANDS.find((c) => c.id === "followup")!
    const sel = resolveSlashSelection(followup, resolve)
    expect(sel).toEqual({ kind: "insert", text: "跟進日設 " })
  })

  it("說明 opens the help panel (no insert)", () => {
    const help = SLASH_COMMANDS.find((c) => c.id === "help")!
    expect(resolveSlashSelection(help, resolve)).toEqual({ kind: "help" })
  })
})

describe("moveSlashIndex (ArrowUp/Down wrap-around)", () => {
  it("moves down and wraps at the end", () => {
    expect(moveSlashIndex(0, 1, 3)).toBe(1)
    expect(moveSlashIndex(2, 1, 3)).toBe(0)
  })

  it("moves up and wraps at the top", () => {
    expect(moveSlashIndex(1, -1, 3)).toBe(0)
    expect(moveSlashIndex(0, -1, 3)).toBe(2)
  })

  it("empty list stays at 0 (no NaN / negative index)", () => {
    expect(moveSlashIndex(0, 1, 0)).toBe(0)
    expect(moveSlashIndex(0, -1, 0)).toBe(0)
  })
})
