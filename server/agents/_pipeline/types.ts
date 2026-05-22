/**
 * Pipeline Types & Shared Helpers
 *
 * Extracted from masterAgent.ts during v2 Wave 2 Module 2.9 split. Shared
 * across the 6 pipeline phase files so the supervisor (masterAgent.ts) can
 * stay slim.
 *
 * Phase boundaries (see masterAgent.ts execute() for canonical order):
 *   Phase 0   cache check                       (inline in supervisor)
 *   Phase 1   scrape / PDF / Lion API           → scrape.ts
 *   Phase 2   ContentAnalyzer                   → contentAnalyzer.ts
 *   Phase 3   ColorTheme                        → colorTheme.ts
 *   Phase 3b  image-intelligence + vision       → fanout.ts (pre-stage)
 *   Phase 4   itinerary + details + transport   → fanout.ts
 *   Phase 5   finalData assembly + fallbacks    → assembly.ts
 *   Phase 6   calibration + self-repair         → assembly.ts (tail end)
 *   On error  R2 + DB cleanup                   → rollback.ts
 */

import type { ContentAnalyzerAgent } from "../contentAnalyzerAgent";
import type { ColorThemeAgent } from "../colorThemeAgent";
import type { ItineraryUnifiedAgent } from "../itineraryUnifiedAgent";
import type { DetailsSkill } from "../_subskills/details/detailsSkill";
import type { FlightAgent } from "../flightAgent";
import type { TransportationAgent } from "../transportationAgent";
import type { RetryManager, AgentMonitor, FallbackManager, RetryConfig } from "../agentOrchestration";

/**
 * Final data returned to caller — keep in sync with MasterAgentResult.data.
 */
export interface MasterAgentResult {
  success: boolean;
  data?: {
    poeticTitle: string;
    poeticSubtitle?: string;
    title: string;
    description: string;
    productCode: string;
    tags: string[];
    destinationCountry: string;
    destinationCity: string;
    departureCity: string;
    days: number;
    nights: number;
    price: number;
    heroImage: string;
    heroImageAlt: string;
    heroSubtitle: string;
    colorTheme: any;
    highlights: string;
    keyFeatures: string;
    poeticContent: string;
    itineraryDetailed: string;
    costExplanation: string;
    noticeDetailed: string;
    hotels: string;
    meals: string;
    flights: string;
    featureImages: string;
    hotelImages: string;
    galleryImages: string;
    attractions: string;
    originalityScore: number;
    sourceUrl: string;
  };
  error?: string;
  progress?: {
    currentStep: string;
    percentage: number;
  };
  executionReport?: string;
  calibrationReport?: {
    contentFidelityScore: number;
    translationScore: number;
    imageScore: number;
    completenessScore: number;
    marketingScore: number;
    totalScore: number;
    verdict: "approved" | "review" | "rejected";
    issues: Array<{ check: string; severity: string; message: string; field?: string; autoFixable: boolean }>;
    autoFixesApplied: Array<{ field: string; before: string; after: string }>;
  };
  phaseTimings?: { phases: Record<string, string>; totalMs: number; totalSec: string };
}

/**
 * Phase-timing helpers passed between phases.
 * The supervisor owns the actual phase timer map; phases call into it for start/end.
 */
export interface PhaseTimer {
  start: (name: string) => void;
  end: (name: string) => void;
}

/**
 * Progress callback shape used throughout the pipeline.
 */
export type ProgressCallback = (step: string, percentage: number) => void | Promise<void>;

/**
 * Agent dependencies — handles to the pre-instantiated agent objects the
 * supervisor owns. Passed into each phase function so phases stay pure.
 */
export interface AgentDeps {
  contentAnalyzerAgent: ContentAnalyzerAgent;
  colorThemeAgent: ColorThemeAgent;
  itineraryUnifiedAgent: ItineraryUnifiedAgent;
  detailsSkill: DetailsSkill;
  flightAgent: FlightAgent;
  transportationAgent: TransportationAgent;
  retryManager: RetryManager;
  retryConfig: RetryConfig;
  monitor: AgentMonitor;
  fallbackManager: FallbackManager;
}

/**
 * Shared pipeline context — flows through every phase. Each phase function
 * receives this, may mutate it (e.g. update rawData / analyzedContent), and
 * the supervisor reads the final state when assembling MasterAgentResult.
 */
export interface PipelineContext {
  url: string;
  userId?: number;
  taskId?: string;
  forceRegenerate: boolean;
  isPdf: boolean;
  supplementUrl?: string;
  startTime: number;
  onProgress?: ProgressCallback;
  phaseTimer: PhaseTimer;
  deps: AgentDeps;
  rawData?: any;
  analyzedContent?: any;
  colorTheme?: any;
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared parsing helpers (used by both scrape.ts and assembly.ts)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Round 80.17: parseLionDate handles Lion's "2026/08/28" / "2026-08-28" /
 * already-Date / null. Returns Date or null. Used for finalData.startDate /
 * endDate fields which were previously always empty.
 * v80.24: added year-range validation. Without it, a typo like "20226-08-28"
 * parses successfully (year 20226), MySQL accepts it, and tour search filters
 * break because the tour falls outside any reasonable date window.
 */
export function parseLionDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    return y >= 2020 && y <= 2050 ? value : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\//g, "-").trim();
  if (!cleaned) return null;
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 2020 || y > 2050) {
    console.warn(`[parseLionDate] Rejecting out-of-range year ${y} from input "${value}"`);
    return null;
  }
  return d;
}

/**
 * Round 80.17: extract a 3-letter IATA code from any input.
 */
export function extractAirportCodeLocal(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.toUpperCase().match(/\b[A-Z]{3}\b/);
  return m ? m[0] : null;
}
