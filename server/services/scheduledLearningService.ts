/**
 * ScheduledLearningService - AI 技能自動學習排程服務
 * 
 * 功能：
 * 1. 定期從新行程中自動學習
 * 2. 記錄學習歷史
 * 3. 通知管理員學習結果
 * 4. 支援手動觸發學習
 */

import { getDb } from "../db";
import { skillLearnerAgent, LearningResult } from "../agents/skillLearnerAgent";
import { tours, skillLearningHistory, skillLearningSchedule, tourStatistics } from "../../drizzle/schema";
import { eq, and, gt, desc, sql, isNull, or } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { skillLearningQueue } from "../queue";
import { reportFunnelError } from "../_core/errorFunnel";

// 排程任務名稱
const SCHEDULED_LEARNING_JOB = "scheduled-skill-learning";

export interface ScheduledLearningConfig {
  scheduleId: number;
  maxTours: number;
  minTourAge: number;
  autoApplyHighConfidence: boolean;
  autoApplyThreshold: number;
  notifyOnComplete: boolean;
  notifyOnNewSuggestions: boolean;
}

export interface LearningHistoryRecord {
  id: number;
  sourceType: 'tour' | 'batch' | 'scheduled' | 'manual';
  sourceTourIds: number[];
  keywordSuggestions: LearningResult['keywordSuggestions'];
  newSkillSuggestions: LearningResult['newSkillSuggestions'];
  identifiedTags: LearningResult['identifiedTags'];
  totalKeywordsFound: number;
  newKeywordsFound: number;
  suggestionsAccepted: number;
  suggestionsRejected: number;
  skillsCreated: number;
  processingTimeMs: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  errorMessage?: string;
  triggeredBy: 'user' | 'schedule' | 'system';
  triggeredByUserId?: number;
  createdAt: Date;
  completedAt?: Date;
}

class ScheduledLearningService {
  /**
   * 初始化排程任務
   */
  async initializeScheduler(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) {
        console.log("[ScheduledLearning] Database not available, skipping scheduler init");
        return;
      }

      // 獲取所有啟用的排程
      const schedules = await db
        .select()
        .from(skillLearningSchedule)
        .where(eq(skillLearningSchedule.isEnabled, true));

      if (schedules.length === 0) {
        console.log("[ScheduledLearning] No active schedules found");
        return;
      }

      // 為每個排程設置任務
      for (const schedule of schedules) {
        await this.setupScheduleJob(schedule);
      }

