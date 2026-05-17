/**
 * lionBulkImportService — fast bulk import of Lion Travel tours.
 *
 * v80.24: Jeff's insight — fetching raw data from Lion's internal API is
 * 30× faster than running the full LLM rewrite pipeline (60-90s/tour). For
 * power-users who want to import 50-100 tours at once, this skips LLM and
 * writes Lion's raw content directly. A background worker then upgrades
 * each tour to PACK&GO style on demand.
 *
 * Pipeline:
 *   1. Fetch Lion category page → list of NormGroupIDs (~3s)
 *   2. For each ID: fetch travelinfojson + groupcalendarjson (~300-500ms)
 *   3. Insert tour row with `status='draft'` and `qaStatus='import_pending'`
 *      so it's hidden from public until rewritten.
 *   4. Insert departures from groupcalendarjson (with REAL bookedSlots).
 *
 * Total: ~30-40 seconds for 50 tours. Compare to LLM pipeline: 50 minutes.
 */

import { fetchLionTravelData, type LionTravelApiData } from "./lionTravelApiService";
import { createTour, createDeparture, getTourDepartures } from "../db";
import { tourGenerationQueue } from "../queue";

/** Result for one imported tour */
export interface BulkImportResult {
  normGroupId: string;
  success: boolean;
  tourId?: number;
  error?: string;
  // For UI: title to show user what was imported
  title?: string;
  destinationCountry?: string;
  durationDays?: number;
}

/** Aggregate result for a batch */
export interface BulkImportBatchResult {
  total: number;
  imported: number;
  failed: number;
  durationMs: number;
  results: BulkImportResult[];
}

/**
 * Fetch all NormGroupIDs from a Lion category page.
 * Category path examples: "japan/kansai", "middleeurope-westerneurope/index"
 */
export async function listLionCategoryTours(
  categoryPath: string,
  options: { limit?: number } = {}
): Promise<string[]> {
  const { limit = 30 } = options;
  const url = `https://travel.liontravel.com/category/zh-tw/${categoryPath}?fr=cg39T0201C0101M01`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; PACK&GO Bulk Import)" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!resp.ok) {
      console.warn(`[lionBulkImport] category ${categoryPath} returned ${resp.status}`);
      return [];
    }
    const html = await resp.text();
    const matches = html.match(/NormGroupID=([a-f0-9-]+)/gi) || [];
    const ids = Array.from(new Set(matches.map((m) => m.replace(/^NormGroupID=/i, ""))));
    return ids.slice(0, limit);
  } catch (err) {
    console.error(`[lionBulkImport] listLionCategoryTours failed for ${categoryPath}:`, err);
    return [];
  }
}

/**
 * Convert Lion API data to a tour DB record (no LLM rewriting).
 * Title / description / highlights stay as Lion's raw text — admin can
 * trigger LLM rewrite on demand later.
 *
 * 2026-05-16: added required `createdBy` (tours.createdBy is NOT NULL
 * with no DB default). Pre-existing callers from /api/internal/* used
 * to default to userId=1 inline; new flow from SuppliersTab passes the
 * actual admin id from the tRPC context.
 */
function lionDataToTourRecord(
  data: LionTravelApiData,
  normGroupId: string,
  createdBy: number
) {
  // Best-effort country derivation from country code (Lion uses ISO-2)
  const countryCodeMap: Record<string, string> = {
    JP: "日本", KR: "韓國", TW: "台灣", US: "美國", CA: "加拿大",
    GB: "英國", FR: "法國", DE: "德國", IT: "義大利", ES: "西班牙",
    CH: "瑞士", AT: "奧地利", NL: "荷蘭", BE: "比利時", LU: "盧森堡",
    GR: "希臘", PT: "葡萄牙", IE: "愛爾蘭",
    CZ: "捷克", HU: "匈牙利", PL: "波蘭", SK: "斯洛伐克", SI: "斯洛維尼亞",
    HR: "克羅埃西亞", RS: "塞爾維亞", BG: "保加利亞", RO: "羅馬尼亞",
    NO: "挪威", SE: "瑞典", DK: "丹麥", FI: "芬蘭", IS: "冰島",
    RU: "俄羅斯", TR: "土耳其",
    TH: "泰國", VN: "越南", MY: "馬來西亞", SG: "新加坡", ID: "印尼",
    PH: "菲律賓", IN: "印度", LK: "斯里蘭卡", NP: "尼泊爾",
    EG: "埃及", MA: "摩洛哥", ZA: "南非",
    AU: "澳洲", NZ: "紐西蘭",
  };
  const destCountry =
    countryCodeMap[data.country?.toUpperCase() || ""] || data.country || "";
  // First city in itinerary (best-effort)
  const firstCity = data.dailyItinerary?.[0]?.attractions?.[0]?.name || "";

  return {
    title: data.tourName.slice(0, 200), // safety cap
    description: "", // empty until LLM rewrite
    productCode: data.tourId,
    destinationCountry: destCountry,
    destinationCity: firstCity || destCountry,
    departureCity: data.departureCity || "",
    days: data.tourDays,
    nights: Math.max(0, data.tourDays - 1),
    duration: data.tourDays,
    price: Math.round(data.price),
    priceCurrency: data.currencyCode,
    heroImage: data.heroImageUrl,
    imageUrl: data.heroImageUrl,
    status: "draft" as const, // hidden until LLM rewrite
    isFeatured: false,
    // Mark this tour as needing LLM upgrade
    qaStatus: "needs_review",
    qaScore: 0,
    qaIssues: JSON.stringify([
      {
        type: "info",
        message: "從雄獅整批匯入 — 需要 LLM 升級為 PACK&GO 風格",
      },
    ]),
    // Store sourceUrl so LLM rewrite can re-fetch + use cache
    sourceUrl: `https://travel.liontravel.com/detail?NormGroupID=${normGroupId}`,
    sourceProvider: "liontravel",
    createdBy,
  } as any; // cast bc not all fields are in InsertTour type — DB ignores unknown
}

