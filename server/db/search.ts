// server/db/search.ts — extracted from server/db.ts in v2 Wave 2 Module 2.6
// (D2-locked 7-file split, sixth sub-task).
//
// Owns: search-tier discovery + content-presentation helpers.
//   • imageLibrary (CRUD + tag/tour search + Vision pipeline updates)
//   • homepageContent (admin-editable sections)
//   • destinations (homepage destination cards)
//   • competitor monitoring (tours / departures / price history / alerts)
//   • tour price comparisons (Lion Travel vs PACK&GO side-by-side)
//
// Out of scope (intentionally stays in db.ts residual until Module 2.7):
//   • marketingCampaigns / marketingMaterials / emailSendLogs — tied to
//     marketing automation, will land in db/accounting.ts (per v2-plan
//     Module 2.7) since marketing spend rolls into accounting.
//   • visaApplications + visaStatusHistory — own domain.
//   • affiliateClicks — own domain.
//   • newsletter subscribers + inquiries — own domain.
//
// Re-exported from server/db.ts via `export * from "./db/search"` so all
// existing callers (sub-routers, autonomous agents, services) keep
// importing from "../db" unchanged.

import { eq, and, desc, lte, like, or, sql } from "drizzle-orm";
import {
  imageLibrary, InsertImageLibraryItem, ImageLibraryItem,
  homepageContent, HomepageContent,
  destinations, Destination, InsertDestination,
  competitorTours, CompetitorTour, InsertCompetitorTour,
  competitorDepartures,
  competitorPriceHistory,
  competitorAlerts,
  tourPriceComparisons, TourPriceComparison, InsertTourPriceComparison,
} from "../../drizzle/schema";
import { getDb } from "../db";

// ============================================================
// Image Library Functions
// ============================================================

/**
 * Get all images from the library with optional filters
 */
export async function getImageLibrary(options: {
  userId?: number;
  tourId?: number;
  limit?: number;
  offset?: number;
  search?: string;
} = {}): Promise<ImageLibraryItem[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get image library: database not available");
    return [];
  }

  try {
    let query = db.select().from(imageLibrary);
    const conditions = [];

    if (options.userId) {
      conditions.push(eq(imageLibrary.uploadedBy, options.userId));
    }
    if (options.tourId) {
      conditions.push(eq(imageLibrary.tourId, options.tourId));
    }
    if (options.search) {
      conditions.push(
        or(
          like(imageLibrary.filename, `%${options.search}%`),
          like(imageLibrary.tags, `%${options.search}%`)
        )
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    query = query.orderBy(desc(imageLibrary.createdAt)) as typeof query;

    if (options.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    return await query;
  } catch (error) {
    console.error("[Database] Failed to get image library:", error);
    return [];
  }
}

/**
 * Add an image to the library
 */
export async function addImageToLibrary(image: InsertImageLibraryItem): Promise<ImageLibraryItem | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot add image to library: database not available");
    return null;
  }

  try {
    const result = await db.insert(imageLibrary).values(image);
    const insertId = result[0].insertId;

    // Fetch and return the inserted image
    const [inserted] = await db.select().from(imageLibrary).where(eq(imageLibrary.id, insertId));
    return inserted || null;
  } catch (error) {
    console.error("[Database] Failed to add image to library:", error);
    return null;
  }
}

/**
 * Delete an image from the library
 */
export async function deleteImageFromLibrary(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete image from library: database not available");
    return false;
  }

  try {
    // Only allow deletion if user owns the image or is admin
    const [image] = await db.select().from(imageLibrary).where(eq(imageLibrary.id, id));
    if (!image) {
      return false;
    }

    await db.delete(imageLibrary).where(eq(imageLibrary.id, id));
    return true;
  } catch (error) {
    console.error("[Database] Failed to delete image from library:", error);
    return false;
  }
}

/**
 * Update image usage count
 */
export async function incrementImageUsage(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update image usage: database not available");
    return;
  }

  try {
    await db.update(imageLibrary)
      .set({ usageCount: sql`${imageLibrary.usageCount} + 1` })
      .where(eq(imageLibrary.id, id));
  } catch (error) {
    console.error("[Database] Failed to update image usage:", error);
  }
}

/**
 * Get image by ID
 */
export async function getImageById(id: number): Promise<ImageLibraryItem | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get image: database not available");
    return null;
  }

  try {
    const [image] = await db.select().from(imageLibrary).where(eq(imageLibrary.id, id));
    return image || null;
  } catch (error) {
    console.error("[Database] Failed to get image:", error);
    return null;
  }
}

// ============================================================
// imageLibrary convenience aliases (used by masterAgent pipeline)
// ============================================================

/**
 * Alias for addImageToLibrary – used by masterAgent image pipeline.
 */
