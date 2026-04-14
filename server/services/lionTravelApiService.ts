/**
 * Round 50: Liontravel Direct API Integration
 * Fetches structured tour data directly from liontravel.com JSON endpoints,
 * completely bypassing Puppeteer. Reduces scrape time from ~55s to ~2s.
 */

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface LionAttractionItem {
  name: string;
  visitWayDesc: string;
  imgUrl: string;
}

export interface LionDailyItinerary {
  day: number;
  travelPoint: string;
  specialNote: string;
  summary: string;
  breakfast: string;
  lunch: string;
  dinner: string;
  hotelName: string;
  attractions: LionAttractionItem[];
}

export interface LionFlight {
  airline: string;
  departureTime: string;
  arriveTime: string;
  departureAirport: string;
  arriveAirport: string;
}

export interface LionPricing {
  adultPrice: number;
  childWithBed: number;
  childNoBed: number;
  babyPrice: number;
  deposit: number;
  singleSupplement: string;
  currencyCode: string;
}

export interface LionNotice {
  title: string;
  chineseTitle: string;
  content: string;
}

export interface LionTravelApiData {
  // Basic info
  tourName: string;
  tourId: string;
  normGroupId: string;
  groupId: string;
  tourDays: number;
  goDate: string;
  backDate: string;
  // Price & availability
  price: number;
  currencyCode: string;
  totalSeats: number;
  spareSeats: number;
  heroImageUrl: string;
  // Tags & classification
  tags: string[];
  tripTypes: string[];
  departureCity: string;
  // Flights
  outboundFlight: LionFlight;
  returnFlight: LionFlight;
  // Itinerary
  dailyItinerary: LionDailyItinerary[];
  // Pricing details
  pricing: LionPricing;
  // Notices
  notices: LionNotice[];
  // Raw features HTML for ContentAnalyzer
  featuresHtml: string;
}

// ─── HTML Utilities ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeParseFloat(val: string | number | null | undefined): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

// ─── POST Helper ────────────────────────────────────────────────────────────────

const LION_BASE = 'https://travel.liontravel.com';
const DEFAULT_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
};

