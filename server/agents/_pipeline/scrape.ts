/**
 * Pipeline Phase 1: Web Scraping / PDF Parsing / Lion API
 *
 * Extracted from masterAgent.ts during v2 Wave 2 Module 2.9 split. This is
 * the LARGEST pipeline file (intentional exception to the 300-LOC rule —
 * the three input paths share heavy keyword/country/city-mapping tables
 * that would duplicate badly if split further).
 *
 * Three execution paths:
 *   1. PDF mode (isPdf=true) — pdfParserAgent + optional supplement URL
 *   2. Lion direct API (url matches liontravel.com) — JSON API, ~2s instead of ~55s
 *   3. Puppeteer fallback (everything else) — dynamicScraperService
 *
 * On all paths the result is a normalized `rawData` object compatible with
 * downstream Phase 2 (ContentAnalyzerAgent) input.
 *
 * Critical: must complete before content analysis. Throws on failure (no
 * fallback — the whole pipeline depends on rawData).
 */

import { createChildLogger } from "../../_core/logger";
import { progressTracker } from "../progressTracker";
import generationCache from "../../cache/generation-cache";
import {
  fetchLionTravelData,
  buildRawContentFromLionData,
  extractCostSectionsFromFeaturesHtml,
} from "../../services/lionTravelApiService";
import type { AgentDeps, PhaseTimer, ProgressCallback } from "./types";

const log = createChildLogger({ module: "masterAgent/scrape" });

export interface ScrapePhaseInput {
  url: string;
  isPdf: boolean;
  forceRegenerate: boolean;
  supplementUrl?: string;
  taskId?: string;
  onProgress?: ProgressCallback;
  deps: AgentDeps;
  phaseTimer: PhaseTimer;
}

export interface ScrapePhaseResult {
  rawData: any;
}

