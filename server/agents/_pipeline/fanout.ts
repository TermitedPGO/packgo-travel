/**
 * Pipeline Phase 3b/3c/4: Image Intelligence + Parallel Agent Fanout
 *
 * Extracted from masterAgent.ts during v2 Wave 2 Module 2.9 split. Covers
 * three sub-phases that conceptually belong together (everything between
 * ColorTheme and final assembly):
 *
 *   Phase 3b   Image intelligence pipeline (PDF → Unsplash fallback)
 *   Phase 3c   Vision analysis + smart-match
 *   Phase 4    PARALLEL: ItineraryUnifiedAgent || DetailsSkill, then
 *              sequential TransportationAgent (depends on tourType)
 *   + image pool top-ups (hotel / meal / highlight)
 *
 * Returns a `FanoutResult` containing everything assembly.ts needs to build
 * `finalData`. The supervisor never inspects intermediate state.
 */

import { createChildLogger } from "../../_core/logger";
import { progressTracker } from "../progressTracker";
import { logAgentStart, logAgentComplete } from "../../agentActivityService";
import generationCache from "../../cache/generation-cache";
import { TourType } from "../itineraryUnifiedAgent";
import type { AgentDeps, PhaseTimer, ProgressCallback } from "./types";

const log = createChildLogger({ module: "masterAgent/fanout" });

export interface FanoutPhaseInput {
  rawData: any;
  analyzedContent: any;
  forceRegenerate: boolean;
  taskId?: string;
  userId?: number;
  onProgress?: ProgressCallback;
  deps: AgentDeps;
  phaseTimer: PhaseTimer;
}

export interface FanoutResult {
  heroImage: { url: string; alt: string; source?: string };
  featureImages: any[];
  featureImageObjects: any[];
  featureImageUrls: string[];
  hotelImagePool: string[];
  mealImagePool: string[];
  highlightImagePool: string[];
  itineraryData: string;
  tourType: TourType;
  costData: any;
  noticeData: any;
  hotelData: any;
  mealData: any;
  transportationData: any;
  hotelsArrRaw: any[];
  mealsArrRaw: any[];
}

