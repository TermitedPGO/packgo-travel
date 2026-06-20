export type ChecklistItem = {
  label: string
  s: "done" | "pending" | "missing" | "muted"
}

export type BundleItem = {
  icon: string
  type: string
  name: string
}

export type CustomerStatus = {
  type: "action" | "warn" | "good"
  title: string
  desc: string
  btn: string | null
  act: string
  checklist: ChecklistItem[]
  bundle: BundleItem[] | null
}

export type Draft = {
  type: string
  to: string
  attachments?: string[]
  body: string
}

export type Order = {
  name: string
  dest: string
  total: number
  paid: number
  status: "paid" | "partial" | "unpaid"
  date: string
}

export type Doc = {
  name: string
  type: string
  size: string
  date: string
}

export type TimelineEntry = {
  type: "inquiry" | "booking" | "payment" | "doc" | "chat"
  title: string
  desc: string
  time: string
  sortKey: number
}

export type ListItem = {
  id: number
  kind: "user" | "guest"
  name: string
  email: string
  phone: string
  initials: string
  color: string
  textColor: string
  lastContact: string
  tag: "inquiry" | "pending" | "active"
  tagLabel: string
  notifs: number
  /** registered account manually marked 非客人 (customerProfiles.status='blocked') */
  blocked: boolean
}

export type AdaptedCustomer = {
  id: number
  kind: "user" | "guest"
  name: string
  email: string
  phone: string
  initials: string
  color: string
  textColor: string
  aiSummary: { wants: string; actions: string; delivered: string }
  status: CustomerStatus
  drafts: Draft[]
  profile: {
    passport: string
    pref: string
    totalSpend: number
    trips: number
    vip: boolean
    lang: string
    source: string
  }
  orders: Order[]
  docs: Doc[]
  timeline: TimelineEntry[]
}

export type ChatMessage = {
  id: string
  senderRole: "customer" | "jeff"
  body: string
  context: string | null
  createdAt: Date
}
