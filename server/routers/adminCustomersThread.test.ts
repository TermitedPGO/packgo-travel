import { describe, it, expect } from "vitest";
import {
  inquiryFirstTurn,
  inquiryReplyTurn,
  interactionTurn,
  mergeThread,
  stripAgentMarkup,
  resolveConversationThreadScope,
  includesInquiries,
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

  it("customer-projects (0104): interaction turns carry an assignment handle", () => {
    const t = interactionTurn({
      id: 9,
      direction: "inbound",
      content: "票出了嗎",
      createdAt: d("2026-07-01"),
      gmailThreadId: "thread-abc",
      customOrderId: 142,
    });
    expect(t.assign).toEqual({ interactionId: 9, gmailThreadId: "thread-abc", customOrderId: 142 });
  });

  it("assignment handle defaults to nulls for rows that predate thread filing", () => {
    const t = interactionTurn({ id: 10, direction: "inbound", content: "x", createdAt: d("2026-01-01") });
    expect(t.assign).toEqual({ interactionId: 10, gmailThreadId: null, customOrderId: null });
  });

  it("inquiry turns are NOT assignable (no handle — first contact predates orders)", () => {
    expect(inquiryFirstTurn({ id: 1, message: "嗨", createdAt: d("2026-01-01") }).assign).toBeUndefined();
    expect(inquiryReplyTurn({ id: 1, senderType: "admin", message: "好", createdAt: d("2026-01-01") }).assign).toBeUndefined();
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

describe("adminCustomersThread — stripAgentMarkup (leaked safety tags)", () => {
  it("removes the <untrusted_input> wrapper but keeps the customer's words", () => {
    expect(
      stripAgentMarkup("Subject: 韓國 <untrusted_input> 你們有韓國的行程嗎 </untrusted_input>"),
    ).toBe("Subject: 韓國 你們有韓國的行程嗎");
  });

  it("is case-insensitive and tolerates the closing tag with whitespace", () => {
    expect(stripAgentMarkup("<UNTRUSTED_INPUT >hi</UNTRUSTED_INPUT >")).toBe("hi");
  });

  it("NEVER strips generic angle brackets a customer might type", () => {
    expect(stripAgentMarkup("預算 < 5000 usd / 人")).toBe("預算 < 5000 usd / 人");
    expect(stripAgentMarkup("<b>bold?</b>")).toBe("<b>bold?</b>");
  });

  it("preserves newlines while collapsing the doubled spaces removal leaves", () => {
    expect(stripAgentMarkup("a <untrusted_input>  b\nc</untrusted_input>")).toBe("a b\nc");
  });

  it("is applied by every turn builder so no source leaks the tags", () => {
    expect(
      inquiryFirstTurn({ id: 1, message: "<untrusted_input>嗨</untrusted_input>", createdAt: d("2026-01-01") }).body,
    ).toBe("嗨");
    expect(
      inquiryReplyTurn({ id: 1, senderType: "customer", message: "<untrusted_input>謝</untrusted_input>", createdAt: d("2026-01-01") }).body,
    ).toBe("謝");
    expect(
      interactionTurn({ id: 1, direction: "inbound", content: "<untrusted_input>hi</untrusted_input>", createdAt: d("2026-01-01") }).body,
    ).toBe("hi");
  });

  it("handles empty bodies, and leaves tag-free whitespace exactly as typed", () => {
    expect(stripAgentMarkup("")).toBe("");
    // no wrapper → conservative: do not touch the customer's spacing at all
    expect(stripAgentMarkup("   ")).toBe("   ");
    expect(stripAgentMarkup("Hi   Jeff")).toBe("Hi   Jeff");
    expect(stripAgentMarkup("  leading + trailing  ")).toBe("  leading + trailing  ");
  });
});

/**
 * resolveConversationThreadScope / includesInquiries — customer-projects
 * (0104) audit fix (2026-06-30): customerConversationThread's three-state
 * branching had zero test coverage before this. This is the exact decision
 * the router's query makes I/O off of.
 */
describe("resolveConversationThreadScope (customer-projects three-state)", () => {
  it("orderId set → project mode, carries the orderId, includeUnfiled defaults false", () => {
    expect(resolveConversationThreadScope({ orderId: 142 })).toEqual({
      mode: "project",
      orderId: 142,
      includeUnfiled: false,
    });
  });

  it("unfiledOnly true, no orderId → unfiled mode", () => {
    expect(resolveConversationThreadScope({ unfiledOnly: true })).toEqual({ mode: "unfiled" });
  });

  it("neither set → all mode (the customer-wide view Overview/真相條 depend on)", () => {
    expect(resolveConversationThreadScope({})).toEqual({ mode: "all" });
  });

  it("orderId wins when BOTH orderId and unfiledOnly are somehow set", () => {
    expect(resolveConversationThreadScope({ orderId: 7, unfiledOnly: true })).toEqual({
      mode: "project",
      orderId: 7,
      includeUnfiled: false,
    });
  });

  it("unfiledOnly: false is the same as omitted → all mode", () => {
    expect(resolveConversationThreadScope({ unfiledOnly: false })).toEqual({ mode: "all" });
  });

  // Phase6 B3 — 「顯示未歸屬」toggle. Supervisor ruling: default OFF (project
  // chip shows ONLY that order's interactions unless Jeff explicitly flips it).
  it("includeUnfiled: true carries through on project mode", () => {
    expect(resolveConversationThreadScope({ orderId: 142, includeUnfiled: true })).toEqual({
      mode: "project",
      orderId: 142,
      includeUnfiled: true,
    });
  });

  it("includeUnfiled is ignored outside project mode (unfiled/all have no such toggle)", () => {
    expect(resolveConversationThreadScope({ unfiledOnly: true, includeUnfiled: true })).toEqual({
      mode: "unfiled",
    });
    expect(resolveConversationThreadScope({ includeUnfiled: true })).toEqual({ mode: "all" });
  });
});

describe("includesInquiries", () => {
  it("hidden ONLY in project mode (first contact predates any order)", () => {
    expect(includesInquiries({ mode: "project", orderId: 7 })).toBe(false);
  });
  it("included in unfiled mode", () => {
    expect(includesInquiries({ mode: "unfiled" })).toBe(true);
  });
  it("included in all mode", () => {
    expect(includesInquiries({ mode: "all" })).toBe(true);
  });
});