/**
 * Import a single tour from Lion. Skips if already imported (by sourceUrl
 * lookup not implemented here — caller should dedupe).
 */
async function importOneTour(
  normGroupId: string,
  createdBy: number
): Promise<BulkImportResult> {
  try {
    const url = `https://travel.liontravel.com/detail?NormGroupID=${normGroupId}`;
    const data = await fetchLionTravelData(url);
    if (!data) {
      return { normGroupId, success: false, error: "fetchLionTravelData returned null" };
    }
    if (!data.tourName) {
      return { normGroupId, success: false, error: "Tour has no name" };
    }
    const tourRecord = lionDataToTourRecord(data, normGroupId, createdBy);
    const tour = await createTour(tourRecord);

    // Insert real departures with REAL bookedSlots (v80.24 fix)
    if (data.allDepartures && data.allDepartures.length > 0) {
      const existingDeps = await getTourDepartures(tour.id);
      if (existingDeps.length === 0) {
        for (const dep of data.allDepartures) {
          try {
            const [year, month, day] = dep.date.split("/").map(Number);
            if (!year || !month || !day) continue;
            const departureDate = new Date(year, month - 1, day, 8, 0, 0);
            const returnDate = new Date(
              year, month - 1,
              day + (data.tourDays - 1 || 0), 20, 0, 0
            );
            const totalSeats = dep.totalSeats || 20;
            const availSeats = Number.isFinite(dep.availableSeats) ? dep.availableSeats : totalSeats;
            const bookedSlots = Math.max(0, totalSeats - availSeats);
            const isFullByStatus = ["客滿", "額滿", "請洽專員"].includes(dep.status || "");
            const statusMap: Record<string, "open" | "full" | "cancelled" | "confirmed"> = {
              "報名": "open", "客滿": "full", "額滿": "full",
              "請洽專員": "full", "取消": "cancelled",
              "確定": "confirmed", "確定出團": "confirmed",
            };
            const finalStatus = isFullByStatus ? "full" : statusMap[dep.status || ""] || "open";
            await createDeparture({
              tourId: tour.id,
              departureDate,
              returnDate,
              adultPrice: Math.round(dep.price),
              totalSlots: totalSeats,
              bookedSlots,
              status: finalStatus,
              currency: dep.currencyCode || "TWD",
              notes: `lionGroupId: ${dep.groupId} · 雄獅原狀態: ${dep.status || "?"}`,
            });
          } catch {
            // skip individual departure errors
          }
        }
      }
    }

    return {
      normGroupId,
      success: true,
      tourId: tour.id,
      title: data.tourName,
      destinationCountry: tourRecord.destinationCountry,
      durationDays: data.tourDays,
    };
  } catch (err) {
    // v80.24: log full error so we can diagnose silent failures.
    // v81 fix: also surface the underlying mysql2 cause (code + sqlMessage) —
    // Drizzle's wrapper hides ER_NO_DEFAULT_FOR_FIELD / Duplicate entry / etc.
    // behind a "Failed query:" message, leaving us guessing.
    const e = err as any;
    const cause = e?.cause;
    const causeMsg = cause?.sqlMessage || cause?.code || cause?.message;
    const fullMessage = causeMsg
      ? `${causeMsg} (drizzle: ${e.message?.slice(0, 200)})`
      : e.message || String(err);
    console.error(`[lionBulkImport] importOneTour ${normGroupId} failed:`, fullMessage);
    if (cause?.code) console.error(`  mysql code: ${cause.code}`);
    if (e.stack) {
      console.error(e.stack?.split("\n").slice(0, 5).join("\n"));
    }
    return {
      normGroupId,
      success: false,
      error: fullMessage,
    };
  }
}

