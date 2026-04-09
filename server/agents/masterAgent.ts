/**
 * Master Agent
 * Coordinates all agents to generate a complete tour
 * 
 * Optimizations:
 * - Retry mechanism with exponential backoff
 * - Parallel execution for independent agents
 * - Agent status monitoring
 * - Fallback handling for non-critical agents
 * 
 * Execution Flow (Optimized):
 * Phase 1: Web Scraping (Critical, Sequential)
 * Phase 2: Content Analysis (Critical, Sequential)
 * Phase 3: ColorTheme + ImagePrompt (Parallel)
 * Phase 4: ImageGeneration + Itinerary + 5 Detail Agents (Parallel - 7 agents)
 * Phase 5: Assemble Final Data
 */

import { ContentAnalyzerAgent } from "./contentAnalyzerAgent";
import { ImagePromptAgent } from "./imagePromptAgent";
import { ImageGenerationAgent } from "./imageGenerationAgent";
import { ColorThemeAgent } from "./colorThemeAgent";
import { ItineraryUnifiedAgent } from "./itineraryUnifiedAgent";
// ItineraryExtractAgent + ItineraryPolishAgent merged into ItineraryUnifiedAgent (single LLM call)
// CostAgent, NoticeAgent, HotelAgent, MealAgent replaced by DetailsSkill
import { getDetailsSkill, DetailsSkill } from "../skills/details/detailsSkill";
import { FlightAgent } from "./flightAgent";
import { TransportationAgent } from "./transportationAgent";
// LionTitleGenerator removed - using ContentAnalyzerAgent.poeticTitle instead
import { getKeyInstructions } from "./skillLoader";
import {
  RetryManager,
  AgentMonitor,
  FallbackManager,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_FALLBACK_CONFIGS,
  type RetryConfig
} from "./agentOrchestration";
import { progressTracker } from "./progressTracker";
import generationCache from "../cache/generation-cache";
import { generateSmartTags, mergeWithExistingTags } from "../utils/tagGenerator";
import { TourType } from "./itineraryUnifiedAgent";
import { applyLearnedSkills } from "./learningAgent";
import { logAgentStart, logAgentComplete, cleanupZombieTasks } from "../agentActivityService";

export interface MasterAgentResult {
  success: boolean;
  data?: {
    // Basic info
    poeticTitle: string; // 詩意化標題 (Sipincollection 風格)
    title: string;
    description: string;
    productCode: string;
    tags: string[];
    
    // Location
    destinationCountry: string;
    destinationCity: string;
    departureCity: string;
    
    // Duration
    days: number;
    nights: number;
    
    // Pricing
    price: number;
    
    // Hero section
    heroImage: string;
    heroImageAlt: string;
    heroSubtitle: string;
    
    // Color theme
    colorTheme: any;
    
    // Highlights
    highlights: string; // JSON string
    
    // Key features
    keyFeatures: string; // JSON string
    
    // Poetic content
    poeticContent: string; // JSON string
    
    // Detailed Itinerary (詳細每日行程)
    itineraryDetailed: string; // JSON string
    
    // Cost Explanation (費用說明)
    costExplanation: string; // JSON string
    
    // Detailed Notice (詳細注意事項)
    noticeDetailed: string; // JSON string
    
    // Hotels (飯店介紹)
    hotels: string; // JSON string
    
    // Meals (餐飲介紹)
    meals: string; // JSON string
    
    // Flights (航班資訊)
    flights: string; // JSON string
    
    // Feature Images
    featureImages: string; // JSON string
    
    // Metadata
    originalityScore: number;
    sourceUrl: string;
  };
  error?: string;
  progress?: {
    currentStep: string;
    percentage: number;
  };
  executionReport?: string; // Agent execution report
}

/**
 * Master Agent
 * Orchestrates all agents to generate a complete tour
 */
export class MasterAgent {
  private skillInstructions: string;
  private retryManager: RetryManager;
  private monitor: AgentMonitor;
  private fallbackManager: FallbackManager;
  private retryConfig: RetryConfig;

