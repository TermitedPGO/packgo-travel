/**
 * Tests for MarketingHub (Batch 4 m1-m2) — pure logic only.
 *
 * i18n key coverage is handled by workspaceI18n.test.ts (auto-scans all
 * workspace/*.tsx files).
 */
import { describe, it, expect } from "vitest";

// Re-implement campaignState locally since it's not exported.
// If the mapping changes in MarketingHub.tsx, this test must be updated.
type CardState = "decide" | "running" | "wait" | "done" | "err" | "none";
function campaignState(status: string): CardState {
  if (status === "draft") return "decide";
  if (status === "scheduled") return "wait";
  if (status === "sending") return "running";
  if (status === "sent") return "done";
  if (status === "cancelled") return "done";
  return "none";
}

describe("campaignState (m1)", () => {
  it("maps draft → decide (needs action)", () => {
    expect(campaignState("draft")).toBe("decide");
  });

  it("maps scheduled → wait", () => {
    expect(campaignState("scheduled")).toBe("wait");
  });

  it("maps sending → running", () => {
    expect(campaignState("sending")).toBe("running");
  });

  it("maps sent → done", () => {
    expect(campaignState("sent")).toBe("done");
  });

  it("maps cancelled → done (terminal)", () => {
    expect(campaignState("cancelled")).toBe("done");
  });

  it("unknown status → none", () => {
    expect(campaignState("bogus")).toBe("none");
  });
});

describe("campaign sort priority (m1)", () => {
  const order: Record<CardState, number> = {
    decide: 0,
    running: 1,
    wait: 2,
    err: 3,
    done: 4,
    none: 5,
  };

  it("decide (draft) sorts before done (sent)", () => {
    expect(order[campaignState("draft")]).toBeLessThan(
      order[campaignState("sent")],
    );
  });

  it("running (sending) sorts before wait (scheduled)", () => {
    expect(order[campaignState("sending")]).toBeLessThan(
      order[campaignState("scheduled")],
    );
  });
});

describe("newsletter email campaign filter (m2)", () => {
  const campaigns = [
    { id: 1, type: "social_post", status: "draft" },
    { id: 2, type: "email_newsletter", status: "draft" },
    { id: 3, type: "poster", status: "sent" },
    { id: 4, type: "email_newsletter", status: "sent" },
  ];

  it("filters to only email_newsletter type", () => {
    const filtered = campaigns.filter((c) => c.type === "email_newsletter");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((c) => c.type === "email_newsletter")).toBe(true);
  });

  it("canSend only for draft/scheduled", () => {
    const canSend = (status: string) =>
      status === "draft" || status === "scheduled";
    expect(canSend("draft")).toBe(true);
    expect(canSend("scheduled")).toBe(true);
    expect(canSend("sent")).toBe(false);
    expect(canSend("sending")).toBe(false);
  });
});
