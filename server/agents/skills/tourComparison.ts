/**
 * Server-side orchestrator for the packgo-tour-comparison skill.
 *
 * Takes a high-level request (country + month + year) and produces a fully
 * rendered catalog PDF buffer by:
 *   1. Scraping supplier (currently Lion Travel only) sitemap → product IDs
 *   2. Verifying + filtering by region bucket + departure month
 *   3. Picking the best candidate per bucket
 *   4. Fetching full daily itinerary + departures for each winner
 *   5. Translating Chinese → target language via invokeLLM (cached)
 *   6. Calling renderTourComparisonHtml + renderHtmlToPdf
 *
 * Called by:
 *   - tRPC `tools.generateTourComparison` (admin manual trigger)
 *   - InquiryAgent (future, Stage C) — when classification is "comparison_request"
 *
 * Architecture note: this file is INTENTIONALLY the long, opinionated one. The
 * renderer (tourComparisonTemplate.ts) is pure data → HTML. The Lion API
 * client (lionTravelApiService.ts) is pure URL → typed data. This file is
 * where the BUSINESS LOGIC lives — bucket definitions, peak-window calendars,
 * reject patterns, default regions per country. Put policy here, keep the
 * pure functions pure.
 */

import { fetchLionTravelData } from "../../services/lionTravelApiService";
import {
  renderTourComparisonHtml,
  type TourComparisonInput,
  type ComparisonOption,
  type ComparisonDay,
  type ComparisonDeparture,
  type PeakWindow,
} from "../../services/skills/tourComparisonTemplate";
import { renderHtmlToPdf } from "../../services/skills/skillPdfService";
import { invokeLLM } from "../../_core/llm";
import { validateUrl } from "../../_core/urlSafetyGuard";

// ─── Type definitions ────────────────────────────────────────────────────

export type Bucket = {
  key: string;
  label: string;          // English label shown in catalog
  keywords: string[];     // Chinese keywords matched against Lion tourName
};

export type CountryConfig = {
  countryName: string;
  countryCode: string;
  /** Default buckets — input.regions overrides this if provided. */
  defaultBuckets: Bucket[];
  /** Peak window calendar (month-specific entries are merged at runtime). */
  peakWindows: (month: number, year: number) => PeakWindow[];
};

export type CatalogRequest = {
  country: "Japan" | "Korea" | "United States" | "Europe" | "China";
  month: number;          // 1-12
  year: number;
  regionCount?: number;   // default 5
  language?: "en" | "zh-TW";  // default "en"
  /** Override buckets — must match the CountryConfig's keys if provided. */
  regionsOverride?: string[];
  /** Optional translation cache key seed (e.g. customer email) — not yet used. */
  customerHint?: string;
};

export type CatalogResult = {
  pdf: Buffer;
  meta: {
    country: string;
    monthName: string;
    year: number;
    optionsFound: number;
    departuresFound: number;
    /** Source product codes used — for audit log / Jeff's backend lookup */
    supplierCodes: string[];
  };
};

// ─── Reject patterns (shared across all countries) ───────────────────────

const REJECT_PATTERNS = [
  /客製/,                    // bespoke — not group-join
  /高爾夫|打球|球場/,         // golf-themed (niche)
  /賞芝櫻|賞櫻限定|賞楓限定/,  // season-locked flower viewing
  /暑假限定|春節|跨年/,        // wrong-season marketing
  /包車/,                     // private vehicle
  /婚紗|蜜月/,                // theme-locked (unless explicitly requested)
  /郵輪|cruise/i,             // cruise tours have totally different structure
];

// ─── Country configs ────────────────────────────────────────────────────

