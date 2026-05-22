/**
 * Vitest cases for ReviewAgent (v2 Wave 3 Module 3.10).
 *
 * Happy + failure smoke. Module 3.11 wraps the export.
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

import { runReviewAgent } from "./reviewAgent";

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
                name: "submit_review_analysis",
                arguments: JSON.stringify({
                  classification: overrides.classification ?? "positive",
                  themes: overrides.themes ?? ["hotel_quality"],
                  sentiment: overrides.sentiment ?? "positive",
                  draftReply: overrides.draftReply ?? "stub draft 100 chars",
                  draftLanguage: overrides.draftLanguage ?? "zh-TW",
                  confidence: overrides.confidence ?? 85,
                  reasoning: overrides.reasoning ?? "stub",
                }),
              },
            },
          ],
        },
      },
    ],
  };
}

describe("runReviewAgent — happy + failure", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
    notifyOwnerSpy.mockReset();
    notifyOwnerSpy.mockResolvedValue(undefined);
  });

  it("happy path — 5-star review → positive classification + draftReply", async () => {
    invokeLLMSpy.mockResolvedValueOnce(stubResponse({ classification: "positive" }));
    const result = await runReviewAgent({
      reviewText: "服務很棒,謝謝你們!",
      rating: 5,
    });
    expect(result.classification).toBe("positive");
    expect(result.draftReply).toBeTruthy();
    expect(notifyOwnerSpy).not.toHaveBeenCalled();
  });

  it("failure path — no tool_call → throws + notifyOwner fires", async () => {
    invokeLLMSpy.mockResolvedValueOnce({
      choices: [{ message: { content: "", tool_calls: [] } }],
    });
    await expect(
      runReviewAgent({
        reviewText: "stub",
        rating: 3,
      }),
    ).rejects.toThrow(/no tool_call/);
    expect(notifyOwnerSpy).toHaveBeenCalledTimes(1);
    expect(notifyOwnerSpy.mock.calls[0][0].title).toContain("review");
  });
});
