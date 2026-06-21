import { describe, it, expect } from "vitest"
import { guestToAdaptedCustomer, deriveFollowup, buildInquiryEditedPayload } from "./adapters"

// t stub: echoes the key, appending the interpolated count so assertions can see it.
const t = (k: string, vars?: Record<string, string | number>) =>
  vars?.n != null ? `${k}:${vars.n}` : k

describe("guestToAdaptedCustomer", () => {
  const base = {
    profileId: 42,
    email: "jenny.chang.info@gmail.com",
  }

  it("derives name + initials from the email and is marked kind=guest", () => {
    const c = guestToAdaptedCustomer({ ...base, inquiries: [] }, t)
    expect(c.kind).toBe("guest")
    expect(c.id).toBe(42)
    expect(c.name).toBe("jenny.chang.info")
    expect(c.email).toBe(base.email)
    expect(c.initials).toBe("J")
    // a guest never has bookings/docs
    expect(c.orders).toEqual([])
    expect(c.docs).toEqual([])
  })

  it("an open (unresolved) inquiry surfaces as something needing attention, with a checklist", () => {
    const c = guestToAdaptedCustomer(
      {
        ...base,
        inquiries: [
          { id: 1, subject: "日本團", status: "new", createdAt: "2026-06-01" },
        ],
      },
      t,
    )
    // not "good" — an unresolved inquiry is an open item (warn if >48h overdue,
    // action otherwise; either way it must NOT read as all-clear)
    expect(c.status.type).not.toBe("good")
    expect(c.status.checklist.map((x) => x.label)).toContain("日本團")
    // aiSummary counts the inquiry
    expect(c.aiSummary.actions).toContain("admin.customers.summary.inquiries:1")
    // and the inquiry shows on the timeline
    expect(c.timeline.some((e) => e.type === "inquiry" && e.title === "日本團")).toBe(true)
  })

  it("a guest whose inquiries are all resolved reads as all-clear", () => {
    const c = guestToAdaptedCustomer(
      {
        ...base,
        inquiries: [
          { id: 1, subject: "韓國", status: "closed", createdAt: "2026-05-01" },
          { id: 2, subject: "報價", status: "resolved", createdAt: "2026-05-02" },
        ],
      },
      t,
    )
    expect(c.status.type).toBe("good")
    // even when resolved, history still shows on the timeline
    expect(c.timeline).toHaveLength(2)
  })

  it("prefers a real (manual) name over the email local part", () => {
    const c = guestToAdaptedCustomer(
      { profileId: 7, name: "張美玲", email: "ml@gmail.com", inquiries: [] },
      t,
    )
    expect(c.name).toBe("張美玲")
    expect(c.initials).toBe("張美")
    expect(c.email).toBe("ml@gmail.com")
  })

  it("supports a phone-only manual customer (no email): name, phone, no crash", () => {
    const c = guestToAdaptedCustomer(
      { profileId: 9, name: "Wang", email: null, phone: "+1 510 555 0000", inquiries: [] },
      t,
    )
    expect(c.kind).toBe("guest")
    expect(c.name).toBe("Wang")
    expect(c.email).toBe("")
    expect(c.phone).toBe("+1 510 555 0000")
    expect(c.status.type).toBe("good") // freshly added, no open items
  })

  it("falls back to phone, then the unnamed label, when there is no name/email", () => {
    expect(
      guestToAdaptedCustomer({ profileId: 1, phone: "0912345678", inquiries: [] }, t).name,
    ).toBe("0912345678")
    expect(
      guestToAdaptedCustomer({ profileId: 2, inquiries: [] }, t).name,
    ).toBe("admin.customers.unnamed")
  })
})

