/**
 * Smoke test for Phase 4A · browsingHistory sub-router extraction.
 * Structural regression anchor.
 */
import { describe, it, expect } from "vitest";
import { browsingHistoryRouter } from "./browsingHistory";

describe("browsingHistoryRouter (Phase 4A extraction)", () => {
  it("exposes all 3 procedures from the pre-split source", () => {
    const procs = Object.keys((browsingHistoryRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["clear", "list", "record"].sort());
  });
});
