/**
 * Batch P1b — admin-only write paths for the storefront contract layer.
 *
 * Five adminProcedure endpoints (repo pattern: server/routers/toursAdmin.ts
 * — adminProcedure + fire-and-forget audit() per mutation):
 *   createDraftProductVersion — next draft version for a tour
 *   importItineraryDraft      — parse tours.dailyItinerary/itineraryDetailed
 *                               into an HONEST draft itinerary contract
 *   createFeeContractDraft    — validated draft fee contract
 *                               ('confirmed' unreachable via this path)
 *   publishProductVersion     — atomic publish + supersede (one published
 *                               version per tour, enforced in-transaction)
 *   listVersions              — admin read of ALL versions incl. drafts
 *
 * The public read-only router (server/routers/storefront.ts) is FROZEN and
 * untouched; drafts written here are invisible to it until published.
 *
 * 紅線: these tables never contain supplier cost (agentPrice/supplierCost)
 * or seat counts by construction, and the import path never reads them —
 * see the supplier-cost firewall in server/storefront/importDraft.ts.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  createDraftProductVersion,
  createFeeContractDraft,
  createFeeContractDraftInputSchema,
  importItineraryDraft,
} from "../storefront/importDraft";
import { listVersionsForTour, publishProductVersion } from "../storefront/publish";

const idInput = z.number().int().positive().max(2_147_483_647);

export const storefrontPublishRouter = router({
  /** Create the next draft productVersion for a tour. */
  createDraftProductVersion: adminProcedure
    .input(z.object({ tourId: idInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await createDraftProductVersion({
        tourId: input.tourId,
        createdBy: ctx.user.id,
      });
      // Repo audit convention (toursAdmin.ts): fire-and-forget audit().
      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "storefront.productVersion.createDraft",
        targetType: "productVersion",
        targetId: result.id,
        changes: { tourId: input.tourId, versionNumber: result.versionNumber },
      });
      return result;
    }),

  /**
   * Import the tour's existing itinerary JSON into a draft
   * itineraryVersion (+days/stops) with honest statuses. Idempotent per
   * draft version — re-import replaces that draft's children only.
   */
  importItineraryDraft: adminProcedure
    .input(z.object({ tourId: idInput, productVersionId: idInput.optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await importItineraryDraft({
        tourId: input.tourId,
        productVersionId: input.productVersionId,
        createdBy: ctx.user.id,
      });
      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "storefront.itinerary.importDraft",
        targetType: "itineraryVersion",
        targetId: result.itineraryVersionId,
        changes: {
          tourId: input.tourId,
          productVersionId: result.productVersionId,
          itineraryId: result.itineraryId,
          versionNumber: result.versionNumber,
          dayCount: result.dayCount,
          stopCount: result.stopCount,
          sourceStatus: result.sourceStatus,
          replacedExistingDraft: result.replacedExistingDraft,
        },
      });
      return result;
    }),

  /**
   * Create/replace a draft fee contract with validated integer-minor-unit
   * fee lines. sourceStatus 'confirmed' is NOT accepted here (see
   * importDraft.ts — confirmation is a separate adjudicated action).
   */
  createFeeContractDraft: adminProcedure
    .input(createFeeContractDraftInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await createFeeContractDraft(input);
      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "storefront.feeContract.createDraft",
        targetType: "feeContract",
        targetId: result.feeContractId,
        changes: {
          tourId: input.tourId,
          productVersionId: result.productVersionId,
          contractId: result.contractId,
          sourceStatus: result.sourceStatus,
          itemCount: result.itemCount,
          replacedExistingDraft: result.replacedExistingDraft,
        },
      });
      return result;
    }),

  /**
   * Atomic publish: supersedes the previous published version of the same
   * tour in the SAME transaction. No unpublish exists — corrections are a
   * new published version (see server/storefront/publish.ts).
   */
  publishProductVersion: adminProcedure
    .input(z.object({ productVersionId: idInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await publishProductVersion({
        productVersionId: input.productVersionId,
        publishedBy: ctx.user.id,
      });
      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "storefront.productVersion.publish",
        targetType: "productVersion",
        targetId: result.productVersionId,
        changes: {
          tourId: result.tourId,
          versionNumber: result.versionNumber,
          contentHash: result.contentHash,
          supersededProductVersionIds: result.supersededProductVersionIds,
          publishedItineraryVersionIds: result.publishedItineraryVersionIds,
          publishedFeeContractIds: result.publishedFeeContractIds,
        },
      });
      return result;
    }),

  /**
   * Admin read of the full version history of a tour (drafts included).
   * The contract tables never carry supplier cost/seat fields, so full
   * rows are safe to return to admin.
   */
  listVersions: adminProcedure
    .input(z.object({ tourId: idInput }))
    .query(async ({ input }) => listVersionsForTour(input.tourId)),
});