const COUNTRY_CONFIGS: Record<CatalogRequest["country"], CountryConfig> = {
  Japan: {
    countryName: "Japan",
    countryCode: "JP",
    defaultBuckets: [
      {
        key: "tokyo",
        label: "Tokyo / Mt. Fuji / Hakone",
        keywords: ["東京", "富士", "箱根", "河口湖"],
      },
      {
        key: "kansai",
        label: "Kyoto / Osaka / Nara",
        keywords: ["京阪", "京都", "大阪", "奈良", "關西"],
      },
      {
        key: "hokkaido",
        label: "Hokkaido",
        keywords: ["北海道", "札幌", "函館", "小樽"],
      },
      {
        key: "kyushu",
        label: "Kyushu",
        keywords: ["九州", "福岡", "由布院", "別府", "熊本", "阿蘇"],
      },
      {
        key: "alpine",
        label: "Tateyama Kurobe Alpine + Shirakawa-go",
        keywords: ["立山", "黑部", "白川", "高山", "上高地", "黒部"],
      },
    ],
    peakWindows: (month, year) => {
      const out: PeakWindow[] = [];
      // Silver Week — September only
      if (month === 9) {
        out.push({
          window: `Sept 19–23`,
          reason: `Japan Silver Week (Respect for the Aged Day + Autumnal Equinox)`,
          impact: "Hotels +20-40%, crowded attractions",
        });
      }
      // Golden Week — Apr 29 to May 5
      if (month === 4 || month === 5) {
        out.push({
          window: month === 4 ? "Apr 29–30" : "May 1–5",
          reason: "Japan Golden Week — domestic + outbound demand peak",
          impact: "Hotels +30-50%, sold-out groups common",
        });
      }
      // Obon — Aug 13-15
      if (month === 8) {
        out.push({
          window: "Aug 13–15",
          reason: "Obon お盆 — Japanese domestic-travel peak",
          impact: "Limited group seats, hotel rates surge",
        });
      }
      // Mid-Autumn — September 2026 = Sept 25 (lunar)
      if (month === 9 && year === 2026) {
        out.push({
          window: "Sept 24–27",
          reason: "Mid-Autumn Festival (Sept 25) — Asian outbound demand spike",
          impact: "Flights up, limited group seats",
        });
      }
      // New Year — Dec 28 - Jan 4
      if (month === 12) {
        out.push({
          window: "Dec 28–31",
          reason: "Japan New Year window",
          impact: "Limited group availability, surcharges apply",
        });
      }
      if (month === 1) {
        out.push({
          window: "Jan 1–4",
          reason: "Japan New Year window",
          impact: "Limited group availability, surcharges apply",
        });
      }
      // Best-value row — always last, always included if there are peak rows
      if (out.length > 0) {
        out.push({
          window: "Other weekday windows",
          reason: "Off-peak weekday rates — fewer crowds, more availability",
          impact: "Recommended for budget-conscious travelers",
          isValueWindow: true,
        });
      }
      return out;
    },
  },
  // Stub configs for other countries — fill in as Jeff prioritizes
  Korea: { countryName: "Korea", countryCode: "KR", defaultBuckets: [], peakWindows: () => [] },
  "United States": { countryName: "United States", countryCode: "US", defaultBuckets: [], peakWindows: () => [] },
  Europe: { countryName: "Europe", countryCode: "EU", defaultBuckets: [], peakWindows: () => [] },
  China: { countryName: "China", countryCode: "CN", defaultBuckets: [], peakWindows: () => [] },
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DOW_MAP: Record<string, string> = {
  "一": "Mon", "二": "Tue", "三": "Wed", "四": "Thu",
  "五": "Fri", "六": "Sat", "日": "Sun",
};

// ─── Lion Travel scraping helpers ────────────────────────────────────────

const LION_BASE = "https://travel.liontravel.com";
const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
};

