/**
 * Skills domain router — agent skill CRUD, learning agents, schedules,
 * review queue, performance tracking, and auto-approval rules.
 *
 * Extracted from server/routers.ts (Phase 4E-bis-2 · sub-PR 5c of 6) on
 * 2026-05-19 as the final large-domain extraction (audit P0-1). Source
 * range (verbatim from origin): L250-1217.
 *
 * Procedures (55):
 *   CRUD (8):
 *     - list / listByType / getById / create / update / delete
 *     - matchToContent / applyRules
 *   Seeding & init (3):
 *     - seedBuiltIn / initializeBuiltIn / runTests
 *   Sessions & history (2):
 *     - getLearningSessions / getApplicationHistory
 *   Learning agents (5):
 *     - learnFromPdf / aiLearn / aiBatchLearn /
 *       applyLearnedKeywords / createSuggestedSkill
 *   Stats & dependencies (3):
 *     - getStats / getDependencies / getLearningRecommendations
 *   Scheduling (6):
 *     - getSchedules / createSchedule / updateSchedule / deleteSchedule
 *     - triggerScheduledLearning / triggerManualLearning
 *   Learning history (2):
 *     - getLearningHistory / updateLearningHistoryStatus
 *   Analytics dashboard (6):
 *     - getDashboardStats / getLearningTrends / getAdoptionRates /
 *       getSourceDistribution / getTopTours / getPrioritizedTours
 *   Review queue (4):
 *     - getReviewQueue / approveSkill / rejectSkill / addToReviewQueue
 *   Popularity (2):
 *     - recordTourView / updatePopularityScores
 *   Performance tracking (7):
 *     - recordSkillTrigger / recordFeedback / recordConversion /
 *       getPerformanceDashboard / getSkillPerformanceSummary /
 *       getSkillPerformanceTrend / getUsageLogs
 *   Auto-approval rules (7):
 *     - getAutoApprovalRules / createAutoApprovalRule /
 *       updateAutoApprovalRule / deleteAutoApprovalRule /
 *       initializeDefaultRules / getRuleStatistics /
 *       applyAutoApprovalRules
 *
 * v2 backlog: this file is ~970 LOC and could be sub-split into
 * crud / learning / scheduling / review / performance / auto-approval
 * if maintenance pain warrants.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import * as skillDb from "../skillDb";
import { learnFromPdfContent, initializeBuiltInSkills } from "../agents/learningAgent";
import { SkillLearnerAgent } from "../agents/skillLearnerAgent";

export const skillsRouter = router({
    // Get all skills
    list: adminProcedure.query(async () => {
      return await skillDb.getAllSkills(true);
    }),

    // Get skills by type
    listByType: adminProcedure
      .input(z.object({ skillType: z.string() }))
      .query(async ({ input }) => {
        return await skillDb.getSkillsByType(input.skillType);
      }),

    // Get single skill
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const skill = await skillDb.getSkillById(input.id);
        if (!skill) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }
        return skill;
      }),

    // Create new skill (with Superpowers-style fields)
    create: adminProcedure
      .input(z.object({
        skillType: z.enum(["feature_classification", "tag_rule", "itinerary_structure", "highlight_detection", "transportation_type", "meal_classification", "accommodation_type"]),
        skillCategory: z.enum(["technique", "pattern", "reference"]).optional().default("technique"),
        skillName: z.string(),
        skillNameEn: z.string().optional(),
        keywords: z.array(z.string()),
        rules: z.unknown(),
        outputLabels: z.array(z.string()).optional(),
        outputFormat: z.string().optional(),
        description: z.string().optional(),
        source: z.string().optional(),
        sourceUrl: z.string().optional(),
        // Superpowers-style documentation fields
        whenToUse: z.string().optional(),
        corePattern: z.string().optional(),
        quickReference: z.string().optional(),
        commonMistakes: z.string().optional(),
        realWorldImpact: z.string().optional(),
        // Dependencies and testing
        dependsOn: z.array(z.number()).optional(),
        testCases: z.array(z.object({
          id: z.string(),
          input: z.string(),
          expectedOutput: z.string(),
          description: z.string().optional(),
        })).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const skillId = await skillDb.createSkill({
          skillType: input.skillType,
          skillCategory: input.skillCategory,
          skillName: input.skillName,
          skillNameEn: input.skillNameEn,
          keywords: JSON.stringify(input.keywords),
          rules: JSON.stringify(input.rules),
          outputLabels: input.outputLabels ? JSON.stringify(input.outputLabels) : undefined,
          outputFormat: input.outputFormat,
          description: input.description,
          source: input.source,
          sourceUrl: input.sourceUrl,
          whenToUse: input.whenToUse,
          corePattern: input.corePattern,
          quickReference: input.quickReference,
          commonMistakes: input.commonMistakes,
          realWorldImpact: input.realWorldImpact,
          dependsOn: input.dependsOn ? JSON.stringify(input.dependsOn) : undefined,
          testCases: input.testCases ? JSON.stringify(input.testCases) : undefined,
          createdBy: ctx.user.id,
          isActive: true,
          isBuiltIn: false,
        });
        return { id: skillId };
      }),

    // Update skill (with Superpowers-style fields)
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        skillCategory: z.enum(["technique", "pattern", "reference"]).optional(),
        skillName: z.string().optional(),
        skillNameEn: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        rules: z.unknown().optional(),
        outputLabels: z.array(z.string()).optional(),
        outputFormat: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
        // Superpowers-style documentation fields
        whenToUse: z.string().optional(),
        corePattern: z.string().optional(),
        quickReference: z.string().optional(),
        commonMistakes: z.string().optional(),
        realWorldImpact: z.string().optional(),
        // Dependencies and testing
        dependsOn: z.array(z.number()).optional(),
        testCases: z.array(z.object({
          id: z.string(),
          input: z.string(),
          expectedOutput: z.string(),
          description: z.string().optional(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, keywords, rules, outputLabels, dependsOn, testCases, ...rest } = input;
        const updates: any = { ...rest };
        if (keywords) updates.keywords = JSON.stringify(keywords);
        if (rules) updates.rules = JSON.stringify(rules);
        if (outputLabels) updates.outputLabels = JSON.stringify(outputLabels);
        if (dependsOn) updates.dependsOn = JSON.stringify(dependsOn);
        if (testCases) updates.testCases = JSON.stringify(testCases);
        
        await skillDb.updateSkill(id, updates);
        return { success: true };
      }),

    // Delete skill
    delete: adminProcedure
      .input(z.object({ id: z.number(), hardDelete: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        await skillDb.deleteSkill(input.id, input.hardDelete);
        return { success: true };
      }),

    // Match skills to content
    matchToContent: adminProcedure
      .input(z.object({
        content: z.string(),
        skillType: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const matches = await skillDb.matchSkillsToContent(input.content, input.skillType);
        return matches.map(m => ({
          skill: m.skill,
          score: m.score,
          matchedKeywords: m.matchedKeywords,
        }));
      }),

    // Apply skill rules to content
    applyRules: adminProcedure
      .input(z.object({
        skillId: z.number(),
        content: z.string(),
        metadata: z.unknown().optional(),
      }))
      .mutation(async ({ input }) => {
        const skill = await skillDb.getSkillById(input.skillId);
        if (!skill) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }
        const labels = skillDb.applySkillRules(skill, input.content, input.metadata);
        return { labels };
      }),

    // Seed built-in skills
    seedBuiltIn: adminProcedure.mutation(async () => {
      await skillDb.seedBuiltInSkills();
      return { success: true };
    }),

    // Get learning sessions
    getLearningSessions: adminProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ input }) => {
        return await skillDb.getRecentLearningSessions(input.limit);
      }),

    // Get skill application history
    getApplicationHistory: adminProcedure
      .input(z.object({
        skillId: z.number().optional(),
        tourId: z.number().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return await skillDb.getSkillApplicationHistory(input.skillId, input.tourId, input.limit);
      }),

    // Learn from PDF content
    learnFromPdf: adminProcedure
      .input(z.object({
        pdfContent: z.string(),
        sourceName: z.string(),
        sourceUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await learnFromPdfContent(
          input.pdfContent,
          input.sourceName,
          input.sourceUrl,
          ctx.user.id
        );
        return result;
      }),

    // Initialize built-in skills
    initializeBuiltIn: adminProcedure.mutation(async () => {
      await initializeBuiltInSkills();
      return { success: true };
    }),

    // Run skill test cases (TDD-style)
    runTests: adminProcedure
      .input(z.object({ skillId: z.number() }))
      .mutation(async ({ input }) => {
        const skill = await skillDb.getSkillById(input.skillId);
        if (!skill) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }
        
        const testCases = skill.testCases ? JSON.parse(skill.testCases as string) : [];
        if (testCases.length === 0) {
          return { results: [], passRate: 0, message: "No test cases defined" };
        }
        
        const results = [];
        let passed = 0;
        
        for (const testCase of testCases) {
          const startTime = Date.now();
          try {
            const labels = skillDb.applySkillRules(skill, testCase.input, {});
            const actualOutput = JSON.stringify(labels);
            const isPassed = actualOutput === testCase.expectedOutput || 
                            labels.some((l: string) => testCase.expectedOutput.includes(l));
            
            if (isPassed) passed++;
            
            results.push({
              testCaseId: testCase.id,
              passed: isPassed,
              expectedOutput: testCase.expectedOutput,
              actualOutput,
              executionTimeMs: Date.now() - startTime,
            });
          } catch (error: any) {
            results.push({
              testCaseId: testCase.id,
              passed: false,
              expectedOutput: testCase.expectedOutput,
              actualOutput: null,
              errorMessage: error.message,
              executionTimeMs: Date.now() - startTime,
            });
          }
        }
        
        const passRate = passed / testCases.length;
        
        // Update skill with test results
        await skillDb.updateSkill(input.skillId, {
          lastTestedAt: new Date(),
          testPassRate: passRate.toFixed(2),
        });
        
        return { results, passRate, totalTests: testCases.length, passedTests: passed };
      }),

    // Get skill statistics
    getStats: adminProcedure.query(async () => {
      const skills = await skillDb.getAllSkills(true);
      const totalSkills = skills.length;
      const activeSkills = skills.filter(s => s.isActive).length;
      const builtInSkills = skills.filter(s => s.isBuiltIn).length;
      const customSkills = totalSkills - builtInSkills;
      
      const byCategory = {
        technique: skills.filter(s => s.skillCategory === 'technique').length,
        pattern: skills.filter(s => s.skillCategory === 'pattern').length,
        reference: skills.filter(s => s.skillCategory === 'reference').length,
      };
      
      const byType = skills.reduce((acc, s) => {
        acc[s.skillType] = (acc[s.skillType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const totalUsage = skills.reduce((sum, s) => sum + (s.usageCount || 0), 0);
      const totalSuccess = skills.reduce((sum, s) => sum + (s.successCount || 0), 0);
      const overallSuccessRate = totalUsage > 0 ? (totalSuccess / totalUsage * 100).toFixed(1) : '0';
      
      return {
        totalSkills,
        activeSkills,
        builtInSkills,
        customSkills,
        byCategory,
        byType,
        totalUsage,
        overallSuccessRate,
      };
    }),

    // Get skill dependencies
    getDependencies: adminProcedure
      .input(z.object({ skillId: z.number() }))
      .query(async ({ input }) => {
        const skill = await skillDb.getSkillById(input.skillId);
        if (!skill) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }
        
        const dependsOn = skill.dependsOn ? JSON.parse(skill.dependsOn as string) : [];
        const dependencies = [];
        
        for (const depId of dependsOn) {
          const depSkill = await skillDb.getSkillById(depId);
          if (depSkill) {
            dependencies.push({
              id: depSkill.id,
              skillName: depSkill.skillName,
              skillType: depSkill.skillType,
              skillCategory: depSkill.skillCategory,
            });
          }
        }
        
        return dependencies;
      }),

    // AI 自動學習 - 從內容中學習新關鍵字和技能
    aiLearn: adminProcedure
      .input(z.object({
        content: z.string(),
        contentType: z.enum(['tour', 'pdf', 'text']).optional(),
        metadata: z.object({
          title: z.string().optional(),
          source: z.string().optional(),
          region: z.string().optional(),
          country: z.string().optional(),
        }).optional(),
      }))
      .mutation(async ({ input }) => {
        const learner = new SkillLearnerAgent();
        const result = await learner.learnFromContent({
          title: input.metadata?.title || '未命名行程',
          description: input.content,
          country: input.metadata?.country,
        });
        return result;
      }),

    // AI 批量學習 - 從多個內容中學習
    aiBatchLearn: adminProcedure
      .input(z.object({
        contents: z.array(z.object({
          content: z.string(),
          metadata: z.object({
            title: z.string().optional(),
            source: z.string().optional(),
          }).optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const learner = new SkillLearnerAgent();
        const contents = input.contents.map(c => ({
          ...c.metadata,
          description: c.content,
        }));
        const result = await learner.batchLearn(contents);
        return result;
      }),

    // 應用學習到的關鍵字到技能
    applyLearnedKeywords: adminProcedure
      .input(z.object({
        skillId: z.number(),
        newKeywords: z.array(z.string()),
        approvedBy: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const learner = new SkillLearnerAgent();
        const success = await learner.applyKeywordSuggestion(
          input.skillId,
          input.newKeywords,
          input.approvedBy || ctx.user.name || 'admin'
        );
        return { success };
      }),

    // 創建 AI 建議的新技能
    createSuggestedSkill: adminProcedure
      .input(z.object({
        skillType: z.string(),
        skillName: z.string(),
        category: z.enum(['technique', 'pattern', 'reference']),
        description: z.string(),
        keywords: z.array(z.string()),
        whenToUse: z.string().optional(),
        corePattern: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const learner = new SkillLearnerAgent();
        // 轉換為 createNewSkill 所需的格式
        const suggestion = {
          skillName: input.skillName,
          skillType: input.skillType,
          category: input.category,
          description: input.description,
          keywords: input.keywords,
          whenToUse: input.whenToUse || '',
          corePattern: input.corePattern || '',
          confidence: 1.0,
          reason: '管理員手動創建'
        };
        const skillId = await learner.createNewSkill(suggestion);
        return { success: skillId !== null, skillId };
      }),

    // 獲取學習建議（待審核的關鍵字和新技能建議）
    getLearningRecommendations: adminProcedure.query(async () => {
      // 這裡可以從資料庫獲取待審核的學習建議
      // 目前返回空陣列，實際應用時需要建立學習建議資料表
      return {
        pendingKeywords: [],
        suggestedSkills: [],
        recentLearnings: [],
      };
    }),

    // === 排程學習 API ===
    
    // 獲取所有排程
    getSchedules: adminProcedure.query(async () => {
      const { scheduledLearningService } = await import('../services/scheduledLearningService');
      return await scheduledLearningService.getSchedules();
    }),

    // 創建排程
    createSchedule: adminProcedure
      .input(z.object({
        name: z.string(),
        frequency: z.enum(['daily', 'weekly', 'monthly']),
        dayOfWeek: z.number().min(0).max(6).optional(),
        dayOfMonth: z.number().min(1).max(31).optional(),
        hour: z.number().min(0).max(23).optional(),
        minute: z.number().min(0).max(59).optional(),
        maxToursPerRun: z.number().min(1).max(50).optional(),
        minTourAge: z.number().min(0).optional(),
        autoApplyHighConfidence: z.boolean().optional(),
        autoApplyThreshold: z.number().min(0).max(1).optional(),
        notifyOnComplete: z.boolean().optional(),
        notifyOnNewSuggestions: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { scheduledLearningService } = await import('../services/scheduledLearningService');
        const scheduleId = await scheduledLearningService.createSchedule({
          ...input,
          createdBy: ctx.user.id,
        });
        return { success: scheduleId !== null, scheduleId };
      }),

    // 更新排程
    updateSchedule: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        isEnabled: z.boolean().optional(),
        frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
        dayOfWeek: z.number().min(0).max(6).optional(),
        dayOfMonth: z.number().min(1).max(31).optional(),
        hour: z.number().min(0).max(23).optional(),
        minute: z.number().min(0).max(59).optional(),
        maxToursPerRun: z.number().min(1).max(50).optional(),
        minTourAge: z.number().min(0).optional(),
        autoApplyHighConfidence: z.boolean().optional(),
        autoApplyThreshold: z.number().min(0).max(1).optional(),
        notifyOnComplete: z.boolean().optional(),
        notifyOnNewSuggestions: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { scheduledLearningService } = await import('../services/scheduledLearningService');
        const { id, ...updates } = input;
        const success = await scheduledLearningService.updateSchedule(id, updates);
        return { success };
      }),

    // 刪除排程
    deleteSchedule: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { scheduledLearningService } = await import('../services/scheduledLearningService');
        const success = await scheduledLearningService.deleteSchedule(input.id);
        return { success };
      }),

    // 手動觸發排程學習
    triggerScheduledLearning: adminProcedure
      .input(z.object({ scheduleId: z.number() }))
      .mutation(async ({ input }) => {
        const { scheduledLearningService } = await import('../services/scheduledLearningService');
        const result = await scheduledLearningService.executeScheduledLearning(input.scheduleId);
        return { success: result !== null, result };
      }),

    // 手動學習（從指定行程）
    triggerManualLearning: adminProcedure
      .input(z.object({ tourIds: z.array(z.number()) }))
      .mutation(async ({ ctx, input }) => {
        const { scheduledLearningService } = await import('../services/scheduledLearningService');
        const result = await scheduledLearningService.triggerManualLearning(input.tourIds, ctx.user.id);
        return { success: result !== null, result };
      }),

    // 獲取學習歷史
    getLearningHistory: adminProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        sourceType: z.enum(['tour', 'batch', 'scheduled', 'manual']).optional(),
      }).optional())
      .query(async ({ input }) => {
        const { scheduledLearningService } = await import('../services/scheduledLearningService');
        return await scheduledLearningService.getLearningHistory(input || {});
      }),

    // 更新學習歷史的建議狀態
    updateLearningHistoryStatus: adminProcedure
      .input(z.object({
        historyId: z.number(),
        accepted: z.number(),
        rejected: z.number(),
        skillsCreated: z.number(),
      }))
      .mutation(async ({ input }) => {
        const { scheduledLearningService } = await import('../services/scheduledLearningService');
        const success = await scheduledLearningService.updateSuggestionStatus(
          input.historyId,
          input.accepted,
          input.rejected,
          input.skillsCreated
        );
        return { success };
      }),

    // === 學習分析儀表板 API ===
    
    // 獲取儀表板統計數據
    getDashboardStats: adminProcedure.query(async () => {
      const { getDashboardStats } = await import('../services/learningAnalyticsService');
      return await getDashboardStats();
    }),

    // 獲取學習趨勢數據
    getLearningTrends: adminProcedure
      .input(z.object({ days: z.number().min(7).max(90).optional() }).optional())
      .query(async ({ input }) => {
        const { getLearningTrends } = await import('../services/learningAnalyticsService');
        return await getLearningTrends(input?.days || 30);
      }),

    // 獲取技能採納率數據
    getAdoptionRates: adminProcedure.query(async () => {
      const { getSkillAdoptionRates } = await import('../services/learningAnalyticsService');
      return await getSkillAdoptionRates();
    }),

    // 獲取學習來源分佈
    getSourceDistribution: adminProcedure.query(async () => {
      const { getSourceDistribution } = await import('../services/learningAnalyticsService');
      return await getSourceDistribution();
    }),

    // 獲取熱門行程排名
    getTopTours: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
      .query(async ({ input }) => {
        const { getTopToursByPopularity } = await import('../services/learningAnalyticsService');
        return await getTopToursByPopularity(input?.limit || 10);
      }),

    // 獲取優先學習的行程
    getPrioritizedTours: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(20).optional() }).optional())
      .query(async ({ input }) => {
        const { getPrioritizedToursForLearning } = await import('../services/learningAnalyticsService');
        return await getPrioritizedToursForLearning(input?.limit || 5);
      }),

    // === 審核佇列 API ===
    
    // 獲取待審核的技能
    getReviewQueue: adminProcedure
      .input(z.object({
        status: z.enum(['pending', 'approved', 'rejected', 'merged']).optional(),
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      }).optional())
      .query(async ({ input }) => {
        const { getDb } = await import('../db');
        const { skillReviewQueue } = await import('../../drizzle/schema');
        const { eq, desc } = await import('drizzle-orm');
        
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        
        let query = db.select().from(skillReviewQueue);
        
        if (input?.status) {
          query = query.where(eq(skillReviewQueue.status, input.status)) as typeof query;
        }
        
        const items = await query
          .orderBy(desc(skillReviewQueue.createdAt))
          .limit(input?.limit || 20)
          .offset(input?.offset || 0);
        
        // Get total count
        const { count } = await import('drizzle-orm');
        let countQuery = db.select({ count: count() }).from(skillReviewQueue);
        if (input?.status) {
          countQuery = countQuery.where(eq(skillReviewQueue.status, input.status)) as typeof countQuery;
        }
        const [totalResult] = await countQuery;
        
        return { items, total: Number(totalResult?.count) || 0 };
      }),

    // 批准技能
    approveSkill: adminProcedure
      .input(z.object({
        reviewId: z.number(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import('../db');
        const { skillReviewQueue, agentSkills } = await import('../../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
        
        // Get the review item
        const [review] = await db.select().from(skillReviewQueue).where(eq(skillReviewQueue.id, input.reviewId));
        if (!review) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review item not found' });
        if (review.status !== 'pending') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Item already reviewed' });
        
        // Create the actual skill
        // Map review skillType to agentSkills skillType
        const skillTypeMapping: Record<string, 'feature_classification' | 'tag_rule' | 'itinerary_structure' | 'highlight_detection' | 'transportation_type' | 'meal_classification' | 'accommodation_type'> = {
          'technique': 'feature_classification',
          'pattern': 'tag_rule',
          'reference': 'itinerary_structure',
        };
        const mappedSkillType = skillTypeMapping[review.skillType] || 'feature_classification';
        
        const [insertResult] = await db.insert(agentSkills).values({
          skillType: mappedSkillType,
          skillCategory: review.skillType as 'technique' | 'pattern' | 'reference',
          skillName: review.skillName,
          keywords: review.keywords,
          rules: review.rules,
          outputLabels: review.outputLabels,
          description: review.description,
          confidence: review.confidence,
          isActive: true,
          isBuiltIn: false,
          createdBy: ctx.user.id,
        });
        
        const skillId = insertResult.insertId;
        
        // Update review status
        await db.update(skillReviewQueue)
          .set({
            status: 'approved',
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNotes: input.notes,
            createdSkillId: Number(skillId),
          })
          .where(eq(skillReviewQueue.id, input.reviewId));
        
        return { success: true, skillId: Number(skillId) };
      }),

    // 拒絕技能
    rejectSkill: adminProcedure
      .input(z.object({
        reviewId: z.number(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import('../db');
        const { skillReviewQueue } = await import('../../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
        
        // Get the review item
        const [review] = await db.select().from(skillReviewQueue).where(eq(skillReviewQueue.id, input.reviewId));
        if (!review) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review item not found' });
        if (review.status !== 'pending') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Item already reviewed' });
        
        // Update review status
        await db.update(skillReviewQueue)
          .set({
            status: 'rejected',
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNotes: input.notes,
          })
          .where(eq(skillReviewQueue.id, input.reviewId));
        
        return { success: true };
      }),

    // 新增待審核的技能（從 AI 學習結果）
    addToReviewQueue: adminProcedure
      .input(z.object({
        skillName: z.string(),
        skillType: z.enum(['technique', 'pattern', 'reference']),
        category: z.string(),
        keywords: z.array(z.string()),
        rules: z.unknown(),
        description: z.string().optional(),
        outputLabels: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
        sourceType: z.enum(['ai_learning', 'scheduled', 'manual']),
        sourceTourId: z.number().optional(),
        learningHistoryId: z.number().optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('../db');
        const { skillReviewQueue } = await import('../../drizzle/schema');
        
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
        
        const [result] = await db.insert(skillReviewQueue).values({
          skillName: input.skillName,
          skillType: input.skillType,
          category: input.category,
          keywords: JSON.stringify(input.keywords),
          rules: JSON.stringify(input.rules),
          description: input.description,
          outputLabels: input.outputLabels ? JSON.stringify(input.outputLabels) : null,
          confidence: input.confidence?.toFixed(2) || '0.80',
          sourceType: input.sourceType,
          sourceTourId: input.sourceTourId,
          learningHistoryId: input.learningHistoryId,
          priority: input.priority || 'medium',
          status: 'pending',
        });
        
        return { success: true, reviewId: Number(result.insertId) };
      }),

    // 更新行程統計（用於智能優先級）
    recordTourView: adminProcedure
      .input(z.object({ tourId: z.number() }))
      .mutation(async ({ input }) => {
        const { recordTourView } = await import('../services/learningAnalyticsService');
        await recordTourView(input.tourId);
        return { success: true };
      }),

    // 更新熱門度分數
    updatePopularityScores: adminProcedure.mutation(async () => {
      const { updatePopularityScores } = await import('../services/learningAnalyticsService');
      await updatePopularityScores();
      return { success: true };
    }),

    // ========== 技能效能追蹤 API ==========
    
    // 記錄技能觸發事件
    recordSkillTrigger: protectedProcedure
      .input(z.object({
        skillId: z.number(),
        skillName: z.string(),
        skillType: z.string(),
        contextType: z.enum(['chat', 'search', 'itinerary', 'content', 'classification']),
        contextId: z.string().optional(),
        inputText: z.string().optional(),
        matchedKeywords: z.array(z.string()).optional(),
        outputResult: z.string().optional(),
        wasSuccessful: z.boolean().optional(),
        errorMessage: z.string().optional(),
        processingTimeMs: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { recordSkillTrigger } = await import('../services/skillPerformanceService');
        const usageLogId = await recordSkillTrigger({
          ...input,
          userId: ctx.user.id,
          sessionId: ctx.req.headers['x-session-id'] as string,
        });
        return { success: true, usageLogId };
      }),

    // 記錄用戶回饋
    recordFeedback: protectedProcedure
      .input(z.object({
        usageLogId: z.number(),
        feedback: z.enum(['positive', 'negative', 'none']),
        comment: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { recordUserFeedback } = await import('../services/skillPerformanceService');
        await recordUserFeedback(input);
        return { success: true };
      }),

    // 記錄轉換事件
    recordConversion: protectedProcedure
      .input(z.object({
        usageLogId: z.number(),
        conversionType: z.enum(['booking', 'inquiry', 'favorite', 'share', 'none']),
        conversionId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { recordConversion } = await import('../services/skillPerformanceService');
        await recordConversion(input);
        return { success: true };
      }),

    // 獲取效能儀表板數據
    getPerformanceDashboard: adminProcedure
      .input(z.object({ days: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const { getPerformanceDashboard } = await import('../services/skillPerformanceService');
        return await getPerformanceDashboard(input?.days || 30);
      }),

    // 獲取技能效能摘要
    getSkillPerformanceSummary: adminProcedure
      .input(z.object({ days: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const { getSkillPerformanceSummary } = await import('../services/skillPerformanceService');
        return await getSkillPerformanceSummary(input?.days || 30);
      }),

    // 獲取技能效能趨勢
    getSkillPerformanceTrend: adminProcedure
      .input(z.object({
        skillId: z.number(),
        days: z.number().optional(),
      }))
      .query(async ({ input }) => {
        const { getSkillPerformanceTrend } = await import('../services/skillPerformanceService');
        return await getSkillPerformanceTrend(input.skillId, input.days || 30);
      }),

    // 獲取使用記錄
    getUsageLogs: adminProcedure
      .input(z.object({
        skillId: z.number().optional(),
        contextType: z.enum(['chat', 'search', 'itinerary', 'content', 'classification']).optional(),
        feedback: z.enum(['positive', 'negative', 'none']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        const { getUsageLogs } = await import('../services/skillPerformanceService');
        return await getUsageLogs({
          ...input,
          startDate: input?.startDate ? new Date(input.startDate) : undefined,
          endDate: input?.endDate ? new Date(input.endDate) : undefined,
        });
      }),

    // ========== 自動審核規則 API ==========
    
    // 獲取所有規則
    getAutoApprovalRules: adminProcedure.query(async () => {
      const { getAllRules } = await import('../services/autoApprovalService');
      return await getAllRules();
    }),

    // 創建規則
    createAutoApprovalRule: adminProcedure
      .input(z.object({
        ruleName: z.string(),
        description: z.string().optional(),
        ruleType: z.enum(['confidence_threshold', 'source_type', 'keyword_count', 'skill_category', 'combined']),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(['>', '>=', '<', '<=', '==', '!=', 'in', 'not_in']),
          value: z.union([z.string(), z.number(), z.array(z.string())]),
        })),
        action: z.enum(['auto_approve', 'auto_reject', 'flag_priority', 'notify_admin']),
        priority: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createRule } = await import('../services/autoApprovalService');
        const ruleId = await createRule({
          ...input,
          createdBy: ctx.user.id,
        });
        return { success: true, ruleId };
      }),

    // 更新規則
    updateAutoApprovalRule: adminProcedure
      .input(z.object({
        ruleId: z.number(),
        ruleName: z.string().optional(),
        description: z.string().optional(),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(['>', '>=', '<', '<=', '==', '!=', 'in', 'not_in']),
          value: z.union([z.string(), z.number(), z.array(z.string())]),
        })).optional(),
        action: z.enum(['auto_approve', 'auto_reject', 'flag_priority', 'notify_admin']).optional(),
        priority: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { updateRule } = await import('../services/autoApprovalService');
        const { ruleId, ...updateData } = input;
        await updateRule(ruleId, updateData);
        return { success: true };
      }),

    // 刪除規則
    deleteAutoApprovalRule: adminProcedure
      .input(z.object({ ruleId: z.number() }))
      .mutation(async ({ input }) => {
        const { deleteRule } = await import('../services/autoApprovalService');
        await deleteRule(input.ruleId);
        return { success: true };
      }),

    // 初始化預設規則
    initializeDefaultRules: adminProcedure.mutation(async ({ ctx }) => {
      const { initializeDefaultRules } = await import('../services/autoApprovalService');
      await initializeDefaultRules(ctx.user.id);
      return { success: true };
    }),

    // 獲取規則統計
    getRuleStatistics: adminProcedure.query(async () => {
      const { getRuleStatistics } = await import('../services/autoApprovalService');
      return await getRuleStatistics();
    }),

    // 應用自動審核規則到待審核項目
    applyAutoApprovalRules: adminProcedure
      .input(z.object({ reviewQueueId: z.number() }))
      .mutation(async ({ input }) => {
        const { applyAutoApprovalRules } = await import('../services/autoApprovalService');
        return await applyAutoApprovalRules(input.reviewQueueId);
      }),
});
