// server/email/index.ts — re-export shim. Public API preserved.
//
// Templates moved to server/email/templates/ in v2 Wave 2 Module 2.11.
// All existing call sites (stripeWebhook, autonomous agents, admin routers)
// continue importing from "../email" unchanged — Node.js directory module
// resolution picks up this index.ts.

export { getTransporter } from "./_shared";

export { sendBookingConfirmationEmail } from "./templates/bookingConfirmation";
export { sendPaymentSuccessEmail } from "./templates/paymentSuccess";
export { sendTripReminderEmail } from "./templates/tripReminder";
export { sendSupplierNotificationEmail } from "./templates/supplierNotification";
export { sendQuoteFollowUpEmail } from "./templates/quoteFollowUp";
export { sendReviewRequestEmail } from "./templates/reviewRequest";
export { sendAbandonmentRecoveryEmail } from "./templates/abandonmentRecovery";
export { sendVoucherIssuedEmail } from "./templates/voucherIssued";
export { sendWinbackEmail } from "./templates/winback";
export { sendCheckinEmail } from "./templates/checkin";
export { sendTrialEndingReminder } from "./templates/trialEnding";

// Re-export types used by callers
export type {
  BookingEmailData,
  PaymentSuccessEmailData,
  TripReminderEmailData,
  SupplierNotificationData,
  QuoteFollowUpData,
  ReviewRequestData,
  AbandonmentRecoveryData,
  VoucherIssuedEmailData,
  WinbackEmailData,
  CheckinEmailData,
  TrialEndingReminderData,
} from "./templates/types";
