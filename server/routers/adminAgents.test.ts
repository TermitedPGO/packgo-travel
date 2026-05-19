/**
 * Smoke test for Phase 4B · adminAgents sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 3 procedures originally inside the top-level `admin:` block in
 * server/routers.ts at L4682-4929. Behavioral tests for zombie-task
 * detection and 7-day activity aggregation belong to a future test
 * pass — this is the structural regression anchor.
 */
import { describe, it, expect } from "vitest";
import { adminAgentsRouter } from "./adminAgents";

describe("adminAgentsRouter (Phase 4B extraction)", () => {
  it("exposes all 3 procedures from the pre-split source", () => {
    const procs = Object.keys((adminAgentsRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      ["getAgentDailyLogs", "getAgentOfficeStatus", "getTaskHistory"].sort(),
    );
  });
});
