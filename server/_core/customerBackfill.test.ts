/**
 * customerBackfill tests — the targeted "collect this customer" engine.
 *
 * Covers the real logic with an injected fake Gmail + a stateful fake db that
 * emulates UNIQUE(customerProfileId, externalId):
 *   - searchThreadIds builds the right query + honours the cap
 *   - backfillCustomerByEmail accumulates across threads and is idempotent
 *     (second run files nothing; cross-mailbox duplicate Message-ID collapses)
 *   - previewCustomerThreads is read-only and scrubs PII out of the sample
 *
 * googleapis/auth/env/token/logger are mocked so importing gmail.ts (transitively
 * pulled in) stays light — the functions under test take an injected gmail object.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("googleapis", () => ({ google: {} }));
vi.mock("google-auth-library", () => ({ OAuth2Client: class {} }));
vi.mock("./env", () => ({ ENV: {} }));
vi.mock("./tokenCrypto", () => ({ decryptToken: (s: string) => s }));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  buildThreadQuery,
  searchThreadIds,
  backfillCustomerByEmail,
  previewCustomerThreads,
} from "./customerBackfill";

const SELF = "jeffhsieh09@gmail.com";

/** A raw Gmail message shape listThreadMessagesForFiling understands. Body comes
 * via snippet (no payload text part → extractBody falls back to snippet). */
function gmsg(over: {
  id: string;
  threadId: string;
  from: string;
  mid: string;
  body: string;
  date: string; // ISO
  trash?: boolean;
}) {
  return {
    id: over.id,
    threadId: over.threadId,
    snippet: over.body,
    internalDate: String(new Date(over.date).getTime()),
    labelIds: over.trash ? ["TRASH"] : ["INBOX"],
    payload: {
      headers: [
        { name: "From", value: over.from },
        { name: "Message-ID", value: `<${over.mid}>` },
      ],
    },
  };
}

function makeGmail(
  threadIds: string[],
  byThread: Record<string, any[]>,
  listCalls: any[] = [],
) {
  return {
    users: {
      threads: {
        list: async (params: any) => {
          listCalls.push(params);
          return { data: { threads: threadIds.map((id) => ({ id })) } };
        },
        get: async ({ id }: any) => ({ data: { messages: byThread[id] ?? [] } }),
      },
    },
  } as any;
}

/** Stateful fake db emulating UNIQUE(customerProfileId, externalId): select
 * returns the running store; insert skips a colliding (profileId, externalId). */
