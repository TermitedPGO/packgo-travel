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
  /** namespaced id from the server (task:<id> / esc:<id>) — stable React key */
  id: string
  source: "inquiry" | "email"
  /** classification / "inquiry_reply" / "escalation" — the type label */
  type: string
  to: string
  subject: string | null
  attachments?: string[]
  body: string
  /** 碰錢碰法律 (refund/complaint/quote/deposit/visa) → confirm before send */
  sensitive: boolean
  /** source=inquiry → commandCenter.approve/reject({ id: taskId }) */
  taskId: number | null
  /** source=email → commandCenter.escalationReply({ messageId }) */
  messageId: number | null
  /** source=inquiry → original approvalTasks.payload JSON (rebuild editedPayload on edit) */
  payload: string | null
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
  id: string
  kind: "quote" | "invoice" | "passport" | "visa" | "insurance" | "medical" | "file" | "flight" | "confirmation"
  name: string
  /** download link; null = info-only row (e.g. flight order) */
  url: string | null
  /** short secondary line: status / amount */
  meta: string | null
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
  /** open inquiry >2d unanswered OR quote sent >5d (server-computed) */
  needsFollowup: boolean
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
  followup: {
    daysSinceContact: number | null
    needsFollowup: boolean
    reason: "inquiry" | "quote" | null
  }
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
