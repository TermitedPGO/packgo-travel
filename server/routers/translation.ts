/**
 * Translation router — multi-language translation API (admin + public).
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L3326-3472.
 *
 * Procedures (10):
 *   - translate                  – single-string translation
 *   - translateBatch             – array translation
 *   - translateTour              – per-tour multi-lang job
 *   - translateAllTours          – fan-out for whole catalog
 *   - getAllTranslationsSummary  – admin overview
 *   - getTourTranslations        – fetch + fallback queue
 *   - getBatchTourTranslations   – multi-tour fetch
 *   - getAllTourTranslations     – all langs for one tour
 *   - getJobs                    – translation job history
 *   - getSupportedLanguages      – language enum dictionary
 */

import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  translateText,
  translateBatch,
  translateTour,
  translateMultipleTours,
  getTourTranslations,
  getBatchTourTranslations,
  getAllTourTranslations,
  getTranslationJobs,
  getSupportedLanguages,
  getAllTranslationsSummary,
  Language,
} from "../translation";

export const translationRouter = router({
    // Translate single text
    translate: publicProcedure
      .input(z.object({
        text: z.string(),
        targetLanguage: z.enum(['zh-TW', 'en']),
        sourceLanguage: z.enum(['zh-TW', 'en']).optional().default('zh-TW'),
      }))
      .mutation(async ({ input }) => {
        const translated = await translateText(
          input.text,
          input.targetLanguage,
          input.sourceLanguage
        );
        return { translated };
      }),

    // Translate multiple texts in batch
    translateBatch: publicProcedure
      .input(z.object({
        texts: z.array(z.string()),
        targetLanguage: z.enum(['zh-TW', 'en']),
        sourceLanguage: z.enum(['zh-TW', 'en']).optional().default('zh-TW'),
      }))
      .mutation(async ({ input }) => {
        const translated = await translateBatch(
          input.texts,
          input.targetLanguage,
          input.sourceLanguage
        );
        return { translated };
      }),

    // Translate a single tour to multiple languages
    translateTour: adminProcedure
      .input(z.object({
        tourId: z.number(),
        targetLanguages: z.array(z.enum(['zh-TW', 'en'])),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await translateTour(
          input.tourId,
          input.targetLanguages as Language[],
          'zh-TW',
          ctx.user.id
        );
        return result;
      }),

    // Translate all tours to multiple languages
    translateAllTours: adminProcedure
      .input(z.object({
        targetLanguages: z.array(z.enum(['zh-TW', 'en'])),
      }))
      .mutation(async ({ input, ctx }) => {
        // Get all tour IDs
        const allTours = await db.getAllTours();
        const tourIds = allTours.map(t => t.id);

        if (tourIds.length === 0) {
          return { success: true, message: 'No tours to translate', results: [] };
        }

        const result = await translateMultipleTours(
          tourIds,
          input.targetLanguages as Language[],
          ctx.user.id
        );

        return {
          success: result.success,
          jobId: result.jobId,
          totalTours: tourIds.length,
          results: result.results,
        };
      }),

    // Get translation summary for all tours (admin only)
    getAllTranslationsSummary: adminProcedure
      .query(async () => {
        return await getAllTranslationsSummary();
      }),
    // Get translations for a specific tour
    getTourTranslations: publicProcedure
      .input(z.object({
        tourId: z.number(),
        targetLanguage: z.enum(['zh-TW', 'en']),
      }))
      .query(async ({ input }) => {
        const translations = await getTourTranslations(
          input.tourId,
          input.targetLanguage as Language
        );
        // Fix 3 (Round 61): If no translations found and target is not zh-TW, trigger fallback translation job
        if (Object.keys(translations).length === 0 && input.targetLanguage !== 'zh-TW') {
          import('../queue').then(({ addTourTranslationJob }) =>
            addTourTranslationJob({
              tourId: input.tourId,
              targetLanguages: [input.targetLanguage],
              sourceLanguage: 'zh-TW',
              userId: 0, // system-triggered
            })
          ).catch((e) => console.warn(`[TranslateFallback] Failed to queue translation for tour ${input.tourId}:`, e));
        }
        return translations;
      }),

    // Batch get translations for multiple tours
    getBatchTourTranslations: publicProcedure
      .input(z.object({
        tourIds: z.array(z.number()),
        targetLanguage: z.enum(['zh-TW', 'en']),
      }))
      .query(async ({ input }) => {
        const result = await getBatchTourTranslations(
          input.tourIds,
          input.targetLanguage as Language
        );
        return result;
      }),

    // Get all translations for a tour (all languages)
    getAllTourTranslations: publicProcedure
      .input(z.object({
        tourId: z.number(),
      }))
      .query(async ({ input }) => {
        const translations = await getAllTourTranslations(input.tourId);
        return translations;
      }),

    // Get translation job history
    getJobs: adminProcedure
      .input(z.object({
        limit: z.number().optional().default(20),
      }))
      .query(async ({ input }) => {
        const jobs = await getTranslationJobs(input.limit);
        return jobs;
      }),

    // Get supported languages
    getSupportedLanguages: publicProcedure
      .query(() => {
        return getSupportedLanguages();
      }),
  });
