/**
 * buildEscalationReplyInput — the approve→send payload for email drafts.
 *
 * 功能洞 (2026-07-01 六修 E): the draft card SHOWED attachment chips, but
 * useCustomerData's email branch sent only {messageId, body} — the files were
 * silently dropped from the customer's email. The builder now carries them in
 * the exact commandCenter.escalationReply zod shape
 * ({messageId, body, attachments?: {key, filename}[]}).
 *
 * Following the followupDraftProducer.test.ts precedent, the payload is fed
 * into the REAL send-side consumer — resolveReplyAttachments in
 * server/_core/replyAttachments.ts (pure, deps injected), the exact function
 * sendEscalationReply hands the refs to — so a drift in the ref shape or the
 * namespace rule breaks a test, not a customer send.
 */
import { describe, it, expect } from "vitest"
import { buildEscalationReplyInput, replyAttachmentDisplayName } from "./adapters"
import {
  resolveReplyAttachments,
  REPLY_ATTACHMENT_KEY_PREFIX,
} from "../../../../../server/_core/replyAttachments"

const KEY_A = `${REPLY_ATTACHMENT_KEY_PREFIX}42/1719800000000-ab12cd-quote.pdf`
const KEY_B = `${REPLY_ATTACHMENT_KEY_PREFIX}42/1719800000001-ef34gh-itinerary.pdf`

const draft = (over: Partial<{ messageId: number | null; body: string; attachments: string[] }> = {}) => ({
  messageId: 9001 as number | null,
  body: "李姊您好，附件是我們整理好的報價，您慢慢看。",
  attachments: [KEY_A],
  ...over,
})

describe("buildEscalationReplyInput", () => {
  it("carries the draft's attachments (the silent-drop bug)", () => {
    const input = buildEscalationReplyInput(draft())
    expect(input.messageId).toBe(9001)
    expect(input.attachments).toEqual([{ key: KEY_A, filename: "quote.pdf" }])
  })

  it("omits attachments entirely when the draft has none (matches optional zod)", () => {
    expect(buildEscalationReplyInput(draft({ attachments: [] }))).not.toHaveProperty("attachments")
    expect(
      buildEscalationReplyInput({ messageId: 1, body: "x" }),
    ).not.toHaveProperty("attachments")
  })

  it("Jeff's inline edit replaces the body, attachments intact", () => {
    const input = buildEscalationReplyInput(draft(), "改過的版本")
    expect(input.body).toBe("改過的版本")
    expect(input.attachments).toHaveLength(1)
  })

  it("throws on an empty body — a failed send must never look like a success", () => {
    expect(() => buildEscalationReplyInput(draft({ body: "  " }))).toThrow()
    expect(() => buildEscalationReplyInput(draft(), "   ")).toThrow()
  })

  it("throws on a missing messageId instead of firing a doomed mutation", () => {
    expect(() => buildEscalationReplyInput(draft({ messageId: null }))).toThrow()
  })

  it("every ref satisfies the server zod bounds (key ≤500, filename 1–255)", () => {
    const longName = `${REPLY_ATTACHMENT_KEY_PREFIX}42/1719800000002-zz99xx-${"長".repeat(300)}.pdf`
    const input = buildEscalationReplyInput(draft({ attachments: [KEY_A, longName] }))
    for (const a of input.attachments!) {
      expect(a.key.length).toBeGreaterThan(0)
      expect(a.key.length).toBeLessThanOrEqual(500)
      expect(a.filename.length).toBeGreaterThan(0)
      expect(a.filename.length).toBeLessThanOrEqual(255)
    }
  })

  describe("fed into the REAL send consumer (resolveReplyAttachments)", () => {
    const deps = {
      getBytes: async () => ({
        bytes: Buffer.from("pdf-bytes"),
        mimeType: "application/pdf",
        contentLength: 9,
      }),
      makeLink: async (key: string) => `https://r2.example/${key}`,
    }

    it("the customer receives EXACTLY the files the card's chips promised", async () => {
      const input = buildEscalationReplyInput(draft({ attachments: [KEY_A, KEY_B] }))
      const resolved = await resolveReplyAttachments(input.attachments!, deps)
      expect(resolved.inline.map((f) => f.filename)).toEqual(["quote.pdf", "itinerary.pdf"])
      expect(resolved.links).toEqual([])
      // and the chips showed the same derived names the send used
      expect([KEY_A, KEY_B].map(replyAttachmentDisplayName)).toEqual([
        "quote.pdf",
        "itinerary.pdf",
      ])
    })

    it("an out-of-namespace key ABORTS the send loudly (honest failure, no silent drop)", async () => {
      const input = buildEscalationReplyInput(
        draft({ attachments: ["customerDocuments/42/passport.jpg"] }),
      )
      await expect(resolveReplyAttachments(input.attachments!, deps)).rejects.toThrow(
        /out of namespace/,
      )
    })
  })
})
