/**
 * Smoke test for Phase 4E · storage sub-router extraction.
 * Verifies 1 procedure originally at server/routers.ts L4503-4536.
 */
import { describe, it, expect } from "vitest";
import { storageRouter } from "./storage";

describe("storageRouter (Phase 4E extraction)", () => {
  it("exposes 1 procedure from the pre-split source", () => {
    const procs = Object.keys((storageRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["healthcheck"].sort());
  });
});
