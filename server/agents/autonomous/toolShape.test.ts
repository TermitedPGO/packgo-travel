/**
 * Regression test for the Anthropic tool-shape bug that bit production
 * twice now:
 *
 *   - 2026-05-16: accountingAgent.ts shipped with flat `{name, parameters}`
 *     instead of nested `{type:"function", function:{name, parameters}}`.
 *     444 BofA transactions crashed in `toolsToAnthropic` with
 *     "Cannot read properties of undefined (reading 'name')".
 *   - 2026-05-21: same bug latent in inquiry + followup + marketing + review
 *     + selfRetrospective + agentReport + refund. Production InquiryAgent
 *     crashed at 23:50 UTC on the first inbound newsletter once Gmail OAuth
 *     was re-connected.
 *
 * The `as any` cast at every `tools: [TOOL as any]` call was suppressing
 * TypeScript that would have caught it. Hotfix wrapped all 7 + dropped
 * the cast + added a defensive throw in `toolsToAnthropic`.
 *
 * This test exists so the next time someone adds an agent, they hit a red
 * Vitest before shipping — not a 50-error spike in fly logs.
 *
 * Strategy: introspect each agent's tool by feeding a real LLM-call shape
 * into `toolsToAnthropic` via a stub. We can't reach the private `TOOL`
 * const directly, but every agent passes it through `invokeLLM({tools})`,
 * and we mock invokeLLM to capture the tools arg. Each agent's `runX()`
 * fails before any network call (toolChoice trip) — we just want to assert
 * the tools array passes shape validation.
 *
 * Simpler approach used here: spy on invokeLLM, call each runX with a
 * minimal valid input, capture the tools that were passed, assert each
 * has nested `.function.name` shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock invokeLLM BEFORE importing agents so the agents pick up the mock.
const invokeLLMSpy = vi.fn();
vi.mock("../../_core/llm", async () => {
  const actual = await vi.importActual<typeof import("../../_core/llm")>(
    "../../_core/llm"
  );
  return {
    ...actual,
    invokeLLM: (...args: unknown[]) => invokeLLMSpy(...args),
  };
});

import { runInquiryAgent } from "./inquiryAgent";
import { runFollowupAgent } from "./followupAgent";
import { runMarketingAgent } from "./marketingAgent";
import { runReviewAgent } from "./reviewAgent";
import { runRefundAgent } from "./refundAgent";
import { runSelfRetrospective } from "./selfRetrospective";
import { runAgentReport } from "./agentReport";

/** What a valid Anthropic-shape tool looks like. */
function assertNestedFunctionShape(tools: unknown, agentName: string) {
  expect(Array.isArray(tools), `${agentName}: tools should be an array`).toBe(
    true
  );
  const arr = tools as Array<Record<string, unknown>>;
  expect(arr.length, `${agentName}: at least one tool`).toBeGreaterThan(0);
  for (const [i, t] of arr.entries()) {
    expect(t, `${agentName}: tool[${i}] is truthy`).toBeTruthy();
    expect(
      (t as { type?: string }).type,
      `${agentName}: tool[${i}].type === "function"`
    ).toBe("function");
    const fn = (t as { function?: { name?: string } }).function;
    expect(
      fn,
      `${agentName}: tool[${i}].function exists (flat-shape bug regression!)`
    ).toBeTruthy();
    expect(
      typeof fn?.name,
      `${agentName}: tool[${i}].function.name is a string`
    ).toBe("string");
    expect(fn?.name?.length, `${agentName}: name non-empty`).toBeGreaterThan(0);
  }
}

/** Stub invokeLLM response that satisfies each agent's tool_call extraction. */
function stubResponse(toolName: string, args: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "stub",
              type: "function" as const,
              function: {
                name: toolName,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  };
}

