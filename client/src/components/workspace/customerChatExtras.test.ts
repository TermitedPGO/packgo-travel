/**
 * Tests for customerChatExtras — agent-turn context parse (批2 m3b).
 */
import { describe, it, expect } from "vitest";
import { parseTurnExtras } from "./customerChatExtras";

describe("parseTurnExtras", () => {
  it("extracts cards + suggestedActions from a streamed turn", () => {
    const out = parseTurnExtras(
      JSON.stringify({
        suggestedActions: [
          { actionType: "draftWechatReply", label: "草擬微信回覆", args: {}, sensitivity: "normal" },
        ],
        cards: [{ type: "departures", items: [] }],
        streamed: true,
      }),
    );
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0].actionType).toBe("draftWechatReply");
    expect(out.cards).toHaveLength(1);
  });

  it("degrades to empty on null / malformed / wrong-typed context", () => {
    expect(parseTurnExtras(null)).toEqual({ cards: [], actions: [] });
    expect(parseTurnExtras(undefined)).toEqual({ cards: [], actions: [] });
    expect(parseTurnExtras("not json")).toEqual({ cards: [], actions: [] });
    expect(parseTurnExtras(JSON.stringify([1]))).toEqual({ cards: [], actions: [] });
    expect(
      parseTurnExtras(JSON.stringify({ suggestedActions: "x", cards: 5 })),
    ).toEqual({ cards: [], actions: [] });
  });
});
