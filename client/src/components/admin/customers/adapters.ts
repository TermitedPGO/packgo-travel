import type {
  CustomerStatus,
  ChecklistItem,
  BundleItem,
  Order,
  TimelineEntry,
  ListItem,
  AdaptedCustomer,
  Project,
} from "./types"

const AVATAR_PALETTE = [
  { bg: "#DBEAFE", text: "#1E40AF" },
  { bg: "#E0E7FF", text: "#3730A3" },
  { bg: "#D1FAE5", text: "#065F46" },
  { bg: "#FEF3C7", text: "#92400E" },
  { bg: "#FCE7F3", text: "#9D174D" },
  { bg: "#F3E8FF", text: "#6B21A8" },
  { bg: "#E5E7EB", text: "#374151" },
  { bg: "#CCFBF1", text: "#134E4A" },
] as const

export function deriveInitials(name: string | null, email: string): string {
  if (!name) return email.charAt(0).toUpperCase()
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    const a = parts[0].charAt(0)
    const b = parts[parts.length - 1].charAt(0)
    return (a + b).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function deriveAvatar(id: number) {
  const p = AVATAR_PALETTE[id % AVATAR_PALETTE.length]
  return { color: p.bg, textColor: p.text }
}

type TFunc = (key: string, vars?: Record<string, string | number>) => string

// ── deriveStatus ────────────────────────────────────────

type OpenItems = {
  counts: { total: number }
  openBookings: Array<{
    id: number
    tourTitle: string | null
    bookingStatus: string
    paymentStatus: string
    handled: boolean
  }>
  openInquiries: Array<{
    id: number
    subject: string | null
    status: string
    handled: boolean
    createdAt: Date
  }>
  pendingTasks: Array<{
    id: number
    title: string
    taskType: string
    payload: string
    handled: boolean
  }>
  openVisas: Array<{
    id: number
    visaType: string
    applicationStatus: string
    firstName: string | null
    lastName: string | null
  }>
}

export function deriveStatus(
  openItems: OpenItems | null,
  t: TFunc,
): CustomerStatus {
  if (!openItems || openItems.counts.total === 0) {
    return {
      type: "good",
      title: t("admin.customers.status.allClear"),
      desc: t("admin.customers.status.allClearDesc"),
      btn: null,
      act: "",
      checklist: [],
      bundle: null,
    }
  }

  const checklist: ChecklistItem[] = []

  for (const b of openItems.openBookings) {
    checklist.push({
      label: b.tourTitle ?? t("admin.customers.cl.booking"),
      s: b.handled ? "done" : "pending",
    })
  }
  for (const q of openItems.openInquiries) {
    checklist.push({
      label: q.subject ?? t("admin.customers.cl.inquiry"),
      s: q.handled ? "done" : "pending",
    })
  }
  for (const task of openItems.pendingTasks) {
    checklist.push({
      label: task.title,
      s: task.handled ? "done" : "pending",
    })
  }
  for (const v of openItems.openVisas) {
    const name = [v.firstName, v.lastName].filter(Boolean).join(" ")
    checklist.push({
      label: `${t("admin.customers.cl.visa")} ${name}`.trim(),
      s: v.applicationStatus === "processing" ? "pending" : "muted",
    })
  }

  const hasUnpaid = openItems.openBookings.some(
    (b) => b.paymentStatus === "unpaid",
  )
  const oldInquiry = openItems.openInquiries.some((q) => {
    const age = Date.now() - new Date(q.createdAt).getTime()
    return !q.handled && age > 48 * 60 * 60 * 1000
  })

  let bundle: BundleItem[] | null = null
  const quoteTasks = openItems.pendingTasks.filter(
    (t) => t.taskType === "quote",
  )
  if (quoteTasks.length > 0) {
    bundle = quoteTasks.map((qt) => ({
      icon: "PDF",
      type: "PDF",
      name: qt.title,
    }))
  }

  if (hasUnpaid || oldInquiry) {
    const title = hasUnpaid
      ? t("admin.customers.status.paymentOverdue")
      : t("admin.customers.status.inquiryOverdue")
    return {
      type: "warn",
      title,
      desc: hasUnpaid
        ? t("admin.customers.status.paymentOverdueDesc")
        : t("admin.customers.status.inquiryOverdueDesc"),
      btn: t("admin.customers.status.sendReminder"),
      act: "sendReminder",
      checklist: checklist.slice(0, 8),
      bundle,
    }
  }

  const unhandled = openItems.pendingTasks.filter((t) => !t.handled)
  return {
    type: "action",
    title:
      unhandled.length > 0
        ? unhandled[0].title
        : t("admin.customers.status.openItems", {
            n: openItems.counts.total,
          }),
    desc: t("admin.customers.status.openItemsDesc", {
      n: openItems.counts.total,
    }),
    btn: t("admin.customers.status.review"),
    act: "review",
    checklist: checklist.slice(0, 8),
    bundle,
  }
}

// ── deriveAiSummary ─────────────────────────────────────

type DetailData = {
  user: { bookingCount: number; inquiryCount: number; totalSpend: number }
  recentBookings: Array<{
    tourTitle: string | null
    bookingStatus: string
    totalPrice: number
  }>
  recentInquiries: Array<{ subject: string | null; status: string }>
  recentQuotes: Array<{
    quoteNumber: string | null
    estimatedTotal: number | null
    status: string
  }>
}

export function deriveAiSummary(
  detail: DetailData | null,
  openItems: OpenItems | null,
  t: TFunc,
): { wants: string; actions: string; delivered: string } {
  if (!detail) {
    return {
      wants: t("admin.customers.summary.noData"),
      actions: t("admin.customers.summary.noData"),
      delivered: t("admin.customers.summary.noData"),
    }
  }

  const openSubjects = openItems?.openInquiries
    .map((q) => q.subject)
    .filter(Boolean) as string[]
  const openTours = openItems?.openBookings
    .map((b) => b.tourTitle)
    .filter(Boolean) as string[]
  const wantsParts = [...(openSubjects ?? []), ...(openTours ?? [])]
  const wants =
    wantsParts.length > 0
      ? wantsParts.join("、")
      : t("admin.customers.summary.noActiveRequests")

  const parts: string[] = []
  if (detail.user.bookingCount > 0)
    parts.push(
      t("admin.customers.summary.bookings", { n: detail.user.bookingCount }),
    )
  if (detail.user.inquiryCount > 0)
    parts.push(
      t("admin.customers.summary.inquiries", { n: detail.user.inquiryCount }),
    )
  if (detail.recentQuotes.length > 0)
    parts.push(
      t("admin.customers.summary.quotes", { n: detail.recentQuotes.length }),
    )
  const actions =
    parts.length > 0
      ? parts.join("、")
      : t("admin.customers.summary.noActions")

  const confirmed = detail.recentBookings.filter(
    (b) => b.bookingStatus === "confirmed" || b.bookingStatus === "completed",
  )
  const deliveredParts = confirmed.map(
    (b) => b.tourTitle ?? t("admin.customers.summary.booking"),
  )
  const issuedQuotes = detail.recentQuotes.filter(
    (q) => q.status === "sent" || q.status === "viewed",
  )
  for (const q of issuedQuotes) {
    deliveredParts.push(
      `${q.quoteNumber ?? "Quote"} $${(q.estimatedTotal ?? 0).toLocaleString()}`,
    )
  }
  const delivered =
    deliveredParts.length > 0
      ? deliveredParts.join("、")
      : t("admin.customers.summary.nothingYet")

  return { wants, actions, delivered }
}

// ── deriveProfile ───────────────────────────────────────

type ProfileData = {
  preferredLanguage: string | null
  communicationStyle: string | null
  preferences: unknown
  vipScore: number | null
  totalSpend: number | null
  bookingCount: number | null
  status: string | null
  source: string | null
} | null

type UserData = {
  totalSpend: number
  bookingCount: number
}

/**
 * 來源 label. customerProfiles.source only carries 'manual' (Jeff hand-added
 * this customer) — every other origin (inquiry / email / wechat) is not
 * recorded at the profile level, so we say 未知 rather than inventing a channel.
 */
function sourceLabel(source: string | null | undefined, t: TFunc): string {
  if (source === "manual") return t("admin.customers.profile.sourceManual")
  return t("admin.customers.profile.unknownSource")
}

export function deriveProfile(
  user: UserData,
  profileData: ProfileData,
  t: TFunc,
  // 護照 is presence-only — the number never reaches the client. `hasPassport`
  // is an EXISTS result from the server (booking participant / visa application
  // ciphertext is non-null), so 護照 shows 已提供 / 未提供, nothing else.
  hasPassport = false,
): {
  passport: string
  pref: string
  totalSpend: number
  trips: number
  vip: boolean
  lang: string
  source: string
} {
  const prefs = profileData?.preferences as
    | { pace?: string; interests?: string[] }
    | null
  return {
    passport: hasPassport
      ? t("admin.customers.profile.passportOnFile")
      : t("admin.customers.profile.notProvided"),
    pref: prefs?.pace ?? prefs?.interests?.[0] ?? t("admin.customers.profile.noPref"),
    totalSpend: user.totalSpend,
    trips: user.bookingCount,
    vip: (profileData?.vipScore ?? 0) >= 50,
    lang: profileData?.preferredLanguage ?? "zh-TW",
    source: sourceLabel(profileData?.source, t),
  }
}

// ── toListItem ──────────────────────────────────────────

type RawUser = {
  id: number
  name: string | null
  email: string
  phone: string | null
  bookingCount: number
  inquiryCount: number
  lastSignedIn: Date | null
  blocked?: boolean
  needsFollowup?: boolean
  followUpDate?: string | null
  /** unread agentMessages filed against this customer (server COUNT, readByJeff=0) */
  unread?: number
}

export function toListItem(
  raw: RawUser,
  tagLabel: Record<string, string>,
  formatDate: (d: Date) => string,
): ListItem {
  const avatar = deriveAvatar(raw.id)
  const hasBooking = raw.bookingCount > 0
  const hasInquiry = raw.inquiryCount > 0
  const tag: ListItem["tag"] = hasBooking
    ? "active"
    : hasInquiry
      ? "inquiry"
      : "pending"
  return {
    id: raw.id,
    kind: "user",
    name: raw.name ?? raw.email.split("@")[0],
    email: raw.email,
    phone: raw.phone ?? "",
    initials: deriveInitials(raw.name, raw.email),
    ...avatar,
    lastContact: raw.lastSignedIn ? formatDate(raw.lastSignedIn) : "",
    tag,
    tagLabel: tagLabel[tag] ?? tag,
    notifs: raw.unread ?? 0,
    blocked: raw.blocked ?? false,
    // Light up the sidebar 需跟進 badge for an auto-detected stale inquiry/quote
    // (server flag) OR a manually-set follow-up date that is due today (Q4-A).
    // isFollowUpDue is LA-correct so the list dot matches the per-card truth bar.
    needsFollowup: (raw.needsFollowup ?? false) || isFollowUpDue(raw.followUpDate ?? null, Date.now()),
  }
}

// ── deriveFollowup ──────────────────────────────────────
// "上次聯絡 X 天前" + 是否「需跟進」. Jeff's rule (locked 2026-06-20):
//   - an OPEN inquiry unanswered for > 2 days, OR
//   - a quote sent (sent/viewed) > 5 days ago with no movement.
// Pure + now-injected so it is deterministic to test.

export const FOLLOWUP_INQUIRY_DAYS = 2
export const FOLLOWUP_QUOTE_DAYS = 5
const DAY_MS = 86_400_000

export type Followup = {
  daysSinceContact: number | null
  needsFollowup: boolean
  reason: "inquiry" | "quote" | null
  // Q4-A — Jeff's manually-set per-customer follow-up date. `followUpDate` is the
  // stored "YYYY-MM-DD" (or null = none set); `isDue` is true when it is set and
  // on or before today in America/Los_Angeles (Newark CA), so a date 沒到期 still
  // shows lightly but only a due date raises the dark「今天該跟進」banner.
  followUpDate: string | null
  isDue: boolean
}

/**
 * Today's calendar date in America/Los_Angeles as "YYYY-MM-DD". Deterministic —
 * uses Intl with an explicit timeZone so it never depends on the server/browser
 * UTC offset (Jeff is in Newark CA; a UTC getDate would flip a day early/late).
 */
export function laToday(now: number): string {
  // en-CA renders ISO-shaped YYYY-MM-DD; the timeZone does the offset work.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now))
}

/** A follow-up date is due when set and its calendar day <= today (LA). Pure
 *  lexical compare — both sides are zero-padded "YYYY-MM-DD", so string <= works. */
export function isFollowUpDue(followUpDate: string | null, now: number): boolean {
  if (!followUpDate) return false
  return followUpDate <= laToday(now)
}

export function deriveFollowup(
  input: {
    lastContactAt: Date | string | null
    openInquiries: { handled: boolean; createdAt: Date | string }[]
    sentQuotes: { status: string; createdAt: Date | string }[]
    /** customerProfiles.followUpDate as "YYYY-MM-DD" (or null). */
    followUpDate?: string | null
  },
  now: number,
): Followup {
  const daysSinceContact =
    input.lastContactAt != null
      ? Math.max(0, Math.floor((now - new Date(input.lastContactAt).getTime()) / DAY_MS))
      : null

  const inquiryOverdue = input.openInquiries.some(
    (q) => !q.handled && now - new Date(q.createdAt).getTime() > FOLLOWUP_INQUIRY_DAYS * DAY_MS,
  )
  const quoteStale = input.sentQuotes.some(
    (q) =>
      (q.status === "sent" || q.status === "viewed") &&
      now - new Date(q.createdAt).getTime() > FOLLOWUP_QUOTE_DAYS * DAY_MS,
  )
  const reason: Followup["reason"] = inquiryOverdue ? "inquiry" : quoteStale ? "quote" : null
  const followUpDate = input.followUpDate ?? null
  return {
    daysSinceContact,
    needsFollowup: reason !== null,
    reason,
    followUpDate,
    isDue: isFollowUpDue(followUpDate, now),
  }
}

// ── countUnkeptPromises (真相條「未兌現承諾」徽章, watchdog v2) ──────────
// watchdogForCustomer 回 kind 判別的聯集(margin=漏價 / promise=答應了還沒寄)。
// 真相條只浮出 promise 類的數量(黑底到期感,樣式同跟進日徽章);漏價卡留在
// OverviewTab。純函式、零 LLM — server 已做完 deterministic 判斷,這裡只數數。

export function countUnkeptPromises(
  findings: Array<{ kind?: string }> | null | undefined,
): number {
  if (!findings) return 0
  return findings.filter((f) => f.kind === "promise").length
}

// ── deriveBallInCourt / deriveNextMove (五秒真相條, Step 1) ─────────────
// 「球在誰、下一步」: deterministic from the REAL conversation + the existing
// followup signal. Pure, no LLM, no `now` — trivially testable. The truth strip
// at the top of the customer page is built only from these (facts, not guesses).

export type BallInCourt = "us" | "customer" | null
export type NextMove = "reply" | "followup" | "waiting" | "none"

/**
 * Who spoke last → whose move it is. Newest message from Jeff means the ball is
 * in the CUSTOMER's court (we are waiting on them); newest from the customer
 * means the ball is on US (we owe a reply). No messages → null.
 * `messages` is oldest-first (the order the panel renders the thread).
 */
export function deriveBallInCourt(
  messages: { senderRole: "customer" | "jeff" }[],
): BallInCourt {
  if (messages.length === 0) return null
  const last = messages[messages.length - 1]
  return last.senderRole === "jeff" ? "customer" : "us"
}

/**
 * The single next move, from ball + the existing followup signal. Customer spoke
 * last → reply. We spoke last → follow up if overdue (followup.needsFollowup),
 * otherwise just wait.
 */
export function deriveNextMove(ball: BallInCourt, followup: Followup): NextMove {
  if (ball === null) return "none"
  if (ball === "us") return "reply"
  return followup.needsFollowup ? "followup" : "waiting"
}

// ── guestToAdaptedCustomer ──────────────────────────────
// A guest (unregistered email lead who inquired) has no user row, so
// customerDetail returns nothing for them. Jeff's rule: an inquiry counts as a
// customer even without an account, so they must be fully viewable. We build the
// same AdaptedCustomer shape the detail pane expects out of the guest's
// inquiries — REUSING the registered derive* helpers by synthesizing their
// inputs, so guest and registered panes stay behaviourally identical.

type GuestInquiry = {
  id: number
  subject: string | null
  status: string
  createdAt: Date | string
}

// An inquiry still needs action only while new / in_progress — the SAME
// allow-list the server's needsFollowup EXISTS uses (OPEN_INQUIRY_STATUSES in
// adminCustomers.ts), so the list badge and the detail recompute can't drift as
// the inquiry enum grows (replied/resolved/closed all count as handled).
export const OPEN_INQUIRY_STATUSES = new Set(["new", "in_progress"])

/**
 * Rebuild an inquiry draft's approvalTasks.payload JSON with Jeff's inline edit.
 * THROWS rather than silently falling back — on a 碰錢碰法律 send, dropping the
 * edit and shipping the original would be worse than an error. Guards an empty
 * body (mirrors the server's min(1)) and a missing/unparseable payload.
 */
export function buildInquiryEditedPayload(
  payloadJson: string | null,
  editedBody: string,
): string {
  if (!editedBody.trim()) throw new Error("empty draft body")
  if (!payloadJson) throw new Error("missing draft payload")
  let p: Record<string, unknown>
  try {
    const parsed = JSON.parse(payloadJson)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("bad payload shape")
    }
    p = parsed as Record<string, unknown>
  } catch {
    throw new Error("unparseable draft payload")
  }
  return JSON.stringify({ ...p, draftBody: editedBody })
}

