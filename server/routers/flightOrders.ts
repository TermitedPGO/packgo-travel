/**
 * flightOrders router — 代客訂機票最小狀態機 (批2 m4) tRPC surface.
 *
 * Thin passthrough to server/_core/flightOrderBox.ts (state guards + audit
 * live there). All adminProcedure (role check + 60 req/min throttle). No
 * payment execution exists anywhere on this surface — see the box header.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  listFlightOrders,
  createFlightOrder,
  markAwaitingPayment,
  markTicketed,
  cancelFlightOrder,
} from "../_core/flightOrderBox";
import type { ApprovalAuditCtx } from "../_core/approvalTasks";

export const flightOrdersRouter = router({
  list: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => listFlightOrders(input.userId)),

  create: adminProcedure
    .input(
      z.object({
        customerUserId: z.number().int().positive(),
        airline: z.string().min(1).max(80),
        flightSummary: z.string().min(1).max(255),
        pricePerPerson: z.number().int().min(0).optional(),
        passengerCount: z.number().int().min(1).max(20).optional(),
        currency: z.string().length(3).optional(),
        /** passport-spelling names only — the schema has no number column. */
        passengerNames: z.string().max(500).optional(),
        bookingUrl: z.string().url().max(2000).optional(),
        notes: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      createFlightOrder(input, ctx as ApprovalAuditCtx),
    ),

  markAwaitingPayment: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        bookingUrl: z.string().url().max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      markAwaitingPayment(input.id, input.bookingUrl, ctx as ApprovalAuditCtx),
    ),

  markTicketed: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        pnr: z.string().max(20).optional(),
        eticketNumbers: z.string().max(255).optional(),
        orderRef: z.string().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      markTicketed(
        input.id,
        {
          pnr: input.pnr,
          eticketNumbers: input.eticketNumbers,
          orderRef: input.orderRef,
        },
        ctx as ApprovalAuditCtx,
      ),
    ),

  cancel: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) =>
      cancelFlightOrder(input.id, ctx as ApprovalAuditCtx),
    ),
});
