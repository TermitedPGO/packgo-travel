import type {
  CustomerStatus,
  ChecklistItem,
  BundleItem,
  Order,
  TimelineEntry,
  ListItem,
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
} | null

type UserData = {
  totalSpend: number
  bookingCount: number
}

export function deriveProfile(
  user: UserData,
  profileData: ProfileData,
  t: TFunc,
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
    passport: t("admin.customers.profile.notProvided"),
    pref: prefs?.pace ?? prefs?.interests?.[0] ?? t("admin.customers.profile.noPref"),
    totalSpend: user.totalSpend,
    trips: user.bookingCount,
    vip: (profileData?.vipScore ?? 0) >= 50,
    lang: profileData?.preferredLanguage ?? "zh-TW",
    source: t("admin.customers.profile.unknownSource"),
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
    notifs: 0,
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

  for (const b of bookings) {
    entries.push({
      type: "booking",
      title: b.tourTitle ?? "Booking",
      desc: b.bookingStatus,
      time: new Date(b.createdAt).toLocaleDateString("zh-TW", {
        month: "numeric",
        day: "numeric",
      }),
    })
  }
  for (const q of inquiries) {
    entries.push({
      type: "inquiry",
      title: q.subject ?? "Inquiry",
      desc: q.status,
      time: new Date(q.createdAt).toLocaleDateString("zh-TW", {
        month: "numeric",
        day: "numeric",
      }),
    })
  }
  for (const p of points) {
    entries.push({
      type: "payment",
      title: p.description ?? p.reason,
      desc: `${p.delta > 0 ? "+" : ""}${p.delta}`,
      time: new Date(p.createdAt).toLocaleDateString("zh-TW", {
        month: "numeric",
        day: "numeric",
      }),
    })
  }

  entries.sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  )
  return entries
}
