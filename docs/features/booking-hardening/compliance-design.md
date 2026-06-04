# Booking compliance batch — design (Jeff decisions 2026-06-04)

> Phase 3 of booking-hardening. Jeff's 4 decisions captured from the interview.
> Passthrough + manual simplifies this a lot: there is NO auto fee-engine, so no
> money-math risk. Most surfaces are blocked on Jeff providing content.

## Decisions

1. **Cancellation policy source = PASSTHROUGH.** UV / Lion each carry their own
   refund rules. PACK&GO does NOT impose a fixed house schedule.
2. **Cancellation fee = per-supplier, entered MANUALLY per booking.** No tiered
   auto-calc engine (would have to guess the basis — violates 不准猜). When a
   booking cancels, Jeff enters the actual refund (admin refund already exists).
3. **Insurance = link only, no resale.** Show a "we recommend buying travel
   insurance" notice + an external link. PACK&GO does not sell or touch it.
4. **§17550.14 terms = I build the mechanism, Jeff supplies the legal text.** I
   do NOT author legal wording (compliance risk). I build: a terms block in the
   confirmation email/booking page + consent capture; Jeff/his lawyer pastes the
   actual CST-mandated text.

## Build plan

- **3.2 Consent capture (BUILD NOW — safe, content-agnostic).** The v76 consent
  checkbox in BookTour is client-only (gates the button, never persisted), so it
  produces zero dispute evidence today. Persist it: `bookings.disclaimerAcceptedAt`
  + `disclaimerVersion`, recorded at `booking.create`. Additive + nullable; NO
  server-side hard-reject yet (the client already gates it; a hard reject would
  break bookings from cached clients during rollout — add enforcement later once
  clients are updated). This is the "取消政策同意紀錄" the chargeback handler
  (v664) tells Jeff to upload as evidence.
- **Cancellation policy display (BLOCKED on content).** Need: where does each
  supplier's cancellation policy text live? (UV/Lion notices, or Jeff fills a
  `tours.cancellationPolicy` field). Then display it on the tour + booking pages
  + confirmation email. Passthrough = show the supplier's text verbatim.
- **Insurance notice (BLOCKED on content).** Need: the external insurance URL
  Jeff wants to link to. Then add a notice + link in the booking flow + email.
- **§17550.14 terms block (BLOCKED on content).** Need: the actual legal text.
  Then render it in the confirmation email + a booking-page terms section, keyed
  to `disclaimerVersion` so the consent record points at the right text version.

## Content still needed from Jeff

1. Each supplier's cancellation policy text (or confirm Jeff fills per-tour).
2. The travel-insurance link URL.
3. The §17550.14 CST disclosure legal text (his lawyer's wording).

## Money / enforcement deferred (careful sessions)

- Server-side consent ENFORCE (reject create without acceptance) — after clients
  updated, to avoid rollout breakage.
- Self-cancel refund + supplier-cancel cascade — money movement, separate session.
