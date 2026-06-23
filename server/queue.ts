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
  /**
   * 2026-05-16: when a supplier-import bulk operation queues this job
   * to re-generate a draft into a PACK&GO-style tour, this is the id
   * of the original draft row. The worker flips that draft to
   * status='inactive' on success so the catalog doesn't accumulate
   * "ghost" drafts (production today has 8 stranded drafts from earlier
   * runs of the same pipeline before this flag existed).
   */
  sourceDraftTourId?: number;
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
 * 技能學習通知
 */
export interface SkillLearned {
  name: string;
  category: string;
  timestamp: number;
}

/**
 * Individual phase progress (for detailed frontend display)
 */
export interface PhaseProgress {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  currentTask?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
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
  // Enhanced: backend phases data for accurate frontend display
  phases?: PhaseProgress[];
  overallProgress?: number; // explicit overall progress 0-100
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
    // v80.24: was attempts=3 with 5s exponential backoff. The audit found
    // we now have THREE compounding retry layers:
    //   - BullMQ (3 attempts here)
    //   - RetryManager inside masterAgent (3 attempts per LLM call)
    //   - Anthropic SDK (maxRetries: 2)
    // Net: 18 retries per LLM call when something flaps. A single JSON
    // SyntaxError used to cost 3 × 120s = 6 minutes of LLM compute.
    //
    // We now do ONE BullMQ attempt and let masterAgent's per-step RetryManager
    // make the fine-grained retry decisions. Anthropic SDK is also forced to 0
    // retries (see _core/llm.ts) so we have a single source of retry truth.
    attempts: 1,
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

  // Round 66: bumped cadence from daily (03:00 TW) to every 3 hours so that
  // supplier status transitions (報名→客滿→取消) propagate to our UI within
  // at most 3 hours instead of 24. Liontravel's public API doesn't expose
  // real seat counts, but the `Status` field DOES reflect real inventory —
  // so polling more often is the main lever we have for accuracy.
  await tourMonitorQueue.add(
    "daily-tour-monitor",
    { triggeredBy: "schedule" },
    {
      repeat: {
        pattern: "0 */3 * * *", // every 3 hours at minute 0
      },
      jobId: "daily-tour-monitor-scheduled",
    }
  );
  console.log("✅ Tour monitor scheduled every 3 hours (was: daily 03:00 TW)");
}

// ============================================================================
// v77: Trip Reminder Queue — sends scheduled emails to customers as their
// departure date approaches (30, 14, 7, 3, and 1 days out).
//
// Why: the member-system audit identified "no trip notifications" as the
// single biggest customer-experience gap. Customers forget the date, fail to
// pay balance on time, miss flights, and don't no-show recover. A simple
// reminder pipeline fixes ~80% of avoidable post-booking friction.
//
// Mechanics: a daily 09:00 Taipei (01:00 UTC) cron scans all confirmed
// bookings and queues per-booking emails when the departure is exactly
// {30, 14, 7, 3, 1} days away. Idempotency: a Redis SET tracks
// `reminder:sent:{bookingId}:{daysOut}` so we never double-send.
// ============================================================================

export interface TripReminderJobData {
  triggeredBy: "schedule" | "manual";
}

export interface TripReminderJobResult {
  scanned: number;
  emailsQueued: number;
  errors: number;
}

export const tripReminderQueue = new Queue<TripReminderJobData, TripReminderJobResult>(
  "trip-reminder",
  {
    connection: redisBullMQ,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60000 },
      removeOnComplete: { age: 604800, count: 100 }, // 7 days
      removeOnFail: { age: 2592000, count: 50 },     // 30 days
    },
  }
);

/**
 * Schedule the daily trip-reminder scan at 01:00 UTC (09:00 Taipei).
 * Picks up at the start of business day so reminders land in customer
 * inboxes when they're most likely to read them.
 */
export async function scheduleDailyTripReminders() {
  const repeatableJobs = await tripReminderQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "daily-trip-reminder") {
      await tripReminderQueue.removeRepeatableByKey(job.key);
    }
  }
  await tripReminderQueue.add(
    "daily-trip-reminder",
    { triggeredBy: "schedule" },
    {
      repeat: {
        pattern: "0 1 * * *", // daily at 01:00 UTC = 09:00 Taipei = 18:00 PT (prev day)
      },
      jobId: "daily-trip-reminder-scheduled",
    }
  );
  console.log("✅ Trip reminder scan scheduled daily at 09:00 Taipei (01:00 UTC)");
}

