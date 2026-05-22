/**
 * Vitest cases for module 3.4-A — the pure skill dispatcher.
 *
 * Exercises every branch of dispatchSkillFromInquiry:
 *   - all 3 skip reasons (agent-already-escalated, below-threshold, no-skill)
 *   - ran/ok=true happy path (tourComparison)
 *   - ran/ok=false (orchestrator returns ok=false)
 *   - ran/ok=false via safelyRun (orchestrator throws)
 *   - env threshold override (95 raises the bar)
 *
 * The registry is real (no mock) — we exercise the actual wiring from
 * 3.1 / 3.2 / 3.3. The only mock is `generateTourComparisonCatalog` so
 * we don't hit Lion's API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { InquiryAgentOutput } from "../autonomous/inquiryAgent";

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

// DB + storage mocks for the persisting variant. Both are top-level
// imports inside dispatcher.ts so vi.mock catches them at module load.
const dbInsertSpy = vi.fn();
const dbUpdateSetSpy = vi.fn();
const dbUpdateWhereSpy = vi.fn();
const storagePutSpy = vi.fn();

vi.mock("../../db", () => ({
  // Return a fake db builder; tests reset spy behavior per case.
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (vals: unknown) => dbInsertSpy(vals),
    }),
    update: () => ({
      set: (set: unknown) => {
        dbUpdateSetSpy(set);
        return { where: (clause: unknown) => dbUpdateWhereSpy(clause) };
      },
    }),
  })),
}));

vi.mock("../../storage", () => ({
  storagePut: (...args: unknown[]) => storagePutSpy(...args),
}));

import {
  dispatchSkillFromInquiry,
  dispatchAndPersistFromInquiry,
} from "./dispatcher";

function makeInquiry(
  overrides: Partial<InquiryAgentOutput> = {},
): InquiryAgentOutput {
  return {
    classification: "tour_comparison_request",
    intent: "Wants Japan tours in September 2026",
    urgency: "normal",
    sentiment: "neutral",
    shouldAutoReply: true,
    shouldEscalate: false,
    draftReply: "stub draft",
    draftLanguage: "zh-TW",
    extractedCustomer: { senderEmail: "test@example.com" },
    confidence: 85,
    reasoning: "stub",
    ...overrides,
  };
}

describe("dispatchSkillFromInquiry — pure dispatcher (3.4-A)", () => {
  let savedThreshold: string | undefined;

  beforeEach(() => {
    generateCatalogSpy.mockReset();
    savedThreshold = process.env.AGENT_CONFIDENCE_THRESHOLD;
    delete process.env.AGENT_CONFIDENCE_THRESHOLD;
  });

  afterEach(() => {
    if (savedThreshold !== undefined) {
      process.env.AGENT_CONFIDENCE_THRESHOLD = savedThreshold;
    } else {
      delete process.env.AGENT_CONFIDENCE_THRESHOLD;
    }
  });

  describe("skip paths (kind: 'skipped')", () => {
    it("agent-already-escalated when shouldEscalate=true", async () => {
      const result = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({ shouldEscalate: true }),
        rawMessage: "test",
        correlationId: "corr-1",
      });
      expect(result.kind).toBe("skipped");
      if (result.kind === "skipped") {
        expect(result.reason).toBe("agent-already-escalated");
      }
      expect(generateCatalogSpy).not.toHaveBeenCalled();
    });

    it("confidence-below-threshold when confidence < default 80", async () => {
      const result = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({ confidence: 60 }),
        rawMessage: "test",
        correlationId: "corr-2",
      });
      expect(result.kind).toBe("skipped");
      if (result.kind === "skipped") {
        expect(result.reason).toBe("confidence-below-threshold");
      }
    });

    it("confidence-below-threshold respects env override (95 raises bar)", async () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "95";
      // confidence=85 would pass the default 80 but fails 95
      const result = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({ confidence: 85 }),
        rawMessage: "test",
        correlationId: "corr-3",
      });
      expect(result.kind).toBe("skipped");
      if (result.kind === "skipped") {
        expect(result.reason).toBe("confidence-below-threshold");
      }
    });

    it("no-skill-registered for refund_request (deliberately not in registry)", async () => {
      const result = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({
          classification: "refund_request",
          // refund_request normally escalates, but if a future policy
          // change unbroke that, the registry-null gate still catches it.
          shouldEscalate: false,
        }),
        rawMessage: "test",
        correlationId: "corr-4",
      });
      expect(result.kind).toBe("skipped");
      if (result.kind === "skipped") {
        expect(result.reason).toBe("no-skill-registered");
      }
    });

    it("no-skill-registered for complaint", async () => {
      const result = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({
          classification: "complaint",
          shouldEscalate: false,
        }),
        rawMessage: "test",
        correlationId: "corr-5",
      });
      expect(result.kind).toBe("skipped");
      if (result.kind === "skipped") {
        expect(result.reason).toBe("no-skill-registered");
      }
    });

    it("no-skill-registered for unported visa_inquiry (isPorted=false)", async () => {
      const result = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({ classification: "visa_inquiry" }),
        rawMessage: "中國簽證怎麼辦",
        correlationId: "corr-6",
      });
      expect(result.kind).toBe("skipped");
      if (result.kind === "skipped") {
        expect(result.reason).toBe("no-skill-registered");
      }
    });
  });

  describe("ran paths (kind: 'ran')", () => {
    it("tour_comparison_request happy path → ok=true + draftBody + PDF", async () => {
      const fakePdf = Buffer.from("%PDF-1.4\nfake\n%%EOF");
      generateCatalogSpy.mockResolvedValueOnce({
        pdf: fakePdf,
        meta: {
          country: "Japan",
          monthName: "September",
          year: 2026,
          optionsFound: 5,
          departuresFound: 12,
          supplierCodes: ["LION-1"],
        },
      });
      const outcome = await dispatchSkillFromInquiry({
        inquiry: makeInquiry(),
        rawMessage: "想看日本 9 月有什麼團",
        senderEmail: "customer@example.com",
        correlationId: "corr-7",
      });
      expect(outcome.kind).toBe("ran");
      if (outcome.kind === "ran") {
        expect(outcome.result.ok).toBe(true);
        if (outcome.result.ok) {
          expect(outcome.result.pdf).toBe(fakePdf);
          expect(outcome.result.draftBody).toContain("Japan");
          expect(outcome.result.draftBody).toContain("September");
        }
      }
      // Catalog was called exactly once with the right shape
      expect(generateCatalogSpy).toHaveBeenCalledTimes(1);
      expect(generateCatalogSpy.mock.calls[0][0]).toMatchObject({
        country: "Japan",
        month: 9,
        year: 2026,
      });
    });

    it("new_inquiry routes to tour-comparison fallback (the catch-all)", async () => {
      generateCatalogSpy.mockResolvedValueOnce({
        pdf: Buffer.from("pdf"),
        meta: {
          country: "Japan",
          monthName: "September",
          year: 2026,
          optionsFound: 3,
          departuresFound: 5,
          supplierCodes: [],
        },
      });
      const outcome = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({ classification: "new_inquiry" }),
        rawMessage: "想去日本 9 月",
        correlationId: "corr-8",
      });
      expect(outcome.kind).toBe("ran");
      if (outcome.kind === "ran") {
        expect(outcome.result.ok).toBe(true);
      }
      expect(generateCatalogSpy).toHaveBeenCalledTimes(1);
    });

    it("orchestrator returns ok=false → dispatcher forwards unchanged", async () => {
      // Orchestrator's own extraction will fail when country isn't mentioned
      const outcome = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({
          intent: "Some generic ask without country or month",
        }),
        rawMessage: "hello, please help",
        correlationId: "corr-9",
      });
      expect(outcome.kind).toBe("ran");
      if (outcome.kind === "ran") {
        expect(outcome.result.ok).toBe(false);
        if (!outcome.result.ok) {
          expect(outcome.result.needsJeff).toBe(true);
          expect(outcome.result.reason.toLowerCase()).toContain("country");
        }
      }
      // Catalog generator NOT called because extraction failed before
      expect(generateCatalogSpy).not.toHaveBeenCalled();
    });

    it("orchestrator throws → safelyRun wraps into ok=false + needsJeff=true", async () => {
      generateCatalogSpy.mockRejectedValueOnce(new Error("Lion 503 timeout"));
      const outcome = await dispatchSkillFromInquiry({
        inquiry: makeInquiry(),
        rawMessage: "日本 9 月",
        correlationId: "corr-10",
      });
      expect(outcome.kind).toBe("ran");
      if (outcome.kind === "ran") {
        expect(outcome.result.ok).toBe(false);
        if (!outcome.result.ok) {
          expect(outcome.result.reason).toBe("Lion 503 timeout");
          expect(outcome.result.needsJeff).toBe(true);
        }
      }
    });

    it("threshold boundary — confidence exactly equals threshold dispatches", async () => {
      generateCatalogSpy.mockResolvedValueOnce({
        pdf: Buffer.from("pdf"),
        meta: {
          country: "Japan",
          monthName: "September",
          year: 2026,
          optionsFound: 1,
          departuresFound: 1,
          supplierCodes: [],
        },
      });
      const outcome = await dispatchSkillFromInquiry({
        inquiry: makeInquiry({ confidence: 80 }), // exactly threshold
        rawMessage: "日本 9 月",
        correlationId: "corr-11",
      });
      expect(outcome.kind).toBe("ran");
    });
  });
});

describe("dispatchAndPersistFromInquiry — DB-persisting variant (3.4-B)", () => {
  beforeEach(() => {
    generateCatalogSpy.mockReset();
    dbInsertSpy.mockReset();
    dbUpdateSetSpy.mockReset();
    dbUpdateWhereSpy.mockReset();
    storagePutSpy.mockReset();
    // Default db behavior: insert returns [{insertId: 4242}]; update resolves.
    dbInsertSpy.mockResolvedValue([{ insertId: 4242 }]);
    dbUpdateWhereSpy.mockResolvedValue(undefined);
    storagePutSpy.mockResolvedValue({ url: "https://r2.example/test.pdf" });
  });

  it("skip paths never write a skillRuns row (no DB calls)", async () => {
    const outcome = await dispatchAndPersistFromInquiry({
      inquiry: makeInquiry({ shouldEscalate: true }),
      rawMessage: "test",
      correlationId: "p-skip-1",
    });
    expect(outcome.kind).toBe("skipped");
    expect(dbInsertSpy).not.toHaveBeenCalled();
    expect(dbUpdateSetSpy).not.toHaveBeenCalled();
    expect(storagePutSpy).not.toHaveBeenCalled();
  });

  it("skipped/no-skill-registered when registry returns null", async () => {
    const outcome = await dispatchAndPersistFromInquiry({
      inquiry: makeInquiry({
        classification: "refund_request",
        shouldEscalate: false,
      }),
      rawMessage: "test",
      correlationId: "p-skip-2",
    });
    expect(outcome.kind).toBe("skipped");
    expect(dbInsertSpy).not.toHaveBeenCalled();
  });

  it("happy path — inserts running row, calls orchestrator, uploads PDF, updates succeeded", async () => {
    const fakePdf = Buffer.from("%PDF-1.4\nabc\n%%EOF");
    generateCatalogSpy.mockResolvedValueOnce({
      pdf: fakePdf,
      meta: {
        country: "Japan",
        monthName: "September",
        year: 2026,
        optionsFound: 4,
        departuresFound: 9,
        supplierCodes: ["L1"],
      },
    });

    const outcome = await dispatchAndPersistFromInquiry({
      inquiry: makeInquiry(),
      rawMessage: "想看日本 9 月有什麼團",
      senderEmail: "c@example.com",
      interactionId: 1234,
      correlationId: "p-happy",
    });

    expect(outcome.kind).toBe("ran");
    if (outcome.kind === "ran") {
      expect(outcome.skillRunId).toBe(4242);
      expect(outcome.result.ok).toBe(true);
      expect(outcome.pdfStoragePath).toBe(
        "skill-runs/4242/packgo-tour-comparison.pdf",
      );
    }

    // Initial "running" claim
    expect(dbInsertSpy).toHaveBeenCalledTimes(1);
    expect(dbInsertSpy.mock.calls[0][0]).toMatchObject({
      skillId: "packgo-tour-comparison",
      intent: "tour_comparison_request",
      interactionId: 1234,
      status: "running",
    });

    // PDF uploaded
    expect(storagePutSpy).toHaveBeenCalledTimes(1);
    expect(storagePutSpy.mock.calls[0][0]).toBe(
      "skill-runs/4242/packgo-tour-comparison.pdf",
    );
    expect(storagePutSpy.mock.calls[0][2]).toBe("application/pdf");

    // Completion update
    expect(dbUpdateSetSpy).toHaveBeenCalledTimes(1);
    expect(dbUpdateSetSpy.mock.calls[0][0]).toMatchObject({
      status: "succeeded",
      pdfStoragePath: "skill-runs/4242/packgo-tour-comparison.pdf",
    });
  });

  it("orchestrator returns ok=false+needsJeff=true → status='escalated'", async () => {
    // No country in raw message → extraction fails → ok=false from orchestrator
    const outcome = await dispatchAndPersistFromInquiry({
      inquiry: makeInquiry({
        intent: "Some generic question",
      }),
      rawMessage: "hello please help",
      interactionId: 100,
      correlationId: "p-esc",
    });

    expect(outcome.kind).toBe("ran");
    if (outcome.kind === "ran") {
      expect(outcome.result.ok).toBe(false);
      if (!outcome.result.ok) {
        expect(outcome.result.needsJeff).toBe(true);
      }
    }
    // Should have inserted running + updated to escalated
    expect(dbInsertSpy).toHaveBeenCalled();
    expect(dbUpdateSetSpy).toHaveBeenCalledTimes(1);
    expect(dbUpdateSetSpy.mock.calls[0][0]).toMatchObject({
      status: "escalated",
    });
    // No PDF since orchestrator never produced one
    expect(storagePutSpy).not.toHaveBeenCalled();
  });

  it("graceful degradation — DB insert fails but orchestrator still runs", async () => {
    dbInsertSpy.mockRejectedValueOnce(new Error("TiDB connection refused"));
    generateCatalogSpy.mockResolvedValueOnce({
      pdf: Buffer.from("pdf"),
      meta: {
        country: "Japan",
        monthName: "September",
        year: 2026,
        optionsFound: 1,
        departuresFound: 1,
        supplierCodes: [],
      },
    });

    const outcome = await dispatchAndPersistFromInquiry({
      inquiry: makeInquiry(),
      rawMessage: "日本 9 月",
      correlationId: "p-degrade",
    });

    expect(outcome.kind).toBe("ran");
    if (outcome.kind === "ran") {
      // Orchestrator still produced output
      expect(outcome.result.ok).toBe(true);
      // skillRunId is 0 because the claim insert failed
      expect(outcome.skillRunId).toBe(0);
      // No PDF upload (we skip upload when skillRunId is 0 since we'd
      // have no row to point at it)
      expect(outcome.pdfStoragePath).toBeUndefined();
    }
    expect(storagePutSpy).not.toHaveBeenCalled();
  });

  it("PDF upload failure doesn't break the outcome", async () => {
    storagePutSpy.mockRejectedValueOnce(new Error("R2 503"));
    generateCatalogSpy.mockResolvedValueOnce({
      pdf: Buffer.from("pdf"),
      meta: {
        country: "Japan",
        monthName: "September",
        year: 2026,
        optionsFound: 1,
        departuresFound: 1,
        supplierCodes: [],
      },
    });

    const outcome = await dispatchAndPersistFromInquiry({
      inquiry: makeInquiry(),
      rawMessage: "日本 9 月",
      correlationId: "p-r2fail",
    });

    expect(outcome.kind).toBe("ran");
    if (outcome.kind === "ran") {
      expect(outcome.result.ok).toBe(true);
      expect(outcome.pdfStoragePath).toBeUndefined();
    }
    // Update still fires (just without pdfStoragePath)
    expect(dbUpdateSetSpy).toHaveBeenCalledTimes(1);
    expect(dbUpdateSetSpy.mock.calls[0][0]).toMatchObject({
      status: "succeeded",
      pdfStoragePath: null,
    });
  });
});
