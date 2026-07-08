/**
 * TourMonitorService
 * 
 * Monitors supplier tour pages for changes in:
 * - Departure date status (open → soldout → confirmed → cancelled)
 * - Pricing changes
 * - Seat availability changes
 * 
 * Runs daily at 03:00 via BullMQ scheduler.
 * Results are stored in tourMonitorLogs table.
 */

import { randomBytes } from 'crypto';
import { getDb } from '../db';
import { tours, tourDepartures, tourMonitorLogs } from '../../drizzle/schema';
import { eq, and, gte, isNotNull, ne, desc } from 'drizzle-orm';
import { fetchLionTravelData } from './lionTravelApiService';
import { reportFunnelError } from '../_core/errorFunnel';

export interface MonitorRunResult {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  totalTours: number;
  checkedTours: number;
  changedTours: number;
  failedTours: number;
  changes: MonitorChange[];
}

export interface MonitorChange {
  tourId: number;
  tourTitle: string;
  sourceUrl: string;
  departureDate?: string;
  changeType: 'status' | 'price' | 'seats' | 'multiple';
  previousValue: string;
  currentValue: string;
  summary: string;
}

/**
 * Run a full monitoring cycle for all active tours with sourceUrl
 */
export async function runMonitorCycle(): Promise<MonitorRunResult> {
  const runId = randomBytes(8).toString('hex');
  const startedAt = new Date();
  
  console.log(`[TourMonitor] 🔍 Starting monitor run ${runId}`);
  
  const db = await getDb();
  if (!db) return { runId, startedAt, completedAt: new Date(), totalTours: 0, checkedTours: 0, changedTours: 0, failedTours: 0, changes: [] };
  // Get all active tours with a sourceUrl to monitor
  const toursToMonitor = await db
    .select({
      id: tours.id,
      title: tours.title,
      sourceUrl: tours.sourceUrl,
      destinationCountry: tours.destinationCountry,
    })
    .from(tours)
    .where(
      and(
        ne(tours.status, 'inactive' as any),
        isNotNull(tours.sourceUrl),
      )
    );
  
  console.log(`[TourMonitor] Found ${toursToMonitor.length} tours to monitor`);
  
  const changes: MonitorChange[] = [];
  let checkedTours = 0;
  let changedTours = 0;
  let failedTours = 0;
  
  // Process tours in batches of 5 to avoid overwhelming the server
  const BATCH_SIZE = 5;
  for (let i = 0; i < toursToMonitor.length; i += BATCH_SIZE) {
    const batch = toursToMonitor.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (tour: { id: number; title: string; sourceUrl: string | null; destinationCountry: string | null }) => {
      const checkStart = Date.now();
      try {
        const result = await checkTour(tour.id, tour.sourceUrl!, runId);
        checkedTours++;
        if (result.hasChanges) {
          changedTours++;
          changes.push(...result.changes.map(c => ({
            ...c,
            tourTitle: tour.title,
            sourceUrl: tour.sourceUrl!,
          })));
        }
        
        // Update tour's lastMonitoredAt
        if (db) await db.update(tours)
          .set({
            lastMonitoredAt: new Date(),
            monitorStatus: result.hasChanges ? 'changed' : 'ok',
            monitorChangeSummary: result.hasChanges ? result.changes.map(c => c.summary).join('; ') : null,
          } as any)
          .where(eq(tours.id, tour.id));
          
      } catch (err) {
        failedTours++;
        console.error(`[TourMonitor] ❌ Failed to check tour ${tour.id}:`, err);
        
        // Log failure
        if (db) await db.insert(tourMonitorLogs).values({
          tourId: tour.id,
          runId,
          sourceUrl: tour.sourceUrl,
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - checkStart,
          hasChanges: 0,
        } as any).catch((dbErr) => {
          // v71: don't silently swallow log-write failures — if the monitor log
          // table itself is broken we want to know.
          console.warn(`[TourMonitor] Failed to write tourMonitorLogs row for tour ${tour.id}:`, (dbErr as Error)?.message);
          reportFunnelError({ source: "fail-open:tourMonitorService:writeMonitorLog", err: dbErr, context: { tourId: tour.id } }).catch(() => {});
        });

        // Update tour monitor status
        if (db) await db.update(tours)
          .set({
            lastMonitoredAt: new Date(),
            monitorStatus: 'error',
          } as any)
          .where(eq(tours.id, tour.id))
          .catch((dbErr) => {
            console.warn(`[TourMonitor] Failed to update monitor status for tour ${tour.id}:`, (dbErr as Error)?.message);
            reportFunnelError({ source: "fail-open:tourMonitorService:updateMonitorStatusError", err: dbErr, context: { tourId: tour.id } }).catch(() => {});
          });
      }
    }));
    
    // Small delay between batches
    if (i + BATCH_SIZE < toursToMonitor.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  const completedAt = new Date();
  const result: MonitorRunResult = {
    runId,
    startedAt,
    completedAt,
    totalTours: toursToMonitor.length,
    checkedTours,
    changedTours,
    failedTours,
    changes,
  };
  
  console.log(`[TourMonitor] ✅ Run ${runId} completed: ${checkedTours} checked, ${changedTours} changed, ${failedTours} failed`);
  
  return result;
}