/**
 * Manually trigger a trip-reminder scan (admin debugging)
 */
export async function triggerManualTripReminderScan(userId?: number) {
  const jobId = `trip-reminder-manual-${Date.now()}`;
  return await tripReminderQueue.add(
    "manual-trip-reminder",
    { triggeredBy: "manual", triggeredByUserId: userId } as any,
    { jobId }
  );
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

// ============================================================================
// Round 81 Phase 3.5: Self-Retrospective Agent — weekly cron.
//
// Every Monday 01:00 UTC (Sunday 18:00 PT / Monday 09:00 Taipei) the
// retrospective agent reads the past 7 days of outcomes + policies and
// produces a structured digest with optional policy proposals. The
// result lands in the Inbox under "政策提案 · Self-Retrospective".
// ============================================================================

export interface RetrospectiveJobData {
  triggeredBy: "schedule" | "manual";
  windowDays?: number;
}

export interface RetrospectiveJobResult {
  totalOutcomesAnalyzed: number;
  proposalsCount: number;
  messageId: number;
}

export const retrospectiveQueue = new Queue<
  RetrospectiveJobData,
  RetrospectiveJobResult
>("retrospective", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 60000 },
    removeOnComplete: { age: 1209600, count: 50 }, // 14 days
    removeOnFail: { age: 2592000, count: 50 }, // 30 days
  },
});

export async function scheduleWeeklyRetrospective() {
  const repeatableJobs = await retrospectiveQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "weekly-retrospective") {
      await retrospectiveQueue.removeRepeatableByKey(job.key);
    }
  }
  await retrospectiveQueue.add(
    "weekly-retrospective",
    { triggeredBy: "schedule", windowDays: 7 },
    {
      repeat: {
        pattern: "0 1 * * 1", // Monday 01:00 UTC (= Sun 18:00 PT / Mon 09:00 Taipei)
      },
      jobId: "weekly-retrospective-scheduled",
    }
  );
  console.log(
    "✅ Weekly retrospective scheduled: Monday 01:00 UTC (Sunday 18:00 PT)"
  );
}

console.log("✅ Retrospective queue initialized");

// ============================================================================
// Gmail Poll Queue — periodically scan active Gmail integrations, run the
// InquiryAgent pipeline for new threads.
//
// QA audit 2026-05-11 Phase 9 found this was the #1 customer-churn gap:
// InquiryAgent drafts excellent replies, gmailPipeline.ts has the auto-send
// path wired, but nothing triggered the pipeline on a schedule. It only
// fired when Jeff manually clicked "Run now" in admin. A customer asks at
// 10am, Jeff opens admin at 2pm → 4-hour cold reply.
//
// Cadence: every 10 minutes. Jeff can tune via cron pattern; tighter than
// 5 min adds Gmail API quota pressure without proportional customer
// benefit since most inquiries don't need sub-15-min response.
// ============================================================================

export interface GmailPollJobData {
  triggeredBy: "schedule" | "manual";
}

export interface GmailPollJobResult {
  integrationsScanned: number;
  totalProcessed: number;
  totalAutoReplied: number;
  totalEscalated: number;
  errors: number;
}

export const gmailPollQueue = new Queue<GmailPollJobData, GmailPollJobResult>(
  "gmail-poll",
  {
    connection: redisBullMQ,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 30000 },
      removeOnComplete: { age: 604800, count: 100 }, // 7 days
      removeOnFail: { age: 2592000, count: 50 }, // 30 days
    },
  }
);

/**
 * Schedule Gmail polling every 10 minutes. Each tick runs the full
 * pipeline (fetch new threads → classify → optionally auto-reply) for
 * every active gmailIntegration row.
 */
export async function scheduleGmailPoll() {
  const repeatableJobs = await gmailPollQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "gmail-poll-tick") {
      await gmailPollQueue.removeRepeatableByKey(job.key);
    }
  }
  await gmailPollQueue.add(
    "gmail-poll-tick",
    { triggeredBy: "schedule" },
    {
      repeat: {
        pattern: "*/10 * * * *", // every 10 minutes
      },
      jobId: "gmail-poll-scheduled",
    }
  );
  console.log("✅ Gmail poll scheduled: every 10 minutes");
}

