/**
 * Image Intelligence Service
 *
 * Unified image source management with priority ordering:
 *   1. imageLibrary (previously used images — most relevant)
 *   2. PDF-extracted images (tour operator's own photos)
 *   3. Google Places Photos (place-specific, high quality)
 *   4. Unsplash (general travel/landscape fallback)
 *   5. null (caller decides on placeholder)
 */

import { getImageLibrary } from "../db";
import { searchUnsplashPhotos } from "./unsplashService";
import type { ExtractedPdfImage } from "./pdfImageExtractor";
import { classifyImageBySize } from "./pdfImageExtractor";
import type { VisionAnalysisResult } from "./visionAnalysisService";

export interface ImageSearchResult {
  url: string;
  source: "pdf" | "google_places" | "unsplash" | "library";
  relevanceScore: number; // 0-100
  tags: string[];
}

export interface FindBestImageOptions {
  tourId?: number;
  pdfImages?: ExtractedPdfImage[];
  preferredType?: "hero" | "feature" | "hotel" | "activity";
  /** Already-uploaded PDF image URLs (post-upload) */
  pdfImageUrls?: Array<{
    url: string;
    type: "hero" | "feature" | "other";
    pageNumber: number;
  }>;
}

/**
 * Find the best available image for a given query string.
 *
 * Priority:
 *   1. imageLibrary DB (tagged search)
 *   2. pdfImageUrls (already uploaded from PDF)
 *   3. Google Places Photos
 *   4. Unsplash search
 *   5. null
 */
export async function findBestImage(
  query: string,
  options: FindBestImageOptions = {}
): Promise<ImageSearchResult | null> {
  const { tourId, pdfImageUrls, preferredType } = options;

  // ── 1. imageLibrary ──────────────────────────────────────────────────────
  try {
    const libraryResults = await getImageLibrary({
      search: query,
      tourId,
      limit: 5,
    });

    if (libraryResults.length > 0) {
      const best = libraryResults[0];
      return {
        url: best.url,
        source: "library",
        relevanceScore: 90,
        tags: tryParseJsonArray(best.tags),
      };
    }
  } catch (err) {
    console.warn("[ImageIntelligence] imageLibrary search failed:", err);
  }

  // ── 2. PDF-extracted images (already uploaded) ───────────────────────────
  if (pdfImageUrls && pdfImageUrls.length > 0) {
    const typeMatch = pdfImageUrls.find(
      (img) => !preferredType || img.type === preferredType || img.type === "feature"
    );
    if (typeMatch) {
      return {
        url: typeMatch.url,
        source: "pdf",
        relevanceScore: 80,
        tags: [query],
      };
    }
  }

  // ── 3. Google Places ──────────────────────────────────────────────────────
  try {
    const { searchPlacePhotos } = await import("./googlePlacesService");
    const placePhotos = await searchPlacePhotos(query, 1);
    if (placePhotos.length > 0) {
      return {
        url: placePhotos[0].url,
        source: "google_places",
        relevanceScore: 75,
        tags: [query, "google_places"],
      };
    }
  } catch (err) {
    console.warn("[ImageIntelligence] Google Places search failed:", err);
  }

  // ── 4. Unsplash ───────────────────────────────────────────────────────────
  try {
    const unsplashUrls = await searchUnsplashPhotos(query, 1);
    if (unsplashUrls.length > 0) {
      return {
        url: unsplashUrls[0],
        source: "unsplash",
        relevanceScore: 60,
        tags: [query, "unsplash"],
      };
    }
  } catch (err) {
    console.warn("[ImageIntelligence] Unsplash search failed:", err);
  }

  // ── 5. No image found ─────────────────────────────────────────────────────
  return null;
}

/**
 * Batch-analyze a set of images using Claude Vision.
 * Optionally writes updated tags back to imageLibrary.
 *
 * @param images  Array of { url, imageLibraryId? }
 * @returns       Array of VisionAnalysisResult (same order as input)
 */
export async function analyzeAndTagImages(
  images: Array<{ url: string; imageLibraryId?: number }>
): Promise<VisionAnalysisResult[]> {
  if (images.length === 0) return [];

  const { analyzeImage } = await import("./visionAnalysisService");

  // Concurrency limit: max 3 parallel Vision calls
  const CONCURRENCY = 3;
  const results: VisionAnalysisResult[] = new Array(images.length);

  for (let i = 0; i < images.length; i += CONCURRENCY) {
    const batch = images.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (img, batchIdx) => {
        const analysis = await analyzeImage(img.url);

        // If we have a library ID, update the tags in DB
        if (img.imageLibraryId) {
          try {
            const { updateImageLibraryItem } = await import("../db");
            await updateImageLibraryItem(img.imageLibraryId, {
              tags: JSON.stringify(analysis.tags),
              visionDescription: analysis.description,
              contentType: analysis.contentType,
              qualityScore: analysis.qualityScore,
            });
          } catch (dbErr) {
            console.warn(
              `[ImageIntelligence] Failed to update imageLibrary id=${img.imageLibraryId}:`,
              dbErr
            );
          }
        }

        return { idx: i + batchIdx, analysis };
      })
    );

    for (const { idx, analysis } of batchResults) {
      results[idx] = analysis;
    }
  }

  return results;
}

