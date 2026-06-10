/**
 * customerChatExtras — parse a customer-chat agent turn's context JSON into
 * the renderable extras (批2 m3b): data cards + suggested-action chips.
 *
 * The SSE handler persists { suggestedActions, cards, streamed } on every
 * agent turn (customerChatMessages.context). Shape is owned by
 * opsAgentStream and may drift — malformed JSON or wrong types degrade to
 * empty arrays, never a throw (the turn still renders as plain text).
 */

export interface TurnExtras {
  cards: any[];
  actions: any[];
}

export function parseTurnExtras(
  context: string | null | undefined,
): TurnExtras {
  if (!context) return { cards: [], actions: [] };
  try {
    const ctx = JSON.parse(context);
    if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) {
      return { cards: [], actions: [] };
    }
    return {
      cards: Array.isArray(ctx.cards) ? ctx.cards : [],
      actions: Array.isArray(ctx.suggestedActions) ? ctx.suggestedActions : [],
    };
  } catch {
    return { cards: [], actions: [] };
  }
}