/** commandCenter.escalationReply input (mirror of the server zod; the call site
 *  in useCustomerData type-checks this against the tRPC-inferred input, so a
 *  server shape change breaks compile, not a send). */
export type EscalationReplyInput = {
  messageId: number
  body: string
  attachments?: { key: string; filename: string }[]
}

/**
 * Human filename for a reply-attachment R2 key
 * (reply-attachments/<scope>/<ts>-<rand>-<safeName> → safeName). Falls back to
 * the last path segment / the raw string, so it never returns empty (the server
 * zod requires filename min(1)).
 */
export function replyAttachmentDisplayName(keyOrName: string): string {
  const base = keyOrName.split("/").pop() ?? keyOrName
  const m = base.match(/^\d{10,}-[a-z0-9]{4,8}-(.+)$/)
  return ((m ? m[1] : base).trim() || "file").slice(0, 255)
}

/**
 * Build the escalationReply mutation input from an email draft card. The
 * draft's attachments ride along — before this builder the email branch sent
 * only {messageId, body}, so a card SHOWING attachment chips silently sent
 * without them. Attachment strings are the R2 keys the draft was stored with
 * (reply-attachments/ namespace); the display filename is derived from the key.
 * A key outside the namespace makes the server ABORT the send with an honest
 * error (resolveReplyAttachments guard) — never a silent drop. THROWS on empty
 * body / missing messageId, same honesty rule as buildInquiryEditedPayload.
 */
