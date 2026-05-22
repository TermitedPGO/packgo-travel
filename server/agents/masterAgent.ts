/**
 * Master Agent — Supervisor Shell
 *
 * Orchestrates the 6-phase tour generation pipeline. This file is intentionally
 * thin — phase bodies live in `_pipeline/`:
 *
 *   Phase 0   cache check                       (inline, may short-circuit)
 *   Phase 1   scrape / PDF / Lion API           → _pipeline/scrape.ts
 *   Phase 2   ContentAnalyzer                   → _pipeline/contentAnalyzer.ts
 *   Phase 3   ColorTheme                        → _pipeline/colorTheme.ts
 *   Phase 3b  image-intelligence + vision       → _pipeline/fanout.ts (pre)
 *   Phase 4   itinerary + details + transport   → _pipeline/fanout.ts
 *   Phase 5   finalData assembly + fallbacks    → _pipeline/assembly.ts
 *   Phase 6   calibration + self-repair         → _pipeline/assembly.ts (tail)
 *   On error  R2 + DB cleanup                   → _pipeline/rollback.ts
 *
 * Public API unchanged: `new MasterAgent().execute(url, userId, onProgress,
 * taskId, forceRegenerate, isPdf, supplementUrl)` continues to return
 * `MasterAgentResult` exactly as before.
 *
 * History:
 * - v77: ImagePromptAgent + ImageGenerationAgent removed from constructor —
 *   they were instantiated but never invoked (Unsplash + ColorTheme path
 *   covers production; ~12K tokens/tour dead cost eliminated).
 * - v2 Wave 2 Module 2.9 (2026-05-21): split 3,300-LOC monolith into
 *   supervisor + 6 pipeline files for AI-navigability and testability.
 */

import { ContentAnalyzerAgent } from "./contentAnalyzerAgent";
import { ColorThemeAgent } from "./colorThemeAgent";
import { ItineraryUnifiedAgent } from "./itineraryUnifiedAgent";
import { getDetailsSkill, DetailsSkill } from "./_subskills/details/detailsSkill";
import { FlightAgent } from "./flightAgent";
import { TransportationAgent } from "./transportationAgent";
import { getKeyInstructions } from "./skillLoader";
import {
  RetryManager,
  AgentMonitor,
  FallbackManager,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_FALLBACK_CONFIGS,
  type RetryConfig,
} from "./agentOrchestration";
import { progressTracker } from "./progressTracker";
import generationCache from "../cache/generation-cache";
import { logAgentStart, logAgentComplete, cleanupZombieTasks } from "../agentActivityService";
import { createChildLogger } from "../_core/logger";

import { runScrapePhase } from "./_pipeline/scrape";
import { runContentAnalyzerPhase } from "./_pipeline/contentAnalyzer";
import { runColorThemePhase } from "./_pipeline/colorTheme";
import { runFanoutPhase } from "./_pipeline/fanout";
import { runAssemblyPhase } from "./_pipeline/assembly";
import { rollback as runRollback } from "./_pipeline/rollback";
import type { AgentDeps, PhaseTimer, MasterAgentResult } from "./_pipeline/types";

// Re-export the public type so existing imports `import { MasterAgentResult } from "./masterAgent"` keep working.
export type { MasterAgentResult } from "./_pipeline/types";

const log = createChildLogger({ module: "masterAgent" });

/**
 * Master Agent
 * Orchestrates all agents to generate a complete tour.
 *
 * Execution Flow (Optimized):
 * - Phase 1: Web Scraping (Critical, Sequential)
 * - Phase 2: Content Analysis (Critical, Sequential)
 * - Phase 3: ColorTheme (Parallel-ready, but only sub-agent)
 * - Phase 3b/3c: Image Intelligence + Vision Analysis
 * - Phase 4: Itinerary || Details (Parallel), then Transportation
 * - Phase 5: Assemble Final Data
 * - Phase 6: Calibration + Self-Repair (up to 2 rounds if score < 70)
 */
export class MasterAgent {
  private skillInstructions: string;
  private retryManager: RetryManager;
  private monitor: AgentMonitor;
  private fallbackManager: FallbackManager;
  private retryConfig: RetryConfig;

  // Agent instances
  private contentAnalyzerAgent: ContentAnalyzerAgent;
  private colorThemeAgent: ColorThemeAgent;
  private itineraryUnifiedAgent: ItineraryUnifiedAgent;
  private detailsSkill: DetailsSkill;
  private flightAgent: FlightAgent;
  private transportationAgent: TransportationAgent;

