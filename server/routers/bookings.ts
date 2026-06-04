/**
 * Bookings router — customer booking lifecycle + cancel + admin status flow.
 *
 * Extracted from server/routers.ts (Phase 4C · sub-PR 3 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Phase 4D
 * (2026-05-19) further extracted the 2 Stripe-money procedures
 * (createCheckoutSession + adminRefund) into ./bookingsPayment.ts; they
 * are composed back under the `bookings:` key via spread in routers.ts so
 * client paths are unchanged.
 *
 * Procedures (8 — post 4D):
 *   create, list, listParticipants, saveParticipants, getById,
 *   cancel, adminList, adminUpdateStatus
 *
 * Security notes (preserved from origin):
 *   - v72: bounded IDs + 60/hr per-user read rate limit on getById
 *     (prevents booking-ID enumeration via timing differences)
 *   - v73: state-machine on adminUpdateStatus (rejects illegal
 *     status transitions, e.g. completed → pending)
 *   - v74: price recompute server-side from departure row (not
 *     tour headline), atomic seat-reserve, contactEmail defaults
 *     to ctx.user.email (kills DKIM-aligned spam-to-3rd-party
 *     vector)
 *   - v77: saveParticipants — passport / DOB / dietary capture
 *     post-booking (was schema-defined but unreachable from UI)
 *   - v78n: 30-min abandonment-recovery email scheduled at create
 *   - v78x/y: customer language stickiness on booking row
 *   - Round 80.22: Packpoint redemption (100 pt = $1 USD, capped
 *     at 50% of subtotal, FX-converted at moment of booking)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { sendBookingConfirmationEmail } from "../email";
import { convertCurrency, type SupportedCurrency } from "../agents/exchangeRateAgent";
import { checkBookingCreateRateLimit } from "../rateLimit";

// v74 bounded string helpers — kept in sync with the originals in routers.ts.
// Without max bounds, attackers can send 10MB payloads per field and DoS the
// DB / LLM pipeline. Also strip ASCII control chars (NULL/BEL/ESC/DEL) which
// were persisting verbatim into MySQL columns — known WAF-evasion vector.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const noControlChars = (s: string) => !CONTROL_CHARS.test(s);
const shortStr = z.string().max(255).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });
const mediumStr = z.string().max(5_000).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });

export const bookingsRouter = router({
    // Create new booking
    // v74 SECURITY OVERHAUL: this mutation handles real customer money flow.
    // Audit found 4 money-critical bugs that this rewrite fixes:
    //   1. PRICE BYPASS — server was using `tour.price × participants` ignoring
    //      departure-specific pricing (child / infant / single-supplement).
    //      Customers could be over- or undercharged. Now: server fetches the
    //      departure row and recomputes total from per-passenger prices.
    //   2. OVERBOOKING — `bookedSlots` was never incremented; concurrent
    //      bookings on a 1-slot departure both succeeded. Now: atomic
    //      check-and-increment via a guarded UPDATE returning rowcount.
    //   3. ORPHAN BOOKING — `departureId` was optional, defaulting to 0 (no
    //      such row). Now: required + verified to belong to the tour.
    //   4. PAST DATES — booking departures in the past was allowed. Now:
    //      reject if departureDate < now.
    // Also v74: contactEmail defaults to the authenticated user's email
    // unless explicitly set; prevents using booking flow as a spam vector
    // toward third parties.
    create: protectedProcedure
      .input(
        z.object({
          tourId: z.number().int().positive().max(2_147_483_647),
          // departureId is now REQUIRED — orphan bookings without a departure
          // are unbookable in practice (customer doesn't know which date) and
          // create accounting/ops problems.
          departureId: z.number().int().positive().max(2_147_483_647),
          numberOfAdults: z.number().int().min(0).max(100).default(0),
          numberOfChildrenWithBed: z.number().int().min(0).max(100).default(0),
          numberOfChildrenNoBed: z.number().int().min(0).max(100).default(0),
          numberOfInfants: z.number().int().min(0).max(100).default(0),
          numberOfSingleRooms: z.number().int().min(0).max(100).default(0),
          // Legacy: total participants count (for backwards compat with old client)
          participants: z.number().int().min(0).max(500).optional(),
          contactName: shortStr.min(1),
          contactEmail: z.string().email().max(320).optional(), // optional: defaults to ctx.user.email
          contactPhone: shortStr.min(1),
          specialRequests: mediumStr.optional(),
          // v78x: Customer's current UI language — drives email language preference
          language: z.enum(["zh-TW", "en"]).optional(),
          // Round 80.22: optional Packpoint redemption applied at booking
          // creation. 100 pts = $1 USD discount. Validated server-side
          // against user's balance; capped at 50% of totalPrice (policy §5).
          // Only honored when departure currency is USD — TWD bookings
          // require FX conversion which we defer for now.
          pointsToRedeem: z.number().int().min(0).max(10_000_000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { audit } = await import("../_core/auditLog");

        // Rate limiting: 10 bookings per hour per user
        const bookingRateLimit = await checkBookingCreateRateLimit(ctx.user.id);
        if (!bookingRateLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "訂單建立過於頻繁，請稍後再試",
          });
        }

        // ── Validate tour ────────────────────────────────────────────
        const tour = await db.getTourById(input.tourId);
        if (!tour) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tour not found" });
        }

        // ── Validate departure ───────────────────────────────────────
        const departure = await db.getDepartureById(input.departureId);
        if (!departure) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Departure not found" });
        }
        if (departure.tourId !== input.tourId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Departure does not belong to this tour",
          });
        }
        // Reject past dates
        const departureTime = new Date(departure.departureDate).getTime();
        if (departureTime < Date.now()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "出發日期已過，無法預訂此團",
          });
        }
        // Reject already-cancelled or full departures
        if (departure.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此出發日期已取消" });
        }

        // ── Compute total participants ───────────────────────────────
        // Legacy clients send `participants`; new clients send the breakdown.
        // If only `participants` is provided, treat them all as adults.
        const adults = input.numberOfAdults || input.participants || 0;
        const childWithBed = input.numberOfChildrenWithBed || 0;
        const childNoBed = input.numberOfChildrenNoBed || 0;
        const infants = input.numberOfInfants || 0;
        const singleRooms = input.numberOfSingleRooms || 0;
        const totalSeatsRequested = adults + childWithBed + childNoBed; // infants don't take seats
        if (totalSeatsRequested < 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "至少需 1 位旅客" });
        }

        // ── Atomic slot check + increment ────────────────────────────
        // This MUST be atomic to prevent overbooking: a guarded UPDATE that
        // increments only when there's enough capacity, returning affectedRows=0
        // when full. Two concurrent bookings on the last seat → exactly one wins.
        const slotResult = await db.tryReserveDepartureSlots(
          input.departureId,
          totalSeatsRequested
        );
        if (!slotResult.reserved) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `此出發日僅剩 ${slotResult.available} 位，無法預訂 ${totalSeatsRequested} 位`,
          });
        }

        // ── Server-side price computation ────────────────────────────
        // Use departure-specific prices, NOT the tour's headline price. This
        // is the canonical source of truth — client-supplied prices are ignored.
        const adultPrice = departure.adultPrice;
        const childWithBedPrice = departure.childPriceWithBed ?? adultPrice;
        const childNoBedPrice = departure.childPriceNoBed ?? Math.floor(adultPrice * 0.7);
        const infantPrice = departure.infantPrice ?? 0;
        const singleSupplement = departure.singleRoomSupplement ?? 0;

        const grossTotalPrice =
          adults * adultPrice +
          childWithBed * childWithBedPrice +
          childNoBed * childNoBedPrice +
          infants * infantPrice +
          singleRooms * singleSupplement;

        if (grossTotalPrice <= 0) {
          // Capacity already incremented — release before throwing
          await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
          throw new TRPCError({ code: "BAD_REQUEST", message: "計算金額異常" });
        }

        // ── Round 80.22: Packpoint redemption (optional) ─────────────────
        // Apply discount BEFORE creating the booking so totalPrice reflects
        // the discounted amount. Round 80.22 Phase D: TWD bookings now
        // supported via FX conversion at the moment of booking.
        const departureCurrency = ((departure as any).currency || "TWD").toUpperCase();
        let pointsRedeemed = 0;
        let totalPrice = grossTotalPrice;
        if (input.pointsToRedeem && input.pointsToRedeem > 0) {
          const userBalance = (ctx.user as any).packpointBalance ?? 0;
          if (input.pointsToRedeem > userBalance) {
            await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `您的餘額僅 ${userBalance} 點,無法折抵 ${input.pointsToRedeem} 點`,
            });
          }
          if (input.pointsToRedeem < 100) {
            await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "最低折抵 100 點($1)",
            });
          }
          // 100 pt = $1 USD. Convert to booking currency at current FX rate.
          const requestedDiscountUsd = input.pointsToRedeem / 100;
          let discountInBookingCurrency: number;
          if (departureCurrency === "USD") {
            discountInBookingCurrency = requestedDiscountUsd;
          } else {
            try {
              discountInBookingCurrency = await convertCurrency(
                requestedDiscountUsd,
                "USD" as SupportedCurrency,
                departureCurrency as SupportedCurrency
              );
            } catch (err) {
              await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "匯率服務暫時不可用,請稍後再試或不使用 Packpoint 折抵",
              });
            }
          }
          // Cap at 50% of subtotal (policy §5)
          const maxDiscount = grossTotalPrice * 0.5;
          const finalDiscount = Math.min(discountInBookingCurrency, maxDiscount);
          totalPrice = Math.max(0, Math.floor(grossTotalPrice - finalDiscount));
          // Compute actual points consumed: convert finalDiscount back to USD
          // to find how many points we should deduct (handles the 50% cap case)
          const finalDiscountUsd =
            departureCurrency === "USD"
              ? finalDiscount
              : await convertCurrency(
                  finalDiscount,
                  departureCurrency as SupportedCurrency,
                  "USD" as SupportedCurrency
                ).catch(() => requestedDiscountUsd);
          pointsRedeemed = Math.floor(finalDiscountUsd * 100);
          console.log(
            `[bookings.create] Packpoint redemption: user ${ctx.user.id} → -${pointsRedeemed} pts, discount ${departureCurrency} ${finalDiscount}`
          );
        }

        // v74: default contactEmail to authenticated user's email so the
        // booking flow can't be used to send DKIM-aligned confirmation mail
        // to arbitrary third parties.
        const contactEmail = input.contactEmail || ctx.user.email;

        let booking;
        try {
          booking = await db.createBooking({
            tourId: input.tourId,
            departureId: input.departureId,
            userId: ctx.user.id,
            customerName: input.contactName,
            customerEmail: contactEmail,
            customerPhone: input.contactPhone,
            numberOfAdults: adults,
            numberOfChildrenWithBed: childWithBed,
            numberOfChildrenNoBed: childNoBed,
            numberOfInfants: infants,
            numberOfSingleRooms: singleRooms,
            totalPrice,
            depositAmount: Math.floor(totalPrice * 0.2),
            remainingAmount: totalPrice - Math.floor(totalPrice * 0.2),
            message: input.specialRequests,
            bookingStatus: "pending",
            // v78y: stick the customer's language to the booking row so all
            // downstream emails (payment / reminders) speak it.
            customerLanguage: input.language || "zh-TW",
          } as any);
        } catch (err) {
          // If booking row insert fails, release the slots we reserved
          await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
          throw err;
        }

        // Round 80.22: deduct the points NOW that booking exists with
        // a valid id we can reference in the audit trail. If this fails the
        // booking still exists but at the discounted price (effectively a
        // free discount) — log loudly so ops can manually reconcile.
        if (pointsRedeemed > 0) {
          try {
            const { deductPackpoint } = await import("../_core/packpoint");
            await deductPackpoint({
              userId: ctx.user.id,
              amount: pointsRedeemed,
              reason: "redemption",
              referenceType: "booking",
              referenceId: booking.id,
              description: `Booking #${booking.id} — $${pointsRedeemed / 100} discount`,
            });
          } catch (err) {
            console.error(
              `[bookings.create] CRITICAL: Packpoint deduction failed for booking ${booking.id}:`,
              (err as Error).message
            );
          }
        }

        // Audit (fire-and-forget)
        audit({
          ctx,
          action: "booking.create",
          targetType: "booking",
          targetId: booking.id,
          changes: {
            tourId: input.tourId,
            departureId: input.departureId,
            seats: totalSeatsRequested,
            totalPrice,
          },
        });

        // Email confirmation. Failure must not break the booking — log loudly
        // so ops can manually re-send if SMTP is broken.
        const departureDateStr = new Date(departure.departureDate).toISOString().split("T")[0];
        const returnDateStr = departure.returnDate
          ? new Date(departure.returnDate).toISOString().split("T")[0]
          : "";
        const depositAmount = Math.floor(totalPrice * 0.2);
        const remainingAmount = totalPrice - depositAmount;

        // Deposit PDF + confirmation email run in the bookingFollowupQueue,
        // not on the HTTP path. Previously this was a fire-and-forget
        // IIFE (commit a7481d8) which was non-blocking but dropped work
        // on server restart. The queue is Redis-backed → survives
        // restarts, retries twice with exponential backoff on failure,
        // and notifyOwner alerts Jeff on terminal failure (worker is
        // wired in commit 35897de pattern).
        const isUsd = (departure as any).currency === "USD" || tour.priceCurrency === "USD";
        try {
          const { bookingFollowupQueue } = await import("../queue");
          await bookingFollowupQueue.add(
            "booking-followup",
            {
              bookingId: booking.id,
              contactName: input.contactName,
              contactEmail,
              tourId: booking.tourId,
              tourTitle: tour.title,
              departureDateStr,
              returnDateStr,
              adults,
              childWithBed,
              childNoBed,
              infants,
              totalPrice,
              depositAmount,
              remainingAmount,
              isUsd,
              language: input.language,
            },
            {
              jobId: `booking-followup-${booking.id}`, // dedupe on booking ID
            }
          );
        } catch (enqueueErr) {
          console.error(
            `[bookings.create] Failed to enqueue followup for booking ${booking.id}:`,
            (enqueueErr as Error)?.message
          );
          // Fallback: at least try to send the plain confirmation email
          // synchronously so the customer hears SOMETHING — accept the
          // ~1-2s tax in this rare path.
          sendBookingConfirmationEmail({
            to: contactEmail,
            customerName: input.contactName,
            customerEmail: contactEmail,
            bookingId: booking.id,
            tourTitle: tour.title,
            departureDate: departureDateStr,
            returnDate: returnDateStr,
            numberOfAdults: adults,
            numberOfChildren: childWithBed + childNoBed,
            numberOfInfants: infants,
            totalPrice,
            depositAmount,
            remainingAmount,
            currency: isUsd ? "USD" : "TWD",
            language: input.language,
          }).catch((e) =>
            console.error(
              `[bookings.create] Even fallback email failed for booking ${booking.id}:`,
              e?.message
            )
          );
        }

        // v78n Sprint 6A: schedule 30-min abandonment recovery email +
        // 24h seat-hold expiry (release seats if never paid).
        try {
          const { scheduleAbandonmentRecovery, scheduleSeatExpiry } = await import(
            "../queues/abandonmentRecoveryQueue"
          );
          await scheduleAbandonmentRecovery(booking.id);
          await scheduleSeatExpiry(booking.id);
        } catch (err) {
          console.warn(
            "[bookings.create] Failed to schedule abandonment recovery:",
            (err as Error).message
          );
        }

        return booking;
      }),

    // Get user's bookings
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserBookings(ctx.user.id);
    }),

    // v77: Get all passenger details for a booking (owner or admin only).
    listParticipants: protectedProcedure
      .input(z.object({ bookingId: z.number().int().positive().max(2_147_483_647) }))
      .query(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not authorised" });
        }
        return await db.getBookingParticipants(input.bookingId);
      }),

    // v77: Replace ALL passenger details for a booking. Customer fills the
    // form post-booking (passport numbers, DOB, dietary needs, etc.) so ops
    // can submit visa applications, assign hotel rooms, and order meals.
    //
    // Without this endpoint, schema-defined fields (passportNumber, etc.)
    // were unreachable from the UI and ops staff had to chase customers via
    // email — the #1 friction point identified in the member audit.
    saveParticipants: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive().max(2_147_483_647),
          participants: z.array(
            z.object({
              participantType: z.enum(["adult", "child", "infant"]),
              firstName: shortStr.min(1),
              lastName: shortStr.min(1),
              gender: z.enum(["male", "female", "other"]).optional(),
              dateOfBirth: z.string().date().optional(),       // YYYY-MM-DD
              passportNumber: shortStr.optional(),
              passportExpiry: z.string().date().optional(),    // YYYY-MM-DD
              nationality: shortStr.optional(),
              dietaryRequirements: mediumStr.optional(),
              specialNeeds: mediumStr.optional(),
            })
          ).max(50), // soft cap — no booking has 50 travelers; protects against payload abuse
        })
      )
      .mutation(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not authorised" });
        }

        // Verify participant counts add up to the booking's seat counts.
        const counts = { adult: 0, child: 0, infant: 0 };
        for (const p of input.participants) counts[p.participantType]++;
        const expectedAdults = booking.numberOfAdults || 0;
        const expectedChildren =
          (booking.numberOfChildrenWithBed || 0) + (booking.numberOfChildrenNoBed || 0);
        const expectedInfants = booking.numberOfInfants || 0;

        if (
          counts.adult !== expectedAdults ||
          counts.child !== expectedChildren ||
          counts.infant !== expectedInfants
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `旅客人數不符：訂單為 ${expectedAdults} 大 / ${expectedChildren} 童 / ${expectedInfants} 嬰，您填了 ${counts.adult} 大 / ${counts.child} 童 / ${counts.infant} 嬰`,
          });
        }

        // Convert date strings → Date objects for DB
        const participantsWithDates = input.participants.map((p) => ({
          ...p,
          dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
          passportExpiry: p.passportExpiry ? new Date(p.passportExpiry) : null,
        }));

        const saved = await db.replaceBookingParticipants(input.bookingId, participantsWithDates as any);

        // Audit (admin actions on bookings) — only if admin not owner. Customer
        // updates to their own booking aren't audit events.
        if (ctx.user.role === "admin" && booking.userId !== ctx.user.id) {
          const { audit } = await import("../_core/auditLog");
          audit({
            ctx,
            action: "booking.saveParticipants",
            targetType: "booking",
            targetId: input.bookingId,
            changes: { count: saved.length },
          });
        }

        return saved;
      }),

    // Get single booking
    // v72: bounded ID + per-user rate limit (60 reads / hour) so an attacker
    // can't brute-force-enumerate booking IDs to map who-owns-what via timing
    // differences between 404 (not exist) and 403 (exist but not yours).
    getById: protectedProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .query(async ({ ctx, input }) => {
        // Rate-limit: 60 booking lookups per user per hour. Admins exempt
        // (they need to view bookings during support).
        if (ctx.user.role !== "admin") {
          try {
            const { redis } = await import("../redis");
            const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
            const key = `ratelimit:bookings:getById:${ctx.user.id}:${hour}`;
            const count = await redis.incr(key);
            if (count === 1) await redis.expire(key, 3600);
            if (count > 60) {
              throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: "Too many booking lookups — please try again later.",
              });
            }
          } catch (e) {
            // If Redis is down, don't block legitimate users — just log
            if ((e as TRPCError)?.code === "TOO_MANY_REQUESTS") throw e;
            console.warn("[bookings.getById] rate-limit check failed:", (e as Error)?.message);
          }
        }

        const booking = await db.getBookingById(input.id);
        if (!booking) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
        }

        // Check if user owns this booking
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to view this booking",
          });
        }

        return booking;
      }),

    // NOTE (Phase 4D, 2026-05-19): `createCheckoutSession` was moved to
    // ./bookingsPayment.ts. Composition spread in routers.ts keeps the
    // client path `trpc.bookings.createCheckoutSession` resolving identically.

    // Cancel booking
    // v74: also releases the reserved departure slots (was previously never
    // decremented — cancelled bookings still counted as taken capacity).
    cancel: protectedProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.id);
        if (!booking) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
        }

        // Check if user owns this booking
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to cancel this booking",
          });
        }

        // Idempotency: already cancelled → no-op
        if (booking.bookingStatus === "cancelled") return { success: true };

        // Update booking status
        await db.updateBooking(input.id, { bookingStatus: "cancelled" });

        // Release reserved seats
        const seatCount =
          (booking.numberOfAdults || 0) +
          (booking.numberOfChildrenWithBed || 0) +
          (booking.numberOfChildrenNoBed || 0);
        if (seatCount > 0 && booking.departureId) {
          await db.releaseDepartureSlots(booking.departureId, seatCount).catch((e) =>
            console.warn(`[bookings.cancel] Failed to release slots for ${input.id}:`, e?.message)
          );
        }

        // Audit
        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "booking.cancel",
          targetType: "booking",
          targetId: input.id,
          changes: { before: booking.bookingStatus, after: "cancelled" },
        });

        // Note: this does NOT issue a Stripe refund — that requires a separate
        // explicit refund flow with admin approval. If the user already paid,
        // ops will handle the refund manually until the refund flow lands.
        return { success: true };
      }),

    // Admin: Get all bookings
    adminList: adminProcedure.query(async () => {
      return await db.getAllBookings();
    }),

    // Admin: Update booking status
    // v73: bounded ID + audit log on every status change. Booking-status
    // mutations affect customer money + ops, so they always need a paper trail.
    adminUpdateStatus: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().max(2_147_483_647),
          status: z.enum(["pending", "confirmed", "cancelled", "completed"]),
          reason: z.string().max(500).optional(), // optional admin note (esp. for cancellations)
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, status, reason } = input;

        // Snapshot previous status for the diff
        const before = await db.getBookingById(id).catch(() => null);
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        const previousStatus = before.bookingStatus || "pending";

        // v74: state machine — reject illegal transitions. Without this, admin
        // can mis-click and flip a "completed" booking back to "pending",
        // creating accounting inconsistencies.
        const ALLOWED_TRANSITIONS: Record<string, string[]> = {
          pending:   ["confirmed", "cancelled", "completed"],
          confirmed: ["completed", "cancelled"],
          completed: [],            // terminal
          cancelled: [],            // terminal
        };
        const allowedNext = ALLOWED_TRANSITIONS[previousStatus] || [];
        if (status !== previousStatus && !allowedNext.includes(status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `不允許的狀態轉換：${previousStatus} → ${status}（合法選項：${allowedNext.join(", ") || "無，此狀態不可變更"}）`,
          });
        }

        await db.updateBooking(id, { bookingStatus: status });

        // v74: when booking is cancelled, release the reserved seats so the
        // departure's bookedSlots is decremented and the seats become bookable
        // again. Previously this was never done — cancelled bookings still
        // counted toward overbooking caps.
        if (status === "cancelled" && previousStatus !== "cancelled") {
          const seatCount =
            (before.numberOfAdults || 0) +
            (before.numberOfChildrenWithBed || 0) +
            (before.numberOfChildrenNoBed || 0);
          if (seatCount > 0 && before.departureId) {
            await db.releaseDepartureSlots(before.departureId, seatCount).catch((e) =>
              console.warn(`[adminUpdateStatus] Failed to release slots for booking ${id}:`, e?.message)
            );
          }
        }

        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "booking.updateStatus",
          targetType: "booking",
          targetId: id,
          changes: { before: previousStatus, after: status },
          reason,
        });

        return { success: true };
      }),

    // Admin: set the supplier fulfillment status (Phase 1.1).
    // This is the spine of the back half. The customer "seat secured / confirmed"
    // language drives off `vendor_confirmed`, so an admin recording the REAL
    // supplier outcome here is what flips the customer from "processing" to
    // "secured" — never payment alone. Any transition is allowed (operational
    // correction is common) but every change is audit-logged. No money
    // side-effects here on purpose: a vendor_rejected → refund is Phase 1.3 and
    // stays a deliberate, separate step so we never auto-move money from a
    // dropdown.
    setSupplierStatus: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().max(2_147_483_647),
          supplierStatus: z.enum([
            "not_placed",
            "placed",
            "vendor_confirmed",
            "vendor_rejected",
            "waitlisted",
          ]),
          supplierBookingRef: z.string().max(128).optional(),
          reason: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, supplierStatus, supplierBookingRef, reason } = input;

        const before = await db.getBookingById(id).catch(() => null);
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        const previous = before.supplierStatus || "not_placed";

        await db.updateBooking(id, {
          supplierStatus,
          ...(supplierBookingRef !== undefined
            ? { supplierBookingRef: supplierBookingRef.trim() || null }
            : {}),
          // Stamp the confirmation time the first time the supplier confirms.
          ...(supplierStatus === "vendor_confirmed" && previous !== "vendor_confirmed"
            ? { supplierConfirmedAt: new Date() }
            : {}),
        });

        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "booking.setSupplierStatus",
          targetType: "booking",
          targetId: id,
          changes: { before: previous, after: supplierStatus, ref: supplierBookingRef ?? null },
          reason,
        });

        return { success: true };
      }),

    // NOTE (Phase 4D, 2026-05-19): `adminRefund` was moved to
    // ./bookingsPayment.ts. Composition spread in routers.ts keeps the
    // client path `trpc.bookings.adminRefund` resolving identically.
  });
