/**
 * Smoke test for Phase 4E · photos sub-router extraction.
 * Verifies 3 procedures from the pre-split source.
 *
 * Wave1 收尾補丁 (2026-07): added behavioral coverage for the `upload`
 * mutation's Packpoint-bonus-award fail-open wiring point — a bonus-award
 * failure must not fail the photo upload itself, and must report to the
 * error funnel (server/_core/errorFunnel.ts) so Jeff actually sees it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock collaborators BEFORE importing the router so the router picks up the
// mocked modules at construction time (same pattern as inquiries.test.ts).
vi.mock("../db", () => ({
  getBookingById: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("../_core/packpoint", () => ({
  awardPackpoint: vi.fn(),
}));
vi.mock("../_core/errorFunnel", () => ({
  reportFunnelError: vi.fn(() => Promise.resolve()),
}));

import { photosRouter } from "./photos";
import * as db from "../db";
import { awardPackpoint } from "../_core/packpoint";
import { reportFunnelError } from "../_core/errorFunnel";

describe("photosRouter (Phase 4E extraction)", () => {
  it("exposes 3 procedures from the pre-split source", () => {
    const procs = Object.keys((photosRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "upload",
        "myPhotos",
        "delete",
      ].sort(),
    );
  });
});

describe("photosRouter.upload — Packpoint bonus-award fail-open wiring", () => {
  function makeContext() {
    return {
      req: { headers: {}, socket: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
      user: { id: 55, role: "user" },
      ip: "127.0.0.1",
    };
  }

  /** Minimal chainable drizzle-db double covering the select/insert/update
   *  calls `upload` makes. `.where()` is the terminal await point for both
   *  the COUNT(*) select and the pointsAwarded update, so it always resolves
   *  to the count row shape — the update's return value is never read. */
  function makeDrizzleDbMock({ existingCount = 0, insertId = 777 } = {}) {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => Promise.resolve([{ c: existingCount }]));
    chain.insert = vi.fn(() => chain);
    chain.values = vi.fn(() => Promise.resolve([{ insertId }]));
    chain.update = vi.fn(() => chain);
    chain.set = vi.fn(() => chain);
    return chain;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (db.getBookingById as any).mockResolvedValue({
      id: 300,
      userId: 55,
      bookingStatus: "completed",
    });
  });

  it("awardPackpoint failure: logs + reports to the error funnel with source 'fail-open:photos:packpointBonusAwardFailed', upload still succeeds with pointsEarned=0", async () => {
    const drizzleDbMock = makeDrizzleDbMock({ existingCount: 0, insertId: 777 });
    (db.getDb as any).mockResolvedValue(drizzleDbMock);
    (awardPackpoint as any).mockRejectedValue(new Error("packpoint ledger locked"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const caller = (photosRouter as any).createCaller(makeContext());
    const result = await caller.upload({
      bookingId: 300,
      photoUrl: "https://cdn.packgoplay.com/photos/abc.jpg",
    });

    // Original behavior unchanged: the photo row itself was already inserted
    // before the bonus-award try/catch runs — upload must still report success,
    // just with pointsEarned=0 (the bonus is best-effort, not the primary action).
    expect(result).toEqual({ photoId: 777, pointsEarned: 0, capReached: false });
    // Original console.error logging is preserved alongside the new funnel report.
    expect(consoleErrorSpy).toHaveBeenCalledWith("[Photos] Bonus award failed:", expect.any(Error));
    expect(reportFunnelError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:photos:packpointBonusAwardFailed",
        context: { photoId: 777, userId: 55 },
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("happy path (control case): award succeeds, pointsEarned=10, funnel is never called", async () => {
    const drizzleDbMock = makeDrizzleDbMock({ existingCount: 0, insertId: 778 });
    (db.getDb as any).mockResolvedValue(drizzleDbMock);
    (awardPackpoint as any).mockResolvedValue(undefined);

    const caller = (photosRouter as any).createCaller(makeContext());
    const result = await caller.upload({
      bookingId: 300,
      photoUrl: "https://cdn.packgoplay.com/photos/def.jpg",
    });

    expect(result).toEqual({ photoId: 778, pointsEarned: 10, capReached: false });
    expect(reportFunnelError).not.toHaveBeenCalled();
  });
});