interface TourCheckResult {
  hasChanges: boolean;
  changes: Omit<MonitorChange, 'tourTitle' | 'sourceUrl'>[];
}

/**
 * Check a single tour for changes by comparing current DB state with scraped data
 */
async function checkTour(tourId: number, sourceUrl: string, runId: string): Promise<TourCheckResult> {
  const checkStart = Date.now();
  const db = await getDb();
  if (!db) return { hasChanges: false, changes: [] };
  
  // Get current departure dates from DB
  const currentDepartures = await db
    .select()
    .from(tourDepartures)
    .where(
      and(
        eq(tourDepartures.tourId, tourId),
        gte(tourDepartures.departureDate, new Date()),
      )
    );
  
  // Scrape the source URL for current data
  let scrapedData: ScrapedTourData | null = null;
  try {
    scrapedData = await scrapeTourPage(sourceUrl);
  } catch (scrapeErr) {
    console.warn(`[TourMonitor] Scrape failed for tour ${tourId}: ${scrapeErr}`);
    
    await db.insert(tourMonitorLogs).values({
      tourId,
      runId,
      sourceUrl,
      status: 'failed',
      errorMessage: `Scrape failed: ${scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr)}`,
      durationMs: Date.now() - checkStart,
      hasChanges: 0,
    } as any);
    
    return { hasChanges: false, changes: [] };
  }
  
  // Compare and detect changes
  const changes: Omit<MonitorChange, 'tourTitle' | 'sourceUrl'>[] = [];
  
  if (scrapedData && scrapedData.departures) {
    for (const scrapedDep of scrapedData.departures) {
      const dbDep = currentDepartures.find(d => {
        const dbDate = d.departureDate instanceof Date 
          ? d.departureDate.toISOString().split('T')[0]
          : String(d.departureDate).split('T')[0];
        return dbDate === scrapedDep.date;
      });
      
      if (dbDep) {
        const changeTypes: string[] = [];
        let summary = '';
        
        // Check status change
        const dbStatus = dbDep.status || 'open';
        if (scrapedDep.status && scrapedDep.status !== dbStatus) {
          changeTypes.push('status');
          summary += `狀態: ${dbStatus} → ${scrapedDep.status}`;
        }
        
        // Check price change
        const dbPrice = dbDep.adultPrice || 0;
        if (scrapedDep.price && Math.abs(scrapedDep.price - dbPrice) > 100) {
          changeTypes.push('price');
          summary += (summary ? ', ' : '') + `價格: NT$${dbPrice.toLocaleString()} → NT$${scrapedDep.price.toLocaleString()}`;
        }
        
        // Check seats change
        const dbSeats = (dbDep as any).availableSeats as number | null;
        if (scrapedDep.seats !== undefined && dbSeats !== null && scrapedDep.seats !== dbSeats) {
          changeTypes.push('seats');
          summary += (summary ? ', ' : '') + `剩餘座位: ${dbSeats} → ${scrapedDep.seats}`;
        }
        
        if (changeTypes.length > 0) {
          const changeType = changeTypes.length > 1 ? 'multiple' : changeTypes[0] as MonitorChange['changeType'];
          
          // Log the change
          if (!db) continue;
          await db.insert(tourMonitorLogs).values({
            tourId,
            runId,
            sourceUrl,
            departureDate: scrapedDep.date,
            previousStatus: dbStatus,
            currentStatus: scrapedDep.status || dbStatus,
            previousPrice: dbPrice,
            currentPrice: scrapedDep.price || dbPrice,
            priceChanged: changeTypes.includes('price') ? 1 : 0,
            previousSeats: dbSeats,
            currentSeats: scrapedDep.seats,
            seatsChanged: changeTypes.includes('seats') ? 1 : 0,
            hasChanges: 1,
            changesSummary: summary,
            status: 'success',
            durationMs: Date.now() - checkStart,
          } as any);
          
          changes.push({
            tourId,
            changeType,
            departureDate: scrapedDep.date,
            previousValue: `狀態:${dbStatus}, 價格:${dbPrice}, 座位:${dbSeats}`,
            currentValue: `狀態:${scrapedDep.status || dbStatus}, 價格:${scrapedDep.price || dbPrice}, 座位:${scrapedDep.seats}`,
            summary: `[${scrapedDep.date}] ${summary}`,
          });
          
          // Auto-update DB if status changed to soldout or confirmed
          // Round 66: normalize status through the zh→enum mapper to avoid
          // writing Chinese strings (報名/客滿/etc.) into a strict enum column.
          if (changeTypes.includes('status') && scrapedDep.status && db) {
            const normalized = normalizeDepartureStatus(scrapedDep.status);
            if (normalized) {
              await db.update(tourDepartures)
                .set({ status: normalized })
                .where(eq(tourDepartures.id, dbDep.id))
                .catch((err) => {
                  console.warn(`[TourMonitor] Failed to update status for departure ${dbDep.id}:`, err?.message);
                  reportFunnelError({ source: "fail-open:tourMonitorService:updateDepartureStatus", err, context: { departureId: dbDep.id } }).catch(() => {});
                });
            } else {
              console.warn(`[TourMonitor] Unknown status "${scrapedDep.status}" for departure ${dbDep.id} — skipping status update`);
            }
          }
          
          // Auto-update seats if changed
          // v78z hot-fix: tourDepartures schema uses totalSlots/bookedSlots
          // (not availableSeats — that's on the tours table). Drizzle silently
          // strips unknown keys → empty SET clause → MySQL syntax error.
          // Convert: bookedSlots = totalSlots - availableSeats(scraped).
          if (changeTypes.includes('seats') && scrapedDep.seats !== undefined && db) {
            const totalSlots = (dbDep as any).totalSlots ?? 0;
            const newBookedSlots = Math.max(0, totalSlots - scrapedDep.seats);
            await db.update(tourDepartures)
              .set({ bookedSlots: newBookedSlots } as any)
              .where(eq(tourDepartures.id, dbDep.id))
              .catch((dbErr) => {
                console.warn(`[TourMonitor] Failed to update seats for departure ${dbDep.id}:`, (dbErr as Error)?.message);
                reportFunnelError({ source: "fail-open:tourMonitorService:updateDepartureSeats", err: dbErr, context: { departureId: dbDep.id } }).catch(() => {});
              });
          }
        } else {
          // No changes - log success
          if (!db) continue;
          await db.insert(tourMonitorLogs).values({
            tourId,
            runId,
            sourceUrl,
            departureDate: scrapedDep.date,
            previousStatus: dbStatus,
            currentStatus: dbStatus,
            hasChanges: 0,
            status: 'success',
            durationMs: Date.now() - checkStart,
          } as any);
        }
      }
    }
  } else {
    // No departures scraped - just log a success with no changes
    if (!db) return { hasChanges: false, changes: [] };
    await db.insert(tourMonitorLogs).values({
      tourId,
      runId,
      sourceUrl,
      hasChanges: 0,
      status: 'success',
      durationMs: Date.now() - checkStart,
    } as any);
  }
  
  return {
    hasChanges: changes.length > 0,
    changes,
  };
}

