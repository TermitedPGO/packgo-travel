/**
 * Tests for autoReplyBox.parseAutoReplyCard (email-auto-reply m2).
 */
import { describe, it, expect } from "vitest";
import { parseAutoReplyCard } from "./autoReplyBox";

const ctx = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    classification: "general_info",
    confidence: 95,
    sendOutcome: "would_auto_send",
    customerEmail: "mei@example.com",
    subject: "營業時間",
    draftReply: "您好,我們週一到週五…",
    gmailMessageId: "m-1",
    gmailThreadId: "t-1",
    ...over,
  });

describe("parseAutoReplyCard", () => {
  it("would_auto_send → shadow card with reply target", () => {
    const c = parseAutoReplyCard(ctx());
    expect(c).not.toBeNull();
    expect(c!.kind).toBe("shadow");
    expect(c!.replyable).toBe(true);
    expect(c!.confidence).toBe(95);
  });

  it("auto_replied → sent card", () => {
    expect(parseAutoReplyCard(ctx({ sendOutcome: "auto_replied" }))!.kind).toBe(
      "sent",
    );
  });

  it("ordinary draft observations are NOT cards", () => {
    expect(parseAutoReplyCard(ctx({ sendOutcome: null }))).toBeNull();
    expect(parseAutoReplyCard(ctx({ sendOutcome: "send_failed" }))).toBeNull();
  });

  it("missing thread/email → card without 跟進 (replyable=false)", () => {
    const c = parseAutoReplyCard(ctx({ gmailThreadId: null }));
    expect(c!.replyable).toBe(false);
  });

  it("bad JSON / null degrade to null", () => {
    expect(parseAutoReplyCard("junk")).toBeNull();
    expect(parseAutoReplyCard(null)).toBeNull();
    expect(parseAutoReplyCard(JSON.stringify([1]))).toBeNull();
  });
});
