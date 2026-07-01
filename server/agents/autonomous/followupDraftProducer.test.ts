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
  detectCustomerLanguage,
  detectDraftSkip,
  pickLatestInboundClassification,
  sanitizeFollowupDraftBody,
  buildFollowupDraftRow,
  pickFollowupVariant,
  FOLLOWUP_DRAFT_AGENT,
  FOLLOWUP_DRAFT_CLASSIFICATION,
  FOLLOWUP_SENSITIVE_CLASSES,
  type InteractionDetailRow,
} from "./followupDraftProducer";
import { observationDraftCard } from "../../routers/adminCustomerDrafts";
import { parseEscalationReplyContext } from "../../_core/escalationBox";
import { hasEmDash, hasResidualMarkdown } from "../../_core/plainTextReply";

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

describe("detectCustomerLanguage", () => {
  it("uses the customer's last INBOUND turn, not the newest turn (the bug)", () => {
    // newest-first: we replied in Chinese after the customer wrote English.
    // detectLanguage(rows[0]) would wrongly say zh-TW; we must reply in English.
    expect(
      detectCustomerLanguage([
        row({ direction: "outbound", content: "您好,報價附上,有問題再跟我說" }), // newest = ours
        row({ direction: "inbound", content: "Hi, can you send a quote for our July trip?" }),
      ]),
    ).toBe("en");
  });
  it("matches a Chinese inbound even when our latest reply was English", () => {
    expect(
      detectCustomerLanguage([
        row({ direction: "outbound", content: "Sure, sending it over now." }),
        row({ direction: "inbound", content: "想跟您確認七月那團還有沒有位" }),
      ]),
    ).toBe("zh-TW");
  });
  it("falls back to contentSummary when inbound content is blank", () => {
    expect(
      detectCustomerLanguage([
        row({ direction: "inbound", content: "  ", contentSummary: "Customer asking about availability" }),
      ]),
    ).toBe("en");
  });
  it("falls back to the newest turn when there is no inbound", () => {
    expect(
      detectCustomerLanguage([row({ direction: "outbound", content: "Following up on your trip" })]),
    ).toBe("en");
  });
  it("defaults to zh-TW for an empty thread", () => {
    expect(detectCustomerLanguage([])).toBe("zh-TW");
  });
});

describe("detectDraftSkip", () => {
  it("no_thread when there is no gmail thread to reply into", () => {
    expect(
      detectDraftSkip({ gmailThreadId: null, lastInboundClassification: null, conversationLen: 3 }),
    ).toBe("no_thread");
  });
  it.each([...FOLLOWUP_SENSITIVE_CLASSES].map((c) => [c]))(
    "sensitive when the customer's latest inbound is %s",
    (sensitive) => {
      expect(
        detectDraftSkip({
          gmailThreadId: "t-1",
          lastInboundClassification: sensitive,
          conversationLen: 3,
        }),
      ).toBe("sensitive");
    },
  );
  it("empty_conversation when there is nothing to ground on", () => {
    expect(
      detectDraftSkip({ gmailThreadId: "t-1", lastInboundClassification: null, conversationLen: 0 }),
    ).toBe("empty_conversation");
  });
  it("null (draftable) on the happy path", () => {
    expect(
      detectDraftSkip({ gmailThreadId: "t-1", lastInboundClassification: "general_question", conversationLen: 2 }),
    ).toBeNull();
  });
  it("null (draftable) for a normal quote inquiry — the feature's core case", () => {
    expect(
      detectDraftSkip({
        gmailThreadId: "t-1",
        lastInboundClassification: "quote_request",
        conversationLen: 2,
      }),
    ).toBeNull();
  });
});

describe("pickLatestInboundClassification — customer state, not our outbound", () => {
  it("skips the newest outbound (classification null) and reads the latest inbound", () => {
    expect(
      pickLatestInboundClassification([
        row({ direction: "outbound", classification: null }), // our reply = newest
        row({ direction: "inbound", classification: "refund_request" }),
        row({ direction: "inbound", classification: "quote_request" }),
      ]),
    ).toBe("refund_request");
  });
  it("walks past an UNCLASSIFIED inbound (backfilled row) to the newest classified one", () => {
    expect(
      pickLatestInboundClassification([
        row({ direction: "outbound", classification: null }),
        row({ direction: "inbound", classification: null }), // threadFiling backfill
        row({ direction: "inbound", classification: "  " }),
        row({ direction: "inbound", classification: "complaint" }),
      ]),
    ).toBe("complaint");
  });
  it("null when no inbound row carries a classification", () => {
    expect(
      pickLatestInboundClassification([
        row({ direction: "outbound", classification: null }),
        row({ direction: "inbound", classification: null }),
      ]),
    ).toBeNull();
  });
});

