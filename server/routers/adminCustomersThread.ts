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
};

/** inquiries.message — the customer's original first message. Always 'customer'. */
export function inquiryFirstTurn(r: {
  id: number;
  message: string;
  createdAt: Date;
}): ThreadTurn {
  return {
    id: `inq:${r.id}`,
    senderRole: "customer",
    body: r.message,
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
    body: r.message,
    context: null,
    createdAt: r.createdAt,
  };
}

/** customerInteractions — inbound is from the customer, outbound is from us. */
export function interactionTurn(r: {
  id: number;
  direction: string;
  content: string;
  createdAt: Date;
}): ThreadTurn {
  return {
    id: `ci:${r.id}`,
    senderRole: r.direction === "inbound" ? "customer" : "jeff",
    body: r.content,
    context: null,
    createdAt: r.createdAt,
  };
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
