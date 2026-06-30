/**
 * gmail-push (2026-06-29) — tests for the push-path pure functions + the
 * history-diff dedup/pagination/404 logic.
 *
 * Everything here is unit-testable with ZERO network / DB / real-googleapis
 * deps: the Pub/Sub envelope parser + bearer extractor are pure; the history
 * diff takes a gmail-client-shaped stub. googleapis / auth / env / token-crypto
 * / logger are mocked exactly like gmail.test.ts so importing gmail.ts is light.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("googleapis", () => ({ google: {} }));
vi.mock("google-auth-library", () => ({ OAuth2Client: class {} }));
vi.mock("./env", () => ({ ENV: {} }));
vi.mock("./tokenCrypto", () => ({ decryptToken: (s: string) => s }));
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  decodePubSubPushBody,
  extractBearerToken,
  listHistoryMessageIds,
  selectIngestableMessages,
} from "./gmail";

// ── helpers ────────────────────────────────────────────────────────────────

/** Build the raw Pub/Sub push envelope a real push request carries. */
function pubsubEnvelope(inner: unknown, opts?: { messageId?: string }): string {
  const data = Buffer.from(JSON.stringify(inner), "utf8").toString("base64");
  return JSON.stringify({
    message: {
      data,
      messageId: opts?.messageId ?? "1234567890",
      publishTime: "2026-06-29T00:00:00.000Z",
    },
    subscription: "projects/packgo/subscriptions/gmail-push",
  });
}

// ── decodePubSubPushBody ─────────────────────────────────────────────────────

describe("decodePubSubPushBody", () => {
  it("decodes a well-formed envelope to {emailAddress, historyId}", () => {
    const body = pubsubEnvelope({
      emailAddress: "support@packgoplay.com",
      historyId: 987654,
    });
    const out = decodePubSubPushBody(body);
    expect(out).toEqual({
      emailAddress: "support@packgoplay.com",
      historyId: "987654", // normalized to string
    });
  });

  it("accepts a Buffer body (express.raw delivers a Buffer)", () => {
    const body = Buffer.from(
      pubsubEnvelope({ emailAddress: "a@b.com", historyId: "42" }),
      "utf8",
    );
    expect(decodePubSubPushBody(body)).toEqual({
      emailAddress: "a@b.com",
      historyId: "42",
    });
  });

  it("returns null for non-JSON body", () => {
    expect(decodePubSubPushBody("not json {")).toBeNull();
  });

  it("returns null when message.data is missing", () => {
    expect(decodePubSubPushBody(JSON.stringify({ message: {} }))).toBeNull();
  });

  it("returns null when inner data is not valid base64 JSON", () => {
    const body = JSON.stringify({ message: { data: "@@@notbase64@@@" } });
    // Buffer.from tolerates junk → JSON.parse fails → null. Either way: null.
    expect(decodePubSubPushBody(body)).toBeNull();
  });

  it("returns null when emailAddress is absent", () => {
    expect(decodePubSubPushBody(pubsubEnvelope({ historyId: "1" }))).toBeNull();
  });

  it("returns null when historyId is absent", () => {
    expect(
      decodePubSubPushBody(pubsubEnvelope({ emailAddress: "a@b.com" })),
    ).toBeNull();
  });

  it("does not throw on a poison/empty body (webhook can 204-ack)", () => {
    expect(() => decodePubSubPushBody("")).not.toThrow();
    expect(decodePubSubPushBody("")).toBeNull();
  });
});

// ── extractBearerToken ───────────────────────────────────────────────────────

describe("extractBearerToken", () => {
  it("pulls the JWT out of a Bearer header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });
  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken("bearer xyz")).toBe("xyz");
  });
  it("trims surrounding whitespace", () => {
    expect(extractBearerToken("Bearer   tok  ")).toBe("tok");
  });
  it("returns null for a missing header", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
  });
  it("returns null for a non-Bearer scheme", () => {
    expect(extractBearerToken("Basic abc")).toBeNull();
  });
});

// ── listHistoryMessageIds (diff dedup / pagination / 404) ────────────────────

/** Minimal gmail-client stub exposing only users.history.list. */
function gmailStub(pages: Array<any>) {
  let call = 0;
  return {
    users: {
      history: {
        list: vi.fn(async () => {
          const page = pages[Math.min(call, pages.length - 1)];
          call++;
          if (page.__throw) throw page.__throw;
          return { data: page };
        }),
      },
    },
  } as any;
}

