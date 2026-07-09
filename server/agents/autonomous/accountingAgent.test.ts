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

import { runAccountingAgent, buildSystem, ACCOUNTING_CATEGORIES } from "./accountingAgent";

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

describe("buildSystem — prompt hygiene guard (F1 塊C 雙計防護, 2026-07-08)", () => {
  // 2026-07-08 對抗審查 P0:preClassify 的確定性規則沒命中時會退回 LLM,
  // 但 LLM 讀的就是這段 system prompt——如果這裡還在教「Stripe 撥款 =
  // income_booking」,規則庫攔不到的變體 descriptor 會被 LLM 原地重新雙計。
  // 這條鎖死「Stripe payout」跟「income_booking」不能同時出現在教 LLM
  // 要怎麼分類的語境裡,防止未來又漂移回去(仿 aafb7ef commit 的
  // prompt-hygiene 守門測試先例)。
  it("不會教 LLM 把 Stripe payout 分類成 income_booking", () => {
    const system = buildSystem();
    expect(system).toContain("stripe_payout");
    // 明確禁止舊版那句「Plaid 把 Stripe payout 分到 ... 但我們的正確分類是
    // income_booking」──不管措辭怎麼變,「Stripe payout」跟「income_booking」
    // 不應該在同一句「正確分類」的教學語境裡同時出現。
    expect(system).not.toMatch(/Stripe\s*payout.{0,20}正確分類.{0,20}income_booking/i);
    expect(system).not.toMatch(/income_booking.{0,20}正確分類.{0,20}Stripe\s*payout/i);
  });

  it("類別數量字面敘述跟 ACCOUNTING_CATEGORIES 實際長度同步(不寫死數字)", () => {
    const system = buildSystem();
    const n = ACCOUNTING_CATEGORIES.length;
    expect(system).toContain(`${n} 個 PACK&GO 類別`);
    // 舊版寫死的數字(10/9)不該再出現在「幾個類別」的語境裡。
    expect(system).not.toMatch(/\b(9|10)\s*個\s*PACK&GO\s*類別/);
  });

  it("TOOL.function.description 的類別數量同步(不寫死數字)", async () => {
    const { TOOL } = await import("./accountingAgent");
    expect(TOOL.function.description).toContain(`${ACCOUNTING_CATEGORIES.length} PACK&GO categories`);
  });
});