export const addToImageLibrary = addImageToLibrary;

/**
 * Search imageLibrary by a text query (matches filename or tags).
 */
export async function searchImageLibrary(
  query: string,
  limit = 10
): Promise<ImageLibraryItem[]> {
  return getImageLibrary({ search: query, limit });
}

/**
 * Get all images associated with a specific tour.
 */
export async function getImagesByTourId(tourId: number): Promise<ImageLibraryItem[]> {
  return getImageLibrary({ tourId });
}

/**
 * Update imageLibrary item fields (used by Vision analysis pipeline).
 */
export async function updateImageLibraryItem(
  id: number,
  updates: Partial<Pick<ImageLibraryItem, 'tags' | 'visionDescription' | 'contentType' | 'qualityScore' | 'source'>>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(imageLibrary).set(updates).where(eq(imageLibrary.id, id));
}

// ============================================================
// Homepage Content Functions
// ============================================================

/**
 * Get homepage content by section key
 */
export async function getHomepageContent(sectionKey: string): Promise<HomepageContent | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get homepage content: database not available");
    return null;
  }

  try {
    const [content] = await db.select().from(homepageContent).where(eq(homepageContent.sectionKey, sectionKey));
    return content || null;
  } catch (error) {
    console.error("[Database] Failed to get homepage content:", error);
    return null;
  }
}

/**
 * Get all homepage content
 */
export async function getAllHomepageContent(): Promise<HomepageContent[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get homepage content: database not available");
    return [];
  }

  try {
    return await db.select().from(homepageContent);
  } catch (error) {
    console.error("[Database] Failed to get all homepage content:", error);
    return [];
  }
}

/**
 * Update or create homepage content
 */
export async function upsertHomepageContent(sectionKey: string, content: string, updatedBy?: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert homepage content: database not available");
    return false;
  }

  try {
    const existing = await getHomepageContent(sectionKey);
    if (existing) {
      await db.update(homepageContent)
        .set({ content, updatedBy })
        .where(eq(homepageContent.sectionKey, sectionKey));
    } else {
      await db.insert(homepageContent).values({ sectionKey, content, updatedBy });
    }
    return true;
  } catch (error) {
    console.error("[Database] Failed to upsert homepage content:", error);
    return false;
  }
}

// ============================================================
// Destinations Functions
// ============================================================

/**
 * Get all destinations
 */
export async function getAllDestinations(): Promise<Destination[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get destinations: database not available");
    return [];
  }

  try {
    return await db.select().from(destinations).orderBy(destinations.sortOrder);
  } catch (error) {
    console.error("[Database] Failed to get destinations:", error);
    return [];
  }
}

/**
 * Get active destinations for homepage display
 */
export async function getActiveDestinations(): Promise<Destination[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get destinations: database not available");
    return [];
  }

  try {
    return await db.select().from(destinations)
      .where(eq(destinations.isActive, true))
      .orderBy(destinations.sortOrder);
  } catch (error) {
    console.error("[Database] Failed to get active destinations:", error);
    return [];
  }
}

/**
 * Get destination by ID
 */
export async function getDestinationById(id: number): Promise<Destination | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get destination: database not available");
    return null;
  }

  try {
    const [destination] = await db.select().from(destinations).where(eq(destinations.id, id));
    return destination || null;
  } catch (error) {
    console.error("[Database] Failed to get destination:", error);
    return null;
  }
}

/**
 * Create a new destination
 */
export async function createDestination(data: InsertDestination): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create destination: database not available");
    return null;
  }

  try {
    const result = await db.insert(destinations).values(data);
    return result[0].insertId;
  } catch (error) {
    console.error("[Database] Failed to create destination:", error);
    return null;
  }
}

/**
 * Update a destination
 */
export async function updateDestination(id: number, data: Partial<InsertDestination>): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update destination: database not available");
    return false;
  }

  try {
    await db.update(destinations).set(data).where(eq(destinations.id, id));
    return true;
  } catch (error) {
    console.error("[Database] Failed to update destination:", error);
    return false;
  }
}

/**
 * Delete a destination
 */
export async function deleteDestination(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete destination: database not available");
    return false;
  }

  try {
    await db.delete(destinations).where(eq(destinations.id, id));
    return true;
  } catch (error) {
    console.error("[Database] Failed to delete destination:", error);
    return false;
  }
}

/**
 * Reorder destinations
 */
export async function reorderDestinations(orderedIds: number[]): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot reorder destinations: database not available");
    return false;
  }

  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(destinations)
        .set({ sortOrder: i + 1 })
        .where(eq(destinations.id, orderedIds[i]));
    }
    return true;
  } catch (error) {
    console.error("[Database] Failed to reorder destinations:", error);
    return false;
  }
}

