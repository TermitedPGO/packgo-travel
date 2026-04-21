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
  
  try {
    // Create Master Agent
    const masterAgent = new MasterAgent();
    
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
    
    // Save to database
    await job.updateProgress({
      step: "saving",
      progress: 95,
      message: "Saving tour to database...",
      timestamp: Date.now(),
      overallProgress: 95,
    });
    
    const tour = await createTour({
      title: tourData.title,
      description: tourData.description,
      productCode: tourData.productCode,
      destinationCountry: tourData.destinationCountry,
      destinationCity: tourData.destinationCity,
      departureCity: tourData.departureCity,
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
      flights: tourData.flights, // 航班資訊
      // Fix 4 (Round 62): Pass new fields from masterAgent Fix 3
      hotelImages: tourData.hotelImages,
      galleryImages: tourData.galleryImages,
      attractions: tourData.attractions,
      
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
              await createDeparture({
                tourId: tour.id,
                departureDate,
                returnDate,
                adultPrice: adultPriceForDep,
                childPriceWithBed: childPriceWithBedFinal,
                childPriceNoBed: childPriceNoBedFinal,
                infantPrice: infantPriceFinal,
                totalSlots: dep.totalSeats || 20,
                bookedSlots: Math.max(0, (dep.totalSeats || 20) - (dep.availableSeats || 0)),
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
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
