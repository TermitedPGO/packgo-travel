import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  /**
   * Read recent admin audit log entries.
   *
   * Already-collected since v73, but never had an admin UI to browse them.
   * Returns paginated newest-first. Supports filtering by action prefix
   * (e.g. "booking." to see only booking-related actions) and by target
   * type (tour / booking / user / visa).
   */
  auditLogList: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          cursor: z.number().int().optional(),
          actionPrefix: z.string().max(40).optional(),
          targetType: z.string().max(32).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const { getDb } = await import("../db");
      const { adminAuditLog } = await import("../../drizzle/schema");
      const { and, eq, like, lt, desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { items: [], nextCursor: null };

      const filters: any[] = [];
      if (input?.cursor) filters.push(lt(adminAuditLog.id, input.cursor));
      if (input?.actionPrefix) {
        // Prefix search is index-friendly (LIKE 'tour.%' uses prefix range
        // unlike '%xyz%' which can't).
        filters.push(like(adminAuditLog.action, `${input.actionPrefix}%`));
      }
      if (input?.targetType)
        filters.push(eq(adminAuditLog.targetType, input.targetType));

      const rows = await db
        .select({
          id: adminAuditLog.id,
          userId: adminAuditLog.userId,
          userEmail: adminAuditLog.userEmail,
          userRole: adminAuditLog.userRole,
          action: adminAuditLog.action,
          targetType: adminAuditLog.targetType,
          targetId: adminAuditLog.targetId,
          changes: adminAuditLog.changes,
          reason: adminAuditLog.reason,
          ipAddress: adminAuditLog.ipAddress,
          success: adminAuditLog.success,
          errorMessage: adminAuditLog.errorMessage,
          createdAt: adminAuditLog.createdAt,
        })
        .from(adminAuditLog)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(adminAuditLog.id))
        .limit(limit + 1);

      // Cursor pagination — keep one extra row to detect more pages
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1].id : null;

      return { items, nextCursor };
    }),
});
