/**
 * Vitest cases for AccountingAgent (v2 Wave 3 Module 3.10).
 *
 * Happy + failure smoke. Module 3.11 wraps the export.
 *
 * Historical note: this agent crashed in prod 2026-05-16 on 444 BofA
 * transactions because its TOOL constant used the flat shape instead
 * of OpenAI nested ({type:"function", function:{...}}). Fix shipped
 * in commit before this test; the regression sweep in toolShape.test.ts
 * covers that bug pattern across all 7 agents.
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

import { runAccountingAgent } from "./accountingAgent";

function stubResponse(category: string, confidence = 85) {
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
                name: "submit_classification",
                arguments: JSON.stringify({
                  category,
                  confidence,
                  reasoning: "stub PACK&GO-specific signal",
                  needsHumanReview: confidence < 80,
                }),
              },
            },
          ],
        },
      },
    ],
  };
}

describe("runAccountingAgent — happy + failure", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
    notifyOwnerSpy.mockReset();
    notifyOwnerSpy.mockResolvedValue(undefined);
  });

  it("happy path — Lion Travel charge → cogs_tour category", async () => {
    invokeLLMSpy.mockResolvedValueOnce(stubResponse("cogs_tour", 92));
    const result = await runAccountingAgent({
      amount: 50000,
      date: "2026-05-15",
      merchantName: "LION TRAVEL CORP",
      description: "Booking deposit",
      paymentChannel: "online",
      plaidCategoryPrimary: "TRAVEL",
      plaidCategoryDetailed: "TRAVEL_FLIGHTS",
      isoCurrencyCode: "USD",
      accountType: "credit",
      accountName: "BofA Business Credit",
      isTrustAccount: false,
    });
    expect(result.category).toBe("cogs_tour");
    expect(result.confidence).toBe(92);
    expect(result.needsHumanReview).toBe(false);
    expect(notifyOwnerSpy).not.toHaveBeenCalled();
  });

  it("failure path — no tool_call → throws + notifyOwner fires", async () => {
    invokeLLMSpy.mockResolvedValueOnce({
      choices: [{ message: { content: "", tool_calls: [] } }],
    });
    await expect(
      runAccountingAgent({
        amount: 100,
        date: "2026-05-15",
        merchantName: null,
        description: null,
        paymentChannel: null,
        plaidCategoryPrimary: null,
        plaidCategoryDetailed: null,
        isoCurrencyCode: "USD",
        accountType: "depository",
        accountName: null,
        isTrustAccount: false,
      }),
    ).rejects.toThrow();
    expect(notifyOwnerSpy).toHaveBeenCalledTimes(1);
    expect(notifyOwnerSpy.mock.calls[0][0].title).toContain("accounting");
  });
});