  constructor() {
    // Load SKILL.md instructions
    this.skillInstructions = getKeyInstructions('MasterAgent');
    console.log('[MasterAgent] SKILL loaded:', this.skillInstructions.length, 'chars');

    // Initialize orchestration utilities
    this.retryManager = new RetryManager();
    this.monitor = new AgentMonitor();
    this.fallbackManager = new FallbackManager();
    this.retryConfig = DEFAULT_RETRY_CONFIG;

    // Register fallback configurations
    for (const config of DEFAULT_FALLBACK_CONFIGS) {
      this.fallbackManager.registerFallback(config);
    }

    // Initialize all agents
    this.contentAnalyzerAgent = new ContentAnalyzerAgent();
    this.colorThemeAgent = new ColorThemeAgent();
    this.itineraryUnifiedAgent = new ItineraryUnifiedAgent();
    this.detailsSkill = getDetailsSkill();
    this.flightAgent = new FlightAgent();
    this.transportationAgent = new TransportationAgent();

    console.log('[MasterAgent] Initialized with optimized parallel execution');
  }

  /**
   * Bundle the supervisor's owned agent objects + orchestration utilities
   * into the AgentDeps shape each pipeline phase expects. Kept private so
   * external callers can't bypass the constructor.
   */
  private buildDeps(): AgentDeps {
    return {
      contentAnalyzerAgent: this.contentAnalyzerAgent,
      colorThemeAgent: this.colorThemeAgent,
      itineraryUnifiedAgent: this.itineraryUnifiedAgent,
      detailsSkill: this.detailsSkill,
      flightAgent: this.flightAgent,
      transportationAgent: this.transportationAgent,
      retryManager: this.retryManager,
      retryConfig: this.retryConfig,
      monitor: this.monitor,
      fallbackManager: this.fallbackManager,
    };
  }

