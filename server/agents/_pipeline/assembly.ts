/**
 * Pipeline Phase 5 + 6: Final Data Assembly + Calibration + Self-Repair
 *
 * Extracted from masterAgent.ts during v2 Wave 2 Module 2.9 split.
 *
 * Phase 5 — assembles the final tour-data object from all pipeline outputs
 *           (rawData, analyzedContent, colorTheme, fanout results). Includes
 *           heavy fallback logic for duration, country, keyFeatures, meals
 *           etc. that runs unconditionally as a safety net.
 *
 * Phase 6 — calibration QA gate + price rescue + self-repair loop (up to 2
 *           rounds, score threshold 70, 60s timeout). Re-runs
 *           ContentAnalyzer + ItineraryUnified + DetailsSkill on score < 70.
 *
 * Returns the final `finalData` plus calibrationReport so the supervisor can
 * cache and return.
 */

import { createChildLogger } from "../../_core/logger";
import { progressTracker } from "../progressTracker";
import { calibrateTour } from "../calibrationAgent";
import { generateSmartTags, mergeWithExistingTags } from "../../utils/tagGenerator";
import { applyLearnedSkills } from "../learningAgent";
import { TourType } from "../itineraryUnifiedAgent";
import { extractHotelBrand } from "../_helpers/hotelBrand";
import { parseLionDate, extractAirportCodeLocal } from "./types";
import type { AgentDeps, PhaseTimer, ProgressCallback } from "./types";
import type { FanoutResult } from "./fanout";

const log = createChildLogger({ module: "masterAgent/assembly" });

export interface AssemblyPhaseInput {
  url: string;
  rawData: any;
  analyzedContent: any;
  colorTheme: any;
  fanout: FanoutResult;
  userId?: number;
  taskId?: string;
  onProgress?: ProgressCallback;
  deps: AgentDeps;
  phaseTimer: PhaseTimer;
}

export interface AssemblyPhaseResult {
  finalData: any;
  calibrationReport: any;
}

