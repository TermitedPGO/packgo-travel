/**
 * preDepartureNotifications router — batch 6 m3 smoke test.
 */
import { describe, it, expect } from "vitest";
import { preDepartureNotificationsRouter } from "./preDepartureNotifications";

describe("preDepartureNotificationsRouter", () => {
  it("exposes the 5 procedures", () => {
    const procs = Object.keys(
      (preDepartureNotificationsRouter as any)._def.procedures,
    );
    expect(procs.sort()).toEqual(
      ["generate", "list", "approve", "edit", "skip"].sort(),
    );
  });
});