export async function runFanoutPhase(input: FanoutPhaseInput): Promise<FanoutResult> {
  const { rawData, analyzedContent, forceRegenerate, taskId, userId, onProgress, deps, phaseTimer } = input;

  // ========================================================================
  // Phase 4: PARALLEL EXECUTION (6 agents - Image generation removed)
  // Itinerary + 5 Detail Agents running in parallel
  // ========================================================================
  onProgress?.("generating_content", 55);
  console.log("[MasterAgent] Starting Phase 4: PARALLEL (6 agents - no image generation)");
  console.log("[MasterAgent] Running: Itinerary, Cost, Notice, Hotel, Meal, Flight");

  phaseTimer.start('P3b_imageIntelligence');
  // Image intelligence pipeline: PDF-extracted images → Unsplash fallback
  console.log("[MasterAgent] Starting image intelligence pipeline");
  let imageResults: { hero: { url: string; alt: string } | null; features: Array<{ url: string; alt: string; source: string }> } = { hero: null, features: [] };
  try {
    const { findBestImage } = await import('../../services/imageIntelligenceService');
    // rawData.images contains already-uploaded PDF image URLs (ExtractedImage[])
    const pdfImageUrls = ((rawData.images || []) as Array<{ url: string; type: string; page: number }>).map(img => ({
      url: img.url,
      type: (img.type === 'hero' ? 'hero' : img.type === 'feature' ? 'feature' : 'other') as 'hero' | 'feature' | 'other',
      pageNumber: img.page || 0,
    }));
    const imgDestination = rawData.location?.destinationCity || rawData.location?.destinationCountry || '';

    // Hero image: prefer PDF wide images, then Unsplash
    const heroResult = await findBestImage(imgDestination, {
      pdfImageUrls,
      preferredType: 'hero',
    });
    if (heroResult) {
      imageResults.hero = { url: heroResult.url, alt: `${imgDestination} travel` };
    }

    // Feature images: PDF first, then Unsplash per highlight
    // Use analyzedContent.highlights as fallback when rawData.highlights is empty
    const highlightSources = (rawData.highlights?.length > 0)
      ? rawData.highlights
      : (analyzedContent?.highlights || []);
    for (const highlight of highlightSources.slice(0, 6)) {
      const imgResult = await findBestImage(String(highlight) || imgDestination, {
        pdfImageUrls,
        preferredType: 'feature',
      });
      if (imgResult) {
        imageResults.features.push({
          url: imgResult.url,
          alt: String(highlight),
          source: imgResult.source,
        });
      }
    }

    console.log(`[MasterAgent] ✓ Image pipeline: hero=${!!imageResults.hero}, features=${imageResults.features.length}`);
  } catch (imgPipelineError) {
    log.warn({ event: "phase3b.image_pipeline_failed", err: imgPipelineError }, "Image pipeline failed, continuing with defaults");
    console.warn('[MasterAgent] Image pipeline failed, continuing with defaults:', imgPipelineError);
  }
  phaseTimer.end('P3b_imageIntelligence');
  phaseTimer.start('P3c_visionAnalysis');
  // ── Vision Analysis + Smart Match ────────────────────────────────────────────────────────────────────────────
  // Analyze all collected images with Claude Vision, then smart-match to targets
  let visionAnalyses: Array<import('../../services/visionAnalysisService').VisionAnalysisResult> = [];
  let smartMatchMap: Map<string, string> = new Map();
  try {
    const { analyzeAndTagImages, smartMatchImages } = await import('../../services/imageIntelligenceService');
    const allImageUrls = [
      imageResults.hero?.url,
      ...imageResults.features.map((f: any) => f.url),
    ].filter(Boolean) as string[];

    if (allImageUrls.length > 0) {
      visionAnalyses = await analyzeAndTagImages(allImageUrls.map(url => ({ url })));
      console.log(`[MasterAgent] ✓ Vision analyzed ${visionAnalyses.length} images`);

      // Build targets from rawData for smart matching
      const targets: Array<{ name: string; type: 'attraction' | 'hotel' | 'meal' | 'hero' }> = [
        ...(Array.isArray(rawData.hotelInfo) ? rawData.hotelInfo : []).map((h: any) => ({
          name: h?.name || h?.hotel || '',
          type: 'hotel' as const,
        })),
        ...(Array.isArray(rawData.attractions) ? rawData.attractions : []).map((a: any) => ({
          name: a?.name || '',
          type: 'attraction' as const,
        })),
      ].filter(t => t.name);

      if (targets.length > 0 && visionAnalyses.length > 0) {
        smartMatchMap = await smartMatchImages(visionAnalyses, allImageUrls, targets);
        console.log(`[MasterAgent] ✓ Smart matched ${smartMatchMap.size} images to targets`);
        (imageResults as any).matched = Object.fromEntries(smartMatchMap);
      }
    }
  } catch (visionErr) {
    log.warn({ event: "phase3c.vision_failed", err: visionErr }, "Vision analysis failed, continuing");
    console.warn('[MasterAgent] Vision analysis failed, continuing:', visionErr);
  }
  phaseTimer.end('P3c_visionAnalysis');
  // ── End Vision Analysis ────────────────────────────────────────────────────────────────────────────
  // Start all agents (except ImageGenerationAgent and ItineraryAgent which runs separately)
  // DetailsSkill replaces CostAgent, NoticeAgent, HotelAgent, MealAgent
  phaseTimer.start('P4_details');
  deps.monitor.startAgent('DetailsSkill');
  deps.monitor.startAgent('TransportationAgent');
  if (taskId) {
    // Skip image_generation phase - mark as complete immediately
    progressTracker.startPhase(taskId, 'image_generation');
    progressTracker.completePhase(taskId, 'image_generation');
    progressTracker.startPhase(taskId, 'itinerary');
    progressTracker.startPhase(taskId, 'cost_agent');
    progressTracker.startPhase(taskId, 'notice_agent');
    progressTracker.startPhase(taskId, 'hotel_agent');
    progressTracker.startPhase(taskId, 'meal_agent');
    progressTracker.startPhase(taskId, 'flight_agent');
  }

  phaseTimer.start('P4_itinerary');
  // Round 80.15-C: Itinerary + Details now run IN PARALLEL.
  //
  // Before: Itinerary blocked Details → Transportation. Total ~40s.
  // After:  Itinerary || Details (parallel), then Transportation
  //         (depends on tourType). Total ~25-30s, saves 10-15s on
  //         every AI generation.
  //
  // We don't fully parallelize Transportation because its output
  // depends on `tourType` from itinerary (TRAIN vs FLIGHT vs CRUISE
  // produce different transportation records). Keeping Transportation
  // sequential after itinerary preserves data fidelity.

  // P3: Check Details cache before LLM call
  // Round 60: Include sourceUrl/tourId in cache key to prevent cross-tour cache pollution
  const _cacheDestination = rawData.location?.destinationCity || rawData.location?.destinationCountry || "unknown";
  const _cacheSourceId = rawData.sourceUrl || rawData.normGroupId || rawData.basicInfo?.title?.slice(0, 20) || "";
  const detailsCacheKey = `${_cacheDestination}::${_cacheSourceId}`;
  // Round 64 Fix A: respect forceRegenerate flag (previously ignored → stale cache poisoned verification)
  const cachedDetails = forceRegenerate ? null : await generationCache.getDetailsResult(detailsCacheKey);
  if (forceRegenerate) {
    console.log(`[MasterAgent] 🔄 Round 64: forceRegenerate=true — bypassing DetailsSkill cache for key "${detailsCacheKey}"`);
  }

  // Stage A: itinerary + details run in parallel.
  // Wrapped in async IIFEs so all side effects (logging, monitor,
  // progressTracker, image assignment) complete before the promise resolves.
  let itineraryData = "";
  let tourType: TourType = 'GENERAL'; // 預設行程類型

  const itineraryPromise = (async () => {
    deps.monitor.startAgent('ItineraryUnifiedAgent');
    if (taskId) progressTracker.startPhase(taskId, 'itinerary');

    const unifiedResult = await deps.itineraryUnifiedAgent.execute(rawData);

    if (unifiedResult.success && unifiedResult.data && unifiedResult.data.polishedItineraries.length > 0) {
      const { polishedItineraries, fidelityCheck, extractionMethod, llmCallCount, totalElapsedMs } = unifiedResult.data;

      // 保存 tourType 供 TransportationAgent 使用
      tourType = unifiedResult.data.tourType || 'GENERAL';

      console.log(`[MasterAgent] ✓ ItineraryUnifiedAgent completed: ${polishedItineraries.length} days`);
      console.log(`[MasterAgent] Extraction method: ${extractionMethod}, LLM calls: ${llmCallCount}, Time: ${totalElapsedMs}ms`);
      console.log(`[MasterAgent] Tour Type: ${tourType}, Transportation: ${unifiedResult.data.originalTransportation}`);
      console.log(`[MasterAgent] Fidelity: score=${fidelityCheck.overallScore}, transport=${fidelityCheck.transportationMatch}, hotel=${fidelityCheck.hotelMatch}`);
      if (fidelityCheck.issues.length > 0) {
        console.warn(`[MasterAgent] Fidelity Issues: ${fidelityCheck.issues.join(', ')}`);
      }

      // 為每日行程配置圖片
      const { assignItineraryImages } = await import("../../services/itineraryImageService");
      const itinerariesWithImages = await assignItineraryImages(
        polishedItineraries,
        { country: rawData?.location?.destinationCountry, city: rawData?.location?.destinationCity }
      );

      itineraryData = JSON.stringify(itinerariesWithImages);
      deps.monitor.completeAgent('ItineraryUnifiedAgent', unifiedResult);
      // 記錄 ItineraryUnifiedAgent 詳細工作
      try {
        const itineraryActivityId = await logAgentStart({
          agentName: 'ItineraryUnifiedAgent',
          agentKey: 'planner',
          taskType: 'tour_generation',
          taskId: taskId,
          taskTitle: `生成行程表：${rawData.basicInfo?.title || rawData.location?.destinationCity || '未知目的地'}`,
          userId,
        });
        if (itineraryActivityId) await logAgentComplete(itineraryActivityId, {
          status: 'completed',
          resultSummary: `🗓️ 生成 ${polishedItineraries.length} 天行程（${tourType}），方法：${extractionMethod}，忠實度分數 ${fidelityCheck.overallScore}，耗時 ${(totalElapsedMs / 1000).toFixed(1)} 秒${fidelityCheck.issues.length > 0 ? `，警告：${fidelityCheck.issues.slice(0, 2).join('; ')}` : ''}`,
        });
      } catch (logErr) { console.warn('[MasterAgent] Failed to log ItineraryUnifiedAgent activity:', logErr); }
    } else {
      console.warn("[MasterAgent] ⚠ ItineraryUnifiedAgent returned no data");
      itineraryData = JSON.stringify([]);
    }

    if (taskId) progressTracker.completePhase(taskId, 'itinerary');
    onProgress?.("extracting_itinerary", 65); // Phase 4: Itinerary completed
  })();

  // DetailsSkill - P1 optimized: single LLM call for all 4 sub-skills
  // P3: Skip LLM if cache hit
  const detailsPromise = cachedDetails
    ? Promise.resolve(cachedDetails)
    : deps.retryManager.executeWithRetry(
        () => deps.detailsSkill.executeAllCombined(rawData),
        deps.retryConfig,
        'DetailsSkill'
      );

  // Run itinerary + details together. Promise.allSettled so one failure
  // doesn't kill the other.
  const [itineraryStageResult, detailsSkillResult] = await Promise.allSettled([
    itineraryPromise,
    detailsPromise,
  ]);

  // If the itinerary IIFE threw, surface it through progressTracker (the
  // IIFE doesn't have its own try/catch — Promise.allSettled captures it).
  if (itineraryStageResult.status === 'rejected') {
    const itinErr = itineraryStageResult.reason;
    console.error("[MasterAgent] Itinerary generation error:", itinErr);
    if (taskId) progressTracker.failPhase(taskId, 'itinerary', itinErr instanceof Error ? itinErr.message : 'Unknown error');
    if (!itineraryData) itineraryData = JSON.stringify([]);
  }

  // Stage B: Transportation runs after itinerary so it has the correct
  // tourType (TRAIN / FLIGHT / CRUISE / etc.). Wrapped in Promise.allSettled
  // so downstream code keeps consuming `transportationResult.status === ...`.
  const transportationResult = await Promise.allSettled([
    deps.retryManager.executeWithRetry(
      () => deps.transportationAgent.execute(rawData, tourType),
      deps.retryConfig,
      'TransportationAgent'
    ),
  ]).then(([r]) => r);

  if (cachedDetails) {
    console.log(`[MasterAgent] 🎯 DetailsSkill cache hit for: ${detailsCacheKey} - skipped LLM call`);
  }

  // Hero Image: Forge (pipeline) → Lion real image → Unsplash (last resort)
  // Round 64 Fix B: Round 63 Fix 4 was broken — imageGenerationAgent already falls back to Unsplash
  // internally on Forge failure, so `!heroImage.url` was never true and Lion fallback never fired.
  // Now we inspect `source` to detect the case where pipeline gave us Unsplash (i.e. Forge failed),
  // and prefer the real Lion travel image in that case.
  let heroImage: { url: string; alt: string; source?: string } = imageResults.hero || { url: "", alt: "", source: "fallback" };
  // Feature images from image pipeline (already populated above)
  let featureImages: any[] = imageResults.features;

  const pipelineSource = (imageResults.hero as any)?.source as string | undefined;
  const pipelineGaveRealHero = !!heroImage.url && pipelineSource === 'ai';

  if (!pipelineGaveRealHero) {
    // Either pipeline returned empty, or pipeline fell back to Unsplash/fallback internally.
    // In both cases, prefer the real liontravel hero image if available.
    const lionHeroUrl = (rawData as any)?.images?.[0]?.url || (rawData as any)?.lionHeroImageUrl || '';
    if (lionHeroUrl && lionHeroUrl.startsWith('http')) {
      heroImage = {
        url: lionHeroUrl,
        alt: `${rawData.location?.destinationCity || rawData.location?.destinationCountry || 'travel'} travel`,
        source: 'lion',
      };
      console.log(`[MasterAgent] Round 64 Fix B: Forge failed (pipelineSource=${pipelineSource}), using Lion heroImageUrl: ${lionHeroUrl.substring(0, 60)}...`);
    } else if (!heroImage.url) {
      // No pipeline image AND no Lion image → Unsplash Tier-3
      try {
        const { searchUnsplashPhotos } = await import("../../services/unsplashService");
        const destination = rawData.location?.destinationCity || rawData.location?.destinationCountry || "travel";
        console.log(`[MasterAgent] Round 64: No pipeline/Lion hero, falling back to Unsplash for: ${destination}`);

        const heroImages = await searchUnsplashPhotos(destination, 1);
        if (heroImages.length > 0) {
          heroImage = {
            url: heroImages[0],
            alt: `${destination} travel destination`,
            source: 'unsplash',
          };
          console.log(`[MasterAgent] ✓ Found hero image from Unsplash (Tier-3): ${heroImage.url.substring(0, 50)}...`);
        } else {
          console.log(`[MasterAgent] Round 64: No hero image found from any source (pipeline/Lion/Unsplash)`);
        }
      } catch (error) {
        console.warn(`[MasterAgent] Failed to search hero image:`, error);
      }
    } else {
      // Pipeline gave us Unsplash/fallback but no Lion available → keep pipeline result
      console.log(`[MasterAgent] Round 64: Forge failed, no Lion available, keeping pipeline ${pipelineSource} hero: ${heroImage.url.substring(0, 50)}...`);
    }
  } else {
    console.log(`[MasterAgent] ✓ Using Forge pipeline hero (source=${pipelineSource}): ${heroImage.url.substring(0, 50)}...`);
  }

  // Process DetailsSkill results (replaces CostAgent, NoticeAgent, HotelAgent, MealAgent)
  let costData: any = {};
  let noticeData: any = {};
  let hotelData: any = {};
  let mealData: any = {};
  let transportationData: any = {};

  // Handle DetailsSkill result
  if (detailsSkillResult.status === 'fulfilled') {
    const result = detailsSkillResult.value as any;
    if (result.success && result.data) {
      costData = result.data.costs || {};
      noticeData = result.data.notices || {};
      hotelData = result.data.hotels || [];
      mealData = result.data.meals || [];

      // Complete all detail phases
      deps.monitor.completeAgent('DetailsSkill', result);
      if (taskId) {
        progressTracker.completePhase(taskId, 'cost_agent');
        progressTracker.completePhase(taskId, 'notice_agent');
        progressTracker.completePhase(taskId, 'hotel_agent');
        progressTracker.completePhase(taskId, 'meal_agent');
      }
      onProgress?.("extracting_costs", 75); // Phase 4: DetailsSkill completed
      console.log(`[MasterAgent] ✓ DetailsSkill completed (costs, notices, hotels, meals)`);
      console.log(`[MasterAgent] hotelData type: ${typeof hotelData}, isArray: ${Array.isArray(hotelData)}, length: ${Array.isArray(hotelData) ? hotelData.length : 'N/A'}`);
      console.log(`[MasterAgent] mealData type: ${typeof mealData}, isArray: ${Array.isArray(mealData)}, length: ${Array.isArray(mealData) ? mealData.length : 'N/A'}`);
      console.log(`[MasterAgent] Token usage - Input: ${result.usage?.inputTokens}, Output: ${result.usage?.outputTokens}`);
      // 記錄 DetailsSkill 詳細工作
      try {
        const detailsActivityId = await logAgentStart({
          agentName: 'DetailsSkill',
          agentKey: 'writer',
          taskType: 'tour_generation',
          taskId: taskId,
          taskTitle: `生成行程詳情：${rawData.basicInfo?.title || rawData.location?.destinationCity || '未知目的地'}`,
          userId,
        });
        if (detailsActivityId) await logAgentComplete(detailsActivityId, {
          status: 'completed',
          resultSummary: `📝 ${cachedDetails ? '（快取命中）' : ''}生成費用說明、${Array.isArray(hotelData) ? hotelData.length : 0} 間飯店資訊、${Array.isArray(mealData) ? mealData.length : 0} 項餐飲資訊、注意事項，耗用 ${(result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0)} tokens`,
        });
      } catch (logErr) { console.warn('[MasterAgent] Failed to log DetailsSkill activity:', logErr); }

      // P3: Cache the DetailsSkill result for future use
      if (!cachedDetails) {
        try {
          await generationCache.cacheDetailsResult(detailsCacheKey, result);
          console.log(`[MasterAgent] 💾 DetailsSkill result cached for: ${detailsCacheKey}`);
        } catch (cacheErr) {
          console.warn(`[MasterAgent] Failed to cache DetailsSkill result:`, cacheErr);
        }
      }
    } else {
      console.warn(`[MasterAgent] ⚠ DetailsSkill returned error, using fallbacks`);
      costData = deps.fallbackManager.handleFailure('CostAgent', new Error('DetailsSkill failed'));
      noticeData = deps.fallbackManager.handleFailure('NoticeAgent', new Error('DetailsSkill failed'));
      hotelData = deps.fallbackManager.handleFailure('HotelAgent', new Error('DetailsSkill failed'));
      mealData = deps.fallbackManager.handleFailure('MealAgent', new Error('DetailsSkill failed'));
    }
  } else {
    const error = detailsSkillResult.reason;
    console.warn(`[MasterAgent] ⚠ DetailsSkill failed:`, error);
    deps.monitor.failAgent('DetailsSkill', error);
    if (taskId) {
      progressTracker.failPhase(taskId, 'cost_agent', error?.message || 'DetailsSkill failed');
      progressTracker.failPhase(taskId, 'notice_agent', error?.message || 'DetailsSkill failed');
      progressTracker.failPhase(taskId, 'hotel_agent', error?.message || 'DetailsSkill failed');
      progressTracker.failPhase(taskId, 'meal_agent', error?.message || 'DetailsSkill failed');
    }
    costData = deps.fallbackManager.handleFailure('CostAgent', error);
    noticeData = deps.fallbackManager.handleFailure('NoticeAgent', error);
    hotelData = deps.fallbackManager.handleFailure('HotelAgent', error);
    mealData = deps.fallbackManager.handleFailure('MealAgent', error);
  }

  // Round 80.16 P1b fix: if DetailsSkill returned no/empty costs but
  // rawData has Lion-extracted includes/excludes, fall back to those.
  // Same for notices.
  if (
    (!costData?.includes || (Array.isArray(costData.includes) && costData.includes.length === 0)) &&
    Array.isArray(rawData.includes) && rawData.includes.length > 0
  ) {
    costData = costData || {};
    costData.includes = rawData.includes;
    console.log(`[MasterAgent] 💡 P1b: filled costs.includes from Lion featuresHtml (${rawData.includes.length} items)`);
  }
  if (
    (!costData?.excludes || (Array.isArray(costData.excludes) && costData.excludes.length === 0)) &&
    Array.isArray(rawData.excludes) && rawData.excludes.length > 0
  ) {
    costData = costData || {};
    costData.excludes = rawData.excludes;
    console.log(`[MasterAgent] 💡 P1b: filled costs.excludes from Lion featuresHtml (${rawData.excludes.length} items)`);
  }

  // Handle TransportationAgent result
  if (transportationResult.status === 'fulfilled') {
    const result = transportationResult.value as any;
    if (result.success && result.data) {
      transportationData = result.data;
      deps.monitor.completeAgent('TransportationAgent', result);
      if (taskId) progressTracker.completePhase(taskId, 'flight_agent');
      onProgress?.("extracting_flights", 80); // Phase 4: TransportationAgent completed
      console.log(`[MasterAgent] ✓ TransportationAgent completed`);
      // 記錄 TransportationAgent 詳細工作
      try {
        const transportActivityId = await logAgentStart({
          agentName: 'TransportationAgent',
          agentKey: 'skydesk',
          taskType: 'tour_generation',
          taskId: taskId,
          taskTitle: `分析交通方式：${rawData.basicInfo?.title || rawData.location?.destinationCity || '未知目的地'}`,
          userId,
        });
        if (transportActivityId) await logAgentComplete(transportActivityId, {
          status: 'completed',
          resultSummary: `✈️ 交通類型：${transportationData?.typeName || transportationData?.type || 'N/A'}${transportationData?.airline ? `，航空公司：${transportationData.airline}` : ''}${transportationData?.flightNumber ? `，航班：${transportationData.flightNumber}` : ''}`,
        });
      } catch (logErr) { console.warn('[MasterAgent] Failed to log TransportationAgent activity:', logErr); }
    } else {
      console.warn(`[MasterAgent] ⚠ TransportationAgent returned error, using fallback`);
      transportationData = deps.fallbackManager.handleFailure('TransportationAgent', new Error(result?.error || 'TransportationAgent failed'));
    }
  } else {
    const error = transportationResult.reason;
    deps.monitor.failAgent('TransportationAgent', error);
    if (taskId) progressTracker.failPhase(taskId, 'flight_agent', error?.message || 'TransportationAgent failed');
    console.warn(`[MasterAgent] ⚠ TransportationAgent failed, using fallback`);
    transportationData = deps.fallbackManager.handleFailure('TransportationAgent', error);
  }

  phaseTimer.end('P4_details');
  phaseTimer.end('P4_itinerary');
  console.log("[MasterAgent] ✓ Phase 4 completed: PARALLEL (6 agents - no image generation)");

  // Fix 2 (Round 62): featureImages keep full object structure {url, alt, caption, position}
  const featureImageObjects = featureImages.map((img: any, i: number) => ({
    url: img.url || '',
    alt: img.alt || '',
    caption: img.caption || '',
    position: i === 0 ? 'large' : 'small'
  })).filter((f: any) => f.url !== '');
  // Keep URL array for backward compat (used in allImageUrls below)
  const featureImageUrls = featureImageObjects.map((f: any) => f.url);

  // ────────────────────────────────────────────────────────────────────────
  // Round 68 Fix 4: Pre-compute hotel/meal image pools WITH Unsplash fallback.
  // When the source URL doesn't have structured hotel/meal data (e.g. japan.travel,
  // generic blog posts), both `scrapedHotelUrls` and `lionFeatureImages` are empty,
  // which used to leave hotelImages=[] and meals[].image="" (QA deducts up to -29).
  // Now we do an Unsplash search using hotel name / meal name / city as keywords.
  // ────────────────────────────────────────────────────────────────────────
  const hotelsArrRaw = Array.isArray(hotelData) ? hotelData : (hotelData?.hotels || []);
  const mealsArrRaw = Array.isArray(mealData) ? mealData : (mealData?.meals || []);
  const lionFIForPools = (rawData as any)?.lionFeatureImages || [];
  const lionFIUrlsForPools: string[] = lionFIForPools
    .filter((img: any) => img?.url && typeof img.url === 'string' && img.url.startsWith('http'))
    .map((img: any) => img.url);
  const scrapedHotelUrls: string[] = hotelsArrRaw
    .map((h: any) => h.image)
    .filter((u: any) => typeof u === 'string' && u.startsWith('http'));
  let hotelImagePool: string[] = scrapedHotelUrls.length > 0
    ? scrapedHotelUrls.slice()
    : lionFIUrlsForPools.slice();
  let mealImagePool: string[] = lionFIUrlsForPools.slice();

  const cityHint = rawData.location?.destinationCity || rawData.location?.destinationCountry || '';

  if (hotelImagePool.length === 0) {
    try {
      const { searchUnsplashPhotos } = await import('../../services/unsplashService');
      const queries = [
        ...hotelsArrRaw.map((h: any) => h.name).filter((n: any) => typeof n === 'string' && n.length > 0).slice(0, 2),
        cityHint ? `${cityHint} hotel` : 'luxury hotel',
        cityHint ? `${cityHint} resort` : 'boutique hotel',
      ];
      for (const q of queries) {
        if (hotelImagePool.length >= 4) break;
        const photos = await searchUnsplashPhotos(q, 2);
        hotelImagePool.push(...photos);
      }
      console.log(`[MasterAgent] Round 68 Fix 4: hotelImagePool Unsplash fallback → ${hotelImagePool.length} images`);
    } catch (e) {
      console.warn('[MasterAgent] Round 68 Fix 4: hotelImagePool Unsplash fallback failed:', e);
    }
  }

  if (mealImagePool.length === 0) {
    try {
      const { searchUnsplashPhotos } = await import('../../services/unsplashService');
      const queries = [
        ...mealsArrRaw.map((m: any) => m.restaurant || m.name || m.cuisine)
          .filter((n: any) => typeof n === 'string' && n.length > 0).slice(0, 3),
        cityHint ? `${cityHint} food` : 'cuisine food',
        cityHint ? `${cityHint} restaurant` : 'fine dining restaurant',
      ];
      for (const q of queries) {
        if (mealImagePool.length >= 6) break;
        const photos = await searchUnsplashPhotos(q, 2);
        mealImagePool.push(...photos);
      }
      console.log(`[MasterAgent] Round 68 Fix 4: mealImagePool Unsplash fallback → ${mealImagePool.length} images`);
    } catch (e) {
      console.warn('[MasterAgent] Round 68 Fix 4: mealImagePool Unsplash fallback failed:', e);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Round 69 Fix 2: highlightImagePool — ensure highlights and keyFeatures
  // have enough images. Previously when ItineraryAgent produced 7-8 highlights
  // but ImagePromptAgent only returned 4-6 featureImages, the trailing
  // highlights got image="" (rendered as empty grey boxes on tour detail page).
  // Vietnam: 7 highlights → 4 images (3 empty). Fukuoka: 8 → 4 (4 empty).
  // Now we top up with Unsplash using highlight titles + destination as queries.
  // ────────────────────────────────────────────────────────────────────────
  const highlightsArrForPool = analyzedContent.highlights || [];
  const highlightImagePool: string[] = featureImages
    .filter((img: any) => img?.url && typeof img.url === 'string' && img.url.startsWith('http'))
    .map((img: any) => img.url);

  if (highlightImagePool.length < highlightsArrForPool.length) {
    const needed = highlightsArrForPool.length - highlightImagePool.length;
    try {
      const { searchUnsplashPhotos } = await import('../../services/unsplashService');
      const startIdx = highlightImagePool.length;
      // Build queries from trailing highlights that have no image yet
      const queries: string[] = [];
      for (let i = startIdx; i < highlightsArrForPool.length; i++) {
        const h: any = highlightsArrForPool[i];
        const title = (typeof h?.title === 'string' && h.title.length > 0) ? h.title : '';
        const q = title ? `${title} ${cityHint || ''}`.trim() : (cityHint ? `${cityHint} landmark` : 'travel destination');
        queries.push(q);
      }
      // Add one generic destination fallback query
      queries.push(cityHint ? `${cityHint} travel scenery` : 'travel scenery');

      for (const q of queries) {
        if (highlightImagePool.length >= highlightsArrForPool.length) break;
        const photos = await searchUnsplashPhotos(q, 1);
        if (photos.length > 0) highlightImagePool.push(...photos);
      }
      console.log(`[MasterAgent] Round 69 Fix 2: highlightImagePool topped up → ${highlightImagePool.length}/${highlightsArrForPool.length} (needed +${needed})`);
    } catch (e) {
      console.warn('[MasterAgent] Round 69 Fix 2: highlightImagePool Unsplash fallback failed:', e);
    }
  }

  return {
    heroImage,
    featureImages,
    featureImageObjects,
    featureImageUrls,
    hotelImagePool,
    mealImagePool,
    highlightImagePool,
    itineraryData,
    tourType,
    costData,
    noticeData,
    hotelData,
    mealData,
    transportationData,
    hotelsArrRaw,
    mealsArrRaw,
  };
}
