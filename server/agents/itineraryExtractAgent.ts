/**
 * Itinerary Extract Agent (DEPRECATED SHELL)
 *
 * @deprecated Round 80.15: production path (`masterAgent.ts`) now uses
 * `ItineraryUnifiedAgent`, which merges Extract + Polish into a single
 * LLM call. The original 593-line implementation has been removed.
 *
 * This file is kept ONLY because:
 *   - `diagnostics.ts` exposes per-agent diagnostic tests and still
 *     instantiates this class. Calling `execute()` on this shell now
 *     throws — diagnostics catches the error and surfaces "deprecated".
 *   - `AiTeamRoster.tsx` displays this agent in the admin team roster
 *     (UI-only, never imports from server).
 *
 * Shared types (`TourType`, `ExtractedItinerary`, `ExtractedActivity`)
 * have moved to `./itineraryTypes` and are re-exported here for
 * backward compatibility with diagnostics.
 *
 * Do NOT add new callers — use `ItineraryUnifiedAgent` instead.
 *
 * Round 80.15-D cleanup: full LLM/extraction logic deleted; only the
 * class shell with a throwing `execute()` remains.
 */

import type {
  TourType,
  ExtractedItinerary,
  ExtractedActivity,
} from "./itineraryTypes";

// Re-export shared types so existing imports
// `from "../agents/itineraryExtractAgent"` still type-check.
export type { TourType, ExtractedItinerary, ExtractedActivity };

export interface ItineraryExtractResult {
  success: boolean;
  data?: {
    extractedItineraries: ExtractedItinerary[];
    extractionMethod: "structured" | "markdown" | "fallback";
    tourType: TourType;
    originalTransportation: string;
    originalHotels: string[];
    originalAttractions: string[];
  };
  error?: string;
}

/**
 * @deprecated Use `ItineraryUnifiedAgent` instead. The original
 * implementation has been removed; calling `execute()` will throw.
 * Diagnostics relies on this throw to mark the agent as "deprecated".
 */
export class ItineraryExtractAgent {
  constructor() {
    console.warn(
      "[ItineraryExtractAgent] DEPRECATED — use ItineraryUnifiedAgent. " +
        "This shell exists only for diagnostics + AiTeamRoster display."
    );
  }

  /**
   * @deprecated Throws unconditionally. Production path uses
   * `ItineraryUnifiedAgent.execute()` instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_rawData: unknown): Promise<ItineraryExtractResult> {
    throw new Error(
      "ItineraryExtractAgent is deprecated (Round 80.15). " +
        "Use ItineraryUnifiedAgent instead."
    );
  }
}
