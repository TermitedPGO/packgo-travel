/**
 * Vitest cases for MarketingAgent (v2 Wave 3 Module 3.10).
 *
 * Happy + failure smoke. Module 3.11 wraps the export so throws fire
 * notifyOwner.
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

import { runMarketingAgent } from "./marketingAgent";

function stubResponse() {
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
                name: "submit_edm_draft",
                arguments: JSON.stringify({
                  subject: "stub subject",
                  preheader: "stub preheader",
                  body: "stub body 200 chars".repeat(20),
                  callToAction: "stub cta",
                  estimatedReadingTime: "30 秒",
                  confidence: 80,
                  reasoning: "stub",
                  fairnessCheck:
                    "stub: would write same quality for low-LTV segments",
                }),
              },
            },
          ],
        },
      },
    ],
  };
}

describe("runMarketingAgent — happy + failure", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
    notifyOwnerSpy.mockReset();
    notifyOwnerSpy.mockResolvedValue(undefined);
  });

  it("happy path — returns EDM draft + fairnessCheck", async () => {
    invokeLLMSpy.mockResolvedValueOnce(stubResponse());
    const result = await runMarketingAgent({
      segment: "首次詢問未下訂",
      topic: "黃石公園夏季團",
      language: "zh-TW",
    });
    expect(result.subject).toBe("stub subject");
    expect(result.fairnessCheck).toBeTruthy();
    expect(notifyOwnerSpy).not.toHaveBeenCalled();
  });

  it("failure path — no tool_call → throws + notifyOwner fires", async () => {
    invokeLLMSpy.mockResolvedValueOnce({
      choices: [{ message: { content: "", tool_calls: [] } }],
    });
    await expect(
      runMarketingAgent({
        segment: "stub",
        topic: "stub",
        language: "en",
      }),
    ).rejects.toThrow(/no tool_call/);
    expect(notifyOwnerSpy).toHaveBeenCalledTimes(1);
    expect(notifyOwnerSpy.mock.calls[0][0].title).toContain("marketing");
  });
});