// NOTE: DB enum is ["open", "full", "cancelled", "confirmed"]. We use "full"
// (not "soldout") to stay aligned with drizzle/schema.ts tourDepartures.status.
interface ScrapedDeparture {
  date: string; // YYYY-MM-DD
  status?: 'open' | 'full' | 'confirmed' | 'cancelled';
  price?: number;
  seats?: number;
}

/**
 * Round 66: Normalize any status value (LionTravel zh, English enum, dateExtractor raw)
 * into our tourDepartures.status enum. Returns null when it can't match — callers
 * must skip the DB write in that case to avoid MySQL ER_TRUNCATED_WRONG_VALUE_FOR_FIELD.
 */
export function normalizeDepartureStatus(
  raw: string | undefined | null
): 'open' | 'full' | 'confirmed' | 'cancelled' | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const zhMap: Record<string, 'open' | 'full' | 'confirmed' | 'cancelled'> = {
    '報名': 'open', '可報名': 'open', '候補': 'open',
    '客滿': 'full', '額滿': 'full', '已額滿': 'full', '暫停受理': 'full',
    '確定': 'confirmed', '已成團': 'confirmed', '成團': 'confirmed', '保證成團': 'confirmed',
    '取消': 'cancelled', '已取消': 'cancelled', '停辦': 'cancelled',
  };
  const trimmed = String(raw).trim();
  if (zhMap[trimmed]) return zhMap[trimmed];
  if (['open', 'full', 'confirmed', 'cancelled'].includes(s)) {
    return s as 'open' | 'full' | 'confirmed' | 'cancelled';
  }
  if (s === 'soldout' || s === 'sold_out' || s === 'sold-out') return 'full';
  return null;
}

interface ScrapedTourData {
  departures: ScrapedDeparture[];
  price?: number;
}

/**
 * Scrape a tour page for current departure data
 * Round 52: For liontravel URLs, use direct API (fast, accurate).
 * For other URLs, fall back to Puppeteer + dateExtractorAgent.
 */
