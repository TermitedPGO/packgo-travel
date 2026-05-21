/**
 * Unit tests for server/services/routeMap/builder.ts
 *
 * v2 Wave 2 Module 2.13 — extracted from server/routers/toursRouteMap.ts.
 * External dependencies (DB, geocoders, LLM normalizer, alias table) are
 * mocked. We verify the 3 critical paths:
 *   1. Missing tour → empty result with null aiMapUrl
 *   2. Tour with empty itinerary → empty result preserving aiMapUrl
 *   3. Happy path: tour + itinerary + geocode hit → static map URL
 *      with stops, directionsUrl, and unchanged tRPC response shape
 *   4. Cache hit (warm) → bypasses both Google and Nominatim
 *   5. All-candidates-miss → falls back to country-level map URL
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => ({
  getTourById: vi.fn(),
}));

vi.mock("../../_helpers/placeNameAliases", () => ({
  getAliases: vi.fn(() => []),
}));

vi.mock("../../_helpers/llmPlaceNormalizer", () => ({
  normalizePlaceName: vi.fn(),
}));

// Mock the geocoders inside fallbacks.ts so we don't hit Google or
// Nominatim during unit tests. We re-export the rest (lookup tables,
// fallback-result builders) untouched.
vi.mock("./fallbacks", async () => {
  const actual = await vi.importActual<typeof import("./fallbacks")>("./fallbacks");
  return {
    ...actual,
    tryGoogle: vi.fn(),
    tryNominatim: vi.fn(),
  };
});

import { getTourById } from "../../db";
import { normalizePlaceName } from "../../_helpers/llmPlaceNormalizer";
import { tryGoogle, tryNominatim } from "./fallbacks";
import { buildRouteMap } from "./builder";

const mockGetTourById = vi.mocked(getTourById);
const mockNormalize = vi.mocked(normalizePlaceName);
const mockTryGoogle = vi.mocked(tryGoogle);
const mockTryNominatim = vi.mocked(tryNominatim);

beforeEach(() => {
  vi.clearAllMocks();
  mockTryGoogle.mockResolvedValue(null);
  mockTryNominatim.mockResolvedValue(null);
  mockNormalize.mockResolvedValue(null);
  // Reset the in-process geocode cache between tests so prior runs don't
  // leak coords into later test cases. Same map the production code uses.
  (globalThis as any).__packgoGeocodeCache = new Map();
  (globalThis as any).__packgoGoogleStatus = { denied: false, deniedSince: 0 };
});

describe("buildRouteMap", () => {
  it("returns empty result when tour is missing", async () => {
    mockGetTourById.mockResolvedValueOnce(undefined as any);

    const result = await buildRouteMap({ id: 999 });

    expect(result.stops).toEqual([]);
    expect(result.staticMapUrl).toBeNull();
    expect(result.directionsUrl).toBeNull();
    expect(result.aiMapUrl).toBeNull();
    expect(mockTryGoogle).not.toHaveBeenCalled();
  });

  it("returns empty result preserving aiMapUrl when itinerary is empty", async () => {
    mockGetTourById.mockResolvedValueOnce({
      id: 1,
      destinationCountry: "瑞士",
      departureCity: "台北",
      aiMapUrl: "https://r2.example.com/tour-1-map.png",
      itineraryDetailed: "[]",
    } as any);

    const result = await buildRouteMap({ id: 1 });

    expect(result.stops).toEqual([]);
    expect(result.staticMapUrl).toBeNull();
    expect(result.aiMapUrl).toBe("https://r2.example.com/tour-1-map.png");
    expect(mockTryGoogle).not.toHaveBeenCalled();
  });

  it("happy path: resolves stops via Google and returns branded static map URL", async () => {
    mockGetTourById.mockResolvedValueOnce({
      id: 2,
      destinationCountry: "瑞士",
      departureCity: "台北",
      aiMapUrl: null,
      itineraryDetailed: JSON.stringify([
        { title: "蘇黎世Zurich" },
        { title: "盧塞恩Lucerne" },
      ]),
    } as any);
    // Both candidates hit on the first Google try
    mockTryGoogle
      .mockResolvedValueOnce({ lat: 47.376, lng: 8.541 }) // Zurich
      .mockResolvedValueOnce({ lat: 47.05, lng: 8.307 }); // Lucerne

    const result = await buildRouteMap({ id: 2 });

    expect(result.stops).toHaveLength(2);
    expect(result.stops[0]).toMatchObject({ day: 1, lat: 47.376, lng: 8.541 });
    expect(result.stops[1]).toMatchObject({ day: 2, lat: 47.05, lng: 8.307 });
    expect(result.staticMapUrl).toContain("https://maps.googleapis.com/maps/api/staticmap");
    expect(result.staticMapUrl).toContain("scale=2");
    expect(result.directionsUrl).toContain("https://www.google.com/maps/dir/");
    expect(result.aiMapUrl).toBeNull();
    // Two days → two stops → Nominatim should not have been needed
    expect(mockTryNominatim).not.toHaveBeenCalled();
  });

  it("cache hit: warm cache short-circuits both geocoders", async () => {
    // Pre-warm the cache with the exact key the builder will look up
    // (CACHE_VERSION v13, country "瑞士", candidate "Zurich").
    const cache = new Map<string, { lat: number; lng: number } | null>();
    cache.set("v13:瑞士:Zurich", { lat: 47.376, lng: 8.541 });
    (globalThis as any).__packgoGeocodeCache = cache;

    mockGetTourById.mockResolvedValueOnce({
      id: 3,
      destinationCountry: "瑞士",
      departureCity: "台北",
      aiMapUrl: null,
      // Single day with trailing English "Zurich" → first candidate is
      // raw English "Zurich" (hasEnglish branch).
      itineraryDetailed: JSON.stringify([{ title: "蘇黎世Zurich" }]),
    } as any);

    const result = await buildRouteMap({ id: 3 });

    // Single stop is below the cluster-filter threshold (>4 stops),
    // but buildStaticMapUrl still emits a URL with the single marker.
    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].lat).toBe(47.376);
    expect(result.staticMapUrl).toContain("maps.googleapis.com");
    // Neither geocoder should have been hit — pure cache path.
    expect(mockTryGoogle).not.toHaveBeenCalled();
    expect(mockTryNominatim).not.toHaveBeenCalled();
  });

  it("all-candidates-miss falls back to country-level static map", async () => {
    mockGetTourById.mockResolvedValueOnce({
      id: 4,
      destinationCountry: "瑞士",
      departureCity: "台北",
      aiMapUrl: null,
      itineraryDetailed: JSON.stringify([{ title: "未知村落" }]),
    } as any);
    // Both geocoders return null for every candidate, and the LLM
    // normalizer also returns null (default in beforeEach).
    // Builder should fall through to country-level fallback.

    const result = await buildRouteMap({ id: 4 });

    expect(result.fallbackMode).toBe("country");
    expect(result.staticMapUrl).toContain("staticmap");
    expect(result.staticMapUrl).toContain("Switzerland");
    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].lat).toBe(0); // raw stop placeholder
    expect(result.directionsUrl).toContain("Switzerland");
  });
});
