/**
 * threadFiling tests (gmail-full-thread-filing [4]).
 *
 * The claim-or-insert correctness lives in the PURE `planThreadFiling` /
 * `bodyPrefix`, which we test exhaustively:
 *   - idempotent (plan → apply → re-plan = all skips, 列數不變)
 *   - claims a legacy NULL-externalId row (incl. the inbound "From:/Subject:"
 *     header-prefixed content)
 *   - direction- and time-window-aware (mismatch → insert, not a wrong claim)
 *   - dedup by externalId (Message-ID already filed → skip)
 *   - Trash excluded
 *   - a legacy row is claimed at most once
 *
 * `syncThreadToInteractions` (the thin DB executor) is covered with a lightweight
 * fake db asserting the resulting counts + payloads (never mutating content on
 * claim, scrubbing PII on insert) — the live DB path follows the repo's
 * Gmail-pipeline norm (verified on deploy).
 */

import { describe, it, expect, vi } from "vitest";
import {
  planThreadFiling,
  bodyPrefix,
  syncThreadToInteractions,
  type FilingAction,
  type ExistingInteractionRow,
} from "./threadFiling";
import type { FilingMessage } from "./gmail";

const SELF = "jeffhsieh09@gmail.com";

function msg(over: Partial<FilingMessage>): FilingMessage {
  return {
    id: "gid-" + (over.messageId ?? over.id ?? "x"),
    messageId: "mid-1",
    threadId: "thread-1",
    from: "jenny@example.com",
    date: new Date("2026-06-15T10:00:00Z"),
    direction: "inbound",
    body: "Hello Jeff, here is my question about the trip.",
    inTrash: false,
    ...over,
  };
}

function legacy(over: Partial<ExistingInteractionRow>): ExistingInteractionRow {
  return {
    id: 1,
    externalId: null,
    direction: "inbound",
    content: "Hello Jeff, here is my question about the trip.",
    createdAt: new Date("2026-06-15T10:00:00Z"),
    ...over,
  };
}

/** Simulate persisting the planned actions, so we can re-plan for idempotency. */
function apply(
  existing: ExistingInteractionRow[],
  actions: FilingAction[],
): ExistingInteractionRow[] {
  const next = existing.map((r) => ({ ...r }));
  let nextId = Math.max(0, ...next.map((r) => r.id)) + 1;
  for (const a of actions) {
    if (a.kind === "claim") {
      const row = next.find((r) => r.id === a.rowId)!;
      row.externalId = a.messageId;
      row.createdAt = a.createdAt;
    } else if (a.kind === "insert") {
      next.push({
        id: nextId++,
        externalId: a.message.messageId,
        direction: a.message.direction,
        content: a.message.body,
        createdAt: a.message.date,
      });
    }
  }
  return next;
}

const countKinds = (actions: FilingAction[]) => ({
  insert: actions.filter((a) => a.kind === "insert").length,
  claim: actions.filter((a) => a.kind === "claim").length,
  skip: actions.filter((a) => a.kind === "skip").length,
});

describe("bodyPrefix", () => {
  it("strips the inbound From:/Subject: header block", () => {
    const withHeader =
      "From: Jenny <jenny@example.com>\nSubject: Re: trip\n\nHello Jeff, here is my question.";
    const raw = "Hello Jeff, here is my question.";
    expect(bodyPrefix(withHeader)).toBe(bodyPrefix(raw));
  });
  it("collapses whitespace, lowercases, truncates to 64 chars", () => {
    const a = bodyPrefix("Hello   Jeff,\n\n  HERE is\tmy question about the trip and the dates and more");
    expect(a).toBe("hello jeff, here is my question about the trip and the dates and");
    expect(a.length).toBe(64);
  });
  it("is empty for empty/whitespace input", () => {
    expect(bodyPrefix("")).toBe("");
    expect(bodyPrefix("   \n  ")).toBe("");
  });
});

describe("planThreadFiling — insert when nothing exists", () => {
  it("inserts every fresh message", () => {
    const messages = [
      msg({ messageId: "m-in", direction: "inbound", from: "jenny@example.com" }),
      msg({ messageId: "m-out", direction: "outbound", from: SELF, body: "Hi Jenny, quote attached." }),
    ];
    const actions = planThreadFiling(messages, []);
    expect(countKinds(actions)).toEqual({ insert: 2, claim: 0, skip: 0 });
  });
});

