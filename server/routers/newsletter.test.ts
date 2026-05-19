/**
 * Smoke test for Phase 4A · newsletter sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 4 procedures originally at server/routers.ts L5325-5434. Behavioral
 * tests for these procedures (subscribe rate limit, owner notify
 * dedup, etc.) belong to a future test pass — this is the structural
 * regression anchor.
 */
import { describe, it, expect } from "vitest";
import { newsletterRouter } from "./newsletter";

describe("newsletterRouter (Phase 4A extraction)", () => {
  it("exposes all 4 procedures from the pre-split source", () => {
    const procs = Object.keys((newsletterRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      ["exportSubscribers", "listSubscribers", "subscribe", "unsubscribe"].sort(),
    );
  });
});
