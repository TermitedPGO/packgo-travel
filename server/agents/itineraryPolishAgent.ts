/**
 * Itinerary Polish Agent (DEPRECATED SHELL)
 *
 * @deprecated Round 80.15: production path (`masterAgent.ts`) now uses
 * `ItineraryUnifiedAgent`, which merges Extract + Polish into a single
 * LLM call. The original 533-line implementation (Claude Haiku batched
 * polishing, fidelity check, auto-repair) has been removed.
 *
 * This file is kept ONLY because:
 *   - `diagnostics.ts` exposes per-agent diagnostic tests and still
 *     instantiates this class. Calling `execute()` on this shell now
 *     throws — diagnostics catches the error and surfaces "deprecated".
 *   - `AiTeamRoster.tsx` displays this agent in the admin team roster
 *     (UI-only, never imports from server).
 *
 * Shared types (`PolishedItinerary`, `PolishedActivity`,
 * `ExtractedItinerary`, `TourType`) have moved to `./itineraryTypes` and
 * are re-exported here for backward compatibility with consumers like
 * `services/itineraryImageService.ts` (which now imports directly from
 * `./itineraryTypes` instead).
 *
 * Do NOT add new callers — use `ItineraryUnifiedAgent` instead.
 *
 * Round 80.15-D cleanup: full LLM/polish logic deleted; only the class
 * shell with a throwing `execute()` remains.
 */

import type {
  PolishedItinerary,
  PolishedActivity,
  ExtractedItinerary,
  TourType,
} from "./itineraryTypes";

// Re-export shared types so existing imports
// `from "../agents/itineraryPolishAgent"` still type-check.
export type { PolishedItinerary, PolishedActivity };

// Phase 1 result-shape types — kept exported because `diagnostics.ts`
// (and any future shadow-test harness) reads `fidelityCheck` off the
// result. The unified agent emits the same shape.
export interface FidelityCheck {
  transportationMatch: boolean;
  hotelMatch: boolean;
  activitiesFromSource: number;
  activitiesAdded: number;
  /** 0-100. */
  overallScore: number;
  issues: string[];
}

export interface ItineraryPolishResult {
  success: boolean;
  data?: {
    polishedItineraries: PolishedItinerary[];
    fidelityCheck: FidelityCheck;
  };
  error?: string;
}

export interface OriginalDataSnapshot {
  tourType: TourType;
  originalTransportation: string;
  originalHotels: string[];
  originalAttractions: string[];
}

/**
 * @deprecated Use `ItineraryUnifiedAgent` instead. The original
 * implementation has been removed; calling `execute()` will throw.
 * Diagnostics relies on this throw to mark the agent as "deprecated".
 */
export class ItineraryPolishAgent {
  constructor() {
    console.warn(
      "[ItineraryPolishAgent] DEPRECATED — use ItineraryUnifiedAgent. " +
        "This shell exists only for diagnostics + AiTeamRoster display."
    );
  }

  /**
   * @deprecated Throws unconditionally. Production path uses
   * `ItineraryUnifiedAgent.execute()` instead.
   */
  async execute(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _extractedItineraries: ExtractedItinerary[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _destinationInfo: { country?: string; city?: string },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _originalDataSnapshot?: OriginalDataSnapshot
  ): Promise<ItineraryPolishResult> {
    throw new Error(
      "ItineraryPolishAgent is deprecated (Round 80.15). " +
        "Use ItineraryUnifiedAgent instead."
    );
  }
}