describe("planThreadFiling — idempotency (列數不變)", () => {
  it("re-planning after apply yields all skips and zero new rows", () => {
    const messages = [
      msg({ messageId: "m-in", direction: "inbound" }),
      msg({ messageId: "m-out", direction: "outbound", from: SELF, body: "Reply text" }),
    ];
    const first = planThreadFiling(messages, []);
    const afterFirst = apply([], first);
    expect(afterFirst).toHaveLength(2);

    const second = planThreadFiling(messages, afterFirst);
    expect(countKinds(second)).toEqual({ insert: 0, claim: 0, skip: 2 });
    const afterSecond = apply(afterFirst, second);
    expect(afterSecond).toHaveLength(2); // 列數不變
  });
});

describe("planThreadFiling — claim legacy NULL rows", () => {
  it("claims a same-direction legacy row within the window with matching prefix", () => {
    const messages = [msg({ messageId: "m-1", direction: "inbound" })];
    const existing = [legacy({ id: 7 })];
    const actions = planThreadFiling(messages, existing);
    expect(countKinds(actions)).toEqual({ insert: 0, claim: 1, skip: 0 });
    const claim = actions[0];
    expect(claim.kind).toBe("claim");
    if (claim.kind === "claim") {
      expect(claim.rowId).toBe(7);
      expect(claim.messageId).toBe("m-1");
      expect(claim.createdAt).toEqual(messages[0].date);
    }
  });

  it("claims a legacy inbound row whose content carries the From:/Subject: header", () => {
    const messages = [msg({ messageId: "m-2", body: "Hello Jeff, here is my question." })];
    const existing = [
      legacy({
        id: 9,
        content:
          "From: Jenny <jenny@example.com>\nSubject: Re: trip\n\nHello Jeff, here is my question.",
      }),
    ];
    const actions = planThreadFiling(messages, existing);
    expect(countKinds(actions)).toEqual({ insert: 0, claim: 1, skip: 0 });
  });

  it("corrects createdAt: claim carries the Gmail date even when the legacy row was filed late", () => {
    const gmailDate = new Date("2026-06-15T10:00:00Z");
    const filedLate = new Date("2026-06-15T18:30:00Z"); // 8.5h later, same day → within ±1d
    const messages = [msg({ messageId: "m-3", date: gmailDate })];
    const existing = [legacy({ id: 3, createdAt: filedLate })];
    const actions = planThreadFiling(messages, existing);
    expect(actions[0].kind).toBe("claim");
    if (actions[0].kind === "claim") expect(actions[0].createdAt).toEqual(gmailDate);
  });
});

describe("planThreadFiling — conservative: insert instead of a wrong claim", () => {
  it("does NOT claim a legacy row of the opposite direction", () => {
    const messages = [msg({ messageId: "m-in", direction: "inbound" })];
    const existing = [legacy({ id: 5, direction: "outbound" })];
    const actions = planThreadFiling(messages, existing);
    expect(countKinds(actions)).toEqual({ insert: 1, claim: 0, skip: 0 });
  });

  it("does NOT claim a legacy row outside the ±1 day window", () => {
    const messages = [msg({ messageId: "m-in", date: new Date("2026-06-15T10:00:00Z") })];
    const existing = [legacy({ id: 5, createdAt: new Date("2026-06-13T10:00:00Z") })]; // 2 days off
    const actions = planThreadFiling(messages, existing);
    expect(countKinds(actions)).toEqual({ insert: 1, claim: 0, skip: 0 });
  });

  it("does NOT claim when the body prefix differs", () => {
    const messages = [msg({ messageId: "m-in", body: "A totally different message body." })];
    const existing = [legacy({ id: 5, content: "Unrelated earlier note about something else." })];
    const actions = planThreadFiling(messages, existing);
    expect(countKinds(actions)).toEqual({ insert: 1, claim: 0, skip: 0 });
  });

  it("claims a legacy row at most once (second match inserts)", () => {
    const messages = [
      msg({ messageId: "m-a", date: new Date("2026-06-15T10:00:00Z") }),
      msg({ messageId: "m-b", date: new Date("2026-06-15T10:05:00Z") }),
    ];
    const existing = [legacy({ id: 5, createdAt: new Date("2026-06-15T10:01:00Z") })];
    const actions = planThreadFiling(messages, existing);
    // m-a is closest (1min) → claims row 5; m-b → insert
    expect(countKinds(actions)).toEqual({ insert: 1, claim: 1, skip: 0 });
    const claim = actions.find((a) => a.kind === "claim");
    expect(claim?.kind === "claim" && claim.messageId).toBe("m-a");
  });
});