async function scrapeTourPage(url: string): Promise<ScrapedTourData> {
  // ── Round 52: liontravel direct API path ──
  const isLiontravel = url.includes('travel.liontravel.com') || url.includes('liontravel.com');
  if (isLiontravel) {
    try {
      console.log(`[TourMonitor] 🦁 Using liontravel direct API for monitoring: ${url.slice(0, 80)}`);
      const lionData = await Promise.race([
        fetchLionTravelData(url),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('liontravel API timeout (15s)')), 15000)
        ),
      ]);
      if (!lionData) throw new Error('liontravel API returned null');
      // Map LionDeparture[] to ScrapedDeparture[]
      // DB enum uses 'full' (not 'soldout'); use normalizeDepartureStatus for consistency.
      const departures: ScrapedDeparture[] = (lionData.allDepartures || []).map(dep => ({
        date: dep.date.replace(/\//g, '-'), // "2026/07/06" → "2026-07-06"
        status: normalizeDepartureStatus(dep.status) || 'open',
        price: dep.price,
        seats: dep.availableSeats,
      }));
      console.log(`[TourMonitor] ✓ liontravel API: ${departures.length} departures, price=${lionData.pricing?.adultPrice}`);
      return { departures, price: lionData.pricing?.adultPrice };
    } catch (lionErr) {
      console.warn(`[TourMonitor] liontravel API failed, falling back to Puppeteer: ${lionErr}`);
      // Fall through to Puppeteer path
    }
  }

  // ── Puppeteer path (non-liontravel or liontravel API fallback) ──
  const { scrapeStaticFallback } = await import('./dynamicScraperService');
  const { extractTourMeta } = await import('../agents/dateExtractorAgent');
  
  // Use static scraper for monitoring (faster, less resource-intensive)
  const scrapeResult = await Promise.race([
    scrapeStaticFallback(url),
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Monitor scrape timeout (30s)')), 30000)
    ),
  ]);
  
  // Extract tour meta using dateExtractorAgent
  const meta = await extractTourMeta(
    scrapeResult.screenshots || { fullPage: Buffer.alloc(0) },
    scrapeResult.rawText || '',
    url
  );
  
  return {
    // Round 66: normalize status strings through the shared mapper so the
    // Puppeteer fallback path never writes unknown enum values to MySQL.
    departures: (meta.departureDates as Array<{ date: string; status?: string; price?: number }>).map((d) => ({
      date: d.date,
      status: normalizeDepartureStatus(d.status) ?? undefined,
      price: d.price,
    })),
    price: meta.pricing.adultPrice,
  };
}

/**
 * Get recent monitor logs for admin dashboard
 */
export async function getRecentMonitorLogs(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  // 批5 m2: LEFT JOIN tours so workspace cards can show the tour title and
  // Jeff's current selling price next to the source-price change. Additive —
  // all original log columns are preserved flat (MonitorDashboardV2 unaffected).
  const { getTableColumns } = await import('drizzle-orm');
  return db
    .select({
      ...getTableColumns(tourMonitorLogs),
      tourTitle: tours.title,
      tourPrice: tours.price,
      tourPriceCurrency: tours.priceCurrency,
    })
    .from(tourMonitorLogs)
    .leftJoin(tours, eq(tourMonitorLogs.tourId, tours.id))
    .orderBy(desc(tourMonitorLogs.createdAt))
    .limit(limit);
}

/**
 * Get monitor logs for a specific tour
 */
export async function getTourMonitorHistory(tourId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(tourMonitorLogs)
    .where(eq(tourMonitorLogs.tourId, tourId))
    .orderBy(desc(tourMonitorLogs.createdAt))
    .limit(limit);
}

/**
 * Get the latest monitor run summary
 */
export async function getLatestMonitorRun() {
  const db = await getDb();
  if (!db) return null;
  const logs = await db
    .select()
    .from(tourMonitorLogs)
    .orderBy(desc(tourMonitorLogs.createdAt))
    .limit(100);
  
  if (logs.length === 0) return null;
  
  // Group by runId
  const runGroups = new Map<string, typeof logs>();
  for (const log of logs) {
    if (!log.runId) continue;
    if (!runGroups.has(log.runId)) runGroups.set(log.runId, []);
    runGroups.get(log.runId)!.push(log);
  }
  
  // Get latest run
  const latestRunId = Array.from(runGroups.keys())[0];
  if (!latestRunId) return null;
  
  const runLogs = runGroups.get(latestRunId)!;
  const changedLogs = runLogs.filter((l: typeof logs[0]) => l.hasChanges === 1);
  
  return {
    runId: latestRunId,
    monitoredAt: runLogs[0].monitoredAt,
    totalChecked: runLogs.length,
    changesDetected: changedLogs.length,
    changes: changedLogs,
  };
}