console.log("✅ Gmail poll queue initialized");

// ============================================================================
// Customer AI Summary Queue — nightly warm-up of the customer-card AI summary
// (customer-ai-sessions 批3 m3). Recomputes summaries for ACTIVE + STALE
// customers so opening their card is instant; lazy-on-open covers the rest.
// Jeff Q1「兩者都要」. Only stale rows are recomputed → bounded LLM cost.
// ============================================================================

export interface CustomerSummaryJobData {
  triggeredBy: "schedule" | "manual";
}

export interface CustomerSummaryJobResult {
  scanned: number;
  refreshed: number;
  errors: number;
}

export const customerSummaryQueue = new Queue<
  CustomerSummaryJobData,
  CustomerSummaryJobResult
>("customer-summary", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 1, // a missed night just recomputes next run; no retry storms
    removeOnComplete: { age: 604800, count: 30 },
    removeOnFail: { age: 2592000, count: 30 },
  },
});

/** Schedule the daily customer-summary warm-up at 02:00 UTC (off-peak). */
export async function scheduleDailyCustomerSummaries() {
  const repeatableJobs = await customerSummaryQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "customer-summary-tick") {
      await customerSummaryQueue.removeRepeatableByKey(job.key);
    }
  }
  await customerSummaryQueue.add(
    "customer-summary-tick",
    { triggeredBy: "schedule" },
    {
      repeat: { pattern: "0 2 * * *" }, // daily 02:00 UTC
      jobId: "customer-summary-scheduled",
    },
  );
  console.log("✅ Customer AI summary warm-up scheduled: daily 02:00 UTC");
}

console.log("✅ Customer summary queue initialized");

// ============================================================================
// Booking Followup Queue — async deposit PDF generation + confirmation
// email AFTER bookings.create commits.
//
// Earlier we fire-and-forget'd a Puppeteer render off the main thread
// (commit a7481d8), which removed it from the customer's HTTP path but
// left it brittle: a server restart mid-render would drop the email.
// This queue persists the job in Redis so it survives restarts and gets
// 2 automatic retries on transient failure.
// ============================================================================

export interface BookingFollowupJobData {
  bookingId: number;
  // The fields below are denormalized into the job payload so the worker
  // doesn't have to re-query — keeps it survivable even if the DB row
  // changes between enqueue and execution (rare but possible if admin
  // edits the booking immediately).
  contactName: string;
  contactEmail: string;
  tourId: number;
  tourTitle: string;
  departureDateStr: string;
  returnDateStr: string;
  adults: number;
  childWithBed: number;
  childNoBed: number;
  infants: number;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
  isUsd: boolean;
  language?: "zh-TW" | "en";
}

export interface BookingFollowupJobResult {
  bookingId: number;
  depositInvoiceUrl: string | null;
  emailSent: boolean;
}

export const bookingFollowupQueue = new Queue<
  BookingFollowupJobData,
  BookingFollowupJobResult
>("booking-followup", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 200 }, // 1 day
    removeOnFail: { age: 2_592_000, count: 100 },   // 30 days
  },
});

console.log("✅ Booking followup queue initialized");

// ============================================================================
// Plaid Daily Sync Queue — catch-up safety net (Phase 1.5).
//
// Webhooks deliver sub-minute latency under normal conditions, but
// Plaid's documentation explicitly recommends a daily catch-up sync
// against /transactions/sync for any item that hasn't received a
// SYNC_UPDATES_AVAILABLE webhook in the last 24 hours. Reasons:
//   - Webhooks can be missed if our server was down during a burst
//   - HISTORICAL_UPDATE for a brand-new item can take 24h+; the daily
//     run picks up the tail of that backfill
//   - Some institutions only refresh nightly anyway, so polling on the
//     same cadence is sufficient
//
// Cadence: 05:00 UTC daily = 22:00 PT prev day = 13:00 Taipei. After
// US bank overnight settlement, before Jeff starts his morning.
// ============================================================================

