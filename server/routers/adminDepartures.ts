/**
 * adminDepartures router — cross-tour departure calendar for admin panel.
 *
 * Provides:
 *   - departureCalendar: all future departures (≥ now-30d) joined with tour
 *     title, ordered by departureDate ASC. Used by DepartureCalendarV2.
 *
 * Composed into `admin:` via spread in routers.ts.
 * 2026-05-27
 */
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { sql, gte, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const adminDeparturesRouter = router({
  /**
   * All upcoming departures across every tour, joined with tour title.
   * Cutoff: departureDate >= now - 30 days (keeps recent-past visible
   * while limiting payload size).
   */
  departureCalendar: adminProcedure.query(async () => {
    const drizzleDb = (await db.getDb())!;
    const {
      tourDepartures,
      tours: toursTable,
    } = await import("../../drizzle/schema");

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const rows = await drizzleDb
      .select({
        id: tourDepartures.id,
        tourId: tourDepartures.tourId,
        tourTitle: toursTable.title,
        departureDate: tourDepartures.departureDate,
        returnDate: tourDepartures.returnDate,
        adultPrice: tourDepartures.adultPrice,
        childPriceWithBed: tourDepartures.childPriceWithBed,
        childPriceNoBed: tourDepartures.childPriceNoBed,
        infantPrice: tourDepartures.infantPrice,
        singleRoomSupplement: tourDepartures.singleRoomSupplement,
        currency: tourDepartures.currency,
        totalSlots: tourDepartures.totalSlots,
        bookedSlots: tourDepartures.bookedSlots,
        status: tourDepartures.status,
        opsStatus: tourDepartures.opsStatus,
        groupName: tourDepartures.groupName,
        tourLeader: tourDepartures.tourLeader,
        notes: tourDepartures.notes,
      })
      .from(tourDepartures)
      .innerJoin(toursTable, sql`${tourDepartures.tourId} = ${toursTable.id}`)
      .where(gte(tourDepartures.departureDate, cutoff))
      .orderBy(tourDepartures.departureDate);

    return rows;
  }),

  departureDetail: adminProcedure
    .input(z.object({ departureId: z.number().int().positive().max(2_147_483_647) }))
    .query(async ({ input }) => {
      const departure = await db.getDepartureById(input.departureId);
      if (!departure) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Departure not found" });
      }

      const tour = departure.tourId
        ? await db.getTourById(departure.tourId)
        : undefined;

      const activeBookings = await db.getActiveBookingsByDepartureId(input.departureId);

      const allParticipants = await Promise.all(
        activeBookings.map((b) => db.getBookingParticipants(b.id)),
      );
      const maskedParticipants = allParticipants.flat().map((p) => ({
        id: p.id,
        bookingId: p.bookingId,
        participantType: p.participantType,
        firstName: p.firstName,
        lastName: p.lastName,
        gender: p.gender,
        dateOfBirth: p.dateOfBirth,
        passportNumber: p.passportNumber ? `••••${p.passportNumber.slice(-4)}` : null,
        passportExpiry: p.passportExpiry,
        nationality: p.nationality,
        dietaryRequirements: p.dietaryRequirements,
        specialNeeds: p.specialNeeds,
      }));

      const drizzleDb = (await db.getDb())!;
      const { tourGroupNotes } = await import("../../drizzle/schema");
      const notes = await drizzleDb
        .select()
        .from(tourGroupNotes)
        .where(eq(tourGroupNotes.tourDepartureId, input.departureId))
        .orderBy(desc(tourGroupNotes.createdAt))
        .limit(20);

      return {
        departure,
        tourTitle: tour?.title ?? null,
        bookings: activeBookings.map((b) => ({
          id: b.id,
          customerName: b.customerName,
          bookingStatus: b.bookingStatus,
          paymentStatus: b.paymentStatus,
          supplierStatus: b.supplierStatus,
          numberOfAdults: b.numberOfAdults,
          numberOfChildrenWithBed: b.numberOfChildrenWithBed,
          numberOfChildrenNoBed: b.numberOfChildrenNoBed,
          numberOfInfants: b.numberOfInfants,
        })),
        participants: maskedParticipants,
        notes,
      };
    }),
});
