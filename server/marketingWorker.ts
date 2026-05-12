/**
 * marketingWorker.ts
 * BullMQ Worker for marketing automation jobs
 * Handles: send_newsletter, generate_poster, generate_copy
 */

import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import {
  MarketingJobData,
  MarketingJobResult,
} from "./queue";
import { sendNewsletter } from "./services/emailMarketingService";
import { generatePoster } from "./services/posterGeneratorService";
import { generateSocialCopy } from "./services/marketingCopyService";
import { notifyOwner } from "./_core/notification";
import {
  saveMarketingMaterial,
  getActiveSubscribers,
  getTourById,
} from "./db";

// ── Worker ─────────────────────────────────────────────────

export const marketingWorker = new Worker<MarketingJobData, MarketingJobResult>(
  "marketing",
  async (job: Job<MarketingJobData>) => {
    const { type, campaignId, tourId, payload } = job.data;

    console.log(`[MarketingWorker] Processing job ${job.id}: type=${type}`);

    switch (type) {
      case "send_newsletter": {
        const { subject, htmlContent } = payload as {
          subject: string;
          htmlContent: string;
        };

        if (!campaignId || !subject || !htmlContent) {
          throw new Error("Missing required payload for send_newsletter");
        }

        const subscribers = await getActiveSubscribers();
        const emails = subscribers.map((s) => s.email);

        if (emails.length === 0) {
          console.log(`[MarketingWorker] No active subscribers, skipping send`);
          return { success: true, message: "No active subscribers", data: { sent: 0, failed: 0 } };
        }

        await job.updateProgress(10);

        const result = await sendNewsletter({
          campaignId,
          subject,
          htmlContent,
          subscribers: emails,
        });

        await job.updateProgress(100);

        console.log(
          `[MarketingWorker] Newsletter sent: ${result.sent} sent, ${result.failed} failed`
        );
        return {
          success: true,
          message: `Sent ${result.sent} emails, ${result.failed} failed`,
          data: result,
        };
      }

      case "generate_poster": {
        const { format } = payload as { format: "landscape" | "square" | "story" };

        if (!tourId || !format) {
          throw new Error("Missing tourId or format for generate_poster");
        }

        const tour = await getTourById(tourId);
        if (!tour) throw new Error(`Tour ${tourId} not found`);

        await job.updateProgress(20);

        const result = await generatePoster({
          tourId,
          format,
          heroImageUrl: tour.heroImage || "",
          title: tour.title,
          destination: tour.destination,
          duration: `${tour.duration}天${tour.duration - 1}夜`,
          price: `USD $${tour.price.toLocaleString()} 起`,
          highlights: JSON.parse(tour.highlights || "[]").slice(0, 3),
        });

        await job.updateProgress(80);

        // Save to materials
        const materialType =
          format === "landscape"
            ? "poster_landscape"
            : format === "square"
            ? "poster_square"
            : "poster_story";

        if (campaignId) {
          await saveMarketingMaterial({
            campaignId,
            tourId,
            type: materialType,
            imageUrl: result.s3Url,
            createdBy: 0, // system
            metadata: JSON.stringify({ format, width: result.width, height: result.height }),
          });
        }

        await job.updateProgress(100);

        return {
          success: true,
          message: `Poster generated: ${format} (${result.width}x${result.height})`,
          data: { s3Url: result.s3Url, format, width: result.width, height: result.height },
        };
      }

      case "generate_copy": {
        const { platform, tone, language } = payload as {
          platform: "facebook" | "instagram" | "line";
          tone?: "professional" | "casual" | "exciting" | "luxury";
          language?: "zh-TW" | "en";
        };

        if (!tourId || !platform) {
          throw new Error("Missing tourId or platform for generate_copy");
        }

        await job.updateProgress(20);

        const result = await generateSocialCopy({
          tourId,
          platform,
          tone,
          language,
        });

        await job.updateProgress(80);

        // Save to materials
        const materialType =
          platform === "facebook"
            ? "social_copy_fb"
            : platform === "instagram"
            ? "social_copy_ig"
            : "social_copy_line";

        const content = JSON.stringify(result);

        if (campaignId) {
          await saveMarketingMaterial({
            campaignId,
            tourId,
            type: materialType,
            content,
            createdBy: 0, // system
            metadata: JSON.stringify({ platform, tone, language }),
          });
        }

        await job.updateProgress(100);

        return {
          success: true,
          message: `Copy generated for ${platform}`,
          data: result as unknown as Record<string, unknown>,
        };
      }

      default:
        throw new Error(`Unknown marketing job type: ${type}`);
    }
  },
  {
    connection: redisBullMQ,
    concurrency: 2, // Process up to 2 marketing jobs simultaneously
  }
);

// ── Event handlers ─────────────────────────────────────────

marketingWorker.on("completed", (job, result) => {
  console.log(`[MarketingWorker] ✅ Job ${job.id} completed:`, result.message);
});

marketingWorker.on("failed", (job, err) => {
  console.error(`[MarketingWorker] ❌ Job ${job?.id} failed:`, err.message);
  notifyOwner({
    title: `[MarketingWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

marketingWorker.on("error", (err) => {
  console.error("[MarketingWorker] Worker error:", err);
});

console.log("✅ Marketing worker initialized");