export async function runAssemblyPhase(input: AssemblyPhaseInput): Promise<AssemblyPhaseResult> {
  const { url, rawData, analyzedContent, colorTheme, fanout, userId, taskId, onProgress, deps, phaseTimer } = input;
  const {
    heroImage,
    featureImages,
    featureImageObjects,
    hotelImagePool,
    mealImagePool,
    highlightImagePool,
    itineraryData,
    tourType,
    costData: costDataInitial,
    noticeData,
    hotelData,
    mealData,
    transportationData,
    hotelsArrRaw,
    mealsArrRaw,
  } = fanout;
  // costData is reassigned by the P1b fallback logic below
  let costData = costDataInitial;

  // ========================================================================
  // Phase 5: Assemble Final Data
  // ========================================================================
  phaseTimer.start('P5_assembly');
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

  // Round 80.16 P0b fix: prefer the source's authoritative title.
  // ContentAnalyzerAgent has been observed hallucinating titles (e.g.
  // a Bali tour returned "台北五日深度之旅" because the LLM saw
  // "台北出發" in the raw content). When we have a source title from
  // Lion API or PDF parsing, that's the truth — keep it as the main
  // `title`, and let `poeticTitle` carry the LLM's marketing variant
  // for hero display only.
  //
  // v80.24: that policy let供應商促銷話術 leak to PACK&GO pages
  // (「兒童最高省1萬」「春遊折3千」). New policy:
  //   1. Strip promo phrases from sourceTitle first (regex blacklist).
  //   2. If LLM title shares the same primary destination as cleaned
  //      sourceTitle, prefer LLM (it's PACK&GO-style).
  //   3. Otherwise fall back to cleaned sourceTitle.
  const sourceTitleRaw = (rawData?.basicInfo?.title || "").trim();
  const stripPromoText = (s: string): string => {
    if (!s) return s;
    return s
      // v80.24: Lion / Phoenix / Settour promo phrases — quantifier 千萬 OPTIONAL
      // (was requiring 千萬 → "春遊折3000" leaked through).
      .replace(/兒童最高省\d+[千萬]?/g, "")
      .replace(/春遊折\d+[千萬]?/g, "")
      .replace(/最高折\d+[千萬]?/g, "")
      .replace(/早鳥折\d+[千萬]?/g, "")
      .replace(/折\d+[千萬]/g, "") // standalone 折X千 (still requires unit to avoid "10折")
      .replace(/省\d+[千萬]/g, "")
      .replace(/贈\d+[人個次晚]/g, "")
      .replace(/送\d+[人個次晚]/g, "")
      .replace(/玩樂\d+/g, "") // 玩樂369 (Lion's discount badge)
      .replace(/[★☆◆◇]?保證入住/g, "")
      .replace(/[★☆]?中餐特別安排/g, "")
      .replace(/[★☆]?升等住\d+晚/g, "")
      .replace(/[★☆]/g, "")
      .replace(/(無購物|無自費|指定團|優惠團|特推|特選|促銷|破盤|早鳥|超值|爆殺)/g, "")
      // v80.24: season/edition tags
      .replace(/[冬夏春秋]季版/g, "")
      .replace(/旅展[$＄]?\d*/g, "")
      .replace(/\d+晚[五四三六七]星/g, "") // "3晚五星"
      .replace(/[（(]最高[省折][^)）]+[)）]/g, "")
      // Standalone "最高" at the start (e.g. 「最高│經典義大利」)
      .replace(/^最高[│|｜]\s*/, "")
      // Lion supplier code suffix like "(阪名)" "(YYZA)" "(26JX531CXG-T)"
      .replace(/\([一-鿿]{1,3}\)/g, "") // (阪名)
      .replace(/\([A-Z0-9-]{4,}\)/g, "") // (26JX531CXG-T)
      // Tour metadata in parens like "(雙點進出)" "(高雄來回)" "(慕尼黑來回)"
      .replace(/[（(](雙點進出|單點進出|.{2,4}來回|.{2,4}出發|餐全包|含小費|不含小費|華航直飛|長榮直飛)[)）]/g, "")
      // Multi-pipe leading/trailing
      .replace(/^\s*[｜|│]+/, "")
      .replace(/[｜|│]\s*$/, "")
      // Collapse whitespace
      .replace(/\s{2,}/g, " ")
      .trim();
  };
  const sourceTitle = stripPromoText(sourceTitleRaw);
  const llmTitle = stripPromoText(analyzedContent.title || "");
  // v80.24: was capping at 60 chars (too restrictive — PACK&GO titles can
  // legitimately reach 70 chars with multi-attraction subtitles). Bump
  // upper bound to 80 and lower to 6 (allow short city-only titles).
  // LLM title also wins over Lion sourceTitle even when longer — Lion's
  // title is usually noisier (full of pipe-separated promo bullets).
  const finalTitle = (
    llmTitle && llmTitle.length >= 6 && llmTitle.length <= 80
  )
    ? llmTitle
    : (sourceTitle || llmTitle || analyzedContent.title);
  console.log(`[MasterAgent] Title selection: source="${sourceTitleRaw.slice(0,40)}..." llm="${llmTitle.slice(0,40)}..." final="${finalTitle.slice(0,40)}..."`);

  // v80.24: derive group-size range from departures so tour-level
  // minGroupSize / maxGroupSize aren't always null (Jeff's complaint:
  // hero「人數」shows nothing). Also propagate heroSubtitle (was missing
  // → translation pipeline skipped it, EN page still showed Chinese).
  const departureSlots: number[] = (Array.isArray((rawData as any).departureDates) ? (rawData as any).departureDates : [])
    .map((d: any) => Number(d?.totalSlots ?? d?.maxParticipants ?? 0))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  const minSlots = departureSlots.length > 0 ? Math.min(...departureSlots) : null;
  const maxSlots = departureSlots.length > 0 ? Math.max(...departureSlots) : null;

  const finalData = {
    // Basic info
    poeticTitle: analyzedContent.poeticTitle, // Use ContentAnalyzerAgent's poetic title
    poeticSubtitle: (analyzedContent as any).poeticSubtitle || "",
    // (heroSubtitle assigned at the Hero section below — see line ~2316)
    title: finalTitle,
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

    // Round 80.16 P2 fix: maxParticipants was being set on rawData (from
    // lionData.totalSeats / pdfData.totalSlots) but never propagated into
    // the final tour record, so admin form always showed null.
    // v80.24: prefer derived maxSlots from departure capacity if higher
    // — gives a real number for tour cards instead of null.
    maxParticipants:
      (rawData as any).maxParticipants ||
      rawData.extractedTourMeta?.capacity?.maxParticipants ||
      maxSlots,

    // Pricing — Round 50: prefer lionPricing.adultPrice for liontravel URLs
    price: (rawData.lionPricing?.adultPrice || rawData.pricing?.price || 0),
    // Round 80.18: basePrice removed — column lives in a different
    // table, not tours. The price field is sufficient for tours.
    // Round 80.17: startDate / endDate were always empty. Pull from Lion's
    // GoDate / BackDate (format "2026/08/28") or first/last departureDates.
    startDate: parseLionDate((rawData as any).lionGoDate || (Array.isArray(rawData.departureDates) ? rawData.departureDates[0] : null)),
    endDate: parseLionDate((rawData as any).lionBackDate || (Array.isArray(rawData.departureDates) ? rawData.departureDates[rawData.departureDates.length - 1] : null)),
    // Round 80.17: promotionText from Lion's PromotionText / OrderPrice deposit description
    promotionText: ((rawData as any).promotionText || rawData.basicInfo?.promotionText || "").toString().slice(0, 255),
    // Round 80.17: destinationAirport — Lion's outboundFlight.arriveAirport
    destinationAirportCode: extractAirportCodeLocal((rawData as any).destinationAirportCode || rawData.flights?.[0]?.arrivalAirport),
    destinationAirportName: (rawData as any).destinationAirportName || rawData.flights?.[0]?.arrivalAirport || null,

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

    // Key Features — v69: was rebuilding from highlights (→ byte-identical
    // duplicate of `highlights`). ContentAnalyzer already produces a
    // structurally-distinct keyFeatures[] with poetic phrases / vertical-text
    // layout (see contentAnalyzerAgent.generateKeyFeatures). Use those
    // directly, only merging in real images. If contentAnalyzer didn't return
    // any keyFeatures, fall back to a SLIM version of highlights (drops the
    // description so it's at least visually different from highlights).
    keyFeatures: JSON.stringify(
      (analyzedContent.keyFeatures && analyzedContent.keyFeatures.length > 0
        ? analyzedContent.keyFeatures.map((kf: any, i: number) => ({
            ...kf,
            image: (kf.image && typeof kf.image === 'string' && kf.image.startsWith('http'))
              ? kf.image
              : (featureImageObjects[i]?.url
                  || highlightImagePool[i]
                  || (highlightImagePool.length > 0 ? highlightImagePool[i % highlightImagePool.length] : '')),
            imageAlt: kf.imageAlt || featureImageObjects[i]?.alt || kf.keyword || kf.title || '',
          }))
        : (analyzedContent.highlights || []).slice(0, 4).map((h: any, i: number) => ({
            title: h.title,
            subtitle: h.subtitle || (i === 0 ? "STAY" : "EXPLORE"),
            image: (h.image && typeof h.image === 'string' && h.image.startsWith('http'))
              ? h.image
              : (featureImageObjects[i]?.url
                  || highlightImagePool[i]
                  || (highlightImagePool.length > 0 ? highlightImagePool[i % highlightImagePool.length] : '')),
            imageAlt: h.imageAlt || featureImageObjects[i]?.alt || h.title || '',
          }))
      )
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
        // Round 80.20: brand was always rendering "?" because Lion API
        // doesn't return it and the LLM was never prompted for it.
        // Now derive it via regex on the hotel name — handles Marriott,
        // Hyatt, Mercure, 君悅, 涵碧樓 etc. Falls through to the LLM-
        // provided value if regex misses (boutique hotels), and to
        // null if neither — UI hides the "·brand" segment when null.
        brand: extractHotelBrand(h.name) ?? h.brand ?? null,
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
    // v80.24: order matters — keyword check is FIRST-MATCH-WINS, so put
    // longer/more specific country names BEFORE city names. Country
    // self-map ensures "斯里蘭卡九日..." matches "斯里蘭卡" before any
    // ambiguous city in rawText (Sri Lanka tours often transit via 吉隆坡
    // which polluted the city field, then countryMap fell through to "日本").
    const countryMap: Record<string, string> = {
      // Country names FIRST — these win over city names (many SE Asia
      // tours transit through KL / Singapore / HK so the city field is
      // unreliable; title is the source of truth).
      '斯里蘭卡': '斯里蘭卡', '孟加拉': '孟加拉', '巴基斯坦': '巴基斯坦',
      '不丹': '不丹', '馬爾地夫': '馬爾地夫',
      '日本': '日本', '韓國': '韓國', '泰國': '泰國', '越南': '越南',
      '義大利': '義大利', '法國': '法國', '西班牙': '西班牙', '英國': '英國',
      '德國': '德國', '瑞士': '瑞士', '奧地利': '奧地利', '荷蘭': '荷蘭',
      '土耳其': '土耳其', '希臘': '希臘', '捷克': '捷克', '克羅埃西亞': '克羅埃西亞',
      '匈牙利': '匈牙利', '波蘭': '波蘭', '葡萄牙': '葡萄牙',
      '美國': '美國', '加拿大': '加拿大', '澳洲': '澳洲', '紐西蘭': '紐西蘭',
      '新加坡': '新加坡', '馬來西亞': '馬來西亞', '印尼': '印尼', '菲律賓': '菲律賓',
      '柬埔寨': '柬埔寨', '緬甸': '緬甸', '印度': '印度', '尼泊爾': '尼泊爾',
      '埃及': '埃及', '摩洛哥': '摩洛哥', '南非': '南非', '肯亞': '肯亞', '坦尚尼亞': '坦尚尼亞',
      '秘魯': '秘魯', '智利': '智利', '巴西': '巴西', '阿根廷': '阿根廷', '哥倫比亞': '哥倫比亞', '墨西哥': '墨西哥',
      '冰島': '冰島', '挪威': '挪威', '芬蘭': '芬蘭', '瑞典': '瑞典', '丹麥': '丹麥',
      '愛爾蘭': '愛爾蘭', '比利時': '比利時', '盧森堡': '盧森堡',
      '俄羅斯': '俄羅斯', '蒙古': '蒙古',
      '杜拜': '杜拜', '阿聯': '阿聯', '阿拉伯聯合大公國': '阿聯',
      '以色列': '以色列', '約旦': '約旦', '伊朗': '伊朗',
      '帛琉': '帛琉', '帛琉島': '帛琉', '巴里島': '印尼', '巴里': '印尼', '峇里': '印尼',
      // Sri Lanka cities — added v80.24
      '可倫坡': '斯里蘭卡', '康提': '斯里蘭卡', '肯迪': '斯里蘭卡',
      '加勒': '斯里蘭卡', '迦勒': '斯里蘭卡', '雅拉': '斯里蘭卡',
      '獅子岩': '斯里蘭卡', '丹布拉': '斯里蘭卡', '錫吉里耶': '斯里蘭卡',
      // Malaysia cities — kept LOW priority (transit-only) to not override
      // a Sri Lanka tour that just happens to transit through KL.
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
      // Taiwan cities + 離島 + 景點
      '台灣': '台灣', '台北': '台灣', '台中': '台灣', '台南': '台灣', '高雄': '台灣',
      '花蓮': '台灣', '宜蘭': '台灣', '嘉義': '台灣', '屏東': '台灣', '台東': '台灣',
      '新竹': '台灣', '南投': '台灣', '雲林': '台灣', '彰化': '台灣', '基隆': '台灣',
      '苗栗': '台灣', '桃園': '台灣',
      '日月潭': '台灣', '阿里山': '台灣', '太魯閣': '台灣',
      '澎湖': '台灣', '金門': '台灣', '馬祖': '台灣',
      // v80.24: 加台灣離島 / 知名景點 (小琉球 was missing)
      '小琉球': '台灣', '琉球': '台灣', '綠島': '台灣', '蘭嶼': '台灣',
      '墾丁': '台灣', '清境': '台灣', '九份': '台灣', '淡水': '台灣',
      '北投': '台灣', '烏來': '台灣', '陽明山': '台灣', '太麻里': '台灣',
      '七星潭': '台灣', '鯉魚潭': '台灣', '合歡山': '台灣', '玉山': '台灣',
    };
    const textToSearch = [
      finalData.destinationCity || '',
      finalData.title || '',
      rawData?.location?.destinationCity || '',
      rawData?.basicInfo?.title || '',
      analyzedContent?.title || '',
      rawData?.rawText?.slice(0, 2000) || '',
    ].join(' ');

    // v80.24: was first-keyword-wins (Object.entries iteration order),
    // which broke when title contained ambiguous landmarks like
    // 「小瑞士花園」 (real bug: matched「瑞士」 before「南投」). New
    // algorithm finds the EARLIEST position in textToSearch — destinationCity
    // and title come first in the joined string, so legitimate destination
    // keywords win over noisy rawText mentions.
    let derivedCountry = '';
    let derivedPos = Infinity;
    let derivedKeyword = '';
    for (const [keyword, country] of Object.entries(countryMap)) {
      const pos = textToSearch.indexOf(keyword);
      if (pos !== -1 && pos < derivedPos) {
        // Defensive: skip if keyword is part of larger landmark name like
        // 「小瑞士」(small Switzerland-themed park) or 「日本料理」(restaurant).
        const before = textToSearch[pos - 1] || '';
        const after = textToSearch[pos + keyword.length] || '';
        const ambiguousPrefix = ['小', '新', '老', '舊'].includes(before);
        const ambiguousSuffix = ['料理', '風格', '餐廳', '街', '通'].some(s => textToSearch.slice(pos + keyword.length).startsWith(s));
        if (ambiguousPrefix || ambiguousSuffix) continue;
        derivedCountry = country;
        derivedPos = pos;
        derivedKeyword = keyword;
      }
    }
    if (derivedKeyword) {
      console.log(`[MasterAgent] Country derivation: matched "${derivedKeyword}" at pos ${derivedPos} → ${derivedCountry}`);
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

    // v80.24: backfill destinationCity from the matched keyword if empty
    // (fixes 小琉球 case where Lion gave us empty city). Don't overwrite
    // if city already set (admin may have edited).
    if (!finalData.destinationCity && derivedKeyword) {
      // Skip if keyword is a country name (e.g. 「日本」 itself) — only
      // city/landmark keywords make sense as a city.
      const isCountryKeyword = derivedKeyword === derivedCountry;
      if (!isCountryKeyword) {
        finalData.destinationCity = derivedKeyword;
        console.log(`[MasterAgent] Backfilled destinationCity from keyword: ${derivedKeyword}`);
      }
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
    const lionFI = (rawData as any).lionFeatureImages as import('../../services/lionTravelApiService').LionImage[] | undefined;
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

  // v80.24: was injecting a fake "X 精選飯店 四星級" with fabricated description
  // when hotels array was empty. Bad — Jeff's compliant: "幾星都沒說" / fabricated
  // info. We now leave the hotels array empty when no real data; the UI's
  // empty-state will say "飯店資訊將於出發前 14 天提供" rather than show fake
  // 4-star hotel cards.
  // (Original fallback removed — see git history if you need to restore.)

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
    const { addToImageLibrary } = await import('../../db');
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
  phaseTimer.end('P5_assembly');
  // Phase 6: CalibrationAgent — Automatic QA Quality Gate
  // ========================================================================
  phaseTimer.start('P6_calibration');
  let calibrationReport: any = null;
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

    phaseTimer.end('P6_calibration');
    phaseTimer.start('P6b_selfRepair');
    // ── P1-Self-Repair: if score < 70, re-run Phase 2 + Phase 4 with fix instructions ──
    const SELF_REPAIR_THRESHOLD = 70;
    const MAX_SELF_REPAIR_ROUNDS = 2;
    const SELF_REPAIR_TIMEOUT_MS = 60000; // 60 秒總時間上限

    // v67: emit a single, greppable line per tour so we can compute the
    // self-repair trigger rate from logs. Each tour logs exactly one of:
    //   [SelfRepair] score=X trigger=true   (will run repair)
    //   [SelfRepair] score=X trigger=false  (passed)
    // grep '\[SelfRepair\]' | awk to compute rate.
    const willTriggerSelfRepair = calibrationReport.totalScore < SELF_REPAIR_THRESHOLD;
    console.log(`[SelfRepair] score=${calibrationReport.totalScore} trigger=${willTriggerSelfRepair} threshold=${SELF_REPAIR_THRESHOLD}`);
    // Bump a Redis counter for daily rollup (best-effort, never throws)
    try {
      const { redis } = await import('../../redis');
      const day = new Date().toISOString().slice(0, 10);
      await redis.hincrby(`selfrepair:stats:${day}`, willTriggerSelfRepair ? 'triggered' : 'passed', 1);
      await redis.expire(`selfrepair:stats:${day}`, 30 * 24 * 60 * 60); // keep 30 days
    } catch { /* silent */ }

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
        const repairAnalysisResult = await deps.retryManager.executeWithRetry(
          () => deps.contentAnalyzerAgent.execute(rawData),
          deps.retryConfig,
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
          // v69: don't copy highlights into keyFeatures — keyFeatures has its
          // own poetic-vertical-text shape from contentAnalyzer.generateKeyFeatures()
          (finalData as any).keyFeatures = JSON.stringify(
            repairedAnalyzedContent.keyFeatures && repairedAnalyzedContent.keyFeatures.length > 0
              ? repairedAnalyzedContent.keyFeatures
              : (repairedAnalyzedContent.highlights || []).slice(0, 4).map((h: any) => ({
                  title: h.title, subtitle: h.subtitle || 'EXPLORE', image: h.image, imageAlt: h.imageAlt
                }))
          );
          console.log(`[MasterAgent] 🔧 Self-Repair: ContentAnalyzer updated title="${repairedAnalyzedContent.poeticTitle}"`);
        }
      } catch (repairErr) {
        console.warn('[MasterAgent] Self-Repair ContentAnalyzer failed (non-fatal):', repairErr);
      }

      // Re-run Phase 4: ItineraryUnifiedAgent
      console.log('[MasterAgent] 🔧 Self-Repair: Re-running ItineraryUnifiedAgent...');
      try {
        const repairItineraryResult = await deps.itineraryUnifiedAgent.execute(rawData);
        if (repairItineraryResult.success && repairItineraryResult.data?.polishedItineraries && repairItineraryResult.data.polishedItineraries.length > 0) {
          const { polishedItineraries: repairedItineraries } = repairItineraryResult.data;
          // Re-assign images
          const { assignItineraryImages } = await import('../../services/itineraryImageService');
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

      // v73 Self-Repair: also re-run DetailsSkill so hotel / meal / cost /
      // notice issues (e.g. "hotelImages empty", "meals missing") have a
      // chance to be fixed. Previously the loop only re-ran Phase 2 +
      // Phase 4 (ContentAnalyzer + Itinerary) and never re-ran the agent
      // that actually populates hotels/meals/costs, so calibration scores
      // for those checks stayed identical across rounds — wasted compute.
      console.log('[MasterAgent] 🔧 Self-Repair: Re-running DetailsSkill...');
      try {
        const repairDetails = await deps.retryManager.executeWithRetry(
          () => deps.detailsSkill.executeAllCombined(rawData),
          deps.retryConfig,
          'DetailsSkill-SelfRepair'
        );
        const repairData = repairDetails?.data;
        if (repairData) {
          if (repairData.hotels !== undefined) (finalData as any).hotels = JSON.stringify(repairData.hotels);
          if (repairData.meals !== undefined) (finalData as any).meals = JSON.stringify(repairData.meals);
          if (repairData.costs !== undefined) (finalData as any).costExplanation = JSON.stringify(repairData.costs);
          if (repairData.notices !== undefined) (finalData as any).noticeDetailed = JSON.stringify(repairData.notices);
          console.log('[MasterAgent] 🔧 Self-Repair: DetailsSkill updated hotels/meals/costs/notices');
        }
      } catch (repairErr) {
        console.warn('[MasterAgent] Self-Repair DetailsSkill failed (non-fatal):', repairErr);
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

  return { finalData, calibrationReport };
}