      console.log(`[ScheduledLearning] Initialized ${schedules.length} schedule(s)`);
    } catch (error) {
      console.error("[ScheduledLearning] Failed to initialize scheduler:", error);
      reportFunnelError({
        source: "fail-open:scheduledLearningService:initializeScheduler",
        err: error,
      }).catch(() => {});
    }
  }

  /**
   * 設置排程任務
   */
  private async setupScheduleJob(schedule: any): Promise<void> {
    try {
      const queue = skillLearningQueue;
      if (!queue) {
        console.log("[ScheduledLearning] Queue not available");
        return;
      }

      // 計算 cron 表達式
      const cronExpression = this.buildCronExpression(schedule);
      
      // 移除舊的排程任務
      const existingJobs = await queue.getRepeatableJobs();
      for (const job of existingJobs) {
        if (job.name === `${SCHEDULED_LEARNING_JOB}-${schedule.id}`) {
          await queue.removeRepeatableByKey(job.key);
        }
      }

      // 添加新的排程任務
      await queue.add(
        `${SCHEDULED_LEARNING_JOB}-${schedule.id}`,
        {
          scheduleId: schedule.id,
          scheduleName: schedule.name
        },
        {
          repeat: {
            pattern: cronExpression
          },
          jobId: `scheduled-learning-${schedule.id}`
        }
      );

      // 更新下次執行時間
      const nextRun = this.calculateNextRun(schedule);
      const db = await getDb();
      if (db) {
        await db
          .update(skillLearningSchedule)
          .set({ nextRunAt: nextRun })
          .where(eq(skillLearningSchedule.id, schedule.id));
      }

      console.log(`[ScheduledLearning] Set up job for schedule ${schedule.id}: ${cronExpression}`);
    } catch (error) {
      console.error(`[ScheduledLearning] Failed to setup job for schedule ${schedule.id}:`, error);
      reportFunnelError({
        source: "fail-open:scheduledLearningService:setupScheduleJob",
        err: error,
        context: { scheduleId: schedule.id },
      }).catch(() => {});
    }
  }

  /**
   * 構建 cron 表達式
   */
  private buildCronExpression(schedule: any): string {
    const minute = schedule.minute || 0;
    const hour = schedule.hour || 3;

    switch (schedule.frequency) {
      case 'daily':
        return `${minute} ${hour} * * *`;
      case 'weekly':
        const dayOfWeek = schedule.dayOfWeek ?? 0; // 預設週日
        return `${minute} ${hour} * * ${dayOfWeek}`;
      case 'monthly':
        const dayOfMonth = schedule.dayOfMonth || 1;
        return `${minute} ${hour} ${dayOfMonth} * *`;
      default:
        return `${minute} ${hour} * * 0`; // 預設每週日
    }
  }

  /**
   * 計算下次執行時間
   */
  private calculateNextRun(schedule: any): Date {
    const now = new Date();
    const next = new Date(now);
    
    next.setHours(schedule.hour || 3);
    next.setMinutes(schedule.minute || 0);
    next.setSeconds(0);
    next.setMilliseconds(0);

    switch (schedule.frequency) {
      case 'daily':
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        break;
      case 'weekly':
        const targetDay = schedule.dayOfWeek ?? 0;
        const currentDay = next.getDay();
        let daysUntilTarget = targetDay - currentDay;
        if (daysUntilTarget < 0 || (daysUntilTarget === 0 && next <= now)) {
          daysUntilTarget += 7;
        }
        next.setDate(next.getDate() + daysUntilTarget);
        break;
      case 'monthly':
        const targetDate = schedule.dayOfMonth || 1;
        next.setDate(targetDate);
        if (next <= now) {
          next.setMonth(next.getMonth() + 1);
        }
        break;
    }

    return next;
  }

  /**
   * 執行排程學習任務
   */
  async executeScheduledLearning(scheduleId: number): Promise<LearningHistoryRecord | null> {
    const db = await getDb();
    if (!db) return null;

    try {
      // 獲取排程設定
      const schedules = await db
        .select()
        .from(skillLearningSchedule)
        .where(eq(skillLearningSchedule.id, scheduleId))
        .limit(1);

      if (!schedules.length) {
        console.error(`[ScheduledLearning] Schedule ${scheduleId} not found`);
        return null;
      }

      const schedule = schedules[0];

      // 創建學習歷史記錄
      const historyResult = await db
        .insert(skillLearningHistory)
        .values({
          sourceType: 'scheduled',
          status: 'processing',
          triggeredBy: 'schedule',
          createdAt: new Date()
        });

      // @ts-ignore
      const historyId = historyResult[0]?.insertId;

      // 獲取需要學習的行程 - 使用智能優先級排序
      const lastRunAt = schedule.lastRunAt || new Date(0);
      const minAge = new Date();
      minAge.setDate(minAge.getDate() - (schedule.minTourAge || 0));

      // 先獲取尚未學習的行程，根據熱門度排序
      // 熱門度 = viewCount * 1 + bookingCount * 10 + favoriteCount * 5
      // 使用 LEFT JOIN tourStatistics 來獲取統計數據
      const toursToLearn = await db
        .select({
          id: tours.id,
          title: tours.title,
          description: tours.description,
          highlights: tours.highlights,
          dailyItinerary: tours.dailyItinerary,
          destinationCountry: tours.destinationCountry,
          destinationCity: tours.destinationCity,
          price: tours.price,
          duration: tours.duration,
          status: tours.status,
          createdAt: tours.createdAt,
          viewCount: tourStatistics.viewCount,
          bookingCount: tourStatistics.bookingCount,
          favoriteCount: tourStatistics.favoriteCount,
        })
        .from(tours)
        .leftJoin(tourStatistics, eq(tours.id, tourStatistics.tourId))
        .where(
          and(
            gt(tours.createdAt, lastRunAt),
            eq(tours.status, 'active')
          )
        )
        .orderBy(
          // 根據熱門度排序：瀏覽量 + 預訂量*10 + 收藏量*5
          sql`(COALESCE(${tourStatistics.viewCount}, 0) + COALESCE(${tourStatistics.bookingCount}, 0) * 10 + COALESCE(${tourStatistics.favoriteCount}, 0) * 5) DESC`
        )
        .limit(schedule.maxToursPerRun || 10);

      if (toursToLearn.length === 0) {
        // 沒有新行程需要學習
        await db
          .update(skillLearningHistory)
          .set({
            status: 'completed',
            completedAt: new Date(),
            sourceTourIds: JSON.stringify([]),
            totalKeywordsFound: 0,
            newKeywordsFound: 0
          })
          .where(eq(skillLearningHistory.id, historyId));

        await this.updateScheduleStatus(scheduleId, 'success', historyId);
        
        return {
          id: historyId,
          sourceType: 'scheduled',
          sourceTourIds: [],
          keywordSuggestions: [],
          newSkillSuggestions: [],
          identifiedTags: [],
          totalKeywordsFound: 0,
          newKeywordsFound: 0,
          suggestionsAccepted: 0,
          suggestionsRejected: 0,
          skillsCreated: 0,
          processingTimeMs: 0,
          status: 'completed',
          triggeredBy: 'schedule',
          createdAt: new Date(),
          completedAt: new Date()
        };
      }

      // 執行學習
      const startTime = Date.now();
      const allKeywordSuggestions: LearningResult['keywordSuggestions'] = [];
      const allNewSkillSuggestions: LearningResult['newSkillSuggestions'] = [];
      const allIdentifiedTags: LearningResult['identifiedTags'] = [];
      let totalKeywordsFound = 0;
      let newKeywordsFound = 0;
      let skillsCreated = 0;

      for (const tour of toursToLearn) {
        try {
          const result = await skillLearnerAgent.learnFromContent({
            title: tour.title,
            description: tour.description,
            highlights: tour.highlights ? JSON.parse(tour.highlights) : [],
            dailyItinerary: tour.dailyItinerary ? JSON.parse(tour.dailyItinerary) : [],
            country: tour.destinationCountry || undefined,
            city: tour.destinationCity || undefined,
            price: tour.price,
            duration: tour.duration
          });

          allKeywordSuggestions.push(...result.keywordSuggestions);
          allNewSkillSuggestions.push(...result.newSkillSuggestions);
          allIdentifiedTags.push(...result.identifiedTags);
          totalKeywordsFound += result.stats.totalKeywordsFound;
          newKeywordsFound += result.stats.newKeywordsFound;

          // 自動應用高信心度建議
          if (schedule.autoApplyHighConfidence) {
            const threshold = parseFloat(schedule.autoApplyThreshold || '0.90');
            for (const suggestion of result.keywordSuggestions) {
              if (suggestion.confidence >= threshold) {
                await skillLearnerAgent.applyKeywordSuggestion(
                  suggestion.skillId,
                  suggestion.newKeywords,
                  'auto-scheduled'
                );
              }
            }
          }
        } catch (error) {
          console.error(`[ScheduledLearning] Failed to learn from tour ${tour.id}:`, error);
        }
      }

      const processingTime = Date.now() - startTime;

      // 更新學習歷史
      await db
        .update(skillLearningHistory)
        .set({
          status: 'completed',
          completedAt: new Date(),
          sourceTourIds: JSON.stringify(toursToLearn.map(t => t.id)),
          keywordSuggestions: JSON.stringify(allKeywordSuggestions),
          newSkillSuggestions: JSON.stringify(allNewSkillSuggestions),
          identifiedTags: JSON.stringify(allIdentifiedTags),
          totalKeywordsFound,
          newKeywordsFound,
          skillsCreated,
          processingTimeMs: processingTime
        })
        .where(eq(skillLearningHistory.id, historyId));

      // 更新排程狀態
      await this.updateScheduleStatus(scheduleId, 'success', historyId);

      // 發送通知
      if (schedule.notifyOnComplete || (schedule.notifyOnNewSuggestions && allKeywordSuggestions.length > 0)) {
        await this.sendLearningNotification(schedule, {
          toursProcessed: toursToLearn.length,
          keywordSuggestions: allKeywordSuggestions.length,
          newSkillSuggestions: allNewSkillSuggestions.length,
          processingTimeMs: processingTime
        });
      }

      return {
        id: historyId,
        sourceType: 'scheduled',
        sourceTourIds: toursToLearn.map(t => t.id),
        keywordSuggestions: allKeywordSuggestions,
        newSkillSuggestions: allNewSkillSuggestions,
        identifiedTags: allIdentifiedTags,
        totalKeywordsFound,
        newKeywordsFound,
        suggestionsAccepted: 0,
        suggestionsRejected: 0,
        skillsCreated,
        processingTimeMs: processingTime,
        status: 'completed',
        triggeredBy: 'schedule',
        createdAt: new Date(),
        completedAt: new Date()
      };
    } catch (error) {
      console.error(`[ScheduledLearning] Failed to execute scheduled learning:`, error);
      
      // 更新排程狀態為失敗
      await this.updateScheduleStatus(scheduleId, 'failed', null);
      
      return null;
    }
  }

  /**
   * 更新排程狀態
   */
  private async updateScheduleStatus(
    scheduleId: number, 
    status: 'success' | 'failed' | 'partial',
    historyId: number | null
  ): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const schedule = await db
      .select()
      .from(skillLearningSchedule)
      .where(eq(skillLearningSchedule.id, scheduleId))
      .limit(1);

    if (!schedule.length) return;

    const nextRun = this.calculateNextRun(schedule[0]);

    await db
      .update(skillLearningSchedule)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: status,
        lastRunHistoryId: historyId,
        nextRunAt: nextRun
      })
      .where(eq(skillLearningSchedule.id, scheduleId));
  }

  /**
   * 發送學習通知
   */
  private async sendLearningNotification(
    schedule: any,
    results: {
      toursProcessed: number;
      keywordSuggestions: number;
      newSkillSuggestions: number;
      processingTimeMs: number;
    }
  ): Promise<void> {
    try {
      const title = `🎓 AI 技能學習完成 - ${schedule.name}`;
      const content = `
排程學習任務已完成！

📊 學習結果：
- 處理行程數：${results.toursProcessed}
- 新關鍵字建議：${results.keywordSuggestions}
- 新技能建議：${results.newSkillSuggestions}
- 處理時間：${(results.processingTimeMs / 1000).toFixed(1)} 秒

${results.keywordSuggestions > 0 || results.newSkillSuggestions > 0 
  ? '💡 有新的建議等待審核，請前往管理後台查看。' 
  : '✅ 目前沒有新的建議需要處理。'}
      `.trim();

      await notifyOwner({ title, content });
    } catch (error) {
      console.error("[ScheduledLearning] Failed to send notification:", error);
    }
  }

  /**
   * 手動觸發學習
   */
  async triggerManualLearning(
    tourIds: number[],
    userId: number
  ): Promise<LearningHistoryRecord | null> {
    const db = await getDb();
    if (!db) return null;

    try {
      // 創建學習歷史記錄
      const historyResult = await db
        .insert(skillLearningHistory)
        .values({
          sourceType: tourIds.length === 1 ? 'tour' : 'batch',
          status: 'processing',
          triggeredBy: 'user',
          triggeredByUserId: userId,
          createdAt: new Date()
        });

      // @ts-ignore
      const historyId = historyResult[0]?.insertId;

      // 獲取行程資料
      const toursToLearn = await db
        .select()
        .from(tours)
        .where(sql`${tours.id} IN (${tourIds.join(',')})`);

      if (toursToLearn.length === 0) {
        await db
          .update(skillLearningHistory)
          .set({
            status: 'failed',
            errorMessage: '找不到指定的行程',
            completedAt: new Date()
          })
          .where(eq(skillLearningHistory.id, historyId));

        return null;
      }

      // 執行學習
      const startTime = Date.now();
      const allKeywordSuggestions: LearningResult['keywordSuggestions'] = [];
      const allNewSkillSuggestions: LearningResult['newSkillSuggestions'] = [];
      const allIdentifiedTags: LearningResult['identifiedTags'] = [];
      let totalKeywordsFound = 0;
      let newKeywordsFound = 0;

      for (const tour of toursToLearn) {
        try {
          const result = await skillLearnerAgent.learnFromContent({
            title: tour.title,
            description: tour.description,
            highlights: tour.highlights ? JSON.parse(tour.highlights) : [],
            dailyItinerary: tour.dailyItinerary ? JSON.parse(tour.dailyItinerary) : [],
            country: tour.destinationCountry || undefined,
            city: tour.destinationCity || undefined,
            price: tour.price,
            duration: tour.duration
          });

          allKeywordSuggestions.push(...result.keywordSuggestions);
          allNewSkillSuggestions.push(...result.newSkillSuggestions);
          allIdentifiedTags.push(...result.identifiedTags);
          totalKeywordsFound += result.stats.totalKeywordsFound;
          newKeywordsFound += result.stats.newKeywordsFound;
        } catch (error) {
          console.error(`[ScheduledLearning] Failed to learn from tour ${tour.id}:`, error);
        }
      }

      const processingTime = Date.now() - startTime;

      // 更新學習歷史
      await db
        .update(skillLearningHistory)
        .set({
          status: 'completed',
          completedAt: new Date(),
          sourceTourIds: JSON.stringify(tourIds),
          keywordSuggestions: JSON.stringify(allKeywordSuggestions),
          newSkillSuggestions: JSON.stringify(allNewSkillSuggestions),
          identifiedTags: JSON.stringify(allIdentifiedTags),
          totalKeywordsFound,
          newKeywordsFound,
          processingTimeMs: processingTime
        })
        .where(eq(skillLearningHistory.id, historyId));

      return {
        id: historyId,
        sourceType: tourIds.length === 1 ? 'tour' : 'batch',
        sourceTourIds: tourIds,
        keywordSuggestions: allKeywordSuggestions,
        newSkillSuggestions: allNewSkillSuggestions,
        identifiedTags: allIdentifiedTags,
        totalKeywordsFound,
        newKeywordsFound,
        suggestionsAccepted: 0,
        suggestionsRejected: 0,
        skillsCreated: 0,
        processingTimeMs: processingTime,
        status: 'completed',
        triggeredBy: 'user',
        triggeredByUserId: userId,
        createdAt: new Date(),
        completedAt: new Date()
      };
    } catch (error) {
      console.error("[ScheduledLearning] Failed to trigger manual learning:", error);
      return null;
    }
  }

  /**
   * 獲取學習歷史列表
   */
  async getLearningHistory(options: {
    limit?: number;
    offset?: number;
    sourceType?: 'tour' | 'batch' | 'scheduled' | 'manual';
  } = {}): Promise<LearningHistoryRecord[]> {
    const db = await getDb();
    if (!db) return [];

    try {
      let query = db
        .select()
        .from(skillLearningHistory)
        .orderBy(desc(skillLearningHistory.createdAt))
        .limit(options.limit || 20)
        .offset(options.offset || 0);

      const records = await query;

      return records.map(record => ({
        id: record.id,
        sourceType: record.sourceType as any,
        sourceTourIds: record.sourceTourIds ? JSON.parse(record.sourceTourIds) : [],
        keywordSuggestions: record.keywordSuggestions ? JSON.parse(record.keywordSuggestions) : [],
        newSkillSuggestions: record.newSkillSuggestions ? JSON.parse(record.newSkillSuggestions) : [],
        identifiedTags: record.identifiedTags ? JSON.parse(record.identifiedTags) : [],
        totalKeywordsFound: record.totalKeywordsFound,
        newKeywordsFound: record.newKeywordsFound,
        suggestionsAccepted: record.suggestionsAccepted,
        suggestionsRejected: record.suggestionsRejected,
        skillsCreated: record.skillsCreated,
        processingTimeMs: record.processingTimeMs || 0,
        status: record.status as any,
        errorMessage: record.errorMessage || undefined,
        triggeredBy: record.triggeredBy as any,
        triggeredByUserId: record.triggeredByUserId || undefined,
        createdAt: record.createdAt,
        completedAt: record.completedAt || undefined
      }));
    } catch (error) {
      console.error("[ScheduledLearning] Failed to get learning history:", error);
      return [];
    }
  }

  /**
   * 獲取排程列表
   */
  async getSchedules(): Promise<any[]> {
    const db = await getDb();
    if (!db) return [];

    try {
      return await db
        .select()
        .from(skillLearningSchedule)
        .orderBy(desc(skillLearningSchedule.createdAt));
    } catch (error) {
      console.error("[ScheduledLearning] Failed to get schedules:", error);
      return [];
    }
  }

  /**
   * 創建排程
   */
  async createSchedule(config: {
    name: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek?: number;
    dayOfMonth?: number;
    hour?: number;
    minute?: number;
    maxToursPerRun?: number;
    minTourAge?: number;
    autoApplyHighConfidence?: boolean;
    autoApplyThreshold?: number;
    notifyOnComplete?: boolean;
    notifyOnNewSuggestions?: boolean;
    createdBy: number;
  }): Promise<number | null> {
    const db = await getDb();
    if (!db) return null;

    try {
      const result = await db
        .insert(skillLearningSchedule)
        .values({
          name: config.name,
          isEnabled: true,
          frequency: config.frequency,
          dayOfWeek: config.dayOfWeek,
          dayOfMonth: config.dayOfMonth,
          hour: config.hour ?? 3,
          minute: config.minute ?? 0,
          maxToursPerRun: config.maxToursPerRun ?? 10,
          minTourAge: config.minTourAge ?? 0,
          autoApplyHighConfidence: config.autoApplyHighConfidence ?? false,
          autoApplyThreshold: config.autoApplyThreshold?.toString() ?? '0.90',
          notifyOnComplete: config.notifyOnComplete ?? true,
          notifyOnNewSuggestions: config.notifyOnNewSuggestions ?? true,
          createdBy: config.createdBy,
          createdAt: new Date(),
          updatedAt: new Date()
        });

      // @ts-ignore
      const scheduleId = result[0]?.insertId;

      // 設置排程任務
      if (scheduleId) {
        const schedule = await db
          .select()
          .from(skillLearningSchedule)
          .where(eq(skillLearningSchedule.id, scheduleId))
          .limit(1);

        if (schedule.length) {
          await this.setupScheduleJob(schedule[0]);
        }
      }

      return scheduleId;
    } catch (error) {
      console.error("[ScheduledLearning] Failed to create schedule:", error);
      return null;
    }
  }

  /**
   * 更新排程
   */
  async updateSchedule(
    scheduleId: number,
    updates: Partial<{
      name: string;
      isEnabled: boolean;
      frequency: 'daily' | 'weekly' | 'monthly';
      dayOfWeek: number;
      dayOfMonth: number;
      hour: number;
      minute: number;
      maxToursPerRun: number;
      minTourAge: number;
      autoApplyHighConfidence: boolean;
      autoApplyThreshold: number;
      notifyOnComplete: boolean;
      notifyOnNewSuggestions: boolean;
    }>
  ): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;

    try {
      const updateData: any = { ...updates, updatedAt: new Date() };
      if (updates.autoApplyThreshold !== undefined) {
        updateData.autoApplyThreshold = updates.autoApplyThreshold.toString();
      }

      await db
        .update(skillLearningSchedule)
        .set(updateData)
        .where(eq(skillLearningSchedule.id, scheduleId));

      // 重新設置排程任務
      const schedule = await db
        .select()
        .from(skillLearningSchedule)
        .where(eq(skillLearningSchedule.id, scheduleId))
        .limit(1);

      if (schedule.length) {
        await this.setupScheduleJob(schedule[0]);
      }

      return true;
    } catch (error) {
      console.error("[ScheduledLearning] Failed to update schedule:", error);
      return false;
    }
  }

  /**
   * 刪除排程
   */
  async deleteSchedule(scheduleId: number): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;

    try {
      // 移除排程任務
      const queue = skillLearningQueue;
      if (queue) {
        const existingJobs = await queue.getRepeatableJobs();
        for (const job of existingJobs) {
          if (job.name === `${SCHEDULED_LEARNING_JOB}-${scheduleId}`) {
            await queue.removeRepeatableByKey(job.key);
          }
        }
      }

      // 刪除資料庫記錄
      await db
        .delete(skillLearningSchedule)
        .where(eq(skillLearningSchedule.id, scheduleId));

      return true;
    } catch (error) {
      console.error("[ScheduledLearning] Failed to delete schedule:", error);
      return false;
    }
  }

  /**
   * 更新學習歷史的建議狀態
   */
  async updateSuggestionStatus(
    historyId: number,
    accepted: number,
    rejected: number,
    skillsCreated: number
  ): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;

    try {
      await db
        .update(skillLearningHistory)
        .set({
          suggestionsAccepted: accepted,
          suggestionsRejected: rejected,
          skillsCreated
        })
        .where(eq(skillLearningHistory.id, historyId));

      return true;
    } catch (error) {
      console.error("[ScheduledLearning] Failed to update suggestion status:", error);
      return false;
    }
  }
}

// 導出單例
export const scheduledLearningService = new ScheduledLearningService();
