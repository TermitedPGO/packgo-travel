/**
 * Pure helpers for admin.customerDrafts (server/routers/adminCustomers.ts).
 *
 * Batch 2 surfaces a customer's PENDING AI reply drafts on the customer page so
 * Jeff can one-click approve→send. There are two existing draft stores and we
 * reuse both rather than build a new one:
 *   - 網站詢問草稿  → approvalTasks (lane=cs, taskType=inquiry_reply), payload.draftBody
 *   - Gmail 升級草稿 → agentMessages (messageType=escalation), context.draftReply
 *
 * These helpers normalize the two row shapes into ONE `CustomerDraft` and are
 * kept DB-free so the leakage-sensitive bits (sensitive-class flag, id
 * namespacing, the "is there actually a draft to send" gate) are unit-testable
 * without a database. The actual approve/send is done by the frontend calling
 * the EXISTING audited mutations — commandCenter.approve for inquiry drafts,
 * commandCenter.escalationReply for email drafts — dispatched by `source`.
 */
import { AUTO_SEND_HARD_EXCLUDED } from "../agents/autonomous/autoSendGate";

export type CustomerDraft = {
  /** namespaced stable React key — never collides across the two stores */
  id: string;
  source: "inquiry" | "email";
  /** classification / "inquiry_reply" — drives the type label */
  kind: string;
  /** recipient, display only; the real send target is resolved server-side */
  to: string;
  subject: string | null;
  /** the draft text Jeff approves */
  body: string;
  /** hard_gate / 碰錢碰法律 class → frontend forces a confirm before sending */
  sensitive: boolean;
  attachments: string[];
  createdAt: Date;
  /** source=inquiry → commandCenter.approve/reject({ id: taskId }) */
  taskId: number | null;
  /** source=email → commandCenter.escalationReply({ messageId }) */
  messageId: number | null;
  /** source=inquiry → original approvalTasks.payload JSON (rebuild editedPayload on edit) */
  payload: string | null;
};

const isSensitiveClass = (c: string | null | undefined): boolean =>
  typeof c === "string" && AUTO_SEND_HARD_EXCLUDED.has(c);

type InquiryPayload = {
  inquiryId?: number;
  draftBody?: string;
  customerEmail?: string;
  customerName?: string;
  subject?: string;
  classification?: string;
};

/** approvalTasks (lane=cs, taskType=inquiry_reply) row → draft card, or null if no draft body. */
export function inquiryDraftCard(row: {
  id: number;
  payload: string;
  riskLevel: string; // 'auto' | 'review' | 'hard_gate'
  createdAt: Date;
}): CustomerDraft | null {
  let p: InquiryPayload;
  try {
    const parsed = JSON.parse(row.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    p = parsed as InquiryPayload;
  } catch {
    return null;
  }
  const body = typeof p.draftBody === "string" ? p.draftBody.trim() : "";
  if (!body) return null; // nothing to approve
  return {
    id: `task:${row.id}`,
    source: "inquiry",
    kind: typeof p.classification === "string" && p.classification ? p.classification : "inquiry_reply",
    to: typeof p.customerEmail === "string" ? p.customerEmail : "",
    subject: typeof p.subject === "string" && p.subject ? p.subject : null,
    body,
    // riskLevel hard_gate already covers 碰錢碰法律 for the inbox pipeline; the
    // class check is a belt-and-suspenders mirror of the Gmail exclusion set.
    sensitive: row.riskLevel === "hard_gate" || isSensitiveClass(p.classification),
    attachments: [],
    createdAt: row.createdAt,
    taskId: row.id,
    messageId: null,
    payload: row.payload,
  };
}

type EscalationCtx = {
  draftReply?: string;
  gmailThreadId?: string;
  customerEmail?: string;
  classification?: string;
  subject?: string;
};

/**
 * agentMessages (messageType=escalation) row → draft card, or null when it is
 * not an actionable draft. Actionable requires BOTH a draftReply AND a
 * gmailThreadId — escalationReply sends into the original Gmail thread, so a
 * card with no thread to reply into is not surfaced. customerEmail may be
 * recovered from the linked customer (fallbackEmail) when context omits it.
 */
export function escalationDraftCard(row: {
  id: number;
  context: string | null;
  createdAt: Date;
  fallbackEmail?: string | null;
}): CustomerDraft | null {
  if (!row.context) return null;
  let c: EscalationCtx;
  try {
    const parsed = JSON.parse(row.context);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    c = parsed as EscalationCtx;
  } catch {
    return null;
  }
  const body = typeof c.draftReply === "string" ? c.draftReply.trim() : "";
  const gmailThreadId = typeof c.gmailThreadId === "string" ? c.gmailThreadId.trim() : "";
  if (!body || !gmailThreadId) return null; // no draft / no thread to reply into
  const to =
    (typeof c.customerEmail === "string" && c.customerEmail.trim()) || row.fallbackEmail || "";
  return {
    id: `esc:${row.id}`,
    source: "email",
    kind: typeof c.classification === "string" && c.classification ? c.classification : "escalation",
    to,
    subject: typeof c.subject === "string" && c.subject ? c.subject : null,
    body,
    sensitive: isSensitiveClass(c.classification),
    attachments: [],
    createdAt: row.createdAt,
    taskId: null,
    messageId: row.id,
    payload: null,
  };
}

type ObservationCtx = EscalationCtx & { sendOutcome?: string | null };

/**
 * agentMessages (messageType=observation) row → draft card, or null.
 *
 * The Gmail pipeline stores its NON-escalated AI replies as observations:
 *   - sendOutcome="would_auto_send" (shadow) = 「準備發、本來會自動發但沒發」
 *   - sendOutcome=null + a draftReply        = plain "draft" verdict awaiting Jeff
 *   - sendOutcome="auto_replied"             = ALREADY SENT → NOT awaiting send
 * Only the first two are "AI 準備發草稿要發"; auto_replied is excluded (it lives in
 * the 自動回覆留底 surface, not the awaiting-send drafts panel). Same actionable
 * gate as escalations (draftReply + gmailThreadId) and the same send path
 * (commandCenter.escalationReply, which accepts messageType=observation).
 */
export function observationDraftCard(row: {
  id: number;
  context: string | null;
  createdAt: Date;
  fallbackEmail?: string | null;
}): CustomerDraft | null {
  if (!row.context) return null;
  let c: ObservationCtx;
  try {
    const parsed = JSON.parse(row.context);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    c = parsed as ObservationCtx;
  } catch {
    return null;
  }
  if (c.sendOutcome === "auto_replied") return null; // already sent
  const body = typeof c.draftReply === "string" ? c.draftReply.trim() : "";
  const gmailThreadId = typeof c.gmailThreadId === "string" ? c.gmailThreadId.trim() : "";
  if (!body || !gmailThreadId) return null;
  const to =
    (typeof c.customerEmail === "string" && c.customerEmail.trim()) || row.fallbackEmail || "";
  return {
    id: `obs:${row.id}`,
    source: "email",
    kind: typeof c.classification === "string" && c.classification ? c.classification : "draft",
    to,
    subject: typeof c.subject === "string" && c.subject ? c.subject : null,
    body,
    sensitive: isSensitiveClass(c.classification),
    attachments: [],
    createdAt: row.createdAt,
    taskId: null,
    messageId: row.id,
    payload: null,
  };
}

/** Merge both source groups into one list, newest first, capped to `lim`. */
export function mergeDrafts(groups: CustomerDraft[][], lim = 50): CustomerDraft[] {
  return groups
    .flat()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, lim);
}
