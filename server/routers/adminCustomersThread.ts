/**
 * Pure helpers for customerConversationThread (server/routers/adminCustomers.ts).
 *
 * Kept DB-free so the leakage-sensitive bits — sender normalization, source key
 * namespacing (prevents cross-table id collisions → unstable React keys), and
 * the merge/truncation policy — are unit-testable without a database.
 *
 * senderRole is the two SIDES of a real customer conversation:
 *   'customer' = the customer, 'jeff' = us (Jeff / the agency).
 */

export type ThreadTurn = {
  id: string;
  senderRole: "customer" | "jeff";
  body: string;
  context: string | null;
  createdAt: Date;
  /** customer-projects (0104) — assignment handle, present ONLY on
   *  customerInteractions turns (the assignable real-conversation unit). The
   *  歷史 tab uses it to file a whole Gmail thread under a project. inquiries /
   *  inquiryMessages turns omit it (not assignable in Phase 1). */
  assign?: {
    interactionId: number;
    gmailThreadId: string | null;
    customOrderId: number | null;
  };
};

/**
 * Strip agent-only safety markup that the email→inquiry pipeline wraps around the
 * customer's raw text (e.g. `<untrusted_input> … </untrusted_input>`, a
 * prompt-injection delimiter meant for the LLM). Those tags are for the agent,
 * never for Jeff's eyes — they were leaking verbatim into the customer
 * conversation view. Conservative on purpose: only the known wrapper tags are
 * removed, never a generic `<…>` a customer might legitimately type (e.g.
 * "budget < 5000 usd"). Collapses the doubled spaces the removal leaves behind
 * but preserves newlines.
 */
export function stripAgentMarkup(body: string): string {
  if (!body) return body;
  const stripped = body.replace(/<\/?untrusted_input\s*>/gi, "");
  // No wrapper present → return the customer's text EXACTLY as typed (preserve
  // their spacing / leading / trailing whitespace). Only tidy the doubled space
  // + edge whitespace the tag removal itself leaves behind.
  if (stripped === body) return body;
  return stripped.replace(/[ \t]{2,}/g, " ").trim();
}

/** inquiries.message — the customer's original first message. Always 'customer'. */
export function inquiryFirstTurn(r: {
  id: number;
  message: string;
  createdAt: Date;
}): ThreadTurn {
  return {
    id: `inq:${r.id}`,
    senderRole: "customer",
    body: stripAgentMarkup(r.message),
    context: null,
    createdAt: r.createdAt,
  };
}

/** inquiryMessages reply — senderType 'admin' is us, anything else is the customer. */
export function inquiryReplyTurn(r: {
  id: number;
  senderType: string;
  message: string;
  createdAt: Date;
}): ThreadTurn {
  return {
    id: `im:${r.id}`,
    senderRole: r.senderType === "admin" ? "jeff" : "customer",
    body: stripAgentMarkup(r.message),
    context: null,
    createdAt: r.createdAt,
  };
}

/** customerInteractions — inbound is from the customer, outbound is from us.
 *  Carries the assignment handle (0104) so the 歷史 tab can file the row's whole
 *  Gmail thread under a project. gmailThreadId / customOrderId default to null
 *  for older callers / rows that predate thread filing. */
export function interactionTurn(r: {
  id: number;
  direction: string;
  content: string;
  createdAt: Date;
  gmailThreadId?: string | null;
  customOrderId?: number | null;
}): ThreadTurn {
  return {
    id: `ci:${r.id}`,
    senderRole: r.direction === "inbound" ? "customer" : "jeff",
    body: stripAgentMarkup(r.content),
    context: null,
    createdAt: r.createdAt,
    assign: {
      interactionId: r.id,
      gmailThreadId: r.gmailThreadId ?? null,
      customOrderId: r.customOrderId ?? null,
    },
  };
}

/**
 * customer-projects (0104) — which of the THREE customerConversationThread
 * views applies, extracted as a pure decision so the branching is directly
 * unit-testable (audit fix, 2026-06-30 — this had zero coverage; the router
 * itself only does I/O once the scope is known). orderId set → that single
 * project; unfiledOnly → the「未分類」basket; neither → the customer-wide ALL
 * view that Overview / 真相條 / followup depend on staying whole.
 */
export type ConversationThreadScope =
  | { mode: "project"; orderId: number }
  | { mode: "unfiled" }
  | { mode: "all" };

export function resolveConversationThreadScope(input: {
  orderId?: number;
  unfiledOnly?: boolean;
}): ConversationThreadScope {
  if (input.orderId !== undefined) return { mode: "project", orderId: input.orderId };
  if (input.unfiledOnly) return { mode: "unfiled" };
  return { mode: "all" };
}

/**
 * Pure: whether first-contact sources (inquiries / inquiryMessages) belong in
 * this view. Hidden ONLY in the project-scoped view — first contact predates
 * any order, so it can never legitimately belong to one specific project.
 */
export function includesInquiries(scope: ConversationThreadScope): boolean {
  return scope.mode !== "project";
}

/**
 * Merge per-source turn groups into one chronological thread (oldest → newest),
 * capped to the newest `lim`. `truncated` is true when ANY source already hit
 * its own cap — i.e. an older slice may have been dropped — so the caller can
 * tell the user instead of silently swallowing history.
 */
export function mergeThread(
  groups: ThreadTurn[][],
  lim: number,
): { messages: ThreadTurn[]; truncated: boolean } {
  const truncated = groups.some((g) => g.length >= lim);
  const messages = groups
    .flat()
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .slice(-lim);
  return { messages, truncated };
}
