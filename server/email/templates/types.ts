// server/email/templates/types.ts
//
// Per-template payload types. Extracted verbatim from server/email.ts in
// v2 Wave 2 Module 2.11. Each interface matches one exported sender fn.
//
// Re-exported through ../index.ts so external callers keep
//   import type { BookingEmailData } from "../email";
// working unchanged.

export interface BookingEmailData {
  to: string; // Customer email address
  customerName: string;
  customerEmail: string;
  bookingId: number;
  tourTitle: string;
  departureDate: string;
  returnDate: string;
  numberOfAdults: number;
  numberOfChildren: number;
  numberOfInfants: number;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
  /** ISO currency of the booking (USD for UV tours, TWD for Lion). Defaults to TWD. */
  currency?: string;
  /** v78x: Optional customer language preference. Defaults to 'zh-TW' for backward compat. */
  language?: "zh-TW" | "en";
  /** QA audit Phase 9: pre-generated deposit invoice PDF URL. When present
   *  the email renders a prominent "下載訂金通知 / 立即付款" CTA so the
   *  customer never has to ask "how do I pay?". */
  depositInvoiceUrl?: string;
}

export interface PaymentSuccessEmailData {
  customerName: string;
  customerEmail: string;
  bookingId: number;
  tourTitle: string;
  paymentAmount: number;
  paymentType: "deposit" | "balance" | "full";
  /** Phase 0.1 (booking-hardening): ISO currency the customer was actually
   *  charged in (USD for UV tours, TWD for Lion). Defaults to TWD. */
  currency?: string;
  /** v78y: customer language preference; defaults to zh-TW */
  language?: "zh-TW" | "en";
}

export interface TripReminderEmailData {
  to: string;
  customerName: string;
  bookingId: number;
  tourTitle: string;
  departureDate: Date;
  returnDate: Date | null;
  daysOut: 30 | 14 | 7 | 3 | 1;
  balanceDue: number;
  balanceCurrency: string;
  balanceUnpaid: boolean;
  /** v78y: bilingual reminder copy */
  language?: "zh-TW" | "en";
}

export interface SupplierNotificationData {
  supplierEmail: string;
  supplierName?: string;
  supplierNotes?: string;
  /** Supplier may prefer English or Mandarin — default zh-TW */
  language?: "zh-TW" | "en";
  // Booking context
  bookingId: number;
  bookingReference?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail: string;
  tourTitle: string;
  departureDate: string;
  returnDate?: string;
  numberOfAdults: number;
  numberOfChildren?: number;
  numberOfInfants?: number;
  specialRequests?: string;
  agentEmail?: string;
}

export interface QuoteFollowUpData {
  customerEmail: string;
  customerName?: string;
  quoteNumber: string;
  pdfUrl?: string | null;
  /** Day mark — affects copy tone */
  stage: "24h" | "3d" | "7d";
  language?: "zh-TW" | "en";
  /** Brief recap of the trip (destination, days, party) so customer remembers */
  tripRecap?: string;
}

export interface ReviewRequestData {
  customerEmail: string;
  customerName: string;
  bookingId: number;
  tourTitle: string;
  language?: "zh-TW" | "en";
  /** Optional Google Place ID for direct review link */
  googleReviewUrl?: string;
  yelpReviewUrl?: string;
}

export interface AbandonmentRecoveryData {
  customerEmail: string;
  customerName: string;
  bookingId: number;
  tourTitle: string;
  departureDate: string;
  totalPrice: number;
  currency: string;
  language?: "zh-TW" | "en";
  /** Recovery discount code (5% off) */
  recoveryCode?: string;
}

export interface VoucherIssuedEmailData {
  customerEmail: string;
  customerName: string;
  voucherCode: string;
  voucherTitle: string; // e.g. "$500 機票折抵券" / "$500 Flight Credit"
  amountUsd: number;
  pointsCost: number;
  expiresAt: Date;
  language?: "zh-TW" | "en";
}

export interface WinbackEmailData {
  customerEmail: string;
  customerName: string;
  bookingId: number;
  pastTourTitle: string;
  language?: "zh-TW" | "en";
  /** Optional discount code, defaults to WELCOMEBACK7 */
  promoCode?: string;
}

export interface CheckinEmailData {
  customerEmail: string;
  customerName: string;
  bookingId: number;
  pastTourTitle: string;
  language?: "zh-TW" | "en";
  /** Optional discount code for users who DO want to re-engage */
  promoCode?: string;
}

export interface TrialEndingReminderData {
  to: string;
  customerName: string;
  /** "Plus" or "Concierge" — already capitalized */
  tierLabel: string;
  trialEndsAt: Date;
  /** Pre-formatted "USD $29.00" string */
  chargeAmount: string;
  chargeInterval: "month" | "year";
  /** Direct link to /membership where they can cancel (one-click) */
  cancelUrl: string;
  language?: "zh-TW" | "en";
}