// ============================================
// Competitor Monitoring Functions
// ============================================

/**
 * Create a new competitor tour to monitor
 */
export async function createCompetitorTour(data: InsertCompetitorTour) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(competitorTours).values(data);
  const insertId = (result as any)[0]?.insertId;
  if (!insertId) throw new Error("Failed to create competitor tour");

  const rows = await db.select().from(competitorTours).where(eq(competitorTours.id, insertId)).limit(1);
  return rows[0];
}

/**
 * Get all competitor tours with optional filters
 */
export async function getCompetitorTours(filters?: {
  competitor?: string;
  scrapeStatus?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { tours: [] as CompetitorTour[], total: 0, page: 1, pageSize: 20 };

  const conditions: any[] = [];
  if (filters?.competitor && filters.competitor !== "all") {
    conditions.push(eq(competitorTours.competitor, filters.competitor as any));
  }
  if (filters?.scrapeStatus && filters.scrapeStatus !== "all") {
    conditions.push(eq(competitorTours.scrapeStatus, filters.scrapeStatus as any));
  }
  if (filters?.search) {
    conditions.push(
      or(
        like(competitorTours.tourTitle, `%${filters.search}%`),
        like(competitorTours.destination, `%${filters.search}%`),
        like(competitorTours.tourUrl, `%${filters.search}%`)
      )
    );
  }

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(competitorTours)
    .where(whereClause)
    .orderBy(desc(competitorTours.updatedAt))
    .limit(pageSize)
    .offset(offset);

  // Count total
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorTours)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  return { tours: rows, total, page, pageSize };
}

/**
 * Get a single competitor tour by ID
 */
