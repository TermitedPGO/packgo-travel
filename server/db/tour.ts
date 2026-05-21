// server/db/tour.ts — extracted from server/db.ts in v2 Wave 2 Module 2.2 (D2 locked split).
//
// Owns: tours CRUD + tourDepartures CRUD (incl. money-path slot reserve/release)
// + calibration state-machine + tour-side filter/search helpers (searchTours,
// getFilterOptions, getDepartureCities).
//
// Booking + payment CRUD live in db/booking.ts (Module 2.1). Tour-price-comparison
// + image-library helpers stay in db.ts until Module 2.6 (search). Destinations
// stay in db.ts per v2-plan.md line 153.
//
// Re-exported from server/db.ts via `export * from "./db/tour"` so all existing
// callers (sub-routers, autonomous agents, services) continue importing from
// "../db" unchanged.

import { eq, and, gte, lte, desc, inArray, like, or, sql } from "drizzle-orm";
import {
  tours, InsertTour, Tour,
  tourDepartures, InsertTourDeparture, TourDeparture,
  bookings,
  calibrationResults, CalibrationResult, InsertCalibrationResult,
} from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";

// ============================================
// Tour Management Functions
// ============================================

/**
 * Get all tours with optional filtering
 */
export async function getAllTours(filters?: {
  category?: string;
  status?: string;
  featured?: boolean;
  search?: string;
  country?: string;
  minDays?: number;
  maxDays?: number;
  maxPrice?: number;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get tours: database not available");
    return [];
  }

  const conditions = [];

  // Status filter
  if (filters?.status && filters.status !== 'all') {
    conditions.push(eq(tours.status, filters.status as 'active' | 'inactive' | 'soldout'));
  }

  // Featured filter (schema stores as int 0/1)
  if (filters?.featured !== undefined) {
    conditions.push(eq(tours.featured, filters.featured ? 1 : 0));
  }

  // Full-text search (title, destination country, destination city)
  if (filters?.search && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        like(tours.title, searchTerm),
        like(tours.destinationCountry, searchTerm),
        like(tours.destinationCity, searchTerm),
      )
    );
  }

  // Country filter
  if (filters?.country && filters.country !== 'all') {
    conditions.push(eq(tours.destinationCountry, filters.country));
  }

  // Duration range filter
  if (filters?.minDays !== undefined) {
    conditions.push(gte(tours.duration, filters.minDays));
  }
  if (filters?.maxDays !== undefined) {
    conditions.push(lte(tours.duration, filters.maxDays));
  }

  // Max price filter
  if (filters?.maxPrice !== undefined) {
    conditions.push(lte(tours.price, filters.maxPrice));
  }

  const query = db.select().from(tours);
  if (conditions.length > 0) {
    query.where(and(...conditions));
  }
  query.orderBy(desc(tours.createdAt));

  // Pagination
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 100;
  const offset = (page - 1) * pageSize;
  query.limit(pageSize).offset(offset);

  const result = await query;
  return result;
}

/**
 * Get a single tour by ID
 */
