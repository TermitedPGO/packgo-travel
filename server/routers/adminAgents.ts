/**
 * Admin agents router — read-only autonomous-agent operations monitoring.
 *
 * Extracted from server/routers.ts (Phase 4B · sub-PR 2 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 * Source range (verbatim from origin): L4682-4929 inside `admin:` block.
 *
 * Procedures:
 *   - getAgentDailyLogs   – today's per-agent stats + recent activity
 *                            from llmUsageLogs (RPG-style daily report)
 *   - getAgentOfficeStatus – 7-day agent activity from agentActivityLogs
 *                            plus active/zombie task housekeeping
 *   - getTaskHistory      – paginated AI task execution history
 *                            with zombie-task auto-detection
 *
 * NOTE: getAgentOfficeStatus performs an UPDATE on agentActivityLogs as
 * a side-effect (marks zombie tasks as 'failed'). This is technically a
 * write, but it's stale-data housekeeping with no business impact, not
 * an admin-mutation. Kept here intentionally; flagged for Phase 4E review
 * if a cleaner separation is desired.
 *
 * Composed back into `admin:` via spread in server/routers.ts so existing
 * client trpc.admin.* paths resolve unchanged.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const adminAgentsRouter = router({
  // Get today's activity logs per agent (for RPG daily report)
  getAgentDailyLogs: adminProcedure
    .query(async () => {
      const { llmUsageLogs } = await import('../../drizzle/schema');
      const { gte, sql, desc } = await import('drizzle-orm');
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB not available' });

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Today's stats per agent
      const todayStats = await drizzleDb
        .select({
          agentName: llmUsageLogs.agentName,
          calls: sql<number>`COUNT(*)`,
          totalTokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
          avgMs: sql<number>`AVG(${llmUsageLogs.processingTimeMs})`,
          lastActive: sql<string>`MAX(${llmUsageLogs.createdAt})`,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, todayStart))
        .groupBy(llmUsageLogs.agentName)
        .orderBy(desc(sql`COUNT(*)`));

      // Recent activity logs today
      const recentActivity = await drizzleDb
        .select({
          agentName: llmUsageLogs.agentName,
          taskType: llmUsageLogs.taskType,
          taskId: llmUsageLogs.taskId,
          totalTokens: llmUsageLogs.totalTokens,
          processingTimeMs: llmUsageLogs.processingTimeMs,
          wasFromCache: llmUsageLogs.wasFromCache,
          createdAt: llmUsageLogs.createdAt,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, todayStart))
        .orderBy(desc(llmUsageLogs.createdAt))
        .limit(200);

      // All-time stats per agent for level calculation
      const allTimeStats = await drizzleDb
        .select({
          agentName: llmUsageLogs.agentName,
          totalCalls: sql<number>`COUNT(*)`,
          totalTokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
        })
        .from(llmUsageLogs)
        .groupBy(llmUsageLogs.agentName);

      return {
        todayStats: todayStats.map(s => ({
          agentName: s.agentName,
          calls: Number(s.calls),
          totalTokens: Number(s.totalTokens),
          avgMs: Math.round(Number(s.avgMs ?? 0)),
          lastActive: s.lastActive,
        })),
        recentActivity: recentActivity.map(a => ({
          agentName: a.agentName,
          taskType: a.taskType ?? 'other',
          taskId: a.taskId,
          totalTokens: a.totalTokens,
          processingTimeMs: a.processingTimeMs,
          wasFromCache: a.wasFromCache,
          createdAt: a.createdAt,
        })),
        allTimeStats: allTimeStats.map(s => ({
          agentName: s.agentName,
          totalCalls: Number(s.totalCalls),
          totalTokens: Number(s.totalTokens),
        })),
      };
    }),

  // AI 辦公室：取得所有 Agent 的即時狀態和今日工作日誌
  getAgentOfficeStatus: adminProcedure
    .query(async () => {
      const { agentActivityLogs, llmUsageLogs } = await import('../../drizzle/schema');
      const { gte, desc, sql, eq, and } = await import('drizzle-orm');
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB not available' });

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // 最近 7 天的時間範圍（用於顯示活動記錄，避免今日無任務時空白）
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // 最近 7 天的活動日誌（最近 200 筆）
      const todayActivities = await drizzleDb
        .select()
        .from(agentActivityLogs)
        .where(gte(agentActivityLogs.startedAt, sevenDaysAgo))
        .orderBy(desc(agentActivityLogs.startedAt))
        .limit(200);

      // 每個 Agent 的最近 7 天統計（從 llmUsageLogs）
      const agentTodayStats = await drizzleDb
        .select({
          agentName: llmUsageLogs.agentName,
          calls: sql<number>`COUNT(*)`,
          totalTokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
          lastActive: sql<string>`MAX(${llmUsageLogs.createdAt})`,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, sevenDaysAgo))
        .groupBy(llmUsageLogs.agentName);

      // 最近 10 筆正在執行中的任務（只顯示 status='started' 的任務）
      // Round 36-Fix: 從 5 分鐘改為 30 分鐘，避免長時間執行的任務在工作日誌中消失
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const activeTasks = await drizzleDb
        .select()
        .from(agentActivityLogs)
        .where(
          and(
            gte(agentActivityLogs.startedAt, thirtyMinutesAgo),
            eq(agentActivityLogs.status, 'started')
          )
        )
        .orderBy(desc(agentActivityLogs.startedAt))
        .limit(10);

      // 清理殭屍任務：超過 30 分鐘仍為 started 的任務自動標記為 failed
      // Round 36-Fix-3: 從 20 分鐘延長到 30 分鐘，與 index.ts 排程器保持一致
      const thirtyMinutesAgoForCleanup = new Date(Date.now() - 30 * 60 * 1000);
      await drizzleDb
        .update(agentActivityLogs)
        .set({
          status: 'failed',
          errorMessage: '任務逾時（超過 30 分鐘未完成）。可能原因：(1) URL 無法存取或載入太慢 (2) LLM 處理逾時 (3) 網路連線問題。建議改用 PDF 上傳方式。',
          completedAt: new Date(),
        })
        .where(
          and(
            eq(agentActivityLogs.status, 'started'),
            gte(agentActivityLogs.startedAt, todayStart),
            sql`${agentActivityLogs.startedAt} < ${thirtyMinutesAgoForCleanup}`
          )
        );

      return {
        todayActivities: todayActivities.map(a => ({
          id: a.id,
          agentName: a.agentName,
          agentKey: a.agentKey,
          taskType: a.taskType,
          taskId: a.taskId,
          taskTitle: a.taskTitle,
          status: a.status,
          resultSummary: a.resultSummary,
          errorMessage: a.errorMessage,
          processingTimeMs: a.processingTimeMs,
          startedAt: a.startedAt,
          completedAt: a.completedAt,
        })),
        agentTodayStats: agentTodayStats.map(s => ({
          agentName: s.agentName,
          calls: Number(s.calls),
          totalTokens: Number(s.totalTokens),
          lastActive: s.lastActive,
        })),
        activeTasks: activeTasks.map(a => ({
          id: a.id,
          agentName: a.agentName,
          agentKey: a.agentKey,
          taskType: a.taskType,
          taskTitle: a.taskTitle,
          status: a.status,
          startedAt: a.startedAt,
        })),
      };
    }),
  // Task History: 取得所有 AI 任務執行記錄（分頁）
  getTaskHistory: adminProcedure
    .input(z.object({
      page: z.number().optional().default(1),
      limit: z.number().optional().default(50),
      agentName: z.string().optional(),
      status: z.enum(['started', 'completed', 'failed', 'idle']).optional(),
    }).optional())
    .query(async ({ input }) => {
      const { agentActivityLogs, llmUsageLogs: _llmUsageLogs } = await import('../../drizzle/schema');
      const { desc, eq, and, sql, gte: _gte } = await import('drizzle-orm');
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB not available' });
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 50;
      const offset = (page - 1) * limit;
      const conditions: any[] = [];
      if (input?.agentName) conditions.push(eq(agentActivityLogs.agentName, input.agentName));
      if (input?.status) conditions.push(eq(agentActivityLogs.status, input.status));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const [logs, countResult, summaryResult] = await Promise.all([
        drizzleDb
          .select()
          .from(agentActivityLogs)
          .where(whereClause)
          .orderBy(desc(agentActivityLogs.startedAt))
          .limit(limit)
          .offset(offset),
        drizzleDb
          .select({ count: sql<number>`COUNT(*)` })
          .from(agentActivityLogs)
          .where(whereClause),
        drizzleDb
          .select({
            totalTasks: sql<number>`COUNT(*)`,
            completedTasks: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
            failedTasks: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
            avgProcessingMs: sql<number>`AVG(processingTimeMs)`,
          })
          .from(agentActivityLogs),
      ]);
      const total = Number(countResult[0]?.count ?? 0);
      return {
        logs: logs.map(l => {
          // Auto-detect zombie tasks: started > 30 min ago with no completion
          const isZombie = l.status === 'started' && l.startedAt &&
            (Date.now() - new Date(l.startedAt).getTime() > 30 * 60 * 1000);
          return {
            id: l.id,
            agentName: l.agentName,
            agentKey: l.agentKey,
            taskType: l.taskType,
            taskId: l.taskId,
            taskTitle: l.taskTitle,
            status: isZombie ? 'completed' as const : l.status,
            resultSummary: isZombie ? (l.resultSummary || '任務已完成（狀態自動修正）') : l.resultSummary,
            errorMessage: l.errorMessage,
            processingTimeMs: l.processingTimeMs,
            startedAt: l.startedAt,
            completedAt: l.completedAt,
          };
        }),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        summary: {
          totalTasks: Number(summaryResult[0]?.totalTasks ?? 0),
          // Count zombie tasks (started > 30 min) as completed in summary
          completedTasks: Number(summaryResult[0]?.completedTasks ?? 0) +
            logs.filter(l => l.status === 'started' && l.startedAt &&
              (Date.now() - new Date(l.startedAt).getTime() > 30 * 60 * 1000)).length,
          failedTasks: Number(summaryResult[0]?.failedTasks ?? 0),
          avgProcessingMs: Math.round(Number(summaryResult[0]?.avgProcessingMs ?? 0)),
        },
      };
    }),
});
