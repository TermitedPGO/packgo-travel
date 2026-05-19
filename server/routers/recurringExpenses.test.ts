/**
 * Smoke test for Phase 4E · recurringExpenses sub-router extraction.
 * Verifies 5 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { recurringExpensesRouter } from "./recurringExpenses";

describe("recurringExpensesRouter (Phase 4E extraction)", () => {
  it("exposes 5 procedures from the pre-split source", () => {
    const procs = Object.keys((recurringExpensesRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "list",
        "create",
        "update",
        "delete",
        "applyExpense",
      ].sort(),
    );
  });
});
