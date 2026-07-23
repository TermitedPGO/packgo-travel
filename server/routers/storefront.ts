/**
 * Batch P1a — public read-only storefront contract router.
 *
 * Public read-only queries, no mutations, no money movement, no PII:
 *   getItineraryContract — published packgo.itinerary.v1 contract (days +
 *                          stops with per-claim confirmation statuses).
 *                          Returns null when nothing is published — never
 *                          fabricates content.
 *   getFeeDisclosure     — published, date-valid fee contract grouped by
 *                          category with CurrencyAmount totals. No/invalid
 *                          contract ⇒ honest { status:
 *                          'awaiting_supplier_quote', fees: [], totals: null }.
 *   listDepartures       — future departures whose availability comes ONLY
 *                          from trusted supplier data, mapped through the
 *                          3-bucket module (充足/少量/候補). Departures
 *                          without trusted supplier evidence, cancelled or
 *                          not-on-sale, are excluded entirely.
 *   getTourSummary       — Round 2 addition (Codex 2026-07-22 rework item
 *                          2): active + published-ancestor-gated,
 *                          allow-listed customer-safe tour summary. The
 *                          single safe replacement for BC's former raw
 *                          tours.getById usage.
 *
 * ANCESTRY RULE (Codex 2026-07-20 P1-1): every procedure accepts ONLY
 * tourId and walks the published chain from the top:
 *   tour → published productVersion → published child rows.
 * No direct internal-ID entrypoints exist, so a child row can never be
 * served while its parent is unpublished.
 *
 * CRITICAL INVARIANT: nothing returned here ever includes numeric seat
 * counts or agent/cost prices. Every return path (including early returns)
 * passes both the deep type guard (PublicSafe) and the runtime deep guard
 * (assertNoForbiddenPublicFields) — see server/storefront/availabilityBucket.ts.
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  assertNoForbiddenPublicFields,
  buildPublicDepartureDto,
  type PublicDepartureDto,
  type PublicSafe,
} from "../storefront/availabilityBucket";
import {
  awaitingSupplierQuoteDisclosure,
  buildFeeDisclosure,
  isContractValidOn,
  type PublicFeeDisclosure,
} from "../storefront/feeDisclosure";
import * as storefrontDb from "../storefront/queries";

const tourIdInput = z.number().int().positive().max(2_147_483_647);

/**
 * Single choke point for EVERY public return (Codex 2026-07-21 P2-1): all
 * return paths — populated DTOs AND null/[] early returns — funnel through
 * the runtime guard here, so tests can prove the guard EXECUTED on each
 * path (spy on assertNoForbiddenPublicFields), not just scan shapes.
 */
function guardedPublicReturn<T>(value: T): T {
  assertNoForbiddenPublicFields(value);
  return value;
}

// ── packgo.itinerary.v1 public DTO shapes (deep-typed for PublicSafe) ────

export interface PublicItineraryStopDto {
  stopId: string;
  name: string;
  nameEn: string | null;
  kind: string;
  summary: string | null;
  lat: number | null;
  lon: number | null;
  sourceStatus: string;
  visitStatus: string;
  imageAssetId: string | null;
  mediaStatus: string;
  sortOrder: number;
}

export interface PublicItineraryDayDto {
  dayId: string;
  dayNumber: number;
  city: string | null;
  cityEn: string | null;
  summary: string | null;
  sourceStatus: string;
  movement: { durationMinutes: number | null; status: string };
  meals: { breakfast: string; lunch: string; dinner: string };
  stay: {
    propertyStatus: string;
    bookingStatus: string;
    rating: {
      value: number;
      system: string | null;
      sourceStatus: string | null;
      verifiedAt: Date | null;
    } | null;
  };
  media: { sourceStatus: string; rightsStatus: string };
  stops: PublicItineraryStopDto[];
}

/**
 * Round 2 (Codex 2026-07-22 rework item 2): the ONE safe, customer-facing
 * tour summary. Explicit allow-list — title, hero image, duration/nights,
 * product code, destination. NOTHING else from the tours row (no seats, no
 * supplier contacts, no calibration, no commission, no internal notes).
 */
export interface PublicTourSummaryDto {
  id: number;
  title: string;
  heroImage: string | null;
  duration: number | null;
  nights: number | null;
  productCode: string | null;
  destinationCountry: string | null;
  destinationCity: string | null;
}

export interface PublicItineraryContractDto {
  schemaVersion: string;
  itineraryId: string;
  versionNumber: number;
  sourceStatus: string;
  originMarket: string | null;
  destinationJurisdictions: unknown;
  days: PublicItineraryDayDto[];
}

