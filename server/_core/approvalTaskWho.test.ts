/**
 * Tests for approvalTaskWho — payload → customer ref parsing and the batched
 * who-enrichment used by commandCenter.list / workspace 今日待辦.
 *
 * Payload shapes mirror the real producers (2026-06-09 audit):
 *   cs    (inquiryReplyProducer): { inquiryId, customerEmail?, customerName?, ... }
 *   quote (quoteProducer):        { customerName?, customerEmail?, tourId, ... }
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";
import { extractCustomerRef, enrichTasksWithWho } from "./approvalTaskWho";

const getDbMock = vi.mocked(getDb);

/**
 * Fake drizzle handle: each select() call resolves (at .where()) to the next
 * row set in `resultsPerSelect`, matching enrich's call order — inquiries
 * first (when any cs refs), users second (when any emails).
 */
function fakeDb(resultsPerSelect: any[][]) {
  let call = 0;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve(resultsPerSelect[call++] ?? []),
      }),
    })),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractCustomerRef", () => {
  it("parses cs payloads (inquiryId + name + email)", () => {
    const ref = extractCustomerRef(
      "cs",
      JSON.stringify({
        inquiryId: 7,
        customerName: " 陳美玲 ",
        customerEmail: " mei@example.com ",
        draftBody: "…",
      }),
    );
    expect(ref).toEqual({
      inquiryId: 7,
      customerName: "陳美玲",
      customerEmail: "mei@example.com",
    });
  });

  it("parses quote payloads (no inquiryId even if present-shaped)", () => {
    const ref = extractCustomerRef(
      "quote",
      JSON.stringify({
        tourId: 5,
        customerEmail: "bob@example.com",
        inquiryId: 99,
      }),
    );
    expect(ref).toEqual({ customerEmail: "bob@example.com" });
  });

  it("returns null for company-wide lanes", () => {
    expect(
      extractCustomerRef("marketing", JSON.stringify({ customerName: "x" })),
    ).toBeNull();
    expect(
      extractCustomerRef("finance", JSON.stringify({ customerEmail: "x@y.z" })),
    ).toBeNull();
  });

  it("returns null on malformed payloads instead of throwing", () => {
    expect(extractCustomerRef("cs", "not json")).toBeNull();
    expect(extractCustomerRef("cs", "[1,2]")).toBeNull();
    expect(extractCustomerRef("cs", "null")).toBeNull();
    expect(extractCustomerRef("cs", JSON.stringify({ draftBody: "x" }))).toBeNull();
    expect(
      extractCustomerRef("quote", JSON.stringify({ customerName: "  " })),
    ).toBeNull();
  });
});

describe("enrichTasksWithWho", () => {
  it("resolves cs via the inquiry row (fresh name + userId) and quote via users-by-email", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        // select #1 — inquiries by id
        [
          {
            id: 9,
            userId: 77,
            customerName: "陳美玲",
            customerEmail: "mei@example.com",
          },
        ],
        // select #2 — users by email
        [{ id: 88, email: "bob@example.com", name: "Bob Wang" }],
      ]) as any,
    );

    const tasks = [
      {
        lane: "cs",
        payload: JSON.stringify({
          inquiryId: 9,
          customerName: "舊名字",
          customerEmail: "mei@example.com",
        }),
      },
      {
        lane: "quote",
        payload: JSON.stringify({ customerEmail: "Bob@Example.com" }),
      },
      { lane: "finance", payload: JSON.stringify({}) },
    ];

    const out = await enrichTasksWithWho(tasks as any);
    expect(out[0].who).toEqual({ label: "陳美玲", userId: 77 });
    expect(out[1].who).toEqual({ label: "Bob Wang", userId: 88 });
    expect(out[2].who).toBeNull();
  });

  it("guest inquiry (userId null, unknown email) → label without jump target", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        [
          {
            id: 3,
            userId: null,
            customerName: "路人甲",
            customerEmail: "guest@nowhere.com",
          },
        ],
        [], // users by email — no match
      ]) as any,
    );

    const out = await enrichTasksWithWho([
      {
        lane: "cs",
        payload: JSON.stringify({
          inquiryId: 3,
          customerEmail: "guest@nowhere.com",
        }),
      },
    ] as any);

    expect(out[0].who).toEqual({ label: "路人甲", userId: null });
  });

  it("db unavailable → falls back to payload label, userId null", async () => {
    getDbMock.mockResolvedValue(undefined as any);

    const out = await enrichTasksWithWho([
      {
        lane: "quote",
        payload: JSON.stringify({
          customerName: "王建國",
          customerEmail: "wang@example.com",
        }),
      },
    ] as any);

    expect(out[0].who).toEqual({ label: "王建國", userId: null });
  });

  it("email-only ref falls back to the email as label", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]]) as any);

    const out = await enrichTasksWithWho([
      {
        lane: "quote",
        payload: JSON.stringify({ customerEmail: "only@email.com" }),
      },
    ] as any);

    expect(out[0].who).toEqual({ label: "only@email.com", userId: null });
  });
});
