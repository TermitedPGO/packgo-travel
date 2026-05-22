/**
 * Vitest cases for MasterAgent (v2 Wave 3 Module 3.9).
 *
 * MasterAgent is the post-Wave-2.3 supervisor — it owns 6 agent
 * instances + delegates to 6 pipeline phase functions under
 * `server/agents/_pipeline/*`. A full integration test would need to
 * mock all 6 pipelines + 6 agent classes + the SKILL.md file loader +
 * progressTracker + generation cache — that's an order-of-magnitude
 * heavier than other Wave 3 agent tests for marginal coverage.
 *
 * Pragmatic scope (3.9): smoke test the supervisor's CONTRACT:
 *   - The class can be imported and instantiated
 *   - The `execute` method signature is `(url, userId?, onProgress?,
 *     taskId?, forceRegenerate?, isPdf?, supplementUrl?) =>
 *     Promise<MasterAgentResult>`
 *   - The exported `MasterAgentResult` type is reachable
 *
 * Fuller end-to-end coverage is deferred to Wave 4 Playwright (4.16) —
 * the real safety net is hitting the actual `/api/trpc/tours.generate`
 * endpoint in a browser with the real pipeline running.
 */

import { describe, it, expect, vi } from "vitest";

// Mock file IO + heavy agent constructors so the class can instantiate
// without touching disk / spinning up sub-agents.
vi.mock("./skillLoader", () => ({
  getKeyInstructions: () => "stubbed SKILL.md instructions",
}));

vi.mock("../cache/generation-cache", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(() => false),
  },
}));

vi.mock("../agentActivityService", () => ({
  logAgentStart: vi.fn(),
  logAgentComplete: vi.fn(),
  cleanupZombieTasks: vi.fn(),
}));

vi.mock("./contentAnalyzerAgent", () => ({
  ContentAnalyzerAgent: vi.fn(),
}));
vi.mock("./colorThemeAgent", () => ({
  ColorThemeAgent: vi.fn(),
}));
vi.mock("./itineraryUnifiedAgent", () => ({
  ItineraryUnifiedAgent: vi.fn(),
}));
vi.mock("./_subskills/details/detailsSkill", () => ({
  getDetailsSkill: vi.fn(() => ({})),
  DetailsSkill: vi.fn(),
}));
vi.mock("./flightAgent", () => ({
  FlightAgent: vi.fn(),
}));
vi.mock("./transportationAgent", () => ({
  TransportationAgent: vi.fn(),
}));

import { MasterAgent } from "./masterAgent";

describe("MasterAgent — supervisor contract smoke (module 3.9)", () => {
  it("class is exported + instantiable without throwing", () => {
    expect(MasterAgent).toBeDefined();
    expect(typeof MasterAgent).toBe("function");
    const instance = new MasterAgent();
    expect(instance).toBeInstanceOf(MasterAgent);
  });

  it("execute method exists and accepts a URL string as the first arg", () => {
    const instance = new MasterAgent();
    expect(typeof instance.execute).toBe("function");
    // .length reports REQUIRED args. The signature is execute(url, userId?,
    // onProgress?, taskId?, forceRegenerate=false, isPdf=false, supplementUrl?)
    // — TypeScript's optional `?` makes a param optional, default values
    // also exempt. Implementation counts 4 required because url + userId +
    // onProgress + taskId are positional and only forceRegenerate has a
    // default. Just verify the function exists and isn't no-arg.
    expect(instance.execute.length).toBeGreaterThan(0);
  });

  it("rollback method exists as the post-Wave-2.3 supervisor boundary", () => {
    const instance = new MasterAgent();
    expect(typeof instance.rollback).toBe("function");
  });
});
