/**
 * Pure helpers for the customer-list junk filter (server/routers/adminCustomers.ts).
 *
 * Two independent hide mechanisms, both reversible, nothing ever deleted:
 *   - MANUAL: Jeff marks an account 非客人 → customerProfiles.status = 'blocked'.
 *   - AUTO:   an account with zero real relationship (no booking, no inquiry, no
 *             recorded interaction) is hidden from the default view.
 *
 * Auto-hide deliberately spares email leads: a registered user Jeff is emailing
 * has a customerProfiles row with lastInteractionAt set, so they stay visible
 * even with 0 bookings / 0 inquiries. Both kinds are recoverable via the list's
 * "show hidden" toggle, so a false positive is never lost — only de-emphasized.
 */

export function isAutoHiddenCustomer(r: {
  bookingCount: number;
  inquiryCount: number;
  lastInteractionAt: Date | null;
}): boolean {
  return (
    r.bookingCount === 0 &&
    r.inquiryCount === 0 &&
    r.lastInteractionAt == null
  );
}

/**
 * A row is hidden from the default list when it is manually blocked OR caught by
 * the auto-junk rule. `blocked` is passed separately because the caller already
 * derives it from profile.status.
 */
export function isHiddenCustomer(
  r: { bookingCount: number; inquiryCount: number; lastInteractionAt: Date | null },
  blocked: boolean,
): boolean {
  return blocked || isAutoHiddenCustomer(r);
}