describe("deriveFollowup", () => {
  const NOW = new Date("2026-06-20T00:00:00Z").getTime()

  it("no contact + no open items → all clear, days null", () => {
    expect(deriveFollowup({ lastContactAt: null, openInquiries: [], sentQuotes: [] }, NOW)).toEqual({
      daysSinceContact: null,
      needsFollowup: false,
      reason: null,
    })
  })

  it("computes whole days since last contact (never negative)", () => {
    expect(
      deriveFollowup({ lastContactAt: "2026-06-17T00:00:00Z", openInquiries: [], sentQuotes: [] }, NOW)
        .daysSinceContact,
    ).toBe(3)
    // a future timestamp (clock skew) floors at 0, never negative
    expect(
      deriveFollowup({ lastContactAt: "2026-06-21T00:00:00Z", openInquiries: [], sentQuotes: [] }, NOW)
        .daysSinceContact,
    ).toBe(0)
  })

  it("open inquiry unanswered > 2 days → needs follow-up (reason inquiry)", () => {
    const r = deriveFollowup(
      { lastContactAt: null, openInquiries: [{ handled: false, createdAt: "2026-06-16T00:00:00Z" }], sentQuotes: [] },
      NOW,
    )
    expect(r.needsFollowup).toBe(true)
    expect(r.reason).toBe("inquiry")
  })

  it("a handled or <2d inquiry does NOT trigger", () => {
    expect(
      deriveFollowup({ lastContactAt: null, openInquiries: [{ handled: true, createdAt: "2026-06-01T00:00:00Z" }], sentQuotes: [] }, NOW)
        .needsFollowup,
    ).toBe(false)
    expect(
      deriveFollowup({ lastContactAt: null, openInquiries: [{ handled: false, createdAt: "2026-06-19T00:00:00Z" }], sentQuotes: [] }, NOW)
        .needsFollowup,
    ).toBe(false)
  })

  it("sent/viewed quote > 5 days → needs follow-up (reason quote)", () => {
    const r = deriveFollowup(
      { lastContactAt: null, openInquiries: [], sentQuotes: [{ status: "sent", createdAt: "2026-06-10T00:00:00Z" }] },
      NOW,
    )
    expect(r).toMatchObject({ needsFollowup: true, reason: "quote" })
    // a draft (not sent/viewed) quote never triggers
    expect(
      deriveFollowup({ lastContactAt: null, openInquiries: [], sentQuotes: [{ status: "draft", createdAt: "2026-01-01T00:00:00Z" }] }, NOW)
        .needsFollowup,
    ).toBe(false)
  })

  it("inquiry takes priority over quote when both are stale", () => {
    const r = deriveFollowup(
      {
        lastContactAt: "2026-06-15T00:00:00Z",
        openInquiries: [{ handled: false, createdAt: "2026-06-10T00:00:00Z" }],
        sentQuotes: [{ status: "viewed", createdAt: "2026-06-01T00:00:00Z" }],
      },
      NOW,
    )
    expect(r.reason).toBe("inquiry")
    expect(r.daysSinceContact).toBe(5)
  })
})

describe("buildInquiryEditedPayload", () => {
  const payload = JSON.stringify({
    inquiryId: 5,
    draftBody: "原稿",
    customerEmail: "a@b.com",
    classification: "refund_request",
  })

  it("replaces draftBody with the edit, preserves the other fields", () => {
    const out = JSON.parse(buildInquiryEditedPayload(payload, "改過的內容"))
    expect(out).toEqual({
      inquiryId: 5,
      draftBody: "改過的內容",
      customerEmail: "a@b.com",
      classification: "refund_request",
    })
  })

  it("THROWS rather than silently dropping the edit — empty/whitespace body", () => {
    expect(() => buildInquiryEditedPayload(payload, "")).toThrow()
    expect(() => buildInquiryEditedPayload(payload, "   ")).toThrow()
  })

  it("THROWS on missing or unparseable payload (never sends the original)", () => {
    expect(() => buildInquiryEditedPayload(null, "x")).toThrow()
    expect(() => buildInquiryEditedPayload("not json", "x")).toThrow()
    expect(() => buildInquiryEditedPayload("[1,2,3]", "x")).toThrow()
  })
})