export async function runScrapePhase(input: ScrapePhaseInput): Promise<ScrapePhaseResult> {
  const { url, isPdf, forceRegenerate, supplementUrl, taskId, onProgress, deps, phaseTimer } = input;

  // ========================================================================
  // Phase 1: Web Scraping or PDF Parsing (Critical, Sequential)
  // Must complete first as all other agents depend on rawData
  // ========================================================================
  phaseTimer.start('P1_scrape');
  onProgress?.(isPdf ? "parsing_pdf" : "scraping", 10);
  deps.monitor.startAgent('WebScraperAgent');
  if (taskId) progressTracker.startPhase(taskId, 'web_scraper');

  // Check for cached scrape result first (skip if forceRegenerate)
  let rawData: any;
  const cachedScrape = forceRegenerate ? null : await generationCache.getScrapeResult(url);
  if (cachedScrape) {
    console.log("[MasterAgent] 🎯 Scrape cache HIT!");
    rawData = cachedScrape;
    deps.monitor.completeAgent('WebScraperAgent', { success: true, data: cachedScrape });
  } else if (isPdf) {
    // PDF mode: use PdfParserAgent with progress tracking
    console.log("[MasterAgent] 📄 PDF mode: parsing PDF...");
    const { parsePdf } = await import("../pdfParserAgent");

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
      deps.monitor.failAgent('WebScraperAgent', new Error("PDF parsing failed"));
      throw new Error("PDF parsing failed");
    }

    deps.monitor.completeAgent('WebScraperAgent', pdfResult);
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
        let supplementScrape: import('../../services/dynamicScraperService').DynamicScrapeResult | Partial<import('../../services/dynamicScraperService').DynamicScrapeResult>;
        try {
          const { scrapeDynamicPage } = await import('../../services/dynamicScraperService');
          supplementScrape = await scrapeDynamicPage(supplementUrl);
        } catch {
          const { scrapeStaticFallback } = await import('../../services/dynamicScraperService');
          supplementScrape = await scrapeStaticFallback(supplementUrl);
        }

        if (taskId) progressTracker.completePhase(taskId, 'dynamic_render');
        if (taskId) progressTracker.startPhase(taskId, 'date_extractor');
        onProgress?.("extracting_dates", 25);

        const { extractTourMeta } = await import('../dateExtractorAgent');
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
        console.log(`[MasterAgent] ⏱ P1: liontravel API SUCCESS — using direct API path`);
        console.log(`[MasterAgent] 🦁 Liontravel detected: using direct API (${lionData.tourDays} days, price=${lionData.price} ${lionData.currencyCode})`);
        if (taskId) progressTracker.completePhase(taskId, 'dynamic_render');
        if (taskId) progressTracker.startPhase(taskId, 'date_extractor');
        if (taskId) progressTracker.completePhase(taskId, 'date_extractor');

        // Detect destination country from tourName + arriveAirport
        const _lionCountryPatterns: Record<string, string> = {
          // Direct country names
          '英國': '英國', '愛爾蘭': '愛爾蘭', '法國': '法國', '義大利': '義大利', '日本': '日本',
          '韓國': '韓國', '泰國': '泰國', '越南': '越南', '帛琦': '帛琦', '台灣': '台灣',
          '美國': '美國', '德國': '德國', '西班牙': '西班牙', '希臘': '希臘', '土耳其': '土耳其',
          '澳洲': '澳洲', '紐西蘭': '紐西蘭', '加拿大': '加拿大',
          '奧地利': '奧地利', '捷克': '捷克', '瑞士': '瑞士', '匈牙利': '匈牙利', '波蘭': '波蘭',
          '克羅埃西亞': '克羅埃西亞', '冰島': '冰島', '挪威': '挪威', '瑞典': '瑞典',
          '丹麥': '丹麥', '芬蘭': '芬蘭', '比利時': '比利時', '荷蘭': '荷蘭',
          '羅馬尼亞': '羅馬尼亞', '保加利亞': '保加利亞', '葡萄牙': '葡萄牙',
          '菲律賓': '菲律賓', '新加坡': '新加坡', '馬來西亞': '馬來西亞', '印尼': '印尼',
          '印度': '印度', '尼泊爾': '尼泊爾', '斯里蘭卡': '斯里蘭卡', '不丹': '不丹',
          '蒙古': '蒙古', '中國': '中國', '香港': '香港', '澳門': '澳門',
          '埃及': '埃及', '摩洛哥': '摩洛哥', '南非': '南非', '肯亞': '肯亞',
          '墨西哥': '墨西哥', '古巴': '古巴', '哥斯大黎加': '哥斯大黎加',
          // Multi-country combos (use first country as primary)
          '奧捷': '奧地利', '北歐': '挪威', '東歐': '捷克', '南歐': '義大利', '西歐': '法國',
          '美東': '美國', '美西': '美國', '美加': '美國',
          '中歐': '德國', '英愛': '英國', '法瑞義': '法國', '德奧': '德國',
          // Japan regions
          '四國': '日本', '北海道': '日本', '沖縄': '日本', '沖繩': '日本', '九州': '日本', '關西': '日本',
          '京阪神': '日本', '東京': '日本', '大阪': '日本', '京都': '日本', '名古屋': '日本', '福岡': '日本',
          '廣島': '日本', '神戶': '日本', '奈良': '日本', '富士山': '日本',
          // Korea regions
          '首爾': '韓國', '釜山': '韓國', '濟州': '韓國',
          // Southeast Asia cities
          '峨里': '印尼', '巴里島': '印尼', '峇里島': '印尼', '雅加達': '印尼',
          '曼谷': '泰國', '清邁': '泰國', '普吉': '泰國', '蘇梅': '泰國',
          '河內': '越南', '胡志明': '越南', '峴港': '越南', '下龍灣': '越南',
          '馬尼拉': '菲律賓', '宿霧': '菲律賓', '長灘島': '菲律賓',
          '吉隆坡': '馬來西亞', '沙巴': '馬來西亞', '檳城': '馬來西亞',
          // European cities
          '維也納': '奧地利', '薩爾斯堡': '奧地利', '哈修塔特': '奧地利',
          '布拉格': '捷克', '庫倫洛夫': '捷克',
          '蘇黎世': '瑞士', '日內瓦': '瑞士', '琉森': '瑞士', '采爾馬特': '瑞士',
          '布達佩斯': '匈牙利', '華沙': '波蘭', '克拉科夫': '波蘭',
          '羅馬': '義大利', '米蘭': '義大利', '威尼斯': '義大利', '佛羅倫斯': '義大利', '那不勒斯': '義大利',
          '巴黎': '法國', '尼斯': '法國', '里昂': '法國', '馬賽': '法國',
          '倫敦': '英國', '愛丁堡': '英國', '曼徹斯特': '英國',
          '柏林': '德國', '慕尼黑': '德國', '法蘭克福': '德國', '漢堡': '德國',
          '巴塞隆納': '西班牙', '馬德里': '西班牙', '塞維亞': '西班牙',
          '雅典': '希臘', '聖托里尼': '希臘', '米克諾斯': '希臘',
          '伊斯坦堡': '土耳其', '卡帕多奇亞': '土耳其',
          '阿姆斯特丹': '荷蘭', '布魯塞爾': '比利時',
          '雷克雅維克': '冰島', '奧斯陸': '挪威', '斯德哥爾摩': '瑞典',
          '哥本哈根': '丹麥', '赫爾辛基': '芬蘭',
          // Americas cities
          '紐約': '美國', '華盛頓': '美國', '費城': '美國', '波士頓': '美國', '芝加哥': '美國',
          '洛杉磯': '美國', '舊金山': '美國', '拉斯維加斯': '美國', '西雅圖': '美國', '邁阿密': '美國',
          '夏威夷': '美國', '阿拉斯加': '美國', '黃石': '美國',
          '溫哥華': '加拿大', '多倫多': '加拿大', '渥太華': '加拿大', '魁北克': '加拿大',
          // Oceania
          '雪梨': '澳洲', '墨爾本': '澳洲', '黃金海岸': '澳洲', '布里斯本': '澳洲',
          '奧克蘭': '紐西蘭', '基督城': '紐西蘭', '皇后鎮': '紐西蘭',
          // South America
          '秘魯': '秘魯', '智利': '智利', '巴西': '巴西', '阿根廷': '阿根廷',
          '馬丘比丘': '秘魯', '庫斯科': '秘魯', '復活節島': '智利',
          '里約': '巴西', '聖保羅': '巴西', '布宜諾斯艾利斯': '阿根廷',
          // English
          'Peru': '秘魯', 'Chile': '智利', 'Japan': '日本', 'Korea': '韓國',
          // Airport codes
          'NRT': '日本', 'HND': '日本', 'KIX': '日本', 'CTS': '日本', 'OKA': '日本', 'FUK': '日本', 'NGO': '日本',
          'ICN': '韓國', 'PUS': '韓國', 'CJU': '韓國',
          'BKK': '泰國', 'DMK': '泰國', 'HKT': '泰國', 'CNX': '泰國',
          'HAN': '越南', 'SGN': '越南', 'DAD': '越南',
          'MNL': '菲律賓', 'CEB': '菲律賓', 'KUL': '馬來西亞', 'BKI': '馬來西亞',
          'DPS': '印尼', 'CGK': '印尼', 'SIN': '新加坡',
          'LHR': '英國', 'LGW': '英國', 'EDI': '英國', 'MAN': '英國',
          'CDG': '法國', 'ORY': '法國', 'NCE': '法國',
          'FCO': '義大利', 'MXP': '義大利', 'VCE': '義大利',
          'FRA': '德國', 'MUC': '德國', 'BER': '德國',
          'VIE': '奧地利', 'PRG': '捷克', 'ZRH': '瑞士', 'GVA': '瑞士',
          'BUD': '匈牙利', 'WAW': '波蘭',
          'BCN': '西班牙', 'MAD': '西班牙',
          'ATH': '希臘', 'IST': '土耳其', 'AMS': '荷蘭', 'BRU': '比利時',
          'KEF': '冰島', 'OSL': '挪威', 'ARN': '瑞典', 'CPH': '丹麥', 'HEL': '芬蘭',
          'SYD': '澳洲', 'MEL': '澳洲', 'BNE': '澳洲',
          'AKL': '紐西蘭', 'CHC': '紐西蘭',
          'JFK': '美國', 'EWR': '美國', 'LAX': '美國', 'SFO': '美國', 'ORD': '美國',
          'LAS': '美國', 'SEA': '美國', 'MIA': '美國', 'BOS': '美國', 'IAD': '美國', 'DFW': '美國',
          'HNL': '美國', 'ANC': '美國',
          'YVR': '加拿大', 'YYZ': '加拿大', 'YUL': '加拿大',
          'LIM': '秘魯', 'SCL': '智利', 'GRU': '巴西', 'EZE': '阿根廷',
          'CAI': '埃及', 'CMN': '摩洛哥', 'JNB': '南非', 'NBO': '肯亞',
          'MEX': '墨西哥', 'HAV': '古巴',
          // Round 80.10: Taiwan domestic — needed when API.Country is
          // missing and tourName contains a Taiwan locality keyword.
          '花東': '台灣', '花蓮': '台灣', '台東': '台灣',
          '台北': '台灣', '新北': '台灣', '基隆': '台灣',
          '桃園': '台灣', '新竹': '台灣', '苗栗': '台灣',
          '台中': '台灣', '彰化': '台灣', '南投': '台灣', '雲林': '台灣',
          '嘉義': '台灣', '台南': '台灣', '高雄': '台灣', '屏東': '台灣',
          '宜蘭': '台灣', '澎湖': '台灣', '金門': '台灣', '馬祖': '台灣',
          '阿里山': '台灣', '日月潭': '台灣', '墾丁': '台灣', '太魯閣': '台灣',
          '七星潭': '台灣', '知本': '台灣', '蘭嶼': '台灣', '池上': '台灣',
          '鳴日號': '台灣', // Mingri Train — explicit signal for domestic
        };

        // City lookup — returns a specific city/region name (distinct from country)
        const _lionCityPatterns: Record<string, string> = {
          // Japan
          '北海道': '北海道', '沖縄': '沖繩', '沖繩': '沖繩', '九州': '九州', '關西': '關西', '京阪神': '京阪神',
          '東京': '東京', '大阪': '大阪', '京都': '京都', '名古屋': '名古屋', '福岡': '福岡',
          '廣島': '廣島', '神戶': '神戶', '奈良': '奈良', '四國': '四國',
          // Round 80.16 P0a fix: Okinawa sub-islands — ferry/cruise tours
          // hit 那霸/石垣/宮古 in itinerary text but never the parent label
          // 沖繩 directly. Map them all back to 沖繩.
          '那霸': '沖繩', '石垣': '沖繩', '宮古': '沖繩', '與那國': '沖繩',
          // Korea
          '首爾': '首爾', '釜山': '釜山', '濟州': '濟州',
          // SE Asia
          '曼谷': '曼谷', '清邁': '清邁', '普吉': '普吉', '蘇梅': '蘇梅',
          '河內': '河內', '胡志明': '胡志明', '峴港': '峴港', '下龍灣': '下龍灣',
          '巴里島': '巴里島', '峇里島': '峇里島',
          '馬尼拉': '馬尼拉', '宿霧': '宿霧', '長灘島': '長灘島',
          '吉隆坡': '吉隆坡', '沙巴': '沙巴', '檳城': '檳城',
          // Europe
          '維也納': '維也納', '薩爾斯堡': '薩爾斯堡', '哈修塔特': '哈修塔特',
          '布拉格': '布拉格', '庫倫洛夫': '庫倫洛夫',
          '蘇黎世': '蘇黎世', '日內瓦': '日內瓦', '琉森': '琉森', '采爾馬特': '采爾馬特',
          '布達佩斯': '布達佩斯', '華沙': '華沙', '克拉科夫': '克拉科夫',
          '羅馬': '羅馬', '米蘭': '米蘭', '威尼斯': '威尼斯', '佛羅倫斯': '佛羅倫斯',
          '巴黎': '巴黎', '尼斯': '尼斯', '里昂': '里昂',
          '倫敦': '倫敦', '愛丁堡': '愛丁堡',
          '柏林': '柏林', '慕尼黑': '慕尼黑', '法蘭克福': '法蘭克福',
          '巴塞隆納': '巴塞隆納', '馬德里': '馬德里',
          '雅典': '雅典', '聖托里尼': '聖托里尼', '米克諾斯': '米克諾斯',
          '伊斯坦堡': '伊斯坦堡', '卡帕多奇亞': '卡帕多奇亞',
          '阿姆斯特丹': '阿姆斯特丹', '布魯塞爾': '布魯塞爾',
          '雷克雅維克': '雷克雅維克', '奧斯陸': '奧斯陸',
          '斯德哥爾摩': '斯德哥爾摩', '哥本哈根': '哥本哈根', '赫爾辛基': '赫爾辛基',
          // Americas
          '紐約': '紐約', '華盛頓': '華盛頓', '費城': '費城', '波士頓': '波士頓', '芝加哥': '芝加哥',
          '洛杉磯': '洛杉磯', '舊金山': '舊金山', '拉斯維加斯': '拉斯維加斯', '西雅圖': '西雅圖',
          '邁阿密': '邁阿密', '夏威夷': '夏威夷', '阿拉斯加': '阿拉斯加',
          '溫哥華': '溫哥華', '多倫多': '多倫多', '魁北克': '魁北克',
          // Oceania
          '雪梨': '雪梨', '墨爾本': '墨爾本', '黃金海岸': '黃金海岸', '布里斯本': '布里斯本',
          '奧克蘭': '奧克蘭', '基督城': '基督城', '皇后鎮': '皇后鎮',
          // Multi-country labels used as "city"
          '奧捷': '奧捷', '北歐': '北歐', '東歐': '東歐', '南歐': '南歐', '西歐': '西歐',
          '美東': '美東', '美西': '美西', '美加': '美加',
          // South America
          '馬丘比丘': '馬丘比丘', '庫斯科': '庫斯科',
          '里約': '里約', '聖保羅': '聖保羅', '布宜諾斯艾利斯': '布宜諾斯艾利斯',
          // Round 80.10 → 80.16 P0a v2: Taiwan domestic — REORDERED.
          // JS object iteration is insertion-order, and the `for…of
          // entries(_lionCityPatterns)` loop short-circuits on first
          // match. The order below puts:
          //   1. Specific attractions  → their county (太魯閣→花蓮)
          //   2. True destination counties (南投/嘉義/台南/宜蘭/...)
          //   3. Departure / transit cities LAST (桃園/台北/高雄/台中)
          // so a "南投旅遊..." tour whose Day 1 mentions 桃園機場
          // doesn't get classified with city=桃園.
          // ── Specific attractions ──
          '太魯閣': '花蓮', '七星潭': '花蓮', '瑞穗': '花蓮',
          '知本': '台東', '綠島': '台東', '蘭嶼': '台東', '池上': '台東',
          '阿里山': '阿里山', '日月潭': '日月潭', '墾丁': '墾丁',
          '礁溪': '宜蘭', '羅東': '宜蘭',
          // ── True destination counties (rural / scenic — checked first) ──
          '南投': '南投', '雲林': '雲林', '嘉義': '嘉義', '台南': '台南',
          '宜蘭': '宜蘭', '花蓮': '花蓮', '台東': '台東', '花東': '花東',
          '澎湖': '澎湖', '金門': '金門', '馬祖': '馬祖',
          '苗栗': '苗栗', '彰化': '彰化', '屏東': '屏東',
          '新竹': '新竹',
          // ── Departure / transit cities (checked LAST) ──
          '台中': '台中', '高雄': '高雄', '新北': '新北', '基隆': '基隆',
          '桃園': '桃園', '台北': '台北',
        };

        // Round 80.10: ISO-2 country code → Chinese name (primary source).
        // Lion Travel API exposes Country in GroupInfo; using it directly
        // is far more reliable than keyword-scanning tourName, which
        // misses Taiwan domestic, multi-region tours, and tours with
        // non-standard naming.
        const _lionISO2ToCountry: Record<string, string> = {
          TW: '台灣', JP: '日本', KR: '韓國', CN: '中國', HK: '香港', MO: '澳門',
          TH: '泰國', VN: '越南', PH: '菲律賓', MY: '馬來西亞', ID: '印尼',
          SG: '新加坡', IN: '印度', NP: '尼泊爾', LK: '斯里蘭卡',
          US: '美國', CA: '加拿大', MX: '墨西哥', CU: '古巴',
          GB: '英國', UK: '英國', IE: '愛爾蘭', FR: '法國', IT: '義大利',
          DE: '德國', ES: '西班牙', PT: '葡萄牙', NL: '荷蘭', BE: '比利時',
          AT: '奧地利', CZ: '捷克', CH: '瑞士', HU: '匈牙利', PL: '波蘭',
          GR: '希臘', TR: '土耳其', RO: '羅馬尼亞', BG: '保加利亞', HR: '克羅埃西亞',
          IS: '冰島', NO: '挪威', SE: '瑞典', DK: '丹麥', FI: '芬蘭',
          AU: '澳洲', NZ: '紐西蘭',
          EG: '埃及', MA: '摩洛哥', ZA: '南非', KE: '肯亞',
          PE: '秘魯', CL: '智利', BR: '巴西', AR: '阿根廷',
        };

        const _lionSearchText = lionData.tourName + ' ' + lionData.outboundFlight.arriveAirport;
        let _lionCountry = '';
        // Round 80.16 P0a v3: REORDERED. Lion's API.Country field is the
        // LISTING country (where the agency is registered), NOT the
        // destination. For all Lion-Travel tours it's "TW", which would
        // wrongly classify 北海道/紐西蘭/巴西 tours as 台灣. So:
        //   Pass 1 (keyword scan tourName + flight airport) runs FIRST
        //   Pass 0 (API.Country) only as last-resort fallback.
        // Note: TW from API is now suppressed entirely if no keyword match
        // — most TW domestic tours will be caught by '南投' / '花蓮' / etc.
        // patterns.
        for (const [kw, country] of Object.entries(_lionCountryPatterns)) {
          if (_lionSearchText.includes(kw)) {
            _lionCountry = country;
            break;
          }
        }
        // Pass 0 fallback: trust API.Country only when it's NOT TW (which
        // is unreliable) and only when keyword scan found nothing.
        if (!_lionCountry) {
          const _apiCountryCode = (lionData as any).country?.toString().toUpperCase().trim();
          if (_apiCountryCode && _apiCountryCode !== "TW" && _lionISO2ToCountry[_apiCountryCode]) {
            _lionCountry = _lionISO2ToCountry[_apiCountryCode];
            console.log(`[MasterAgent] 🦁 country fallback API.Country=${_apiCountryCode} → ${_lionCountry}`);
          }
        }

        // Extract specific city — search across tourName + daily itinerary + flight airports.
        // Previously only searched tourName, which meant tours with region-only titles like
        // "北歐極光冒險10日" or "經典土耳其10日｜土航直飛" fell back to the region/country
        // label even though the itinerary clearly visits 奧斯陸 / 伊斯坦堡 / 卡帕多奇亞.
        // City patterns are ordered so specific cities come before region buckets in the dict,
        // so the first match is always the most specific label available.
        const _lionItineraryText = (lionData.dailyItinerary || [])
          .map(d => [
            d.travelPoint || '',
            d.summary || '',
            d.hotelName || '',
            (d.attractions || []).map((a: any) => a?.name || '').join(' '),
          ].join(' '))
          .join(' ');

        // Round 66: airport code → city fallback. Helps when tour names/itinerary
        // only give a region ("北歐") but the flight airport code pins down a
        // specific city (OSL → 奧斯陸, IST → 伊斯坦堡, etc.).
        const _lionAirportCodeToCity: Record<string, string> = {
          'NRT': '東京', 'HND': '東京', 'KIX': '大阪', 'NGO': '名古屋', 'FUK': '福岡', 'CTS': '札幌', 'OKA': '沖繩',
          'ICN': '首爾', 'GMP': '首爾', 'PUS': '釜山', 'CJU': '濟州',
          'BKK': '曼谷', 'HKT': '普吉', 'CNX': '清邁',
          'HAN': '河內', 'SGN': '胡志明', 'DAD': '峴港',
          'DPS': '峇里島', 'KUL': '吉隆坡', 'PEN': '檳城', 'BKI': '沙巴',
          'MNL': '馬尼拉', 'CEB': '宿霧',
          'VIE': '維也納', 'PRG': '布拉格', 'BUD': '布達佩斯', 'WAW': '華沙',
          'ZRH': '蘇黎世', 'GVA': '日內瓦',
          'CDG': '巴黎', 'ORY': '巴黎', 'NCE': '尼斯', 'LYS': '里昂',
          'LHR': '倫敦', 'LGW': '倫敦', 'EDI': '愛丁堡',
          'FRA': '法蘭克福', 'MUC': '慕尼黑', 'TXL': '柏林', 'BER': '柏林',
          'FCO': '羅馬', 'MXP': '米蘭', 'VCE': '威尼斯', 'FLR': '佛羅倫斯',
          'BCN': '巴塞隆納', 'MAD': '馬德里',
          'ATH': '雅典', 'JTR': '聖托里尼',
          'IST': '伊斯坦堡', 'SAW': '伊斯坦堡', 'ASR': '卡帕多奇亞', 'NAV': '卡帕多奇亞',
          'AMS': '阿姆斯特丹', 'BRU': '布魯塞爾',
          'KEF': '雷克雅維克', 'OSL': '奧斯陸', 'ARN': '斯德哥爾摩', 'CPH': '哥本哈根', 'HEL': '赫爾辛基',
          'JFK': '紐約', 'EWR': '紐約', 'LGA': '紐約', 'IAD': '華盛頓', 'BOS': '波士頓', 'ORD': '芝加哥',
          'LAX': '洛杉磯', 'SFO': '舊金山', 'LAS': '拉斯維加斯', 'SEA': '西雅圖', 'MIA': '邁阿密',
          'HNL': '夏威夷', 'ANC': '阿拉斯加', 'YVR': '溫哥華', 'YYZ': '多倫多',
          'SYD': '雪梨', 'MEL': '墨爾本', 'BNE': '布里斯本', 'OOL': '黃金海岸',
          'AKL': '奧克蘭', 'CHC': '基督城', 'ZQN': '皇后鎮',
        };
        const _lionFlightAirportCodes = [
          lionData.outboundFlight?.arriveAirport || '',
          lionData.returnFlight?.departureAirport || '',
        ].join(' ').toUpperCase().match(/\b[A-Z]{3}\b/g) || [];

        // Round 80.16 P0a fix: strip the departure city from the search
        // text so phrases like "高雄出發｜那霸．石垣" don't match the
        // departure (高雄) before reaching the actual destination (那霸/沖繩).
        // The Lion API always exposes departureCity separately — that's
        // the authoritative signal that this city is NOT the destination.
        const _lionDepartureCity = (lionData.departureCity || '').trim();
        let _lionCitySearchText = [
          lionData.tourName || '',
          _lionItineraryText,
          lionData.outboundFlight?.arriveAirport || '',
          lionData.returnFlight?.departureAirport || '',
        ].join(' ');
        if (_lionDepartureCity) {
          _lionCitySearchText = _lionCitySearchText.split(_lionDepartureCity).join('');
        }

        // Round 66: build an inverse city→country lookup so mixed-region tours
        // (e.g. "羅馬與土耳其經典10日") don't pick a city in the WRONG country.
        // We prefer the first city pattern that matches AND sits inside
        // `_lionCountry`; fall back to any match only if no same-country city
        // exists.
        const _lionCityToCountry: Record<string, string> = {
          '東京': '日本', '大阪': '日本', '京都': '日本', '名古屋': '日本', '福岡': '日本',
          '廣島': '日本', '神戶': '日本', '奈良': '日本', '四國': '日本', '北海道': '日本',
          '沖繩': '日本', '九州': '日本', '關西': '日本', '京阪神': '日本',
          '那霸': '日本', '石垣': '日本', '宮古': '日本', '與那國': '日本',
          '首爾': '韓國', '釜山': '韓國', '濟州': '韓國',
          '曼谷': '泰國', '清邁': '泰國', '普吉': '泰國', '蘇梅': '泰國',
          '河內': '越南', '胡志明': '越南', '峴港': '越南', '下龍灣': '越南',
          '巴里島': '印尼', '峇里島': '印尼',
          '馬尼拉': '菲律賓', '宿霧': '菲律賓', '長灘島': '菲律賓',
          '吉隆坡': '馬來西亞', '沙巴': '馬來西亞', '檳城': '馬來西亞',
          '維也納': '奧地利', '薩爾斯堡': '奧地利', '哈修塔特': '奧地利',
          '布拉格': '捷克', '庫倫洛夫': '捷克',
          '蘇黎世': '瑞士', '日內瓦': '瑞士', '琉森': '瑞士', '采爾馬特': '瑞士',
          '布達佩斯': '匈牙利', '華沙': '波蘭', '克拉科夫': '波蘭',
          '羅馬': '義大利', '米蘭': '義大利', '威尼斯': '義大利', '佛羅倫斯': '義大利',
          '巴黎': '法國', '尼斯': '法國', '里昂': '法國',
          '倫敦': '英國', '愛丁堡': '英國',
          '柏林': '德國', '慕尼黑': '德國', '法蘭克福': '德國',
          '巴塞隆納': '西班牙', '馬德里': '西班牙',
          '雅典': '希臘', '聖托里尼': '希臘', '米克諾斯': '希臘',
          '伊斯坦堡': '土耳其', '卡帕多奇亞': '土耳其',
          '阿姆斯特丹': '荷蘭', '布魯塞爾': '比利時',
          '雷克雅維克': '冰島', '奧斯陸': '挪威',
          '斯德哥爾摩': '瑞典', '哥本哈根': '丹麥', '赫爾辛基': '芬蘭',
          '紐約': '美國', '華盛頓': '美國', '費城': '美國', '波士頓': '美國', '芝加哥': '美國',
          '洛杉磯': '美國', '舊金山': '美國', '拉斯維加斯': '美國', '西雅圖': '美國',
          '邁阿密': '美國', '夏威夷': '美國', '阿拉斯加': '美國',
          '溫哥華': '加拿大', '多倫多': '加拿大', '魁北克': '加拿大',
          '雪梨': '澳洲', '墨爾本': '澳洲', '黃金海岸': '澳洲', '布里斯本': '澳洲',
          '奧克蘭': '紐西蘭', '基督城': '紐西蘭', '皇后鎮': '紐西蘭',
          '馬丘比丘': '秘魯', '庫斯科': '秘魯',
          '里約': '巴西', '聖保羅': '巴西', '布宜諾斯艾利斯': '阿根廷',
          // Round 80.10: Taiwan cities/counties — needed for Mingri-train,
          // 花東 rail tours, and any other domestic itinerary.
          '花蓮': '台灣', '台東': '台灣', '花東': '台灣',
          '台北': '台灣', '新北': '台灣', '基隆': '台灣',
          '桃園': '台灣', '新竹': '台灣', '苗栗': '台灣',
          '台中': '台灣', '彰化': '台灣', '南投': '台灣', '雲林': '台灣',
          '嘉義': '台灣', '台南': '台灣', '高雄': '台灣', '屏東': '台灣',
          '宜蘭': '台灣', '澎湖': '台灣', '金門': '台灣', '馬祖': '台灣',
          '阿里山': '台灣', '日月潭': '台灣', '墾丁': '台灣',
        };

        let _lionCity = '';
        // Pass 1: city AND same-country match
        for (const [kw, city] of Object.entries(_lionCityPatterns)) {
          if (_lionCitySearchText.includes(kw)) {
            const cityCountry = _lionCityToCountry[city];
            if (!cityCountry || !_lionCountry || cityCountry === _lionCountry) {
              _lionCity = city;
              break;
            }
          }
        }
        // Pass 2: airport-code hint (same-country only)
        if (!_lionCity) {
          for (const code of _lionFlightAirportCodes) {
            const city = _lionAirportCodeToCity[code];
            if (city) {
              const cityCountry = _lionCityToCountry[city];
              if (!cityCountry || !_lionCountry || cityCountry === _lionCountry) {
                _lionCity = city;
                break;
              }
            }
          }
        }
        // Pass 3: any match (legacy behavior — prevents empty city for edge cases)
        if (!_lionCity) {
          for (const [kw, city] of Object.entries(_lionCityPatterns)) {
            if (_lionCitySearchText.includes(kw)) { _lionCity = city; break; }
          }
        }
        if (!_lionCity) _lionCity = _lionCountry;

        // v68: if city is known but country is empty (e.g. title says 南法/蔚藍海岸 but
        // none of those map to a country pattern, while the itinerary mentioned 尼斯),
        // reverse-lookup the country from the city. Prevents destinationCountry='' on
        // tours whose marketing title uses a region phrase instead of a country name.
        if (_lionCity && !_lionCountry) {
          const inferredCountry = _lionCityToCountry[_lionCity];
          if (inferredCountry) {
            _lionCountry = inferredCountry;
            console.log(`[MasterAgent] City→Country backfill: ${_lionCity} → ${inferredCountry}`);
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

        // Map flights — use FlightAgent's expected field names (arrivalTime,
        // arrivalAirport, flightNo, duration). Round 66: previously we emitted
        // `arriveTime`/`arriveAirport` which FlightAgent's JSON schema ignored,
        // causing the LLM to fabricate values (or output "<UNKNOWN>" placeholders).
        const _lionFlights: any[] = [];
        if (lionData.outboundFlight.airline) {
          _lionFlights.push({
            type: 'outbound',
            airline: lionData.outboundFlight.airline,
            flightNo: '', // LionTravel API doesn't expose flight numbers publicly
            departureTime: lionData.outboundFlight.departureTime,
            arrivalTime: lionData.outboundFlight.arriveTime,
            duration: '',
            departureAirport: lionData.outboundFlight.departureAirport,
            arrivalAirport: lionData.outboundFlight.arriveAirport,
          });
        }
        if (lionData.returnFlight.airline) {
          _lionFlights.push({
            type: 'return',
            airline: lionData.returnFlight.airline,
            flightNo: '',
            departureTime: lionData.returnFlight.departureTime,
            arrivalTime: lionData.returnFlight.arriveTime,
            duration: '',
            departureAirport: lionData.returnFlight.departureAirport,
            arrivalAirport: lionData.returnFlight.arriveAirport,
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
            destinationCity: _lionCity,
            departureCity: lionData.departureCity || '',
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
          // Round 80.16 P1b fix: pre-populate includes/excludes from Lion's
          // featuresHtml (parsed bullet lists under "費用包含" / "費用不包含").
          // Previously these were empty for URL-mode and DetailsSkill couldn't
          // recover them reliably from raw text.
          includes: extractCostSectionsFromFeaturesHtml(lionData.featuresHtml).includes,
          excludes: extractCostSectionsFromFeaturesHtml(lionData.featuresHtml).excludes,
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
          // Round 80.17: store structured fields used by finalData
          // assembly downstream (basePrice / startDate / endDate /
          // promotionText / destinationAirport).
          lionGoDate: lionData.goDate || null,
          lionBackDate: lionData.backDate || null,
          promotionText:
            ((lionData as any).pricing?.promotionText ||
              (lionData as any).promotionText ||
              (lionData.notices?.[0]?.chineseTitle?.includes("優惠") ? lionData.notices[0].chineseTitle : "") ||
              "")
              .toString()
              .slice(0, 255),
          destinationAirportCode: lionData.outboundFlight?.arriveAirport
            ? (lionData.outboundFlight.arriveAirport.match(/\b[A-Z]{3}\b/)?.[0] || null)
            : null,
          destinationAirportName: lionData.outboundFlight?.arriveAirport || null,
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
            const { scrapeDynamicPage } = await import('../../services/dynamicScraperService');
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
        console.warn('[MasterAgent] ⏱ P1: liontravel API FAILED — falling back to Puppeteer');
        console.warn('[MasterAgent] 🦁 Liontravel direct API failed, falling back to Puppeteer');
      }
    }
    // ─── End Round 50 ─────────────────────────────────────────────────────────

    if (!lionApiHandled) {
      // URL mode: use DynamicScraperService (Puppeteer)
      console.log("[MasterAgent] 🌐 URL mode: dynamic scraping with Puppeteer...");
      if (taskId) progressTracker.startPhase(taskId, 'dynamic_render');
      onProgress?.("rendering_page", 10);

      let scrapeResult: import('../../services/dynamicScraperService').DynamicScrapeResult | Partial<import('../../services/dynamicScraperService').DynamicScrapeResult>;
      // Overall scraping timeout: 120 seconds to allow for slow SPA sites like liontravel.com
      // liontravel.com is a React SPA: networkidle2 (~20s) + domcontentloaded fallback (~20s) + autoScroll (~30s) + screenshot (~10s) + API calls (~30s) = ~110s max
      // Round 52: Increased from 90s to 120s to ensure groupcalendarjson is captured
      const SCRAPE_TIMEOUT_MS = 120000;
      const scrapeTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`爬取逾時（${SCRAPE_TIMEOUT_MS / 1000} 秒）。請確認 URL 是否可正常存取，或改用 PDF 上傳方式。`)), SCRAPE_TIMEOUT_MS)
      );
      try {
        const { scrapeDynamicPage } = await import('../../services/dynamicScraperService');
        scrapeResult = await Promise.race([scrapeDynamicPage(url), scrapeTimeoutPromise]);
        console.log(`[MasterAgent] ✓ Dynamic scrape completed: ${scrapeResult.renderedHtml?.length || 0} chars HTML, ${scrapeResult.rawText?.length || 0} chars text`);
      } catch (scrapeErr) {
        // If it's a timeout error, re-throw immediately without fallback
        if (scrapeErr instanceof Error && scrapeErr.message.includes('爬取逾時')) {
          throw scrapeErr;
        }
        console.warn('[MasterAgent] Puppeteer scrape failed, falling back to static HTTP:', scrapeErr);
        const { scrapeStaticFallback } = await import('../../services/dynamicScraperService');
        scrapeResult = await Promise.race([scrapeStaticFallback(url), scrapeTimeoutPromise]);
      }

      if (taskId) progressTracker.completePhase(taskId, 'dynamic_render');

      // Phase 1.5: DateExtractorAgent (AI Vision) - 並行執行
      if (taskId) progressTracker.startPhase(taskId, 'date_extractor');
      onProgress?.("extracting_dates", 15);

      let extractedTourMeta: import('../dateExtractorAgent').ExtractedTourMeta | null = null;
      try {
        const { extractTourMeta } = await import('../dateExtractorAgent');
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
            const _countryExtract = seg.match(/^([一-龥]{2,8}?)(?:經典|深度|精選|探索|之旅|\d+日|\d+天)/);
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
          const { fetchLionTravelData: fetchLionPrice } = await import('../../services/lionTravelApiService');
          const lionPriceData = await fetchLionPrice(url);
          if (lionPriceData?.pricing?.adultPrice && lionPriceData.pricing.adultPrice > 0) {
            rawData.pricing.price = lionPriceData.pricing.adultPrice;
            rawData.pricing.basePrice = lionPriceData.pricing.adultPrice;
            rawData.pricing.currency = lionPriceData.pricing.currencyCode || 'TWD';
            // Also fix productCode and departureCity
            if (lionPriceData.tourId) rawData.basicInfo.productCode = lionPriceData.tourId;
            if (lionPriceData.departureCity) (rawData.location as any).departureCity = lionPriceData.departureCity;
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
          // v80.24: was hardcoding stars=4 for every Lion-API hotel which is
          // misleading and was a complaint Jeff raised ("幾星都沒說"). Now
          // leave stars=0 so HotelAgent / contentAnalyzer can fill from the
          // actual brand mapping, or UI can show "—" instead of fake "★★★★".
          const hotelNames = Array.from(new Set(days.map((d: any) => d.HotelName).filter(Boolean))) as string[];
          if (hotelNames.length > 0 && rawData.hotels.length === 0) {
            rawData.hotels = hotelNames.map((name: string) => ({ name, type: '飯店', stars: 0 }));
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
  phaseTimer.end('P1_scrape');
  console.log("[MasterAgent] ✓ Phase 1 completed: Web scraping");

  return { rawData };
}
