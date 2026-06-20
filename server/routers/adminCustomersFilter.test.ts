import { describe, it, expect } from "vitest";
import { isAutoHiddenCustomer, isHiddenCustomer } from "./adminCustomersFilter";

describe("adminCustomersFilter — auto-junk rule", () => {
  it("hides an account with no booking, no inquiry, and no recorded interaction", () => {
    expect(
      isAutoHiddenCustomer({ bookingCount: 0, inquiryCount: 0, lastInteractionAt: null }),
    ).toBe(true);
  });

  it("keeps an account with at least one booking", () => {
    expect(
      isAutoHiddenCustomer({ bookingCount: 1, inquiryCount: 0, lastInteractionAt: null }),
    ).toBe(false);
  });

  it("keeps an account with at least one inquiry", () => {
    expect(
      isAutoHiddenCustomer({ bookingCount: 0, inquiryCount: 2, lastInteractionAt: null }),
    ).toBe(false);
  });

  it("spares an email lead: 0 bookings / 0 inquiries but a recorded interaction", () => {
    expect(
      isAutoHiddenCustomer({
        bookingCount: 0,
        inquiryCount: 0,
        lastInteractionAt: new Date("2026-06-01"),
      }),
    ).toBe(false);
  });
});

describe("adminCustomersFilter — combined hidden rule", () => {
  const active = { bookingCount: 3, inquiryCount: 1, lastInteractionAt: new Date("2026-06-01") };
  const junk = { bookingCount: 0, inquiryCount: 0, lastInteractionAt: null };

  it("manually blocked is always hidden, even for an active customer", () => {
    expect(isHiddenCustomer(active, true)).toBe(true);
  });

  it("a real active customer is shown when not blocked", () => {
    expect(isHiddenCustomer(active, false)).toBe(false);
  });

  it("auto-junk is hidden without any manual block", () => {
    expect(isHiddenCustomer(junk, false)).toBe(true);
  });
});
