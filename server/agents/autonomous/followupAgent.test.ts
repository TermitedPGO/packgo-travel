/**
 * Vitest cases for FollowupAgent (v2 Wave 3 Module 3.10).
 *
 * Two cases per spec — happy round-trip + failure-mode coverage.
 * Module 3.11 wraps the export with withAutonomousSafety so throws
 * fire notifyOwner; the wrapped + unwrapped happy path is identical,
 * so the happy case is unchanged by 3.11.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeLLMSpy = vi.fn();
vi.mock("../../_core/llm", async () => {
  const actual = await vi.importActual<typeof import("../../_core/llm")>(
    "../../_core/llm",
  );
  return { ...actual, invokeLLM: (...a: unknown[]) => invokeLLMSpy(...a) };
});

const notifyOwnerSpy = vi.fn();
vi.mock("../../_core/notification", () => ({
  notifyOwner: (...a: unknown[]) => notifyOwnerSpy(...a),
}));

import { runFollowupAgent } from "./followupAgent";

function stubResponse(overrides: Record<string, unknown> = {}) {
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
                name: "submit_followup_draft",
                arguments: JSON.stringify({
                  channel: overrides.channel ?? "email",
                  body: overrides.body ?? "stub care message",
                  confidence: overrides.confidence ?? 80,
                  reasoning: overrides.reasoning ?? "stub",
                  ...overrides,
                }),
              },
            },
          ],
        },
      },
    ],
  };
}

describe("runFollowupAgent — happy + failure", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
    notifyOwnerSpy.mockReset();
    notifyOwnerSpy.mockResolvedValue(undefined);
  });

  it("happy path — pre-departure → returns email draft", async () => {
    invokeLLMSpy.mockResolvedValueOnce(stubResponse({ channel: "email" }));
    const result = await runFollowupAgent({
      stage: "pre_departure",
      daysFromStart: -7,
      destinationSummary: "黃石公園 10 日",
      language: "zh-TW",
      isFirstFollowup: true,
    });
    expect(result.channel).toBe("email");
    expect(result.body).toBeTruthy();
    expect(notifyOwnerSpy).not.toHaveBeenCalled();
  });

  it("failure path — LLM returns no tool_call → throws, notifyOwner fires (3.11 wrapper)", async () => {
    invokeLLMSpy.mockResolvedValueOnce({
      choices: [{ message: { content: "no tool_call here", tool_calls: [] } }],
    });
    await expect(
      runFollowupAgent({
        stage: "mid_trip",
        daysFromStart: 3,
        destinationSummary: "stub",
        language: "zh-TW",
        isFirstFollowup: false,
      }),
    ).rejects.toThrow(/no tool_call/);
    expect(notifyOwnerSpy).toHaveBeenCalledTimes(1);
    expect(notifyOwnerSpy.mock.calls[0][0].title).toContain("followup");
  });
});
