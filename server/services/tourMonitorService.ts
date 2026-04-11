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
        } as any).catch(() => {});
        
        // Update tour monitor status
        if (db) await db.update(tours)
          .set({
            lastMonitoredAt: new Date(),
            monitorStatus: 'error',
          } as any)
          .where(eq(tours.id, tour.id))
          .catch(() => {});
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
          if (changeTypes.includes('status') && scrapedDep.status && db) {
            await db.update(tourDepartures)
              .set({ status: scrapedDep.status as any })
              .where(eq(tourDepartures.id, dbDep.id))
              .catch(() => {});
          }
          
          // Auto-update seats if changed
          if (changeTypes.includes('seats') && scrapedDep.seats !== undefined && db) {
            await db.update(tourDepartures)
              .set({ availableSeats: scrapedDep.seats } as any)
              .where(eq(tourDepartures.id, dbDep.id))
              .catch(() => {});
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

interface ScrapedDeparture {
  date: string; // YYYY-MM-DD
  status?: 'open' | 'soldout' | 'confirmed' | 'cancelled';
  price?: number;
  seats?: number;
}

interface ScrapedTourData {
  departures: ScrapedDeparture[];
  price?: number;
}

/**
 * Scrape a tour page for current departure data
 * Uses lightweight HTTP scraping to check availability
 */
async function scrapeTourPage(url: string): Promise<ScrapedTourData> {
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
    departures: (meta.departureDates as Array<{ date: string; status?: string; price?: number }>).map((d) => ({
      date: d.date,
      status: d.status as ScrapedDeparture['status'],
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
  return db
    .select()
    .from(tourMonitorLogs)
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