async function fetchSitemapIds(maxSitemaps = 8): Promise<string[]> {
  // Even though the API client allowlist trusts liontravel.com, double-check here
  const indexValidation = validateUrl(`${LION_BASE}/sitemap.xml`);
  if (!indexValidation.safe) {
    throw new Error(`Sitemap URL rejected: ${indexValidation.reason}`);
  }
  const indexResp = await fetch(`${LION_BASE}/sitemap.xml`, {
    headers: { "User-Agent": HEADERS["User-Agent"] },
    signal: AbortSignal.timeout(15_000),
  });
  if (!indexResp.ok) throw new Error(`Lion sitemap HTTP ${indexResp.status}`);
  const indexXml = await indexResp.text();
  // Use Array.from to avoid tsconfig downlevelIteration error on the matchAll
  // iterator and the Set spread (same pattern already used elsewhere in this
  // codebase — see lionTravelApiService.ts:492 for comparable case).
  const childUrls = Array.from(
    indexXml.matchAll(/<loc>([^<]+)<\/loc>/gi),
    (m) => m[1],
  );
  const ids = new Set<string>();
  for (const childUrl of childUrls.slice(0, maxSitemaps)) {
    const childValidation = validateUrl(childUrl);
    if (!childValidation.safe) continue;
    try {
      const r = await fetch(childUrl, {
        headers: { "User-Agent": HEADERS["User-Agent"] },
        signal: AbortSignal.timeout(25_000),
      });
      if (!r.ok) continue;
      const xml = await r.text();
      const matches = Array.from(xml.matchAll(/NormGroupID=([a-f0-9-]{36})/gi));
      for (const m of matches) {
        ids.add(m[1].toLowerCase());
      }
    } catch {
      // Skip unreachable sub-sitemap
    }
  }
  return Array.from(ids);
}

