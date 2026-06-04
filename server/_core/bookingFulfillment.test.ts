/**
 * Tests for the booking fulfillment state derivation. This is load-bearing: it
 * decides whether we tell a customer their seat is "secured / confirmed". The
 * core invariant under test — payment does NOT make a booking "secured"; only
 * the supplier confirming does.
 */
import { describe, it, expect } from "vitest";
import {
  bookingFulfillmentState,
  fulfillmentTone,
} from "@shared/bookingFulfillment";

describe("bookingFulfillmentState", () => {
  it("is 'secured' ONLY when the supplier confirmed", () => {
    expect(
      bookingFulfillmentState({ bookingStatus: "confirmed", supplierStatus: "vendor_confirmed" }),
    ).toBe("secured");
  });

  it("never says 'secured' off payment alone (not_placed / placed stay processing)", () => {
    expect(bookingFulfillmentState({ bookingStatus: "confirmed", supplierStatus: "not_placed" })).toBe(
      "processing",
    );
    expect(bookingFulfillmentState({ bookingStatus: "confirmed", supplierStatus: "placed" })).toBe(
      "processing",
    );
  });

  it("maps rejected + waitlisted through", () => {
    expect(bookingFulfillmentState({ supplierStatus: "vendor_rejected" })).toBe("rejected");
    expect(bookingFulfillmentState({ supplierStatus: "waitlisted" })).toBe("waitlisted");
  });

  it("cancelled wins over any supplier state (even vendor_confirmed)", () => {
    expect(
      bookingFulfillmentState({ bookingStatus: "cancelled", supplierStatus: "vendor_confirmed" }),
    ).toBe("cancelled");
    expect(
      bookingFulfillmentState({ bookingStatus: "cancelled", supplierStatus: "not_placed" }),
    ).toBe("cancelled");
  });

  it("treats null / undefined / unknown supplierStatus as processing (fail safe)", () => {
    expect(bookingFulfillmentState({})).toBe("processing");
    expect(bookingFulfillmentState({ supplierStatus: null })).toBe("processing");
    expect(bookingFulfillmentState({ supplierStatus: "weird_value" })).toBe("processing");
  });
});

describe("fulfillmentTone", () => {
  it("maps each state to a colour intent", () => {
    expect(fulfillmentTone("secured")).toBe("success");
    expect(fulfillmentTone("waitlisted")).toBe("warning");
    expect(fulfillmentTone("rejected")).toBe("danger");
    expect(fulfillmentTone("cancelled")).toBe("danger");
    expect(fulfillmentTone("processing")).toBe("neutral");
  });
});
