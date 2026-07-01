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
  /** customer-projects (0106) — which project (customOrder) this doc belongs to;
   *  null = 未分類. The 文件 tab filters by the active ProjectBar chip. */
  customOrderId: number | null
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
  aiSummary: { wants: string; actions: string; delivered: string; nextStep?: string }
  followup: {
    daysSinceContact: number | null
    needsFollowup: boolean
    reason: "inquiry" | "quote" | null
    /** Q4-A 客人跟進日 (customerProfiles.followUpDate, "YYYY-MM-DD") or null. */
    followUpDate: string | null
    /** followUpDate set and <= today in America/Los_Angeles. */
    isDue: boolean
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

/** customer-projects (0104) — one project = one customOrder. The ProjectBar
 *  lists these by date; selecting one scopes the chat + 歷史 to it. id=null is
 *  the「未分類」basket (no project). Lean projection from customerOrders.listForCustomer. */
export type Project = {
  id: number
  orderNumber: string
  title: string
  /** 總類 key (flight/quote/visa/general) → i18n label; null = 未標 (0105). */
  category: string | null
  status: string
  departureDate: string | null
}

export type ChatMessage = {
  id: string
  senderRole: "customer" | "jeff"
  body: string
  context: string | null
  createdAt: Date
}

export type AiChatMessage = {
  id: string
  senderRole: "jeff" | "agent"
  body: string
  context: string | null
  createdAt: Date
}