  /**
   * Execute complete tour generation with optimizations.
   *
   * The public signature MUST stay identical — `server/tourGenerator.ts`
   * calls this method and the worker pipeline depends on the exact arg
   * order. Do not reorder or add required params.
   */
  async execute(
    url: string,
    userId?: number,
    onProgress?: (step: string, percentage: number) => void,
    taskId?: string,
    forceRegenerate: boolean = false,
    isPdf: boolean = false,
    supplementUrl?: string  // 供應商官網 URL（配合 PDF 使用，用於抽取日期/人數/價格）
  ): Promise<MasterAgentResult> {
    const startTime = Date.now();
    console.log("[MasterAgent] Starting OPTIMIZED tour generation...");
    // Round 55 Diag-C: Phase timing helpers
    const _phaseTimers: Record<string, number> = {};
    const phaseTimer: PhaseTimer = {
      start: (name: string) => {
        _phaseTimers[name] = Date.now();
        console.log(`[MasterAgent] ⏱ PHASE START: ${name}`);
      },
      end: (name: string) => {
        const ms = Date.now() - (_phaseTimers[name] || Date.now());
        console.log(`[MasterAgent] ⏱ PHASE END: ${name} — ${ms}ms (${(ms / 1000).toFixed(1)}s)`);
      },
    };

    // ========================================================================
    // Round 52: Auto-convert old LionTravel URL format to new format
    // Old: https://www.liontravel.com/webpd/webpdsh00.aspx?sKind=1&sProd=24JO217BRC-T
    // New: https://travel.liontravel.com/detail?GroupID=24JO217BRC-T
    // ========================================================================
    if (!isPdf && url.includes('liontravel.com') && url.includes('webpd')) {
      try {
        const oldUrlObj = new URL(url);
        const sProd = oldUrlObj.searchParams.get('sProd');
        if (sProd) {
          const newUrl = `https://travel.liontravel.com/detail?GroupID=${sProd}&TourSource=Lion&Platform=APP`;
          console.log(`[MasterAgent] 🔄 Round 52: Auto-converted old LionTravel URL format:`);
          console.log(`[MasterAgent]   Old: ${url}`);
          console.log(`[MasterAgent]   New: ${newUrl}`);
          url = newUrl;
        }
      } catch (e) {
        console.warn('[MasterAgent] URL conversion failed (non-fatal):', e);
      }
    }

    console.log("[MasterAgent] URL:", url);
    console.log("[MasterAgent] User ID:", userId);
    console.log("[MasterAgent] Force Regenerate:", forceRegenerate);
    console.log("[MasterAgent] Is PDF:", isPdf);
    console.log("[MasterAgent] Supplement URL:", supplementUrl || 'none');

    // Reset monitor for new execution
    this.monitor.reset();

    // Initialize progress tracker if taskId is provided
    if (taskId) {
      progressTracker.createTask(taskId);
    }

    // 記錄 MasterAgent 開始執行
    const activityId = await logAgentStart({
      agentName: 'MasterAgent',
      agentKey: 'master',
      taskType: 'tour_generation',
      taskId: taskId,
      taskTitle: `生成行程：${isPdf ? 'PDF 檔案' : url.slice(0, 80)}`,
      userId,
    });

    const deps = this.buildDeps();

    try {
      // ========================================================================
      // Phase 0: Check Cache for Full Result
      // If we have a cached result for this URL, return it immediately
      // Skip cache if forceRegenerate is true
      // v80.24: throttle force-regen (1 URL × 1 hour) to prevent runaway
      // LLM cost. During testing on 5/5 the same URL was force-regenerated
      // 4 times in an hour ($0.80 burned). Now blocked unless > 1h passed.
      // ========================================================================
      onProgress?.("checking_cache", 5);

      // Throttle: track last force-regen timestamp per URL in Redis
      let throttledForce = forceRegenerate;
      if (forceRegenerate) {
        try {
          const { redis } = await import("../redis");
          const key = `force-regen-throttle:${url.slice(0, 200)}`;
          const lastRun = await redis.get(key);
          if (lastRun) {
            const ageMs = Date.now() - Number(lastRun);
            if (ageMs < 60 * 60 * 1000) {
              const minutesAgo = Math.floor(ageMs / 60_000);
              console.warn(
                `[MasterAgent] 🚫 Force-regen THROTTLED for URL (last ran ${minutesAgo}m ago, < 1h cooldown). Falling back to cache. To override, wait or clear key=${key}.`
              );
              throttledForce = false;
            }
          }
          if (throttledForce) {
            // Mark this run; key expires in 65 minutes
            await redis.set(key, String(Date.now()), "EX", 65 * 60);
          }
        } catch {
          // Redis unavailable — proceed without throttle
        }
      }

      if (throttledForce) {
        console.log("[MasterAgent] 🔄 Force regenerate enabled, skipping cache");
      } else {
        console.log("[MasterAgent] Checking cache for URL:", url);
      }

      const cachedFullResult = throttledForce ? null : await generationCache.getFullResult(url);
      if (cachedFullResult) {
        // v80.24: cache hit returns object with Date fields stringified by
        // JSON.stringify (Date → ISO string). Drizzle MySqlTimestamp column
        // then crashes with "value.toISOString is not a function". Restore
        // ISO strings back to Date for known timestamp fields before return.
        const dateKeys = [
          "departureDate", "returnDate", "createdAt", "updatedAt",
          "publishedAt", "deletedAt", "scheduledAt",
        ];
        const restoreDates = (obj: any): any => {
          if (!obj || typeof obj !== "object") return obj;
          for (const k of dateKeys) {
            if (typeof obj[k] === "string" && /^\d{4}-\d{2}-\d{2}/.test(obj[k])) {
              const d = new Date(obj[k]);
              if (!isNaN(d.getTime())) obj[k] = d;
            }
          }
          return obj;
        };
        const restored = restoreDates(cachedFullResult);
        console.log("[MasterAgent] 🎯 Cache HIT! Returning cached result (dates restored)");
        const elapsedTime = Date.now() - startTime;
        console.log(`[MasterAgent] Total time (from cache): ${elapsedTime}ms`);

        return {
          success: true,
          data: restored,
          executionReport: `Cache hit - returned in ${elapsedTime}ms`,
        };
      }
      console.log("[MasterAgent] Cache MISS, proceeding with generation...");

      // ========================================================================
      // Phase 1: Web Scraping or PDF Parsing
      // ========================================================================
      const { rawData } = await runScrapePhase({
        url,
        isPdf,
        forceRegenerate,
        supplementUrl,
        taskId,
        onProgress,
        deps,
        phaseTimer,
      });

      // ========================================================================
      // Phase 2: Content Analysis
      // ========================================================================
      const analyzedContent = await runContentAnalyzerPhase({
        rawData,
        taskId,
        userId,
        onProgress,
        deps,
        phaseTimer,
      });

      // ========================================================================
      // Phase 3: ColorTheme
      // ========================================================================
      const colorTheme = await runColorThemePhase({
        rawData,
        forceRegenerate,
        taskId,
        userId,
        onProgress,
        deps,
        phaseTimer,
      });

      // ========================================================================
      // Phase 3b/3c/4: Image intelligence + parallel agent fanout
      // ========================================================================
      const fanout = await runFanoutPhase({
        rawData,
        analyzedContent,
        forceRegenerate,
        taskId,
        userId,
        onProgress,
        deps,
        phaseTimer,
      });

      // ========================================================================
      // Phase 5 + 6: Assembly + Calibration + Self-Repair
      // ========================================================================
      const { finalData, calibrationReport } = await runAssemblyPhase({
        url,
        rawData,
        analyzedContent,
        colorTheme,
        fanout,
        userId,
        taskId,
        onProgress,
        deps,
        phaseTimer,
      });

      // ========================================================================
      // Generate Execution Report
      // ========================================================================
      const executionReport = this.monitor.generateReport();
      const totalDuration = Date.now() - startTime;

      console.log("[MasterAgent] ✓ Tour generation completed successfully");
      console.log("[MasterAgent] Total execution time:", totalDuration, "ms");
      console.log("[MasterAgent] Time saved by parallel execution: ~40-60 seconds");
      console.log(executionReport);

      // Cache the full result (3 days TTL)
      await generationCache.cacheFullResult(url, finalData);
      console.log("[MasterAgent] 💾 Full result cached for URL:", url);

      onProgress?.("completed", 100);
      if (taskId) {
        progressTracker.completePhase(taskId, 'finalize');
        progressTracker.completeTask(taskId);
      }

      // 清理可能殘留的殭屍任務（Round 36-Fix-3: 從 25 分鐘延長到 30 分鐘，與 index.ts 排程器保持一致）
      phaseTimer.end('P6b_selfRepair');
      // Round 55 Diag-C: Build timing summary
      const _phaseDurations: Record<string, string> = {};
      for (const [name, startMs] of Object.entries(_phaseTimers)) {
        _phaseDurations[name] = `+${((startMs - startTime) / 1000).toFixed(1)}s`;
      }
      const _totalMs = Date.now() - startTime;
      const _timingSummary = Object.entries(_phaseDurations).map(([n, t]) => `${n}@${t}`).join(' | ');
      console.log('[MasterAgent] ⏱ ========= PHASE TIMING SUMMARY =========');
      console.log(`[MasterAgent] ⏱ ${_timingSummary}`);
      console.log(`[MasterAgent] ⏱ TOTAL: ${_totalMs}ms (${(_totalMs / 1000).toFixed(1)}s)`);
      console.log('[MasterAgent] ⏱ =========================================');
      // Update resultSummary with timing info
      if (activityId) {
        const title = finalData.title || finalData.poeticTitle || '未命名行程';
        const dest = finalData.destinationCity || finalData.destinationCountry || '';
        await logAgentComplete(activityId, {
          status: 'completed',
          processingTimeMs: _totalMs,
          resultSummary: `已完成行程生成：「${title}${dest ? ` · ${dest}` : ''}」，耗時 ${(_totalMs / 1000).toFixed(0)} 秒 | ⏱ ${_timingSummary}`,
        });
      }
      cleanupZombieTasks(30).catch(() => {});
      return {
        success: true,
        data: finalData,
        executionReport,
        calibrationReport: calibrationReport ?? undefined,
        phaseTimings: { phases: _phaseDurations, totalMs: _totalMs, totalSec: (_totalMs / 1000).toFixed(1) },
      };

    } catch (error) {
      console.error("[MasterAgent] ✗ Critical error:", error);

      const executionReport = this.monitor.generateReport();
      console.log(executionReport);

      // Round 72: pull whatever partial data the progress tracker has been
      // accumulating so rollback() can find & delete uploaded R2 images.
      // Previously the rollback() TODO just logged "Rolling back..." and did nothing.
      let partialDataForRollback: any = undefined;
      if (taskId) {
        try {
          const snapshot = progressTracker.getProgress(taskId);
          partialDataForRollback = snapshot?.partialResults;
        } catch (snapErr) {
          console.warn("[MasterAgent] Could not snapshot partial results for rollback:", snapErr);
        }
      }

      // Mark task as failed in progress tracker
      if (taskId) {
        progressTracker.failTask(taskId, error instanceof Error ? error.message : "Unknown error");
      }

      // 記錄 MasterAgent 失敗
      if (activityId) {
        await logAgentComplete(activityId, {
          status: 'failed',
          processingTimeMs: Date.now() - startTime,
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        });
      }

      // 失敗時也清理殭屍任務（Round 36-Fix-3: 從 25 分鐘延長到 30 分鐘，與 index.ts 排程器保持一致）
      cleanupZombieTasks(30).catch(() => {});

      // Round 72: sweep orphaned R2 assets. Fire-and-forget — rollback never
      // throws, so this doesn't mask the original error.
      // v71: log if rollback fails so we can investigate orphaned-asset accumulation.
      if (partialDataForRollback) {
        this.rollback(partialDataForRollback).catch((rollbackErr) =>
          console.warn("[MasterAgent] rollback(partialData) failed (orphaned assets may remain):", (rollbackErr as Error)?.message)
        );
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        executionReport,
      };
    }
  }

  /**
   * Rollback on error — cleanup orphaned R2 assets + DB rows.
   * Delegates to `_pipeline/rollback.ts`. Kept as instance method to preserve
   * the public surface; new code should call `runRollback()` directly.
   *
   * @param partialData any object whose string leaves may contain R2 URLs
   *                    (tourData, raw LLM output, etc.)
   */
  async rollback(partialData: any): Promise<void> {
    return runRollback(partialData);
  }
}