describe("sensitive gate end-to-end wiring (Finding A: gate was dead on rows[0])", () => {
  // Exactly the producer/onDemand call chain, fed newest-first rows.
  const skipFor = (rows: InteractionDetailRow[]) =>
    detectDraftSkip({
      gmailThreadId: pickGmailThreadId(rows),
      lastInboundClassification: pickLatestInboundClassification(rows),
      conversationLen: buildConversationExcerpt(rows).length,
    });

  it("skips when the customer's last inbound was refund_request and our reply (classification null) is newest", () => {
    // The prod failure: customer asked for a refund, Jeff replied, customer
    // quiet 3-21 days → the nightly scan must NOT draft a warm「還在考慮嗎」.
    expect(
      skipFor([
        row({ direction: "outbound", content: "退款我這邊處理中", gmailThreadId: "t-1" }),
        row({ direction: "inbound", content: "我要退款", classification: "refund_request", gmailThreadId: "t-1" }),
      ]),
    ).toBe("sensitive");
  });
  it("skips a complaint thread the same way", () => {
    expect(
      skipFor([
        row({ direction: "outbound", content: "真的不好意思,我跟進", gmailThreadId: "t-2" }),
        row({ direction: "inbound", content: "這次安排我很不滿意", classification: "complaint", gmailThreadId: "t-2" }),
      ]),
    ).toBe("sensitive");
  });
  it("does NOT skip a normal quote conversation (quote sent, customer quiet)", () => {
    expect(
      skipFor([
        row({ direction: "outbound", content: "報價附上,有問題再跟我說", gmailThreadId: "t-3" }),
        row({ direction: "inbound", content: "8 月 4 人去芝加哥多少錢", classification: "quote_request", gmailThreadId: "t-3" }),
      ]),
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
    expect(card!.promptVariant).toBe("B"); // A/B arm surfaces for the cockpit tag
  });

  it("carries the exact target escalationReply needs to send", () => {
    const target = parseEscalationReplyContext(built.context);
    expect(target).not.toBeNull();
    expect(target!.gmailThreadId).toBe("t-123");
    expect(target!.customerEmail).toBe("a@b.co");
    expect(target!.draftReply).toContain("還在考慮嗎");
  });
});

describe("sanitizeFollowupDraftBody (Finding B: wash BEFORE the card, send chain never strips)", () => {
  it("normalizes em dashes out of an LLM draft (the Leslie case)", () => {
    const out = sanitizeFollowupDraftBody("Your group arrives—expecting great weather—on Monday.");
    expect(out.blocked).toBe(false);
    expect(hasEmDash(out.body)).toBe(false);
    expect(out.body).toContain("arrives");
    expect(out.body).toContain("expecting");
  });
  it("strips markdown bold / headers / bullets", () => {
    const out = sanitizeFollowupDraftBody("## 您好\n**YG7 和 YL7 兩個團的差別**\n- 第一點");
    expect(out.blocked).toBe(false);
    expect(hasResidualMarkdown(out.body)).toBe(false);
    expect(out.body).toContain("YG7 和 YL7 兩個團的差別");
    expect(out.body).not.toContain("**");
    expect(out.body).not.toContain("##");
  });
  it("empty / null drafts come back empty and unblocked (caller skips as error)", () => {
    expect(sanitizeFollowupDraftBody(null)).toEqual({ body: "", blocked: false, violations: [] });
    expect(sanitizeFollowupDraftBody("   ")).toEqual({ body: "", blocked: false, violations: [] });
  });
  it("blocks when markdown survives the wash (unpaired ** the stripper can't fix)", () => {
    const out = sanitizeFollowupDraftBody("您好 **這段沒關起來");
    expect(out.blocked).toBe(true);
    expect(out.violations).toContain("markdown");
  });
  it("soft violations (你 instead of 您) are reported but NOT blocked — Jeff reviews", () => {
    const out = sanitizeFollowupDraftBody("嗨,你最近還好嗎");
    expect(out.blocked).toBe(false);
    expect(out.violations).toContain("informal_ni");
    expect(out.body).toBe("嗨,你最近還好嗎");
  });
});

describe("dirty LLM output → clean card, both A/B arms (Finding B end-to-end)", () => {
  // What the LLM actually emitted in prod-style drift: markdown + em dash.
  const dirty = "**王姊姊您好** — 上次聊到的行程—您方便再回我一聲就好。";

  it.each([["A"], ["B"]] as const)(
    "arm %s: the stored draftReply on the card is already stripped",
    (promptVariant) => {
      const cleaned = sanitizeFollowupDraftBody(dirty);
      expect(cleaned.blocked).toBe(false);

      const built = buildFollowupDraftRow({
        profileId: 7,
        customerEmail: "a@b.co",
        daysSince: 9,
        gmailThreadId: "t-123",
        subject: "跟進:a@b.co",
        draftBody: cleaned.body,
        promptVariant,
      });

      // The card Jeff sees = the body the one-click send chain sends verbatim.
      const card = observationDraftCard({
        id: 1,
        context: built.context,
        createdAt: new Date(),
        fallbackEmail: null,
      });
      expect(card).not.toBeNull();
      expect(hasEmDash(card!.body)).toBe(false);
      expect(hasResidualMarkdown(card!.body)).toBe(false);
      expect(card!.body).toContain("王姊姊您好");

      const target = parseEscalationReplyContext(built.context);
      expect(hasEmDash(target!.draftReply ?? "")).toBe(false);
      expect(hasResidualMarkdown(target!.draftReply ?? "")).toBe(false);
    },
  );
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
