import { describe, it, expect } from "vitest"
import { stripQuotedReply } from "./conversationText"

describe("stripQuotedReply", () => {
  it("keeps top-posted new text, drops the 'On … wrote:' chain", () => {
    const body = [
      "謝謝中文行程表.",
      "能不能給我英文版?",
      "謝謝",
      "",
      "On Mon, Jun 15, 2026 at 2:34 PM Jeff Hsieh <jeffhsieh09@gmail.com> wrote:",
      "> Jenny 久等了,",
      "> 台灣 13 天的完整行程跟報價都確認好了",
      ">> On Wed, Jun 10, 2026 Jenny Chang wrote:",
      ">>> 謝謝",
    ].join("\n")
    expect(stripQuotedReply(body)).toBe("謝謝中文行程表.\n能不能給我英文版?\n謝謝")
  })

  it("drops leftover quoted lines even without an 'On … wrote:' header", () => {
    expect(stripQuotedReply("new line\n> quoted\n> more quoted")).toBe("new line")
  })

  it("handles a fully-quoted body by de-quoting then cutting at the boundary", () => {
    const body = [
      "> Hi Jeff,",
      "> 謝謝中文行程表.",
      "> 能不能給我英文版?",
      "> On Mon, Jun 15, 2026 at 2:34 PM Jeff Hsieh <x@y.com> wrote:",
      ">> Jenny 久等了,",
    ].join("\n")
    expect(stripQuotedReply(body)).toBe("Hi Jeff,\n謝謝中文行程表.\n能不能給我英文版?")
  })

  it("strips an -----Original Message----- block", () => {
    const body = "real reply\n\n-----Original Message-----\nFrom: someone\nold stuff"
    expect(stripQuotedReply(body)).toBe("real reply")
  })

  it("returns empty for empty/null input", () => {
    expect(stripQuotedReply("")).toBe("")
    expect(stripQuotedReply(null)).toBe("")
    expect(stripQuotedReply(undefined)).toBe("")
  })

  it("leaves a plain message with no quotes untouched", () => {
    expect(stripQuotedReply("just a normal message\nsecond line")).toBe(
      "just a normal message\nsecond line",
    )
  })
})
