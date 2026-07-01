// Orphan-free persistence for the ops chat (/api/agent/ask-ops-stream).
//
// Bug this fixes (2026-06-30): the customer-scoped ops chat wrote Jeff's
// question row at request-START and the AI answer row only at stream COMPLETION.
// When Jeff switched project/page mid-answer the client aborts the stream (an
// intentional cross-customer safety) — so the answer never persisted, but the
// question row already had. That left a lone "jeff" turn that re-hydrates as a
// hanging SENT bubble with no reply (the "簽證還在路上" ghost).
//
// Fix: for the two customer-scoped branches, persist the question and the answer
// TOGETHER, only on a real completion. An interrupted stream (client abort, 90s
// timeout, agent error, LLM throw) writes NEITHER row, so no orphan can form on
// any path. The live LLM is unaffected — it receives the question as its own arg
// plus the pre-insert history, so deferring the write changes nothing it sees.
//
// The global #ops channel is deliberately NOT handled here: its UI renders the
// question only from the DB (no optimistic local bubble), so it keeps its early
// question echo — the route logs that jeff row at request-start and only appends
// the answer at completion.

export type CustomerChatScope =
  | { kind: "user"; customerUserId: number }
  | { kind: "guest"; customerProfileId: number };

export interface CustomerChatTurnRow {
  customerUserId?: number;
  customerProfileId?: number;
  customOrderId: number | null;
  senderRole: "jeff" | "agent";
  body: string;
  context?: string;
}

/**
 * Persist a turn only on a REAL completion — a non-empty answer that did not
 * time out. Every interruption path (client abort → finalAnswer stays "", 90s
 * timeout → timedOut, agent `error` event, LLM throw) fails this, so nothing is
 * written.
 */
export function shouldPersistOpsTurn(finalAnswer: string, timedOut: boolean): boolean {
  return Boolean(finalAnswer) && !timedOut;
}

/**
 * The customer-chat rows to insert AT completion: the jeff question and the
 * agent answer, jeff FIRST so a same-second `createdAt` keeps insertion order
 * (readers add an id-desc tiebreak to make that deterministic). Returns [] when
 * the turn did not really complete, so an interrupted stream persists nothing
 * and can never leave an orphan lone-jeff turn.
 */
export function customerChatCompletionRows(
  scope: CustomerChatScope,
  customOrderId: number | null,
  question: string,
  finalAnswer: string,
  timedOut: boolean,
  contextJson: string,
): CustomerChatTurnRow[] {
  if (!shouldPersistOpsTurn(finalAnswer, timedOut)) return [];
  const base =
    scope.kind === "user"
      ? { customerUserId: scope.customerUserId, customOrderId }
      : { customerProfileId: scope.customerProfileId, customOrderId };
  return [
    { ...base, senderRole: "jeff", body: question },
    { ...base, senderRole: "agent", body: finalAnswer, context: contextJson },
  ];
}