export interface PlaidDailySyncJobData {
  triggeredBy: "schedule" | "manual";
}

export interface PlaidDailySyncJobResult {
  totalAccounts: number;
  totalAdded: number;
  totalModified: number;
  totalRemoved: number;
  failedAccounts: number;
}

export const plaidDailySyncQueue = new Queue<
  PlaidDailySyncJobData,
  PlaidDailySyncJobResult
>("plaid-daily-sync", {
  connection: redisBullMQ,
  defaultJobOptions: {
    // Plaid /transactions/sync is rate-limited per item but generous;
    // 2 attempts with 60s backoff is enough for transient 5xx.
    attempts: 2,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: { age: 604_800, count: 60 }, // 7 days
    removeOnFail: { age: 2_592_000, count: 30 },   // 30 days
  },
});

/**
 * Schedule daily Plaid sync at 05:00 UTC (22:00 PT prev day).
 * Idempotent — removes existing repeatable before re-adding so
 * boot won't accumulate dupes across restarts.
 */
export async function schedulePlaidDailySync() {
  const repeatableJobs = await plaidDailySyncQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "plaid-daily-sync") {
      await plaidDailySyncQueue.removeRepeatableByKey(job.key);
    }
  }
  await plaidDailySyncQueue.add(
    "plaid-daily-sync",
    { triggeredBy: "schedule" },
    {
      repeat: {
        pattern: "0 5 * * *", // 05:00 UTC = 22:00 PT prev day
      },
      jobId: "plaid-daily-sync-scheduled",
    }
  );
  console.log(
    "✅ Plaid daily sync scheduled: 05:00 UTC (22:00 PT prev day / 13:00 Taipei)"
  );
}

/**
 * Manually trigger a Plaid sync for all active accounts (admin debug).
 */
export async function triggerManualPlaidSync(userId?: number) {
  const jobId = `plaid-sync-manual-${Date.now()}`;
  return await plaidDailySyncQueue.add(
    "plaid-daily-sync-manual",
    { triggeredBy: "manual", triggeredByUserId: userId } as any,
    { jobId }
  );
}

console.log("✅ Plaid daily sync queue initialized");

// ============================================================================
// Phase 4 — Trust Account Recognition Cron
//
// Once a day at 06:00 UTC (1 hour after the Plaid sync at 05:00) scan
// trustDeferredIncome for rows whose expectedRecognitionDate has arrived
// and mark them recognized. This shifts the income from "deferred liability"
// to actual P&L revenue on the recognition date.
//
// Feature-flagged via PLAID_TRUST_DEFERRAL_ENABLED in the service layer —
// when off the worker fires but does nothing.
// ============================================================================

export interface TrustRecognitionJobData {
  triggeredBy: "schedule" | "manual";
}

export interface TrustRecognitionJobResult {
  runId: string;
  scanned: number;
  recognized: number;
  totalRecognizedAmount: number;
  skippedNoDepartureDate: number;
  skippedNotMatched: number;
}

export const trustRecognitionQueue = new Queue<
  TrustRecognitionJobData,
  TrustRecognitionJobResult
>("trust-recognition", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: { age: 604_800, count: 60 }, // 7 days
    removeOnFail: { age: 2_592_000, count: 30 },   // 30 days
  },
});

export async function scheduleDailyTrustRecognition() {
  const repeatableJobs = await trustRecognitionQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "trust-recognition-daily") {
      await trustRecognitionQueue.removeRepeatableByKey(job.key);
    }
  }
  await trustRecognitionQueue.add(
    "trust-recognition-daily",
    { triggeredBy: "schedule" },
    {
      repeat: { pattern: "0 6 * * *" }, // 06:00 UTC daily
      jobId: "trust-recognition-scheduled",
    }
  );
  console.log(
    "✅ Trust recognition scheduled: 06:00 UTC daily (after Plaid sync)"
  );
}

export async function triggerManualTrustRecognition() {
  return await trustRecognitionQueue.add(
    "trust-recognition-manual",
    { triggeredBy: "manual" },
    { jobId: `trust-recog-manual-${Date.now()}` }
  );
}

console.log("✅ Trust recognition queue initialized");