export async function getTourById(id: number): Promise<Tour | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get tour: database not available");
    return undefined;
  }

  const result = await db.select().from(tours).where(eq(tours.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new tour
 */
export async function createTour(tour: InsertTour): Promise<Tour> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(tours).values(tour);
  const insertId = Number(result[0].insertId);

  const newTour = await getTourById(insertId);
  if (!newTour) {
    throw new Error("Failed to retrieve created tour");
  }

  return newTour;
}

/**
 * Update an existing tour.
 *
 * v75 (optional optimistic locking): if `expectedUpdatedAt` is passed, the
 * UPDATE only succeeds when the row's current updatedAt matches — preventing
 * the "two admins edit same tour, last writer wins silently" race. Callers
 * that pass it can detect a conflict and prompt the user to refresh + retry.
 *
 * Backwards compatible: callers that don't pass `expectedUpdatedAt` get the
 * old last-writer-wins behavior.
 */
export class TourUpdateConflictError extends Error {
  constructor(public id: number) {
    super(`Tour ${id} was modified by another admin since you loaded it`);
    this.name = "TourUpdateConflictError";
  }
}

export async function updateTour(
  id: number,
  updates: Partial<InsertTour>,
  expectedUpdatedAt?: Date | string
): Promise<Tour> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // v75: dailyItinerary and itineraryDetailed hold the same payload (legacy
  // dual-write from when the schema was migrated). If a caller updates only
  // one, the other becomes stale and search/listing pages may show old data.
  // Auto-mirror so writes to either field always update both.
  if (updates.itineraryDetailed !== undefined && updates.dailyItinerary === undefined) {
    updates = { ...updates, dailyItinerary: updates.itineraryDetailed };
  } else if (updates.dailyItinerary !== undefined && updates.itineraryDetailed === undefined) {
    updates = { ...updates, itineraryDetailed: updates.dailyItinerary };
  }

  if (expectedUpdatedAt) {
    // Use a guarded UPDATE: only matches the row when updatedAt equals the
    // version the caller saw. If another admin wrote between read and update,
    // the WHERE doesn't match and affectedRows = 0.
    const expected = expectedUpdatedAt instanceof Date
      ? expectedUpdatedAt
      : new Date(expectedUpdatedAt);
    const result = await db
      .update(tours)
      .set(updates)
      .where(and(eq(tours.id, id), eq(tours.updatedAt, expected)));
    const affected = (result as any)?.[0]?.affectedRows ?? 0;
    if (affected === 0) {
      // Either the tour vanished, or another admin updated it. Distinguish:
      const exists = await getTourById(id);
      if (!exists) throw new Error(`Tour ${id} not found`);
      throw new TourUpdateConflictError(id);
    }
  } else {
    await db.update(tours).set(updates).where(eq(tours.id, id));
  }

  const updatedTour = await getTourById(id);
  if (!updatedTour) {
    throw new Error("Failed to retrieve updated tour");
  }

  return updatedTour;
}

/**
 * Delete a tour. Refuses deletion if there are pending or confirmed
 * bookings still attached (would orphan a customer's record). Best-
 * effort S3 cleanup of hero / gallery / AI map images after the row
 * is gone — failures only warn.
 *
 * QA audit 2026-05-11 Phase 8 found the old version was a plain
 * `delete(tours)` with no booking check and no S3 cleanup, which
 * silently orphaned customer bookings + left 5-50 R2 objects per
 * deleted tour burning storage.
 */