describe("listHistoryMessageIds", () => {
  it("collects messagesAdded ids and returns the latest historyId", async () => {
    const gmail = gmailStub([
      {
        historyId: "200",
        history: [
          { messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] },
          { messagesAdded: [{ message: { id: "m2", threadId: "t2" } }] },
        ],
      },
    ]);
    const out = await listHistoryMessageIds(gmail, "100");
    expect(out.expired).toBe(false);
    expect(out.latestHistoryId).toBe("200");
    expect(out.messageIds.sort()).toEqual(["m1", "m2"]);
  });

  it("de-dupes a message id that appears in multiple history records", async () => {
    const gmail = gmailStub([
      {
        historyId: "201",
        history: [
          { messagesAdded: [{ message: { id: "dup", threadId: "t" } }] },
          { messagesAdded: [{ message: { id: "dup", threadId: "t" } }] },
        ],
      },
    ]);
    const out = await listHistoryMessageIds(gmail, "100");
    expect(out.messageIds).toEqual(["dup"]);
  });

  it("walks pagination via nextPageToken", async () => {
    const gmail = gmailStub([
      {
        historyId: "300",
        nextPageToken: "p2",
        history: [{ messagesAdded: [{ message: { id: "a" } }] }],
      },
      {
        historyId: "301",
        history: [{ messagesAdded: [{ message: { id: "b" } }] }],
      },
    ]);
    const out = await listHistoryMessageIds(gmail, "100");
    expect(out.messageIds.sort()).toEqual(["a", "b"]);
    expect(out.latestHistoryId).toBe("301");
    expect(gmail.users.history.list).toHaveBeenCalledTimes(2);
  });

  it("caps at maxMessages and stops paging early", async () => {
    const gmail = gmailStub([
      {
        historyId: "400",
        nextPageToken: "p2",
        history: [
          { messagesAdded: [{ message: { id: "x1" } }] },
          { messagesAdded: [{ message: { id: "x2" } }] },
          { messagesAdded: [{ message: { id: "x3" } }] },
        ],
      },
      {
        historyId: "401",
        history: [{ messagesAdded: [{ message: { id: "x4" } }] }],
      },
    ]);
    const out = await listHistoryMessageIds(gmail, "100", { maxMessages: 2 });
    expect(out.messageIds).toHaveLength(2);
    // Stopped after page 1 (already hit the cap) — second page never fetched.
    expect(gmail.users.history.list).toHaveBeenCalledTimes(1);
  });

  it("signals expired (not a throw) on a 404 from history.list", async () => {
    const err: any = new Error("Requested entity was not found.");
    err.code = 404;
    const gmail = gmailStub([{ __throw: err }]);
    const out = await listHistoryMessageIds(gmail, "tooOld");
    expect(out.expired).toBe(true);
    expect(out.messageIds).toEqual([]);
    expect(out.latestHistoryId).toBeNull();
  });

  it("re-throws a non-404 error (transient failures must retry)", async () => {
    const err: any = new Error("backend error");
    err.code = 500;
    const gmail = gmailStub([{ __throw: err }]);
    await expect(listHistoryMessageIds(gmail, "100")).rejects.toThrow(
      "backend error",
    );
  });

  it("tolerates empty history (no messages added)", async () => {
    const gmail = gmailStub([{ historyId: "500" }]);
    const out = await listHistoryMessageIds(gmail, "100");
    expect(out.messageIds).toEqual([]);
    expect(out.latestHistoryId).toBe("500");
    expect(out.expired).toBe(false);
  });
});

// ── selectIngestableMessages (push/poll inbox-firewall parity) ───────────────
describe("selectIngestableMessages", () => {
  const PROCESSED = "Label_PROCESSED";
  const SUPPORT = "Label_SUPPORT";
  const msg = (id: string, labels: string[]) => ({ id, labels });

  it("drops messages already PACKGO_AI_PROCESSED", () => {
    const out = selectIngestableMessages(
      [msg("a", ["INBOX"]), msg("b", ["INBOX", PROCESSED])],
      PROCESSED,
      null,
    );
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("with a support label set, keeps ONLY messages carrying it (push never reads personal mail)", () => {
    const out = selectIngestableMessages(
      [
        msg("support", ["INBOX", SUPPORT]),
        msg("personal", ["INBOX"]), // Jeff's personal mail — must be dropped
      ],
      PROCESSED,
      SUPPORT,
    );
    expect(out.map((m) => m.id)).toEqual(["support"]);
  });

  it("with no support label (firewall off), keeps all non-processed (whole inbox, == poll)", () => {
    const out = selectIngestableMessages(
      [msg("a", ["INBOX"]), msg("b", ["INBOX"])],
      PROCESSED,
      null,
    );
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("applies both gates together (support label AND not processed)", () => {
    const out = selectIngestableMessages(
      [
        msg("keep", ["INBOX", SUPPORT]),
        msg("done", ["INBOX", SUPPORT, PROCESSED]), // labeled but already processed
        msg("personal", ["INBOX"]),
      ],
      PROCESSED,
      SUPPORT,
    );
    expect(out.map((m) => m.id)).toEqual(["keep"]);
  });
});
