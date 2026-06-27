/**
 * followupDraftProducer — pure-helper tests (DB-free). The runFollowupDraftScan
 * executor (LLM + DB) is verified live per the repo norm.
 *
 * The load-bearing test is "row surfaces AND sends": buildFollowupDraftRow's
 * output is fed through the REAL consumers — observationDraftCard (cockpit
 * 待審草稿 card) and parseEscalationReplyContext (the escalationReply send) — so
 * any drift in the context shape breaks a test, not a customer send.
 */
import { describe, it, expect, vi } from "vitest";

// Keep module load light: the producer pulls the LLM drafter (→ llm.ts) and a
// logger at import; stub both so pure-helper tests don't load that graph.
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./followupDrafter", () => ({ draftFollowup: vi.fn() }));

import {
  pickGmailThreadId,
  buildConversationExcerpt,
  detectLanguage,
  detectDraftSkip,
  buildFollowupDraftRow,
  pickFollowupVariant,
  FOLLOWUP_DRAFT_AGENT,
  FOLLOWUP_DRAFT_CLASSIFICATION,
  type InteractionDetailRow,
} from "./followupDraftProducer";
import { AUTO_SEND_HARD_EXCLUDED } from "./autoSendGate";
import { observationDraftCard } from "../../routers/adminCustomerDrafts";
import { parseEscalationReplyContext } from "../../_core/escalationBox";

const row = (o: Partial<InteractionDetailRow>): InteractionDetailRow => ({
  direction: "outbound",
  content: "",
  contentSummary: null,
  classification: null,
  gmailThreadId: null,
  ...o,
});

describe("pickGmailThreadId", () => {
  it("returns the newest non-null thread id", () => {
    expect(
      pickGmailThreadId([
        row({ gmailThreadId: null }),
        row({ gmailThreadId: "t-newest" }),
        row({ gmailThreadId: "t-old" }),
      ]),
    ).toBe("t-newest");
  });
  it("returns null when no row has a thread id", () => {
    expect(pickGmailThreadId([row({}), row({ gmailThreadId: "  " })])).toBeNull();
  });
});

describe("buildConversationExcerpt", () => {
  it("reverses to oldest-first, prefers summary, drops empty turns", () => {
    const out = buildConversationExcerpt([
      row({ direction: "outbound", content: "報價附上" }), // newest
      row({ direction: "inbound", content: "想去東京", contentSummary: "客人想去東京 5 天" }),
      row({ direction: "outbound", content: "   " }), // empty → dropped
    ]);
    expect(out).toEqual([
      { direction: "inbound", text: "客人想去東京 5 天" },
      { direction: "outbound", text: "報價附上" },
    ]);
  });
  it("caps the number of turns", () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ content: `m${i}` }));
    expect(buildConversationExcerpt(many, 3)).toHaveLength(3);
  });
});

describe("detectLanguage", () => {
  it("english when no CJK", () => {
    expect(detectLanguage("Hello, still interested in the trip?")).toBe("en");
  });
  it("zh-TW for traditional / default CJK", () => {
    expect(detectLanguage("想跟你確認上次的安排")).toBe("zh-TW");
  });
  it("zh-CN when simplified markers present", () => {
    expect(detectLanguage("这个行程还在考虑吗")).toBe("zh-CN");
  });
  it("defaults to zh-TW for empty", () => {
    expect(detectLanguage(null)).toBe("zh-TW");
  });
});

describe("detectDraftSkip", () => {
  it("no_thread when there is no gmail thread to reply into", () => {
    expect(
      detectDraftSkip({ gmailThreadId: null, lastClassification: null, conversationLen: 3 }),
    ).toBe("no_thread");
  });
  it("sensitive when the last message is a hard-excluded class", () => {
    const sensitive = [...AUTO_SEND_HARD_EXCLUDED][0];
    expect(
      detectDraftSkip({ gmailThreadId: "t-1", lastClassification: sensitive, conversationLen: 3 }),
    ).toBe("sensitive");
  });
  it("empty_conversation when there is nothing to ground on", () => {
    expect(
      detectDraftSkip({ gmailThreadId: "t-1", lastClassification: null, conversationLen: 0 }),
    ).toBe("empty_conversation");
  });
  it("null (draftable) on the happy path", () => {
    expect(
      detectDraftSkip({ gmailThreadId: "t-1", lastClassification: "general_question", conversationLen: 2 }),
    ).toBeNull();
  });
});

describe("buildFollowupDraftRow — surfaces AND sends through the real consumers", () => {
  const built = buildFollowupDraftRow({
    profileId: 7,
    customerEmail: "a@b.co",
    daysSince: 9,
    gmailThreadId: "t-123",
    subject: "跟進:a@b.co",
    draftBody: "嗨,還在考慮嗎?有想再多看哪邊我都可以幫你。",
    promptVariant: "B",
  });

  it("stamps the A/B prompt arm into context for later attribution", () => {
    expect(JSON.parse(built.context).promptVariant).toBe("B");
  });

  it("is an observation row keyed to the customer, unread", () => {
    expect(built.messageType).toBe("observation");
    expect(built.agentName).toBe(FOLLOWUP_DRAFT_AGENT);
    expect(built.relatedCustomerProfileId).toBe(7);
    expect(built.readByJeff).toBe(0);
    expect(built.priority).toBe("normal");
  });

  it("surfaces as a sendable, NON-sensitive cockpit draft card", () => {
    const card = observationDraftCard({
      id: 99,
      context: built.context,
      createdAt: new Date(),
      fallbackEmail: null,
    });
    expect(card).not.toBeNull();
    expect(card!.source).toBe("email"); // → commandCenter.escalationReply
    expect(card!.messageId).toBe(99);
    expect(card!.body).toBe("嗨,還在考慮嗎?有想再多看哪邊我都可以幫你。");
    expect(card!.to).toBe("a@b.co");
    expect(card!.kind).toBe(FOLLOWUP_DRAFT_CLASSIFICATION);
    expect(card!.sensitive).toBe(false); // benign follow-up → one-click send
  });

  it("carries the exact target escalationReply needs to send", () => {
    const target = parseEscalationReplyContext(built.context);
    expect(target).not.toBeNull();
    expect(target!.gmailThreadId).toBe("t-123");
    expect(target!.customerEmail).toBe("a@b.co");
    expect(target!.draftReply).toContain("還在考慮嗎");
  });
});

describe("live prompt A/B — assignment + both arms safe", () => {
  it("pickFollowupVariant returns A below 0.5, B at/above", () => {
    expect(pickFollowupVariant(() => 0.0)).toBe("A");
    expect(pickFollowupVariant(() => 0.49)).toBe("A");
    expect(pickFollowupVariant(() => 0.5)).toBe("B");
    expect(pickFollowupVariant(() => 0.99)).toBe("B");
  });

  it("splits roughly 50/50 over many draws", () => {
    let a = 0;
    const N = 1000;
    // deterministic sweep across [0,1) — exactly half land below 0.5
    for (let i = 0; i < N; i++) {
      if (pickFollowupVariant(() => i / N) === "A") a++;
    }
    expect(a).toBe(N / 2);
  });
});
