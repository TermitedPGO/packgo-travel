import { describe, it, expect } from "vitest";
import {
  inquiryFirstTurn,
  inquiryReplyTurn,
  interactionTurn,
  mergeThread,
  type ThreadTurn,
} from "./adminCustomersThread";

const d = (iso: string) => new Date(iso);

describe("adminCustomersThread — sender normalization", () => {
  it("inquiry first message is always the customer", () => {
    const t = inquiryFirstTurn({ id: 7, message: "想問日本團", createdAt: d("2026-01-01") });
    expect(t).toEqual({
      id: "inq:7",
      senderRole: "customer",
      body: "想問日本團",
      context: null,
      createdAt: d("2026-01-01"),
    });
  });

  it("inquiryMessages: senderType 'admin' is us (jeff), everything else is the customer", () => {
    expect(inquiryReplyTurn({ id: 1, senderType: "admin", message: "好的", createdAt: d("2026-01-02") }).senderRole).toBe("jeff");
    expect(inquiryReplyTurn({ id: 2, senderType: "customer", message: "謝謝", createdAt: d("2026-01-02") }).senderRole).toBe("customer");
  });

  it("customerInteractions: inbound is the customer, outbound is us (jeff)", () => {
    expect(interactionTurn({ id: 5, direction: "inbound", content: "hi", createdAt: d("2026-01-03") }).senderRole).toBe("customer");
    expect(interactionTurn({ id: 6, direction: "outbound", content: "reply", createdAt: d("2026-01-03") }).senderRole).toBe("jeff");
  });
});

describe("adminCustomersThread — source key namespacing (no cross-table collision)", () => {
  it("same numeric id in different sources yields distinct, prefixed keys", () => {
    const a = inquiryFirstTurn({ id: 1, message: "a", createdAt: d("2026-01-01") });
    const b = inquiryReplyTurn({ id: 1, senderType: "admin", message: "b", createdAt: d("2026-01-01") });
    const c = interactionTurn({ id: 1, direction: "inbound", content: "c", createdAt: d("2026-01-01") });
    const ids = [a.id, b.id, c.id];
    expect(ids).toEqual(["inq:1", "im:1", "ci:1"]);
    expect(new Set(ids).size).toBe(3); // all unique → stable React keys
  });
});

describe("adminCustomersThread — mergeThread", () => {
  const mk = (id: string, iso: string): ThreadTurn => ({
    id,
    senderRole: "customer",
    body: id,
    context: null,
    createdAt: d(iso),
  });

  it("merges sources into one chronological (oldest → newest) thread", () => {
    const out = mergeThread(
      [
        [mk("inq:1", "2026-01-01")],
        [mk("im:1", "2026-01-03"), mk("im:2", "2026-01-02")],
        [mk("ci:1", "2026-01-04")],
      ],
      50,
    );
    expect(out.messages.map((m) => m.id)).toEqual(["inq:1", "im:2", "im:1", "ci:1"]);
    expect(out.truncated).toBe(false);
  });

  it("caps to the newest `lim` turns", () => {
    const group = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"].map((iso, i) =>
      mk(`im:${i}`, iso),
    );
    const out = mergeThread([group], 2);
    expect(out.messages.map((m) => m.id)).toEqual(["im:2", "im:3"]);
  });

  it("flags truncated when any source already hit its own cap", () => {
    const full = [mk("ci:1", "2026-01-01"), mk("ci:2", "2026-01-02")];
    expect(mergeThread([full], 2).truncated).toBe(true);
    expect(mergeThread([full], 3).truncated).toBe(false);
  });

  it("handles all-empty sources without throwing", () => {
    expect(mergeThread([[], [], []], 50)).toEqual({ messages: [], truncated: false });
  });
});