export async function deleteTour(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // 1. Refuse if any non-terminal booking exists.
  const [{ activeCount }] = await db
    .select({
      activeCount: sql<number>`COUNT(*)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tourId, id),
        sql`${bookings.bookingStatus} IN ('pending', 'confirmed')`
      )
    );
  const n = Number(activeCount ?? 0);
  if (n > 0) {
    throw new Error(
      `Cannot delete tour ${id}: ${n} pending/confirmed booking(s) still attached. Archive the tour instead, or cancel/complete the bookings first.`
    );
  }

  // 2. Collect S3 keys to clean up AFTER the row is gone (so a failed
  //    delete doesn't leave the DB referencing keys we already nuked).
  const [tour] = await db.select().from(tours).where(eq(tours.id, id)).limit(1);
  const keysToDelete: string[] = [];
  if (tour) {
    if (tour.imageUrl) keysToDelete.push(tour.imageUrl);
    if ((tour as any).heroImage) keysToDelete.push((tour as any).heroImage);
    if ((tour as any).aiMapUrl) keysToDelete.push((tour as any).aiMapUrl);
    const galleryRaw = (tour as any).galleryImages;
    if (galleryRaw && typeof galleryRaw === "string") {
      try {
        const parsed = JSON.parse(galleryRaw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string") keysToDelete.push(item);
            else if (item && typeof item === "object" && typeof item.url === "string") {
              keysToDelete.push(item.url);
            }
          }
        }
      } catch {
        /* malformed JSON — leave the gallery images as orphans rather than crash */
      }
    }
  }

  // 3. Nuke the row.
  await db.delete(tours).where(eq(tours.id, id));

  // 4. Best-effort R2 cleanup. Never throw — the DB row is already gone
  //    and the caller has succeeded; orphan keys are a follow-up concern.
  if (keysToDelete.length > 0) {
    try {
      const { storageDeleteMany } = await import("../storage");
      const result = await storageDeleteMany(keysToDelete);
      console.log(
        `[deleteTour] Cleaned ${result.deleted}/${keysToDelete.length} R2 objects for tour ${id} (${result.failed} failed)`
      );
    } catch (err) {
      console.warn(`[deleteTour] R2 cleanup error for tour ${id}:`, err);
    }
  }
}

/**
 * Batch delete multiple tours. Delegates to deleteTour() per id so each
 * tour gets the active-booking check + R2 cleanup. Returns counts of
 * deleted vs skipped (tours with pending/confirmed bookings can't be
 * batch-deleted; admin must archive or cancel them first).
 *
 * QA audit 2026-05-11 Phase 8: previously this was a single bulk DELETE
 * with no protection — could orphan customer bookings + leak S3 keys
 * for every tour in the batch.
 */
export async function batchDeleteTours(ids: number[]): Promise<{ deleted: number; skipped: { id: number; reason: string }[] }> {
  if (ids.length === 0) return { deleted: 0, skipped: [] };

  let deleted = 0;
  const skipped: { id: number; reason: string }[] = [];
  for (const id of ids) {
    try {
      await deleteTour(id);
      deleted++;
    } catch (err: any) {
      skipped.push({ id, reason: err?.message ?? "unknown error" });
    }
  }
  return { deleted, skipped };
}

// ============================================
// Tour Departure Management Functions
// ============================================

/**
 * Get all departures for a specific tour
 */
export async function getTourDepartures(tourId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get departures: database not available");
    return [];
  }

  const result = await db.select().from(tourDepartures).where(eq(tourDepartures.tourId, tourId));
  return result;
}

/**
 * Get a single departure by ID
 */
export async function getDepartureById(id: number): Promise<TourDeparture | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get departure: database not available");
    return undefined;
  }

  const result = await db.select().from(tourDepartures).where(eq(tourDepartures.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * v74: Atomically reserve N slots on a departure.
 *
 * Returns `{ reserved: true }` if the increment succeeded, or
 *         `{ reserved: false, available: <currentFree> }` if there isn't enough capacity.
 *
 * The guarded UPDATE is the critical piece: by including the capacity check in
 * the WHERE clause, MySQL enforces atomicity at the row level — two concurrent
 * callers cannot both increment past `totalSlots`. Whichever query reaches the
 * row first wins; the other sees `affectedRows = 0`.
 *
 * Without this, the previous code path simply created bookings without ever
 * touching `bookedSlots`, allowing unlimited overbooking on the last seat.
 */
export async function tryReserveDepartureSlots(
  departureId: number,
  count: number
): Promise<{ reserved: boolean; available: number }> {
  const db = await getDb();
  if (!db) return { reserved: false, available: 0 };

  // Drizzle MySQL: use sql template for the conditional increment
  const result = await db.execute(sql`
    UPDATE tourDepartures
    SET bookedSlots = bookedSlots + ${count},
        updatedAt = NOW()
    WHERE id = ${departureId}
      AND status NOT IN ('cancelled', 'full')
      AND (bookedSlots + ${count}) <= totalSlots
  `);
  // mysql2 returns OkPacket with affectedRows
  const affected = (result as any)?.[0]?.affectedRows ?? 0;
  if (affected > 0) {
    // If we just hit exactly totalSlots, also flip status to 'full'
    await db.execute(sql`
      UPDATE tourDepartures
      SET status = 'full'
      WHERE id = ${departureId}
        AND bookedSlots >= totalSlots
        AND status = 'open'
    `).catch(() => {});
    return { reserved: true, available: 0 };
  }
  // Reservation failed — fetch current capacity for a useful error message
  const dep = await getDepartureById(departureId);
  const free = dep ? Math.max(0, dep.totalSlots - dep.bookedSlots) : 0;
  return { reserved: false, available: free };
}

/**
 * v74: Release reserved slots (called when booking creation fails after we
 * already incremented, or when a confirmed booking is cancelled).
 *
 * Uses GREATEST to prevent bookedSlots going negative if called too many times.
 * Also flips status back from 'full' to 'open' if capacity is freed.
 */
export async function releaseDepartureSlots(
  departureId: number,
  count: number,
  tx?: DrizzleTx
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const writer = tx ?? db;
  await writer.execute(sql`
    UPDATE tourDepartures
    SET bookedSlots = GREATEST(0, bookedSlots - ${count}),
        status = CASE WHEN status = 'full' AND (bookedSlots - ${count}) < totalSlots THEN 'open' ELSE status END,
        updatedAt = NOW()
    WHERE id = ${departureId}
  `);
}

/**
 * Create a new departure
 */
export async function createDeparture(departure: InsertTourDeparture): Promise<TourDeparture> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(tourDepartures).values(departure);
  const insertId = Number(result[0].insertId);

  const newDeparture = await getDepartureById(insertId);
  if (!newDeparture) {
    throw new Error("Failed to retrieve created departure");
  }

  return newDeparture;
}

/**
 * Update an existing departure
 */
export async function updateDeparture(id: number, updates: Partial<InsertTourDeparture>): Promise<TourDeparture> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(tourDepartures).set(updates).where(eq(tourDepartures.id, id));

  const updatedDeparture = await getDepartureById(id);
  if (!updatedDeparture) {
    throw new Error("Failed to retrieve updated departure");
  }

  return updatedDeparture;
}

/**
 * Delete a departure
 */
export async function deleteDeparture(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(tourDepartures).where(eq(tourDepartures.id, id));
}

// ============================================
// Tour Search + Filter Functions
// ============================================

// Search tours with filters
export async function searchTours(filters: {
  destination?: string;
  category?: string;
  minDays?: number;
  maxDays?: number;
  minPrice?: number;
  maxPrice?: number;
  airlines?: string[];
  hotelGrades?: string[];
  specialActivities?: string[];
  tags?: string[];
  sortBy?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tours: Tour[]; total: number }> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Build filter conditions
  const conditions = [eq(tours.status, "active")];

  if (filters.category && filters.category !== 'all') {
    conditions.push(eq(tours.category, filters.category as 'group' | 'custom' | 'package' | 'cruise' | 'theme'));
  }

  if (filters.destination) {
    // 使用模糊匹配，支援在 destination, destinationCountry, destinationCity 中搜尋
    const searchPattern = `%${filters.destination}%`;
    const destinationCondition = or(
      like(tours.destination, searchPattern),
      like(tours.destinationCountry, searchPattern),
      like(tours.destinationCity, searchPattern),
      like(tours.title, searchPattern)
    );
    if (destinationCondition) {
      conditions.push(destinationCondition);
    }
  }

  if (filters.minDays !== undefined) {
    conditions.push(gte(tours.duration, filters.minDays));
  }

  if (filters.maxDays !== undefined) {
    conditions.push(lte(tours.duration, filters.maxDays));
  }

  if (filters.minPrice !== undefined) {
    conditions.push(gte(tours.price, filters.minPrice));
  }

  if (filters.maxPrice !== undefined) {
    conditions.push(lte(tours.price, filters.maxPrice));
  }

  if (filters.airlines && filters.airlines.length > 0) {
    conditions.push(inArray(tours.airline, filters.airlines));
  }

  if (filters.hotelGrades && filters.hotelGrades.length > 0) {
    conditions.push(inArray(tours.hotelGrade, filters.hotelGrades));
  }

  const whereClause = and(...conditions);

  // Note: specialActivities and tags are JSON fields — must filter in-memory.
  // If these filters are active, we cannot use DB-level pagination directly;
  // we fall back to fetching all matching rows and paginating in memory.
  const needsInMemoryFilter =
    (filters.specialActivities && filters.specialActivities.length > 0) ||
    (filters.tags && filters.tags.length > 0);

  if (needsInMemoryFilter) {
    // Fetch all rows matching DB-level conditions, then filter in memory
    let query = db.select().from(tours).where(whereClause).$dynamic();

    let results: Tour[];
    if (filters.sortBy === "price_asc") {
      results = await query.orderBy(tours.price);
    } else if (filters.sortBy === "price_desc") {
      results = await query.orderBy(desc(tours.price));
    } else if (filters.sortBy === "days_asc") {
      results = await query.orderBy(tours.duration);
    } else if (filters.sortBy === "days_desc") {
      results = await query.orderBy(desc(tours.duration));
    } else {
      results = await query.orderBy(desc(tours.featured), desc(tours.createdAt));
    }

    // In-memory filter for specialActivities
    if (filters.specialActivities && filters.specialActivities.length > 0) {
      results = results.filter(tour => {
        if (!tour.specialActivities) return false;
        try {
          const activities = JSON.parse(tour.specialActivities);
          if (!Array.isArray(activities)) return false;
          return filters.specialActivities!.some(activity => activities.includes(activity));
        } catch {
          return false;
        }
      });
    }

    // In-memory filter for tags
    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(tour => {
        if (!tour.tags) return false;
        try {
          const tourTags = typeof tour.tags === 'string' ? JSON.parse(tour.tags) : tour.tags;
          if (!Array.isArray(tourTags)) return false;
          return filters.tags!.some(tag => tourTags.includes(tag));
        } catch {
          return false;
        }
      });
    }

    const total = results.length;
    const limit = filters.limit ?? 12;
    const offset = filters.offset ?? 0;
    return { tours: results.slice(offset, offset + limit), total };
  }

  // --- Fast path: pure DB-level pagination (no JSON field filters) ---
  // Run count query and data query in parallel
  const [countResult, dataResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(tours).where(whereClause),
    (() => {
      let q = db.select().from(tours).where(whereClause).$dynamic();
      if (filters.sortBy === "price_asc") {
        q = q.orderBy(tours.price);
      } else if (filters.sortBy === "price_desc") {
        q = q.orderBy(desc(tours.price));
      } else if (filters.sortBy === "days_asc") {
        q = q.orderBy(tours.duration);
      } else if (filters.sortBy === "days_desc") {
        q = q.orderBy(desc(tours.duration));
      } else {
        q = q.orderBy(desc(tours.featured), desc(tours.createdAt));
      }
      const limit = filters.limit ?? 12;
      const offset = filters.offset ?? 0;
      return q.limit(limit).offset(offset);
    })()
  ]);

  const total = Number(countResult[0]?.count ?? 0);
  return { tours: dataResult, total };
}

// ============================================
// Filter Options Functions (Smart Filters)
// ============================================

/**
 * 獲取智能篩選選項 - 根據現有行程自動生成
 */
export async function getFilterOptions(): Promise<{
  destinations: { country: string; count: number }[];
  tags: { tag: string; count: number }[];
  smartTags: {
    duration: { label: string; count: number }[];
    price: { label: string; count: number }[];
    transport: { label: string; count: number }[];
    feature: { label: string; count: number }[];
  };
  durationRange: { min: number; max: number };
  priceRange: { min: number; max: number };
}> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // 獲取所有有效行程
  const allTours = await db
    .select()
    .from(tours)
    .where(eq(tours.status, "active"));

  // 1. 統計目的地國家
  const destinationMap = new Map<string, number>();
  allTours.forEach(tour => {
    const country = tour.destinationCountry || tour.destination;
    if (country) {
      destinationMap.set(country, (destinationMap.get(country) || 0) + 1);
    }
  });
  const destinations = Array.from(destinationMap.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  // 2. 統計標籤
  const tagMap = new Map<string, number>();
  allTours.forEach(tour => {
    if (tour.tags) {
      try {
        const parsedTags = typeof tour.tags === 'string' ? JSON.parse(tour.tags) : tour.tags;
        if (Array.isArray(parsedTags)) {
          parsedTags.forEach((tag: string) => {
            tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
          });
        }
      } catch {
        // 忽略解析錯誤
      }
    }
  });
  const tags = Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  // 3. 計算天數範圍
  const durations = allTours.map(t => t.duration).filter(d => d && d > 0);
  const durationRange = {
    min: durations.length > 0 ? Math.min(...durations) : 1,
    max: durations.length > 0 ? Math.max(...durations) : 30,
  };

  // 4. 計算價格範圍
  const prices = allTours.map(t => t.price).filter(p => p && p > 0);
  const priceRange = {
    min: prices.length > 0 ? Math.min(...prices) : 0,
    max: prices.length > 0 ? Math.max(...prices) : 500000,
  };

  // 5. 智能標籤分類
  const smartTags = {
    duration: [] as { label: string; count: number }[],
    price: [] as { label: string; count: number }[],
    transport: [] as { label: string; count: number }[],
    feature: [] as { label: string; count: number }[],
  };

  // 天數分類
  const durationCounts = { "深度旅遊": 0, "經典行程": 0, "輕旅行": 0, "一般行程": 0 };
  allTours.forEach(tour => {
    if (tour.duration >= 10) durationCounts["深度旅遊"]++;
    else if (tour.duration >= 7) durationCounts["經典行程"]++;
    else if (tour.duration <= 4) durationCounts["輕旅行"]++;
    else durationCounts["一般行程"]++;
  });
  Object.entries(durationCounts).forEach(([label, count]) => {
    if (count > 0) smartTags.duration.push({ label, count });
  });

  // 價格分類
  const priceCounts = { "精緻行程": 0, "超值優惠": 0 };
  allTours.forEach(tour => {
    if (tour.price && tour.price >= 80000) priceCounts["精緻行程"]++;
    else if (tour.price && tour.price < 30000) priceCounts["超值優惠"]++;
  });
  Object.entries(priceCounts).forEach(([label, count]) => {
    if (count > 0) smartTags.price.push({ label, count });
  });

  // 交通方式分類
  const transportCounts = { "航空": 0, "鐵道": 0, "郵輪": 0, "巴士": 0 };
  allTours.forEach(tour => {
    const combinedText = `${tour.title || ''} ${tour.description || ''} ${tour.category || ''}`.toLowerCase();
    if (tour.outboundAirline || combinedText.includes('航空') || combinedText.includes('飛機')) transportCounts["航空"]++;
    if (combinedText.includes('高鐵') || combinedText.includes('火車') || combinedText.includes('列車')) transportCounts["鐵道"]++;
    if (tour.category === 'cruise' || combinedText.includes('郵輪') || combinedText.includes('遊輪')) transportCounts["郵輪"]++;
    if (combinedText.includes('巴士') || combinedText.includes('遊覽車')) transportCounts["巴士"]++;
  });
  Object.entries(transportCounts).forEach(([label, count]) => {
    if (count > 0) smartTags.transport.push({ label, count });
  });

  // 特色活動分類
  const featureCounts = { "美食之旅": 0, "攝影之旅": 0, "團體旅遊": 0, "永續旅遊": 0, "溫泉": 0 };
  allTours.forEach(tour => {
    const combinedText = `${tour.title || ''} ${tour.description || ''}`.toLowerCase();
    if (combinedText.includes('美食') || combinedText.includes('料理') || combinedText.includes('餐廳')) featureCounts["美食之旅"]++;
    if (combinedText.includes('攝影') || combinedText.includes('拍照') || combinedText.includes('打卡')) featureCounts["攝影之旅"]++;
    if (tour.category === 'group' || combinedText.includes('團體')) featureCounts["團體旅遊"]++;
    if (combinedText.includes('esg') || combinedText.includes('永續')) featureCounts["永續旅遊"]++;
    if (combinedText.includes('溫泉')) featureCounts["溫泉"]++;
  });
  Object.entries(featureCounts).forEach(([label, count]) => {
    if (count > 0) smartTags.feature.push({ label, count });
  });

  return {
    destinations,
    tags,
    smartTags,
    durationRange,
    priceRange,
  };
}

// Get distinct departure cities from active tours (for search autocomplete)
export async function getDepartureCities(): Promise<{ city: string; country: string; count: number }[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const activeTours = await db
    .select({
      departureCity: tours.departureCity,
      departureCountry: tours.departureCountry,
    })
    .from(tours)
    .where(eq(tours.status, "active"));

  // Count occurrences per city
  const cityMap = new Map<string, { city: string; country: string; count: number }>();
  for (const tour of activeTours) {
    const city = (tour.departureCity || "").trim();
    const country = (tour.departureCountry || "").trim();
    // Skip empty, "NULL" string, or whitespace-only values
    if (!city || city.toUpperCase() === "NULL") continue;
    const key = `${city}|${country}`;
    if (cityMap.has(key)) {
      cityMap.get(key)!.count++;
    } else {
      cityMap.set(key, { city, country, count: 1 });
    }
  }

  return Array.from(cityMap.values()).sort((a, b) => b.count - a.count);
}

// ============================================
// Calibration Result Functions
// ============================================

/**
 * Save a calibration result for a tour.
 */
export async function saveCalibrationResult(
  data: InsertCalibrationResult
): Promise<CalibrationResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(calibrationResults).values(data);
  // Fetch the just-inserted row
  const rows = await db
    .select()
    .from(calibrationResults)
    .where(eq(calibrationResults.tourId, data.tourId))
    .orderBy(desc(calibrationResults.createdAt))
    .limit(1);
  return rows[0];
}

/**
 * Get the latest calibration result for a tour.
 */
export async function getCalibrationResultByTourId(
  tourId: number
): Promise<CalibrationResult | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(calibrationResults)
    .where(eq(calibrationResults.tourId, tourId))
    .orderBy(desc(calibrationResults.createdAt))
    .limit(1);
  return rows[0];
}

/**
 * Get tours with status = 'pending_review', joined with their latest calibration result.
 */
export async function getPendingReviewTours(): Promise<
  Array<Tour & { calibration: CalibrationResult | null }>
> {
  const db = await getDb();
  if (!db) return [];

  const pendingTours = await db
    .select()
    .from(tours)
    .where(eq(tours.status, 'pending_review' as any))
    .orderBy(desc(tours.updatedAt));

  const results = await Promise.all(
    pendingTours.map(async (tour) => {
      const calibration = await getCalibrationResultByTourId(tour.id);
      return { ...tour, calibration: calibration ?? null };
    })
  );
  return results;
}

/**
 * Approve a tour: set status to 'active'.
 */
export async function approveTour(tourId: number): Promise<Tour> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(tours)
    .set({ status: 'active' as any, updatedAt: new Date() })
    .where(eq(tours.id, tourId));

  const rows = await db.select().from(tours).where(eq(tours.id, tourId)).limit(1);
  if (!rows[0]) throw new Error(`Tour ${tourId} not found`);
  return rows[0];
}

/**
 * Reject a tour: set status to 'inactive'.
 */
export async function rejectTour(tourId: number): Promise<Tour> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(tours)
    .set({ status: 'inactive' as any, updatedAt: new Date() })
    .where(eq(tours.id, tourId));

  const rows = await db.select().from(tours).where(eq(tours.id, tourId)).limit(1);
  if (!rows[0]) throw new Error(`Tour ${tourId} not found`);
  return rows[0];
}
