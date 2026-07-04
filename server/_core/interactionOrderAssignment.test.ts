/**
 * interactionOrderAssignment.ts — pure decision function tests. No DB, no LLM,
 * no mocks needed: every case is plain input → expected output.
 */

import { describe, it, expect } from "vitest";
import {
  decideInteractionOrderAssignment,
  type OrderCandidate,
} from "./interactionOrderAssignment";

const order = (id: number, category: string | null = "quote", destination: string | null = "台灣"): OrderCandidate => ({
  id,
  orderNumber: `ORD-2026-${String(id).padStart(4, "0")}`,
  category,
  destination,
});

describe("decideInteractionOrderAssignment", () => {
  it("rule ① thread inheritance short-circuits before even looking at candidates", () => {
    const result = decideInteractionOrderAssignment({
      priorThreadOrderId: 42,
      candidates: [order(1), order(2), order(3)], // would otherwise be ambiguous
      llmPick: { orderId: 999, confident: true }, // even a confident LLM pick must NOT override
    });
    expect(result).toEqual({ customOrderId: 42, reason: "thread_inherited" });
  });

  it("rule ① wins even with zero candidates", () => {
    const result = decideInteractionOrderAssignment({
      priorThreadOrderId: 7,
      candidates: [],
    });
    expect(result).toEqual({ customOrderId: 7, reason: "thread_inherited" });
  });

  it("rule ② exactly one in-progress order → auto-assign", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [order(5)],
    });
    expect(result).toEqual({ customOrderId: 5, reason: "single_in_progress_order" });
  });

  it("zero in-progress orders → NULL", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [],
    });
    expect(result).toEqual({ customOrderId: null, reason: "no_candidates" });
  });

  it("multiple in-progress + LLM confident pick naming a real candidate → assigned", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [order(1), order(2), order(3)],
      llmPick: { orderId: 2, confident: true },
    });
    expect(result).toEqual({ customOrderId: 2, reason: "llm_confident_pick" });
  });

  it("multiple in-progress + LLM uncertain (confident=false) → NULL, never guess", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [order(1), order(2)],
      llmPick: { orderId: 1, confident: false },
    });
    expect(result).toEqual({ customOrderId: null, reason: "ambiguous_no_llm_or_unconfident" });
  });

  it("multiple in-progress + no llmPick given at all (B4 backfill path) → NULL", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [order(1), order(2)],
    });
    expect(result).toEqual({ customOrderId: null, reason: "ambiguous_no_llm_or_unconfident" });
  });

  it("multiple in-progress + LLM picks an orderId NOT in the candidate list → NULL (hallucination guard)", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [order(1), order(2)],
      llmPick: { orderId: 999, confident: true },
    });
    expect(result).toEqual({ customOrderId: null, reason: "ambiguous_no_llm_or_unconfident" });
  });

  it("multiple in-progress + LLM picks orderId: null (declined) → NULL", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [order(1), order(2)],
      llmPick: { orderId: null, confident: true },
    });
    expect(result).toEqual({ customOrderId: null, reason: "ambiguous_no_llm_or_unconfident" });
  });

  it("priorThreadOrderId undefined + single candidate → still rule ②", () => {
    const result = decideInteractionOrderAssignment({
      priorThreadOrderId: undefined,
      candidates: [order(11)],
    });
    expect(result).toEqual({ customOrderId: 11, reason: "single_in_progress_order" });
  });

  it("priorThreadOrderId null (explicit) is treated the same as undefined", () => {
    const result = decideInteractionOrderAssignment({
      priorThreadOrderId: null,
      candidates: [order(11)],
    });
    expect(result).toEqual({ customOrderId: 11, reason: "single_in_progress_order" });
  });
});