/**
 * Bulk import — caller provides list of NormGroupIDs OR a category path.
 * Imports tours in parallel batches (concurrency 5 to be polite to Lion).
 */
export async function bulkImportFromLion(
  input: { ids?: string[]; categoryPath?: string; limit?: number; userId?: number }
): Promise<BulkImportBatchResult> {
  const startTime = Date.now();
  let ids = input.ids || [];
  if (!ids.length && input.categoryPath) {
    ids = await listLionCategoryTours(input.categoryPath, { limit: input.limit });
  }
  if (!ids.length) {
    return { total: 0, imported: 0, failed: 0, durationMs: 0, results: [] };
  }
  // Default to userId=1 (Jeff) for legacy /api/internal/* callers that
  // don't yet thread auth; the SuppliersTab flow passes the real admin id.
  const createdBy = input.userId ?? 1;

  // Parallel batches of 5 — polite to Lion + still ~10× faster than serial
  const concurrency = 5;
  const results: BulkImportResult[] = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((id) => importOneTour(id, createdBy))
    );
    results.push(...batchResults);
  }

  const imported = results.filter((r) => r.success).length;
  const failed = results.length - imported;
  const durationMs = Date.now() - startTime;
  console.log(
    `[lionBulkImport] Imported ${imported}/${results.length} tours in ${durationMs}ms` +
      (failed > 0 ? ` (${failed} failed)` : "")
  );

  // Round 81 (2026-05-17): Post bulk-import summary to #catalog channel.
  // Jeff sees the batch result live in ChatsTab — useful when running
  // big keyword batches in the background.
  try {
    const { notifyAgentMessage } = await import("../_core/agentNotify");
    const sampleTitles = results
      .filter((r) => r.success)
      .slice(0, 5)
      .map((r) => `• ${r.title?.slice(0, 60) ?? "(no title)"}`)
      .join("\n");
    await notifyAgentMessage({
      agentName: "catalog",
      messageType: imported > 0 ? "observation" : "alert",
      title: `Lion 批次匯入 → ${imported}/${results.length} 成功 (${Math.round(durationMs / 1000)}s)`,
      body:
        `供應商: Lion Travel\n` +
        `成功: ${imported} · 失敗: ${failed}\n` +
        `耗時: ${Math.round(durationMs / 1000)}s\n\n` +
        (imported > 0
          ? `匯入的 tour 範例:\n${sampleTitles}\n\n下一步: LLM rewrite 已 queue 到 BullMQ,每個 tour 約 2-3 分鐘`
          : "全部失敗,可能 Lion API 端有問題或網路超時。"),
      priority: failed > imported ? "high" : "low",
      context: { imported, failed, total: results.length, durationMs },
    });
  } catch (err) {
    console.warn("[lionBulkImport] catalog channel notify failed:", (err as Error).message);
  }

  return { total: results.length, imported, failed, durationMs, results };
}

/**
 * Queue a background LLM upgrade for tours that were bulk-imported.
 * Calls the existing tour-generation queue with `force=true` and the
 * stored sourceUrl, so the LLM pipeline re-processes the tour with full
 * PACK&GO rewriting.
 */
export async function queueRewriteForImportedTours(
  tourIds: number[],
  options: { userId?: number } = {}
): Promise<{ queued: number }> {
  const { userId = 1 } = options;
  let queued = 0;
  for (const tourId of tourIds) {
    try {
      // Re-trigger via tour generation queue using sourceUrl
      // We need to fetch the tour to get sourceUrl
      const { getTourById } = await import("../db");
      const tour = await getTourById(tourId);
      const url = (tour as any)?.sourceUrl;
      if (!url) continue;
      const requestId = `rewrite_${tourId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await tourGenerationQueue.add(
        "generate-tour",
        {
          url,
          userId,
          requestId,
          forceRegenerate: true,
          isPdf: false,
          // 2026-05-16: tell masterAgent which draft this rewrite was
          // spawned from so it can flip the source draft to status=
          // 'inactive' on success — prevents the draft from sitting
          // around forever after the new PACK&GO tour row has been
          // generated (id 1080001-1080008 today's stranded drafts).
          sourceDraftTourId: tourId,
        },
        { jobId: requestId }
      );
      queued++;
    } catch (err) {
      console.warn(`[lionBulkImport] Failed to queue rewrite for tour ${tourId}:`, err);
    }
  }
  return { queued };
}
