/**
 * Vitest cases for RefundAgent — initial scope from v2 Wave 3 Module 3.5
 * (the Stripe webhook wire).
 *
 * This file is also the home for module 3.10's broader agent vitest sweep
 * (generic happy + failure cases). 3.5 contributes the synthesizer +
 * Stripe-source assertions; 3.10 extends with the LLM-orchestration tests.
 *
 * Strategy:
 *   - synthesizeStripeRawMessage is pure → easy unit tests
 *   - runRefundAgent's actual LLM call is mocked
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeLLMSpy = vi.fn();
vi.mock("../../_core/llm", async () => {
  const actual = await vi.importActual<typeof import("../../_core/llm")>(
    "../../_core/llm",
  );
  return {
    ...actual,
    invokeLLM: (...args: unknown[]) => invokeLLMSpy(...args),
  };
});

import {
  runRefundAgent,
  synthesizeStripeRawMessage,
  DEFAULT_REFUND_POLICY,
} from "./refundAgent";

describe("synthesizeStripeRawMessage (module 3.5)", () => {
  it("formats the synthesized rawMessage with the right fields", () => {
    const msg = synthesizeStripeRawMessage({
      charge: {
        id: "ch_1ABC",
        amount: 100000, // $1000.00
        amount_refunded: 50000, // $500.00
        currency: "usd",
      },
      paymentIntentId: "pi_1DEF",
      bookingId: 4242,
      bookingSnapshot: {
        customerEmail: "alice@example.com",
        customerName: "Alice Smith",
        departureDate: new Date("2026-09-15T00:00:00.000Z"),
      },
    });
    expect(msg).toContain("[STRIPE_REFUND_AUTOMATED_TRIGGER]");
    expect(msg).toContain("Booking ID: 4242");
    expect(msg).toContain("alice@example.com");
    expect(msg).toContain("Alice Smith");
    expect(msg).toContain("Refund amount: $500.00 USD");
    expect(msg).toContain("Original charge: $1000.00 USD");
    expect(msg).toContain("ch_1ABC");
    expect(msg).toContain("pi_1DEF");
    expect(msg).toContain("2026-09-15");
    expect(msg).toContain("NOT a customer email");
  });

  it("handles missing booking snapshot gracefully", () => {
    const msg = synthesizeStripeRawMessage({
      charge: {
        id: "ch_2",
        amount: 20000,
        amount_refunded: 20000,
        currency: "usd",
      },
      paymentIntentId: "pi_2",
      bookingId: null,
    });
    expect(msg).toContain("Booking ID: (unknown)");
    expect(msg).toContain("Customer email: (unknown)");
    expect(msg).toContain("Customer name: (unknown)");
    expect(msg).toContain("Departure date: (unknown)");
  });

  it("accepts a string departureDate (not Date) without throwing", () => {
    const msg = synthesizeStripeRawMessage({
      charge: {
        id: "ch_3",
        amount: 30000,
        amount_refunded: 30000,
        currency: "usd",
      },
      paymentIntentId: "pi_3",
      bookingId: 100,
      bookingSnapshot: { departureDate: "2026-10-01" },
    });
    expect(msg).toContain("Departure date: 2026-10-01");
  });

  it("uppercases the currency code", () => {
    const msg = synthesizeStripeRawMessage({
      charge: {
        id: "ch_4",
        amount: 5000,
        amount_refunded: 5000,
        currency: "eur",
      },
      paymentIntentId: "pi_4",
    });
    expect(msg).toMatch(/Refund amount: \$50\.00 EUR/);
  });
});

describe("runRefundAgent — LLM round-trip", () => {
  beforeEach(() => {
    invokeLLMSpy.mockReset();
  });

  /** Synthetic LLM tool-call response matching the RefundAgent tool schema. */
  function stubTriageResponse(
    overrides: Partial<{
      severity: "low" | "medium" | "high" | "critical";
      reasonCategory: string;
      customerEmotionalState: string;
      jeffInternalBriefing: string;
      suggestedJeffActions: string[];
      confidence: number;
      reasoning: string;
    }> = {},
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
                  name: "submit_refund_triage",
                  arguments: JSON.stringify({
                    severity: overrides.severity ?? "medium",
                    reasonCategory:
                      overrides.reasonCategory ?? "service_quality",
                    extractedFacts: { specificIncidents: [] },
                    customerEmotionalState:
                      overrides.customerEmotionalState ?? "calm",
                    jeffInternalBriefing:
                      overrides.jeffInternalBriefing ??
                      "Customer paid $500, full refund issued. Auto-triggered.",
                    suggestedJeffActions: overrides.suggestedJeffActions ?? [
                      "Send customer a courtesy email confirming refund landed",
                    ],
                    confidence: overrides.confidence ?? 80,
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

  it("returns the triage object on a normal LLM round-trip", async () => {
    invokeLLMSpy.mockResolvedValueOnce(stubTriageResponse());
    const result = await runRefundAgent({
      rawMessage: "Some customer complaint about late tour",
    });
    expect(result.severity).toBe("medium");
    expect(result.reasonCategory).toBe("service_quality");
    expect(result.suggestedJeffActions.length).toBeGreaterThan(0);
  });

  it("forwards source=stripe_webhook + stripeContext to the LLM call", async () => {
    invokeLLMSpy.mockResolvedValueOnce(
      stubTriageResponse({ severity: "high" }),
    );
    const synthesized = synthesizeStripeRawMessage({
      charge: {
        id: "ch_X",
        amount: 100000,
        amount_refunded: 100000,
        currency: "usd",
      },
      paymentIntentId: "pi_X",
      bookingId: 999,
    });
    const result = await runRefundAgent({
      rawMessage: synthesized,
      source: "stripe_webhook",
      stripeContext: {
        chargeId: "ch_X",
        paymentIntentId: "pi_X",
        refundedAmountUsd: 1000,
        bookingId: 999,
        currency: "usd",
      },
    });
    expect(result.severity).toBe("high");
    // LLM was called once
    expect(invokeLLMSpy).toHaveBeenCalledTimes(1);
    // User message contains the synthesized rawMessage
    const callArg = invokeLLMSpy.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMsg = callArg.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("[STRIPE_REFUND_AUTOMATED_TRIGGER]");
    expect(userMsg?.content).toContain("ch_X");
  });

  it("DEFAULT_REFUND_POLICY locks alwaysEscalate=true (constitutional invariant)", () => {
    expect(DEFAULT_REFUND_POLICY.alwaysEscalate).toBe(true);
  });
});