export async function getCompetitorTourById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(competitorTours).where(eq(competitorTours.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Get all active competitor tours (for scheduling)
 */
export async function getActiveCompetitorTours() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(competitorTours)
    .where(eq(competitorTours.scrapeStatus, "active"));
}

/**
 * Update a competitor tour
 */
export async function updateCompetitorTour(id: number, data: Partial<InsertCompetitorTour>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(competitorTours).set(data).where(eq(competitorTours.id, id));
  return getCompetitorTourById(id);
}

/**
 * Delete a competitor tour and all related data
 */
export async function deleteCompetitorTour(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete related data first
  await db.delete(competitorAlerts).where(eq(competitorAlerts.competitorTourId, id));
  await db.delete(competitorPriceHistory).where(eq(competitorPriceHistory.competitorTourId, id));
  await db.delete(competitorDepartures).where(eq(competitorDepartures.competitorTourId, id));
  await db.delete(competitorTours).where(eq(competitorTours.id, id));
}

/**
 * Update scrape status for a competitor tour
 */
export async function updateCompetitorTourScrapeStatus(
  id: number,
  status: "active" | "paused" | "error",
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = {
    scrapeStatus: status,
    lastScrapedAt: new Date(),
  };
  if (status === "error" && errorMessage) {
    updateData.scrapeErrorMessage = errorMessage;
  } else {
    updateData.scrapeErrorMessage = null;
  }

  await db.update(competitorTours).set(updateData).where(eq(competitorTours.id, id));
}

// ── Departures ──────────────────────────────────────────────

/**
 * Get latest departures for a competitor tour
 */
export async function getLatestDepartures(competitorTourId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(competitorDepartures)
    .where(eq(competitorDepartures.competitorTourId, competitorTourId))
    .orderBy(desc(competitorDepartures.scrapedAt));
}

/**
 * Upsert competitor departures (replace old snapshot with new one)
 */
export async function upsertCompetitorDepartures(
  competitorTourId: number,
  departures: Array<{
    departureDate: string;
    returnDate?: string;
    adultPrice?: number;
    childPrice?: number;
    singleSupplement?: number;
    totalSeats?: number;
    availableSeats?: number;
    status: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete old departures for this tour
  await db
    .delete(competitorDepartures)
    .where(eq(competitorDepartures.competitorTourId, competitorTourId));

  // Insert new departures
  if (departures.length === 0) return;

  const values = departures.map((d) => ({
    competitorTourId,
    departureDate: d.departureDate,
    returnDate: d.returnDate ?? null,
    adultPrice: d.adultPrice ?? null,
    childPrice: d.childPrice ?? null,
    singleSupplement: d.singleSupplement ?? null,
    totalSeats: d.totalSeats ?? null,
    availableSeats: d.availableSeats ?? null,
    departureStatus: (d.status || "open") as "open" | "full" | "cancelled" | "guaranteed",
  }));

  await db.insert(competitorDepartures).values(values);
}

// ── Price History ───────────────────────────────────────────

/**
 * Insert a price history record
 */
export async function insertPriceHistory(data: {
  competitorTourId: number;
  departureDate: string;
  price: number;
  previousPrice: number | null;
  priceChange: number | null;
  changeType: "increase" | "decrease" | "new" | "unchanged";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(competitorPriceHistory).values({
    competitorTourId: data.competitorTourId,
    departureDate: data.departureDate,
    price: data.price,
    previousPrice: data.previousPrice,
    priceChange: data.priceChange,
    changeType: data.changeType,
  });
}

/**
 * Get price history for a competitor tour (optionally filtered by departure date)
 */
export async function getPriceHistory(
  competitorTourId: number,
  departureDate?: string,
  limit = 100
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(competitorPriceHistory.competitorTourId, competitorTourId)];
  if (departureDate) {
    conditions.push(eq(competitorPriceHistory.departureDate, departureDate));
  }

  return db
    .select()
    .from(competitorPriceHistory)
    .where(and(...conditions))
    .orderBy(desc(competitorPriceHistory.recordedAt))
    .limit(limit);
}

// ── Alerts ──────────────────────────────────────────────────

/**
 * Insert competitor alerts (batch)
 */
export async function insertCompetitorAlerts(
  alerts: Array<{
    competitorTourId: number;
    alertType: string;
    title: string;
    message: string;
    severity: "info" | "warning" | "critical";
    metadata: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (alerts.length === 0) return;

  const values = alerts.map((a) => ({
    competitorTourId: a.competitorTourId,
    alertType: a.alertType as any,
    title: a.title,
    message: a.message,
    severity: a.severity,
    metadata: a.metadata,
  }));

  await db.insert(competitorAlerts).values(values);
}

/**
 * Get competitor alerts with optional filters
 */
export async function getCompetitorAlerts(filters?: {
  competitorTourId?: number;
  alertType?: string;
  severity?: string;
  isRead?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { alerts: [], total: 0, page: 1, pageSize: 20 };

  const conditions: any[] = [];
  if (filters?.competitorTourId) {
    conditions.push(eq(competitorAlerts.competitorTourId, filters.competitorTourId));
  }
  if (filters?.alertType && filters.alertType !== "all") {
    conditions.push(eq(competitorAlerts.alertType, filters.alertType as any));
  }
  if (filters?.severity && filters.severity !== "all") {
    conditions.push(eq(competitorAlerts.severity, filters.severity as any));
  }
  if (filters?.isRead !== undefined) {
    conditions.push(eq(competitorAlerts.isRead, filters.isRead ? 1 : 0));
  }

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(competitorAlerts)
    .where(whereClause)
    .orderBy(desc(competitorAlerts.createdAt))
    .limit(pageSize)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorAlerts)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  return { alerts: rows, total, page, pageSize };
}

/**
 * Get unread alert count
 */
export async function getUnreadAlertCount() {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorAlerts)
    .where(eq(competitorAlerts.isRead, 0));

  return result[0]?.count ?? 0;
}

/**
 * Mark alert as read
 */
export async function markAlertAsRead(alertId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(competitorAlerts)
    .set({ isRead: 1, readAt: new Date() })
    .where(eq(competitorAlerts.id, alertId));
}

/**
 * Mark all alerts as read
 */
export async function markAllAlertsAsRead() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(competitorAlerts)
    .set({ isRead: 1, readAt: new Date() })
    .where(eq(competitorAlerts.isRead, 0));
}

/**
 * Delete old alerts (cleanup)
 */
export async function deleteOldAlerts(olderThanDays = 30) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  await db
    .delete(competitorAlerts)
    .where(lte(competitorAlerts.createdAt, cutoff));
}

// ============================================
// Tour Price Comparison Functions
// ============================================

export async function upsertTourPriceComparison(data: Omit<InsertTourPriceComparison, "id" | "createdAt" | "updatedAt" | "lastUpdated">): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select({ id: tourPriceComparisons.id })
    .from(tourPriceComparisons)
    .where(eq(tourPriceComparisons.tourId, data.tourId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(tourPriceComparisons)
      .set({ ...data, lastUpdated: new Date() })
      .where(eq(tourPriceComparisons.tourId, data.tourId));
  } else {
    await db.insert(tourPriceComparisons).values({ ...data, lastUpdated: new Date() });
  }
}

export async function getTourPriceComparison(tourId: number): Promise<TourPriceComparison | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select()
    .from(tourPriceComparisons)
    .where(eq(tourPriceComparisons.tourId, tourId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getAllPriceComparisons(): Promise<TourPriceComparison[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(tourPriceComparisons).orderBy(desc(tourPriceComparisons.updatedAt));
}

export async function deleteTourPriceComparison(tourId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(tourPriceComparisons).where(eq(tourPriceComparisons.tourId, tourId));
}
