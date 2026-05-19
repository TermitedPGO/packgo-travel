/**
 * Image library router — user image bank: list / add / admin-delete.
 *
 * Extracted from server/routers.ts (Phase 4C · sub-PR 3 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 * Source range (verbatim from origin): L4157-4223.
 *
 * Procedures (3):
 *   list   – auth: query own images, optional tour/search/pagination
 *   add    – auth: add image with metadata; tags JSON-stringified
 *   delete – admin: hard delete with ownership check
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const imageLibraryRouter = router({
    // List images from library
    list: protectedProcedure
      .input(z.object({
        tourId: z.number().optional(),
        search: z.string().optional(),
        limit: z.number().optional().default(50),
        offset: z.number().optional().default(0),
      }).optional())
      .query(async ({ ctx, input }) => {
        return await db.getImageLibrary({
          userId: ctx.user.id,
          tourId: input?.tourId,
          search: input?.search,
          limit: input?.limit,
          offset: input?.offset,
        });
      }),

    // Add image to library
    add: protectedProcedure
      .input(z.object({
        url: z.string(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
        fileSize: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        tags: z.array(z.string()).optional(),
        tourId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const image = await db.addImageToLibrary({
          url: input.url,
          filename: input.filename,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          width: input.width,
          height: input.height,
          tags: input.tags ? JSON.stringify(input.tags) : null,
          tourId: input.tourId,
          uploadedBy: ctx.user.id,
        });
        if (!image) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to add image to library",
          });
        }
        return image;
      }),

    // Delete image from library (admin only)
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const success = await db.deleteImageFromLibrary(input.id, ctx.user.id);
        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Image not found or you don't have permission to delete it",
          });
        }
        return { success: true };
      }),

  });
