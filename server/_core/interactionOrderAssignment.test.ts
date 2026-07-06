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

  // F3 回爐:唯一在辦單不再裸掛 —— 新 thread 的唯一候選也要 confident LLM pick,否則 NULL。
  it("F3: exactly one in-progress order + no llmPick → NULL(不再裸掛)", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [order(5)],
    });
    expect(result).toEqual({ customOrderId: null, reason: "ambiguous_no_llm_or_unconfident" });
  });

  it("F3: exactly one candidate + confident LLM pick naming it → assigned", () => {
    const result = decideInteractionOrderAssignment({
      candidates: [order(5)],
      llmPick: { orderId: 5, confident: true },
    });
    expect(result).toEqual({ customOrderId: 5, reason: "llm_confident_pick" });
  });

  it("F3 紅例(Yosemite 混進 Napa):唯一候選 + LLM 說是新主題(confident=false)→ NULL,不混單", () => {
    // 客人只有一張 Napa 報價單(order 5),但這封問優勝美地 = 新主題,
    // LLM 回 confident=false → 絕不裸掛進 Napa 單(這正是 prod 實測踩到的)。
    const result = decideInteractionOrderAssignment({
      candidates: [order(5, "quote", "Napa")],
      llmPick: { orderId: 5, confident: false },
    });
    expect(result).toEqual({ customOrderId: null, reason: "ambiguous_no_llm_or_unconfident" });
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

  it("F3: priorThreadOrderId undefined + single candidate (no llmPick) → NULL(不再裸掛)", () => {
    const result = decideInteractionOrderAssignment({
      priorThreadOrderId: undefined,
      candidates: [order(11)],
    });
    expect(result).toEqual({ customOrderId: null, reason: "ambiguous_no_llm_or_unconfident" });
  });

  it("priorThreadOrderId null (explicit) 與 undefined 同義:single + confident pick → assigned", () => {
    const result = decideInteractionOrderAssignment({
      priorThreadOrderId: null,
      candidates: [order(11)],
      llmPick: { orderId: 11, confident: true },
    });
    expect(result).toEqual({ customOrderId: 11, reason: "llm_confident_pick" });
  });
});
