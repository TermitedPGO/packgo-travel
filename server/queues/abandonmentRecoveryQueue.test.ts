/**
 * Tests for the seat-hold expiry safety condition. This is load-bearing: the 24h
 * job auto-cancels a booking + releases its seats, so the ONLY bookings it may
 * touch are ones that never received any payment and aren't already cancelled.
 * A wrong condition here cancels paying customers' reservations.
 */
import { describe, it, expect } from "vitest";
import { shouldExpireUnpaidBooking } from "./abandonmentRecoveryQueue";

const b = (paymentStatus: string, bookingStatus: string) => ({ paymentStatus, bookingStatus });

describe("shouldExpireUnpaidBooking", () => {
  it("EXPIRES a never-paid booking (unpaid + still pending/confirmed)", () => {
    expect(shouldExpireUnpaidBooking(b("unpaid", "pending"))).toBe(true);
    expect(shouldExpireUnpaidBooking(b("unpaid", "confirmed"))).toBe(true);
  });

  it("NEVER expires a booking that paid a deposit", () => {
    expect(shouldExpireUnpaidBooking(b("deposit", "pending"))).toBe(false);
    expect(shouldExpireUnpaidBooking(b("deposit", "confirmed"))).toBe(false);
  });

  it("NEVER expires a fully-paid booking", () => {
    expect(shouldExpireUnpaidBooking(b("paid", "confirmed"))).toBe(false);
  });

  it("NEVER expires a refunded booking", () => {
    expect(shouldExpireUnpaidBooking(b("refunded", "cancelled"))).toBe(false);
    expect(shouldExpireUnpaidBooking(b("refunded", "confirmed"))).toBe(false);
  });

  it("NEVER re-cancels an already-cancelled booking (even if unpaid)", () => {
    expect(shouldExpireUnpaidBooking(b("unpaid", "cancelled"))).toBe(false);
  });

  it("treats null/unknown statuses as not-expirable (fail safe)", () => {
    expect(shouldExpireUnpaidBooking({ paymentStatus: null, bookingStatus: null })).toBe(false);
    expect(shouldExpireUnpaidBooking({ paymentStatus: "weird", bookingStatus: "pending" })).toBe(false);
  });
});
