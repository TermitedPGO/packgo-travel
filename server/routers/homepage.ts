/**
 * Homepage router — hero / sections content + destinations CRUD.
 *
 * Extracted from server/routers.ts (Phase 4C · sub-PR 3 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 * Source range (verbatim from origin): L4225-4377.
 *
 * Procedures (9):
 *   getContent          – public: section content by key (JSON-parsed)
 *   getAllContent       – public: all homepage sections (JSON-parsed)
 *   updateContent       – admin: upsert section; B2 — auto-translate
 *                          hero title/subtitle to EN after save
 *   getDestinations     – public: active destinations
 *   getAllDestinations  – admin: all destinations (including inactive)
 *   createDestination   – admin: insert with sort order
 *   updateDestination   – admin: partial update
 *   deleteDestination   – admin: hard delete
 *   reorderDestinations – admin: bulk reorder by id list
 *
 * Notes (preserved from origin):
 *   - B2 auto-translate: hero section's title + subtitle are translated
 *     to EN inline and written back to the section row with `title_en`
 *     and `subtitle_en` keys. Fire-and-forget — translation failure
 *     doesn't block the admin save.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const homepageRouter = router({
    // Get homepage content by section key
    getContent: publicProcedure
      .input(z.object({ sectionKey: z.string() }))
      .query(async ({ input }) => {
        const content = await db.getHomepageContent(input.sectionKey);
        if (!content) return null;
        try {
          return { ...content, content: JSON.parse(content.content) };
        } catch {
          return content;
        }
      }),

    // Get all homepage content
    getAllContent: publicProcedure.query(async () => {
      const contents = await db.getAllHomepageContent();
      return contents.map(c => {
        try {
          return { ...c, content: JSON.parse(c.content) };
        } catch {
          return c;
        }
      });
    }),

    // Update homepage content (admin only)
    updateContent: adminProcedure
      .input(z.object({
        sectionKey: z.string().min(1).max(100),
        content: z.unknown(),
      }))
      .mutation(async ({ ctx, input }) => {
        const contentStr = typeof input.content === 'string'
          ? input.content
          : JSON.stringify(input.content);
        const success = await db.upsertHomepageContent(
          input.sectionKey,
          contentStr,
          ctx.user.id
        );
        if (!success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update homepage content",
          });
        }
        // B2: Auto-translate hero content after update
        if (input.sectionKey === 'hero') {
          const contentObj = typeof input.content === 'string'
            ? JSON.parse(input.content)
            : (input.content as Record<string, any>);
          if (contentObj?.title || contentObj?.subtitle) {
            import('../translation').then(async ({ translateText }) => {
              try {
                const [titleEn, subtitleEn] = await Promise.all([
                  contentObj.title ? translateText(contentObj.title, 'en') : Promise.resolve(''),
                  contentObj.subtitle ? translateText(contentObj.subtitle, 'en') : Promise.resolve(''),
                ]);
                const updatedContent = { ...contentObj, title_en: titleEn, subtitle_en: subtitleEn };
                await db.upsertHomepageContent('hero', JSON.stringify(updatedContent), ctx.user.id);
                console.log('[Homepage] Auto-translated hero content to EN');
              } catch (e) {
                console.warn('[Homepage] Auto-translation failed:', e);
              }
            }).catch(e => console.warn('[Homepage] Failed to import translation module:', e));
          }
        }
        return { success: true };
      }),

    // Get all destinations
    getDestinations: publicProcedure.query(async () => {
      return await db.getActiveDestinations();
    }),

    // Get all destinations (including inactive) for admin
    getAllDestinations: adminProcedure.query(async () => {
      return await db.getAllDestinations();
    }),

    // Create destination (admin only)
    createDestination: adminProcedure
      .input(z.object({
        name: z.string(),
        label: z.string().optional(),
        image: z.string().optional(),
        region: z.string().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createDestination(input);
        if (!id) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create destination",
          });
        }
        return { id };
      }),

    // Update destination (admin only)
    updateDestination: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        label: z.string().optional(),
        image: z.string().optional(),
        region: z.string().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const success = await db.updateDestination(id, data);
        if (!success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update destination",
          });
        }
        return { success: true };
      }),

    // Delete destination (admin only)
    deleteDestination: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const success = await db.deleteDestination(input.id);
        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Destination not found",
          });
        }
        return { success: true };
      }),

    // Reorder destinations (admin only)
    reorderDestinations: adminProcedure
      .input(z.object({ orderedIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        const success = await db.reorderDestinations(input.orderedIds);
        if (!success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to reorder destinations",
          });
        }
        return { success: true };
      }),
  });