export function buildEscalationReplyInput(
  draft: { messageId: number | null; body: string; attachments?: string[] },
  editedBody?: string,
): EscalationReplyInput {
  if (draft.messageId == null) throw new Error("missing messageId")
  const body = editedBody ?? draft.body
  if (!body.trim()) throw new Error("empty draft body")
  const refs = (draft.attachments ?? []).filter((a) => a.trim().length > 0)
  return {
    messageId: draft.messageId,
    body,
    // No slice(0, 10): the server zod caps at 10 and rejecting loudly beats
    // silently mailing fewer files than the card promised.
    ...(refs.length > 0
      ? {
          attachments: refs.map((key) => ({
            key,
            filename: replyAttachmentDisplayName(key),
          })),
        }
      : {}),
  }
}

export function guestToAdaptedCustomer(
  guest: {
    profileId: number
    name?: string | null
    email?: string | null
    phone?: string | null
    source?: string | null
    hasPassport?: boolean
    inquiries: GuestInquiry[]
  },
  t: TFunc,
): AdaptedCustomer {
  const avatar = deriveAvatar(guest.profileId)
  const email = guest.email ?? ""
  const phone = guest.phone ?? ""
  // Prefer the real (manual) name, fall back to the email local part, then the
  // phone, so a phone-only manual customer still shows something identifiable.
  const name =
    guest.name?.trim() ||
    email.split("@")[0] ||
    phone ||
    t("admin.customers.unnamed")

  // Synthesize the OpenItems shape deriveStatus / deriveAiSummary expect.
  const openInquiries = guest.inquiries.map((i) => ({
    id: i.id,
    subject: i.subject,
    status: i.status,
    handled: !OPEN_INQUIRY_STATUSES.has(i.status),
    createdAt: new Date(i.createdAt),
  }))
  const openItems: OpenItems = {
    counts: { total: openInquiries.filter((q) => !q.handled).length },
    openBookings: [],
    openInquiries,
    pendingTasks: [],
    openVisas: [],
  }

  const aiSummary = deriveAiSummary(
    {
      user: { bookingCount: 0, inquiryCount: guest.inquiries.length, totalSpend: 0 },
      recentBookings: [],
      recentInquiries: guest.inquiries.map((i) => ({
        subject: i.subject,
        status: i.status,
      })),
      recentQuotes: [],
    },
    openItems,
    t,
  )

  const timeline = toTimeline(
    [],
    guest.inquiries.map((i) => ({
      subject: i.subject,
      status: i.status,
      createdAt: new Date(i.createdAt),
    })),
    [],
  )

  return {
    id: guest.profileId,
    kind: "guest",
    name,
    email,
    phone,
    initials: deriveInitials(guest.name ?? null, email || phone || "?"),
    ...avatar,
    aiSummary,
    // overridden by the hook with the conversation-thread-based value; default
    // here keeps guestToAdaptedCustomer self-contained + testable.
    followup: { daysSinceContact: null, needsFollowup: false, reason: null, followUpDate: null, isDue: false },
    status: deriveStatus(openItems, t),
    drafts: [],
    profile: deriveProfile(
      { totalSpend: 0, bookingCount: 0 },
      // Guests carry no AI profile row; only `source` (e.g. 'manual' for a
      // hand-added customer) is meaningful for the 來源 line.
      {
        preferredLanguage: null,
        communicationStyle: null,
        preferences: null,
        vipScore: null,
        totalSpend: null,
        bookingCount: null,
        status: null,
        source: guest.source ?? null,
      },
      t,
      guest.hasPassport ?? false,
    ),
    orders: [],
    docs: [],
    timeline,
  }
}

