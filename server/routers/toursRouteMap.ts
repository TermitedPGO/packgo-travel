/**
 * Tours route-map router — thin shell delegating to
 * server/services/routeMap/ for the heavy lifting.
 *
 * v2 Wave 2 Module 2.13 (2026-05-21) extracted the 760-LOC
 * getRouteMap procedure into three service files:
 *   - server/services/routeMap/builder.ts   — orchestrator
 *   - server/services/routeMap/renderer.ts  — cluster + static map URL
 *   - server/services/routeMap/fallbacks.ts — geocoders + country tables
 *
 * External tRPC path `trpc.tours.getRouteMap` is unchanged. Client
 * consumer (TourRouteMapSvg.tsx) needs no updates.
 *
 * regenerateAiMap stays inline — it's already a thin admin wrapper
 * around server/services/tourMapGenerator.
 */

import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { buildRouteMap } from "../services/routeMap/builder";

export const toursRouteMapRouter = router({
  /**
   * Admin: regenerate the per-tour AI travel map via gpt-image-2.
   * Cost: ~$0.28 per call. Duration: ~135-160s.
   *
   * v331 Phase A — synchronous; admin UI shows a spinner and waits.
   * Phase B will move this to a BullMQ job for non-blocking generation.
   */
  regenerateAiMap: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { generateTourMap } = await import("../services/tourMapGenerator");
      const result = await generateTourMap({ tourId: input.id });
      return {
        aiMapUrl: result.url,
        cost: result.cost,
        durationMs: result.durationMs,
      };
    }),

  /**
   * v78o Sprint 7: Tour route map — server-side geocoding + Google Static
   * Map URL for the daily itinerary. Server-side because the client-side
   * Forge proxy isn't available in production.
   *
   * Returns: { staticMapUrl, stops: [{day, name, lat, lng}], directionsUrl,
   *           aiMapUrl, outliers?, fallbackMode? }
   * Cached in-memory for 24h.
   */
  getRouteMap: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await buildRouteMap({ id: input.id });
    }),
});
