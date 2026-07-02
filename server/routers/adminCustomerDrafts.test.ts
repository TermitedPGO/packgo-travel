import { describe, it, expect } from "vitest";
import { inquiryDraftCard, escalationDraftCard, observationDraftCard, mergeDrafts, isDraftCurrent, onlyNewestDraft } from "./adminCustomerDrafts";

const d = (iso: string) => new Date(iso);
const j = (o: unknown) => JSON.stringify(o);

describe("isDraftCurrent — hide a draft once the conversation moves past it", () => {
  it("shows a draft that is the latest move (no newer message)", () => {
    // draft generated right after the inbound it replies to; nothing newer yet
    expect(isDraftCurrent(d("2026-06-15T22:20:00Z"), d("2026-06-15T22:19:00Z"))).toBe(true);
  });
  it("hides a draft after Jeff replied (a newer outbound exists)", () => {
    // Jenny's "I'll send the English version" draft, but the EN was sent an hour later
    expect(isDraftCurrent(d("2026-06-15T22:20:00Z"), d("2026-06-16T01:34:00Z"))).toBe(false);
  });
  it("hides a draft after the customer wrote again (a newer inbound exists)", () => {
    expect(isDraftCurrent(d("2026-06-24T18:00:00Z"), d("2026-06-24T22:50:00Z"))).toBe(false);
  });
  it("shows a draft when there is no conversation yet (latestMsgAt null)", () => {
    expect(isDraftCurrent(d("2026-06-15T22:20:00Z"), null)).toBe(true);
  });
  it("shows a draft exactly at the latest message time (>= boundary)", () => {
    expect(isDraftCurrent(d("2026-06-15T22:20:00Z"), d("2026-06-15T22:20:00Z"))).toBe(true);
  });
  it("accepts ISO strings as well as Date objects", () => {
    expect(isDraftCurrent("2026-06-15T22:20:00Z", "2026-06-16T01:34:00Z")).toBe(false);
  });
});

