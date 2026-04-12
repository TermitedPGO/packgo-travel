import { Job } from "bullmq";
import {
  TourGenerationJobData,
  TourGenerationResult,
} from "./queue";
import { MasterAgent } from "./agents/masterAgent";
import { createTour, saveCalibrationResult, updateTour } from "./db";
import { translateTour } from "./translation";
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
      poeticContent: tourData.poeticContent,
      featureImages: tourData.featureImages,
      highlights: tourData.highlights,
      
      // Detailed content from agents (CRITICAL: These fields were missing!)
      itineraryDetailed: tourData.itineraryDetailed, // 每日行程
      costExplanation: tourData.costExplanation, // 費用說明
      noticeDetailed: tourData.noticeDetailed, // 注意事項
      hotels: tourData.hotels, // 飯店介紹
      meals: tourData.meals, // 餐飲介紹
      flights: tourData.flights, // 航班資訊
      
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
    
    // 非同步觸發翻譯（不阻塞生成流程）
    translateTour(tour.id, ['en'], 'zh-TW', userId)
      .then((result) => {
        if (result.success) {
          console.log(`[TourGenerator] Auto-translated tour ${tour.id} to: ${result.translatedLanguages.join(', ')}`);
        } else {
          console.warn(`[TourGenerator] Auto-translation failed for tour ${tour.id}:`, result.errors);
        }
      })
      .catch((err) => {
        console.warn(`[TourGenerator] Auto-translation error for tour ${tour.id}:`, err);
      });
    
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