export const storefrontRouter = router({
  /**
   * Published itinerary contract in packgo.itinerary.v1 shape.
   * Input: tourId only — the published ancestor chain
   * (productVersion → itineraryVersion) is verified top-down.
   * Null when any link of the chain is unpublished/missing.
   */
  getItineraryContract: publicProcedure
    .input(z.object({ tourId: tourIdInput }))
    .query(
      async ({ input }): Promise<PublicSafe<PublicItineraryContractDto> | null> => {
        // Ancestry gate 1: the tour must have a published productVersion.
        const productVersion = await storefrontDb.getPublishedProductVersionByTourId(
          input.tourId,
        );
        // Nothing published — never fabricate. Early returns still pass
        // through the runtime guard (Codex 2026-07-21 P2-1).
        if (!productVersion) return guardedPublicReturn(null);

        // Ancestry gate 2: a published itineraryVersion under that parent.
        const version = await storefrontDb.getPublishedItineraryVersionByProductVersionId(
          productVersion.id,
        );
        if (!version) return guardedPublicReturn(null);

        const days = await storefrontDb.getItineraryDaysByVersionId(version.id);
        const stops = await storefrontDb.getItineraryStopsByDayIds(days.map((d) => d.id));
        const stopsByDayRowId = new Map<number, typeof stops>();
        for (const stop of stops) {
          const list = stopsByDayRowId.get(stop.itineraryDayId) ?? [];
          list.push(stop);
          stopsByDayRowId.set(stop.itineraryDayId, list);
        }

        // packgo.itinerary.v1 — explicit allow-list construction.
        const contract: PublicItineraryContractDto = {
          schemaVersion: version.schemaVersion,
          itineraryId: version.itineraryId,
          versionNumber: version.versionNumber,
          sourceStatus: version.sourceStatus,
          originMarket: version.originMarket ?? null,
          destinationJurisdictions: version.destinationJurisdictions ?? null,
          days: days.map((day) => ({
            dayId: day.dayId,
            dayNumber: day.dayNumber,
            city: day.city ?? null,
            cityEn: day.cityEn ?? null,
            summary: day.summary ?? null,
            sourceStatus: day.sourceStatus,
            movement: {
              durationMinutes: day.movementDurationMinutes ?? null,
              status: day.movementStatus,
            },
            meals: {
              breakfast: day.mealBreakfast,
              lunch: day.mealLunch,
              dinner: day.mealDinner,
            },
            stay: {
              propertyStatus: day.stayPropertyStatus,
              bookingStatus: day.stayBookingStatus,
              rating:
                day.stayRatingValue !== null
                  ? {
                      value: day.stayRatingValue,
                      system: day.stayRatingSystem ?? null,
                      sourceStatus: day.stayRatingSourceStatus ?? null,
                      verifiedAt: day.stayRatingVerifiedAt ?? null,
                    }
                  : null,
            },
            media: {
              sourceStatus: day.mediaSourceStatus,
              rightsStatus: day.mediaRightsStatus,
            },
            stops: (stopsByDayRowId.get(day.id) ?? []).map((stop) => ({
              stopId: stop.stopId,
              name: stop.name,
              nameEn: stop.nameEn ?? null,
              kind: stop.kind,
              summary: stop.summary ?? null,
              lat: stop.lat !== null ? Number(stop.lat) : null,
              lon: stop.lon !== null ? Number(stop.lon) : null,
              sourceStatus: stop.sourceStatus,
              visitStatus: stop.visitStatus,
              imageAssetId: stop.imageAssetId ?? null,
              mediaStatus: stop.mediaStatus,
              sortOrder: stop.sortOrder,
            })),
          })),
        };
        // Runtime deep guard — JSON columns can smuggle keys past types.
        return guardedPublicReturn(contract as PublicSafe<PublicItineraryContractDto>);
      },
    ),

  /**
   * Published, date-valid fee disclosure for a tour's published product
   * version. Optional departureDate selects the contract whose
   * [validFrom, validTo] window covers it; default = today.
   * No published chain / no valid contract / incomplete or mixed-currency
   * data ⇒ honest awaiting_supplier_quote shape (totals: null).
   */
  getFeeDisclosure: publicProcedure
    .input(
      z.object({
        tourId: tourIdInput,
        departureDate: z.date().optional(),
      }),
    )
    .query(async ({ input }): Promise<PublicSafe<PublicFeeDisclosure>> => {
      // Ancestry gate: the tour must have a published productVersion.
      const productVersion = await storefrontDb.getPublishedProductVersionByTourId(
        input.tourId,
      );
      if (!productVersion) {
        return guardedPublicReturn(
          awaitingSupplierQuoteDisclosure() as PublicSafe<PublicFeeDisclosure>,
        );
      }

      const referenceDate = input.departureDate ?? new Date();
      const contracts = await storefrontDb.getPublishedFeeContractsByProductVersionId(
        productVersion.id,
      );
      const contract = contracts.find((c) => isContractValidOn(c, referenceDate)) ?? null;
      if (!contract) {
        return guardedPublicReturn(
          awaitingSupplierQuoteDisclosure() as PublicSafe<PublicFeeDisclosure>,
        );
      }

      const items = await storefrontDb.getFeeItemsByContractId(contract.id);
      // buildFeeDisclosure is fail-closed: awaiting/empty/mixed-currency/
      // unevidenced-zero contracts come back as the awaiting shape.
      const disclosure = buildFeeDisclosure(contract, items);
      return guardedPublicReturn(disclosure as PublicSafe<PublicFeeDisclosure>);
    }),

  /**
   * Public departure list for a tour: future dates only, availability
   * SOLELY from trusted supplier data (supplierDepartures.availability via
   * the tour → supplierProducts linkage), retail price in integer minor
   * units. Excluded entirely (no fourth public state):
   *   - tours without a published productVersion (ancestry gate),
   *   - departures with no trusted supplier evidence for their date,
   *   - supplier 停售 (unavailable) departures,
   *   - locally cancelled departures.
   * Local totalSlots/bookedSlots are NEVER consulted (Codex P0-1).
   */
  listDepartures: publicProcedure
    .input(z.object({ tourId: tourIdInput }))
    .query(async ({ input }): Promise<PublicSafe<PublicDepartureDto>[]> => {
      // Ancestry gate: departures hang off a published product too.
      const productVersion = await storefrontDb.getPublishedProductVersionByTourId(
        input.tourId,
      );
      if (!productVersion) {
        return guardedPublicReturn([] as PublicSafe<PublicDepartureDto>[]);
      }

      // Trust gate: no supplier evidence chain ⇒ nothing is publicly listed.
      const supplierAvailabilityByDate =
        await storefrontDb.getTrustedSupplierAvailabilityByTourId(input.tourId);
      if (supplierAvailabilityByDate === null) {
        return guardedPublicReturn([] as PublicSafe<PublicDepartureDto>[]);
      }

      const allDepartures = await db.getTourDepartures(input.tourId);
      const now = new Date();
      const dtos = (allDepartures as any[])
        .filter((d) => new Date(d.departureDate) > now)
        .filter((d) => d.status !== "cancelled") // 取消 never publicly listed
        .sort(
          (a, b) =>
            new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime(),
        )
        .map((d) => {
          const availability = supplierAvailabilityByDate.get(
            storefrontDb.departureDateKey(d.departureDate),
          );
          // No trusted supplier evidence for this date ⇒ not listed.
          if (availability === undefined) return null;
          return buildPublicDepartureDto(
            {
              id: d.id,
              departureDate: d.departureDate,
              returnDate: d.returnDate,
              adultPrice: d.adultPrice,
              currency: d.currency,
            },
            availability,
          );
        })
        .filter((dto): dto is PublicSafe<PublicDepartureDto> => dto !== null);
      return guardedPublicReturn(dtos);
    }),

  /**
   * Round 2 (Codex 2026-07-22 rework item 2): safe tour summary.
   *
   * {tourId}-only entrypoint replacing every BC use of the legacy raw
   * `tours.getById` (which returned the whole tours row with no gate).
   * Gate chain, top-down like the other three procedures:
   *   1. published ancestor gate — the tour must have a PUBLISHED
   *      productVersion (same storefrontDb gate as the other procedures);
   *   2. active gate — the tours row itself must be status='active'
   *      (draft/pending_review/inactive/soldout tours are never served).
   * Either gate failing ⇒ null — indistinguishable from "no such tour",
   * so draft/pending IDs cannot be probed.
   *
   * The full tours row is read server-side only; the wire payload is the
   * explicit allow-list in PublicTourSummaryDto, PublicSafe-typed and
   * runtime-guarded like every other public return.
   */
  getTourSummary: publicProcedure
    .input(z.object({ tourId: tourIdInput }))
    .query(
      async ({ input }): Promise<PublicSafe<PublicTourSummaryDto> | null> => {
        // Ancestry gate 1: published productVersion required.
        const productVersion = await storefrontDb.getPublishedProductVersionByTourId(
          input.tourId,
        );
        if (!productVersion) return guardedPublicReturn(null);

        // Gate 2: the tour itself must exist and be active.
        const tour = await db.getTourById(input.tourId);
        if (!tour || tour.status !== "active") return guardedPublicReturn(null);

        // Explicit allow-list construction — never spread the raw row.
        const dto: PublicTourSummaryDto = {
          id: tour.id,
          title: tour.title,
          heroImage: tour.heroImage || tour.imageUrl || null,
          duration: tour.duration ?? null,
          nights: tour.nights ?? null,
          productCode: tour.productCode ?? null,
          destinationCountry: tour.destinationCountry ?? null,
          destinationCity: tour.destinationCity ?? null,
        };
        return guardedPublicReturn(dto as PublicSafe<PublicTourSummaryDto>);
      },
    ),
});
