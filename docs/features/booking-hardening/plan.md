# Booking → fulfillment hardening — plan

> Source: 6-lens workflow gap review (2026-06-03, run wf_c9a65ffa-6fb). 498 UV
> tours are LIVE in USD on Stripe LIVE. Verdict: customer front-half (browse →
> book → pay) is solid; the BACK half (did we secure the seat, deliver the
> voucher, handle unhappy paths, keep USD books right) is thin. Build in phases,
> 止血 first.

## Phase 0 — 止血 (live now, real money already flowing)

- **0.1 Customer-facing currency display** (P0). `BookingDetail.tsx` (~L328-348),
  `server/email/templates/bookingConfirmation.ts` (~L39-41), and `PaymentSuccess.tsx`
  hardcode `NT$`; UV is USD → a customer who paid $1,800 sees "NT$ 1,800". Drive
  off `booking.currency` via `formatPrice`/`currencySymbol` (same fix as today's
  admin list + home hero; just 3 more surfaces). Lowest risk, highest immediate
  trust impact. ← START HERE.
- **0.2 Wire `saveParticipants`** (P0). `BookTour.tsx` collects passport but never
  calls `bookings.saveParticipants` → passenger data discarded → Option A is not
  actually wired. Fix: fold participants into `bookings.create` (required) or call
  saveParticipants right after create; server-side require passport/DOB/nationality.
- **0.3 Seat TTL release** (P0). `tryReserveDepartureSlots` increments bookedSlots
  at create (pre-pay); abandoned checkouts never release → false "full". Add a TTL
  job (extend `abandonmentRecoveryQueue`) that cancels + `releaseDepartureSlots`
  after N h unpaid; cancel the job on payment-success webhook.
- **0.4 USD money precision** (P0, own careful step). `bookings.{totalPrice,
  depositAmount,remainingAmount}` + `payments.amount` are `int` → USD cents
  truncate (supplier mirror already uses `decimal(14,2)`). Migrate to decimal or
  integer-cents. Migration on money columns = isolate + test hard.

## Phase 1 — 供應商履約閉環 (the missing back half)

- 1.1 `supplierStatus` state machine on bookings (not_placed / placed /
  vendor_confirmed / vendor_rejected / waitlisted) + supplierBookingRef +
  supplierConfirmedAt. Drive customer "confirmed / seat secured" language off
  `vendor_confirmed`, NOT off payment. Soften the paid email meanwhile.
- 1.2 Availability RE-check at confirm + in webhook (join bookings/tours to the
  `supplierDepartures` mirror by external code — store that FK first).
- 1.3 `vendor_rejected` → auto Stripe refund (from Trust) + bilingual apology +
  nearest-alt-departure offer; recording the vendor outcome is a required admin step.
- 1.4 Voucher / e-ticket deliverable: per-booking PDF (supplier ref, meeting point,
  pax) + delivery email + BookingDetail download. Remove the unfulfillable
  "e-tickets in 7 days" promise from confirmation copy until built.
- 1.5 Supplier order packet: decrypted per-passenger manifest (server-only, access-
  logged) + supplier-shaped Excel export → turns step-7 manual fulfillment into
  paste/upload.

## Phase 2 — 金流生命週期

- 2.1 Balance collection: write `balanceDueDate`, reminder ladder, card-on-file
  off-session auto-collect, seat release on non-pay past deadline.
- 2.2 Refund → `reverseDeferral` (Trust §17550) in the same flow; verify the
  deferral flag is on and Stripe-funded deposits get a deferral row.
- 2.3 `charge.dispute.*` webhook → notify owner + flag booking + accounting.
- 2.4 `payment_intent.payment_failed` → customer "retry" email (their language).
- 2.5 Snapshot `supplierCost` (agentPrice + FX) on booking at confirm; margin
  column + low/negative-margin guard.

## Phase 3 — 取消 / 變更 / 合規

- 3.1 Cancellation-fee policy engine: structured tiers on tour/departure, snapshot
  on booking, server-computed refund (= paid − fee), admin override logged.
- 3.2 Consent capture: persist `disclosuresAcceptedAt` + version + IP at booking,
  enforce server-side (today the checkbox only gates the button client-side).
- 3.3 Supplier-cancel cascade: departure→cancelled fans out to its bookings
  (notify + stage 100% refunds).
- 3.4 Booking-change path: name/passport correction + date change (move departure).
- 3.5 Self-cancel: compute policy refund + confirmation email + admin task + date guard.
- 3.6 §17550.14 confirmation-email mandatory terms; insurance offer/decline; resolve
  supplier-vs-house cancellation-policy conflict (one source of truth).

## Sequencing

Phase 0 now (止血, this/next session). Phases 1-3 each = a focused session with its
own design. Each item is independently shippable + reversible.
