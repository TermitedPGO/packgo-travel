/**
 * v2 Wave 2 · Module 2.6 — server/db/search.ts smoke test.
 *
 * Sanity-check the extraction:
 *
 *   Case 1 (named exports)
 *     - The 39 search-domain functions exist and are typeof "function"
 *       (38 functions + addToImageLibrary alias = 39 surface exports).
 *
 *   Case 2 (lazy-DB null path — read returns [] / null)
 *     - getImageLibrary() returns [] when getDb() resolves to null.
 *     - getAllDestinations() returns [] when getDb() resolves to null.
 *     - getCompetitorTours() returns the zero-state envelope.
 *     - getHomepageContent() returns null when getDb() resolves to null.
 *     - getAllPriceComparisons() returns [] when getDb() resolves to null.
 *
 *   Case 3 (lazy-DB null path — write throws)
 *     - createCompetitorTour() throws "Database not available" — mirrors
 *       the auth-adjacent write helpers in db/user.ts where writes are
 *       expected to fail loud rather than silently no-op.
 *
 * Mocks `../db` to stub getDb() → null so we never need a real connection.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

import {
  // Image library (9)
  getImageLibrary,
  addImageToLibrary,
  deleteImageFromLibrary,
  incrementImageUsage,
  getImageById,
  addToImageLibrary,
  searchImageLibrary,
  getImagesByTourId,
  updateImageLibraryItem,
  // Homepage content (3)
  getHomepageContent,
  getAllHomepageContent,
  upsertHomepageContent,
  // Destinations (7)
  getAllDestinations,
  getActiveDestinations,
  getDestinationById,
  createDestination,
  updateDestination,
  deleteDestination,
  reorderDestinations,
  // Competitor tours (8)
  createCompetitorTour,
  getCompetitorTours,
  getCompetitorTourById,
  getActiveCompetitorTours,
  updateCompetitorTour,
  deleteCompetitorTour,
  updateCompetitorTourScrapeStatus,
  // Competitor departures (2)
  getLatestDepartures,
  upsertCompetitorDepartures,
  // Competitor price history (2)
  insertPriceHistory,
  getPriceHistory,
  // Competitor alerts (6)
  insertCompetitorAlerts,
  getCompetitorAlerts,
  getUnreadAlertCount,
  markAlertAsRead,
  markAllAlertsAsRead,
  deleteOldAlerts,
  // Tour price comparisons (4)
  upsertTourPriceComparison,
  getTourPriceComparison,
  getAllPriceComparisons,
  deleteTourPriceComparison,
} from "./search";

describe("db/search — module surface", () => {
  it("exports the 39 search-domain functions", () => {
    // Image library (9, incl. addToImageLibrary alias)
    expect(typeof getImageLibrary).toBe("function");
    expect(typeof addImageToLibrary).toBe("function");
    expect(typeof deleteImageFromLibrary).toBe("function");
    expect(typeof incrementImageUsage).toBe("function");
    expect(typeof getImageById).toBe("function");
    expect(typeof addToImageLibrary).toBe("function");
    expect(typeof searchImageLibrary).toBe("function");
    expect(typeof getImagesByTourId).toBe("function");
    expect(typeof updateImageLibraryItem).toBe("function");
    // addToImageLibrary aliases addImageToLibrary
    expect(addToImageLibrary).toBe(addImageToLibrary);
    // Homepage content (3)
    expect(typeof getHomepageContent).toBe("function");
    expect(typeof getAllHomepageContent).toBe("function");
    expect(typeof upsertHomepageContent).toBe("function");
    // Destinations (7)
    expect(typeof getAllDestinations).toBe("function");
    expect(typeof getActiveDestinations).toBe("function");
    expect(typeof getDestinationById).toBe("function");
    expect(typeof createDestination).toBe("function");
    expect(typeof updateDestination).toBe("function");
    expect(typeof deleteDestination).toBe("function");
    expect(typeof reorderDestinations).toBe("function");
    // Competitor tours (7)
    expect(typeof createCompetitorTour).toBe("function");
    expect(typeof getCompetitorTours).toBe("function");
    expect(typeof getCompetitorTourById).toBe("function");
    expect(typeof getActiveCompetitorTours).toBe("function");
    expect(typeof updateCompetitorTour).toBe("function");
    expect(typeof deleteCompetitorTour).toBe("function");
    expect(typeof updateCompetitorTourScrapeStatus).toBe("function");
    // Competitor departures (2)
    expect(typeof getLatestDepartures).toBe("function");
    expect(typeof upsertCompetitorDepartures).toBe("function");
    // Competitor price history (2)
    expect(typeof insertPriceHistory).toBe("function");
    expect(typeof getPriceHistory).toBe("function");
    // Competitor alerts (6)
    expect(typeof insertCompetitorAlerts).toBe("function");
    expect(typeof getCompetitorAlerts).toBe("function");
    expect(typeof getUnreadAlertCount).toBe("function");
    expect(typeof markAlertAsRead).toBe("function");
    expect(typeof markAllAlertsAsRead).toBe("function");
    expect(typeof deleteOldAlerts).toBe("function");
    // Tour price comparisons (4)
    expect(typeof upsertTourPriceComparison).toBe("function");
    expect(typeof getTourPriceComparison).toBe("function");
    expect(typeof getAllPriceComparisons).toBe("function");
    expect(typeof deleteTourPriceComparison).toBe("function");
  });
});

describe("db/search — happy-path null-DB read behavior", () => {
  it("getImageLibrary returns [] when DB pool is null", async () => {
    expect(await getImageLibrary()).toEqual([]);
  });

  it("getAllDestinations returns [] when DB pool is null", async () => {
    expect(await getAllDestinations()).toEqual([]);
  });

  it("getCompetitorTours returns zero-state envelope when DB pool is null", async () => {
    expect(await getCompetitorTours()).toEqual({
      tours: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it("getHomepageContent returns null when DB pool is null", async () => {
    expect(await getHomepageContent("hero")).toBeNull();
  });

  it("getAllPriceComparisons returns [] when DB pool is null", async () => {
    expect(await getAllPriceComparisons()).toEqual([]);
  });

  it("getUnreadAlertCount returns 0 when DB pool is null", async () => {
    expect(await getUnreadAlertCount()).toBe(0);
  });
});

describe("db/search — write helpers fail loud when DB is null", () => {
  it("createCompetitorTour throws when DB pool is null", async () => {
    await expect(
      createCompetitorTour({
        competitor: "lion",
        tourTitle: "Test",
        tourUrl: "https://example.com",
        destination: "Tokyo",
      } as any),
    ).rejects.toThrow("Database not available");
  });

  it("markAllAlertsAsRead throws when DB pool is null", async () => {
    await expect(markAllAlertsAsRead()).rejects.toThrow("Database not available");
  });

  it("deleteTourPriceComparison throws when DB pool is null", async () => {
    await expect(deleteTourPriceComparison(1)).rejects.toThrow(
      "Database not available",
    );
  });
});
