/**
 * PKG-2 — confirmExtractedDepartures data-integrity regression tests.
 *
 * Covers the two P0 bugs fixed in server/routers/toursAdmin.ts:
 *   (1) An edited per-row return date must be PERSISTED, not silently
 *       overwritten with departureDate + 1 day. The "+1 day" behaviour is
 *       kept only as a fallback when the return date is empty/invalid.
 *   (2) Re-running the import must NOT create duplicate departure rows for the
 *       same (tourId, departureDate); collisions are skipped and counted.
 *
 * These exercise the pure helpers that back the mutation, plus a faithful
 * re-creation of the mutation's skip-and-count loop, so no real DB is touched
 * (per CLAUDE.md §7 — 禁止在測試中插入真實資料到資料庫).
 */

import { describe, it, expect } from "vitest";
import {
  resolveReturnDate,
  departureDayKey,
  buildExistingDayKeySet,
} from "./routers/toursAdmin";

describe("PKG-2 BUG 1 — edited returnDate is honoured (not overwritten by +1 day)", () => {
  it("persists an explicitly edited return date instead of departureDate + 1", () => {
    const departureDate = new Date("2026-06-15T00:00:00.000Z");
    // Admin edited a 6-day trip in DeparturePreview (回程 = 2026-06-21).
    const resolved = resolveReturnDate(departureDate, "2026-06-21");

    expect(resolved.getTime()).toBe(new Date("2026-06-21").getTime());
    // Regression guard: must NOT be the old hardcoded departureDate + 1 day.
    const plusOne = new Date(departureDate);
    plusOne.setDate(plusOne.getDate() + 1);
    expect(resolved.getTime()).not.toBe(plusOne.getTime());
  });

  it("falls back to departureDate + 1 day when returnDate is missing", () => {
    const departureDate = new Date("2026-06-15T00:00:00.000Z");
    const expected = new Date(departureDate);
    expected.setDate(expected.getDate() + 1);

    expect(resolveReturnDate(departureDate, undefined).getTime()).toBe(expected.getTime());
    expect(resolveReturnDate(departureDate, null).getTime()).toBe(expected.getTime());
    expect(resolveReturnDate(departureDate, "").getTime()).toBe(expected.getTime());
    expect(resolveReturnDate(departureDate, "   ").getTime()).toBe(expected.getTime());
  });

  it("falls back to +1 day when returnDate is unparseable", () => {
    const departureDate = new Date("2026-06-15T00:00:00.000Z");
    const expected = new Date(departureDate);
    expected.setDate(expected.getDate() + 1);

    expect(resolveReturnDate(departureDate, "not-a-date").getTime()).toBe(expected.getTime());
  });
});

describe("PKG-2 BUG 2 — duplicate (tourId, departureDate) rows are skipped and counted", () => {
  it("builds a day-level key set from existing departures", () => {
    const existing = [
      { departureDate: new Date("2026-06-15T00:00:00.000Z") },
      { departureDate: new Date("2026-07-01T00:00:00.000Z") },
    ];
    const keys = buildExistingDayKeySet(existing);

    expect(keys.has(departureDayKey(new Date("2026-06-15T00:00:00.000Z")))).toBe(true);
    expect(keys.has(departureDayKey(new Date("2026-07-01T00:00:00.000Z")))).toBe(true);
    expect(keys.has(departureDayKey(new Date("2026-08-01T00:00:00.000Z")))).toBe(false);
  });

  it("collides on the same calendar day regardless of time-of-day", () => {
    const morning = new Date("2026-06-15T03:00:00.000Z");
    const evening = new Date("2026-06-15T21:30:00.000Z");
    expect(departureDayKey(morning)).toBe(departureDayKey(evening));
  });

  it("skips re-imported duplicates, inserts only new dates, and reports the skip count", () => {
    // Simulate the mutation's loop: one date already exists, two are new,
    // and one of the new dates is repeated within the same batch.
    const existingDayKeys = buildExistingDayKeySet([
      { departureDate: new Date("2026-06-15T00:00:00.000Z") }, // already in DB
    ]);

    const selectedDates = [
      { date: "2026-06-15" }, // duplicate of existing → skip
      { date: "2026-07-01" }, // new → insert
      { date: "2026-07-15" }, // new → insert
      { date: "2026-07-01" }, // in-batch duplicate → skip
    ];

    const inserted: string[] = [];
    let skipped = 0;

    for (const dep of selectedDates) {
      const departureDate = new Date(dep.date);
      const dayKey = departureDayKey(departureDate);
      if (existingDayKeys.has(dayKey)) {
        skipped++;
        continue;
      }
      inserted.push(dep.date);
      existingDayKeys.add(dayKey); // guard against in-batch dupes
    }

    expect(inserted).toEqual(["2026-07-01", "2026-07-15"]);
    expect(skipped).toBe(2);
  });
});
