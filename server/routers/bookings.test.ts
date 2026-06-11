/**
 * Tests for the bookings sub-router.
 *
 * History:
 *   - Phase 4C extraction smoke (procedures surface, post-4D split).
 *   - Phases 1.1 / 1.5 / 2.5 added 3 admin procedures (supplier fulfillment).
 *   - Phase 0.1 / 0.2 (booking-hardening, 2026-06-11): behavioral tests —
 *     `create` must persist the booking currency (USD for UV departures, the
 *     column previously silently kept its TWD schema default → USD bookings
 *     displayed NT$ AND charged TWD at Stripe checkout), and
 *     `saveParticipants` must hard-require passport / DOB / nationality
 *     (supplier manifests are unfulfillable without them).
 *
 * All collaborators are mocked at the module boundary — no real DB rows are
 * ever written (per CLAUDE.md §7).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getTourById: vi.fn(),
  getDepartureById: vi.fn(),
  tryReserveDepartureSlots: vi.fn(),
  releaseDepartureSlots: vi.fn(async () => undefined),
  createBooking: vi.fn(),
  getBookingById: vi.fn(),
  replaceBookingParticipants: vi.fn(),
  getBookingParticipants: vi.fn(),
  updateBooking: vi.fn(),
}));
vi.mock("../rateLimit", () => ({
  checkBookingCreateRateLimit: vi.fn(async () => ({ allowed: true })),
  checkAdminMutationRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("../email", () => ({
  sendBookingConfirmationEmail: vi.fn(async () => true),
}));
vi.mock("../agents/exchangeRateAgent", () => ({
  convertCurrency: vi.fn(async (n: number) => n),
}));
// Dynamic imports inside bookings.create — vitest intercepts these too.
vi.mock("../_core/auditLog", () => ({
  audit: vi.fn(),
}));
vi.mock("../queue", () => ({
  bookingFollowupQueue: { add: vi.fn(async () => ({})) },
}));
vi.mock("../queues/abandonmentRecoveryQueue", () => ({
  scheduleAbandonmentRecovery: vi.fn(async () => undefined),
  scheduleSeatExpiry: vi.fn(async () => undefined),
}));

import { bookingsRouter } from "./bookings";
import * as db from "../db";
import { bookingFollowupQueue } from "../queue";

const getTourByIdMock = vi.mocked(db.getTourById);
const getDepartureByIdMock = vi.mocked(db.getDepartureById);
const tryReserveMock = vi.mocked(db.tryReserveDepartureSlots);
const createBookingMock = vi.mocked(db.createBooking);
const getBookingByIdMock = vi.mocked(db.getBookingById);
const replaceParticipantsMock = vi.mocked(db.replaceBookingParticipants);
const followupAddMock = vi.mocked(bookingFollowupQueue.add);

function userCaller(userId = 7) {
  return bookingsRouter.createCaller({
    user: { id: userId, role: "user", email: "user@example.com" },
    req: { headers: {} },
    res: {},
  } as any);
}

describe("bookingsRouter (Phase 4C extraction, post-4D split)", () => {
  it("exposes the 12 non-payment procedures (2 moved to bookingsPayment)", () => {
    const procs = Object.keys((bookingsRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "create",
        "list",
        "listParticipants",
        "saveParticipants",
        "getById",
        "cancel",
        "adminList",
        "adminGetDetail",
        "adminUpdateStatus",
        // Phase 1.1 / 1.5 / 2.5 supplier-fulfillment admin procedures
        "setSupplierStatus",
        "getOrderPacket",
        "setSupplierCost",
      ].sort(),
    );
  });
});

// ── Phase 0.1: booking currency persisted at create ─────────────────────────

const FUTURE = "2030-06-01T00:00:00.000Z";

function setupCreateMocks(opts: { departureCurrency: string; tourCurrency: string }) {
  getTourByIdMock.mockResolvedValue({
    id: 1,
    title: "Test tour",
    priceCurrency: opts.tourCurrency,
  } as any);
  getDepartureByIdMock.mockResolvedValue({
    id: 10,
    tourId: 1,
    departureDate: FUTURE,
    returnDate: FUTURE,
    status: "open",
    adultPrice: 1800,
    childPriceWithBed: null,
    childPriceNoBed: null,
    infantPrice: null,
    singleRoomSupplement: null,
    currency: opts.departureCurrency,
  } as any);
  tryReserveMock.mockResolvedValue({ reserved: true, available: 5 });
  createBookingMock.mockResolvedValue({ id: 123, tourId: 1, departureId: 10 } as any);
}

const createInput = {
  tourId: 1,
  departureId: 10,
  numberOfAdults: 2,
  contactName: "Alice",
  contactPhone: "+1-510-000-0000",
} as const;

describe("bookings.create — Phase 0.1 currency persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists USD on the booking row for a USD departure", async () => {
    setupCreateMocks({ departureCurrency: "USD", tourCurrency: "USD" });

    await userCaller().create(createInput);

    expect(createBookingMock).toHaveBeenCalledTimes(1);
    expect(createBookingMock.mock.calls[0][0]).toMatchObject({ currency: "USD" });
    // The confirmation-email job must agree with the persisted currency.
    expect(followupAddMock.mock.calls[0][1]).toMatchObject({ isUsd: true });
  });

  it("persists USD when only the tour headline is USD (UV import predating departures.currency)", async () => {
    setupCreateMocks({ departureCurrency: "TWD", tourCurrency: "USD" });

    await userCaller().create(createInput);

    expect(createBookingMock.mock.calls[0][0]).toMatchObject({ currency: "USD" });
    expect(followupAddMock.mock.calls[0][1]).toMatchObject({ isUsd: true });
  });

  it("persists TWD for a Lion (TWD) departure", async () => {
    setupCreateMocks({ departureCurrency: "TWD", tourCurrency: "TWD" });

    await userCaller().create(createInput);

    expect(createBookingMock.mock.calls[0][0]).toMatchObject({ currency: "TWD" });
    expect(followupAddMock.mock.calls[0][1]).toMatchObject({ isUsd: false });
  });
});

// ── Phase 0.2: saveParticipants requires passport / DOB / nationality ───────

const validParticipant = {
  participantType: "adult" as const,
  firstName: "Ming",
  lastName: "Wang",
  dateOfBirth: "1990-05-20",
  passportNumber: "E12345678",
  nationality: "TW",
};

describe("bookings.saveParticipants — Phase 0.2 required manifest fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookingByIdMock.mockResolvedValue({
      id: 5,
      userId: 7,
      numberOfAdults: 1,
      numberOfChildrenWithBed: 0,
      numberOfChildrenNoBed: 0,
      numberOfInfants: 0,
    } as any);
    replaceParticipantsMock.mockResolvedValue([{ id: 1 }] as any);
  });

  it("rejects a participant without a passport number", async () => {
    const { passportNumber: _omit, ...incomplete } = validParticipant;

    await expect(
      userCaller().saveParticipants({ bookingId: 5, participants: [incomplete as any] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(replaceParticipantsMock).not.toHaveBeenCalled();
  });

  it("rejects a participant without a date of birth", async () => {
    const { dateOfBirth: _omit, ...incomplete } = validParticipant;

    await expect(
      userCaller().saveParticipants({ bookingId: 5, participants: [incomplete as any] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(replaceParticipantsMock).not.toHaveBeenCalled();
  });

  it("rejects a participant without a nationality", async () => {
    const { nationality: _omit, ...incomplete } = validParticipant;

    await expect(
      userCaller().saveParticipants({ bookingId: 5, participants: [incomplete as any] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(replaceParticipantsMock).not.toHaveBeenCalled();
  });

  it("rejects an empty-string passport number", async () => {
    await expect(
      userCaller().saveParticipants({
        bookingId: 5,
        participants: [{ ...validParticipant, passportNumber: "" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(replaceParticipantsMock).not.toHaveBeenCalled();
  });

  it("accepts a complete manifest and routes it through the ENCRYPTING db wrapper", async () => {
    const saved = await userCaller().saveParticipants({
      bookingId: 5,
      participants: [validParticipant],
    });

    expect(saved).toEqual([{ id: 1 }]);
    // Red line: passportNumber must only ever flow through
    // db.replaceBookingParticipants (AES-256-GCM at rest) — never raw inserts.
    expect(replaceParticipantsMock).toHaveBeenCalledTimes(1);
    const [bookingId, rows] = replaceParticipantsMock.mock.calls[0];
    expect(bookingId).toBe(5);
    expect(rows[0]).toMatchObject({
      passportNumber: "E12345678",
      nationality: "TW",
    });
    expect((rows[0] as any).dateOfBirth).toBeInstanceOf(Date);
  });

  it("still rejects a manifest whose headcount mismatches the booking", async () => {
    await expect(
      userCaller().saveParticipants({
        bookingId: 5,
        participants: [validParticipant, { ...validParticipant, firstName: "Hua" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(replaceParticipantsMock).not.toHaveBeenCalled();
  });
});