// ── toOrders ────────────────────────────────────────────

type RawBooking = {
  tourTitle: string | null
  bookingStatus: string
  paymentStatus: string
  totalPrice: number
  currency: string
  createdAt: Date
}

export function toOrders(bookings: RawBooking[]): Order[] {
  return bookings.map((b) => {
    let status: Order["status"] = "unpaid"
    if (b.paymentStatus === "paid") status = "paid"
    else if (b.paymentStatus === "partial") status = "partial"
    return {
      name: b.tourTitle ?? "",
      dest: b.tourTitle ?? "",
      total: b.totalPrice,
      paid: status === "paid" ? b.totalPrice : 0,
      status,
      date: new Date(b.createdAt).toLocaleDateString("zh-TW", {
        month: "numeric",
        day: "numeric",
      }),
    }
  })
}

// ── toTimeline ──────────────────────────────────────────

export function toTimeline(
  bookings: Array<{
    tourTitle: string | null
    bookingStatus: string
    createdAt: Date
  }>,
  inquiries: Array<{
    subject: string | null
    status: string
    createdAt: Date
  }>,
  points: Array<{
    reason: string
    delta: number
    description: string | null
    createdAt: Date
  }>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  const fmt = (d: Date) =>
    new Date(d).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })

  for (const b of bookings) {
    entries.push({
      type: "booking",
      title: b.tourTitle ?? "Booking",
      desc: b.bookingStatus,
      time: fmt(b.createdAt),
      sortKey: new Date(b.createdAt).getTime(),
    })
  }
  for (const q of inquiries) {
    entries.push({
      type: "inquiry",
      title: q.subject ?? "Inquiry",
      desc: q.status,
      time: fmt(q.createdAt),
      sortKey: new Date(q.createdAt).getTime(),
    })
  }
  for (const p of points) {
    entries.push({
      type: "payment",
      title: p.description ?? p.reason,
      desc: `${p.delta > 0 ? "+" : ""}${p.delta}`,
      time: fmt(p.createdAt),
      sortKey: new Date(p.createdAt).getTime(),
    })
  }

  entries.sort((a, b) => b.sortKey - a.sortKey)
  return entries
}

// ── customer-projects (0104) — ProjectBar pure rules ────────────────────────

/**
 * Default project when a customer (or their project set) loads: the newest one
 * (the list arrives createdAt-desc, so [0]), else 未分類 (null) when they have
 * no projects. Jeff's daily landing — see design.md §12.2.
 */
export function pickDefaultProject(projects: Project[]): number | null {
  return projects[0]?.id ?? null
}

/**
 * Whether an inline rename should fire: only when the trimmed text is non-empty
 * AND actually changed. Empty / unchanged → no-op (don't write the order title).
 */
export function shouldCommitRename(current: string, draft: string): boolean {
  const next = draft.trim()
  return next.length > 0 && next !== current
}

/**
 * ProjectBar quick filter (audit fix, 2026-06-30) — case-insensitive substring
 * match on title or order number. Empty query → show everything (the filter
 * input is a convenience, not a hard gate).
 */
export function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase()
  if (!q) return projects
  return projects.filter(
    (p) => p.title.toLowerCase().includes(q) || p.orderNumber.toLowerCase().includes(q),
  )
}