describe("adminCustomerDrafts — normalization", () => {
  it("inquiry draft → task: id, body from payload.draftBody, review = not sensitive", () => {
    const card = inquiryDraftCard({
      id: 12,
      riskLevel: "review",
      createdAt: d("2026-06-20"),
      payload: j({
        inquiryId: 5,
        draftBody: "您好,日本團還有名額,期待為您安排。",
        customerEmail: "jenny@gmail.com",
        subject: "日本團",
        classification: "general_inquiry",
      }),
    });
    expect(card).toMatchObject({
      id: "task:12",
      source: "inquiry",
      to: "jenny@gmail.com",
      subject: "日本團",
      sensitive: false,
      taskId: 12,
      messageId: null,
    });
    expect(card!.body).toContain("日本團");
    expect(card!.payload).toBe(
      // payload is carried verbatim so an inline edit can rebuild editedPayload
      j({ inquiryId: 5, draftBody: "您好,日本團還有名額,期待為您安排。", customerEmail: "jenny@gmail.com", subject: "日本團", classification: "general_inquiry" }),
    );
  });

  it("inquiry draft is sensitive when riskLevel = hard_gate", () => {
    const card = inquiryDraftCard({
      id: 1,
      riskLevel: "hard_gate",
      createdAt: d("2026-06-20"),
      payload: j({ draftBody: "退款處理中", classification: "general_inquiry" }),
    });
    expect(card!.sensitive).toBe(true);
  });

  it("inquiry draft is sensitive when classification is a 碰錢碰法律 class (even if riskLevel review)", () => {
    for (const cls of ["refund_request", "complaint", "quote_request", "deposit_inquiry", "visa_inquiry"]) {
      const card = inquiryDraftCard({
        id: 1,
        riskLevel: "review",
        createdAt: d("2026-06-20"),
        payload: j({ draftBody: "x", classification: cls }),
      });
      expect(card!.sensitive, cls).toBe(true);
    }
  });

  it("inquiry draft → null when no draftBody, or bad JSON", () => {
    expect(
      inquiryDraftCard({ id: 1, riskLevel: "review", createdAt: d("2026-06-20"), payload: j({ inquiryId: 5 }) }),
    ).toBeNull();
    expect(
      inquiryDraftCard({ id: 1, riskLevel: "review", createdAt: d("2026-06-20"), payload: "not json" }),
    ).toBeNull();
  });

  it("escalation draft → esc: id, body from context.draftReply, needs gmailThreadId", () => {
    const card = escalationDraftCard({
      id: 8,
      createdAt: d("2026-06-19"),
      context: j({
        draftReply: "Hi, here is the update on your booking.",
        gmailThreadId: "thread-abc",
        customerEmail: "leslie@x.com",
        classification: "general_inquiry",
        subject: "Re: trip",
      }),
    });
    expect(card).toMatchObject({
      id: "esc:8",
      source: "email",
      to: "leslie@x.com",
      subject: "Re: trip",
      sensitive: false,
      taskId: null,
      messageId: 8,
      payload: null,
    });
    expect(card!.body).toContain("update on your booking");
  });

  it("escalation draft → null when no gmailThreadId (nothing to reply into) or no draftReply", () => {
    expect(
      escalationDraftCard({ id: 1, createdAt: d("2026-06-19"), context: j({ draftReply: "hi", customerEmail: "a@b.com" }) }),
    ).toBeNull();
    expect(
      escalationDraftCard({ id: 1, createdAt: d("2026-06-19"), context: j({ gmailThreadId: "t" }) }),
    ).toBeNull();
    expect(escalationDraftCard({ id: 1, createdAt: d("2026-06-19"), context: null })).toBeNull();
  });

  it("escalation draft recovers recipient from fallbackEmail when context omits customerEmail", () => {
    const card = escalationDraftCard({
      id: 2,
      createdAt: d("2026-06-19"),
      fallbackEmail: "recovered@x.com",
      context: j({ draftReply: "hi", gmailThreadId: "t", classification: "refund_request" }),
    });
    expect(card!.to).toBe("recovered@x.com");
    expect(card!.sensitive).toBe(true); // refund_request is 碰錢碰法律
  });

  it("observation draft (shadow would_auto_send) → obs: card, sends via escalation path", () => {
    const card = observationDraftCard({
      id: 4,
      createdAt: d("2026-06-18"),
      context: j({
        sendOutcome: "would_auto_send",
        draftReply: "您好，我們已收到您的詢問，這是回覆。",
        gmailThreadId: "t-9",
        customerEmail: "jenny@gmail.com",
        classification: "general_inquiry",
      }),
    });
    expect(card).toMatchObject({
      id: "obs:4",
      source: "email",
      to: "jenny@gmail.com",
      sensitive: false,
      taskId: null,
      messageId: 4,
    });
  });

  it("observation plain draft (no sendOutcome) with a draftReply is included", () => {
    const card = observationDraftCard({
      id: 5,
      createdAt: d("2026-06-18"),
      context: j({ draftReply: "hi", gmailThreadId: "t" }),
    });
    expect(card!.id).toBe("obs:5");
  });

  it("observation already-sent (auto_replied) → null (not awaiting send)", () => {
    expect(
      observationDraftCard({
        id: 6,
        createdAt: d("2026-06-18"),
        context: j({ sendOutcome: "auto_replied", draftReply: "sent already", gmailThreadId: "t" }),
      }),
    ).toBeNull();
  });

  it("observation needs a gmailThreadId + draftReply, else null", () => {
    expect(
      observationDraftCard({ id: 1, createdAt: d("2026-06-18"), context: j({ draftReply: "hi" }) }),
    ).toBeNull();
    expect(
      observationDraftCard({ id: 1, createdAt: d("2026-06-18"), context: j({ gmailThreadId: "t" }) }),
    ).toBeNull();
  });

  it("mergeDrafts: newest-first across both stores, capped, no id collision", () => {
    const out = mergeDrafts(
      [
        [inquiryDraftCard({ id: 1, riskLevel: "review", createdAt: d("2026-06-01"), payload: j({ draftBody: "a" }) })!],
        [escalationDraftCard({ id: 1, createdAt: d("2026-06-10"), context: j({ draftReply: "b", gmailThreadId: "t" }) })!],
      ],
      5,
    );
    expect(out.map((x) => x.id)).toEqual(["esc:1", "task:1"]); // newest first; ids don't collide
  });
});

describe("onlyNewestDraft — 一個客人同時只留最新一張草稿卡(2026-07-02 leslie 疊卡)", () => {
  const card = (id: string, iso: string) =>
    ({ id, createdAt: new Date(iso) }) as unknown as Parameters<typeof onlyNewestDraft>[0][number]

  it("多張卡只留 mergeDrafts 排序後的第一張(最新)", () => {
    // mergeDrafts sorts newest-first; feed it pre-sorted like the endpoint does.
    const drafts = [card("obs:2", "2026-07-02T06:01:00Z"), card("esc:1", "2026-07-01T23:03:00Z")]
    const kept = onlyNewestDraft(drafts)
    expect(kept).toHaveLength(1)
    expect(kept[0].id).toBe("obs:2")
  })

  it("空清單回空,不炸", () => {
    expect(onlyNewestDraft([])).toEqual([])
  })

  it("單張卡原樣保留", () => {
    const drafts = [card("task:9", "2026-07-01T00:00:00Z")]
    expect(onlyNewestDraft(drafts)).toEqual(drafts)
  })

  it("與 mergeDrafts 串起來:新 followup 卡壓過舊 escalation 卡(leslie repro)", () => {
    const esc = card("esc:old", "2026-07-01T23:03:20Z")
    const obs = card("obs:new", "2026-07-02T06:01:39Z")
    const kept = onlyNewestDraft(mergeDrafts([[esc], [obs]]))
    expect(kept.map((c) => c.id)).toEqual(["obs:new"])
  })
})
