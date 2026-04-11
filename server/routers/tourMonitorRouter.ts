import { z } from 'zod';
import { router, adminProcedure } from '../_core/trpc';

export const tourMonitorRouter = router({
  // Manually trigger a monitor run
  triggerRun: adminProcedure
    .mutation(async ({ ctx }) => {
      const { triggerManualTourMonitor } = await import('../queue');
      const job = await triggerManualTourMonitor(ctx.user.id);
      return { jobId: job.id, message: '監控任務已觸發，請稍後查看結果' };
    }),
  // Get recent monitor logs
  getRecentLogs: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const { getRecentMonitorLogs } = await import('../services/tourMonitorService');
      return getRecentMonitorLogs(input.limit);
    }),
  // Get monitor history for a specific tour
  getTourHistory: adminProcedure
    .input(z.object({ tourId: z.number(), limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const { getTourMonitorHistory } = await import('../services/tourMonitorService');
      return getTourMonitorHistory(input.tourId, input.limit);
    }),
  // Get latest monitor run summary
  getLatestRun: adminProcedure
    .query(async () => {
      const { getLatestMonitorRun } = await import('../services/tourMonitorService');
      return getLatestMonitorRun();
    }),
  // Get monitor stats (tours with changes, errors, etc.)
  getStats: adminProcedure
    .query(async () => {
      const { getDb } = await import('../db');
      const dbConn = await getDb();
      if (!dbConn) return { total: 0, ok: 0, changed: 0, error: 0, unmonitored: 0 };
      const { tours } = await import('../../drizzle/schema');
      const { sql } = await import('drizzle-orm');
      const rows = await dbConn
        .select({
          monitorStatus: tours.monitorStatus,
          count: sql<number>`COUNT(*)`,
        })
        .from(tours)
        .where(sql`status != 'inactive'`)
        .groupBy(tours.monitorStatus);
      const stats = { total: 0, ok: 0, changed: 0, error: 0, unmonitored: 0 };
      for (const row of rows) {
        const count = Number(row.count);
        stats.total += count;
        if (row.monitorStatus === 'ok') stats.ok += count;
        else if (row.monitorStatus === 'changed') stats.changed += count;
        else if (row.monitorStatus === 'error') stats.error += count;
        else stats.unmonitored += count;
      }
      return stats;
    }),
});
