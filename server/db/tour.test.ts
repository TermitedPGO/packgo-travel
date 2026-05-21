/**
 * v2 Wave 2 · Module 2.2 — server/db/tour.ts smoke test.
 *
 * Sanity-check the extraction:
 *
 *   Case 1 (named exports)
 *     - The 22 tour-domain exports (21 functions + TourUpdateConflictError class)
 *       exist and are typeof "function".
 *
 *   Case 2 (lazy-DB null path)
 *     - getTourById(id) returns undefined when getDb() resolves to null
 *       (no DATABASE_URL in CI). Mirrors the booking smoke pattern.
 *
 * Mocks `../db` to stub getDb() → null so we never need a real connection.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

import {
  // tours core CRUD
  getAllTours,
  getTourById,
  createTour,
  updateTour,
  deleteTour,
  batchDeleteTours,
  TourUpdateConflictError,
  // tour departures
  getTourDepartures,
  getDepartureById,
  tryReserveDepartureSlots,
  releaseDepartureSlots,
  createDeparture,
  updateDeparture,
  deleteDeparture,
  // search + filter helpers
  searchTours,
  getFilterOptions,
  getDepartureCities,
  // calibration state machine
  saveCalibrationResult,
  getCalibrationResultByTourId,
  getPendingReviewTours,
  approveTour,
  rejectTour,
} from "./tour";

describe("db/tour — module surface", () => {
  it("exports the 21 tour-domain functions + TourUpdateConflictError class", () => {
    // tours core CRUD
    expect(typeof getAllTours).toBe("function");
    expect(typeof getTourById).toBe("function");
    expect(typeof createTour).toBe("function");
    expect(typeof updateTour).toBe("function");
    expect(typeof deleteTour).toBe("function");
    expect(typeof batchDeleteTours).toBe("function");
    expect(typeof TourUpdateConflictError).toBe("function"); // class is a function
    // tour departures
    expect(typeof getTourDepartures).toBe("function");
    expect(typeof getDepartureById).toBe("function");
    expect(typeof tryReserveDepartureSlots).toBe("function");
    expect(typeof releaseDepartureSlots).toBe("function");
    expect(typeof createDeparture).toBe("function");
    expect(typeof updateDeparture).toBe("function");
    expect(typeof deleteDeparture).toBe("function");
    // search + filter
    expect(typeof searchTours).toBe("function");
    expect(typeof getFilterOptions).toBe("function");
    expect(typeof getDepartureCities).toBe("function");
    // calibration
    expect(typeof saveCalibrationResult).toBe("function");
    expect(typeof getCalibrationResultByTourId).toBe("function");
    expect(typeof getPendingReviewTours).toBe("function");
    expect(typeof approveTour).toBe("function");
    expect(typeof rejectTour).toBe("function");
  });

  it("TourUpdateConflictError carries the offending tour id", () => {
    const err = new TourUpdateConflictError(42);
    expect(err.id).toBe(42);
    expect(err.name).toBe("TourUpdateConflictError");
    expect(err.message).toContain("42");
  });
});

describe("db/tour — happy-path null-DB behavior", () => {
  it("getTourById returns undefined when DB pool is null", async () => {
    const result = await getTourById(123);
    expect(result).toBeUndefined();
  });

  it("getAllTours returns [] when DB pool is null", async () => {
    const result = await getAllTours();
    expect(result).toEqual([]);
  });

  it("tryReserveDepartureSlots returns {reserved:false, available:0} when DB is null (money-path safety)", async () => {
    const result = await tryReserveDepartureSlots(1, 1);
    expect(result).toEqual({ reserved: false, available: 0 });
  });
});
