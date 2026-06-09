/**
 * Vitest cases for `runInquiryAgent` — v2 Wave 3 Module 3.1.
 *
 * Initial scope (this commit): one happy-path case per new sub-intent
 * (5 total), verifying that the classifier round-trips each new
 * classification value end-to-end through the tool-call extraction
 * path.
 *
 * Strategy: mock `invokeLLM` to return a synthetic Anthropic-shape
 * tool_call with the expected classification, then assert
 * `runInquiryAgent(fixture).classification === expectedIntent`.
 *
 * Module 3.8 (broader smoke) will extend this same file with:
 *   - Escalation paths (refund_request / complaint / critical urgency)
 *   - Confidence < minConfidence forcing escalate even when classification
 *     suggests draft_reply
 *   - LLM returns no tool_call → throws
 *   - alwaysEscalate values bypass minConfidence comparison
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock invokeLLM BEFORE importing the agent so the agent picks up the spy.
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
import {
  FIXTURE_QUOTE_REQUEST,
  FIXTURE_FLIGHT_INQUIRY,
  FIXTURE_TOUR_COMPARISON,
  FIXTURE_VISA_INQUIRY,
  FIXTURE_DEPOSIT_INQUIRY,
  FIXTURE_REFUND_REQUEST,
  FIXTURE_COMPLAINT,
  FIXTURE_CRITICAL_URGENCY,
  FIXTURE_LOW_CONFIDENCE,
  type InquiryFixture,
} from "./inquiryAgent.fixtures";

/** Build the synthetic LLM response that `runInquiryAgent` expects. */
function stubLLMResponse(
  classification: string,
  overrides: Partial<{
    intent: string;
    urgency: string;
    sentiment: string;
    draftReply: string;
    draftLanguage: string;
    extractedCustomer: Record<string, unknown>;
    confidence: number;
    reasoning: string;
  }> = {},
) {
  const args = {
    classification,
    intent: overrides.intent ?? "stubbed intent for unit test",
    urgency: overrides.urgency ?? "normal",
    sentiment: overrides.sentiment ?? "neutral",
    draftReply:
      overrides.draftReply ??
      "您好,謝謝您的來信。我們收到後會在 24 小時內回覆您具體細節。PACK&GO Travel · Jeff & 團隊",
    draftLanguage: overrides.draftLanguage ?? "zh-TW",
    extractedCustomer: overrides.extractedCustomer ?? {
      senderEmail: "test@example.com",
    },
    confidence: overrides.confidence ?? 85,
    reasoning:
      overrides.reasoning ??
      "stubbed reasoning — unit test fixture, classifier round-trip only",
  };
  return {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "stub-tool-call",
              type: "function" as const,
              function: {
                name: "submit_inquiry_analysis",
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  };
}

async function runFixture(fixture: InquiryFixture) {
  invokeLLMSpy.mockResolvedValueOnce(stubLLMResponse(fixture.expectedIntent));
  return runInquiryAgent({
    rawMessage: `${fixture.subject}\n\n${fixture.body}`,
    channel: "email",
  });
}

describe("runInquiryAgent — v2 Wave 3 sub-intent classifier round-trip", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
  });

  it("classifies a quote_request fixture correctly", async () => {
    const result = await runFixture(FIXTURE_QUOTE_REQUEST);
    expect(result.classification).toBe("quote_request");
  });

  it("classifies a flight_inquiry fixture correctly", async () => {
    const result = await runFixture(FIXTURE_FLIGHT_INQUIRY);
    expect(result.classification).toBe("flight_inquiry");
  });

  it("classifies a tour_comparison_request fixture correctly", async () => {
    const result = await runFixture(FIXTURE_TOUR_COMPARISON);
    expect(result.classification).toBe("tour_comparison_request");
  });

  it("classifies a visa_inquiry fixture correctly", async () => {
    const result = await runFixture(FIXTURE_VISA_INQUIRY);
    expect(result.classification).toBe("visa_inquiry");
  });

  it("classifies a deposit_inquiry fixture correctly", async () => {
    const result = await runFixture(FIXTURE_DEPOSIT_INQUIRY);
    expect(result.classification).toBe("deposit_inquiry");
  });

  it("preserves the existing tool-call schema (sanity check the mock shape didn't drift)", async () => {
    // If the agent's tool-call extraction path stops matching what we mock,
    // every other test above would still pass because of mockReset behavior.
    // This case asserts we hit invokeLLM exactly once per run.
    invokeLLMSpy.mockResolvedValueOnce(stubLLMResponse("quote_request"));
    await runInquiryAgent({
      rawMessage: FIXTURE_QUOTE_REQUEST.body,
      channel: "email",
    });
    expect(invokeLLMSpy).toHaveBeenCalledTimes(1);
    const arg = invokeLLMSpy.mock.calls[0][0] as {
      model: string;
      tools: unknown[];
      toolChoice: { name: string };
    };
    expect(arg.model).toMatch(/^claude/);
    expect(arg.tools).toHaveLength(1);
    expect(arg.toolChoice).toEqual({ name: "submit_inquiry_analysis" });
  });
});

