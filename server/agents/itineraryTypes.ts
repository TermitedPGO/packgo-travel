/**
 * Itinerary Shared Types
 *
 * Shared type definitions for the itinerary pipeline. These types were
 * originally defined inside `itineraryExtractAgent.ts` and
 * `itineraryPolishAgent.ts`, but those agents are now `@deprecated`
 * (Round 80.15: production path uses `ItineraryUnifiedAgent` exclusively).
 *
 * The types live here so non-deprecated callers (`utils/tagGenerator.ts`,
 * `services/itineraryImageService.ts`) can import them without depending
 * on the deprecated agent files.
 *
 * The deprecated agents themselves still re-export these types from this
 * module for backward compatibility with `diagnostics.ts`.
 *
 * @see `./itineraryUnifiedAgent.ts` for the production agent that produces
 *   data conforming to these shapes.
 */

/**
 * Tour type classification used by the extraction pipeline.
 *
 * Identifying the tour type up front lets downstream agents (tag generator,
 * image search, copy polish, fidelity check) tailor their behaviour — e.g.
 * a `MINGRI_TRAIN` itinerary should never describe an airport transfer, and
 * a `CRUISE` itinerary should not search for hotel images.
 *
 * - `MINGRI_TRAIN` — Taiwan 鳴日號 luxury observation train tours.
 * - `TRAIN` — Generic rail-based tours (HSR, JR, etc.).
 * - `CRUISE` — Sea/river cruise itineraries.
 * - `SELF_DRIVE` — Self-drive / rental-car based itineraries.
 * - `FLIGHT` — Standard fly-and-tour itineraries.
 * - `GENERAL` — Default / unclassified.
 *
 * Consumed by:
 *   - `server/utils/tagGenerator.ts` — chooses transportation tags.
 *   - `server/agents/itineraryUnifiedAgent.ts` — re-declares the same union
 *     locally and emits values into this shape.
 */
export type TourType =
  | "MINGRI_TRAIN"
  | "TRAIN"
  | "CRUISE"
  | "SELF_DRIVE"
  | "FLIGHT"
  | "GENERAL";

/**
 * A single activity inside an extracted itinerary day.
 *
 * Pre-LLM shape: produced directly from raw scraped/structured input
 * without any rewriting. All string fields may be empty — downstream
 * polishing fills gaps.
 */
export interface ExtractedActivity {
  /** Time slot, e.g. `"09:00"` or `"09:00-12:00"`. May be empty. */
  time: string;
  /** Short activity name. */
  title: string;
  /** Longer free-form description. */
  description: string;
  /** Mode of transport for this activity (e.g. `"火車"`, `"巴士"`). */
  transportation: string;
  /** Place / venue / city for this activity. */
  location: string;
}

/**
 * A single day of an itinerary as extracted from raw source data,
 * before any LLM polishing or copy rewriting.
 *
 * Used as the input shape to `ItineraryPolishAgent.execute()` and the
 * intermediate shape inside `ItineraryUnifiedAgent`.
 *
 * Consumed by:
 *   - `server/agents/diagnostics.ts` — agent-level diagnostic output.
 */
export interface ExtractedItinerary {
  /** 1-indexed day number. */
  day: number;
  /** Day title, e.g. `"Day 1：抵達東京"`. */
  title: string;
  activities: ExtractedActivity[];
  meals: {
    breakfast: string;
    lunch: string;
    dinner: string;
  };
  /** Hotel / accommodation name; preserve original wording from source. */
  accommodation: string;
}

/**
 * A polished activity — same shape as `ExtractedActivity` but with copy
 * rewritten by the LLM (or unified agent). Field semantics are identical.
 */
export interface PolishedActivity {
  time: string;
  title: string;
  description: string;
  transportation: string;
  location: string;
}

/**
 * A single day of a polished itinerary, ready to be displayed on the tour
 * detail page. Adds optional `image` / `imageAlt` fields populated by
 * `services/itineraryImageService.assignItineraryImages`.
 *
 * Consumed by:
 *   - `server/services/itineraryImageService.ts` — adds per-day images.
 *   - `server/agents/itineraryUnifiedAgent.ts` — re-declares an identical
 *     interface locally for the unified pipeline output.
 *
 * NOTE: keep this shape in lock-step with `ItineraryUnifiedAgent`'s local
 * `PolishedItinerary` interface — both flow into the same DB columns and
 * frontend renderer, and divergence would silently break image assignment.
 */
export interface PolishedItinerary {
  /** 1-indexed day number. */
  day: number;
  /** Day title (polished). */
  title: string;
  activities: PolishedActivity[];
  meals: {
    breakfast: string;
    lunch: string;
    dinner: string;
  };
  /** Hotel / accommodation name (preserved from source). */
  accommodation: string;
  /**
   * Optional per-day hero image URL.
   * Populated by `assignItineraryImages` after polishing completes.
   */
  image?: string;
  /** Alt text for the per-day image. */
  imageAlt?: string;
}
