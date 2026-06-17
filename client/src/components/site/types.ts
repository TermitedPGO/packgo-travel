/**
 * Shared types for the public-site design-system components.
 *
 * AvailabilityBucket + LeanDeparture are defined HERE (not imported from
 * TourDetailPeony/actionArea.helpers) on purpose: it keeps this design system
 * self-contained so it can ship independently of in-flight changes to that
 * file. Kept React-free so pure helpers + their tests can import the shapes.
 */

/** Red line #2: the customer only ever sees one of these — never a seat count. */
export type AvailabilityBucket = "available" | "limited" | "soldout" | "unknown";

/** The departure fields the card derivation reads (from departures.getNextBatch). */
export interface LeanDeparture {
  departureDate: string | number | Date;
  status?: string | null;
  adultPrice?: number | null;
  currency?: string | null;
  totalSlots?: number | null;
  bookedSlots?: number | null;
}

/**
 * The lean shape a TourCard renders. Built from a server card projection +
 * a pre-derived availability bucket / starting USD / flight flag. It contains
 * ONLY retail-safe display data — never agentPrice (supplier cost) and never a
 * raw seat count.
 */
export interface TourCardData {
  id: number;
  title: string;
  destinationCountry?: string | null;
  destinationCity?: string | null;
  departureCity?: string | null;
  duration?: number | null;
  nights?: number | null;
  heroImage?: string | null;
  featured?: boolean;
  status?: string | null;
  availabilityBucket: AvailabilityBucket;
  soonestDepartureDate?: string | null;
  startingUsd?: number | null;
  startingApprox?: boolean;
  flightInclusion?: "included" | "excluded" | "unknown";
}

export type TourCardLayout = "card" | "row" | "editorial";
