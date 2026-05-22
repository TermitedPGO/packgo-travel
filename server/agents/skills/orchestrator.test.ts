/**
 * Vitest cases for the SkillOrchestrator interface (module 3.3).
 *
 * Two thrusts:
 *   1. Interface conformance — fake orchestrators pass / fail the contract
 *   2. tourComparisonOrchestrator wrapper — the first real implementor:
 *      extraction succeeds → ok=true; extraction fails → ok=false+needsJeff
 *
 * The tourComparison wrapper's downstream call to
 * `generateTourComparisonCatalog` is mocked so we don't hit Lion's API
 * during unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  SkillContext,
  SkillOrchestrator,
  SkillResult,
} from "./orchestrator";
import { safelyRun } from "./orchestrator";

// Mock the heavy downstream call BEFORE importing the orchestrator wrapper.
// The wrapper lives in tourComparisonOrchestrator.ts; it imports
// generateTourComparisonCatalog from tourComparison.ts — so we mock at
// THAT module boundary (the wrapper sees the spy on import).
const generateCatalogSpy = vi.fn();
vi.mock("./tourComparison", async () => {
  const actual = await vi.importActual<typeof import("./tourComparison")>(
    "./tourComparison",
  );
  return {
    ...actual,
    generateTourComparisonCatalog: (...args: unknown[]) =>
      generateCatalogSpy(...args),
  };
});

import { tourComparisonOrchestrator } from "./tourComparisonOrchestrator";

function makeCtx(overrides: Partial<SkillContext> = {}): SkillContext {
  const inquiry = {
    classification: "tour_comparison_request" as const,
    intent: "Customer asking for Japan trip options in September 2026",
    urgency: "normal" as const,
    sentiment: "neutral" as const,
    shouldAutoReply: true,
    shouldEscalate: false,
    draftReply: "stub draft",
    draftLanguage: "zh-TW" as const,
    extractedCustomer: { senderEmail: "test@example.com" },
    confidence: 85,
    reasoning: "stub reasoning",
  };
  return {
    inquiry,
    rawMessage: "想看日本 9 月有什麼團",
    senderEmail: "test@example.com",
    language: "zh-TW",
    correlationId: "test-corr-id-001",
    ...overrides,
  };
}

describe("SkillOrchestrator interface — conformance", () => {
  it("(case 1) a passing fake orchestrator returns ok=true with a draft body", async () => {
    const fake: SkillOrchestrator = {
      id: "fake-passing",
      async run(ctx) {
        return {
          ok: true,
          draftBody: `Hi ${ctx.senderEmail ?? "there"}!`,
          meta: { stub: true },
        };
      },
    };
    const result = await fake.run(makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draftBody).toContain("test@example.com");
      expect(result.meta).toEqual({ stub: true });
    }
  });

  it("(case 2) a failing fake orchestrator returns ok=false with needsJeff", async () => {
    const fake: SkillOrchestrator = {
      id: "fake-failing",
      async run() {
        return {
          ok: false,
          reason: "synthesized failure for test",
          needsJeff: true,
        };
      },
    };
    const result = await fake.run(makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("synthesized failure for test");
      expect(result.needsJeff).toBe(true);
    }
  });

  it("(case 3) safelyRun converts a thrown error into ok=false + needsJeff=true", async () => {
    const wrapped: SkillOrchestrator = {
      id: "fake-throwing",
      run: (ctx) =>
        safelyRun(ctx, async () => {
          throw new Error("simulated downstream blowup");
        }),
    };
    const result = await wrapped.run(makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("simulated downstream blowup");
      expect(result.needsJeff).toBe(true);
    }
  });

  it("(case 4) safelyRun passes through ok=true results unchanged", async () => {
    const wrapped: SkillOrchestrator = {
      id: "fake-passthrough",
      run: (ctx) =>
        safelyRun(ctx, async () => ({
          ok: true,
          draftBody: "passthrough",
          meta: { v: 1 },
        })),
    };
    const result = await wrapped.run(makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draftBody).toBe("passthrough");
  });
});

describe("tourComparisonOrchestrator — first real implementor", () => {
  beforeEach(() => {
    generateCatalogSpy.mockReset();
  });

  it("(case 5) happy path — Japan / September / 2026 extracted, catalog called, PDF returned", async () => {
    const fakePdf = Buffer.from("%PDF-1.4\nfake\n%%EOF", "utf-8");
    generateCatalogSpy.mockResolvedValueOnce({
      pdf: fakePdf,
      meta: {
        country: "Japan",
        monthName: "September",
        year: 2026,
        optionsFound: 5,
        departuresFound: 23,
        supplierCodes: ["LION-1", "LION-2"],
      },
    });
    const result = await tourComparisonOrchestrator.run(makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdf).toBe(fakePdf);
      expect(result.draftBody).toContain("Japan");
      expect(result.draftBody).toContain("September");
      // Zh-TW draft for a zh-TW context
      expect(result.draftBody).toContain("PACK&GO Travel");
      expect(result.meta).toMatchObject({
        country: "Japan",
        optionsFound: 5,
        departuresFound: 23,
      });
    }
    expect(generateCatalogSpy).toHaveBeenCalledTimes(1);
    expect(generateCatalogSpy.mock.calls[0][0]).toMatchObject({
      country: "Japan",
      month: 9,
      year: 2026,
    });
  });

  it("(case 6) extraction fails — no country mentioned → ok=false + needsJeff", async () => {
    const result = await tourComparisonOrchestrator.run(
      makeCtx({
        inquiry: {
          ...makeCtx().inquiry,
          intent: "Customer asking something generic, no location",
        },
        rawMessage: "hello, please reply",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.needsJeff).toBe(true);
      expect(result.reason.toLowerCase()).toContain("country");
    }
    // Should NOT have called the catalog generator at all
    expect(generateCatalogSpy).not.toHaveBeenCalled();
  });

  it("(case 7) extraction fails — country present but no month → ok=false", async () => {
    const result = await tourComparisonOrchestrator.run(
      makeCtx({
        inquiry: {
          ...makeCtx().inquiry,
          intent: "Customer interested in Japan but didn't say when",
        },
        rawMessage: "想去 日本 但還沒決定時間",
      }),
    );
    expect(result.ok).toBe(false);
    expect(generateCatalogSpy).not.toHaveBeenCalled();
  });

  it("(case 8) generator throws → safelyRun converts to ok=false + needsJeff=true", async () => {
    generateCatalogSpy.mockRejectedValueOnce(
      new Error("Lion API rate-limited"),
    );
    const result = await tourComparisonOrchestrator.run(makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("Lion API rate-limited");
      expect(result.needsJeff).toBe(true);
    }
  });

  it("(case 9) English-language context renders an English draft body", async () => {
    generateCatalogSpy.mockResolvedValueOnce({
      pdf: Buffer.from("pdf"),
      meta: {
        country: "Japan",
        monthName: "September",
        year: 2026,
        optionsFound: 5,
        departuresFound: 10,
        supplierCodes: [],
      },
    });
    const ctx = makeCtx({
      language: "en",
      rawMessage: "Looking for Japan tours in September 2026",
    });
    const result = await tourComparisonOrchestrator.run(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draftBody).toMatch(/thanks for reaching out/i);
      expect(result.draftBody).toMatch(/PACK&GO Travel/i);
    }
  });

  it("(case 10) orchestrator id matches the SkillId convention", () => {
    expect(tourComparisonOrchestrator.id).toBe("packgo-tour-comparison");
  });
});
