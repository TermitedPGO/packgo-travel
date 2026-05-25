/**
 * Tours read-only router — public listing, detail, search, autocomplete,
 * recommendations, similar-tour, PDF generation.
 *
 * Extracted from server/routers.ts (Phase 4A · sub-PR 1 of 5) on
 * 2026-05-18 as part of the routers.ts split (audit P0-1).
 * Source ranges (verbatim from origin):
 *   L1555-1605  list / getById / getFilterOptions
 *   L2381-2566  getDepartureCities / search / suggest
 *   L3389-3462  generatePdf
 *   L3633-3692  getSimilar / getRecommended
 *
 * IMPORTANT: This file contains ONLY publicly-readable tour procedures.
 * Admin tour mutations (create, update, patchField, delete, batchDelete,
 * duplicate, generation lifecycle, calibration, diagnose, llmStressTest,
 * getExtractedDepartures, etc.) stay in server/routers.ts until Phase 4E.
 *
 * The `getRouteMap` and `regenerateAiMap` procedures are in their own
 * file `toursRouteMap.ts` because `getRouteMap` alone is ~760 LOC.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, like, or } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { getDb } from "../db";
import {
  supplierProducts,
  supplierProductDetails,
  tours as toursTable,
} from "../../drizzle/schema";
import type {
  NormalizedItinerary,
  NormalizedNotices,
  NormalizedOptional,
  NormalizedPriceTerms,
  NormalizedTourInfo,
} from "../services/supplierSync/types";

export const toursReadRouter = router({
  // Get all tours (public)
  list: publicProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          status: z.string().optional(),
          featured: z.boolean().optional(),
          // 2026-05-22: admin tabs need larger pages than default 100.
          // 2026-05-25: raised 2000 → 10000 after mass import of 4000+ supplier
          // tours. Admin lists all active tours in one shot; abuse risk is
          // low since this is publicProcedure but tour data is already public.
          pageSize: z.number().int().min(1).max(10000).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await db.getAllTours(input);
    }),

  // Get single tour by ID (public)
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const tour = await db.getTourById(input.id);
      if (!tour) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tour not found",
        });
      }
      return tour;
    }),

  // Get filter options for smart filtering (public)
  getFilterOptions: publicProcedure.query(async () => {
    return await db.getFilterOptions();
  }),

  // Get distinct departure cities from active tours (for search autocomplete)
  getDepartureCities: publicProcedure.query(async () => {
    return await db.getDepartureCities();
  }),

  // Search tours with filters (public)
  // QA audit 2026-05-11 Phase 2 fix: input was unbounded — destination
  // and category accepted arbitrary-length strings, arrays were uncapped.
  // A 10MB Unicode payload would tie up the query planner. All inputs
  // now have realistic length / count caps.
  search: publicProcedure
    .input(
      z.object({
        destination: z.string().max(100).optional(),
        category: z.string().max(50).optional(),
        minDays: z.number().int().min(0).max(365).optional(),
        maxDays: z.number().int().min(0).max(365).optional(),
        minPrice: z.number().min(0).max(1_000_000).optional(),
        maxPrice: z.number().min(0).max(1_000_000).optional(),
        airlines: z.array(z.string().max(50)).max(20).optional(),
        hotelGrades: z.array(z.string().max(30)).max(10).optional(),
        specialActivities: z.array(z.string().max(50)).max(20).optional(),
        tags: z.array(z.string().max(50)).max(20).optional(),
        sortBy: z.enum(["popular", "price_asc", "price_desc", "days_asc", "days_desc"]).optional(),
        page: z.number().int().min(1).max(10_000).default(1),
        pageSize: z.number().int().min(1).max(100).default(12),
      })
    )
    .query(async ({ input }) => {
      const { page, pageSize, ...filters } = input;
      const offset = (page - 1) * pageSize;

      // DB-level pagination: searchTours now handles limit/offset and returns total count
      const { tours, total } = await db.searchTours({
        ...filters,
        limit: pageSize,
        offset,
      });

      const totalPages = Math.ceil(total / pageSize);

      return {
        tours,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
      };
    }),

  /**
   * Round 80.13: lightweight typeahead endpoint for the homepage hero
   * search bar. Returns up to 8 suggestions across 4 categories:
   *   - destination (matches tour.destinationCountry / destinationCity)
   *   - tour (matches tour.title — exact tour link)
   *   - season (curated tags: 春櫻 / 秋楓 / 雪國)
   *   - popular (returned when query is empty — 4 top destinations)
   *
   * Designed for low-latency autocomplete: queries the tour list (cached
   * in tRPC) and does in-memory fuzzy match. NO new DB tables needed.
   *
   * Routing:
   *   - destination → /tours?destination={country}
   *   - tour        → /tours/{id}
   *   - season      → /tours?season={key}
   */
  suggest: publicProcedure
    .input(z.object({ query: z.string().max(50).default("") }))
    .query(async ({ input }) => {
      const q = input.query.trim().toLowerCase();
      const allTours = await db.getAllTours();
      const active = allTours.filter((t) => t.status === "active");

      type Suggestion = {
        type: "destination" | "tour" | "season" | "popular";
        label: string;
        sublabel?: string;
        href: string;
        imageUrl?: string;
      };
      const out: Suggestion[] = [];

      // Empty query → popular destinations (top by featured count) + seasons
      if (!q) {
        // Top 4 destinations by featured count
        const destMap = new Map<string, { country: string; count: number; img?: string }>();
        for (const t of active) {
          const country = (t.destinationCountry || "").trim();
          if (!country) continue;
          const existing = destMap.get(country);
          if (existing) {
            existing.count += t.featured === 1 ? 2 : 1; // featured weighted 2x
          } else {
            destMap.set(country, { country, count: t.featured === 1 ? 2 : 1, img: t.heroImage || t.imageUrl || undefined });
          }
        }
        const topDests = Array.from(destMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 4);
        for (const d of topDests) {
          out.push({
            type: "popular",
            label: d.country,
            sublabel: `${d.count} 個行程`,
            href: `/tours?destination=${encodeURIComponent(d.country)}`,
            imageUrl: d.img,
          });
        }
        // Plus 3 seasonal suggestions
        out.push(
          { type: "season", label: "春櫻 (3-4月)", href: "/tours?season=spring" },
          { type: "season", label: "秋楓 (10-11月)", href: "/tours?season=autumn" },
          { type: "season", label: "雪國 (12-2月)", href: "/tours?season=winter" },
        );
        return { suggestions: out.slice(0, 8) };
      }

      // ── Query mode ───────────────────────────────────────────────────
      // Match destination countries / cities first (highest signal)
      const seenDest = new Set<string>();
      for (const t of active) {
        const country = (t.destinationCountry || "").trim();
        const city = (t.destinationCity || "").trim();
        if (country && country.toLowerCase().includes(q) && !seenDest.has(country)) {
          seenDest.add(country);
          const sample = active.find((x) => x.destinationCountry === country);
          out.push({
            type: "destination",
            label: country,
            sublabel: "看所有 " + country + " 行程",
            href: `/tours?destination=${encodeURIComponent(country)}`,
            imageUrl: sample?.heroImage || sample?.imageUrl || undefined,
          });
        }
        if (city && city.toLowerCase().includes(q) && !seenDest.has(city) && city !== country) {
          seenDest.add(city);
          out.push({
            type: "destination",
            label: city,
            sublabel: country ? `${country} · 看所有行程` : "看所有行程",
            href: `/tours?destination=${encodeURIComponent(city)}`,
            imageUrl: t.heroImage || t.imageUrl || undefined,
          });
        }
        if (out.length >= 5) break;
      }

      // Then individual tours by title (up to 3 matches)
      const tourMatches = active
        .filter((t) => (t.title || "").toLowerCase().includes(q))
        .slice(0, 3);
      for (const t of tourMatches) {
        out.push({
          type: "tour",
          label: t.title,
          sublabel: `${t.destinationCountry || ""} · ${t.duration} 天 · NT$ ${(t.price || 0).toLocaleString()}`,
          href: `/tours/${t.id}`,
          imageUrl: t.heroImage || t.imageUrl || undefined,
        });
      }

      // If still less than 3 results, try season keyword match
      if (out.length < 3) {
        const seasonHints: Array<{ kw: string[]; key: string; label: string }> = [
          { kw: ["櫻", "spring", "春", "3月", "4月"], key: "spring", label: "春櫻 (3-4月)" },
          { kw: ["楓", "autumn", "fall", "秋", "10月", "11月"], key: "autumn", label: "秋楓 (10-11月)" },
          { kw: ["雪", "winter", "冬", "12月", "1月", "2月"], key: "winter", label: "雪國 (12-2月)" },
        ];
        for (const s of seasonHints) {
          if (s.kw.some((k) => q.includes(k.toLowerCase()))) {
            out.push({
              type: "season",
              label: s.label,
              sublabel: "依季節篩選",
              href: `/tours?season=${s.key}`,
            });
          }
        }
      }

      return { suggestions: out.slice(0, 8) };
    }),

  // Generate PDF for tour (public)
  generatePdf: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      console.log(`[GeneratePDF] Starting PDF generation for tour ${input.id}`);

      // Get tour data
      const tour = await db.getTourById(input.id);
      if (!tour) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tour not found",
        });
      }

      // Parse JSON fields
      const parseJSON = (str: string | null | undefined, defaultValue: any = null) => {
        if (!str) return defaultValue;
        try {
          return JSON.parse(str);
        } catch {
          return defaultValue;
        }
      };

      const itineraryDetailed = parseJSON(tour.itineraryDetailed, []);
      const highlights = parseJSON(tour.highlights, []);
      const includes = parseJSON(tour.includes, []);
      const excludes = parseJSON(tour.excludes, []);
      const noticeDetailed = parseJSON(tour.noticeDetailed, []);
      const colorTheme = parseJSON(tour.colorTheme, null);

      // Prepare PDF data
      const pdfGenerator = await import('../pdfGenerator');

      const pdfData: any = {
        id: tour.id,
        title: tour.title,
        subtitle: tour.heroSubtitle || undefined,
        days: tour.duration,
        destinations: [
          tour.destinationCountry,
          ...(tour.destinationCity ? tour.destinationCity.split(',').map(c => c.trim()) : []),
        ].filter(Boolean),
        price: tour.price || undefined,
        currency: 'NT$',
        heroImage: tour.heroImage || undefined,
        description: tour.description || undefined,
        highlights: highlights.length > 0 ? highlights : undefined,
        itinerary: itineraryDetailed.length > 0 ? itineraryDetailed.map((day: any) => ({
          day: day.day,
          title: day.title,
          subtitle: day.subtitle,
          activities: day.activities || [],
          meals: day.meals || {},
          accommodation: day.accommodation,
        })) : undefined,
        inclusions: includes.length > 0 ? includes : undefined,
        exclusions: excludes.length > 0 ? excludes : undefined,
        notes: noticeDetailed.length > 0 ? noticeDetailed : undefined,
        colorTheme: colorTheme || undefined,
      };

      // Generate and upload PDF
      const storageKey = `tours/${tour.id}/itinerary_${Date.now()}.pdf`;
      const pdfUrl = await pdfGenerator.generateAndUploadTourPdf(pdfData, storageKey);

      console.log(`[GeneratePDF] PDF generated successfully: ${pdfUrl}`);

      return {
        success: true,
        url: pdfUrl,
        message: "PDF 已成功生成",
      };
    }),

  // Get similar tours (public)
  getSimilar: publicProcedure
    .input(z.object({
      tourId: z.number(),
      limit: z.number().optional().default(4),
    }))
    .query(async ({ input }) => {
      const allTours = await db.getAllTours({ status: 'active' });
      const currentTour = (allTours as any[]).find((t: any) => t.id === input.tourId);
      if (!currentTour) return [];
      const scored = (allTours as any[])
        .filter((t: any) => t.id !== input.tourId)
        .map((t: any) => {
          let score = 0;
          if (t.destinationCountry === currentTour.destinationCountry) score += 3;
          if (t.category === currentTour.category) score += 2;
          const priceDiff = Math.abs(t.price - currentTour.price) / (currentTour.price || 1);
          if (priceDiff < 0.2) score += 2;
          else if (priceDiff < 0.5) score += 1;
          const durationDiff = Math.abs(t.duration - currentTour.duration);
          if (durationDiff <= 1) score += 1;
          if (t.featured) score += 0.5;
          return { ...t, _score: score };
        })
        .sort((a: any, b: any) => b._score - a._score)
        .slice(0, input.limit);
      return scored;
    }),

  // Get personalized recommendations based on browsing history
  getRecommended: publicProcedure
    .input(z.object({
      limit: z.number().optional().default(6),
      userId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const allTours = await db.getAllTours({ status: 'active', featured: true });
      if (!input.userId) return (allTours as any[]).slice(0, input.limit);
      const history = await db.getUserBrowsingHistory(input.userId, 10);
      if (!history || (history as any[]).length === 0) return (allTours as any[]).slice(0, input.limit);
      const viewedIds = new Set((history as any[]).map((h: any) => h.tourId));
      const countryCounts: Record<string, number> = {};
      const categoryCounts: Record<string, number> = {};
      (history as any[]).forEach((h: any) => {
        if (h.tour?.destinationCountry) countryCounts[h.tour.destinationCountry] = (countryCounts[h.tour.destinationCountry] || 0) + 1;
        if (h.tour?.category) categoryCounts[h.tour.category] = (categoryCounts[h.tour.category] || 0) + 1;
      });
      const topCountry = Object.entries(countryCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      const scored = (allTours as any[])
        .filter((t: any) => !viewedIds.has(t.id))
        .map((t: any) => {
          let score = 0;
          if (topCountry && t.destinationCountry === topCountry) score += 3;
          if (topCategory && t.category === topCategory) score += 2;
          if (t.featured) score += 1;
          return { ...t, _score: score };
        })
        .sort((a: any, b: any) => b._score - a._score)
        .slice(0, input.limit);
      return scored.length > 0 ? scored : (allTours as any[]).slice(0, input.limit);
    }),

  /**
   * Get supplier deep-sync detail for a tour. 2026-05-24 (M6 of supplier
   * deep sync).
   *
   * Resolves the tour → supplierProduct via sourceUrl pattern matching
   * (Lion: ?NormGroupID=xxx, UV: /product/detail/xxx), then returns the
   * supplierProductDetails row with each detail kind's parsed JSON
   * pre-deserialized.
   *
   * Returns null if tour has no linked supplier product or no detail
   * row yet (backfill not yet processed it).
   */
  getSupplierDetail: publicProcedure
    .input(z.object({ tourId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const drizzleDb = await getDb();
      if (!drizzleDb) return null;

      // Look up the tour's sourceUrl
      const [tour] = await drizzleDb
        .select({ sourceUrl: toursTable.sourceUrl })
        .from(toursTable)
        .where(eq(toursTable.id, input.tourId))
        .limit(1);
      if (!tour?.sourceUrl) return null;

      // Extract external product code from sourceUrl
      const lionMatch = tour.sourceUrl.match(/[?&]NormGroupID=([^&]+)/);
      const uvMatch = tour.sourceUrl.match(/\/product\/detail\/([^/?#]+)/);
      const externalCode = lionMatch?.[1] || uvMatch?.[1];
      if (!externalCode) return null;

      // Find the supplierProduct row
      const [product] = await drizzleDb
        .select({ id: supplierProducts.id })
        .from(supplierProducts)
        .where(eq(supplierProducts.externalProductCode, externalCode))
        .limit(1);
      if (!product) return null;

      // Fetch the detail row
      const [detail] = await drizzleDb
        .select()
        .from(supplierProductDetails)
        .where(eq(supplierProductDetails.supplierProductId, product.id))
        .limit(1);
      if (!detail) return null;

      // Pre-deserialize parsed JSON so client doesn't have to
      const tryParse = <T,>(s: string | null): T | null => {
        if (!s) return null;
        try {
          return JSON.parse(s) as T;
        } catch {
          return null;
        }
      };

      return {
        itinerary: {
          status: detail.itineraryParseStatus,
          parsed: tryParse<NormalizedItinerary>(detail.itineraryParsed),
          fetchedAt: detail.itineraryFetchedAt,
        },
        priceTerms: {
          status: detail.priceTermsParseStatus,
          parsed: tryParse<NormalizedPriceTerms>(detail.priceTermsParsed),
          fetchedAt: detail.priceTermsFetchedAt,
        },
        notices: {
          status: detail.noticesParseStatus,
          parsed: tryParse<NormalizedNotices>(detail.noticesParsed),
          fetchedAt: detail.noticesFetchedAt,
        },
        optional: {
          status: detail.optionalParseStatus,
          parsed: tryParse<NormalizedOptional>(detail.optionalParsed),
          fetchedAt: detail.optionalFetchedAt,
        },
        tourInfo: {
          status: detail.tourInfoParseStatus,
          parsed: tryParse<NormalizedTourInfo>(detail.tourInfoParsed),
          fetchedAt: detail.tourInfoFetchedAt,
        },
        lastEnrichedAt: detail.lastEnrichedAt,
        schemaVersion: detail.schemaVersion,
      };
    }),
});