  // Agent instances
  private contentAnalyzerAgent: ContentAnalyzerAgent;
  private imagePromptAgent: ImagePromptAgent;
  private imageGenerationAgent: ImageGenerationAgent;
  private colorThemeAgent: ColorThemeAgent;
  private itineraryUnifiedAgent: ItineraryUnifiedAgent; // merged Extract + Polish
  // DetailsSkill replaces CostAgent, NoticeAgent, HotelAgent, MealAgent
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
    this.imagePromptAgent = new ImagePromptAgent();
    this.imageGenerationAgent = new ImageGenerationAgent();
    this.colorThemeAgent = new ColorThemeAgent();
    this.itineraryUnifiedAgent = new ItineraryUnifiedAgent(); // single LLM call for extract + polish
    // DetailsSkill replaces CostAgent, NoticeAgent, HotelAgent, MealAgent
    this.detailsSkill = getDetailsSkill();
    this.flightAgent = new FlightAgent();
    this.transportationAgent = new TransportationAgent();
    
    console.log('[MasterAgent] Initialized with optimized parallel execution');
  }
  
  /**
   * Execute complete tour generation with optimizations
   * 
   * Optimized execution flow:
   * 1. Web Scraping (sequential, critical)
   * 2. Content Analysis + Lion Title (sequential, critical)
   * 3. ColorTheme + ImagePrompt (parallel)
   * 4. ImageGeneration + Itinerary + 5 Detail Agents (parallel - 7 agents!)
   * 5. Assemble final data
   */
  async execute(
    url: string,
    userId?: number,
    onProgress?: (step: string, percentage: number) => void,
    taskId?: string,
    forceRegenerate: boolean = false,
    isPdf: boolean = false
  ): Promise<MasterAgentResult> {
    const startTime = Date.now();
    console.log("[MasterAgent] Starting OPTIMIZED tour generation...");
    console.log("[MasterAgent] URL:", url);
    console.log("[MasterAgent] User ID:", userId);
    console.log("[MasterAgent] Force Regenerate:", forceRegenerate);
    console.log("[MasterAgent] Is PDF:", isPdf);
    
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
    
    try {
      // ========================================================================
      // Phase 0: Check Cache for Full Result
      // If we have a cached result for this URL, return it immediately
      // Skip cache if forceRegenerate is true
      // ========================================================================
      onProgress?.("checking_cache", 5);
      
      if (forceRegenerate) {
        console.log("[MasterAgent] 🔄 Force regenerate enabled, skipping cache");
      } else {
        console.log("[MasterAgent] Checking cache for URL:", url);
      }
      
      const cachedFullResult = forceRegenerate ? null : await generationCache.getFullResult(url);
      if (cachedFullResult) {
        console.log("[MasterAgent] 🎯 Cache HIT! Returning cached result");
        const elapsedTime = Date.now() - startTime;
        console.log(`[MasterAgent] Total time (from cache): ${elapsedTime}ms`);
        
        return {
          success: true,
          data: cachedFullResult,
          executionReport: `Cache hit - returned in ${elapsedTime}ms`,
        };
      }
      console.log("[MasterAgent] Cache MISS, proceeding with generation...");
      
      // ========================================================================
      // Phase 1: Web Scraping or PDF Parsing (Critical, Sequential)
      // Must complete first as all other agents depend on rawData
      // ========================================================================
      onProgress?.(isPdf ? "parsing_pdf" : "scraping", 10);
      this.monitor.startAgent('WebScraperAgent');
      if (taskId) progressTracker.startPhase(taskId, 'web_scraper');
      
      // Check for cached scrape result first (skip if forceRegenerate)
      let rawData;
      const cachedScrape = forceRegenerate ? null : await generationCache.getScrapeResult(url);
      if (cachedScrape) {
        console.log("[MasterAgent] 🎯 Scrape cache HIT!");
        rawData = cachedScrape;
        this.monitor.completeAgent('WebScraperAgent', { success: true, data: cachedScrape });
      } else if (isPdf) {
        // PDF mode: use PdfParserAgent with progress tracking
        console.log("[MasterAgent] 📄 PDF mode: parsing PDF...");
        const { parsePdf } = await import("./pdfParserAgent");
        
        // Parse PDF with progress callback
        const pdfData = await parsePdf(url, async (progress) => {
          // Report progress to worker
          if (onProgress) {
            await onProgress(
              `pdf_parsing_batch_${progress.current}`,
              10 + Math.round(((progress.percentage ?? 0) / 100) * 20) // 10-30% of total progress
            );
          }
          console.log(`[MasterAgent] PDF parsing progress: ${progress.percentage ?? 0}% - ${progress.message}`);
        });
        
        // Convert to WebScraperAgent compatible format
        const pdfResult = {
          success: true,
          data: {
            basicInfo: {
              title: pdfData.title || '未命名行程',
              subtitle: pdfData.subtitle || '',
              description: pdfData.subtitle || '',
              productCode: pdfData.productCode || '',
            },
            location: {
              destinationCountry: pdfData.country || '台灣',
              destinationCity: pdfData.destinations?.join(', ') || '',
            },
            duration: {
              days: pdfData.duration || 1,
              nights: pdfData.duration > 1 ? pdfData.duration - 1 : 0,
            },
            pricing: {
              price: pdfData.price || 0,
              basePrice: pdfData.price || 0,
              currency: 'TWD',
              priceNote: pdfData.priceNote || '',
            },
            highlights: pdfData.highlights || [],
            dailyItinerary: (pdfData.dailyItinerary || []).map((day: any) => ({
              day: day.day,
              title: day.title || `第 ${day.day} 天`,
              activities: (day.activities || []).map((act: any) => ({
                time: act.time || '',
                title: act.title || '',
                description: act.description || '',
                location: act.location || '',
                transportation: act.transportation || '',
              })),
              meals: {
                breakfast: day.meals?.breakfast || '',
                lunch: day.meals?.lunch || '',
                dinner: day.meals?.dinner || '',
              },
              accommodation: day.hotel || '',
            })),
            includes: pdfData.costDetails?.included || [],
            excludes: pdfData.costDetails?.excluded || [],
            accommodation: (pdfData.hotelInfo || []).map((hotel: any) => hotel.name),
            hotels: (pdfData.hotelInfo || []).map((hotel: any) => ({
              name: hotel.name || '',
              description: hotel.description || '',
              imageUrl: hotel.imageUrl || '',
            })),
            meals: [],
            flights: [],
            notices: pdfData.notices?.beforeTrip || [],
            images: pdfData.images || [],
            rawContent: pdfData.rawContent,
            sourceUrl: url,
            isPdfSource: true,
          },
        };
        
        if (!pdfResult.success || !pdfResult.data) {
          this.monitor.failAgent('WebScraperAgent', new Error("PDF parsing failed"));
          throw new Error("PDF parsing failed");
        }
        
        this.monitor.completeAgent('WebScraperAgent', pdfResult);
        rawData = pdfResult.data;
        
        // Cache the PDF parse result (1 day TTL)
        await generationCache.cacheScrapeResult(url, rawData);
      } else {
        // URL scraping removed - only PDF input is supported
        throw new Error("URL 爬蟲功能已移除，請使用 PDF 上傳");
      }
      
      if (taskId) progressTracker.completePhase(taskId, 'web_scraper');
      console.log("[MasterAgent] ✓ Phase 1 completed: Web scraping");
      
      // ========================================================================
      // Phase 2: Content Analysis + Lion Title (Critical, Sequential)
      // Must complete before image prompts can be generated
      // ========================================================================
      onProgress?.("analyzing", 25);
      this.monitor.startAgent('ContentAnalyzerAgent');
      if (taskId) progressTracker.startPhase(taskId, 'content_analyzer');
      
      // Run Content Analysis (includes poeticTitle generation)
      const analysisResult = await this.retryManager.executeWithRetry(
        () => this.contentAnalyzerAgent.execute(rawData),
        this.retryConfig,
        'ContentAnalyzerAgent'
      );
      
      if (!analysisResult.success || !analysisResult.data) {
        this.monitor.failAgent('ContentAnalyzerAgent', new Error(analysisResult.error || "Content analysis failed"));
        throw new Error(analysisResult.error || "Content analysis failed");
      }
      
      this.monitor.completeAgent('ContentAnalyzerAgent', analysisResult);
      if (taskId) progressTracker.completePhase(taskId, 'content_analyzer');
      const analyzedContent = analysisResult.data;
      // 記錄 ContentAnalyzerAgent 詳細工作
      try {
        const analyzerActivityId = await logAgentStart({
          agentName: 'ContentAnalyzerAgent',
          agentKey: 'analyzer',
          taskType: 'tour_generation',
          taskId: taskId,
          taskTitle: `分析行程內容：${rawData.basicInfo?.title || rawData.location?.destinationCity || '未知目的地'}`,
          userId,
        });
        if (analyzerActivityId) await logAgentComplete(analyzerActivityId, {
          status: 'completed',
          resultSummary: `✅ 分析完成「${analyzedContent.poeticTitle || rawData.basicInfo?.title || ''}」→ 目的地：${rawData.location?.destinationCity || ''}${rawData.location?.destinationCountry ? ` · ${rawData.location.destinationCountry}` : ''}，亮點 ${analyzedContent.highlights?.length || 0} 項，原創性分數 ${analyzedContent.originalityScore || 'N/A'}`,
        });
      } catch (logErr) { console.warn('[MasterAgent] Failed to log ContentAnalyzerAgent activity:', logErr); }
      
      // 漸進式結果：更新標題和目的地
      if (taskId) {
        progressTracker.updatePartialResults(taskId, {
          title: analyzedContent.poeticTitle,
          poeticTitle: analyzedContent.poeticTitle,
          destination: `${rawData.location?.destinationCity || ''}, ${rawData.location?.destinationCountry || ''}`,
          highlights: analyzedContent.highlights?.slice(0, 3),
        });
      }
      
      console.log("[MasterAgent] ✓ Phase 2 completed: Content analysis + Lion title");
      console.log("[MasterAgent] Originality score:", analyzedContent.originalityScore);
      console.log("[MasterAgent] Poetic title:", analyzedContent.poeticTitle);
      
      // ========================================================================
      // Phase 3: ColorTheme ONLY (ImagePrompt removed for speed optimization)
      // Image generation is skipped - editors will manage images manually
      // ========================================================================
      onProgress?.("generating_themes", 40);
      console.log("[MasterAgent] Starting Phase 3: ColorTheme only (image generation disabled)");
      
      this.monitor.startAgent('ColorThemeAgent');
      if (taskId) {
        progressTracker.startPhase(taskId, 'color_theme');
        // Skip image_prompt phase - mark as complete immediately
        progressTracker.startPhase(taskId, 'image_prompt');
        progressTracker.completePhase(taskId, 'image_prompt');
      }
      
      // Check for cached color palette first (skip if forceRegenerate)
      const destination = rawData.location?.destinationCity || rawData.location?.destinationCountry || "";
      let colorTheme;
      const cachedPalette = forceRegenerate ? null : await generationCache.getColorPalette(destination);
      
      // Run ColorTheme only
      const colorThemeResult = cachedPalette 
        ? { success: true, data: cachedPalette }
        : await this.retryManager.executeWithRetry(
            () => this.colorThemeAgent.execute(
              rawData.location?.destinationCountry || "",
              rawData.location?.destinationCity
            ),
            this.retryConfig,
            'ColorThemeAgent'
          );
      
      // Handle ColorThemeAgent result
      if (!colorThemeResult.success || !colorThemeResult.data) {
        const errorMsg = (colorThemeResult as any).error || "Color theme generation failed";
        this.monitor.failAgent('ColorThemeAgent', new Error(errorMsg));
        throw new Error(errorMsg);
      }
      
      if (cachedPalette) {
        console.log("[MasterAgent] 🎯 Color palette cache HIT!");
      } else {
        // Cache the color palette (7 days TTL)
        await generationCache.cacheColorPalette(destination, colorThemeResult.data);
      }
      
      this.monitor.completeAgent('ColorThemeAgent', colorThemeResult);
      if (taskId) progressTracker.completePhase(taskId, 'color_theme');
      colorTheme = colorThemeResult.data;
      // 記錄 ColorThemeAgent 詳細工作
      try {
        const colorActivityId = await logAgentStart({
          agentName: 'ColorThemeAgent',
          agentKey: 'colordesk',
          taskType: 'tour_generation',
          taskId: taskId,
          taskTitle: `生成配色方案：${destination || '未知目的地'}`,
          userId,
        });
        if (colorActivityId) await logAgentComplete(colorActivityId, {
          status: 'completed',
          resultSummary: `🎨 ${cachedPalette ? '（快取命中）' : ''}為「${destination}」生成配色方案，主色 ${colorTheme?.primary || 'N/A'}，輔色 ${colorTheme?.secondary || 'N/A'}`,
        });
      } catch (logErr) { console.warn('[MasterAgent] Failed to log ColorThemeAgent activity:', logErr); }
      
      // 漸進式結果：更新配色方案
      if (taskId) {
        progressTracker.updatePartialResults(taskId, {
          colorTheme: colorTheme,
        });
      }
      
      // Skip ImagePromptAgent - editors will manage images
      console.log("[MasterAgent] Skipping ImagePromptAgent - editors will manage images");
      
      console.log("[MasterAgent] ✓ Phase 3 completed: ColorTheme only");
      
      // ========================================================================
      // Phase 4: PARALLEL EXECUTION (6 agents - Image generation removed)
      // Itinerary + 5 Detail Agents running in parallel
      // ========================================================================
      onProgress?.("generating_content", 55);
      console.log("[MasterAgent] Starting Phase 4: PARALLEL (6 agents - no image generation)");
      console.log("[MasterAgent] Running: Itinerary, Cost, Notice, Hotel, Meal, Flight");
      
      // Image intelligence pipeline: PDF-extracted images → Unsplash fallback
      console.log("[MasterAgent] Starting image intelligence pipeline");
      let imageResults: { hero: { url: string; alt: string } | null; features: Array<{ url: string; alt: string; source: string }> } = { hero: null, features: [] };
      try {
        const { findBestImage } = await import('../services/imageIntelligenceService');
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
        for (const highlight of (rawData.highlights || []).slice(0, 6)) {
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
        console.warn('[MasterAgent] Image pipeline failed, continuing with defaults:', imgPipelineError);
      }

      // ── Vision Analysis + Smart Match ────────────────────────────────────────
      // Analyze all collected images with Claude Vision, then smart-match to targets
      let visionAnalyses: Array<import('../services/visionAnalysisService').VisionAnalysisResult> = [];
      let smartMatchMap: Map<string, string> = new Map();
      try {
        const { analyzeAndTagImages, smartMatchImages } = await import('../services/imageIntelligenceService');
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
        console.warn('[MasterAgent] Vision analysis failed, continuing:', visionErr);
      }
      // ── End Vision Analysis ──────────────────────────────────────────────────

      // Start all agents (except ImageGenerationAgent and ItineraryAgent which runs separately)
      // DetailsSkill replaces CostAgent, NoticeAgent, HotelAgent, MealAgent
      this.monitor.startAgent('DetailsSkill');
      this.monitor.startAgent('TransportationAgent');
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
      
      // Execute Itinerary (Unified: Extract + Polish in single LLM call)
      // ItineraryUnifiedAgent replaces ItineraryExtractAgent + ItineraryPolishAgent
      let itineraryData = "";
      let tourType: TourType = 'GENERAL'; // 預設行程類型
      try {
        this.monitor.startAgent('ItineraryUnifiedAgent');
        if (taskId) progressTracker.startPhase(taskId, 'itinerary');
        
        const unifiedResult = await this.itineraryUnifiedAgent.execute(rawData);
        
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
          const { assignItineraryImages } = await import("../services/itineraryImageService");
          const itinerariesWithImages = await assignItineraryImages(
            polishedItineraries,
            { country: rawData?.location?.destinationCountry, city: rawData?.location?.destinationCity }
          );
          
          itineraryData = JSON.stringify(itinerariesWithImages);
          this.monitor.completeAgent('ItineraryUnifiedAgent', unifiedResult);
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
      } catch (error) {
        console.error("[MasterAgent] Itinerary generation error:", error);
        if (taskId) progressTracker.failPhase(taskId, 'itinerary', error instanceof Error ? error.message : 'Unknown error');
        itineraryData = JSON.stringify([]);
      }
      
      // P3: Check Details cache before LLM call
      const detailsCacheKey = rawData.location?.destinationCity || rawData.location?.destinationCountry || "unknown";
      const cachedDetails = await generationCache.getDetailsResult(detailsCacheKey);
      
      // Execute DetailsSkill (replaces CostAgent, NoticeAgent, HotelAgent, MealAgent)
      // and TransportationAgent in parallel
      const [detailsSkillResult, transportationResult] = await Promise.allSettled([
        // DetailsSkill - P1 optimized: single LLM call for all 4 sub-skills
        // P3: Skip LLM if cache hit
        cachedDetails
          ? Promise.resolve(cachedDetails)
          : this.retryManager.executeWithRetry(
              () => this.detailsSkill.executeAllCombined(rawData),
              this.retryConfig,
              'DetailsSkill'
            ),
        // Transportation Agent - 根據行程類型選擇交通方式
        this.retryManager.executeWithRetry(
          () => this.transportationAgent.execute(rawData, tourType),
          this.retryConfig,
          'TransportationAgent'
        )
      ]);
      
      if (cachedDetails) {
        console.log(`[MasterAgent] 🎯 DetailsSkill cache hit for: ${detailsCacheKey} - skipped LLM call`);
      }
      
      // Hero Image: use image pipeline result first, then Unsplash as fallback
      let heroImage = imageResults.hero || { url: "", alt: "" };
      let highlightImages: any[] = [];
      // Feature images from image pipeline (already populated above)
      let featureImages: any[] = imageResults.features;

      if (!heroImage.url) {
        // Unsplash fallback for hero image
        try {
          const { searchUnsplashPhotos } = await import("../services/unsplashService");
          const destination = rawData.location?.destinationCity || rawData.location?.destinationCountry || "travel";
          console.log(`[MasterAgent] Hero not found in pipeline, falling back to Unsplash for: ${destination}`);
          
          const heroImages = await searchUnsplashPhotos(destination, 1);
          if (heroImages.length > 0) {
            heroImage = {
              url: heroImages[0],
              alt: `${destination} travel destination`
            };
            console.log(`[MasterAgent] ✓ Found hero image from Unsplash: ${heroImage.url.substring(0, 50)}...`);
          } else {
            console.log(`[MasterAgent] No hero image found, will use default`);
          }
        } catch (error) {
          console.warn(`[MasterAgent] Failed to search hero image:`, error);
        }
      } else {
        console.log(`[MasterAgent] ✓ Using image pipeline hero: ${heroImage.url.substring(0, 50)}...`);
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
          this.monitor.completeAgent('DetailsSkill', result);
          if (taskId) {
            progressTracker.completePhase(taskId, 'cost_agent');
            progressTracker.completePhase(taskId, 'notice_agent');
            progressTracker.completePhase(taskId, 'hotel_agent');
            progressTracker.completePhase(taskId, 'meal_agent');
          }
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
          costData = this.fallbackManager.handleFailure('CostAgent', new Error('DetailsSkill failed'));
          noticeData = this.fallbackManager.handleFailure('NoticeAgent', new Error('DetailsSkill failed'));
          hotelData = this.fallbackManager.handleFailure('HotelAgent', new Error('DetailsSkill failed'));
          mealData = this.fallbackManager.handleFailure('MealAgent', new Error('DetailsSkill failed'));
        }
      } else {
        const error = detailsSkillResult.reason;
        console.warn(`[MasterAgent] ⚠ DetailsSkill failed:`, error);
        this.monitor.failAgent('DetailsSkill', error);
        if (taskId) {
          progressTracker.failPhase(taskId, 'cost_agent', error?.message || 'DetailsSkill failed');
          progressTracker.failPhase(taskId, 'notice_agent', error?.message || 'DetailsSkill failed');
          progressTracker.failPhase(taskId, 'hotel_agent', error?.message || 'DetailsSkill failed');
          progressTracker.failPhase(taskId, 'meal_agent', error?.message || 'DetailsSkill failed');
        }
        costData = this.fallbackManager.handleFailure('CostAgent', error);
        noticeData = this.fallbackManager.handleFailure('NoticeAgent', error);
        hotelData = this.fallbackManager.handleFailure('HotelAgent', error);
        mealData = this.fallbackManager.handleFailure('MealAgent', error);
      }
      
      // Handle TransportationAgent result
      if (transportationResult.status === 'fulfilled') {
        const result = transportationResult.value as any;
        if (result.success && result.data) {
          transportationData = result.data;
          this.monitor.completeAgent('TransportationAgent', result);
          if (taskId) progressTracker.completePhase(taskId, 'flight_agent');
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
          transportationData = this.fallbackManager.handleFailure('TransportationAgent', new Error(result?.error || 'TransportationAgent failed'));
        }
      } else {
        const error = transportationResult.reason;
        this.monitor.failAgent('TransportationAgent', error);
        if (taskId) progressTracker.failPhase(taskId, 'flight_agent', error?.message || 'TransportationAgent failed');
        console.warn(`[MasterAgent] ⚠ TransportationAgent failed, using fallback`);
        transportationData = this.fallbackManager.handleFailure('TransportationAgent', error);
      }
      
      console.log("[MasterAgent] ✓ Phase 4 completed: PARALLEL (6 agents - no image generation)");
      
      // Extract feature image URLs
      const featureImageUrls = featureImages.map(img => img.url).filter(url => url !== "");
      
      // ========================================================================
      // Phase 5: Assemble Final Data
      // ========================================================================
      onProgress?.("assembling", 90);
      if (taskId) progressTracker.startPhase(taskId, 'finalize');
      
      // 生成智能標籤
      const smartTags = generateSmartTags(
        {
          days: rawData.duration?.days,
          nights: rawData.duration?.nights,
          price: rawData.pricing?.price,
          title: analyzedContent.title || rawData.basicInfo?.title,
          description: analyzedContent.description || rawData.basicInfo?.description,
          destinationCountry: rawData.location?.destinationCountry,
          destinationCity: rawData.location?.destinationCity,
          highlights: rawData.highlights,
          transportation: transportationData?.typeName,
          category: rawData.basicInfo?.category,
        },
        tourType as TourType
      );
      
      // 應用學習系統的技能生成額外標籤
      // Phase 59 更新：優先使用 ContentAnalyzerAgent 生成的 smartTags
      let learnedTags: string[] = [];
      let appliedSkillNames: string[] = [];
      onProgress?.('applying_skills', 85);
      
      // 優先使用 ContentAnalyzerAgent 已生成的 smartTags
      if (analyzedContent.smartTags && analyzedContent.smartTags.labels.length > 0) {
        learnedTags = analyzedContent.smartTags.labels;
        appliedSkillNames = analyzedContent.smartTags.labels;
        console.log(`[MasterAgent] Using ContentAnalyzerAgent smartTags: ${learnedTags.join(', ')}`);
        console.log(`[MasterAgent] Applied ${analyzedContent.smartTags.appliedSkills.length} skills from ContentAnalyzerAgent`);
        
        // 詳細輸出分類資訊
        if (analyzedContent.smartTags.featureClassification?.length) {
          console.log(`[MasterAgent] Feature Classification: ${analyzedContent.smartTags.featureClassification.join(', ')}`);
        }
        if (analyzedContent.smartTags.transportationType?.length) {
          console.log(`[MasterAgent] Transportation Type: ${analyzedContent.smartTags.transportationType.join(', ')}`);
        }
        if (analyzedContent.smartTags.highlightActivities?.length) {
          console.log(`[MasterAgent] Highlight Activities: ${analyzedContent.smartTags.highlightActivities.join(', ')}`);
        }
        if (analyzedContent.smartTags.accommodationType?.length) {
          console.log(`[MasterAgent] Accommodation Type: ${analyzedContent.smartTags.accommodationType.join(', ')}`);
        }
        
        onProgress?.('learning_new_skills', 88);
      } else {
        // Fallback: 如果 ContentAnalyzerAgent 沒有生成 smartTags，才手動調用 applyLearnedSkills
        try {
          const contentForSkills = [
            analyzedContent.title,
            analyzedContent.description,
            rawData.basicInfo?.title,
            rawData.basicInfo?.description,
            ...(rawData.highlights || []),
          ].filter(Boolean).join(' ');
          
          const skillResult = await applyLearnedSkills(contentForSkills, {
            duration: rawData.duration?.days,
            price: rawData.pricing?.price,
          });
          learnedTags = skillResult.labels;
          appliedSkillNames = skillResult.labels;
          if (learnedTags.length > 0) {
            console.log(`[MasterAgent] Applied ${skillResult.appliedSkills.length} learned skills (fallback), generated tags: ${learnedTags.join(', ')}`);
            onProgress?.('learning_new_skills', 88);
          }
        } catch (error) {
          console.warn(`[MasterAgent] Failed to apply learned skills:`, error);
        }
      }
      
      // 合併現有標籤、智能標籤和學習標籤
      const allTags = [...smartTags, ...learnedTags];
      const finalTags = mergeWithExistingTags(rawData.basicInfo?.tags, allTags);
      console.log(`[MasterAgent] Generated smart tags: ${finalTags.join(', ')}`);
      
      const finalData = {
        // Basic info
        poeticTitle: analyzedContent.poeticTitle, // Use ContentAnalyzerAgent's poetic title
        title: analyzedContent.title,
        description: analyzedContent.description,
        productCode: rawData.basicInfo?.productCode || "",
        tags: finalTags,
        
        // Location
        destinationCountry: rawData.location?.destinationCountry || "",
        destinationCity: rawData.location?.destinationCity || "",
        departureCity: rawData.location?.departureCity || "",
        
        // Duration
        days: rawData.duration?.days || 0,
        nights: rawData.duration?.nights || 0,
        
        // Pricing
        price: rawData.pricing?.price || 0,
        
        // Hero section
        heroImage: heroImage.url,
        heroImageAlt: heroImage.alt,
        heroSubtitle: analyzedContent.heroSubtitle,
        
        // Color theme
        colorTheme: JSON.stringify(colorTheme),
        
        // Highlights
        highlights: JSON.stringify(analyzedContent.highlights),
        
        // Key Features (required field)
        keyFeatures: JSON.stringify(analyzedContent.highlights || []),
        
        // Feature Images
        featureImages: JSON.stringify(featureImageUrls),
        
        // Poetic content
        poeticContent: JSON.stringify(analyzedContent.poeticContent),
        
        // Detailed Itinerary
        itineraryDetailed: itineraryData,
        
        // Cost Explanation
        costExplanation: JSON.stringify(costData),
        
        // Detailed Notice
        noticeDetailed: JSON.stringify(noticeData),
        
        // Hotels (hotelData is already an array from DetailsSkill)
        hotels: JSON.stringify(Array.isArray(hotelData) ? hotelData : (hotelData?.hotels || [])),
        
        // Meals (mealData is already an array from DetailsSkill)
        meals: JSON.stringify(Array.isArray(mealData) ? mealData : (mealData?.meals || [])),
        
        // Transportation (交通資訊 - 只有飛機行程才生成)
        // 火車、巴士等行程的交通資訊已整合到每日行程中
        flights: (transportationData?.type === 'FLIGHT' || !transportationData?.type) 
          ? JSON.stringify(transportationData) 
          : JSON.stringify({ type: transportationData?.type, typeName: transportationData?.typeName }),
        
        // Metadata
        originalityScore: analyzedContent.originalityScore,
        sourceUrl: url,
      };
      
      // ========================================================================
      // 6c. Write used images to imageLibrary for future reuse
      // ========================================================================
      try {
        const { addToImageLibrary } = await import('../db');
        const tourTitle = finalData.title || finalData.poeticTitle || '';
        const imgLibDestination = finalData.destinationCity || finalData.destinationCountry || '';
        const allImageUrls: string[] = [
          heroImage?.url,
          ...featureImages.map((f: any) => f.url),
        ].filter((u): u is string => Boolean(u));

        for (const imgUrl of allImageUrls) {
          try {
            await addToImageLibrary({
              url: imgUrl,
              tags: JSON.stringify([imgLibDestination, tourTitle].filter(Boolean)),
              uploadedBy: userId || 0,
            });
          } catch {
            // Ignore duplicates or DB errors – image library is non-critical
          }
        }
        if (allImageUrls.length > 0) {
          console.log(`[MasterAgent] ✓ Saved ${allImageUrls.length} image(s) to imageLibrary`);
        }
      } catch (libErr) {
        console.warn('[MasterAgent] imageLibrary write failed (non-fatal):', libErr);
      }

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
      
      // 記錄 MasterAgent 完成
      if (activityId) {
        const processingTimeMs = Date.now() - startTime;
        const title = finalData.title || finalData.poeticTitle || '未命名行程';
        const dest = finalData.destinationCity || finalData.destinationCountry || '';
        await logAgentComplete(activityId, {
          status: 'completed',
          processingTimeMs,
          resultSummary: `已完成行程生成：「${title}${dest ? ` · ${dest}` : ''}」，耗時 ${(processingTimeMs / 1000).toFixed(0)} 秒`,
        });
      }

      // 清理可能殘留的殭屍任務（5 分鐘未完成的 started 任務）
      cleanupZombieTasks(5).catch(() => {});

      return {
        success: true,
        data: finalData,
        executionReport
      };
      
    } catch (error) {
      console.error("[MasterAgent] ✗ Critical error:", error);
      
      const executionReport = this.monitor.generateReport();
      console.log(executionReport);
      
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

      // 失敗時也清理殭屍任務（sub-agent 可能已 logAgentStart 但未 logAgentComplete）
      cleanupZombieTasks(5).catch(() => {});
      
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        executionReport
      };
    }
  }
  
  /**
   * Rollback on error (cleanup resources)
   */
  async rollback(partialData: any): Promise<void> {
    console.log("[MasterAgent] Rolling back...");
    
    // TODO: Implement cleanup logic
    // - Delete uploaded images from S3
    // - Clean up database entries
    // - Log error details
    
    console.log("[MasterAgent] Rollback completed");
  }
}
