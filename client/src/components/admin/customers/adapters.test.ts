import { describe, it, expect } from "vitest"
import { guestToAdaptedCustomer, deriveFollowup, buildInquiryEditedPayload, deriveProfile, deriveBallInCourt, deriveNextMove, isFollowUpDue, laToday } from "./adapters"

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
      followUpDate: null,
      isDue: false,
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

  // Q4-A — manual per-customer follow-up date threaded through deriveFollowup.
  it("threads followUpDate + derives isDue (independent of the inquiry/quote signals)", () => {
    // a past/today date with NO open items → not "needsFollowup" but IS due
    const due = deriveFollowup(
      { lastContactAt: null, openInquiries: [], sentQuotes: [], followUpDate: "2026-06-19" },
      NOW,
    )
    expect(due.followUpDate).toBe("2026-06-19")
    expect(due.isDue).toBe(true)
    expect(due.needsFollowup).toBe(false)

    // a future date → carried through, not yet due
    const future = deriveFollowup(
      { lastContactAt: null, openInquiries: [], sentQuotes: [], followUpDate: "2026-07-01" },
      NOW,
    )
    expect(future.followUpDate).toBe("2026-07-01")
    expect(future.isDue).toBe(false)

    // omitted → null + not due
    const none = deriveFollowup({ lastContactAt: null, openInquiries: [], sentQuotes: [] }, NOW)
    expect(none.followUpDate).toBeNull()
    expect(none.isDue).toBe(false)
  })
})

describe("isFollowUpDue / laToday — America/Los_Angeles, no UTC drift", () => {
  it("null is never due", () => {
    expect(isFollowUpDue(null, Date.now())).toBe(false)
  })

  it("today (LA) and earlier are due; tomorrow is not", () => {
    // 2026-06-20T05:00:00Z = 2026-06-19 22:00 PDT → LA calendar day is the 19th,
    // proving the compare uses LA local date, not the UTC date (the 20th).
    const now = new Date("2026-06-20T05:00:00Z").getTime()
    expect(laToday(now)).toBe("2026-06-19")
    expect(isFollowUpDue("2026-06-19", now)).toBe(true) // == today (LA)
    expect(isFollowUpDue("2026-06-18", now)).toBe(true) // past
    expect(isFollowUpDue("2026-06-20", now)).toBe(false) // tomorrow (LA)
  })

  it("at LA midnight crossing, the day rolls in LA not UTC", () => {
    // 2026-06-20T07:30:00Z = 2026-06-20 00:30 PDT → LA day is the 20th already.
    const now = new Date("2026-06-20T07:30:00Z").getTime()
    expect(laToday(now)).toBe("2026-06-20")
    expect(isFollowUpDue("2026-06-20", now)).toBe(true)
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

describe("deriveProfile — 護照 presence-only + 來源", () => {
  const user = { totalSpend: 1200, bookingCount: 3 }

  it("護照 shows 已提供 only when the server says hasPassport — never the number", () => {
    const off = deriveProfile(user, null, t, false)
    expect(off.passport).toBe("admin.customers.profile.notProvided")
    const on = deriveProfile(user, null, t, true)
    expect(on.passport).toBe("admin.customers.profile.passportOnFile")
    // defaults to not-provided when the flag is omitted (back-compat)
    expect(deriveProfile(user, null, t).passport).toBe(
      "admin.customers.profile.notProvided",
    )
  })

  it("來源 maps 'manual' → 手動新增, everything else → 未知 (never invents a channel)", () => {
    const manual = deriveProfile(
      user,
      { preferredLanguage: null, communicationStyle: null, preferences: null, vipScore: null, totalSpend: null, bookingCount: null, status: null, source: "manual" },
      t,
    )
    expect(manual.source).toBe("admin.customers.profile.sourceManual")
    const unknown = deriveProfile(
      user,
      { preferredLanguage: null, communicationStyle: null, preferences: null, vipScore: null, totalSpend: null, bookingCount: null, status: null, source: null },
      t,
    )
    expect(unknown.source).toBe("admin.customers.profile.unknownSource")
  })

  it("vip + lang + spend/trips still derive from the profile/user", () => {
    const p = deriveProfile(
      user,
      { preferredLanguage: "en", communicationStyle: null, preferences: null, vipScore: 60, totalSpend: null, bookingCount: null, status: null, source: null },
      t,
      true,
    )
    expect(p.vip).toBe(true)
    expect(p.lang).toBe("en")
    expect(p.totalSpend).toBe(1200)
    expect(p.trips).toBe(3)
  })

  it("a hand-added guest still gets 來源=手動新增 through guestToAdaptedCustomer", () => {
    const c = guestToAdaptedCustomer(
      { profileId: 7, name: "王先生", phone: "5105551234", source: "manual", inquiries: [] },
      t,
    )
    expect(c.profile.source).toBe("admin.customers.profile.sourceManual")
    expect(c.profile.passport).toBe("admin.customers.profile.notProvided")
  })
})

describe("deriveBallInCourt", () => {
  it("null when there are no messages", () => {
    expect(deriveBallInCourt([])).toBe(null)
  })
  it("customer's court when Jeff spoke last", () => {
    expect(
      deriveBallInCourt([{ senderRole: "customer" }, { senderRole: "jeff" }]),
    ).toBe("customer")
  })
  it("our court when the customer spoke last", () => {
    expect(
      deriveBallInCourt([{ senderRole: "jeff" }, { senderRole: "customer" }]),
    ).toBe("us")
  })
})

describe("deriveNextMove", () => {
  const fu = (needsFollowup: boolean) => ({
    daysSinceContact: needsFollowup ? 6 : 1,
    needsFollowup,
    reason: (needsFollowup ? "quote" : null) as "quote" | null,
  })
  it("none when there is no ball (no conversation)", () => {
    expect(deriveNextMove(null, fu(false))).toBe("none")
  })
  it("reply when the ball is on us", () => {
    expect(deriveNextMove("us", fu(false))).toBe("reply")
  })
  it("followup when ball on customer and overdue", () => {
    expect(deriveNextMove("customer", fu(true))).toBe("followup")
  })
  it("waiting when ball on customer and not overdue", () => {
    expect(deriveNextMove("customer", fu(false))).toBe("waiting")
  })
})