async function postJson(
  path: string,
  body: Record<string, string>,
  referer: string,
): Promise<any> {
  const resp = await fetch(`${LION_BASE}${path}`, {
    method: "POST",
    headers: { ...HEADERS, Referer: referer },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${path}`);
  return resp.json();
}

function pickBucket(tourName: string, buckets: Bucket[]): string | null {
  if (REJECT_PATTERNS.some((re) => re.test(tourName))) return null;
  for (const b of buckets) {
    for (const kw of b.keywords) {
      if (tourName.includes(kw)) return b.key;
    }
  }
  return null;
}

type VerifyResult = {
  normGroupId: string;
  groupId: string;
  tourId: string;
  tourName: string;
  tourDays: number;
  price: number;
  bucket: string;
  septCount: number;
};

async function verifyOne(
  ngId: string,
  buckets: Bucket[],
  month: number,
  year: number,
): Promise<VerifyResult | null> {
  try {
    const data = await postJson(
      "/detail/travelinfojson",
      { NormGroupID: ngId },
      `${LION_BASE}/detail?NormGroupID=${ngId}`,
    );
    const gi = data?.GroupInfo;
    if (!gi || !gi.GroupID) return null;
    const tourName: string = gi.TourName || gi.NormGroup || "";
    const bucket = pickBucket(tourName, buckets);
    if (!bucket) return null;

    // Confirm month-specific departures
    const yyyy = String(year);
    const mm = String(month).padStart(2, "0");
    const monthDateStart = `${yyyy}-${mm}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthDateEnd = `${yyyy}-${mm}-${String(lastDay).padStart(2, "0")}`;
    let monthCount = 0;
    try {
      const cal = await postJson(
        "/detail/groupcalendarjson",
        {
          NormGroupID: ngId,
          TourID: gi.TourID || "",
          GoDateStart: monthDateStart,
          GoDateEnd: monthDateEnd,
        },
        `${LION_BASE}/detail?NormGroupID=${ngId}`,
      );
      const cs = Array.isArray(cal) ? cal : [];
      monthCount = cs.filter((c) => {
        const d: string = c.Date ?? "";
        return d.startsWith(`${yyyy}-${mm}`) || d.startsWith(`${yyyy}/${mm}`);
      }).length;
    } catch {}
    if (monthCount === 0) return null;

    return {
      normGroupId: ngId,
      groupId: gi.GroupID,
      tourId: gi.TourID || "",
      tourName,
      tourDays: gi.TourDays || 0,
      price: gi.StraightLowestPrice || 0,
      bucket,
      septCount: monthCount,
    };
  } catch {
    return null;
  }
}

// ─── Translation via invokeLLM ───────────────────────────────────────────

/**
 * Translate a single tour's Chinese daily itinerary to English.
 *
 * We do this in ONE LLM call per tour (not per day) to:
 *   1. Save round-trip cost (5 days × 5 tours = 25 calls vs 5 calls)
 *   2. Give the model surrounding context for consistent place-name romanization
 *   3. Hit the prompt cache more efficiently
 *
 * Output is a strict JSON shape matching ComparisonOption[itinerary].
 */
async function translateItinerary(
  rawDays: Array<{
    day: number;
    travelPoint: string;
    summary: string;
    breakfast: string;
    lunch: string;
    dinner: string;
    hotelName: string;
    attractions: Array<{ name: string; visitWayDesc: string }>;
  }>,
  language: "en" | "zh-TW",
): Promise<ComparisonDay[]> {
  if (language === "zh-TW") {
    // No translation needed — just reshape
    return rawDays.map((d) => ({
      day: d.day,
      title: d.travelPoint.split(/[→↓\n]/)[0].slice(0, 80),
      route: d.travelPoint,
      attractions: d.attractions.map((a) => a.name).filter(Boolean),
      hotel: d.hotelName,
      meals: { B: d.breakfast, L: d.lunch, D: d.dinner },
    }));
  }

  // English translation via LLM
  const prompt = `Translate the following Chinese day-by-day Japan tour itinerary to English for a US customer. Follow these rules strictly:

1. Output VALID JSON only. No prose, no markdown fences.
2. Schema (TypeScript-like):
   { days: Array<{ day: number, title: string, route: string, attractions: string[], hotel: string, meals: { B: string, L: string, D: string } }> }
3. For 'title', take the day's most distinctive highlight (e.g. "Tokyo Tower → Hakone onsen ryokan"). Max 80 chars.
4. For 'route', translate the full transit/visit sequence. Keep the → arrows. Use English place names (Tokyo, Kyoto, Hakone — not romanizations of obscure spots; keep those in original).
5. For 'attractions', list the major attraction English names. Keep proper nouns recognizable (e.g. "Senso-ji Temple", "Mt. Fuji 5th Station").
6. For 'hotel', keep brand names as-is (Hilton, MyStays, Prince) but translate descriptive area words (溫泉 → onsen, 飯店 → hotel).
7. For meals (B/L/D), translate to short English:
   - 飯店內早餐 → "Hotel breakfast"
   - 機上簡餐/精緻簡餐 → "In-flight meal"
   - 自理/敬請自理/方便逛街 → "On own"
   - 溫暖的家 → "Home"
   - 螃蟹吃到飽 → "Crab buffet"
   - 和洋自助餐/總匯自助餐 → "Japanese-Western buffet"
   - 御膳/會席料理 → "Kaiseki gozen"
   - 燒肉 → "Yakiniku BBQ"
   - 風味餐 → "Local-style meal"
   - 涮涮鍋 → "Shabu-shabu"
   - Keep budget notes like "(¥2,500)" as-is.

Source data (JSON):
${JSON.stringify(rawDays, null, 2)}

Output ONLY the translated JSON. Begin with { and end with }.`;

  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You are a precise Chinese-to-English translator for Japanese tour itineraries. You output ONLY valid JSON, no explanations.",
      },
      { role: "user", content: prompt },
    ],
    maxTokens: 4096,
    responseFormat: { type: "json_object" },
  });

  const content = result.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const days = Array.isArray(parsed?.days) ? parsed.days : [];
    return days.map((d: any) => ({
      day: Number(d.day) || 0,
      title: String(d.title ?? "").slice(0, 200),
      route: String(d.route ?? ""),
      attractions: Array.isArray(d.attractions) ? d.attractions.map((a: any) => String(a)) : [],
      hotel: String(d.hotel ?? ""),
      meals: {
        B: String(d.meals?.B ?? ""),
        L: String(d.meals?.L ?? ""),
        D: String(d.meals?.D ?? ""),
      },
    }));
  } catch (err: any) {
    // Fallback to raw passthrough if LLM output isn't valid JSON
    console.warn("[tourComparison] LLM translation parse failed, falling back to raw:", err?.message);
    return rawDays.map((d) => ({
      day: d.day,
      title: d.travelPoint.slice(0, 80),
      route: d.travelPoint,
      attractions: d.attractions.map((a) => a.name).filter(Boolean),
      hotel: d.hotelName,
      meals: { B: d.breakfast, L: d.lunch, D: d.dinner },
    }));
  }
}

