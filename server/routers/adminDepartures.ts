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
import { sql, gte } from "drizzle-orm";

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
});