describe("planThreadFiling — dedup by externalId", () => {
  it("skips a message whose Message-ID is already on a row", () => {
    const messages = [msg({ messageId: "already-here" })];
    const existing = [legacy({ id: 2, externalId: "already-here" })];
    const actions = planThreadFiling(messages, existing);
    expect(countKinds(actions)).toEqual({ insert: 0, claim: 0, skip: 1 });
    expect(actions[0].kind === "skip" && actions[0].reason).toBe("already_filed");
  });
});

describe("planThreadFiling — Trash excluded", () => {
  it("skips a trashed message (never inserts or claims it)", () => {
    const messages = [msg({ messageId: "m-trash", inTrash: true })];
    const existing: ExistingInteractionRow[] = [];
    const actions = planThreadFiling(messages, existing);
    expect(countKinds(actions)).toEqual({ insert: 0, claim: 0, skip: 1 });
    expect(actions[0].kind === "skip" && actions[0].reason).toBe("in_trash");
  });
});

// ── thin DB executor: assert counts + payloads via a lightweight fake db ──

function fakeDb(existing: ExistingInteractionRow[]) {
  const inserts: any[] = [];
  const updates: any[] = [];
  const db = {
    inserts,
    updates,
    select: () => ({ from: () => ({ where: async () => existing }) }),
    update: () => ({
      set: (s: any) => ({ where: async () => { updates.push(s); } }),
    }),
    insert: () => ({
      values: (v: any) => ({ onDuplicateKeyUpdate: async () => { inserts.push(v); } }),
    }),
  };
  return db as any;
}

describe("syncThreadToInteractions — executor", () => {
  it("returns zeros and never touches the db for empty input", async () => {
    const throwing = new Proxy({}, { get() { throw new Error("db should not be touched"); } });
    expect(await syncThreadToInteractions(throwing as any, 2550004, [])).toEqual({
      inserted: 0, claimed: 0, skipped: 0, trashSkipped: 0,
    });
    expect(await syncThreadToInteractions(throwing as any, 0, [msg({})])).toEqual({
      inserted: 0, claimed: 0, skipped: 0, trashSkipped: 0,
    });
  });

  it("inserts fresh messages (scrubbing PII) and is idempotent on re-run", async () => {
    const db1 = fakeDb([]);
    const messages = [
      msg({ messageId: "m-in", direction: "inbound", body: "book this card 4242 4242 4242 4242 please" }),
      msg({ messageId: "m-out", direction: "outbound", from: SELF, body: "Done, booked." }),
    ];
    const r1 = await syncThreadToInteractions(db1, 2550004, messages);
    expect(r1).toEqual({ inserted: 2, claimed: 0, skipped: 0, trashSkipped: 0 });
    expect(db1.inserts).toHaveLength(2);
    // PAN scrubbed at rest
    expect(db1.inserts[0].content).toContain("card redacted ****4242");
    expect(db1.inserts[0].content).not.toContain("4242 4242 4242 4242");
    expect(db1.inserts[0].externalId).toBe("m-in");
    expect(db1.inserts[0].gmailThreadId).toBe("thread-1");
    expect(db1.inserts[0].createdAt).toEqual(messages[0].date);

    // Second run sees the now-filed rows → all skips, zero inserts.
    const filed: ExistingInteractionRow[] = db1.inserts.map((v, i) => ({
      id: 100 + i,
      externalId: v.externalId,
      direction: v.direction,
      content: v.content,
      createdAt: v.createdAt,
    }));
    const db2 = fakeDb(filed);
    const r2 = await syncThreadToInteractions(db2, 2550004, messages);
    expect(r2).toEqual({ inserted: 0, claimed: 0, skipped: 2, trashSkipped: 0 });
    expect(db2.inserts).toHaveLength(0);
  });

  it("claims a legacy row by updating only key columns + createdAt (never content)", async () => {
    const db = fakeDb([legacy({ id: 42 })]);
    const r = await syncThreadToInteractions(db, 2550004, [msg({ messageId: "m-1" })]);
    expect(r).toEqual({ inserted: 0, claimed: 1, skipped: 0, trashSkipped: 0 });
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toHaveProperty("externalId", "m-1");
    expect(db.updates[0]).toHaveProperty("gmailThreadId", "thread-1");
    expect(db.updates[0]).toHaveProperty("createdAt");
    expect(db.updates[0]).not.toHaveProperty("content");
  });

  it("counts a trashed message as trashSkipped with no writes", async () => {
    const db = fakeDb([]);
    const r = await syncThreadToInteractions(db, 2550004, [msg({ messageId: "t", inTrash: true })]);
    expect(r).toEqual({ inserted: 0, claimed: 0, skipped: 0, trashSkipped: 1 });
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });
});
