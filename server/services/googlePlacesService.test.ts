/**
 * Unit tests for googlePlacesService.ts
 * Pure logic tests — no real API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearPhotoCache } from "./googlePlacesService";

// ── Mock global fetch ─────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helper to reset env ───────────────────────────────────────────────────────
const ORIGINAL_ENV = { ...process.env };

function setApiKey(key: string | undefined) {
  if (key === undefined) {
    delete process.env.GOOGLE_PLACES_API_KEY;
  } else {
    process.env.GOOGLE_PLACES_API_KEY = key;
  }
}

beforeEach(() => {
  clearPhotoCache();
  mockFetch.mockReset();
});

afterEach(() => {
  // Restore original env
  process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_ENV.GOOGLE_PLACES_API_KEY;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("searchPlacePhotos", () => {
  it("returns empty array when GOOGLE_PLACES_API_KEY is not set", async () => {
    setApiKey(undefined);
    // Re-import to pick up env change
    const { searchPlacePhotos } = await import("./googlePlacesService");
    const result = await searchPlacePhotos("太魯閣國家公園");
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns empty array when Text Search returns no places", async () => {
    setApiKey("test-api-key");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ places: [] }),
    });

    const { searchPlacePhotos } = await import("./googlePlacesService");
    const result = await searchPlacePhotos("nonexistent-place-xyz");
    expect(result).toEqual([]);
  });

  it("returns empty array when Text Search fails with non-200 status", async () => {
    setApiKey("test-api-key");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });

    const { searchPlacePhotos } = await import("./googlePlacesService");
    const result = await searchPlacePhotos("太魯閣");
    expect(result).toEqual([]);
  });

  it("returns photos when API responds successfully", async () => {
    setApiKey("test-api-key");

    // Mock Text Search response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        places: [
          {
            id: "place-123",
            displayName: { text: "太魯閣國家公園" },
            photos: [
              {
                name: "places/place-123/photos/photo-1",
                widthPx: 1200,
                heightPx: 800,
                authorAttributions: [{ displayName: "John Doe" }],
              },
            ],
          },
        ],
      }),
    });

    // Mock photo media response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        photoUri: "https://lh3.googleusercontent.com/photo-1",
      }),
    });

    const { searchPlacePhotos } = await import("./googlePlacesService");
    const result = await searchPlacePhotos("太魯閣國家公園", 1);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://lh3.googleusercontent.com/photo-1");
    expect(result[0].attribution).toBe("John Doe");
    expect(result[0].widthPx).toBe(1200);
    expect(result[0].heightPx).toBe(800);
  });

  it("caches results for the same place name", async () => {
    setApiKey("test-api-key");

    // Mock Text Search response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            id: "place-456",
            displayName: { text: "九份老街" },
            photos: [
              {
                name: "places/place-456/photos/photo-1",
                widthPx: 800,
                heightPx: 600,
                authorAttributions: [],
              },
            ],
          },
        ],
      }),
    });

    const { searchPlacePhotos } = await import("./googlePlacesService");

    // First call
    await searchPlacePhotos("九份老街", 1);
    const callCountAfterFirst = mockFetch.mock.calls.length;

    // Second call — should hit cache
    await searchPlacePhotos("九份老街", 1);
    const callCountAfterSecond = mockFetch.mock.calls.length;

    // No additional fetch calls for the second request
    expect(callCountAfterSecond).toBe(callCountAfterFirst);
  });

  it("does not crash when fetch throws", async () => {
    setApiKey("test-api-key");
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { searchPlacePhotos } = await import("./googlePlacesService");
    const result = await searchPlacePhotos("test-place");
    expect(result).toEqual([]);
  });
});
