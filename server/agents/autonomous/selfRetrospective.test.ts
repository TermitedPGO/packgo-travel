/**
 * Vitest cases for SelfRetrospective (v2 Wave 3 Module 3.10).
 *
 * This agent reads the past 7 days of every agent's outcomes + Jeff
 * override patterns and proposes policy diffs. Runs weekly via cron
 * (retrospectiveWorker — worker-level notifyOwner already covers it,
 * so this agent is NOT wrapped with module 3.11's safety wrapper).
 *
 * Two cases — empty-data happy + structured-output round-trip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeLLMSpy = vi.fn();
vi.mock("../../_core/llm", async () => {
  const actual = await vi.importActual<typeof import("../../_core/llm")>(
    "../../_core/llm",
  );
  return { ...actual, invokeLLM: (...a: unknown[]) => invokeLLMSpy(...a) };
});

import { runSelfRetrospective } from "./selfRetrospective";

function stubResponse(
  proposals: Array<Record<string, unknown>> = [],
  summary = "Quiet week — no major patterns to flag.",
) {
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
                name: "submit_retrospective",
                arguments: JSON.stringify({
                  summary,
                  perAgentObservations: [],
                  proposals,
                }),
              },
            },
          ],
        },
      },
    ],
  };
}

describe("runSelfRetrospective — happy + failure", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
  });

  it("empty-data case — no outcomes → returns empty proposals", async () => {
    invokeLLMSpy.mockResolvedValueOnce(stubResponse([]));
    const result = await runSelfRetrospective({
      outcomes: [],
      policies: [],
      windowDays: 7,
    });
    expect(result.summary).toBeTruthy();
    expect(result.proposals).toEqual([]);
  });

  it("happy path — returns structured proposals when LLM suggests change", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubResponse(
        [
          {
            agentName: "inquiry",
            proposedRulesDiff:
              "lower booking_question.minConfidence from 80 to 75",
            proposedFullRules: '{"classifications":{"booking_question":{"minConfidence":75}}}',
            reasoning: "5 of last 10 booking_question were over-escalated",
            evidence: ["outcome #1234 conf=78 escalated", "outcome #1245 conf=82 auto-replied"],
            confidence: 70,
          },
        ],
        "1 proposal: lower booking_question threshold",
      ),
    );
    const result = await runSelfRetrospective({
      outcomes: [],
      policies: [
        {
          agentName: "inquiry",
          version: 3,
          rules: "stub policy",
        },
      ],
      windowDays: 7,
    });
    expect(result.proposals.length).toBe(1);
    expect(result.proposals[0].agentName).toBe("inquiry");
    expect(result.proposals[0].confidence).toBe(70);
  });
});
