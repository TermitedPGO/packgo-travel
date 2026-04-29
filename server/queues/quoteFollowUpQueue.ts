/**
 * quoteFollowUpQueue.ts — v78l Sprint 4B: scheduled quote follow-up emails.
 *
 * When an AI quote is generated AND the customer left an email, we queue
 * 3 delayed jobs at 24h / 3d / 7d offsets. Each fires a tailored email
 * encouraging the customer to come back.
 *
 * Industry data: re-engagement sequences typically lift quote→booking
 * conversion from ~10% baseline to 20–25%.
 */

import { Queue, Worker, Job } from "bullmq";
import { redisBullMQ } from "../redis";
import { sendQuoteFollowUpEmail, QuoteFollowUpData } from "../email";
import * as db from "../db";

const QUEUE_NAME = "quote-followup";

export interface QuoteFollowUpJob {
  quoteId: number;
  stage: "24h" | "3d" | "7d";
}

export const quoteFollowUpQueue = new Queue<QuoteFollowUpJob>(QUEUE_NAME, {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

const MS = {
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Schedule the 3-touch follow-up for a freshly-generated quote. No-op if
 * the quote has no customer email.
 */
export async function scheduleQuoteFollowUps(quoteId: number, customerEmail?: string | null) {
  if (!customerEmail) {
    console.log(`[QuoteFollowUp] Skip queueing for quote #${quoteId} — no customer email`);
    return;
  }
  const stages: ("24h" | "3d" | "7d")[] = ["24h", "3d", "7d"];
  await Promise.all(
    stages.map((stage) =>
      quoteFollowUpQueue.add(
        `followup-${quoteId}-${stage}`,
        { quoteId, stage },
        {
          delay: MS[stage],
          jobId: `quote-${quoteId}-${stage}`, // Idempotent — won't double-queue
        }
      )
    )
  );
  console.log(`[QuoteFollowUp] Scheduled 3 follow-ups for quote #${quoteId} (24h/3d/7d)`);
}

/** Cancel all scheduled follow-ups for a quote (used when quote converts) */
export async function cancelQuoteFollowUps(quoteId: number) {
  const stages: ("24h" | "3d" | "7d")[] = ["24h", "3d", "7d"];
  await Promise.all(
    stages.map(async (stage) => {
      const job = await quoteFollowUpQueue.getJob(`quote-${quoteId}-${stage}`);
      if (job) {
        await job.remove();
        console.log(`[QuoteFollowUp] Cancelled ${stage} for quote #${quoteId}`);
      }
    })
  );
}

let _worker: Worker<QuoteFollowUpJob> | null = null;

export function initQuoteFollowUpWorker() {
  if (_worker) return _worker;
  _worker = new Worker<QuoteFollowUpJob>(
    QUEUE_NAME,
    async (job: Job<QuoteFollowUpJob>) => {
      const { quoteId, stage } = job.data;
      const quote = await db.getAiQuoteById(quoteId);
      if (!quote) {
        console.log(`[QuoteFollowUp] Quote #${quoteId} no longer exists, skipping ${stage}`);
        return { skipped: "missing" };
      }
      // Skip if already converted
      if (quote.status === "converted") {
        console.log(`[QuoteFollowUp] Quote #${quoteId} converted, skipping ${stage}`);
        return { skipped: "converted" };
      }
      if (quote.status === "expired") {
        console.log(`[QuoteFollowUp] Quote #${quoteId} expired, skipping ${stage}`);
        return { skipped: "expired" };
      }
      if (!quote.customerEmail) {
        return { skipped: "no_email" };
      }

      let extracted: any = {};
      try {
        extracted = quote.extractedParams ? JSON.parse(quote.extractedParams) : {};
      } catch {}

      const tripRecap = [
        extracted.destinationCountry || extracted.destinationCity,
        extracted.days ? `${extracted.days} 天` : null,
        extracted.adults ? `${extracted.adults} 大${extracted.children ? `${extracted.children} 小` : ""}` : null,
        extracted.budgetMax ? `預算 ${extracted.currency || "USD"} ${extracted.budgetMax}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const data: QuoteFollowUpData = {
        customerEmail: quote.customerEmail,
        customerName: quote.customerName || undefined,
        quoteNumber: quote.quoteNumber,
        pdfUrl: quote.pdfUrl,
        stage,
        language: extracted.language === "en" ? "en" : "zh-TW",
        tripRecap: tripRecap || undefined,
      };
      const ok = await sendQuoteFollowUpEmail(data);
      return { sent: ok, stage };
    },
    {
      connection: redisBullMQ,
      concurrency: 4,
    }
  );
  _worker.on("failed", (job, err) => {
    console.error(`[QuoteFollowUp] Job ${job?.id} failed:`, err.message);
  });
  console.log("✅ Quote follow-up worker initialized");
  return _worker;
}