// ─── v2 Wave 3 Module 3.8 — escalation paths + LLM-error mode ─────────────

describe("runInquiryAgent — escalation paths (module 3.8)", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
  });

  it("escalates refund_request even at high confidence", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubLLMResponse("refund_request", {
        intent: "Customer wants refund",
        urgency: "normal",
        sentiment: "negative",
        confidence: 92,
        reasoning: "explicit refund request",
      }),
    );
    const result = await runInquiryAgent({
      rawMessage: FIXTURE_REFUND_REQUEST.body,
      channel: "email",
    });
    expect(result.classification).toBe("refund_request");
    expect(result.shouldEscalate).toBe(true);
  });

  it("escalates complaint regardless of confidence", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubLLMResponse("complaint", {
        intent: "Customer complaining about service",
        urgency: "high",
        sentiment: "negative",
        confidence: 85,
        reasoning: "service complaint",
      }),
    );
    const result = await runInquiryAgent({
      rawMessage: FIXTURE_COMPLAINT.body,
      channel: "email",
    });
    expect(result.shouldEscalate).toBe(true);
  });

  it("escalates critical urgency even on auto-draftable classification", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubLLMResponse("new_inquiry", {
        intent: "Customer needs help urgently",
        urgency: "critical",
        sentiment: "negative",
        confidence: 88,
        reasoning: "emergency situation",
      }),
    );
    const result = await runInquiryAgent({
      rawMessage: FIXTURE_CRITICAL_URGENCY.body,
      channel: "email",
    });
    expect(result.shouldEscalate).toBe(true);
    // Plain-Chinese reason now (no more "critical_urgency" log-speak).
    expect(result.escalationReason ?? "").toMatch(/很急/);
  });

  it("escalates when confidence < classification's minConfidence threshold", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubLLMResponse("general_info", {
        intent: "Unclear ask",
        urgency: "low",
        sentiment: "neutral",
        confidence: 30, // general_info minConfidence is 60
        reasoning: "vague",
      }),
    );
    const result = await runInquiryAgent({
      rawMessage: FIXTURE_LOW_CONFIDENCE.body,
      channel: "email",
    });
    expect(result.shouldEscalate).toBe(true);
  });

  it("throws on malformed LLM tool_call JSON", async () => {
    invokeLLMSpy.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "stub",
                type: "function" as const,
                function: {
                  name: "submit_inquiry_analysis",
                  arguments: "{ not-valid-json",
                },
              },
            ],
          },
        },
      ],
    });
    await expect(
      runInquiryAgent({
        rawMessage: FIXTURE_LOW_CONFIDENCE.body,
        channel: "email",
      }),
    ).rejects.toThrow();
  });
});
