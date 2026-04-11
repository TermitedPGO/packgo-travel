import { Queue, Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis"; // BUG-001: dedicated BullMQ connection (commandTimeout:0)

/**
 * Job data structure for tour generation
 */
export interface TourGenerationJobData {
  url: string;
  userId: number;
  requestId: string; // Unique identifier for tracking
  forceRegenerate?: boolean; // If true, ignore cache and regenerate
  isPdf?: boolean; // If true, treat URL as PDF file URL
  supplementUrl?: string; // 供應商官網 URL（配合 PDF 使用，用於抽取日期/人數/價格）
}

/**
 * 漸進式結果類型
 */
export interface PartialResults {
  title?: string;
  poeticTitle?: string;
  destination?: string;
  colorTheme?: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  heroImage?: string;
  highlights?: string[];
}

/**
 * Job progress structure
 */
/**
 * 技能學習通知
 */
export interface SkillLearned {
  name: string;
  category: string;
  timestamp: number;
}

/**
 * Job progress structure
 */
export interface TourGenerationProgress {
  step: string;
  progress: number; // 0-100
  message: string;
  timestamp: number;
  partialResults?: PartialResults;
  skillsLearned?: SkillLearned[];
}

/**
 * Job result structure
 */
export interface TourGenerationResult {
  success: boolean;
  tourId?: number;
  error?: string;
  details?: {
    title: string;
    destination: string;
    price: number;
    duration: number;
  };
}

/**
 * Queue for tour generation tasks
 */
export const tourGenerationQueue = new Queue<TourGenerationJobData, TourGenerationResult>("tour-generation", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 3, // Retry up to 3 times on failure
    backoff: {
      type: "exponential",
      delay: 5000, // Start with 5 second delay
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
      count: 1000, // Keep last 1000 failed jobs
    },
  },
});

/**
 * Add a tour generation job to the queue
 */
export async function addTourGenerationJob(data: TourGenerationJobData) {
  const job = await tourGenerationQueue.add("generate-tour", data, {
    jobId: data.requestId, // Use requestId as jobId for easy tracking
  });
  
  console.log(`✅ Tour generation job added: ${job.id}`);
  return job;
}

/**
 * Get job status and progress
 */
export async function getTourGenerationJobStatus(jobId: string) {
  const job = await tourGenerationQueue.getJob(jobId);
  
  if (!job) {
    return { status: "not_found" };
  }
  
  const state = await job.getState();
  const progress = job.progress as TourGenerationProgress | number;
  
  return {
    status: state,
    progress: typeof progress === "number" ? progress : progress?.progress || 0,
    data: job.data,
    result: job.returnvalue,
    failedReason: job.failedReason,
    progressDetails: typeof progress === "object" ? progress : null,
  };
}

/**
 * Get all jobs for a user
 */
export async function getUserTourGenerationJobs(userId: number) {
  const jobs = await tourGenerationQueue.getJobs(["waiting", "active", "completed", "failed"]);
  
  return jobs
    .filter((job) => job.data.userId === userId)
    .map((job) => ({
      id: job.id,
      status: job.getState(),
      data: job.data,
      progress: job.progress,
      result: job.returnvalue,
      createdAt: job.timestamp,
    }));
}

console.log("✅ Tour generation queue initialized");


/**
 * Job data structure for skill learning
 */
export interface SkillLearningJobData {
  scheduleId: number;
  scheduleName: string;
}

/**
 * Job result structure for skill learning
 */
export interface SkillLearningResult {
  success: boolean;
  historyId?: number;
  toursProcessed?: number;
  keywordSuggestions?: number;
  newSkillSuggestions?: number;
  error?: string;
}

/**
 * Queue for skill learning tasks
 */
export const skillLearningQueue = new Queue<SkillLearningJobData, SkillLearningResult>("skill-learning", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 2, // Retry up to 2 times on failure
    backoff: {
      type: "exponential",
      delay: 10000, // Start with 10 second delay
    },
    removeOnComplete: {
      age: 86400, // Keep completed jobs for 24 hours
      count: 50, // Keep last 50 completed jobs
    },
    removeOnFail: {
      age: 604800, // Keep failed jobs for 7 days
      count: 100, // Keep last 100 failed jobs
    },
  },
});

console.log("✅ Skill learning queue initialized");

// ============================================================
// Tour Translation Queue (BUG-006)
// Replaces fire-and-forget translateTour() calls with reliable
// queued processing that supports retries and failure tracking.
// ============================================================

/**
 * Job data structure for tour translation
 */
export interface TourTranslationJobData {
  tourId: number;
  targetLanguages: string[];
  sourceLanguage: string;
  userId: number;
}

/**
 * Job result structure for tour translation
 */
export interface TourTranslationResult {
  success: boolean;
  translatedLanguages: string[];
  errors: string[];
}

/**
 * Queue for tour translation tasks
 * - 3 retries with exponential backoff (5s → 25s → 125s)
 * - Failed jobs kept for 7 days for debugging
 */
export const tourTranslationQueue = new Queue<TourTranslationJobData, TourTranslationResult>("tour-translation", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 86400, // 24 hours
      count: 500,
    },
    removeOnFail: {
      age: 604800, // 7 days
      count: 1000,
    },
  },
});

/**
 * Add a tour translation job to the queue (BUG-006)
 * Use this instead of calling translateTour() directly.
 */
