import { describe, it, expect } from "vitest";
import {
  shouldPersistOpsTurn,
  customerChatCompletionRows,
  opsTurnContextJson,
} from "./opsChatPersist";

describe("opsChatPersist — orphan-free ops chat persistence", () => {
  describe("shouldPersistOpsTurn", () => {
    it("true only on a real, completed answer", () => {
      expect(shouldPersistOpsTurn("答案", false)).toBe(true);
    });
    it("false when the stream was interrupted (empty answer)", () => {
      // client abort / agent error / LLM throw all leave finalAnswer=""
      expect(shouldPersistOpsTurn("", false)).toBe(false);
    });
    it("false on the 90s timeout even if a partial answer leaked", () => {
      expect(shouldPersistOpsTurn("半句", true)).toBe(false);
    });
  });

  describe("customerChatCompletionRows — registered customer", () => {
    const scope = { kind: "user" as const, customerUserId: 42 };

    it("persists BOTH jeff and agent, jeff first, on completion", () => {
      const rows = customerChatCompletionRows(scope, 7, "簽證還在路上?", "已寄回", false, "{}");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        customerUserId: 42,
        customOrderId: 7,
        senderRole: "jeff",
        body: "簽證還在路上?",
      });
      expect(rows[0]).not.toHaveProperty("context");
      expect(rows[1]).toMatchObject({
        customerUserId: 42,
        customOrderId: 7,
        senderRole: "agent",
        body: "已寄回",
        context: "{}",
      });
    });

    it("persists NOTHING when the stream was aborted — the reported bug", () => {
      // Jeff switched project/page mid-answer → stream aborted → finalAnswer="".
      // Before the fix a lone jeff row was already written (the hanging bubble);
      // now the turn writes nothing, so no orphan can form.
      expect(customerChatCompletionRows(scope, 7, "簽證還在路上", "", false, "{}")).toEqual([]);
    });

    it("persists NOTHING on the 90s timeout", () => {
      expect(customerChatCompletionRows(scope, 7, "q", "半", true, "{}")).toEqual([]);
    });

    it("carries a null customOrderId (未分類 basket) unchanged and never leaks a profileId", () => {
      const rows = customerChatCompletionRows(scope, null, "q", "a", false, "{}");
      expect(rows[0].customOrderId).toBeNull();
      expect(rows[0]).not.toHaveProperty("customerProfileId");
    });
  });

  describe("customerChatCompletionRows — email guest", () => {
    const scope = { kind: "guest" as const, customerProfileId: 99 };

    it("scopes both rows to the guest profileId, jeff first, never a userId", () => {
      const rows = customerChatCompletionRows(scope, 3, "q", "a", false, "{}");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        customerProfileId: 99,
        customOrderId: 3,
        senderRole: "jeff",
        body: "q",
      });
      expect(rows[0]).not.toHaveProperty("customerUserId");
      expect(rows[1].senderRole).toBe("agent");
    });

    it("an interrupted guest turn also persists nothing", () => {
      expect(customerChatCompletionRows(scope, 3, "q", "", false, "{}")).toEqual([]);
    });
  });

  describe("opsTurnContextJson — write-tool ground truth persisted (2026-07-01 事故)", () => {
    it("includes tools when a write ran, verbatim", () => {
      const ctx = JSON.parse(
        opsTurnContextJson([], [], [
          { name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" },
        ]),
      );
      expect(ctx.tools).toEqual([
        { name: "set_follow_up_date", ok: true, message: "跟進日設為 2026-07-21" },
      ]);
      expect(ctx.streamed).toBe(true);
    });

    it("pure-read turns keep the lean legacy shape (no tools key)", () => {
      const ctx = JSON.parse(opsTurnContextJson([{ actionType: "x" }], [{ type: "y" }]));
      expect(ctx).toEqual({
        suggestedActions: [{ actionType: "x" }],
        cards: [{ type: "y" }],
        streamed: true,
      });
      expect(ctx).not.toHaveProperty("tools");
    });

    it("a FAILED write is persisted too — the debug ground truth of the incident", () => {
      const ctx = JSON.parse(
        opsTurnContextJson([], [], [
          { name: "set_follow_up_date", ok: false, message: "不是有效日期:「7/21」" },
        ]),
      );
      expect(ctx.tools[0].ok).toBe(false);
    });
  });
});
