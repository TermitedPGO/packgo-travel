import { describe, it, expect } from "vitest"
import { guestToAdaptedCustomer, toListItem, deriveFollowup, buildInquiryEditedPayload, deriveProfile, deriveBallInCourt, deriveNextMove, isFollowUpDue, laToday, formatMonthDayLA, pickDefaultProject, shouldCommitRename, filterProjects, countUnkeptPromises } from "./adapters"
import type { Project } from "./types"

const mkProject = (id: number, title = `t${id}`): Project => ({
  id,
  orderNumber: `ORD-2026-${String(id).padStart(4, "0")}`,
  title,
  category: null,
  status: "draft",
  departureDate: null,
})

describe("pickDefaultProject (customer-projects 0104)", () => {
  it("picks the newest project (list is createdAt-desc → [0])", () => {
    expect(pickDefaultProject([mkProject(9), mkProject(3), mkProject(1)])).toBe(9)
  })
  it("falls back to 未分類 (null) when there are no projects", () => {
    expect(pickDefaultProject([])).toBeNull()
  })
})

describe("shouldCommitRename (customer-projects 0104)", () => {
  it("commits only a non-empty, changed title", () => {
    expect(shouldCommitRename("北京機票", "北京來回機票")).toBe(true)
  })
  it("skips an unchanged title (ignoring surrounding whitespace)", () => {
    expect(shouldCommitRename("北京機票", "北京機票")).toBe(false)
    expect(shouldCommitRename("北京機票", "  北京機票  ")).toBe(false)
  })
  it("skips an empty / whitespace-only draft", () => {
    expect(shouldCommitRename("北京機票", "")).toBe(false)
    expect(shouldCommitRename("北京機票", "   ")).toBe(false)
  })
})

describe("filterProjects (ProjectBar quick filter, audit fix 2026-06-30)", () => {
  const projects = [
    mkProject(1, "北京來回機票"),
    mkProject(2, "東京賞櫻"),
    mkProject(3, "首爾自由行"),
  ]

  it("empty query returns everything unchanged", () => {
    expect(filterProjects(projects, "")).toEqual(projects)
    expect(filterProjects(projects, "   ")).toEqual(projects)
  })

  it("matches by title substring, case-insensitive", () => {
    expect(filterProjects(projects, "機票")).toEqual([projects[0]])
  })

  it("matches by order number substring", () => {
    expect(filterProjects(projects, "0002")).toEqual([projects[1]])
  })

  it("returns an empty array when nothing matches", () => {
    expect(filterProjects(projects, "完全不存在")).toEqual([])
  })
})

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

describe("toListItem — notifs (red dot) maps from the server unread count", () => {
  const tagLabel = { active: "active", inquiry: "inquiry", pending: "pending" }
  const formatDate = (d: Date) => d.toISOString().slice(0, 10)
  const base = {
    id: 7,
    name: "Wu",
    email: "wu@example.com",
    phone: null,
    bookingCount: 0,
    inquiryCount: 1,
    lastContactAt: null,
  }

  it("threads a positive unread count straight into notifs (3 → 3)", () => {
    expect(toListItem({ ...base, unread: 3 }, tagLabel, formatDate).notifs).toBe(3)
  })

  it("falls back to 0 when the server omits unread (undefined → 0)", () => {
    expect(toListItem(base, tagLabel, formatDate).notifs).toBe(0)
  })

  it("0 unread reads as a clean 0 (no red dot)", () => {
    expect(toListItem({ ...base, unread: 0 }, tagLabel, formatDate).notifs).toBe(0)
  })
})

