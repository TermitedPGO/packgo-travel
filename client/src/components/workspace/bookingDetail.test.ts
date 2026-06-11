/**
 * bookingDetail.test — batch 6 m1: status chip mapping + payment breakdown.
 */
import { describe, it, expect } from "vitest";

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SUP_KEY: Record<string, string> = {
  not_placed: "workspace.bookingSupNotPlaced",
  placed: "workspace.bookingSupPlaced",
  vendor_confirmed: "workspace.bookingSupConfirmed",
  vendor_rejected: "workspace.bookingSupRejected",
  waitlisted: "workspace.bookingSupWaitlisted",
};
function supKey(status: string) {
  return SUP_KEY[status] ?? SUP_KEY.not_placed;
}

describe("booking detail — status chip mapping", () => {
  it("capitalizes paymentStatus for i18n key lookup", () => {
    expect(cap("unpaid")).toBe("Unpaid");
    expect(cap("deposit")).toBe("Deposit");
    expect(cap("paid")).toBe("Paid");
    expect(cap("refunded")).toBe("Refunded");
  });

  it("maps all supplier statuses to i18n keys", () => {
    expect(supKey("not_placed")).toBe("workspace.bookingSupNotPlaced");
    expect(supKey("placed")).toBe("workspace.bookingSupPlaced");
    expect(supKey("vendor_confirmed")).toBe("workspace.bookingSupConfirmed");
    expect(supKey("vendor_rejected")).toBe("workspace.bookingSupRejected");
    expect(supKey("waitlisted")).toBe("workspace.bookingSupWaitlisted");
  });

  it("falls back to not_placed for unknown status", () => {
    expect(supKey("unknown_value")).toBe("workspace.bookingSupNotPlaced");
  });
});

describe("booking detail — trust warning logic", () => {
  it("shows warning when paid but supplier not confirmed", () => {
    const shouldWarn = (paymentStatus: string, supplierStatus: string) =>
      paymentStatus !== "unpaid" && supplierStatus !== "vendor_confirmed";

    expect(shouldWarn("deposit", "not_placed")).toBe(true);
    expect(shouldWarn("paid", "placed")).toBe(true);
    expect(shouldWarn("paid", "vendor_confirmed")).toBe(false);
    expect(shouldWarn("unpaid", "not_placed")).toBe(false);
  });
});

describe("booking detail — locked state", () => {
  it("locks completed and cancelled bookings", () => {
    const isLocked = (status: string) =>
      status === "completed" || status === "cancelled";

    expect(isLocked("completed")).toBe(true);
    expect(isLocked("cancelled")).toBe(true);
    expect(isLocked("pending")).toBe(false);
    expect(isLocked("confirmed")).toBe(false);
  });
});