function makeDb() {
  const rows: any[] = [];
  let nextId = 1;
  const db = {
    rows,
    // `where()` must support both direct-await (existing-rows query) and a
    // chained `.orderBy()` (threadFiling.ts's already-assigned-siblings query,
    // added for the B1 sibling-conflict fix — deterministic ORDER BY id ASC).
    // Wrapping in a real Promise with `.orderBy` attached satisfies both call
    // shapes with the same underlying data.
    select: () => ({
      from: () => ({
        where: () => {
          const snapshot = rows.map((r) => ({ ...r }));
          const p = Promise.resolve(snapshot) as any;
          p.orderBy = () => Promise.resolve(snapshot);
          return p;
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: () => ({
      values: (v: any) => ({
        onDuplicateKeyUpdate: async () => {
          const dup = rows.some(
            (r) => r.customerProfileId === v.customerProfileId && r.externalId === v.externalId,
          );
          if (!dup) rows.push({ id: nextId++, ...v });
        },
      }),
    }),
  };
  return db as any;
}

describe("buildThreadQuery", () => {
  it("searches both directions and excludes Trash + Spam", () => {
    expect(buildThreadQuery("eyoung@axt.com")).toBe(
      "(from:eyoung@axt.com OR to:eyoung@axt.com) -in:trash -in:spam",
    );
  });
});

describe("searchThreadIds", () => {
  it("returns thread ids and passes the query + cap", async () => {
    const listCalls: any[] = [];
    const gmail = makeGmail(["t1", "t2", "t3"], {}, listCalls);
    const ids = await searchThreadIds(gmail, "eyoung@axt.com", 50);
    expect(ids).toEqual(["t1", "t2", "t3"]);
    expect(listCalls[0]).toMatchObject({
      userId: "me",
      q: "(from:eyoung@axt.com OR to:eyoung@axt.com) -in:trash -in:spam",
      maxResults: 50,
    });
  });
});

describe("backfillCustomerByEmail", () => {
  const byThread = {
    t1: [
      gmsg({ id: "g1", threadId: "t1", from: "eyoung@axt.com", mid: "m1", body: "Hi Jeff, please book the flight.", date: "2026-06-08T20:16:00Z" }),
      gmsg({ id: "g2", threadId: "t1", from: SELF, mid: "m2", body: "Booked, here is the invoice.", date: "2026-06-08T21:00:00Z" }),
    ],
    t2: [
      gmsg({ id: "g3", threadId: "t2", from: "eyoung@axt.com", mid: "m3", body: "Another employee needs a quote.", date: "2026-05-01T10:00:00Z" }),
    ],
  };

  it("files every thread, sets direction by selfEmail, and is idempotent", async () => {
    const db = makeDb();
    const gmail = makeGmail(["t1", "t2"], byThread);

    const r1 = await backfillCustomerByEmail(db, gmail, SELF, 555, "eyoung@axt.com");
    expect(r1.threadsSeen).toBe(2);
    expect(r1.inserted).toBe(3);
    expect(r1.claimed).toBe(0);
    expect(db.rows).toHaveLength(3);
    // direction resolved against selfEmail
    expect(db.rows.find((r: any) => r.externalId === "m2").direction).toBe("outbound");
    expect(db.rows.find((r: any) => r.externalId === "m1").direction).toBe("inbound");

    // Second run: nothing new (列數不變).
    const r2 = await backfillCustomerByEmail(db, gmail, SELF, 555, "eyoung@axt.com");
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(3);
    expect(db.rows).toHaveLength(3);
  });

  it("collapses a cross-mailbox duplicate (same Message-ID) into one row", async () => {
    const db = makeDb();
    // mailbox A: thread tA with message m1
    const gmailA = makeGmail(["tA"], {
      tA: [gmsg({ id: "a1", threadId: "tA", from: "eyoung@axt.com", mid: "m1", body: "Same email, two boxes.", date: "2026-06-08T20:16:00Z" })],
    });
    // mailbox B (support@): a DIFFERENT Gmail thread id but the SAME RFC822 Message-ID
    const gmailB = makeGmail(["tB"], {
      tB: [gmsg({ id: "b1", threadId: "tB", from: "eyoung@axt.com", mid: "m1", body: "Same email, two boxes.", date: "2026-06-08T20:16:00Z" })],
    });

    const ra = await backfillCustomerByEmail(db, gmailA, SELF, 555, "eyoung@axt.com");
    const rb = await backfillCustomerByEmail(db, gmailB, "support@packgoplay.com", 555, "eyoung@axt.com");
    expect(ra.inserted).toBe(1);
    expect(rb.inserted).toBe(0); // dedup by Message-ID
    expect(db.rows).toHaveLength(1);
  });

  it("skips a trashed message in the thread", async () => {
    const db = makeDb();
    const gmail = makeGmail(["t1"], {
      t1: [
        gmsg({ id: "g1", threadId: "t1", from: "eyoung@axt.com", mid: "m1", body: "live one", date: "2026-06-08T20:16:00Z" }),
        gmsg({ id: "g2", threadId: "t1", from: "eyoung@axt.com", mid: "m2", body: "deleted one", date: "2026-06-08T20:17:00Z", trash: true }),
      ],
    });
    const r = await backfillCustomerByEmail(db, gmail, SELF, 555, "eyoung@axt.com");
    expect(r.inserted).toBe(1);
    expect(r.trashSkipped).toBe(1);
    expect(db.rows).toHaveLength(1);
  });
});

describe("previewCustomerThreads — read-only, scrubbed", () => {
  it("counts threads and returns a PII-scrubbed sample from the newest thread", async () => {
    const gmail = makeGmail(["t1", "t2"], {
      t1: [
        gmsg({ id: "g1", threadId: "t1", from: "eyoung@axt.com", mid: "m1", body: "book it with card 4242 4242 4242 4242 thanks", date: "2026-06-08T20:16:00Z" }),
        gmsg({ id: "g2", threadId: "t1", from: SELF, mid: "m2", body: "Done.", date: "2026-06-08T21:00:00Z" }),
      ],
    });
    const pv = await previewCustomerThreads(gmail, SELF, "eyoung@axt.com");
    expect(pv.threadsSeen).toBe(2);
    expect(pv.sample.length).toBe(2);
    const inbound = pv.sample.find((s) => s.direction === "inbound")!;
    expect(inbound.snippet).toContain("card redacted ****4242");
    expect(inbound.snippet).not.toContain("4242 4242 4242 4242");
    const outbound = pv.sample.find((s) => s.direction === "outbound");
    expect(outbound).toBeTruthy();
  });

  it("returns an empty sample when no threads match", async () => {
    const gmail = makeGmail([], {});
    const pv = await previewCustomerThreads(gmail, SELF, "nobody@nowhere.com");
    expect(pv.threadsSeen).toBe(0);
    expect(pv.sample).toEqual([]);
  });
});