export async function addTourTranslationJob(data: TourTranslationJobData) {
  const jobId = `translate-${data.tourId}-${Date.now()}`;
  const job = await tourTranslationQueue.add("translate-tour", data, { jobId });
  console.log(`✅ Tour translation job queued: ${job.id} (tour #${data.tourId} → ${data.targetLanguages.join(", ")})`);
  return job;
}

console.log("✅ Tour translation queue initialized");

// ══════════════════════════════════════════════════════════════
// 競品監控 Queue (Competitor Monitor)
// ══════════════════════════════════════════════════════════════

export interface CompetitorMonitorJobData {
  competitorTourId: number;
  tourUrl: string;
  competitor: string;
  triggeredBy: "schedule" | "manual";
}

export interface CompetitorMonitorResult {
  success: boolean;
  departuresFound: number;
  alertsGenerated: number;
  error?: string;
}

/**
 * Queue for competitor monitoring scrape jobs
 * - 2 retries with exponential backoff (10s → 50s)
 * - Failed jobs kept for 7 days
 */
export const competitorMonitorQueue = new Queue<CompetitorMonitorJobData, CompetitorMonitorResult>(
  "competitor-monitor",
  {
    connection: redisBullMQ,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 10000,
      },
      removeOnComplete: {
        age: 86400, // 24 hours
        count: 200,
      },
      removeOnFail: {
        age: 604800, // 7 days
        count: 500,
      },
    },
  }
);

/**
 * Add a single competitor scrape job to the queue
 */
export async function addCompetitorMonitorJob(data: CompetitorMonitorJobData) {
  const jobId = `competitor-${data.competitorTourId}-${Date.now()}`;
  const job = await competitorMonitorQueue.add("scrape-competitor", data, { jobId });
  console.log(`✅ Competitor monitor job queued: ${job.id} (tour #${data.competitorTourId})`);
  return job;
}

console.log("✅ Competitor monitor queue initialized");

// ── Marketing Queue ────────────────────────────────────────

export interface MarketingJobData {
  type: "send_newsletter" | "generate_poster" | "generate_copy";
  campaignId?: number;
  tourId?: number;
  payload: Record<string, unknown>;
}

export interface MarketingJobResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Queue for marketing automation jobs
 * - 3 retries with exponential backoff
 * - Completed jobs kept for 24 hours
 */
export const marketingQueue = new Queue<MarketingJobData, MarketingJobResult>(
  "marketing",
  {
    connection: redisBullMQ,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        age: 86400, // 24 hours
        count: 500,
      },
      removeOnFail: {
        age: 604800, // 7 days
        count: 200,
      },
    },
  }
);

/**
 * Add a marketing job to the queue
 */
export async function addMarketingJob(data: MarketingJobData) {
  const jobId = `marketing-${data.type}-${Date.now()}`;
  const job = await marketingQueue.add(data.type, data, { jobId });
  console.log(`✅ Marketing job queued: ${job.id} (type: ${data.type})`);
  return job;
}

console.log("✅ Marketing queue initialized");

// ── Tour Monitor Queue ──────────────────────────────────────────────────────
// Runs daily at 03:00 to check all active tours for supplier changes

export interface TourMonitorJobData {
  triggeredBy: "schedule" | "manual";
  triggeredByUserId?: number;
}

export interface TourMonitorJobResult {
  runId: string;
  totalTours: number;
  checkedTours: number;
  changedTours: number;
  failedTours: number;
  changesCount: number;
}

/**
 * Queue for daily supplier tour monitoring
 * - Runs at 03:00 daily (Taiwan time, UTC+8 = 19:00 UTC)
 * - Manual trigger also supported via tRPC
 */
export const tourMonitorQueue = new Queue<TourMonitorJobData, TourMonitorJobResult>(
  "tour-monitor",
  {
    connection: redisBullMQ,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 60000, // 1 minute
      },
      removeOnComplete: {
        age: 604800, // 7 days
        count: 100,
      },
      removeOnFail: {
        age: 2592000, // 30 days
        count: 50,
      },
    },
  }
);

/**
 * Schedule the daily tour monitor job at 03:00 Taiwan time (19:00 UTC)
 */
export async function scheduleDailyTourMonitor() {
  // Remove existing repeatable jobs first to avoid duplicates
  const repeatableJobs = await tourMonitorQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "daily-tour-monitor") {
      await tourMonitorQueue.removeRepeatableByKey(job.key);
    }
  }

  // Schedule: every day at 19:00 UTC = 03:00 Taiwan time (UTC+8)
  await tourMonitorQueue.add(
    "daily-tour-monitor",
    { triggeredBy: "schedule" },
    {
      repeat: {
        pattern: "0 19 * * *", // 19:00 UTC = 03:00 Taiwan
      },
      jobId: "daily-tour-monitor-scheduled",
    }
  );
  console.log("✅ Daily tour monitor scheduled at 03:00 Taiwan time (19:00 UTC)");
}

/**
 * Manually trigger a tour monitor run
 */
export async function triggerManualTourMonitor(userId?: number) {
  const jobId = `tour-monitor-manual-${Date.now()}`;
  const job = await tourMonitorQueue.add(
    "manual-tour-monitor",
    { triggeredBy: "manual", triggeredByUserId: userId },
    { jobId }
  );
  console.log(`✅ Manual tour monitor triggered: ${job.id}`);
  return job;
}

console.log("✅ Tour monitor queue initialized");
