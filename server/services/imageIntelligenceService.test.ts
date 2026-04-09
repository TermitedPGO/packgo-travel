/**
 * Unit tests for imageIntelligenceService.ts
 * All external dependencies (DB, Google Places, Unsplash, Vision) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all external dependencies ───────────────────────────────────────────
vi.mock("../db", () => ({
  getImageLibrary: vi.fn(),
  updateImageLibraryItem: vi.fn(),
}));

vi.mock("./unsplashService", () => ({
  searchUnsplashPhotos: vi.fn(),
}));

vi.mock("./googlePlacesService", () => ({
  searchPlacePhotos: vi.fn(),
}));

vi.mock("./visionAnalysisService", () => ({
  analyzeImage: vi.fn(),
}));

import { getImageLibrary, updateImageLibraryItem } from "../db";
import { searchUnsplashPhotos } from "./unsplashService";
import { searchPlacePhotos } from "./googlePlacesService";
import { analyzeImage } from "./visionAnalysisService";
import {
  findBestImage,
  analyzeAndTagImages,
  smartMatchImages,
} from "./imageIntelligenceService";
import type { VisionAnalysisResult } from "./visionAnalysisService";

const mockGetImageLibrary = vi.mocked(getImageLibrary);
const mockUpdateImageLibraryItem = vi.mocked(updateImageLibraryItem);
const mockSearchUnsplash = vi.mocked(searchUnsplashPhotos);
const mockSearchPlaces = vi.mocked(searchPlacePhotos);
const mockAnalyzeImage = vi.mocked(analyzeImage);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: all sources return empty
  mockGetImageLibrary.mockResolvedValue([]);
  mockSearchUnsplash.mockResolvedValue([]);
  mockSearchPlaces.mockResolvedValue([]);
});

// ── findBestImage priority tests ──────────────────────────────────────────────

describe("findBestImage — priority ordering", () => {
  it("returns library result when imageLibrary has a match (priority 1)", async () => {
    mockGetImageLibrary.mockResolvedValueOnce([
      {
        id: 1,
        url: "https://cdn.example.com/library-photo.jpg",
        tags: '["太魯閣", "landscape"]',
        uploadedBy: 1,
        tourId: null,
        createdAt: new Date(),
        source: "upload",
        visionDescription: null,
        contentType: null,
        qualityScore: null,
      } as any,
    ]);

    const result = await findBestImage("太魯閣");

    expect(result).not.toBeNull();
    expect(result!.source).toBe("library");
    expect(result!.url).toBe("https://cdn.example.com/library-photo.jpg");
    expect(result!.relevanceScore).toBe(90);
    // Lower-priority sources should not have been called
    expect(mockSearchPlaces).not.toHaveBeenCalled();
    expect(mockSearchUnsplash).not.toHaveBeenCalled();
  });

  it("returns PDF result when library is empty but pdfImageUrls provided (priority 2)", async () => {
    mockGetImageLibrary.mockResolvedValueOnce([]);

    const result = await findBestImage("九份老街", {
      pdfImageUrls: [
        { url: "https://s3.example.com/pdf-hero.jpg", type: "hero", pageNumber: 1 },
        { url: "https://s3.example.com/pdf-feature.jpg", type: "feature", pageNumber: 2 },
      ],
      preferredType: "hero",
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("pdf");
    expect(result!.url).toBe("https://s3.example.com/pdf-hero.jpg");
    expect(result!.relevanceScore).toBe(80);
    expect(mockSearchPlaces).not.toHaveBeenCalled();
    expect(mockSearchUnsplash).not.toHaveBeenCalled();
  });

  it("returns Google Places result when library and PDF are empty (priority 3)", async () => {
    mockGetImageLibrary.mockResolvedValueOnce([]);
    mockSearchPlaces.mockResolvedValueOnce([
      {
        url: "https://lh3.googleusercontent.com/places-photo.jpg",
        attribution: "Google Maps User",
        widthPx: 1200,
        heightPx: 800,
      },
    ]);

    const result = await findBestImage("太魯閣國家公園");

    expect(result).not.toBeNull();
    expect(result!.source).toBe("google_places");
    expect(result!.url).toBe("https://lh3.googleusercontent.com/places-photo.jpg");
    expect(result!.relevanceScore).toBe(75);
    expect(mockSearchUnsplash).not.toHaveBeenCalled();
  });

  it("returns Unsplash result when all higher-priority sources are empty (priority 4)", async () => {
    mockGetImageLibrary.mockResolvedValueOnce([]);
    mockSearchPlaces.mockResolvedValueOnce([]);
    mockSearchUnsplash.mockResolvedValueOnce([
      "https://images.unsplash.com/photo-123.jpg",
    ]);

    const result = await findBestImage("taiwan travel");

    expect(result).not.toBeNull();
    expect(result!.source).toBe("unsplash");
    expect(result!.url).toBe("https://images.unsplash.com/photo-123.jpg");
    expect(result!.relevanceScore).toBe(60);
  });

  it("returns null when all sources are empty", async () => {
    mockGetImageLibrary.mockResolvedValueOnce([]);
    mockSearchPlaces.mockResolvedValueOnce([]);
    mockSearchUnsplash.mockResolvedValueOnce([]);

    const result = await findBestImage("nonexistent-place");

    expect(result).toBeNull();
  });

  it("falls through to next source when a higher-priority source throws", async () => {
    mockGetImageLibrary.mockRejectedValueOnce(new Error("DB error"));
    mockSearchPlaces.mockResolvedValueOnce([]);
    mockSearchUnsplash.mockResolvedValueOnce([
      "https://images.unsplash.com/fallback.jpg",
    ]);

    const result = await findBestImage("test-query");

    expect(result).not.toBeNull();
    expect(result!.source).toBe("unsplash");
  });
});

// ── analyzeAndTagImages tests ─────────────────────────────────────────────────

describe("analyzeAndTagImages", () => {
  it("returns empty array for empty input", async () => {
    const results = await analyzeAndTagImages([]);
    expect(results).toEqual([]);
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
  });

  it("analyzes each image and returns results in order", async () => {
    const mockResult1: VisionAnalysisResult = {
      description: "Mountain landscape",
      tags: ["mountain", "landscape"],
      contentType: "landscape",
      qualityScore: 85,
      matchKeywords: ["合歡山"],
    };
    const mockResult2: VisionAnalysisResult = {
      description: "Hotel lobby",
      tags: ["hotel", "lobby"],
      contentType: "hotel",
      qualityScore: 90,
      matchKeywords: ["晶英酒店"],
    };

    mockAnalyzeImage
      .mockResolvedValueOnce(mockResult1)
      .mockResolvedValueOnce(mockResult2);

    const results = await analyzeAndTagImages([
      { url: "https://example.com/mountain.jpg" },
      { url: "https://example.com/hotel.jpg" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(mockResult1);
    expect(results[1]).toEqual(mockResult2);
  });

  it("updates imageLibrary when imageLibraryId is provided", async () => {
    const mockResult: VisionAnalysisResult = {
      description: "Beach scene",
      tags: ["beach", "ocean"],
      contentType: "landscape",
      qualityScore: 80,
      matchKeywords: ["墾丁"],
    };

    mockAnalyzeImage.mockResolvedValueOnce(mockResult);
    mockUpdateImageLibraryItem.mockResolvedValueOnce(undefined);

    await analyzeAndTagImages([
      { url: "https://example.com/beach.jpg", imageLibraryId: 42 },
    ]);

    expect(mockUpdateImageLibraryItem).toHaveBeenCalledWith(42, {
      tags: JSON.stringify(["beach", "ocean"]),
      visionDescription: "Beach scene",
      contentType: "landscape",
      qualityScore: 80,
    });
  });

  it("does not call updateImageLibraryItem when no imageLibraryId", async () => {
    const mockResult: VisionAnalysisResult = {
      description: "Test",
      tags: ["test"],
      contentType: "other",
      qualityScore: 50,
      matchKeywords: [],
    };

    mockAnalyzeImage.mockResolvedValueOnce(mockResult);

    await analyzeAndTagImages([{ url: "https://example.com/test.jpg" }]);

    expect(mockUpdateImageLibraryItem).not.toHaveBeenCalled();
  });
});

// ── smartMatchImages tests ────────────────────────────────────────────────────

describe("smartMatchImages", () => {
  it("matches hotel image to hotel target", async () => {
    const analyses: VisionAnalysisResult[] = [
      {
        description: "Luxury hotel lobby",
        tags: ["hotel", "lobby", "luxury"],
        contentType: "hotel",
        qualityScore: 90,
        matchKeywords: ["晶英酒店"],
      },
    ];

    const imageUrls = ["https://example.com/hotel.jpg"];
    const targets = [{ name: "晶英酒店", type: "hotel" as const }];

    const result = await smartMatchImages(analyses, imageUrls, targets);

    expect(result.get("晶英酒店")).toBe("https://example.com/hotel.jpg");
  });

  it("matches landscape image to attraction target", async () => {
    const analyses: VisionAnalysisResult[] = [
      {
        description: "Scenic gorge with cliffs",
        tags: ["gorge", "landscape", "nature"],
        contentType: "landscape",
        qualityScore: 85,
        matchKeywords: ["太魯閣"],
      },
    ];

    const imageUrls = ["https://example.com/gorge.jpg"];
    const targets = [{ name: "太魯閣國家公園", type: "attraction" as const }];

    const result = await smartMatchImages(analyses, imageUrls, targets);

    // matchKeywords "太魯閣" is included in target name "太魯閣國家公園" → +50
    // contentType "landscape" matches attraction → +30
    expect(result.get("太魯閣國家公園")).toBe("https://example.com/gorge.jpg");
  });

  it("does not reuse the same image for multiple targets", async () => {
    const analyses: VisionAnalysisResult[] = [
      {
        description: "Hotel room",
        tags: ["hotel", "room"],
        contentType: "hotel",
        qualityScore: 80,
        matchKeywords: ["飯店A"],
      },
    ];

    const imageUrls = ["https://example.com/hotel.jpg"];
    const targets = [
      { name: "飯店A", type: "hotel" as const },
      { name: "飯店B", type: "hotel" as const },
    ];

    const result = await smartMatchImages(analyses, imageUrls, targets);

    // Only one image available — should only match one target
    expect(result.size).toBe(1);
    expect(result.get("飯店A")).toBe("https://example.com/hotel.jpg");
    expect(result.get("飯店B")).toBeUndefined();
  });

  it("returns empty map when no images match any target", async () => {
    const analyses: VisionAnalysisResult[] = [
      {
        description: "Abstract art",
        tags: ["abstract", "art"],
        contentType: "other",
        qualityScore: 40,
        matchKeywords: [],
      },
    ];

    const imageUrls = ["https://example.com/art.jpg"];
    const targets = [{ name: "太魯閣", type: "attraction" as const }];

    const result = await smartMatchImages(analyses, imageUrls, targets);

    // No overlap between tags/keywords and target name, contentType mismatch
    expect(result.size).toBe(0);
  });

  it("returns empty map for empty inputs", async () => {
    const result = await smartMatchImages([], [], []);
    expect(result.size).toBe(0);
  });

  it("prefers higher-score matches (greedy assignment)", async () => {
    // Two images: one hotel, one landscape
    const analyses: VisionAnalysisResult[] = [
      {
        description: "Landscape",
        tags: ["landscape", "mountain"],
        contentType: "landscape",
        qualityScore: 85,
        matchKeywords: ["合歡山"],
      },
      {
        description: "Hotel",
        tags: ["hotel"],
        contentType: "hotel",
        qualityScore: 90,
        matchKeywords: ["晶英酒店"],
      },
    ];

    const imageUrls = [
      "https://example.com/landscape.jpg",
      "https://example.com/hotel.jpg",
    ];

    const targets = [
      { name: "晶英酒店", type: "hotel" as const },
      { name: "合歡山", type: "attraction" as const },
    ];

    const result = await smartMatchImages(analyses, imageUrls, targets);

    expect(result.get("晶英酒店")).toBe("https://example.com/hotel.jpg");
    expect(result.get("合歡山")).toBe("https://example.com/landscape.jpg");
  });
});
