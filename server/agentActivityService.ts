/**
 * Agent Activity Service
 * 記錄每個 Agent 的工作狀態、任務開始/完成/失敗事件
 * 用於 AI 辦公室看板顯示即時狀態和工作日誌
 */

import * as db from './db';
import { EventEmitter } from 'events';

// Global event emitter for real-time office SSE updates
export const agentOfficeEmitter = new EventEmitter();
agentOfficeEmitter.setMaxListeners(200);

export interface AgentOfficeEvent {
  type: 'agent_started' | 'agent_completed' | 'agent_failed';
  agentName: string;
  agentKey?: string | null;
  taskType?: string | null;
  taskTitle?: string | null;
  activityId?: number | null;
  timestamp: number;
}

export interface ActivityLogInput {
  agentName: string;
  agentKey?: string;
  taskType?: string;
  taskId?: string;
  taskTitle?: string;
  userId?: number;
}

export interface ActivityUpdateInput {
  status: 'completed' | 'failed';
  resultSummary?: string;
  errorMessage?: string;
  processingTimeMs?: number;
}

/**
 * 記錄 Agent 開始執行任務
 */
export async function logAgentStart(input: ActivityLogInput): Promise<number | null> {
  try {
    const drizzleDb = await db.getDb();
    if (!drizzleDb) return null;

    const { agentActivityLogs } = await import('../drizzle/schema');
    const result = await drizzleDb.insert(agentActivityLogs).values({
      agentName: input.agentName,
      agentKey: input.agentKey ?? null,
      taskType: input.taskType ?? null,
      taskId: input.taskId ?? null,
      taskTitle: input.taskTitle ?? null,
      status: 'started',
      userId: input.userId ?? null,
      startedAt: new Date(),
    });

    // Return the inserted ID
    // Drizzle MySQL insert returns [ResultSetHeader, FieldPacket[]]
    // ResultSetHeader has insertId as number
    let insertId: number | undefined;
    try {
      const header = Array.isArray(result) ? result[0] : result;
      insertId = (header as any)?.insertId;
      if (typeof insertId !== 'number' || insertId <= 0) {
        insertId = undefined;
      }
    } catch {
      insertId = undefined;
    }

    // Broadcast to SSE clients
    const event: AgentOfficeEvent = {
      type: 'agent_started',
      agentName: input.agentName,
      agentKey: input.agentKey ?? null,
      taskType: input.taskType ?? null,
      taskTitle: input.taskTitle ?? null,
      activityId: insertId ?? null,
      timestamp: Date.now(),
    };
    agentOfficeEmitter.emit('office_event', event);

    return insertId ?? null;
  } catch (err) {
    console.error('[AgentActivity] Failed to log start:', err);
    return null;
  }
}

/**
 * 更新 Agent 任務完成或失敗狀態
 */
export async function logAgentComplete(
  activityId: number,
  update: ActivityUpdateInput
): Promise<void> {
  try {
    const drizzleDb = await db.getDb();
    if (!drizzleDb) return;

    const { agentActivityLogs } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');

    await drizzleDb
      .update(agentActivityLogs)
      .set({
        status: update.status,
        resultSummary: update.resultSummary ?? null,
        errorMessage: update.errorMessage ?? null,
        processingTimeMs: update.processingTimeMs ?? null,
        completedAt: new Date(),
      })
      .where(eq(agentActivityLogs.id, activityId));

    // Fetch agentName for the broadcast
    let agentNameForEvent = '';
    try {
      const rows = await drizzleDb
        .select({ agentName: agentActivityLogs.agentName })
        .from(agentActivityLogs)
        .where(eq(agentActivityLogs.id, activityId))
        .limit(1);
      agentNameForEvent = rows[0]?.agentName ?? '';
    } catch { /* ignore */ }

    // Broadcast to SSE clients
    const event: AgentOfficeEvent = {
      type: update.status === 'completed' ? 'agent_completed' : 'agent_failed',
      agentName: agentNameForEvent,
      activityId,
      timestamp: Date.now(),
    };
    agentOfficeEmitter.emit('office_event', event);
  } catch (err) {
    console.error('[AgentActivity] Failed to log complete:', err);
  }
}

/**
 * 清理殭屍任務：將超過 timeout 分鐘仍為 'started' 的任務標記為 'failed'
 * 防止 Agent 辦公室永遠顯示「執行中」
 */
export async function cleanupZombieTasks(timeoutMinutes = 30): Promise<number> {
  try {
    const drizzleDb = await db.getDb();
    if (!drizzleDb) return 0;

    const { agentActivityLogs } = await import('../drizzle/schema');
    const { eq, and, lt, sql } = await import('drizzle-orm');

    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    // Find zombie tasks first to broadcast events
    const zombies = await drizzleDb
      .select({ id: agentActivityLogs.id, agentName: agentActivityLogs.agentName })
      .from(agentActivityLogs)
      .where(
        and(
          eq(agentActivityLogs.status, 'started'),
          lt(agentActivityLogs.startedAt, cutoff)
        )
      );

    if (zombies.length === 0) return 0;

    // Mark them as failed (not completed) - they timed out
    await drizzleDb
      .update(agentActivityLogs)
      .set({
        status: 'failed',
        completedAt: sql`NOW()`,
        errorMessage: `任務逾時（超過 ${timeoutMinutes} 分鐘未完成）`,
      })
      .where(
        and(
          eq(agentActivityLogs.status, 'started'),
          lt(agentActivityLogs.startedAt, cutoff)
        )
      );

    // Broadcast failed events for each zombie
    for (const zombie of zombies) {
      agentOfficeEmitter.emit('office_event', {
        type: 'agent_failed',
        agentName: zombie.agentName,
        activityId: zombie.id,
        timestamp: Date.now(),
      } as AgentOfficeEvent);
    }

    console.log(`[AgentActivity] Cleaned up ${zombies.length} zombie task(s)`);
    return zombies.length;
  } catch (err) {
    console.error('[AgentActivity] Failed to cleanup zombies:', err);
    return 0;
  }
}

/**
 * 便利函數：包裝 async 任務，自動記錄開始/完成/失敗
 */
export async function withActivityLog<T>(
  input: ActivityLogInput,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  const activityId = await logAgentStart(input);

  try {
    const result = await fn();
    const processingTimeMs = Date.now() - startTime;

    if (activityId) {
      await logAgentComplete(activityId, {
        status: 'completed',
        processingTimeMs,
        resultSummary: `任務完成，耗時 ${(processingTimeMs / 1000).toFixed(1)} 秒`,
      });
    }

    return result;
  } catch (err) {
    const processingTimeMs = Date.now() - startTime;

    if (activityId) {
      await logAgentComplete(activityId, {
        status: 'failed',
        processingTimeMs,
        errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      });
    }

    throw err;
  }
}
