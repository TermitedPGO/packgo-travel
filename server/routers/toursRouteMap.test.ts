/**
 * Smoke test for Phase 4A · toursRouteMap sub-router extraction.
 *
 * NOTE: this file at 831 LOC carries the audit's "god-procedure" flag —
 * tours.getRouteMap alone is ~763 LOC. v2 backlog: extract the SVG-render
 * logic into a dedicated service so this router shrinks under 300 LOC.
 */
import { describe, it, expect } from "vitest";
import { toursRouteMapRouter } from "./toursRouteMap";

describe("toursRouteMapRouter (Phase 4A extraction)", () => {
  it("exposes both procedures from the pre-split source", () => {
    const procs = Object.keys((toursRouteMapRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["getRouteMap", "regenerateAiMap"].sort());
  });
});