describe("agent tool shape — Anthropic nested {function:{name,...}} format", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
  });

  it("inquiryAgent passes nested-shape tool", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubResponse("submit_inquiry_analysis", {
        classification: "general_info",
        intent: "stub",
        urgency: "low",
        sentiment: "neutral",
        draftReply: "stub",
        draftLanguage: "zh-TW",
        extractedCustomer: {},
        confidence: 50,
        reasoning: "stub",
      })
    );
    await runInquiryAgent({
      rawMessage: "test",
      channel: "email",
    } as any);
    const callArg = invokeLLMSpy.mock.calls[0]?.[0] as { tools?: unknown };
    assertNestedFunctionShape(callArg.tools, "inquiryAgent");
  });

  it("followupAgent passes nested-shape tool", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubResponse("submit_followup_draft", {
        channel: "email",
        body: "stub",
        confidence: 50,
        reasoning: "stub",
      })
    );
    await runFollowupAgent({
      stage: "pre_departure",
      daysFromStart: -7,
      destinationSummary: "stub",
      language: "zh-TW",
      isFirstFollowup: true,
    });
    const callArg = invokeLLMSpy.mock.calls[0]?.[0] as { tools?: unknown };
    assertNestedFunctionShape(callArg.tools, "followupAgent");
  });

  it("marketingAgent passes nested-shape tool", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubResponse("submit_edm_draft", {
        subject: "stub",
        preheader: "stub",
        body: "stub",
        callToAction: "stub",
        estimatedReadingTime: "30s",
        confidence: 50,
        reasoning: "stub",
        fairnessCheck: "stub",
      })
    );
    await runMarketingAgent({
      segment: "stub",
      topic: "stub",
      language: "zh-TW",
    });
    const callArg = invokeLLMSpy.mock.calls[0]?.[0] as { tools?: unknown };
    assertNestedFunctionShape(callArg.tools, "marketingAgent");
  });

  it("reviewAgent passes nested-shape tool", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubResponse("submit_review_analysis", {
        classification: "positive",
        themes: [],
        sentiment: "positive",
        draftReply: "stub",
        draftLanguage: "zh-TW",
        confidence: 50,
        reasoning: "stub",
      })
    );
    await runReviewAgent({ reviewText: "good", rating: 5 });
    const callArg = invokeLLMSpy.mock.calls[0]?.[0] as { tools?: unknown };
    assertNestedFunctionShape(callArg.tools, "reviewAgent");
  });

  it("refundAgent passes nested-shape tool", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubResponse("submit_refund_triage", {
        severity: "low",
        reasonCategory: "unclear",
        extractedFacts: { specificIncidents: [] },
        customerEmotionalState: "calm",
        jeffInternalBriefing: "stub",
        suggestedJeffActions: [],
        confidence: 50,
        reasoning: "stub",
      })
    );
    await runRefundAgent({ rawMessage: "I want a refund" });
    const callArg = invokeLLMSpy.mock.calls[0]?.[0] as { tools?: unknown };
    assertNestedFunctionShape(callArg.tools, "refundAgent");
  });

  it("selfRetrospective passes nested-shape tool", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubResponse("submit_retrospective", {
        summary: "stub",
        perAgentObservations: [],
        proposals: [],
      })
    );
    await runSelfRetrospective({
      windowDays: 7,
      outcomes: [],
      policies: [],
    } as any);
    const callArg = invokeLLMSpy.mock.calls[0]?.[0] as { tools?: unknown };
    assertNestedFunctionShape(callArg.tools, "selfRetrospective");
  });

  it("agentReport passes nested-shape tool", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubResponse("submit_status_report", {
        summary: "stub",
        accomplishments: [],
        concerns: [],
        questions: [],
      })
    );
    await runAgentReport({
      agentName: "inquiry",
      recentOutcomes: [],
      recentDmMessages: [],
    });
    const callArg = invokeLLMSpy.mock.calls[0]?.[0] as { tools?: unknown };
    assertNestedFunctionShape(callArg.tools, "agentReport");
  });
});