async function postJson(
  path: string,
  body: Record<string, string>,
  referer: string,
  signal: AbortSignal
): Promise<any> {
  const formBody = new URLSearchParams(body).toString();
  const resp = await fetch(`${LION_BASE}${path}`, {
    method: 'POST',
    headers: { ...DEFAULT_HEADERS, Referer: referer },
    body: formBody,
    signal,
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${path}`);
  }
  return resp.json();
}

// ─── Main Export ────────────────────────────────────────────────────────────────

export async function fetchLionTravelData(
  url: string
): Promise<LionTravelApiData | null> {
  // Only handle liontravel.com detail pages
  if (!url.includes('liontravel.com')) return null;

  let normGroupId: string;
  try {
    normGroupId = new URL(url).searchParams.get('NormGroupID') || '';
  } catch {
    return null;
  }
  if (!normGroupId) return null;

  const referer = url;
  const signal = AbortSignal.timeout(15000);

  try {
    // ── Step 1: travelinfojson → get GroupID + basic info + flights ──────────
    const travelRaw = await postJson(
      '/detail/travelinfojson',
      { NormGroupID: normGroupId },
      referer,
      signal
    );

    const gi = travelRaw?.GroupInfo ?? {};
    const groupId: string = gi.GroupID ?? '';

    if (!groupId) {
      console.warn(`[LionAPI] travelinfojson returned no GroupID for ${normGroupId}`);
      return null;
    }

    // ── Step 2: parallel fetch daytripinfojson + priceinfojson + noticeinfojson
    const [daytripRaw, priceRaw, noticeRaw] = await Promise.all([
      postJson(
        '/detail/daytripinfojson',
        { NormGroupID: normGroupId, GroupID: groupId },
        referer,
        signal
      ),
      postJson(
        '/detail/priceinfojson',
        { NormGroupID: normGroupId, GroupID: groupId },
        referer,
        signal
      ),
      postJson(
        '/detail/noticeinfojson',
        { NormGroupID: normGroupId, GroupID: groupId },
        referer,
        signal
      ).catch(() => ({ NoteList: [] })), // noticeinfojson is optional
    ]);

    // ── Parse travelinfojson ──────────────────────────────────────────────────
    const outboundFlight: LionFlight = {
      airline: gi.GoAirline ?? '',
      departureTime: gi.GoDepartureTime ?? '',
      arriveTime: gi.GoArriveTime ?? '',
      departureAirport: gi.GoDepartureAirport ?? '',
      arriveAirport: gi.GoArriveAirport ?? '',
    };
    const returnFlight: LionFlight = {
      airline: gi.BackAirline ?? '',
      departureTime: gi.BackDepartureTime ?? '',
      arriveTime: gi.BackArriveTime ?? '',
      departureAirport: gi.BackDepartureAirport ?? '',
      arriveAirport: gi.BackArriveAirport ?? '',
    };

    const tags: string[] = (gi.TagList ?? []).map((t: any) =>
      typeof t === 'string' ? t : (t.TagName ?? t.Name ?? String(t))
    );
    const tripTypes: string[] = (gi.TripTypeList ?? []).map((t: any) =>
      typeof t === 'string' ? t : (t.Name ?? String(t))
    );
    const departureCities: string[] = (gi.StartFromCityList ?? []).map(
      (c: any) => (typeof c === 'string' ? c : (c.CityName ?? String(c)))
    );

    // ── Parse daytripinfojson ─────────────────────────────────────────────────
    const dailyList: any[] = daytripRaw?.DailyList ?? [];
    const featuresHtml: string = daytripRaw?.Features ?? '';

    const dailyItinerary: LionDailyItinerary[] = dailyList.map((d: any) => {
      const attractions: LionAttractionItem[] = (d.AttractionsList ?? []).map(
        (a: any) => ({
          name: stripHtml(a.Name ?? ''),
          visitWayDesc: stripHtml(a.VisitWayDesc ?? ''),
          imgUrl: a.ImgUrl ?? '',
        })
      );
      // Hotel: prefer HotelList[0].HotelName, fallback to HotelDesc
      const hotelName =
        (d.HotelList ?? [])[0]?.HotelName ??
        stripHtml(d.HotelDesc ?? '');

      return {
        day: d.Day ?? 0,
        travelPoint: stripHtml(d.TravelPoint ?? ''),
        specialNote: stripHtml(d.SpecialNote ?? ''),
        summary: stripHtml(d.Summary ?? ''),
        breakfast: d.Breakfast ?? '',
        lunch: d.Lunch ?? '',
        dinner: d.Dinner ?? '',
        hotelName,
        attractions,
      };
    });

    // ── Parse priceinfojson ───────────────────────────────────────────────────
    // MultiPricesList[0].GroupPricesList[0] has the most detailed pricing
    const multiPrices = priceRaw?.MultiPricesList ?? [];
    const groupPrices =
      (multiPrices[0]?.GroupPricesList ?? [])[0] ?? {};

    const pricing: LionPricing = {
      adultPrice: safeParseFloat(groupPrices.AdultsPriceOrig ?? priceRaw?.StraightLowestPrice),
      childWithBed: safeParseFloat(groupPrices.ChildrenWithBedOrig),
      childNoBed: safeParseFloat(groupPrices.ChildrenNoPriceOrig),
      babyPrice: safeParseFloat(groupPrices.BabyPriceOrig),
      deposit: safeParseFloat(priceRaw?.OrderPrice),
      singleSupplement: priceRaw?.StraightRemarks ?? '',
      currencyCode: priceRaw?.CurrencyCode ?? gi.CurrencyCode ?? 'TWD',
    };

    // Fallback: if adultPrice is 0, try PriceList[0].Price
    if (pricing.adultPrice === 0) {
      const priceList = priceRaw?.PriceList ?? [];
      if (priceList.length > 0) {
        pricing.adultPrice = safeParseFloat(priceList[0].Price ?? priceList[0].AdultPrice);
      }
    }
    // Final fallback: StraightLowestPrice from GroupInfo
    if (pricing.adultPrice === 0 && gi.StraightLowestPrice) {
      pricing.adultPrice = safeParseFloat(gi.StraightLowestPrice);
    }

    // ── Parse noticeinfojson ──────────────────────────────────────────────────
    const notices: LionNotice[] = (noticeRaw?.NoteList ?? []).map((n: any) => ({
      title: n.Title ?? '',
      chineseTitle: n.CTitle ?? '',
      content: stripHtml(n.Desc ?? ''),
    }));

    // ── Assemble result ───────────────────────────────────────────────────────
    const result: LionTravelApiData = {
      tourName: stripHtml(gi.TourName ?? daytripRaw?.TourName ?? ''),
      tourId: gi.TourID ?? '',
      normGroupId,
      groupId,
      tourDays: gi.TourDays ?? daytripRaw?.TourDays ?? priceRaw?.TourDays ?? 0,
      goDate: gi.GoDate ?? '',
      backDate: gi.BackDate ?? '',
      price: safeParseFloat(gi.Price?.replace?.(/,/g, '') ?? gi.StraightLowestPrice),
      currencyCode: gi.CurrencyCode ?? pricing.currencyCode ?? 'TWD',
      totalSeats: gi.TotalSeats ?? 0,
      spareSeats: gi.SpareSeats ?? 0,
      heroImageUrl: gi.NormGroupImg ?? '',
      tags,
      tripTypes,
      departureCity: departureCities[0] ?? '',
      outboundFlight,
      returnFlight,
      dailyItinerary,
      pricing,
      notices,
      featuresHtml,
    };

    // If top-level price is 0, use adultPrice from pricing
    if (result.price === 0 && pricing.adultPrice > 0) {
      result.price = pricing.adultPrice;
    }

    return result;
  } catch (err: any) {
    console.warn(`[LionAPI] fetchLionTravelData failed: ${err?.message ?? err}`);
    return null;
  }
}

// ─── buildRawContentFromLionData ────────────────────────────────────────────────

export function buildRawContentFromLionData(data: LionTravelApiData): string {
  const lines: string[] = [];
  lines.push(`行程名稱：${data.tourName}`);
  lines.push(`天數：${data.tourDays}天`);
  if (data.price > 0) {
    lines.push(`價格：${data.price.toLocaleString()} ${data.currencyCode}`);
  }
  if (data.goDate) lines.push(`出發日期：${data.goDate}`);
  if (data.departureCity) lines.push(`出發城市：${data.departureCity}`);

  // Flights
  if (data.outboundFlight.airline) {
    lines.push(
      `去程航班：${data.outboundFlight.airline} ${data.outboundFlight.departureAirport}→${data.outboundFlight.arriveAirport} ${data.outboundFlight.departureTime}`
    );
  }
  if (data.returnFlight.airline) {
    lines.push(
      `回程航班：${data.returnFlight.airline} ${data.returnFlight.departureAirport}→${data.returnFlight.arriveAirport} ${data.returnFlight.departureTime}`
    );
  }

  lines.push('');

  // Daily itinerary
  for (const day of data.dailyItinerary) {
    lines.push(`第${day.day}天：${day.travelPoint}`);
    if (day.specialNote) lines.push(`  ★ ${day.specialNote}`);
    if (day.summary) lines.push(`  ${day.summary}`);

    const mealParts: string[] = [];
    if (day.breakfast) mealParts.push(`早餐：${day.breakfast}`);
    if (day.lunch) mealParts.push(`午餐：${day.lunch}`);
    if (day.dinner) mealParts.push(`晚餐：${day.dinner}`);
    if (mealParts.length > 0) lines.push(`  ${mealParts.join(' / ')}`);

    if (day.hotelName) lines.push(`  住宿：${day.hotelName}`);

    for (const attr of day.attractions) {
      if (attr.name) {
        lines.push(`  景點：${attr.name}${attr.visitWayDesc ? ' — ' + attr.visitWayDesc : ''}`);
      }
    }
  }

  // Notices
  if (data.notices.length > 0) {
    lines.push('');
    lines.push('注意事項：');
    for (const n of data.notices) {
      if (n.chineseTitle) {
        lines.push(`【${n.chineseTitle}】${n.content.slice(0, 200)}`);
      }
    }
  }

  return lines.join('\n');
}