// ============================================================================
// Scaling guardrails (2026-05-23) — daily cron to archive old txns + check
// LLM budget. Jeff: "想想可以做的事情因為往後的資料肯定會越來越大".
//
// Runs once a day at 07:00 UTC (after Plaid sync 05:00 + trust recognition
// 06:00). Both guardrails are idempotent + cheap; failures just retry next day.
// ============================================================================

export interface ScalingGuardrailJobData {
  triggeredBy: "schedule" | "manual";
}

export interface ScalingGuardrailJobResult {
  archivedCount: number;
  cutoffDate: string;
  llmMonthToDateUsd: number;
  llmThreshold: number;
  llmAlerted: boolean;
}

export const scalingGuardrailQueue = new Queue<
  ScalingGuardrailJobData,
  ScalingGuardrailJobResult
>("scaling-guardrails", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: { age: 604_800, count: 30 },
    removeOnFail: { age: 2_592_000, count: 30 },
  },
});

export async function scheduleDailyScalingGuardrails() {
  const repeatable = await scalingGuardrailQueue.getRepeatableJobs();
  for (const job of repeatable) {
    if (job.name === "scaling-guardrails-daily") {
      await scalingGuardrailQueue.removeRepeatableByKey(job.key);
    }
  }
  await scalingGuardrailQueue.add(
    "scaling-guardrails-daily",
    { triggeredBy: "schedule" },
    {
      repeat: { pattern: "0 7 * * *" }, // 07:00 UTC daily
      jobId: "scaling-guardrails-scheduled",
    },
  );
  console.log("✅ Scaling guardrails scheduled: 07:00 UTC daily");
}

console.log("✅ Scaling guardrails queue initialized");

// ============================================================================
// Supplier Detail Enrichment (2026-05-24) — Stage 1 of supplier deep sync.
// Jeff: "擴充我的商品 + 成立我自己的 API". Pulls full itinerary / hotels /
// meals / price / notices / optional add-ons from Lion + UV detail
// endpoints into supplierProductDetails table (migration 0083).
//
// Each job = one product enrichment (5 Lion or 2 UV endpoint calls).
// Worker concurrency 5, rate-limit 1.5-2.5 sec/call → ~3-4 hr full
// backfill of 5728 products. Daily cron at 03:00 UTC picks up
// new + changed + 30day-stale.
// ============================================================================

export interface SupplierEnrichmentJobData {
  supplierProductId: number;
  supplierCode: "lion" | "uv";
  externalProductCode: string;
  triggeredBy: "backfill" | "daily-cron" | "manual";
}

export interface SupplierEnrichmentJobResult {
  itineraryStatus: string;
  priceTermsStatus: string;
  noticesStatus: string;
  optionalStatus: string;
  tourInfoStatus: string;
}

export const supplierDetailEnrichmentQueue = new Queue<
  SupplierEnrichmentJobData,
  SupplierEnrichmentJobResult
>("supplier-detail-enrichment", {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 }, // 1min, 2min, 4min
    removeOnComplete: { age: 604_800, count: 1000 },
    removeOnFail: { age: 2_592_000, count: 5000 },
  },
});

export async function scheduleDailySupplierDetailEnrichment() {
  const repeatable = await supplierDetailEnrichmentQueue.getRepeatableJobs();
  for (const job of repeatable) {
    if (job.name === "supplier-detail-enrichment-daily") {
      await supplierDetailEnrichmentQueue.removeRepeatableByKey(job.key);
    }
  }
  // Note: the actual "find products needing enrichment" logic lives in the
  // worker itself — this scheduled job is a sentinel that triggers the
  // worker's daily-cron branch. The worker enqueues per-product jobs.
  await supplierDetailEnrichmentQueue.add(
    "supplier-detail-enrichment-daily",
    {
      supplierProductId: 0, // sentinel — worker treats this as daily-cron trigger
      supplierCode: "lion",
      externalProductCode: "__daily-cron__",
      triggeredBy: "daily-cron",
    },
    {
      repeat: { pattern: "0 3 * * *" }, // 03:00 UTC daily
      jobId: "supplier-detail-enrichment-scheduled",
    },
  );
  console.log("✅ Supplier detail enrichment scheduled: 03:00 UTC daily");
}

console.log("✅ Supplier detail enrichment queue initialized");
