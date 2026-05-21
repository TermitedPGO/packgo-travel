/**
 * v2 Wave 2 · Module 2.1 — server/db/booking.ts smoke test.
 *
 * Sanity-check the extraction:
 *
 *   Case 1 (named exports)
 *     - The 13 booking-domain functions exist and are typeof "function".
 *
 *   Case 2 (lazy-DB null path)
 *     - getBookingById(id) returns undefined when getDb() resolves to null
 *       (no DATABASE_URL in CI). This is the "happy" no-DB path the v1 helpers
 *       have always supported so local tooling can run without a live MySQL.
 *
 * Mocks `../db` to stub getDb() → null so we never need a real connection.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

import {
  getUserBookings,
  getActiveBookingsByDepartureId,
  getAllBookings,
  getBookingById,
  createBooking,
  updateBooking,
  getBookingParticipants,
  createBookingParticipant,
  replaceBookingParticipants,
  getBookingPayments,
  createPayment,
  getPaymentByIntentId,
  updatePaymentStatus,
} from "./booking";

describe("db/booking — module surface", () => {
  it("exports the 13 booking + payment CRUD functions", () => {
    expect(typeof getUserBookings).toBe("function");
    expect(typeof getActiveBookingsByDepartureId).toBe("function");
    expect(typeof getAllBookings).toBe("function");
    expect(typeof getBookingById).toBe("function");
    expect(typeof createBooking).toBe("function");
    expect(typeof updateBooking).toBe("function");
    expect(typeof getBookingParticipants).toBe("function");
    expect(typeof createBookingParticipant).toBe("function");
    expect(typeof replaceBookingParticipants).toBe("function");
    expect(typeof getBookingPayments).toBe("function");
    expect(typeof createPayment).toBe("function");
    expect(typeof getPaymentByIntentId).toBe("function");
    expect(typeof updatePaymentStatus).toBe("function");
  });
});

describe("db/booking — happy-path null-DB behavior", () => {
  it("getBookingById returns undefined when DB pool is null", async () => {
    const result = await getBookingById(123);
    expect(result).toBeUndefined();
  });
});