// ─── Main entry: scrape → translate → render → PDF ───────────────────────

export async function generateTourComparisonCatalog(
  req: CatalogRequest,
): Promise<CatalogResult> {
  const cfg = COUNTRY_CONFIGS[req.country];
  if (!cfg) throw new Error(`No bucket config for country: ${req.country}`);
  if (cfg.defaultBuckets.length === 0) {
    throw new Error(
      `Country '${req.country}' has no bucket definitions yet. Currently only 'Japan' is supported.`,
    );
  }
  const regionCount = req.regionCount ?? 5;
  const language = req.language ?? "en";

  let buckets = cfg.defaultBuckets;
  if (req.regionsOverride && req.regionsOverride.length > 0) {
    buckets = cfg.defaultBuckets.filter((b) =>
      req.regionsOverride!.includes(b.key),
    );
    if (buckets.length === 0) {
      throw new Error(
        `regionsOverride didn't match any known buckets. Valid keys: ${cfg.defaultBuckets.map((b) => b.key).join(", ")}`,
      );
    }
  }
  buckets = buckets.slice(0, regionCount);

  // ─── Stage 1: scrape sitemap ──────────────────────────────────────────
  const allIds = await fetchSitemapIds();
  if (allIds.length === 0) {
    throw new Error("Lion sitemap returned 0 NormGroupIDs");
  }
  // Shuffle so we sample diversely
  allIds.sort(() => Math.random() - 0.5);

  // ─── Stage 2: batch-verify ───────────────────────────────────────────
  const BATCH = 8;
  const MAX_SCAN = 800;
  const chosen: Record<string, VerifyResult> = {};
  let scanned = 0;
  for (let i = 0; i < Math.min(allIds.length, MAX_SCAN); i += BATCH) {
    const batch = allIds.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((id) => verifyOne(id, buckets, req.month, req.year)),
    );
    scanned += batch.length;
    for (const v of results) {
      if (!v) continue;
      const prev = chosen[v.bucket];
      if (
        !prev ||
        v.septCount > prev.septCount ||
        (v.septCount === prev.septCount && v.price < prev.price)
      ) {
        chosen[v.bucket] = v;
      }
    }
    // Bail once all buckets have ≥3 month-departures
    const allStrong = buckets.every((b) => (chosen[b.key]?.septCount ?? 0) >= 3);
    if (allStrong) break;
  }

  if (Object.keys(chosen).length === 0) {
    throw new Error(
      `Found no tours for ${req.country} ${MONTH_NAMES[req.month - 1]} ${req.year} after scanning ${scanned} candidates`,
    );
  }

  // ─── Stage 3: fetch full data + translate ────────────────────────────
  const options: ComparisonOption[] = [];
  for (const bucket of buckets) {
    const v = chosen[bucket.key];
    if (!v) continue;
    const detailUrl = `${LION_BASE}/detail?NormGroupID=${v.normGroupId}&GroupID=${v.groupId}`;
    const fullData = await fetchLionTravelData(detailUrl);
    if (!fullData) continue;

    // Translate (or pass through for zh-TW)
    const itinerary = await translateItinerary(
      fullData.dailyItinerary.map((d) => ({
        day: d.day,
        travelPoint: d.travelPoint,
        summary: d.summary,
        breakfast: d.breakfast,
        lunch: d.lunch,
        dinner: d.dinner,
        hotelName: d.hotelName,
        attractions: d.attractions,
      })),
      language,
    );

    // Build departures with peak-window marking
    const peakDateSet = new Set<string>(); // YYYY-MM-DD
    // For Japan Sept 2026: Silver Week 9/19-23, Mid-Autumn 9/24-27
    if (req.country === "Japan" && req.month === 9 && req.year === 2026) {
      for (let d = 19; d <= 27; d++) {
        peakDateSet.add(`2026-09-${String(d).padStart(2, "0")}`);
      }
    }

    const monthDeps: ComparisonDeparture[] = fullData.allDepartures
      .filter((dep) => {
        const d = dep.date ?? "";
        const monthStr = String(req.month).padStart(2, "0");
        return (
          d.startsWith(`${req.year}-${monthStr}`) ||
          d.startsWith(`${req.year}/${monthStr}`)
        );
      })
      .map((dep) => {
        const normalized = dep.date.replace(/\//g, "-").slice(0, 10);
        const dayNum = parseInt(normalized.slice(8, 10), 10);
        const dateLabel =
          language === "en"
            ? `${MONTH_NAMES[req.month - 1].slice(0, 4)} ${dayNum}`
            : `${req.month}月${dayNum}日`;
        return {
          dateLabel,
          weekDay: DOW_MAP[dep.weekDay] ?? dep.weekDay,
          isPeak: peakDateSet.has(normalized),
        };
      });

    // Featured: alpine is the standout for Japan Sept (limited season)
    const featured =
      req.country === "Japan" && req.month >= 9 && req.month <= 10 && bucket.key === "alpine";

    options.push({
      title: bucket.label,
      // Best-of-bucket subtitle: use first 100 chars of tour name for hint
      subtitle: v.tourName.slice(0, 120),
      supplierCode: v.normGroupId,
      days: v.tourDays,
      bestFor: bestForByBucket(bucket.key),
      itinerary,
      departures: monthDeps,
      featured,
    });
  }

  if (options.length === 0) {
    throw new Error("All Lion fetches failed — no options available to render");
  }

  // ─── Stage 4: render ────────────────────────────────────────────────
  const html = renderTourComparisonHtml({
    country: cfg.countryName,
    countryCode: cfg.countryCode,
    monthName: MONTH_NAMES[req.month - 1],
    monthNumber: req.month,
    year: req.year,
    supplier: "Lion Travel",
    peakWindows: cfg.peakWindows(req.month, req.year),
    options,
  });

  const pdf = await renderHtmlToPdf(html);

  return {
    pdf,
    meta: {
      country: cfg.countryName,
      monthName: MONTH_NAMES[req.month - 1],
      year: req.year,
      optionsFound: options.length,
      departuresFound: options.reduce((s, o) => s + o.departures.length, 0),
      supplierCodes: options.map((o) => o.supplierCode),
    },
  };
}

// ─── Helper: best-for tagline per bucket ────────────────────────────────

function bestForByBucket(key: string): string {
  switch (key) {
    case "tokyo":
      return "First-time Japan visitors, families, scenic photography";
    case "kansai":
      return "Culture, theme parks, food lovers, repeat travelers";
    case "hokkaido":
      return "Nature lovers, seafood, couples, photography";
    case "kyushu":
      return "Repeat Japan visitors, relaxation, ryokan + onsen lovers";
    case "alpine":
      return "Experienced Japan travelers, scenic photography, alpine landscape";
    default:
      return "General-interest travelers";
  }
}
