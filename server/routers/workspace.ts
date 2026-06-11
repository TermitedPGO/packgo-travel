/**
 * workspace router — 整合工作台 P3.
 *
 * setDisposition: Jeff marks a customer-inbox item「處理好了 / 未處理」.
 * A disposition is his manual triage, SEPARATE from the item's own system
 * status (design.md §1.3). Presence of a row = handled; deleting = un-handled.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { and, eq } from "drizzle-orm";

export const WORKSPACE_ITEM_KINDS = ["booking", "inquiry", "task", "review"] as const;
export type WorkspaceItemKind = (typeof WORKSPACE_ITEM_KINDS)[number];

export const workspaceRouter = router({
  /**
   * All current dispositions as "kind:id" keys — lets any view (e.g. the
   * 今日待辦 roll-up board) mark which items Jeff already「處理好了」without a
   * per-item round trip. Presence of a key = handled.
   */
  listDispositions: adminProcedure.query(async () => {
    const drizzleDb = (await db.getDb())!;
    const { workspaceDispositions } = await import("../../drizzle/schema");
    const rows = await drizzleDb
      .select({
        itemKind: workspaceDispositions.itemKind,
        itemId: workspaceDispositions.itemId,
      })
      .from(workspaceDispositions);
    return rows.map((r) => `${r.itemKind}:${r.itemId}`);
  }),

  setDisposition: adminProcedure
    .input(
      z.object({
        kind: z.enum(WORKSPACE_ITEM_KINDS),
        id: z.number().int().positive(),
        handled: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const drizzleDb = (await db.getDb())!;
      const { workspaceDispositions } = await import("../../drizzle/schema");
      const by = (ctx.user as { id?: number } | undefined)?.id ?? null;

      if (input.handled) {
        await drizzleDb
          .insert(workspaceDispositions)
          .values({ itemKind: input.kind, itemId: input.id, handledBy: by })
          .onDuplicateKeyUpdate({
            set: { handledAt: new Date(), handledBy: by },
          });
      } else {
        await drizzleDb
          .delete(workspaceDispositions)
          .where(
            and(
              eq(workspaceDispositions.itemKind, input.kind),
              eq(workspaceDispositions.itemId, input.id),
            ),
          );
      }
      return { ok: true as const, handled: input.handled };
    }),
});
