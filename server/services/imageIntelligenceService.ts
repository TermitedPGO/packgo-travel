/**
 * Image Intelligence Service
 *
 * Unified image source management with priority ordering:
 *   1. imageLibrary (previously used images — most relevant)
 *   2. PDF-extracted images (tour operator's own photos)
 *   3. Unsplash (general travel/landscape fallback)
 *   4. null (caller decides on placeholder)
 */

import { getImageLibrary } from "../db";
import { searchUnsplashPhotos } from "./unsplashService";
import type { ExtractedPdfImage } from "./pdfImageExtractor";
import { classifyImageBySize } from "./pdfImageExtractor";

export interface ImageSearchResult {
  url: string;
  source: "pdf" | "unsplash" | "library";
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
 *   3. Unsplash search
 *   4. null
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

  // ── 3. Unsplash ───────────────────────────────────────────────────────────
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

  // ── 4. No image found ─────────────────────────────────────────────────────
  return null;
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
