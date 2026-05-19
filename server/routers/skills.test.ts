/**
 * Smoke test for Phase 4E-bis-2 · skills sub-router extraction.
 * Verifies the 55 procedures originally at server/routers.ts L250-1217.
 * Final large-domain extraction (audit P0-1) — single flat file.
 */
import { describe, it, expect } from "vitest";
import { skillsRouter } from "./skills";

describe("skillsRouter (Phase 4E-bis-2 extraction)", () => {
  it("exposes all 55 procedures from the pre-split source", () => {
    const procs = Object.keys((skillsRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        // CRUD (8)
        "list",
        "listByType",
        "getById",
        "create",
        "update",
        "delete",
        "matchToContent",
        "applyRules",
        // Seeding & init (3)
        "seedBuiltIn",
        "initializeBuiltIn",
        "runTests",
        // Sessions & history (2)
        "getLearningSessions",
        "getApplicationHistory",
        // Learning agents (5)
        "learnFromPdf",
        "aiLearn",
        "aiBatchLearn",
        "applyLearnedKeywords",
        "createSuggestedSkill",
        // Stats & dependencies (3)
        "getStats",
        "getDependencies",
        "getLearningRecommendations",
        // Scheduling (6)
        "getSchedules",
        "createSchedule",
        "updateSchedule",
        "deleteSchedule",
        "triggerScheduledLearning",
        "triggerManualLearning",
        // Learning history (2)
        "getLearningHistory",
        "updateLearningHistoryStatus",
        // Analytics dashboard (6)
        "getDashboardStats",
        "getLearningTrends",
        "getAdoptionRates",
        "getSourceDistribution",
        "getTopTours",
        "getPrioritizedTours",
        // Review queue (4)
        "getReviewQueue",
        "approveSkill",
        "rejectSkill",
        "addToReviewQueue",
        // Popularity (2)
        "recordTourView",
        "updatePopularityScores",
        // Performance tracking (7)
        "recordSkillTrigger",
        "recordFeedback",
        "recordConversion",
        "getPerformanceDashboard",
        "getSkillPerformanceSummary",
        "getSkillPerformanceTrend",
        "getUsageLogs",
        // Auto-approval rules (7)
        "getAutoApprovalRules",
        "createAutoApprovalRule",
        "updateAutoApprovalRule",
        "deleteAutoApprovalRule",
        "initializeDefaultRules",
        "getRuleStatistics",
        "applyAutoApprovalRules",
      ].sort(),
    );
  });

  it("has exactly 55 procedures", () => {
    const procs = Object.keys((skillsRouter as any)._def.procedures);
    expect(procs.length).toBe(55);
  });
});