describe("toListItem — lastContact 口徑 (Phase6 A2: 最後往來, not last-login)", () => {
  const tagLabel = { active: "active", inquiry: "inquiry", pending: "pending" }
  const formatDate = (d: Date) => d.toISOString().slice(0, 10)
  const base = {
    id: 7,
    name: "Wu",
    email: "wu@example.com",
    phone: null,
    bookingCount: 0,
    inquiryCount: 1,
    lastContactAt: null,
  }

  it("formats server-computed lastContactAt (inbound/outbound-newer), not a login timestamp", () => {
    // Regression guard for the 0909 bug: a member registered 5/13 but replied-to
    // by Jeff today must show today, not the 2-month-old signup/login date.
    const item = toListItem(
      { ...base, lastContactAt: "2026-07-03T12:00:00Z" },
      tagLabel,
      formatDate,
    )
    expect(item.lastContact).toBe("2026-07-03")
  })

  it("accepts a Date instance too (server may serialize either way)", () => {
    const item = toListItem(
      { ...base, lastContactAt: new Date("2026-07-01T00:00:00Z") },
      tagLabel,
      formatDate,
    )
    expect(item.lastContact).toBe("2026-07-01")
  })

  it("null lastContactAt (never any contact, no fallback reached) → empty string, not a crash", () => {
    expect(toListItem(base, tagLabel, formatDate).lastContact).toBe("")
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

// v787 P1 回爐 (d) — 列表「最後往來」M/D 渲染固定美西曆日,不吃本機時區。
describe("formatMonthDayLA — 列表日期以 America/Los_Angeles 渲染 M/D", () => {
  it("Emerald 案:inbound 7/3 14:30Z → 美西仍是 7/3", () => {
    expect(formatMonthDayLA(new Date("2026-07-03T14:30:00Z"))).toBe("7/3")
  })

  it("接近 UTC 午夜的時間戳,曆日以美西算不以 UTC 算(關鍵回歸)", () => {
    // 2026-07-05T02:00:27Z(舊 bug 拿 updatedAt=cron 蓋章那晚)= 美西 7/4 19:00,
    // 舊版 date-fns 照本機/UTC 會顯示 7/5,整整錯一天。這裡必須是 7/4。
    expect(formatMonthDayLA(new Date("2026-07-05T02:00:27Z"))).toBe("7/4")
  })

  it("接受 ISO 字串輸入(帶 Z)", () => {
    expect(formatMonthDayLA("2026-07-03T14:30:00Z")).toBe("7/3")
  })

  // 對抗審查 major 抓到的盲點:舊測試只餵帶 Z 的 ISO,永遠對,攔不到 guestList 送
  // 的「naive 無時區 mysql DATETIME 字串」被瀏覽器本機時區 parse 的錯日 bug。這幾條
  // 餵 naive 字串,鎖死「一律當 UTC 錨定、與跑測機時區無關」的契約。
  it("naive mysql DATETIME 字串(無時區)一律當 UTC → 美西曆日,不吃跑測機時區", () => {
    // 2026-07-03 14:30:00 視為 UTC = 美西 07:30 → 7/3。
    expect(formatMonthDayLA("2026-07-03 14:30:00")).toBe("7/3")
  })

  it("naive 字串落在 UTC 凌晨(美西前一天晚上)→ 曆日以美西算,不是 UTC(關鍵回歸)", () => {
    // 2026-07-03 02:00:00 視為 UTC = 美西 7/2 19:00 → 必須是 7/2。
    // 舊 code path(client 對 naive 字串跑 new Date 照本機時區)在非美西機器會顯示 7/3。
    expect(formatMonthDayLA("2026-07-03 02:00:00")).toBe("7/2")
  })

  it("null / undefined / 空 / 無法 parse → 空字串,不 crash", () => {
    expect(formatMonthDayLA(null)).toBe("")
    expect(formatMonthDayLA(undefined)).toBe("")
    expect(formatMonthDayLA("")).toBe("")
    expect(formatMonthDayLA("not-a-date")).toBe("")
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

describe("countUnkeptPromises — 真相條「未兌現承諾」徽章 (watchdog v2)", () => {
  it("只數 promise 類,margin(漏價)不算", () => {
    expect(
      countUnkeptPromises([
        { kind: "margin" },
        { kind: "promise" },
        { kind: "promise" },
      ]),
    ).toBe(2)
  })
  it("沒 findings → 0(query 還沒回 / 空陣列都不亮)", () => {
    expect(countUnkeptPromises(undefined)).toBe(0)
    expect(countUnkeptPromises(null)).toBe(0)
    expect(countUnkeptPromises([])).toBe(0)
  })
  it("全 margin → 0(漏價卡歸 OverviewTab,真相條不重複叫)", () => {
    expect(countUnkeptPromises([{ kind: "margin" }])).toBe(0)
  })
  it("kind 缺(舊 payload)→ 0,寧可漏報", () => {
    expect(countUnkeptPromises([{}])).toBe(0)
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
