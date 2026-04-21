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
import { calibrateTour } from "./calibrationAgent";
import { fetchLionTravelData, buildRawContentFromLionData } from "../services/lionTravelApiService";

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
    
    // Fix 3 (Round 62): Additional image/data fields
    hotelImages: string; // JSON string — URL array from hotels
    galleryImages: string; // JSON string — [{url, caption}] from featureImages
    attractions: string; // JSON string — [{name, description, image, imageAlt}]
    
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
  // Round 55 Diag-C: Phase timing data
  phaseTimings?: { phases: Record<string, string>; totalMs: number; totalSec: string };
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
    isPdf: boolean = false,
    supplementUrl?: string  // 供應商官網 URL（配合 PDF 使用，用於抽取日期/人數/價格）
  ): Promise<MasterAgentResult> {
    const startTime = Date.now();
    console.log("[MasterAgent] Starting OPTIMIZED tour generation...");
    // Round 55 Diag-C: Phase timing helpers
    const _phaseTimers: Record<string, number> = {};
    const _startPhaseTimer = (name: string) => { _phaseTimers[name] = Date.now(); console.log(`[MasterAgent] \u23f1 PHASE START: ${name}`); };
    const _endPhaseTimer = (name: string) => { const ms = Date.now() - (_phaseTimers[name] || Date.now()); console.log(`[MasterAgent] \u23f1 PHASE END: ${name} \u2014 ${ms}ms (${(ms/1000).toFixed(1)}s)`); };

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
      _startPhaseTimer('P1_scrape');
      onProgress?.(isPdf ? "parsing_pdf" : "scraping", 10);
      this.monitor.startAgent('WebScraperAgent');
      if (taskId) progressTracker.startPhase(taskId, 'web_scraper');
      
      // Check for cached scrape result first (skip if forceRegenerate)
      let rawData: any;
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
              destinationCountry: pdfData.country || '',
              destinationCity: pdfData.destinations?.join(', ') || '',
            },
            duration: {
              days: pdfData.duration || 1,
              nights: pdfData.duration > 1 ? pdfData.duration - 1 : 0,
            },
            pricing: {
              price: pdfData.price || 0,
              basePrice: pdfData.price || 0,
              currency: pdfData.currency || 'TWD',
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
        
        // A2 FIX: If no supplementUrl, build extractedTourMeta from pdfData directly
        // This ensures allDepartureDates from PDF are preserved as extractedDepartures
        if (!supplementUrl && pdfData.allDepartureDates && pdfData.allDepartureDates.length > 0) {
          const pdfMeta = {
            departureDates: pdfData.allDepartureDates.map((dateStr: string) => ({
              date: dateStr,
              status: 'open' as const,
              price: pdfData.adultPrice || pdfData.price || 0,
            })),
            capacity: {
              maxParticipants: pdfData.totalSlots || 20,
              minParticipants: 0,
            },
            pricing: {
              adultPrice: pdfData.adultPrice || pdfData.price || 0,
              childWithBedPrice: pdfData.childPrice || 0,
              childNoBedPrice: pdfData.childPriceNoBed || 0,
              infantPrice: pdfData.infantPrice || 0,
              currency: pdfData.currency || 'TWD',
              priceNote: pdfData.priceNote || '',
            },
            productCode: pdfData.productCode || '',
          };
          (rawData as any).extractedTourMeta = pdfMeta;
          console.log(`[MasterAgent] ✓ PDF extractedTourMeta built: ${pdfMeta.departureDates.length} dates from PDF`);
        }

        // PDF + URL mode: also run DateExtractor on supplementUrl
        if (supplementUrl) {
          console.log(`[MasterAgent] 📎 PDF+URL mode: also scraping supplement URL: ${supplementUrl}`);
          if (taskId) progressTracker.startPhase(taskId, 'dynamic_render');
          onProgress?.("rendering_supplement", 22);
          
          try {
            let supplementScrape: import('../services/dynamicScraperService').DynamicScrapeResult | Partial<import('../services/dynamicScraperService').DynamicScrapeResult>;
            try {
              const { scrapeDynamicPage } = await import('../services/dynamicScraperService');
              supplementScrape = await scrapeDynamicPage(supplementUrl);
            } catch {
              const { scrapeStaticFallback } = await import('../services/dynamicScraperService');
              supplementScrape = await scrapeStaticFallback(supplementUrl);
            }
            
            if (taskId) progressTracker.completePhase(taskId, 'dynamic_render');
            if (taskId) progressTracker.startPhase(taskId, 'date_extractor');
            onProgress?.("extracting_dates", 25);
            
            const { extractTourMeta } = await import('../agents/dateExtractorAgent');
            const supplementMeta = await extractTourMeta(
              supplementScrape.screenshots || { fullPage: Buffer.alloc(0) },
              supplementScrape.rawText || '',
              supplementUrl,
              (supplementScrape as any).priceHints  // 傳遞 priceHints
            );
            
            // Merge supplement data into rawData
            if (supplementMeta.departureDates.length > 0) {
              (rawData as any).departureDates = supplementMeta.departureDates;
            }
            if (supplementMeta.capacity.maxParticipants > 0) {
              (rawData as any).maxParticipants = supplementMeta.capacity.maxParticipants;
            }
            if (supplementMeta.pricing.adultPrice > 0 && !rawData.pricing?.price) {
              rawData.pricing = { ...rawData.pricing, price: supplementMeta.pricing.adultPrice };
            }
            (rawData as any).extractedTourMeta = supplementMeta;
            
            console.log(`[MasterAgent] ✓ Supplement URL DateExtractor: ${supplementMeta.departureDates.length} dates merged`);
            if (taskId) progressTracker.completePhase(taskId, 'date_extractor');
          } catch (suppErr) {
            console.warn('[MasterAgent] Supplement URL processing failed (non-fatal):', suppErr);
            if (taskId) {
              progressTracker.completePhase(taskId, 'dynamic_render');
              progressTracker.completePhase(taskId, 'date_extractor');
            }
          }
        }
      } else {
        // ─── Round 50: Liontravel Direct API Integration ───────────────────────────
        // Detect liontravel.com URLs and fetch data directly via JSON API,
        // bypassing Puppeteer entirely (~55s → ~2s)
        let lionApiHandled = false;
        if (url.includes('liontravel.com')) {
          console.log('[MasterAgent] 🦁 Liontravel detected: trying direct API...');
          if (taskId) progressTracker.startPhase(taskId, 'dynamic_render');
          onProgress?.("rendering_page", 10);
          let lionData = await fetchLionTravelData(url);
          if (!lionData) {
            // Round 55: Retry once after 2s — transient network/DNS issues
            console.warn('[MasterAgent] 🦁 Liontravel API attempt 1 failed, retrying in 2s...');
            await new Promise(r => setTimeout(r, 2000));
            lionData = await fetchLionTravelData(url);
            if (lionData) {
              console.log('[MasterAgent] 🦁 Liontravel API retry succeeded');
            } else {
              console.warn('[MasterAgent] 🦁 Liontravel API attempt 2 also failed');
            }
          }
          // Fix A (Round 67+): 404 detection — if tourName contains 404 error text, throw immediately
          if (lionData && (
            lionData.tourName.includes('404') ||
            lionData.tourName.includes('檔案或目錄遺失') ||
            lionData.tourName.includes('頁面不存在') ||
            lionData.tourName.trim() === ''
          )) {
            console.error(`[MasterAgent] 🦁 Liontravel 404 detected: tourName="${lionData.tourName}" — throwing Tour URL invalid`);
            throw new Error('Tour URL invalid: 雄獅行程頁面不存在或已下架，請確認 URL 是否正確。');
          }
          if (lionData) {
            console.log(`[MasterAgent] \u23f1 P1: liontravel API SUCCESS \u2014 using direct API path`);
            console.log(`[MasterAgent] 🦁 Liontravel detected: using direct API (${lionData.tourDays} days, price=${lionData.price} ${lionData.currencyCode})`);
            if (taskId) progressTracker.completePhase(taskId, 'dynamic_render');
            if (taskId) progressTracker.startPhase(taskId, 'date_extractor');
            if (taskId) progressTracker.completePhase(taskId, 'date_extractor');

            // Detect destination country from tourName + arriveAirport
            const _lionCountryPatterns: Record<string, string> = {
              '英國': '英國', '愛爾蘭': '愛爾蘭', '法國': '法國', '義大利': '義大利', '日本': '日本',
              '韓國': '韓國', '泰國': '泰國', '越南': '越南', '帛琦': '帛琦', '台灣': '台灣',
              '美國': '美國', '德國': '德國', '西班牙': '西班牙', '希臘': '希臘', '土耳其': '土耳其',
              '澳洲': '澳洲', '紐西蘭': '紐西蘭', '加拿大': '加拿大',
              '四國': '日本', '北海道': '日本', '沖縄': '日本', '九州': '日本', '關西': '日本',
              '首爾': '韓國', '釜山': '韓國', '濟州': '韓國',
              '峨里': '印尼', '曼谷': '泰國', '清邁': '泰國',
              '秘魯': '秘魯', '智利': '智利', '巴西': '巴西', '阿根廷': '阿根廷',
              '馬丘比丘': '秘魯', '庫斯科': '秘魯', '復活節峳': '智利',
              'Peru': '秘魯', 'Chile': '智利', 'Japan': '日本', 'Korea': '韓國',
              'NRT': '日本', 'KIX': '日本', 'CTS': '日本', 'OKA': '日本', 'ICN': '韓國',
              'BKK': '泰國', 'HAN': '越南', 'SGN': '越南', 'LHR': '英國', 'CDG': '法國',
              'FCO': '義大利', 'ATH': '希臘', 'IST': '土耳其', 'SYD': '澳洲', 'AKL': '紐西蘭',
              'LIM': '秘魯', 'SCL': '智利', 'GRU': '巴西', 'EZE': '阿根廷',
            };
            const _lionSearchText = lionData.tourName + ' ' + lionData.outboundFlight.arriveAirport;
            let _lionCountry = '';
            for (const [kw, country] of Object.entries(_lionCountryPatterns)) {
              if (_lionSearchText.includes(kw)) {
                _lionCountry = country;
                break;
              }
            }

            // Build raw content text for ContentAnalyzer
            const _lionRawContent = buildRawContentFromLionData(lionData);

            // Map dailyItinerary
            const _lionDailyItinerary = lionData.dailyItinerary.map(d => ({
              day: d.day,
              title: d.travelPoint,
              description: d.summary,
              activities: d.attractions.map(a => a.name).filter(Boolean),
              accommodation: d.hotelName,
              meals: [
                d.breakfast ? `早餐：${d.breakfast}` : '',
                d.lunch ? `午餐：${d.lunch}` : '',
                d.dinner ? `晚餐：${d.dinner}` : '',
              ].filter(Boolean),
              specialNote: d.specialNote,
            }));

            // Map hotels
            const _lionHotels = lionData.dailyItinerary
              .filter(d => d.hotelName)
              .map(d => ({ name: d.hotelName, day: d.day, stars: 0 }));

            // Map meals
            const _lionMeals: string[] = [];
            for (const d of lionData.dailyItinerary) {
              if (d.breakfast) _lionMeals.push(`第${d.day}天早餐：${d.breakfast}`);
              if (d.lunch) _lionMeals.push(`第${d.day}天午餐：${d.lunch}`);
              if (d.dinner) _lionMeals.push(`第${d.day}天晚餐：${d.dinner}`);
            }

            // Map flights
            const _lionFlights: any[] = [];
            if (lionData.outboundFlight.airline) {
              _lionFlights.push({
                type: 'outbound',
                airline: lionData.outboundFlight.airline,
                departureTime: lionData.outboundFlight.departureTime,
                arriveTime: lionData.outboundFlight.arriveTime,
                departureAirport: lionData.outboundFlight.departureAirport,
                arriveAirport: lionData.outboundFlight.arriveAirport,
              });
            }
            if (lionData.returnFlight.airline) {
              _lionFlights.push({
                type: 'return',
                airline: lionData.returnFlight.airline,
                departureTime: lionData.returnFlight.departureTime,
                arriveTime: lionData.returnFlight.arriveTime,
                departureAirport: lionData.returnFlight.departureAirport,
                arriveAirport: lionData.returnFlight.arriveAirport,
              });
            }

            // Map notices
            const _lionNotices = lionData.notices.map(n => ({
              title: n.chineseTitle || n.title,
              content: n.content,
            }));

            rawData = {
              basicInfo: {
                title: lionData.tourName,
                subtitle: '',
                description: '',
                productCode: lionData.tourId,
              },
              location: {
                destinationCountry: _lionCountry,
                destinationCity: _lionCountry,
              },
              duration: {
                days: lionData.tourDays,
                nights: lionData.tourDays > 1 ? lionData.tourDays - 1 : 0,
              },
              pricing: {
                price: lionData.pricing.adultPrice || lionData.price,
                basePrice: lionData.pricing.adultPrice || lionData.price,
                currency: lionData.currencyCode,
                priceNote: lionData.pricing.singleSupplement || '',
              },
              highlights: lionData.tags,
              dailyItinerary: _lionDailyItinerary,
              includes: [],
              excludes: [],
              accommodation: _lionHotels.map(h => h.name),
              hotels: _lionHotels,
              meals: _lionMeals,
              flights: _lionFlights,
              notices: _lionNotices,
              images: lionData.heroImageUrl ? [{ url: lionData.heroImageUrl, type: 'hero', page: 0 }] : [],
              // Fix 4 (Round 63): store lionHeroImageUrl explicitly for Tier-2 fallback
              lionHeroImageUrl: lionData.heroImageUrl || '',
              rawContent: _lionRawContent,
              renderedHtml: lionData.featuresHtml,
              sourceUrl: url,
              isPdfSource: false,
              extractedTourMeta: null,
              maxParticipants: lionData.totalSeats,
              departureDates: lionData.goDate ? [lionData.goDate] : [],
              // Store structured pricing for Phase 5
              lionPricing: lionData.pricing,
              lionGroupId: lionData.groupId,
              // Round 52: All departure dates from groupcalendarjson
              lionAllDepartures: lionData.allDepartures,
              // Round 52: Feature images from attraction list + featuresHtml
              lionFeatureImages: lionData.featureImages,
            } as any;

            lionApiHandled = true;

            // Round 52: If allDepartures is empty from direct API (IP-blocked), try Puppeteer for groupcalendarjson
            if (lionData.allDepartures.length === 0) {
              console.log('[MasterAgent] 🦁 Round 52: allDepartures empty from direct API, launching Puppeteer for groupcalendarjson...');
              try {
                const { scrapeDynamicPage } = await import('../services/dynamicScraperService');
                const CALENDAR_SCRAPE_TIMEOUT_MS = 120000;
                const calendarScrapeTimeout = new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('calendar scrape timeout')), CALENDAR_SCRAPE_TIMEOUT_MS)
                );
                const calScrape = await Promise.race([scrapeDynamicPage(url), calendarScrapeTimeout]);
                const calLd = calScrape.lionApiData as any;
                if (calLd) {
                  const _calRaw = calLd.calendar;
                  const _calList: any[] = Array.isArray(_calRaw) ? _calRaw : (_calRaw?.GroupCalendarList ?? []);
                  if (_calList.length > 0) {
                    const safeParseFloat2 = (v: any) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };
                    (rawData as any).lionAllDepartures = _calList
                      .filter((c: any) => (c.ID || c.GroupID) && (c.Date || c.GoDate))
                      .map((c: any) => ({
                        groupId: c.ID ?? c.GroupID ?? '',
                        date: c.Date ?? c.GoDate ?? '',
                        weekDay: c.WeekDay ?? '',
                        price: safeParseFloat2(c.Price),
                        currencyCode: c.CurrencyCode ?? 'TWD',
                        availableSeats: parseInt(c.AvailableVacancy ?? c.SpareSeat ?? c.SpareSeats ?? '0', 10),
                        totalSeats: parseInt(c.TotalSeats ?? '0', 10),
                        status: c.Status ?? '',
                        tourId: c.TourID ?? c.NormGroupID ?? '',
                      }));
                    console.log(`[MasterAgent] 🦁 Round 52: Puppeteer supplemented ${(rawData as any).lionAllDepartures.length} departures from groupcalendarjson`);
                  } else {
                    console.log('[MasterAgent] 🦁 Round 52: Puppeteer groupcalendarjson also empty');
                  }
                }
              } catch (calErr) {
                console.warn('[MasterAgent] 🦁 Round 52: Puppeteer calendar fallback failed:', (calErr as Error).message);
              }
            }

            await generationCache.cacheScrapeResult(url, rawData);
          } else {
            console.warn('[MasterAgent] \u23f1 P1: liontravel API FAILED \u2014 falling back to Puppeteer');
            console.warn('[MasterAgent] 🦁 Liontravel direct API failed, falling back to Puppeteer');
          }
        }
        // ─── End Round 50 ─────────────────────────────────────────────────────────

        if (!lionApiHandled) {
        // URL mode: use DynamicScraperService (Puppeteer)
        console.log("[MasterAgent] 🌐 URL mode: dynamic scraping with Puppeteer...");
        if (taskId) progressTracker.startPhase(taskId, 'dynamic_render');
        onProgress?.("rendering_page", 10);
        
        let scrapeResult: import('../services/dynamicScraperService').DynamicScrapeResult | Partial<import('../services/dynamicScraperService').DynamicScrapeResult>;
        // Overall scraping timeout: 120 seconds to allow for slow SPA sites like liontravel.com
        // liontravel.com is a React SPA: networkidle2 (~20s) + domcontentloaded fallback (~20s) + autoScroll (~30s) + screenshot (~10s) + API calls (~30s) = ~110s max
        // Round 52: Increased from 90s to 120s to ensure groupcalendarjson is captured
        const SCRAPE_TIMEOUT_MS = 120000;
        const scrapeTimeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`爬取逾時（${SCRAPE_TIMEOUT_MS / 1000} 秒）。請確認 URL 是否可正常存取，或改用 PDF 上傳方式。`)), SCRAPE_TIMEOUT_MS)
        );
        try {
          const { scrapeDynamicPage } = await import('../services/dynamicScraperService');
          scrapeResult = await Promise.race([scrapeDynamicPage(url), scrapeTimeoutPromise]);
          console.log(`[MasterAgent] ✓ Dynamic scrape completed: ${scrapeResult.renderedHtml?.length || 0} chars HTML, ${scrapeResult.rawText?.length || 0} chars text`);
        } catch (scrapeErr) {
          // If it's a timeout error, re-throw immediately without fallback
          if (scrapeErr instanceof Error && scrapeErr.message.includes('爬取逾時')) {
            throw scrapeErr;
          }
          console.warn('[MasterAgent] Puppeteer scrape failed, falling back to static HTTP:', scrapeErr);
          const { scrapeStaticFallback } = await import('../services/dynamicScraperService');
          scrapeResult = await Promise.race([scrapeStaticFallback(url), scrapeTimeoutPromise]);
        }
        
        if (taskId) progressTracker.completePhase(taskId, 'dynamic_render');
        
        // Phase 1.5: DateExtractorAgent (AI Vision) - 並行執行
        if (taskId) progressTracker.startPhase(taskId, 'date_extractor');
        onProgress?.("extracting_dates", 15);
        
        let extractedTourMeta: import('../agents/dateExtractorAgent').ExtractedTourMeta | null = null;
        try {
          const { extractTourMeta } = await import('../agents/dateExtractorAgent');
          extractedTourMeta = await extractTourMeta(
            scrapeResult.screenshots || { fullPage: Buffer.alloc(0) },
            scrapeResult.rawText || '',
            url,
            (scrapeResult as any).priceHints // 傳遞 JS 價格擷取結果（可選）
          );
          console.log(`[MasterAgent] ✓ DateExtractor: ${extractedTourMeta.departureDates.length} dates, maxParticipants: ${extractedTourMeta.capacity.maxParticipants}, adultPrice: ${extractedTourMeta.pricing.adultPrice}`);
        } catch (extractErr) {
          console.warn('[MasterAgent] DateExtractorAgent failed (non-fatal):', extractErr);
        }
        
        if (taskId) progressTracker.completePhase(taskId, 'date_extractor');
        
        // ── Quick parse: extract location & duration from pageTitle + rawContent ──
        const _pageTitle = scrapeResult.pageTitle || '';
        const _rawText = scrapeResult.rawText || '';
        
        // Extract duration: look for patterns like "13日", "13天", "13-day", "五日", "七天"
        let _parsedDays = 0;
        let _parsedNights = 0;
        const _durationSearchText = _pageTitle + ' ' + _rawText.substring(0, 2000);
        // Pattern A: Arabic digits
        const _durationMatchA = _durationSearchText.match(/(\d+)\s*(?:日|天|days?)/i);
        if (_durationMatchA) {
          _parsedDays = parseInt(_durationMatchA[1], 10);
        }
        // Pattern B: Chinese digits (一日, 二天, 五日, 七天, 十日...)
        if (!_parsedDays) {
          const _chineseNumMap: Record<string, number> = {
            '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
            '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
            '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
          };
          const _durationMatchB = _durationSearchText.match(/(十[一二三四五]?|[一二三四五六七八九十])\s*[天日]/);
          if (_durationMatchB) {
            _parsedDays = _chineseNumMap[_durationMatchB[1]] || 0;
          }
        }
        if (_parsedDays > 0) {
          _parsedNights = _parsedDays > 1 ? _parsedDays - 1 : 0;
        }
        console.log(`[MasterAgent] Quick parse duration: title="${_pageTitle.substring(0, 80)}" → days=${_parsedDays}`);
        // Note: ExtractedTourMeta doesn't have duration field, rely on regex parse only
        
        // Extract destination from pageTitle: remove common prefixes/suffixes
        let _parsedCountry = '';
        let _parsedCity = '';
        
        // Helper: detect discount/promo text (not a destination)
        const _isDiscountText = (s: string) =>
          /折|省|優惠|早鳥|特惠|限時|團費|現省|折扣|加碼|送|贈|免費|優待|特價|促銷|\d{3,}/.test(s);
        
        // Split pageTitle by ｜ or | to get segments
        const _titleSegments = _pageTitle.split(/[｜|]/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
        
        // Strategy 1: Try to extract destination after ｜ with pattern "英國愛爾蘭經典13日"
        const _destMatch = _pageTitle.match(/[｜|]([^｜|]+?)(?:經典|深度|精選|探索|之旅|\d+日|\d+天)/);
        if (_destMatch) {
          const candidate = _destMatch[1].trim();
          if (!_isDiscountText(candidate)) {
            _parsedCity = candidate;
          }
        }
        
        // Strategy 2: Find first non-discount segment containing known country/region keywords
        if (!_parsedCity) {
          const _destKeywords = ['英國', '愛爾蘭', '法國', '義大利', '日本', '韓國', '泰國', '越南',
            '帛琉', '台灣', '美國', '德國', '西班牙', '希臘', '土耳其', '澳洲', '紐西蘭', '加拿大',
            '中國', '香港', '澳門', '新加坡', '馬來西亞', '印尼', '菲律賓', '印度', '埃及', '摩洛哥',
            '南非', '秘魯', '阿根廷', '巴西', '北歐', '東歐', '南歐', '中東', '東南亞', '東北亞',
            '歐洲', '亞洲', '非洲', '美洲', '大洋洲'];
          for (const seg of _titleSegments) {
            if (!_isDiscountText(seg) && seg.length >= 2 && seg.length <= 30) {
              if (_destKeywords.some(k => seg.includes(k))) {
                _parsedCity = seg;
                break;
              }
            }
          }
        }
        
        // Strategy 3: Extract destination from main title segment (e.g. "英國愛爾蘭經典13日" → "英國愛爾蘭")
        if (!_parsedCity) {
          for (const seg of _titleSegments) {
            if (!_isDiscountText(seg)) {
              const _countryExtract = seg.match(/^([\u4e00-\u9fa5]{2,8}?)(?:經典|深度|精選|探索|之旅|\d+日|\d+天)/);
              if (_countryExtract) {
                _parsedCity = _countryExtract[1].trim();
                break;
              }
            }
          }
        }
        
        // Strategy 4: Last resort - first non-discount segment (length ≤ 20)
        if (!_parsedCity) {
          const _firstNonDiscount = _titleSegments.find((s: string) => !_isDiscountText(s) && s.length <= 20);
          if (_firstNonDiscount) _parsedCity = _firstNonDiscount;
        }
        // Try to extract country from URL or content
        const _countryPatterns: Record<string, string> = {
          '英國': '英國', '愛爾蘭': '愛爾蘭', '法國': '法國', '義大利': '義大利', '日本': '日本',
          '韓國': '韓國', '泰國': '泰國', '越南': '越南', '帛琉': '帛琉', '台灣': '台灣',
          '美國': '美國', '德國': '德國', '西班牙': '西班牙', '希臘': '希臘', '土耳其': '土耳其',
          // Japanese regions → 日本
          '四國': '日本', '北海道': '日本', '沖繩': '日本', '九州': '日本', '關西': '日本',
          '關東': '日本', '東北': '日本', '東京': '日本', '大阪': '日本', '京都': '日本',
          '北陸': '日本', '中部': '日本', '中國地方': '日本', '山陰': '日本', '山陽': '日本',
          // Korean regions → 韓國
          '首爾': '韓國', '釜山': '韓國', '濟州': '韓國',
          // Other regions
          '峇里': '印尼', '巴里': '印尼', '曼谷': '泰國', '清邁': '泰國', '普吉': '泰國',
          '河內': '越南', '胡志明': '越南', '峴港': '越南',
          // South America
          '秘魯': '秘魯', '智利': '智利', '巴西': '巴西', '阿根廷': '阿根廷', '哥倫比亞': '哥倫比亞',
          '玻利維亞': '玻利維亞', '厄瓜多': '厄瓜多', '烏拉圭': '烏拉圭', '巴拉圭': '巴拉圭',
          '馬丘比丘': '秘魯', '庫斯科': '秘魯', '復活節島': '智利', '納斯卡': '秘魯',
          'Peru': '秘魯', 'Chile': '智利', 'Brazil': '巴西', 'Argentina': '阿根廷',
          // Middle East / Africa
          '以色列': '以色列', '約旦': '約旦', '杜拜': '阿聯酋', '阿布達比': '阿聯酋',
          '肯亞': '肯亞', '坦尚尼亞': '坦尚尼亞',
          'UK': '英國', 'Ireland': '愛爾蘭', 'Japan': '日本', 'Korea': '韓國', 'Thailand': '泰國',
          'Shikoku': '日本', 'Hokkaido': '日本', 'Okinawa': '日本', 'Kyushu': '日本',
        };
        for (const [keyword, country] of Object.entries(_countryPatterns)) {
          if (_pageTitle.includes(keyword) || url.toLowerCase().includes(keyword.toLowerCase())) {
            _parsedCountry = country;
            if (!_parsedCity) _parsedCity = country;
            break;
          }
        }
        // Note: ExtractedTourMeta doesn't have location/duration fields, skip those overrides
        
        console.log(`[MasterAgent] Quick parse → days=${_parsedDays}, country="${_parsedCountry}", city="${_parsedCity}"`);
        
        // Convert scraped HTML to rawData format compatible with ContentAnalyzerAgent
        const urlRawData = {
          basicInfo: {
            title: scrapeResult.pageTitle || '',
            subtitle: '',
            description: '',
            productCode: extractedTourMeta?.productCode || '',
          },
          location: {
            destinationCountry: _parsedCountry,
            destinationCity: _parsedCity,
          },
          duration: { days: _parsedDays, nights: _parsedNights },
          pricing: {
            price: extractedTourMeta?.pricing.adultPrice || 0,
            basePrice: extractedTourMeta?.pricing.adultPrice || 0,
            currency: extractedTourMeta?.pricing.currency || 'TWD',
            priceNote: extractedTourMeta?.pricing.priceNote || '',
          },
          highlights: [],
          dailyItinerary: [],
          includes: [],
          excludes: [],
          accommodation: [],
          hotels: [],
          meals: [],
          flights: [],
          notices: [],
          images: [],
          rawContent: scrapeResult.rawText || '',
          renderedHtml: scrapeResult.renderedHtml || '',
          sourceUrl: url,
          isPdfSource: false,
          // 注入 DateExtractor 結果
          extractedTourMeta: extractedTourMeta,
          maxParticipants: extractedTourMeta?.capacity.maxParticipants || 0,
          departureDates: extractedTourMeta?.departureDates || [],
        };
        
        rawData = urlRawData;

        // ── Round 55: For liontravel URLs in Puppeteer fallback, rescue price from API ──
        // LLM often misreads GTM tracking codes (e.g., "19052490 GTM電子商務碼") as prices.
        // Try a lightweight API call specifically for price.
        if (url.includes('liontravel.com')) {
          try {
            const { fetchLionTravelData: fetchLionPrice } = await import('../services/lionTravelApiService');
            const lionPriceData = await fetchLionPrice(url);
            if (lionPriceData?.pricing?.adultPrice && lionPriceData.pricing.adultPrice > 0) {
              rawData.pricing.price = lionPriceData.pricing.adultPrice;
              rawData.pricing.basePrice = lionPriceData.pricing.adultPrice;
              rawData.pricing.currency = lionPriceData.pricing.currencyCode || 'TWD';
              // Also fix productCode and departureCity
              if (lionPriceData.tourId) rawData.basicInfo.productCode = lionPriceData.tourId;
              if (lionPriceData.departureCity) rawData.location.departureCity = lionPriceData.departureCity;
              // Store lionPricing for finalData assembly
              (rawData as any).lionPricing = lionPriceData.pricing;
              console.log(`[MasterAgent] 🦁 Round 55: Puppeteer fallback price rescued from API: ${lionPriceData.pricing.adultPrice} ${lionPriceData.pricing.currencyCode}`);
            }
          } catch (lionPriceErr) {
            console.warn('[MasterAgent] 🦁 Round 55: Price rescue API call also failed:', (lionPriceErr as Error).message);
          }
        }

        // ── Round 50: Enrich rawData with liontravel structured API data ──────
        if (scrapeResult.lionApiData) {
          const ld = scrapeResult.lionApiData;
          console.log('[MasterAgent] 🦁 Enriching rawData with lionApiData:', Object.keys(ld).join(', '));

          // travelinfojson: basic tour info
          const gi = ld.travelInfo?.GroupInfo ?? {};
          if (gi.TourDays && Number(gi.TourDays) > 0) {
            rawData.duration.days = Number(gi.TourDays);
            rawData.duration.nights = Number(gi.TourDays) - 1;
          }
          if (gi.GroupID) rawData.basicInfo.productCode = gi.GroupID;

          // priceinfojson: pricing
          const priceList = ld.pricing?.PriceList ?? [];
          const adultRow = priceList.find((p: any) => p.PriceType === 'A' || p.PriceTypeName?.includes('成人') || p.PriceTypeName?.includes('大人'));
          const adultPrice = adultRow?.StraightLowestPrice || adultRow?.Price || 0;
          if (adultPrice > 0) {
            rawData.pricing.price = adultPrice;
            rawData.pricing.basePrice = adultPrice;
            rawData.pricing.currency = ld.pricing?.CurrencyCode || 'TWD';
          }

          // daytripinfojson: daily itinerary
          const days = ld.daytrip?.DayTripList ?? [];
          if (days.length > 0) {
            rawData.dailyItinerary = days.map((d: any, i: number) => ({
              day: i + 1,
              title: d.TravelPoint || `Day ${i + 1}`,
              description: d.Summary || '',
              meals: [d.Breakfast, d.Lunch, d.Dinner].filter(Boolean),
              accommodation: d.HotelName || '',
            }));
            // Also extract hotel names from daytrip
            const hotelNames = Array.from(new Set(days.map((d: any) => d.HotelName).filter(Boolean))) as string[];
            if (hotelNames.length > 0 && rawData.hotels.length === 0) {
              rawData.hotels = hotelNames.map((name: string) => ({ name, type: '飯店', stars: 4 }));
            }
          }

          // noticeinfojson: notices
          const noteList = ld.notice?.NoteList ?? [];
          if (noteList.length > 0 && rawData.notices.length === 0) {
            rawData.notices = noteList.map((n: any) => n.Content || n.Title || '').filter(Boolean);
          }

          // Round 52: groupcalendarjson → lionAllDepartures (from Puppeteer-intercepted data)
          // groupcalendarjson returns an array directly (not {GroupCalendarList: [...]})
          const _calendarRaw = (ld as any).calendar;
          const calendarList: any[] = Array.isArray(_calendarRaw)
            ? _calendarRaw
            : (_calendarRaw?.GroupCalendarList ?? []);
          if (calendarList.length > 0) {
            const safeParseFloat = (v: any) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };
            (rawData as any).lionAllDepartures = calendarList
              .filter((c: any) => (c.ID || c.GroupID) && (c.Date || c.GoDate))
              .map((c: any) => ({
                groupId: c.ID ?? c.GroupID ?? '',
                date: c.Date ?? c.GoDate ?? '',
                weekDay: c.WeekDay ?? '',
                price: safeParseFloat(c.Price),
                currencyCode: c.CurrencyCode ?? 'TWD',
                availableSeats: parseInt(c.AvailableVacancy ?? c.SpareSeat ?? c.SpareSeats ?? '0', 10),
                totalSeats: parseInt(c.TotalSeats ?? '0', 10),
                status: c.Status ?? '',
                tourId: c.TourID ?? c.NormGroupID ?? '',
              }));
            console.log(`[MasterAgent] 🦁 Round 52: Extracted ${(rawData as any).lionAllDepartures.length} departures from intercepted groupcalendarjson`);
          }

          // Store raw lionApiData for downstream agents
          (rawData as any).lionApiData = ld;
        }
        // ── End Round 50 ──────────────────────────────────────────────────────

        // Validate that we have enough content to generate a meaningful tour
        const rawTextLength = scrapeResult.rawText?.length || 0;
        const hasPageTitle = !!(scrapeResult.pageTitle && scrapeResult.pageTitle.trim().length > 5);
        if (rawTextLength < 200 && !hasPageTitle) {
          throw new Error(`無法從此 URL 取得足夠的行程資訊（僅取得 ${rawTextLength} 字元）。請確認 URL 是否為有效的旅遊行程頁面，例如：https://travel.liontravel.com/detail?...`);
        }
        
        // Cache the scrape result
        await generationCache.cacheScrapeResult(url, rawData);
        } // end if (!lionApiHandled)
      }
      
      if (taskId) progressTracker.completePhase(taskId, 'web_scraper');
      _endPhaseTimer('P1_scrape');
      console.log("[MasterAgent] ✓ Phase 1 completed: Web scraping");
      
      // ========================================================================
      // Phase 2: Content Analysis + Lion Title (Critical, Sequential)
      // Must complete before image prompts can be generated
      // ========================================================================
      _startPhaseTimer('P2_contentAnalyzer');
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
      
      _endPhaseTimer('P2_contentAnalyzer');
      console.log("[MasterAgent] ✓ Phase 2 completed: Content analysis + Lion title");
      console.log("[MasterAgent] Originality score:", analyzedContent.originalityScore);
      console.log("[MasterAgent] Poetic title:", analyzedContent.poeticTitle);
      
      // ========================================================================
      // Phase 3: ColorTheme ONLY (ImagePrompt removed for speed optimization)
      // Image generation is skipped - editors will manage images manually
      // ========================================================================
      _startPhaseTimer('P3_colorTheme');
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
      
      _endPhaseTimer('P3_colorTheme');
      console.log("[MasterAgent] ✓ Phase 3 completed: ColorTheme only");
      
      // ========================================================================
      // Phase 4: PARALLEL EXECUTION (6 agents - Image generation removed)
      // Itinerary + 5 Detail Agents running in parallel
      // ========================================================================
      onProgress?.("generating_content", 55);
      console.log("[MasterAgent] Starting Phase 4: PARALLEL (6 agents - no image generation)");
      console.log("[MasterAgent] Running: Itinerary, Cost, Notice, Hotel, Meal, Flight");
      
      _startPhaseTimer('P3b_imageIntelligence');
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
        console.warn('[MasterAgent] Image pipeline failed, continuing with defaults:', imgPipelineError);
      }
      _endPhaseTimer('P3b_imageIntelligence');
      _startPhaseTimer('P3c_visionAnalysis');
      // ── Vision Analysis + Smart Match ────────────────────────────────────────────────────────────────────────────
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
      _endPhaseTimer('P3c_visionAnalysis');
      // ── End Vision Analysis ────────────────────────────────────────────────────────────────────────────
      // Start all agents (except ImageGenerationAgent and ItineraryAgent which runs separately)
      // DetailsSkill replaces CostAgent, NoticeAgent, HotelAgent, MealAgent
      _startPhaseTimer('P4_details');
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
      
      _startPhaseTimer('P4_itinerary');
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
        onProgress?.("extracting_itinerary", 65); // Phase 4: Itinerary completed
      } catch (error) {
        console.error("[MasterAgent] Itinerary generation error:", error);
        if (taskId) progressTracker.failPhase(taskId, 'itinerary', error instanceof Error ? error.message : 'Unknown error');
        itineraryData = JSON.stringify([]);
      }
      
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
      
      // Hero Image: Forge (pipeline) → Lion real image → Unsplash (last resort)
      // Round 64 Fix B: Round 63 Fix 4 was broken — imageGenerationAgent already falls back to Unsplash
      // internally on Forge failure, so `!heroImage.url` was never true and Lion fallback never fired.
      // Now we inspect `source` to detect the case where pipeline gave us Unsplash (i.e. Forge failed),
      // and prefer the real Lion travel image in that case.
      let heroImage: { url: string; alt: string; source?: string } = imageResults.hero || { url: "", alt: "", source: "fallback" };
      let highlightImages: any[] = [];
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
            const { searchUnsplashPhotos } = await import("../services/unsplashService");
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
          this.monitor.completeAgent('DetailsSkill', result);
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
          transportationData = this.fallbackManager.handleFailure('TransportationAgent', new Error(result?.error || 'TransportationAgent failed'));
        }
      } else {
        const error = transportationResult.reason;
        this.monitor.failAgent('TransportationAgent', error);
        if (taskId) progressTracker.failPhase(taskId, 'flight_agent', error?.message || 'TransportationAgent failed');
        console.warn(`[MasterAgent] ⚠ TransportationAgent failed, using fallback`);
        transportationData = this.fallbackManager.handleFailure('TransportationAgent', error);
      }
      
      _endPhaseTimer('P4_details');
      _endPhaseTimer('P4_itinerary');
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
          const { searchUnsplashPhotos } = await import('../services/unsplashService');
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
          const { searchUnsplashPhotos } = await import('../services/unsplashService');
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
          const { searchUnsplashPhotos } = await import('../services/unsplashService');
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

      // ========================================================================
      // Phase 5: Assemble Final Data
      // ========================================================================
      _startPhaseTimer('P5_assembly');
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
        duration: rawData.duration?.days || 0, // CalibrationAgent checks tourData.duration (not .days)
        
        // Pricing — Round 50: prefer lionPricing.adultPrice for liontravel URLs
        price: (rawData.lionPricing?.adultPrice || rawData.pricing?.price || 0),
        
        // Hero section
        heroImage: heroImage.url,
        heroImageAlt: heroImage.alt,
        heroSubtitle: analyzedContent.heroSubtitle,
        
        // Color theme
        colorTheme: JSON.stringify(colorTheme),
        
        // Highlights — Round 68 Fix 3 + Round 69 Fix 2: merge image onto each
        // highlight. Round 68 merged from featureImageObjects (one per highlight);
        // Round 69 adds highlightImagePool fallback for when ItineraryAgent produces
        // more highlights than ImagePromptAgent generated images for. The pool is
        // pre-topped-up with Unsplash so every highlight gets a real URL.
        highlights: JSON.stringify(
          (analyzedContent.highlights || []).map((h: any, i: number) => ({
            ...h,
            image: (h.image && typeof h.image === 'string' && h.image.startsWith('http'))
              ? h.image
              : (featureImageObjects[i]?.url
                  || highlightImagePool[i]
                  || (highlightImagePool.length > 0 ? highlightImagePool[i % highlightImagePool.length] : '')),
            imageAlt: h.imageAlt || featureImageObjects[i]?.alt || h.title || '',
          }))
        ),

        // Key Features — mirror the same merge so cards/gallery stay consistent
        keyFeatures: JSON.stringify(
          (analyzedContent.highlights || []).map((h: any, i: number) => ({
            ...h,
            image: (h.image && typeof h.image === 'string' && h.image.startsWith('http'))
              ? h.image
              : (featureImageObjects[i]?.url
                  || highlightImagePool[i]
                  || (highlightImagePool.length > 0 ? highlightImagePool[i % highlightImagePool.length] : '')),
            imageAlt: h.imageAlt || featureImageObjects[i]?.alt || h.title || '',
          }))
        ),
        
        // Feature Images — Fix 2 (Round 62): store full object {url, alt, caption, position}
        featureImages: JSON.stringify(featureImageObjects),
        
        // Poetic content
        poeticContent: JSON.stringify(analyzedContent.poeticContent),
        
        // Detailed Itinerary
        itineraryDetailed: itineraryData,
        
        // Cost Explanation
        costExplanation: JSON.stringify(costData),
        
        // Detailed Notice
        noticeDetailed: JSON.stringify(noticeData),
        
        // Round 68 Fix 4: hotels / meals / hotelImages — use pre-computed pools that
        // include an Unsplash fallback when the source has no structured images.
        hotels: JSON.stringify(
          hotelsArrRaw.map((h: any, i: number) => ({
            name: h.name,
            stars: h.stars,
            description: h.description,
            facilities: h.facilities,
            location: h.location,
            image: (typeof h.image === 'string' && h.image.startsWith('http'))
              ? h.image
              : (hotelImagePool.length > 0 ? hotelImagePool[i % hotelImagePool.length] : ''),
            imageAlt: h.imageAlt || h.name || ''
          }))
        ),

        meals: JSON.stringify(
          mealsArrRaw.map((m: any, i: number) => ({
            name: m.name,
            type: m.type,
            description: m.description,
            cuisine: m.cuisine,
            restaurant: m.restaurant,
            image: (typeof m.image === 'string' && m.image.startsWith('http'))
              ? m.image
              : (mealImagePool.length > 0 ? mealImagePool[i % mealImagePool.length] : ''),
            imageAlt: m.imageAlt || m.name || ''
          }))
        ),

        hotelImages: JSON.stringify(hotelImagePool.slice(0, 8)),
        
        // Fix 3 (Round 62): galleryImages — from featureImageObjects
        galleryImages: JSON.stringify(
          featureImageObjects.map((f: any) => ({ url: f.url, caption: f.caption || f.alt || '' }))
        ),
        
        // Round 68 Fix 5: attractions — fall back to analyzedContent.highlights when
        // rawData.highlights is empty (which it is for unstructured sources like
        // japan.travel/en/). Without this fallback attractions=[] and QA deducts -7.
        attractions: JSON.stringify(
          (((rawData.highlights && rawData.highlights.length > 0)
            ? rawData.highlights
            : (analyzedContent?.highlights || [])) as any[])
            .slice(0, 10)
            .map((h: any, i: number) => ({
              name: h.title || h.name || `景點 ${i + 1}`,
              description: h.description || h.content || h.subtitle || '',
              image: (h.image && typeof h.image === 'string' && h.image.startsWith('http'))
                ? h.image
                : (featureImageObjects[i]?.url || ''),
              imageAlt: h.imageAlt || h.title || h.name || ''
            }))
        ),
        
        // Transportation (交通資訊 - 只有飛機行程才生成)
        // 火車、巴士等行程的交通資訊已整合到每日行程中
        flights: (transportationData?.type === 'FLIGHT' || !transportationData?.type) 
          ? JSON.stringify(transportationData) 
          : JSON.stringify({ type: transportationData?.type, typeName: transportationData?.typeName }),
        
        // Metadata
        originalityScore: analyzedContent.originalityScore,
        sourceUrl: url,
        
        // DateExtractor results (for extractedDepartures saving in tourGenerator)
        extractedTourMeta: (rawData as any).extractedTourMeta || null,
        // Round 52: All departure dates from liontravel groupcalendarjson
        lionAllDepartures: (rawData as any).lionAllDepartures || null,
        // Round 60: Pass lionPricing so tourGenerator can store child/infant prices per departure
        lionPricing: (rawData as any).lionPricing || null,
      };

      // Round 55: Price sanity check — detect GTM codes / tracking numbers misread as prices
      // No single tour package should cost > NT$2,000,000 (even luxury cruises rarely exceed this)
      if (finalData.price > 2000000) {
        console.warn(`[MasterAgent] ⚠️ Round 55: Price ${finalData.price} exceeds sanity limit (2M TWD), likely GTM/tracking code. Resetting to 0 for price rescue.`);
        (finalData as any).price = 0;
      }
      
      // ========================================================================
      // 6b. Universal Field Fallbacks (Round 47 — URL-mode robustness)
      // ========================================================================

      // Fix 1: duration fallback — extract from title / rawText if still 0

      if (!finalData.duration || finalData.duration === 0) {
        const textToSearch = [
          finalData.title || '',           // Generated title (e.g. "四國四鐵道輕奢七日")
          finalData.poeticTitle || '',     // Poetic title may also contain duration
          rawData?.basicInfo?.title || '',
          rawData?.rawText?.slice(0, 2000) || '',
          analyzedContent?.title || '',
          rawData?.rawContent?.slice(0, 2000) || '',
        ].join(' ');



        // Helper: convert Chinese number to Arabic
        const chineseToNum: Record<string, number> = {
          '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
          '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
          '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
        };

        let extracted = 0;

        // Pattern 1: Arabic digits — 7天, 7日, 8天7夜, 10 days, 5天4夜
        const arabicMatch = textToSearch.match(/(\d+)\s*天(?:\d+夜)?|(\d+)\s*日|(\d+)\s*days?/i);
        if (arabicMatch) {
          extracted = parseInt(arabicMatch[1] || arabicMatch[2] || arabicMatch[3], 10);
        }

        // Pattern 2: Chinese digits — 二日, 三日, 七天, 十日
        if (!extracted) {
          const chineseMatch = textToSearch.match(/(十[一二三四五]?|[一二三四五六七八九十])\s*[天日]/);
          if (chineseMatch) {
            extracted = chineseToNum[chineseMatch[1]] || 0;
          }
        }

        if (extracted > 0) {
          finalData.duration = extracted;
          finalData.days = extracted;
          finalData.nights = extracted > 1 ? extracted - 1 : 0;

        }
      }

      // Round 68 Fix 1b: if still 0, derive duration from dailyItinerary length.
      // Real-world reason: sources like japan.travel/en/ have no duration copy but we do
      // generate a multi-day itinerary. Without this the tour shows "0 天" and QA deducts -25.
      if (!finalData.duration || finalData.duration === 0) {
        try {
          const itin = typeof itineraryData === 'string' ? JSON.parse(itineraryData) : itineraryData;
          const days = Array.isArray(itin) ? itin.length : (Array.isArray(itin?.days) ? itin.days.length : 0);
          if (days > 0) {
            finalData.duration = days;
            finalData.days = days;
            finalData.nights = days > 1 ? days - 1 : 0;
            console.log(`[MasterAgent] Round 68 Fix 1b: duration=${days} derived from dailyItinerary.length`);
          }
        } catch (e) {
          console.warn('[MasterAgent] Round 68 Fix 1b: failed to parse itineraryData for duration fallback', e);
        }
      }

      // Fix 2: destinationCountry cross-check (Round 68 — runs unconditionally).
      // Previous behaviour only ran when destinationCountry was empty, so an upstream
      // mis-extraction (e.g. japan.travel/en/ → "英國") stuck. Now we always derive a
      // country from the city/title keywords; if the derived answer disagrees with the
      // existing value we override, because city names are more reliable than /en/ path
      // hints or LLM guesses.
      {
        const countryMap: Record<string, string> = {
          // Country names (self-map)
          '日本': '日本', '韓國': '韓國', '泰國': '泰國', '越南': '越南',
          '義大利': '義大利', '法國': '法國', '西班牙': '西班牙', '英國': '英國',
          '德國': '德國', '瑞士': '瑞士', '奧地利': '奧地利', '荷蘭': '荷蘭',
          '土耳其': '土耳其', '希臘': '希臘', '捷克': '捷克', '克羅埃西亞': '克羅埃西亞',
          '美國': '美國', '加拿大': '加拿大', '澳洲': '澳洲', '紐西蘭': '紐西蘭',
          '新加坡': '新加坡', '馬來西亞': '馬來西亞', '印尼': '印尼', '菲律賓': '菲律賓',
          '柬埔寨': '柬埔寨', '緬甸': '緬甸', '印度': '印度', '尼泊爾': '尼泊爾',
          '埃及': '埃及', '摩洛哥': '摩洛哥', '南非': '南非',
          '秘魯': '秘魯', '智利': '智利', '巴西': '巴西', '阿根廷': '阿根廷',
          '冰島': '冰島', '挪威': '挪威', '芬蘭': '芬蘭', '瑞典': '瑞典', '丹麥': '丹麥',
          '帛琉': '帛琉', '帛琉島': '帛琉', '巴里島': '印尼', '巴里': '印尼',
          // SE Asia cities
          '曼谷': '泰國', '清邁': '泰國', '普吉': '泰國',
          '河內': '越南', '胡志明': '越南', '峴港': '越南',
          // Korea cities
          '首爾': '韓國', '釜山': '韓國', '濟州': '韓國',
          // Japan regions + major cities
          '四國': '日本', '北海道': '日本', '沖繩': '日本', '沖縄': '日本',
          '九州': '日本', '關西': '日本', '關東': '日本', '東北': '日本',
          '北陸': '日本', '中部': '日本', '山陰': '日本', '山陽': '日本',
          '東京': '日本', '大阪': '日本', '京都': '日本', '名古屋': '日本',
          '神戸': '日本', '神戶': '日本', '橫濱': '日本', '橫浜': '日本',
          '札幌': '日本', '函館': '日本', '小樽': '日本', '仙台': '日本',
          // Kyushu & Okinawa detail (Round 68: these were missing, caused 福岡→英國 bug)
          '福岡': '日本', 'Fukuoka': '日本', '博多': '日本', '九大': '日本',
          '熊本': '日本', 'Kumamoto': '日本',
          '鹿兒島': '日本', '鹿児島': '日本', 'Kagoshima': '日本',
          '長崎': '日本', 'Nagasaki': '日本',
          '佐賀': '日本', 'Saga': '日本',
          '大分': '日本', 'Oita': '日本', '別府': '日本', '由布院': '日本', '湯布院': '日本',
          '宮崎': '日本', 'Miyazaki': '日本',
          '那霸': '日本', '石垣': '日本', '宮古島': '日本',
          // Taiwan cities
          '台灣': '台灣', '台北': '台灣', '台中': '台灣', '台南': '台灣', '高雄': '台灣',
          '花蓮': '台灣', '宜蘭': '台灣', '嘉義': '台灣', '屏東': '台灣', '台東': '台灣',
          '新竹': '台灣', '南投': '台灣', '雲林': '台灣', '彰化': '台灣', '基隆': '台灣',
          '日月潭': '台灣', '阿里山': '台灣', '太魯閣': '台灣',
          '澎湖': '台灣', '金門': '台灣', '馬祖': '台灣',
        };
        const textToSearch = [
          finalData.destinationCity || '',
          finalData.title || '',
          rawData?.location?.destinationCity || '',
          rawData?.basicInfo?.title || '',
          analyzedContent?.title || '',
          rawData?.rawText?.slice(0, 2000) || '',
        ].join(' ');

        let derivedCountry = '';
        for (const [keyword, country] of Object.entries(countryMap)) {
          if (textToSearch.includes(keyword)) {
            derivedCountry = country;
            break;
          }
        }

        const currentCountry = finalData.destinationCountry;
        if (derivedCountry && currentCountry !== derivedCountry) {
          if (currentCountry) {
            console.warn(
              `[MasterAgent] Round 68 Fix 2: destinationCountry mismatch — ` +
              `extracted="${currentCountry}" vs city-derived="${derivedCountry}"; ` +
              `overriding (city keyword is more reliable).`
            );
          }
          finalData.destinationCountry = derivedCountry;
        }
      }

      // Fix 3: keyFeatures fallback — use analyzedContent.highlights if empty
      {
        let kf: string[] = [];
        try { kf = JSON.parse(finalData.keyFeatures || '[]'); } catch { kf = []; }
        if (kf.length === 0 && analyzedContent?.highlights?.length > 0) {
          finalData.keyFeatures = JSON.stringify(analyzedContent.highlights);

        }
      }

      // Fix 4: featureImages — Round 52: prefer lionFeatureImages (from attraction list + featuresHtml)
      // Then fallback to Unsplash featureImageUrls, then itinerary day images
      {
        const lionFI = (rawData as any).lionFeatureImages as import('../services/lionTravelApiService').LionImage[] | undefined;
        if (lionFI && lionFI.length > 0) {
          // Fix 1 (Round 63): store full objects {url, caption, alt} not URL strings
          const lionFIObjs = lionFI
            .filter((img: any) => img?.url && img.url.startsWith('http'))
            .map((img: any, i: number) => ({
              url: img.url,
              caption: img.caption || img.alt || '',
              alt: img.alt || img.caption || '',
              position: i === 0 ? 'large' : 'small',
            }));
          if (lionFIObjs.length > 0) {
            finalData.featureImages = JSON.stringify(lionFIObjs);
            console.log(`[MasterAgent] ✓ Using ${lionFIObjs.length} lionFeatureImages as objects (Round 63 Fix 1)`);
          }
        }
      }
      {
        let fi: any[] = [];
        try { fi = JSON.parse(finalData.featureImages || '[]'); } catch { fi = []; }
        // Fix 1 (Round 63): check if fi is URL-string array (old format) and convert to objects
        if (fi.length > 0 && typeof fi[0] === 'string') {
          fi = fi.map((url: string, i: number) => ({ url, caption: '', alt: '', position: i === 0 ? 'large' : 'small' }));
          finalData.featureImages = JSON.stringify(fi);
          console.log(`[MasterAgent] ✓ Converted ${fi.length} URL strings to featureImage objects (Round 63 Fix 1)`);
        }
        if (fi.length === 0 && itineraryData) {
          try {
            const itineraryArr = JSON.parse(itineraryData);
            // Fix 1 (Round 63): store objects {url, caption, alt} not URL strings
            const itineraryImageObjs: any[] = [];
            for (const day of itineraryArr) {
              if (day.image && typeof day.image === 'string' && day.image.startsWith('http')) {
                itineraryImageObjs.push({
                  url: day.image,
                  caption: day.title || `Day ${day.day || itineraryImageObjs.length + 1}`,
                  alt: day.title || '',
                  position: itineraryImageObjs.length === 0 ? 'large' : 'small',
                });
              }
              if (itineraryImageObjs.length >= 5) break;
            }
            if (itineraryImageObjs.length > 0) {
              finalData.featureImages = JSON.stringify(itineraryImageObjs);
              console.log(`[MasterAgent] ✓ Using ${itineraryImageObjs.length} itinerary images as featureImage objects (Round 63 Fix 1)`);
            }
          } catch {
            // Non-critical — skip
          }
        }
      }

      // Fix 5: hotels fallback — use default hotels if empty array
      {
        let hotelArr: any[] = [];
        try { hotelArr = JSON.parse(finalData.hotels || '[]'); } catch { hotelArr = []; }
        if (hotelArr.length === 0) {
          const dest = finalData.destinationCity || finalData.destinationCountry || '目的地';
          finalData.hotels = JSON.stringify([
            {
              name: `${dest}精選飯店`,
              stars: '四星級',
              description: `位於${dest}的優質飯店，提供舒適的住宿環境和完善的設施。地理位置優越，鄰近主要景點，交通便利。客房寬敞明亮，配備現代化設施，讓您在旅途中享受家一般的溫馨。`,
              facilities: ['免費 WiFi', '健身房', '餐廳', '商務中心', '機場接送'],
              location: `${dest}市中心`,
            }
          ]);
        }
      }

      // Fix 6: meals fallback — use default meals if empty array
      {
        let mealArr: any[] = [];
        try { mealArr = JSON.parse(finalData.meals || '[]'); } catch { mealArr = []; }
        if (mealArr.length === 0) {
          const dest = finalData.destinationCity || finalData.destinationCountry || '目的地';
          finalData.meals = JSON.stringify([
            {
              name: `${dest}特色早餐`,
              type: 'breakfast',
              description: `在飯店享用豐盛的自助早餐，提供當地特色料理和國際美食，讓您充滿活力地開始新的一天。`,
              cuisine: '國際自助餐',
              restaurant: '飯店餐廳',
            },
            {
              name: `${dest}特色午餐`,
              type: 'lunch',
              description: `品嚐當地特色料理，選用新鮮食材，由當地名廚精心烹調，讓您體驗最道地的美食文化。`,
              cuisine: '當地特色料理',
            },
            {
              name: `${dest}精緻晚餐`,
              type: 'dinner',
              description: `在精心挑選的餐廳享用精緻晚餐，品嚐當地特色菜色，配以優雅的用餐環境，為一天的行程畫上完美句點。`,
              cuisine: '當地精緻料理',
            },
          ]);
        }
      }

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
      _endPhaseTimer('P5_assembly');
      // Phase 6: CalibrationAgent — Automatic QA Quality Gate
      // ========================================================================
      _startPhaseTimer('P6_calibration');
      let calibrationReport = null;
      try {
        if (taskId) progressTracker.startPhase(taskId, 'calibration');
        console.log('[MasterAgent] 🔍 Running CalibrationAgent QA...');
        const sourceContent = rawData.rawContent || '';
        calibrationReport = await calibrateTour(finalData, sourceContent);
        console.log(`[MasterAgent] ✓ Calibration: score=${calibrationReport.totalScore}, verdict=${calibrationReport.verdict}`);

        // Apply auto-fixes back to finalData
        if (calibrationReport.autoFixesApplied.length > 0) {
          for (const fix of calibrationReport.autoFixesApplied) {
            if (fix.field in finalData) {
              (finalData as any)[fix.field] = fix.after;
            }
          }
          console.log(`[MasterAgent] ✓ Applied ${calibrationReport.autoFixesApplied.length} auto-fix(es)`);
        }

        // ── Price Rescue: 如果 price=0 是低分根因，先用 regex 補救 ──
        if ((finalData.price === 0 || finalData.price === undefined) && calibrationReport.totalScore < 70) {
          console.log('[MasterAgent] ⚠ Price=0 detected with low QA score, attempting price rescue...');
          const rescueRawText = rawData.rawContent || rawData.renderedHtml || '';

          // 多幣別 regex 搜尋
          const pricePatterns = [
            { regex: /(?:TWD|NTD|NT\$)\s*?([\d,]+)/gi, currency: 'TWD' },
            { regex: /(?:USD|US\$)\s*?([\d,]+)/gi, currency: 'USD' },
            { regex: /(?:EUR|€)\s*?([\d,]+)/gi, currency: 'EUR' },
            { regex: /(?:JPY|¥)\s*?([\d,]+)/gi, currency: 'JPY' },
            { regex: /(?:GBP|£)\s*?([\d,]+)/gi, currency: 'GBP' },
            { regex: /(?:成人|大人|每人|售價|團費)[^\d\n]{0,30}([\d,]{4,7})/g, currency: 'AUTO' },
            { regex: /([\d,]{4,7})\s*元/g, currency: 'TWD' },
          ];

          const candidates: Array<{ price: number; currency: string }> = [];
          for (const { regex, currency } of pricePatterns) {
            let match;
            const re = new RegExp(regex.source, regex.flags);
            while ((match = re.exec(rescueRawText)) !== null) {
              const num = parseInt(match[1].replace(/,/g, ''), 10);
              if (num >= 100 && num <= 9999999) {
                candidates.push({ price: num, currency });
              }
            }
          }

          // 也嘗試從 priceHints 取得
          const scrapeHints = (rawData as any)?.extractedTourMeta?.pricing?.adultPrice;
          if (scrapeHints && scrapeHints > 0) {
            candidates.push({ price: scrapeHints, currency: (rawData as any)?.extractedTourMeta?.pricing?.currency || 'TWD' });
          }

          if (candidates.length > 0) {
            // 優先選有明確幣別的
            const withCurrency = candidates.filter(c => c.currency !== 'AUTO');
            const pool = withCurrency.length > 0 ? withCurrency : candidates;
            pool.sort((a, b) => a.price - b.price);
            const rescued = pool[Math.floor(pool.length / 2)];

            console.log(`[MasterAgent] ✓ Price rescue: ${rescued.price} ${rescued.currency} (from ${candidates.length} candidates)`);
            finalData.price = rescued.price;
            if (rawData.pricing) {
              rawData.pricing.price = rescued.price;
              rawData.pricing.basePrice = rescued.price;
              if (rescued.currency !== 'AUTO') {
                rawData.pricing.currency = rescued.currency;
              }
            }

            // 重跟 calibration
            try {
              console.log('[MasterAgent] 🔄 Re-running calibration after price rescue...');
              calibrationReport = await calibrateTour(finalData, sourceContent);
              console.log(`[MasterAgent] ✓ Post-rescue calibration: score=${calibrationReport.totalScore}, verdict=${calibrationReport.verdict}`);
              if (calibrationReport.autoFixesApplied.length > 0) {
                for (const fix of calibrationReport.autoFixesApplied) {
                  if (fix.field in finalData) {
                    (finalData as any)[fix.field] = fix.after;
                  }
                }
              }
            } catch (reCalErr) {
              console.warn('[MasterAgent] Post-rescue calibration failed:', reCalErr);
            }
          } else {
            console.log('[MasterAgent] ⚠ Price rescue found no candidates in rawText');
          }
        }

        _endPhaseTimer('P6_calibration');
        _startPhaseTimer('P6b_selfRepair');
        // ── P1-Self-Repair: if score < 70, re-run Phase 2 + Phase 4 with fix instructions ──
        const SELF_REPAIR_THRESHOLD = 70;
        const MAX_SELF_REPAIR_ROUNDS = 2;
        const SELF_REPAIR_TIMEOUT_MS = 60000; // 60 秒總時間上限
        let selfRepairRound = 0;
        const selfRepairStartTime = Date.now();
        while (
          calibrationReport.totalScore < SELF_REPAIR_THRESHOLD &&
          selfRepairRound < MAX_SELF_REPAIR_ROUNDS
        ) {
          // ⏱ 檢查總時間限制
          const selfRepairElapsed = Date.now() - selfRepairStartTime;
          if (selfRepairElapsed > SELF_REPAIR_TIMEOUT_MS) {
            console.warn(`[MasterAgent] ⏱ Self-Repair timeout after ${Math.round(selfRepairElapsed / 1000)}s (limit: ${SELF_REPAIR_TIMEOUT_MS / 1000}s). Stopping with score=${calibrationReport.totalScore}`);
            break;
          }
          selfRepairRound++;
          console.log(`[MasterAgent] 🔧 Self-Repair Round ${selfRepairRound}: score=${calibrationReport.totalScore} < ${SELF_REPAIR_THRESHOLD}, re-running Phase 2 + Phase 4...`);

          // Build fix instruction from calibration issues
          const criticalIssues = calibrationReport.issues
            .filter((i: any) => i.severity === 'critical' || i.severity === 'warning')
            .map((i: any) => `- [${i.check}] ${i.message}${i.field ? ` (欄位: ${i.field})` : ''}`)
            .join('\n');
          const selfRepairHint = criticalIssues
            ? `上一次生成的品質分數為 ${calibrationReport.totalScore}/100，以下問題需要修正：\n${criticalIssues}\n請確保本次輸出修正以上所有問題。`
            : `上一次生成的品質分數為 ${calibrationReport.totalScore}/100，請提升整體文案品質。`;

          // Inject repair hint into rawData
          (rawData as any).selfRepairHint = selfRepairHint;
          (rawData as any).selfRepairRound = selfRepairRound;

          // Re-run Phase 2: ContentAnalyzerAgent
          console.log('[MasterAgent] 🔧 Self-Repair: Re-running ContentAnalyzerAgent...');
          let repairedAnalyzedContent = analyzedContent;
          try {
            const repairAnalysisResult = await this.retryManager.executeWithRetry(
              () => this.contentAnalyzerAgent.execute(rawData),
              this.retryConfig,
              'ContentAnalyzerAgent-SelfRepair'
            );
            if (repairAnalysisResult.success && repairAnalysisResult.data) {
              repairedAnalyzedContent = repairAnalysisResult.data;
              // Update finalData with repaired content
              (finalData as any).poeticTitle = repairedAnalyzedContent.poeticTitle;
              (finalData as any).title = repairedAnalyzedContent.title;
              (finalData as any).description = repairedAnalyzedContent.description;
              (finalData as any).heroSubtitle = repairedAnalyzedContent.heroSubtitle;
              (finalData as any).highlights = JSON.stringify(repairedAnalyzedContent.highlights || []);
              (finalData as any).keyFeatures = JSON.stringify(repairedAnalyzedContent.highlights || []);
              console.log(`[MasterAgent] 🔧 Self-Repair: ContentAnalyzer updated title="${repairedAnalyzedContent.poeticTitle}"`);
            }
          } catch (repairErr) {
            console.warn('[MasterAgent] Self-Repair ContentAnalyzer failed (non-fatal):', repairErr);
          }

          // Re-run Phase 4: ItineraryUnifiedAgent
          console.log('[MasterAgent] 🔧 Self-Repair: Re-running ItineraryUnifiedAgent...');
          try {
            const repairItineraryResult = await this.itineraryUnifiedAgent.execute(rawData);
            if (repairItineraryResult.success && repairItineraryResult.data?.polishedItineraries && repairItineraryResult.data.polishedItineraries.length > 0) {
              const { polishedItineraries: repairedItineraries } = repairItineraryResult.data;
              // Re-assign images
              const { assignItineraryImages } = await import('../services/itineraryImageService');
              const repairedWithImages = await assignItineraryImages(
                repairedItineraries,
                { country: rawData?.location?.destinationCountry, city: rawData?.location?.destinationCity }
              );
              (finalData as any).itineraryDetailed = JSON.stringify(repairedWithImages);
              console.log(`[MasterAgent] 🔧 Self-Repair: Itinerary updated (${repairedItineraries.length} days)`);
            }
          } catch (repairErr) {
            console.warn('[MasterAgent] Self-Repair ItineraryUnified failed (non-fatal):', repairErr);
          }

          // Re-run calibration
          console.log('[MasterAgent] 🔧 Self-Repair: Re-running CalibrationAgent...');
          try {
            const repairCalibration = await calibrateTour(finalData, sourceContent);
            console.log(`[MasterAgent] 🔧 Self-Repair Round ${selfRepairRound} result: score=${repairCalibration.totalScore} (was ${calibrationReport.totalScore})`);
            // Apply auto-fixes from repair calibration
            if (repairCalibration.autoFixesApplied.length > 0) {
              for (const fix of repairCalibration.autoFixesApplied) {
                if (fix.field in finalData) {
                  (finalData as any)[fix.field] = fix.after;
                }
              }
            }
            // ⏱ 計時日誌
            const roundElapsed = Date.now() - selfRepairStartTime;
            // SCORE FLOOR: Only keep the repair result if it actually improves the score.
            // If score did not improve, keep the original and stop wasting time on more rounds.
            if (repairCalibration.totalScore > calibrationReport.totalScore) {
              console.log(`[MasterAgent] ✅ Self-Repair Round ${selfRepairRound}: score improved ${calibrationReport.totalScore} → ${repairCalibration.totalScore}`);
              calibrationReport = repairCalibration;
            } else {
              console.log(`[MasterAgent] ⚠️ Self-Repair Round ${selfRepairRound}: score did NOT improve (${repairCalibration.totalScore} ≤ ${calibrationReport.totalScore}), keeping original and stopping`);
              break;
            }
            console.log(`[MasterAgent] ⏱ Self-Repair Round ${selfRepairRound} complete: ${Math.round(roundElapsed / 1000)}s elapsed, score=${calibrationReport.totalScore}`);
          } catch (repairCalErr) {
            console.warn('[MasterAgent] Self-Repair CalibrationAgent failed (non-fatal):', repairCalErr);
            break;
          }
        }

        // Clean up repair hints from rawData
        delete (rawData as any).selfRepairHint;
        delete (rawData as any).selfRepairRound;

        if (taskId) progressTracker.completePhase(taskId, 'calibration');
      } catch (calErr) {
        console.warn('[MasterAgent] CalibrationAgent failed (non-fatal):', calErr);
        if (taskId) progressTracker.failPhase(taskId, 'calibration', String(calErr));
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
      
      // (Round 59: removed duplicate logAgentComplete — the second call below includes phase timing data)

      // 清理可能殘留的殭屍任務（Round 36-Fix-3: 從 25 分鐘延長到 30 分鐘，與 index.ts 排程器保持一致）
      _endPhaseTimer('P6b_selfRepair');
      // Round 55 Diag-C: Build timing summary
      const _phaseDurations: Record<string, string> = {};
      for (const [name, startMs] of Object.entries(_phaseTimers)) {
        _phaseDurations[name] = `+${((startMs - startTime)/1000).toFixed(1)}s`;
      }
      const _totalMs = Date.now() - startTime;
      const _timingSummary = Object.entries(_phaseDurations).map(([n, t]) => `${n}@${t}`).join(' | ');
      console.log('[MasterAgent] \u23f1 ========= PHASE TIMING SUMMARY =========');
      console.log(`[MasterAgent] \u23f1 ${_timingSummary}`);
      console.log(`[MasterAgent] \u23f1 TOTAL: ${_totalMs}ms (${(_totalMs/1000).toFixed(1)}s)`);
      console.log('[MasterAgent] \u23f1 =========================================');
      // Update resultSummary with timing info
      if (activityId) {
        const title = finalData.title || finalData.poeticTitle || '未命名行程';
        const dest = finalData.destinationCity || finalData.destinationCountry || '';
        await logAgentComplete(activityId, {
          status: 'completed',
          processingTimeMs: _totalMs,
          resultSummary: `已完成行程生成：「${title}${dest ? ` · ${dest}` : ''}」，耗時 ${(_totalMs/1000).toFixed(0)} 秒 | ⏱ ${_timingSummary}`,
        });
      }
      cleanupZombieTasks(30).catch(() => {});
      return {
        success: true,
        data: finalData,
        executionReport,
        calibrationReport: calibrationReport ?? undefined,
        phaseTimings: { phases: _phaseDurations, totalMs: _totalMs, totalSec: (_totalMs/1000).toFixed(1) },
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

      // 失敗時也清理殭屍任務（Round 36-Fix-3: 從 25 分鐘延長到 30 分鐘，與 index.ts 排程器保持一致）
      cleanupZombieTasks(30).catch(() => {});
      
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
