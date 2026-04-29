import { Job } from "bullmq";
import {
  TourGenerationJobData,
  TourGenerationResult,
  addTourTranslationJob,
} from "./queue";
import { MasterAgent } from "./agents/masterAgent";
import { createTour, saveCalibrationResult, updateTour, createDeparture, getTourDepartures } from "./db";
import { searchUnsplashPhotos } from "./services/unsplashService";

/**
 * Internal tour generation function called by worker
 * Uses multi-agent system to generate tour from URL
 * 
 * @param url - Source URL to scrape
 * @param userId - User ID who requested the generation
 * @param job - BullMQ job for progress tracking
 */
export async function generateTourFromUrlInternal(
  url: string,
  userId: number,
  job: Job<TourGenerationJobData, TourGenerationResult>,
  forceRegenerate: boolean = false,
  isPdf: boolean = false,
  supplementUrl?: string
): Promise<TourGenerationResult> {
  console.log("[TourGenerator] Starting tour generation...");
  console.log("[TourGenerator] URL:", url);
  console.log("[TourGenerator] User ID:", userId);
  console.log("[TourGenerator] Force Regenerate:", forceRegenerate);
  console.log("[TourGenerator] Is PDF:", isPdf);
  console.log("[TourGenerator] Supplement URL:", supplementUrl || 'none');

  // Round 72: track tourData across the outer try so the catch can clean up
  // orphaned R2 assets if createTour (or any sync post-insert step) throws
  // after masterAgent has already uploaded images.
  let lastKnownTourData: any = null;
  let masterAgentRef: MasterAgent | null = null;

  try {
    // Create Master Agent
    const masterAgent = new MasterAgent();
    masterAgentRef = masterAgent;
    
    // Generate taskId for progress tracking
    const taskId = `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Import progressTracker for getting partial results
    const { progressTracker } = await import("./agents/progressTracker");
    
    // Execute tour generation with progress tracking
    const result = await masterAgent.execute(url, userId, async (step, percentage) => {
      // Get partial results and phases from progressTracker
      const progressData = progressTracker.getProgress(taskId);
      const partialResults = progressData?.partialResults;
      // Build phases array from progressTracker data
      const phases = progressData?.phases ? Object.entries(progressData.phases).map(([id, phase]: [string, any]) => ({
        id,
        status: phase.status as 'pending' | 'running' | 'completed' | 'failed',
        progress: phase.progress || 0,
        currentTask: phase.currentTask,
        error: phase.error,
        startTime: phase.startTime,
        endTime: phase.endTime,
      })) : undefined;
      
      // Update job progress with partial results and phases
      await job.updateProgress({
        step,
        progress: percentage,
        message: `Processing: ${step}`,
        timestamp: Date.now(),
        partialResults: partialResults || undefined,
        phases,
        overallProgress: percentage,
      });
    }, taskId, forceRegenerate, isPdf, supplementUrl);
    
    if (!result.success || !result.data) {
      throw new Error(result.error || "Tour generation failed");
    }

    const tourData = result.data;
    lastKnownTourData = tourData; // Round 72: track for rollback
    
    // Save to database
    await job.updateProgress({
      step: "saving",
      progress: 95,
      message: "Saving tour to database...",
      timestamp: Date.now(),
      overallProgress: 95,
    });
    
    // ─────────────────────────────────────────────────────────────────────
    // Derive legacy flight / hotel columns from the JSON blobs so we don't
    // leave the denormalised DB columns empty. Without this the admin list
    // view, search filters, and exports that read these columns all show
    // "-" even though the data is available in the JSON blob.
    // ─────────────────────────────────────────────────────────────────────
    const safeJson = (raw: any): any => {
      if (!raw) return null;
      if (typeof raw === "object") return raw;
      try { return JSON.parse(raw); } catch { return null; }
    };

    const flightsJson = safeJson(tourData.flights);
    const hotelsJson = safeJson(tourData.hotels);
    const hotelsArray: any[] = Array.isArray(hotelsJson) ? hotelsJson : [];

    // Placeholder hotel entries — "機上" (in-flight overnight), "TBA", "未定" etc.
    // These appear as legitimate-looking hotel objects in the JSON (with `stars: "待確認"`)
    // but aren't real accommodation. Skip them when picking a representative hotel.
    const isPlaceholderHotel = (h: any): boolean => {
      if (!h || typeof h !== "object") return true;
      const name = typeof h.name === "string" ? h.name.trim() : "";
      if (!name) return true;
      return (
        name === "機上" ||
        name === "TBA" ||
        name === "未定" ||
        name === "待確認" ||
        name === "尚未安排" ||
        name.includes("國際航線") ||
        name.includes("飛行途中")
      );
    };
    const realHotels = hotelsArray.filter((h) => !isPlaceholderHotel(h));
    const firstHotel = realHotels[0] || hotelsArray[0] || null;

    // Grade extraction — the `stars` field from hotelsAgent is a pre-formatted string like
    // "四星級" / "五星級" / "三星級至四星級" / "待確認", NOT a number. Previous code did
    // `${stars}星級` which produced the nonsensical "四星級星級". Treat `stars` as a display
    // string, only discard explicit placeholders.
    const cleanStars = (raw: any): string | null => {
      if (raw === null || raw === undefined) return null;
      const t = String(raw).trim();
      if (!t) return null;
      if (["待確認", "TBA", "未定", "尚未安排", "-"].includes(t)) return null;
      // Leading digits like "4" → "四星級" mapping for the rare case the agent returns a number
      const digitMap: Record<string, string> = { "3": "三星級", "4": "四星級", "5": "五星級" };
      if (digitMap[t]) return digitMap[t];
      return t;
    };

    let hotelGrade: string | null = null;
    for (const h of realHotels) {
      const s = cleanStars(h?.stars);
      if (s) { hotelGrade = s; break; }
    }
    // Fallback: any hotel entry (including placeholders — sometimes 機上 has a real star rating
    // attached by mistake, but still better than null)
    if (!hotelGrade) {
      for (const h of hotelsArray) {
        const s = cleanStars(h?.stars);
        if (s) { hotelGrade = s; break; }
      }
    }
    // Final fallback: derive grade from hotel-name keyword match — covers the case where
    // the agent populated `name` but left `stars` as "待確認".
    if (!hotelGrade && firstHotel?.name && typeof firstHotel.name === "string") {
      const upper = firstHotel.name.toUpperCase();
      const hasAny = (patterns: RegExp[]) => patterns.some((r) => r.test(upper));
      if (
        hasAny([
          /五星/, /FIVE.?STAR/i,
          /GRAND HYATT/, /MANDARIN ORIENTAL/, /FOUR SEASONS/,
          /RITZ.?CARLTON/, /PENINSULA/, /ST\.? ?REGIS/,
          /SHERATON GRAND/, /CONRAD/, /PARK HYATT/,
          /INTERCONTINENTAL/, /WALDORF/, /PULLMAN/,
          /SHANGRI.?LA/, /W HOTEL/, /REGENT/,
        ])
      ) {
        hotelGrade = "五星級";
      } else if (
        hasAny([
          /四星/, /FOUR.?STAR/i,
          /MARRIOTT/, /HYATT REGENCY/, /SHERATON/,
          /CROWNE PLAZA/, /DOUBLETREE/, /NOVOTEL/,
          /RADISSON BLU/, /\bVOCO\b/, /\bINDIGO\b/,
          /\bMOXY\b/, /MANTRA/, /SCANDIC/, /\bTHON\b/,
          /RAMADA PLAZA/, /WYNDHAM/, /HILTON GARDEN/,
          /PULLMAN/, /MERCURE/,
        ])
      ) {
        hotelGrade = "四星級";
      } else if (
        hasAny([
          /三星/, /THREE.?STAR/i,
          /HYATT PLACE/, /HOLIDAY INN/, /BEST WESTERN/,
          /COURTYARD/, /\bIBIS\b/, /COMFORT/, /HAMPTON INN/,
          /\bTRYP\b/, /RAMADA(?! PLAZA)/, /\bQUALITY\b/,
        ])
      ) {
        hotelGrade = "三星級";
      }
    }

    const outbound = flightsJson?.outbound || null;
    const inbound = flightsJson?.inbound || null;
    const rawAirline = flightsJson?.extra?.airline || flightsJson?.airline || null;

    // Round 66 safety net: strip "<UNKNOWN>" / "UNKNOWN" / "<TBA>" style placeholders
    // that occasionally leak from Claude Haiku when given sparse flight data.
    // The FlightAgent already sanitizes, this is defense-in-depth before DB write.
    const PLACEHOLDER_RE = /^\s*<?(UNKNOWN|TBA|N\/A|未知|unknown)>?\s*$/i;
    const stripPlaceholder = (v: any): string | null => {
      if (v === null || v === undefined) return null;
      if (typeof v !== "string") return v;
      return PLACEHOLDER_RE.test(v.trim()) ? null : v;
    };
    const stripLeg = (leg: any) => {
      if (!leg || typeof leg !== "object") return leg;
      const out: any = { ...leg };
      for (const k of Object.keys(out)) out[k] = stripPlaceholder(out[k]);
      return out;
    };
    const cleanOutbound = stripLeg(outbound);
    const cleanInbound = stripLeg(inbound);
    const airline = stripPlaceholder(rawAirline);

    // Airport code — 3-letter IATA if departurePoint/departureAirport contains one
    const extractAirportCode = (s: string | null | undefined): string | null => {
      if (!s || typeof s !== "string") return null;
      const m = s.match(/\b([A-Z]{3})\b/);
      return m ? m[1] : null;
    };
    const departureAirportCode =
      extractAirportCode(outbound?.departurePoint || outbound?.departureAirport) || null;

    const tour = await createTour({
      title: tourData.title,
      description: tourData.description,
      productCode: tourData.productCode,
      destinationCountry: tourData.destinationCountry,
      destinationCity: tourData.destinationCity,
      departureCity: tourData.departureCity,
      departureAirportCode,
      departureAirportName: outbound?.departurePoint || outbound?.departureAirport || null,
      duration: tourData.days,
      nights: tourData.nights,
      price: tourData.price,
      destination: tourData.destinationCity || tourData.destinationCountry, // Legacy field for compatibility
      tags: JSON.stringify(tourData.tags),

      // Hero section
      heroImage: tourData.heroImage,
      heroImageAlt: tourData.heroImageAlt,
      heroSubtitle: tourData.heroSubtitle,

      // Color theme and features
      colorTheme: tourData.colorTheme,
      keyFeatures: tourData.keyFeatures,
      // Round 71: previously dropped on the floor — createTour never saw poeticTitle,
      // so DB rows had poeticTitle=null even though ContentAnalyzerAgent generated it.
      poeticTitle: tourData.poeticTitle,
      poeticContent: tourData.poeticContent,
      // Round 74: poeticSubtitle was also dropped — ContentAnalyzer generates it
      // but nothing downstream surfaced it until this fix.
      poeticSubtitle: (tourData as any).poeticSubtitle || null,
      featureImages: tourData.featureImages,
      highlights: tourData.highlights,

      // Detailed content from agents (CRITICAL: These fields were missing!)
      itineraryDetailed: tourData.itineraryDetailed, // 每日行程
      // Fix 4 (Round 62): dailyItinerary dual-write for legacy field compatibility
      dailyItinerary: tourData.itineraryDetailed, // Legacy field — same data as itineraryDetailed
      costExplanation: tourData.costExplanation, // 費用說明
      noticeDetailed: tourData.noticeDetailed, // 注意事項
      hotels: tourData.hotels, // 飯店介紹
      meals: tourData.meals, // 餐飲介紹
      // Round 66: recursively sanitize placeholder strings anywhere in the flights
      // JSON blob before persisting, so the detail page never renders "<UNKNOWN>".
      flights: (() => {
        const recurse = (v: any): any => {
          if (v === null || v === undefined) return v;
          if (typeof v === "string") return PLACEHOLDER_RE.test(v.trim()) ? "" : v;
          if (Array.isArray(v)) return v.map(recurse);
          if (typeof v === "object") {
            const o: any = {};
            for (const k of Object.keys(v)) o[k] = recurse(v[k]);
            return o;
          }
          return v;
        };
        return recurse(tourData.flights);
      })(),
      // Fix 4 (Round 62): Pass new fields from masterAgent Fix 3
      hotelImages: tourData.hotelImages,
      galleryImages: tourData.galleryImages,
      attractions: tourData.attractions,

      // Round 74 — Legacy denormalised columns derived from the JSON blobs.
      // Admin list / search / export paths still read from these columns, so
      // leaving them null made the 10-tour comparison table look empty even
      // when flights/hotels JSON was fully populated.
      outboundAirline: airline,
      outboundFlightNo: cleanOutbound?.vehicleNo || cleanOutbound?.flightNo || null,
      outboundDepartureTime: cleanOutbound?.departureTime || null,
      outboundArrivalTime: cleanOutbound?.arrivalTime || null,
      outboundFlightDuration: cleanOutbound?.duration || null,
      inboundAirline: airline,
      inboundFlightNo: cleanInbound?.vehicleNo || cleanInbound?.flightNo || null,
      inboundDepartureTime: cleanInbound?.departureTime || null,
      inboundArrivalTime: cleanInbound?.arrivalTime || null,
      inboundFlightDuration: cleanInbound?.duration || null,
      hotelName: firstHotel?.name || null,
      hotelGrade,
      // v69: was using hotels JSON length, but that's the count of UNIQUE hotels,
      // not nightly count. A 10-day tour with 7 hotels (some 2-night stays) would
      // record hotelNights=7 even though the customer has 9 actual hotel nights.
      // The convention for our N-day tours is: hotelNights = duration - 1
      // (one less than total days, since the last day is travel-back). If duration
      // is missing, fall back to hotels JSON length so we never write null.
      hotelNights: (typeof tourData.days === "number" && tourData.days > 1)
        ? tourData.days - 1
        : (Array.isArray(hotelsJson) ? hotelsJson.length : null),

      // Additional fields
      // Status is determined by calibration verdict:
      // approved → active, review → pending_review, rejected → inactive
      status: (result.calibrationReport?.verdict === 'approved'
        ? 'active'
        : result.calibrationReport?.verdict === 'rejected'
        ? 'inactive'
        : 'pending_review') as any,
      featured: 0, // 0 = false, 1 = true
      promotionText: "",

      // Metadata
      createdBy: userId,
      sourceUrl: tourData.sourceUrl,
      originalityScore: tourData.originalityScore.toString(), // Convert to string for decimal field
      isAutoGenerated: 1, // Mark as auto-generated
    });
    
    console.log("[TourGenerator] Tour saved to database with ID:", tour.id);
    
    // ── B3 Fix: Auto-supplement cover image via Unsplash (non-blocking) ──
    // Always supplement imageUrl (list thumbnail) regardless of heroImage (detail page banner)
    console.log(`[TourGenerator] B3: Checking imageUrl - tourData.imageUrl=${(tourData as any).imageUrl}, destination=${tourData.destinationCity || tourData.destinationCountry}`);
    if (!(tourData as any).imageUrl) {
      const destination = tourData.destinationCity || tourData.destinationCountry || '';
      if (destination) {
        (async () => {
          try {
            // Try English keyword first, fallback to destination name
            const englishKeywords: Record<string, string> = {
              '英國': 'United Kingdom London', '愛爾蘭': 'Ireland landscape', '法國': 'France Paris',
              '義大利': 'Italy Rome', '日本': 'Japan travel', '韓國': 'Korea Seoul',
              '泰國': 'Thailand travel', '越南': 'Vietnam travel', '帛琉': 'Palau ocean',
              '台灣': 'Taiwan travel', '美國': 'USA travel', '德國': 'Germany travel',
            };
            const searchQuery = englishKeywords[destination] || destination + ' travel landscape';
            const images = await searchUnsplashPhotos(searchQuery, 1);
            if (images.length > 0) {
              await updateTour(tour.id, { imageUrl: images[0] });
              console.log(`[TourGenerator] ✓ Auto-supplemented cover image for tour ${tour.id}: ${images[0].substring(0, 60)}...`);
            }
          } catch (imgErr) {
            console.warn('[TourGenerator] Cover image supplement failed (non-fatal):', imgErr);
          }
        })();
      }
    }
    
    // ── B4 Fix: Save extractedDepartures from DateExtractor (non-blocking) ──
    const _extractedMeta = (tourData as any).extractedTourMeta;
    console.log(`[TourGenerator] B4: extractedTourMeta=${_extractedMeta ? JSON.stringify(_extractedMeta).substring(0,100) : 'null'}`);
    if (_extractedMeta && _extractedMeta.departureDates?.length > 0) {
      try {
        await updateTour(tour.id, {
          extractedDepartures: JSON.stringify(_extractedMeta),
        } as any);
        console.log(`[TourGenerator] ✓ Saved extractedDepartures for tour ${tour.id}: ${_extractedMeta.departureDates.length} dates`);
      } catch (depErr) {
        console.warn('[TourGenerator] extractedDepartures save failed (non-fatal):', depErr);
      }
    }
    
    // ── B5: Write lionAllDepartures to tourDepartures table (Round 52) ─────────────────
    const _lionAllDepartures = (tourData as any).lionAllDepartures as Array<{
      groupId: string;
      date: string;       // e.g. "2026/07/06"
      price: number;
      currencyCode: string;
      availableSeats: number;
      totalSeats: number;
      status: string;
    }> | null;
    // Round 60: Extract child/infant pricing from lionPricing
    const _lionPricing = (tourData as any).lionPricing as {
      adultPrice: number;
      childWithBed: number;
      childNoBed: number;
      babyPrice: number;
    } | null;
    console.log(`[TourGenerator] B5: lionAllDepartures=${_lionAllDepartures ? _lionAllDepartures.length + ' entries' : 'null'}`);
    if (_lionAllDepartures && _lionAllDepartures.length > 0) {
      (async () => {
        try {
          const { tourDepartures: departuresTable } = await import('../drizzle/schema');
          const { eq } = await import('drizzle-orm');
          const { getDb } = await import('./db');
          const drizzleDb = await getDb();

          if (!drizzleDb) {
            console.warn('[TourGenerator] B5: DB not available, skipping departure insert');
            return;
          }

          // Clear existing departures for this tour (so re-generation always updates)
          const existingDeps = await getTourDepartures(tour.id);
          if (existingDeps.length > 0) {
            await drizzleDb.delete(departuresTable).where(eq(departuresTable.tourId, tour.id));
            console.log(`[TourGenerator] B5: Cleared ${existingDeps.length} old departure(s) for tour ${tour.id}`);
          }

          // Insert fresh departures from liontravel API
          let inserted = 0;
          for (const dep of _lionAllDepartures) {
            try {
              // Parse date: "2026/07/06" → Date object
              const [year, month, day] = dep.date.split('/').map(Number);
              if (!year || !month || !day) continue;
              const departureDate = new Date(year, month - 1, day, 8, 0, 0); // 08:00 departure
              const returnDate = new Date(year, month - 1, day + (tourData.nights || tourData.days - 1 || 0), 20, 0, 0);
              // Map status: "報名" → "open", "客滿" → "full", "取消" → "cancelled"
              const statusMap: Record<string, 'open' | 'full' | 'cancelled' | 'confirmed'> = {
                '報名': 'open',
                '客滿': 'full',
                '取消': 'cancelled',
                '確定': 'confirmed',
              };
              const mappedStatus = statusMap[dep.status] || 'open';
              // Round 61: Use LionTravel API pricing if available, otherwise apply formula
              const adultPriceForDep = Math.round(dep.price);
              const childWithBedFromApi = _lionPricing?.childWithBed && _lionPricing.childWithBed > 0 ? Math.round(_lionPricing.childWithBed) : null;
              const childNoBedFromApi = _lionPricing?.childNoBed && _lionPricing.childNoBed > 0 ? Math.round(_lionPricing.childNoBed) : null;
              const babyFromApi = _lionPricing?.babyPrice && _lionPricing.babyPrice > 0 ? Math.round(_lionPricing.babyPrice) : null;
              // Fallback formula: childWithBed = adult × 0.9, childNoBed = adult × 0.75, infant = adult × 0.1
              const childPriceWithBedFinal = childWithBedFromApi ?? Math.round(adultPriceForDep * 0.9);
              const childPriceNoBedFinal = childNoBedFromApi ?? Math.round(adultPriceForDep * 0.75);
              const infantPriceFinal = babyFromApi ?? Math.round(adultPriceForDep * 0.1);
              // NOTE: LionTravel's public calendar API returns `AvailableVacancy` as a
              // placeholder (always = TotalVacnacy - 1 across all dates), NOT real
              // booking counts. Treat imported departures as 0 bookings — they are
              // fresh scrapes and we have no authoritative sales data for them.
              // Using availableSeats would surface the "剩 19 位" placeholder to users.
              await createDeparture({
                tourId: tour.id,
                departureDate,
                returnDate,
                adultPrice: adultPriceForDep,
                childPriceWithBed: childPriceWithBedFinal,
                childPriceNoBed: childPriceNoBedFinal,
                infantPrice: infantPriceFinal,
                totalSlots: dep.totalSeats || 20,
                bookedSlots: 0,
                status: mappedStatus,
                currency: dep.currencyCode || 'TWD',
                notes: `lionGroupId: ${dep.groupId}`,
              });
              inserted++;
            } catch (singleDepErr) {
              // Non-critical — skip individual departure errors
            }
          }
          console.log(`[TourGenerator] ✓ B5: Inserted ${inserted}/${_lionAllDepartures.length} liontravel departures for tour ${tour.id}`);
        } catch (b5Err) {
          console.warn('[TourGenerator] B5 lionDepartures save failed (non-fatal):', b5Err);
        }
      })();
    }

    // Save calibration result to DB (non-blocking)
    if (result.calibrationReport) {
      const cr = result.calibrationReport;
      // Save to calibrationResults table (detailed history)
      saveCalibrationResult({
        tourId: tour.id,
        contentFidelityScore: cr.contentFidelityScore,
        translationScore: cr.translationScore,
        imageScore: cr.imageScore,
        completenessScore: cr.completenessScore,
        marketingScore: cr.marketingScore,
        totalScore: cr.totalScore,
        verdict: cr.verdict,
        issues: JSON.stringify(cr.issues),
        autoFixesApplied: JSON.stringify(cr.autoFixesApplied),
      }).catch((err) => {
        console.warn('[TourGenerator] Failed to save calibration result:', err);
      });
      // Also save summary fields to tours table for quick display in admin UI
      updateTour(tour.id, {
        calibrationScore: cr.totalScore,
        calibrationVerdict: cr.verdict,
        calibrationReport: JSON.stringify({ issues: cr.issues, autoFixesApplied: cr.autoFixesApplied }),
        calibratedAt: new Date(),
      } as any).catch((err) => {
        console.warn('[TourGenerator] Failed to save calibration fields to tours:', err);
      });
    }
    
    await job.updateProgress({
      step: "completed",
      progress: 100,
      message: "Tour generation completed!",
      timestamp: Date.now(),
      overallProgress: 100,
    });
    
    // Round 71: queue translation via BullMQ instead of fire-and-forget.
    // BUG-006 added addTourTranslationJob specifically for this purpose (retries +
    // failure tracking). Previous direct translateTour() call had no retry on
    // transient failures and lost translations on worker restart.
    try {
      await addTourTranslationJob({
        tourId: tour.id,
        targetLanguages: ['en'],
        sourceLanguage: 'zh-TW',
        userId,
      });
      console.log(`[TourGenerator] ✓ Queued auto-translation for tour ${tour.id} → en`);
    } catch (err) {
      console.warn(`[TourGenerator] Failed to queue translation for tour ${tour.id}:`, err);
    }
    
    return {
      success: true,
      tourId: tour.id,
    };
  } catch (error) {
    console.error("[TourGenerator] Error:", error);

    // Round 72: If masterAgent succeeded (so R2 images exist) but createTour
    // or a sync post-insert step threw, sweep the orphaned R2 assets.
    // masterAgent's own catch handles the case where masterAgent itself failed.
    if (lastKnownTourData && masterAgentRef) {
      try {
        await masterAgentRef.rollback(lastKnownTourData);
      } catch (cleanupErr) {
        console.warn("[TourGenerator] Post-generation rollback hit an error (non-fatal):", cleanupErr);
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
