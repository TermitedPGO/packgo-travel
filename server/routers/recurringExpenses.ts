/**
 * Recurring expenses router — admin templates for repeating accounting entries.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (5):
 *   - list          – list recurring expense templates
 *   - create        – create new template
 *   - update        – edit template
 *   - delete        – delete template
 *   - applyExpense  – generate accounting entry from template
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const recurringExpensesRouter = router({
    // List recurring expenses
    list: adminProcedure.query(async () => {
      return db.getRecurringExpenses();
    }),

    // Create recurring expense template
    create: adminProcedure
      .input(z.object({
        name: z.string(),
        category: z.string(),
        amount: z.number().positive(),
        currency: z.string().default("TWD"),
        frequency: z.enum(["monthly", "quarterly", "yearly"]),
        nextDueDate: z.date(),
        isTaxDeductible: z.boolean().default(false),
        taxCategory: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return db.createRecurringExpense({
          description: input.name,
          category: input.category,
          amount: String(input.amount),
          currency: input.currency,
          frequency: input.frequency,
          dayOfMonth: new Date(input.nextDueDate).getDate(),
          isTaxDeductible: input.isTaxDeductible ? 1 : 0,
          taxCategory: input.taxCategory,
          createdBy: ctx.user.id,
        });
      }),

    // Update recurring expense
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        category: z.string().optional(),
        amount: z.number().positive().optional(),
        currency: z.string().optional(),
        frequency: z.enum(["monthly", "quarterly", "yearly"]).optional(),
        nextDueDate: z.date().optional(),
        isActive: z.boolean().optional(),
        isTaxDeductible: z.boolean().optional(),
        taxCategory: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        const mapped: Record<string, unknown> = { ...updates };
        if (updates.amount !== undefined) mapped.amount = String(updates.amount);
        if (updates.isTaxDeductible !== undefined) mapped.isTaxDeductible = updates.isTaxDeductible ? 1 : 0;
        if (updates.isActive !== undefined) mapped.isActive = updates.isActive ? 1 : 0;
        if ((updates as any).name !== undefined) { mapped.description = (updates as any).name; delete mapped.name; }
        if ((updates as any).nextDueDate !== undefined) { mapped.dayOfMonth = new Date((updates as any).nextDueDate).getDate(); delete mapped.nextDueDate; }
        return db.updateRecurringExpense(id, mapped);
      }),

    // Delete recurring expense
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteRecurringExpense(input.id);
        return { success: true };
      }),

    // Apply (generate accounting entry from) a recurring expense
    applyExpense: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const expense = await db.getRecurringExpenseById(input.id);
        if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "定期支出不存在" });
        const entry = await db.createAccountingEntry({
          entryType: "expense",
          category: expense.category as any,
          amount: expense.amount,
          currency: expense.currency,
          description: `[定期] ${expense.description}`,
          entryDate: new Date(),
          isTaxDeductible: expense.isTaxDeductible,
          taxCategory: expense.taxCategory ?? undefined,
          createdBy: ctx.user.id,
        });
        // Compute next due date from dayOfMonth
        const now = new Date();
        const nextDue = new Date(now.getFullYear(), now.getMonth(), expense.dayOfMonth ?? 1);
        if (expense.frequency === "monthly") nextDue.setMonth(nextDue.getMonth() + 1);
        else if (expense.frequency === "quarterly") nextDue.setMonth(nextDue.getMonth() + 3);
        else if (expense.frequency === "yearly") nextDue.setFullYear(nextDue.getFullYear() + 1);
        await db.updateRecurringExpense(input.id, { lastGeneratedAt: new Date() });
        return { entry, nextDueDate: nextDue };
      }),
  });
