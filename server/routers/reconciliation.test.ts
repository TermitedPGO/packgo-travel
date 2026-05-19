/**
 * Smoke test for Phase 4E · reconciliation sub-router extraction.
 * Verifies 1 procedure originally at server/routers.ts L4543-4576.
 */
import { describe, it, expect } from "vitest";
import { reconciliationRouter } from "./reconciliation";

describe("reconciliationRouter (Phase 4E extraction)", () => {
  it("exposes 1 procedure from the pre-split source", () => {
    const procs = Object.keys((reconciliationRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["runReport"].sort());
  });
});