/**
 * Smart-match analyzed images to itinerary targets (attractions, hotels, meals).
 *
 * Scoring:
 *   - matchKeywords contains target.name  → +50
 *   - contentType matches target.type     → +30
 *   - tags overlap with target.name       → +20
 *
 * Greedy assignment: highest-score pair first; no image reused.
 *
 * @param analyses   VisionAnalysisResult[] (same order as imageUrls)
 * @param imageUrls  Corresponding image URLs
 * @param targets    Itinerary targets to match
 * @returns          Map<target.name, imageUrl>
 */
export async function smartMatchImages(
  analyses: VisionAnalysisResult[],
  imageUrls: string[],
  targets: Array<{ name: string; type: "attraction" | "hotel" | "meal" | "hero" }>
): Promise<Map<string, string>> {
  const resultMap = new Map<string, string>();
  const usedImageIndices = new Set<number>();

  // Build score matrix
  const scores: Array<{ targetIdx: number; imageIdx: number; score: number }> = [];

  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    const targetNameLower = target.name.toLowerCase();

    for (let ii = 0; ii < analyses.length; ii++) {
      const analysis = analyses[ii];
      let score = 0;

      // +50 if matchKeywords contains target name
      if (
        analysis.matchKeywords.some(
          (kw) =>
            kw.toLowerCase().includes(targetNameLower) ||
            targetNameLower.includes(kw.toLowerCase())
        )
      ) {
        score += 50;
      }

      // +30 if contentType matches target type
      const typeMapping: Record<string, string[]> = {
        hotel: ["hotel"],
        meal: ["food"],
        attraction: ["landscape", "activity"],
        hero: ["landscape", "activity", "hotel"],
      };
      const expectedTypes = typeMapping[target.type] ?? [];
      if (expectedTypes.includes(analysis.contentType)) {
        score += 30;
      }

      // +20 if any tag overlaps with target name
      if (
        analysis.tags.some(
          (tag) =>
            tag.toLowerCase().includes(targetNameLower) ||
            targetNameLower.includes(tag.toLowerCase())
        )
      ) {
        score += 20;
      }

      if (score > 0) {
        scores.push({ targetIdx: ti, imageIdx: ii, score });
      }
    }
  }

  // Sort by score descending (greedy)
  scores.sort((a, b) => b.score - a.score);

  const matchedTargets = new Set<number>();

  for (const { targetIdx, imageIdx, score } of scores) {
    if (matchedTargets.has(targetIdx)) continue;
    if (usedImageIndices.has(imageIdx)) continue;
    if (score === 0) continue;

    const target = targets[targetIdx];
    const url = imageUrls[imageIdx];
    if (url) {
      resultMap.set(target.name, url);
      matchedTargets.add(targetIdx);
      usedImageIndices.add(imageIdx);
    }
  }

  return resultMap;
}

/**
 * Upload PDF-extracted raw images to S3 and return typed URL records.
 * Designed to be called once per PDF parse, before findBestImage.
 */
export async function uploadPdfImages(
  rawImages: ExtractedPdfImage[],
  tourTitle: string
): Promise<Array<{ url: string; type: "hero" | "feature" | "other"; pageNumber: number }>> {
  if (rawImages.length === 0) return [];

  const { storageImagePut } = await import("../storage");
  const results: Array<{
    url: string;
    type: "hero" | "feature" | "other";
    pageNumber: number;
  }> = [];

  // Limit to 20 images to avoid excessive S3 writes
  const toUpload = rawImages.slice(0, 20);

  for (const img of toUpload) {
    try {
      const ext = img.mimeType.split("/")[1] || "jpg";
      const safeTitle = tourTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "-").slice(0, 30);
      const baseKey = `pdf-images/${safeTitle}-p${img.pageNumber}-${img.index}-${Date.now()}`;

      const urls = await storageImagePut(baseKey, img.data, {
        format: "webp",
      });

      const type = classifyImageBySize(img.width, img.height);
      results.push({
        url: urls.medium || urls.large || urls.thumbnail,
        type,
        pageNumber: img.pageNumber,
      });
    } catch (err) {
      console.warn(
        `[ImageIntelligence] Failed to upload PDF image p${img.pageNumber}:`,
        err
      );
    }
  }

  console.log(
    `[ImageIntelligence] Uploaded ${results.length}/${toUpload.length} PDF images`
  );
  return results;
}

// ── helpers ────────────────────────────────────────────────────────────────

function tryParseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [value];
  }
}
