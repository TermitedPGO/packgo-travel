/**
 * Marketing automation router — admin-only campaign management +
 * AI copy / poster generation / newsletter send.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L3713-3886.
 *
 * Procedures (12):
 *   - listCampaigns / getCampaign / createCampaign / updateCampaign /
 *     deleteCampaign  – CRUD
 *   - generateCopy    – AI social copy generation
 *   - generatePoster  – AI poster image generation
 *   - sendNewsletter  – broadcast email blast
 *   - listMaterials / deleteMaterial  – material asset lifecycle
 *   - subscriberStats – newsletter audience size
 *   - emailLogs       – send-log audit trail
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const marketingRouter = router({
    // List campaigns
    listCampaigns: adminProcedure
      .input(z.object({
        page: z.number().default(1),
        pageSize: z.number().default(20),
        status: z.enum(["draft", "scheduled", "sent", "cancelled"]).optional(),
      }))
      .query(async ({ input }) => {
        return db.getMarketingCampaigns(input);
      }),

    // Get single campaign
    getCampaign: adminProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        return db.getMarketingCampaignById(input.campaignId);
      }),

    // Create campaign
    createCampaign: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        type: z.enum(["social_post", "email_newsletter", "poster"]),
        tourId: z.number().optional(),
        subject: z.string().optional(),
        scheduledAt: z.number().optional(),
        metadata: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { tourId, scheduledAt, ...rest } = input;
        return db.createMarketingCampaign({ ...rest, createdBy: ctx.user.id });
      }),

    // Update campaign
    updateCampaign: adminProcedure
      .input(z.object({
        campaignId: z.number(),
        name: z.string().optional(),
        status: z.enum(["draft", "scheduled", "sent", "cancelled"]).optional(),
        subject: z.string().optional(),
        scheduledAt: z.number().optional(),
        metadata: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { campaignId, ...rawData } = input;
        const { scheduledAt, ...data } = rawData;
        return db.updateMarketingCampaign(campaignId, data);
      }),

    // Delete campaign
    deleteCampaign: adminProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteMarketingCampaign(input.campaignId);
        return { success: true };
      }),

    // Generate AI social copy
    generateCopy: adminProcedure
      .input(z.object({
        tourId: z.number(),
        platform: z.enum(["facebook", "instagram", "line"]),
        tone: z.enum(["professional", "casual", "exciting", "luxury"]).optional(),
        language: z.enum(["zh-TW", "en"]).optional(),
        campaignId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { generateSocialCopy } = await import("../services/marketingCopyService");
        const result = await generateSocialCopy(input);
        if (input.campaignId) {
          await db.saveMarketingMaterial({
            campaignId: input.campaignId,
            tourId: input.tourId,
            type: `social_copy_${input.platform === 'facebook' ? 'fb' : input.platform === 'instagram' ? 'ig' : 'line'}`,
            content: JSON.stringify(result),
            createdBy: 0,
            metadata: JSON.stringify({ platform: input.platform, tone: input.tone }),
          });
        }
        return result;
      }),

    // Generate poster
    generatePoster: adminProcedure
      .input(z.object({
        tourId: z.number(),
        format: z.enum(["landscape", "square", "story"]),
        campaignId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const tour = await db.getTourById(input.tourId);
        if (!tour) throw new TRPCError({ code: "NOT_FOUND", message: "Tour not found" });
        const { generatePoster } = await import("../services/posterGeneratorService");
        const result = await generatePoster({
          tourId: input.tourId,
          format: input.format,
          heroImageUrl: tour.heroImage || "",
          title: tour.title,
          // tour.destination is legacy nullable (schema v81); fall back
          // through canonical destinationCity (notNull) before empty string.
          destination: tour.destination ?? tour.destinationCity ?? "",
          duration: `${tour.duration}天${tour.duration - 1}夜`,
          price: `USD $${tour.price.toLocaleString()} 起`,
          highlights: JSON.parse(tour.highlights || "[]").slice(0, 3),
        });
        if (input.campaignId) {
          await db.saveMarketingMaterial({
            campaignId: input.campaignId,
            tourId: input.tourId,
            type: `poster_${input.format}`,
            imageUrl: result.s3Url,
            createdBy: 0,
            metadata: JSON.stringify({ format: input.format, width: result.width, height: result.height }),
          });
        }
        return { s3Url: result.s3Url, format: result.format, width: result.width, height: result.height };
      }),

    // Send newsletter
    sendNewsletter: adminProcedure
      .input(z.object({
        campaignId: z.number(),
        subject: z.string().min(1),
        htmlContent: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const subscribers = await db.getActiveSubscribers();
        const emails = subscribers.map((s) => s.email);
        if (emails.length === 0) return { success: true, sent: 0, failed: 0 };
        const { sendNewsletter } = await import("../services/emailMarketingService");
        const result = await sendNewsletter({
          campaignId: input.campaignId,
          subject: input.subject,
          htmlContent: input.htmlContent,
          subscribers: emails,
        });
        await db.updateMarketingCampaign(input.campaignId, { status: "sent" });
        return result;
      }),

    // List materials for a campaign
    listMaterials: adminProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        return db.getMarketingMaterials({ campaignId: input.campaignId });
      }),

    // Delete material
    deleteMaterial: adminProcedure
      .input(z.object({ materialId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteMarketingMaterial(input.materialId);
        return { success: true };
      }),

    // Get subscriber stats
    subscriberStats: adminProcedure
      .query(async () => {
        const stats = await db.getSubscriberCount();
        return { active: stats.active, total: stats.total };
      }),

    // List email send logs
    emailLogs: adminProcedure
      .input(z.object({
        campaignId: z.number().optional(),
        page: z.number().default(1),
        pageSize: z.number().default(50),
      }))
      .query(async ({ input }) => {
        return db.getEmailSendLogs(input.campaignId ?? 0);
      }),
  });
