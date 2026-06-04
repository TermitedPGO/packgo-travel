/**
 * Phase 1.1: the single source of truth for a booking's customer-facing
 * fulfillment state, derived from the supplier state machine + booking status.
 *
 * THE RULE: we tell a customer their seat is "secured / confirmed" ONLY when the
 * SUPPLIER has confirmed it (supplierStatus === 'vendor_confirmed'). A customer
 * paying PACK&GO is NOT the same as the seat being secured with UV / Lion.
 * Conflating the two over-promises, and an over-promise that later falls through
 * is exactly what fuels chargebacks. Payment status deliberately does NOT feed
 * this function.
 *
 * Returns a stable KEY. The client maps the key to an i18n label + tone so all
 * display strings live in one place (zh-TW.ts / en.ts). Pure + dependency-free
 * so it is trivially unit-testable and shareable by both client and server.
 */
export type FulfillmentState =
  | "cancelled" // booking cancelled (terminal) — wins over everything
  | "rejected" // supplier rejected / sold out; needs action (refund / re-book)
  | "secured" // supplier confirmed; the seat is really held
  | "waitlisted" // on the supplier waitlist
  | "processing"; // default: request received / order placed / awaiting supplier

export function bookingFulfillmentState(booking: {
  bookingStatus?: string | null;
  supplierStatus?: string | null;
}): FulfillmentState {
  // A cancelled booking is terminal regardless of where the supplier order sat.
  if (booking.bookingStatus === "cancelled") return "cancelled";
  switch (booking.supplierStatus) {
    case "vendor_confirmed":
      return "secured";
    case "vendor_rejected":
      return "rejected";
    case "waitlisted":
      return "waitlisted";
    // not_placed / placed / null / undefined / unknown all read as "processing"
    default:
      return "processing";
  }
}

/** Colour intent for the status badge. */
export type FulfillmentTone = "success" | "warning" | "danger" | "neutral";

export function fulfillmentTone(state: FulfillmentState): FulfillmentTone {
  switch (state) {
    case "secured":
      return "success";
    case "waitlisted":
      return "warning";
    case "rejected":
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}
