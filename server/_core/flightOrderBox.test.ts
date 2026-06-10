/**
 * Tests for flightOrderBox — 代客訂機票最小狀態機 (批2 m4).
 *
 * Key invariants:
 *   - create lands at prepared, or awaiting_payment when a bookingUrl is
 *     given (real-world entry: Jeff records right after opening Trip.com).
 *   - awaiting_payment only from prepared; ticketed from prepared/awaiting
 *     but never from ticketed/cancelled; ticketed can NEVER be cancelled.
 *   - the module records results only — no payment fields, no passport
 *     numbers anywhere in the shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));
vi.mock("./auditLog", () => ({
  audit: vi.fn(),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getDb } from "../db";
import {
  listFlightOrders,
  createFlightOrder,
  markAwaitingPayment,
  markTicketed,
  cancelFlightOrder,
} from "./flightOrderBox";

const getDbMock = vi.mocked(getDb);

/** Thenable drizzle-chain fake; set() captures, insert resolves insertId. */
function fakeChain(result: unknown, capture?: { set?: unknown; values?: unknown }) {
  const p: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "update", "insert"]) {
    p[m] = () => p;
  }
  p.set = (arg: unknown) => {
    if (capture) capture.set = arg;
    return p;
  };
  p.values = (arg: unknown) => {
    if (capture) capture.values = arg;
    return p;
  };
  p.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
  return p;
}

function fakeDb(queue: unknown[], captures: Array<{ set?: any; values?: any }> = []) {
  let i = 0;
  const next = () => fakeChain(queue[i] ?? [], captures[i++]);
  return { select: next, update: next, insert: next } as any;
}

const ROW = (status: string) => ({ id: 5, status, customerUserId: 7 });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createFlightOrder", () => {
  it("lands at prepared without a bookingUrl", async () => {
    const caps: any[] = [{}];
    getDbMock.mockResolvedValue(fakeDb([[{ insertId: 9 }]], caps));
    const res = await createFlightOrder({
      customerUserId: 7,
      airline: "ANA",
      flightSummary: "NH008 SFO-NRT",
    });
    expect(res.status).toBe("prepared");
    expect(caps[0].values.status).toBe("prepared");
    // hard line: shape has no payment/passport-number fields
    expect(Object.keys(caps[0].values)).not.toContain("passportNumber");
  });

  it("lands directly at awaiting_payment when a bookingUrl is given", async () => {
    const caps: any[] = [{}];
    getDbMock.mockResolvedValue(fakeDb([[{ insertId: 9 }]], caps));
    const res = await createFlightOrder({
      customerUserId: 7,
      airline: "ANA",
      flightSummary: "NH008",
      bookingUrl: "https://trip.com/x",
    });
    expect(res.status).toBe("awaiting_payment");
    expect(caps[0].values.bookingUrl).toBe("https://trip.com/x");
  });
});

describe("markAwaitingPayment", () => {
  it("moves prepared → awaiting_payment with the url", async () => {
    const caps: any[] = [{}, {}];
    getDbMock.mockResolvedValue(fakeDb([[ROW("prepared")], []], caps));
    const res = await markAwaitingPayment(5, "https://trip.com/x");
    expect(res.status).toBe("awaiting_payment");
    expect(caps[1].set.bookingUrl).toBe("https://trip.com/x");
  });

  it("refuses from any state other than prepared", async () => {
    getDbMock.mockResolvedValue(fakeDb([[ROW("ticketed")]]));
    await expect(markAwaitingPayment(5, "u")).rejects.toThrow("only prepared");
  });
});

describe("markTicketed", () => {
  it("records pnr/eticket from awaiting_payment", async () => {
    const caps: any[] = [{}, {}];
    getDbMock.mockResolvedValue(fakeDb([[ROW("awaiting_payment")], []], caps));
    const res = await markTicketed(5, { pnr: "QX4T9M", eticketNumbers: "205-1" });
    expect(res.status).toBe("ticketed");
    expect(caps[1].set.pnr).toBe("QX4T9M");
  });

  it("also allowed straight from prepared (Jeff paid before recording)", async () => {
    getDbMock.mockResolvedValue(fakeDb([[ROW("prepared")], []]));
    await expect(markTicketed(5, {})).resolves.toMatchObject({ status: "ticketed" });
  });

  it("refuses double-ticketing and ticketing a cancelled order", async () => {
    getDbMock.mockResolvedValue(fakeDb([[ROW("ticketed")]]));
    await expect(markTicketed(5, {})).rejects.toThrow("already ticketed");
    getDbMock.mockResolvedValue(fakeDb([[ROW("cancelled")]]));
    await expect(markTicketed(5, {})).rejects.toThrow("cancelled");
  });
});

describe("cancelFlightOrder", () => {
  it("cancels prepared / awaiting_payment", async () => {
    getDbMock.mockResolvedValue(fakeDb([[ROW("awaiting_payment")], []]));
    await expect(cancelFlightOrder(5)).resolves.toMatchObject({ status: "cancelled" });
  });

  it("NEVER cancels a ticketed order (refunds are a separate flow)", async () => {
    getDbMock.mockResolvedValue(fakeDb([[ROW("ticketed")]]));
    await expect(cancelFlightOrder(5)).rejects.toThrow("separate flow");
  });
});

describe("listFlightOrders", () => {
  it("returns [] when db unavailable", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    expect(await listFlightOrders(7)).toEqual([]);
  });
});
