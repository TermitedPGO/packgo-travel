import { describe, it, expect } from "vitest"
import { guestToAdaptedCustomer } from "./adapters"

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
          { id: 1, subject: "日本團", status: "open", createdAt: "2026-06-01" },
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

  it("falls back to the raw email when it has no local part", () => {
    const c = guestToAdaptedCustomer({ profileId: 7, email: "@oddly.com", inquiries: [] }, t)
    expect(c.name).toBe("@oddly.com")
  })
})
