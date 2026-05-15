/**
 * Lion Travel B2C public API client (雄獅旅遊).
 *
 * Source: toursbms-api-report.pdf §3 + §7.2, dated 2026-05-15.
 *
 * Quirks (do not refactor away without re-reading the report):
 *   • Search API uses Content-Type: application/json with a body where
 *     EVERY field must be present even if unused — empty strings ('') for
 *     unused string filters, null for nullable bool/string params. The
 *     research went through 5 attempts before landing on this exact shape;
 *     missing fields cause TotalCount=0 silently.
 *   • Detail APIs use Content-Type: application/x-www-form-urlencoded
 *     with `NormGroupID=<uuid>&GroupID=<departureId>`. Different from
 *     search — they share a host but not a wire format.
 *   • Neither path requires cookies. Confirmed server-side via curl.
 *
 * Rate-limit posture: no published limits. The sync service is responsible
 * for jitter / pacing. Don't run more than one concurrent search request
 * from this module — pagination is sequential.
 *
 * Mappings to our normalized shape live in lionSyncService.ts (TBD); this
 * client stays thin — return the raw response, let the orchestrator decide.
 */

import { SupplierApiError } from "./types";

const LION_BASE = "https://travel.liontravel.com";

/**
 * Default headers for all calls. user-agent is mandatory or Lion sometimes
 * returns a 403; using a plain Chrome desktop UA is what their first-party
 * SPA sends.
 */
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
  Origin: LION_BASE,
  Referer: `${LION_BASE}/`,
};

/**
 * Network timeout. Lion's search occasionally takes >3s when the result
 * set is large; 15s is conservative. Detail calls usually return <1s.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────── search API (JSON) ─────────────────────── */

/**
 * Search payload. EVERY field must be present (empty string for unused
 * filter slots, null for nullable bool/string params) or Lion returns
 * TotalCount=0 with no error. See toursbms-api-report.pdf §3.3.1.
 */
export interface LionSearchInput {
  /** ISO date YYYY-MM-DD. */
  goDateStart: string;
  /** ISO date YYYY-MM-DD. Should be ≥ goDateStart. */
  goDateEnd: string;
  /** Page 1-based. */
  page: number;
  /** Max 200 (verified). */
  pageSize: number;
  /** Optional Chinese keyword search ("美國", "夏威夷", etc.). null = unfiltered. */
  keywords?: string | null;
  /** 0 = all travel types. */
  travelType?: number;
  /** 3 = sort by departure date ascending (Lion's default). */
  sortType?: number;
  /** Restrict to specific country code. null = global. */
  arriveId?: string | null;
}

export interface LionGroupEntry {
  GroupID: string;
  GoDate: string; // "2026/05/16"
  Status: "full" | "available" | "hot";
  StatusText: string;
  StraightLowestPrice: string;
  IndustryLowestPrice: string;
  IsVip: boolean;
}

export interface LionNormGroup {
  Index: number;
  NormGroupID: string;
  TourName: string;
  TourDays: number;
  Img: string;
  ImgM: string;
  TravelType: number;
  TourSource: string;
  GroupStraightPrice: string;
  GroupIndustryPrice: string;
  GroupIsVip: boolean;
  Status: number;
  ThemeID: unknown[];
  TagList: Array<{ TagName: string; TagCode: string }>;
  TripTypeList: Array<{ TypeName: string; TypeCode: string }>;
  StartFromCityList: Array<{ CityName: string; CityCode: string }>;
  GroupList: LionGroupEntry[];
}

export interface LionSearchResult {
  TotalCount: number;
  TotalPage: number;
  CurrentPage: number;
  Count: number;
  NormGroupList: LionNormGroup[];
}

export async function searchProducts(
  input: LionSearchInput
): Promise<LionSearchResult> {
  const body = {
    // The order doesn't matter to Lion's server but matches the
    // research doc for human cross-reference.
    ArriveID: input.arriveId ?? null,
    GoDatestart: input.goDateStart,
    GoDateEnd: input.goDateEnd,
    GroupID: null,
    Keywords: input.keywords ?? null,
    IsEnsureGroup: null,
    IsSold: null,
    ThemeID: null,
    TravelPavilionGroupID: null,
    KeywordsCity: null,
    TravelType: input.travelType ?? 0,
    BuIds: "",
    PreferAirlines: null,
    DepartureID: "",
    WeekDay: "",
    PriceList: null,
    AirlineIDs: "",
    TripTypes: "",
    Tags: "",
    SortType: input.sortType ?? 3,
    Days: "",
    Page: input.page,
    PageSize: input.pageSize,
  };

  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      `${LION_BASE}/search/grouplistinfojson`,
      {
        method: "POST",
        headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  } catch (err) {
    throw new SupplierApiError(
      "lion",
      "search/grouplistinfojson",
      "network error",
      err
    );
  }
  if (!resp.ok) {
    throw new SupplierApiError(
      "lion",
      "search/grouplistinfojson",
      `HTTP ${resp.status}`
    );
  }
  const data = (await resp.json()) as LionSearchResult;
  if (typeof data.TotalCount !== "number") {
    throw new SupplierApiError(
      "lion",
      "search/grouplistinfojson",
      "malformed response (no TotalCount)"
    );
  }
  return data;
}

/* ───────────────── detail APIs (form-urlencoded) ───────────────── */

interface DetailKey {
  normGroupId: string;
  groupId: string;
}

async function callDetailEndpoint<T>(
  endpoint: string,
  key: DetailKey
): Promise<T> {
  const body = new URLSearchParams({
    NormGroupID: key.normGroupId,
    GroupID: key.groupId,
  }).toString();

  let resp: Response;
  try {
    resp = await fetchWithTimeout(`${LION_BASE}/detail/${endpoint}`, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch (err) {
    throw new SupplierApiError("lion", `detail/${endpoint}`, "network error", err);
  }
  if (!resp.ok) {
    throw new SupplierApiError(
      "lion",
      `detail/${endpoint}`,
      `HTTP ${resp.status}`
    );
  }
  return (await resp.json()) as T;
}

export interface LionTravelInfo {
  GoAirline?: string;
  GoDepartureTime?: string;
  GoArriveTime?: string;
  GoDepartureAirport?: string;
  GoArriveAirport?: string;
  GoTransferCount?: number;
  BackAirline?: string;
  BackDepartureTime?: string;
  BackArriveTime?: string;
  BackDepartureAirport?: string;
  BackArriveAirport?: string;
  BackTransferCount?: number;
  IsNoFlight?: boolean;
  GroupInfo: {
    TourID: string;
    TourName: string;
    NormGroupID: string;
    NormGroupImg: string;
    TourDays: number;
    GoDate: string;
    BackDate: string;
    Status: string;
    TotalSeats: number;
    QuotaSeats: number;
    SpareSeats: number;
    IsBooked: boolean;
    IsEnsureGroup: boolean;
    IsForeign: boolean;
    Price: number;
    OrigPrice: number;
    StraightLowestPrice: number;
    IndustryLowestPrice: number;
    Country: string;
    CurrencyCode: string;
    SellStartDate: string;
    TagList: unknown[];
    TripTypeList: unknown[];
    StartFromCityList: unknown[];
  };
}

export const getTravelInfo = (key: DetailKey) =>
  callDetailEndpoint<LionTravelInfo>("travelinfojson", key);

export interface LionPriceInfo {
  TourName: string;
  GoDate: string;
  BackDate: string;
  TourDays: number;
  OrderPrice: number;
  CurrencyCode: string;
  IsForeign: boolean;
  VisaPrice?: { CostDesc: string; Cost: number };
  AirportPrice?: { CostDesc: string; Cost: number };
  IsCutPrice?: boolean;
  IsFullPay?: boolean;
  PriceList?: unknown[];
  MultiPricesList?: unknown[];
  Meals?: unknown[];
}

export const getPriceInfo = (key: DetailKey) =>
  callDetailEndpoint<LionPriceInfo>("priceinfojson", key);

export interface LionNoticeInfo {
  NoteList?: unknown[];
  LeaveTeamReg?: string;
  SafeReg?: string;
}

export const getNoticeInfo = (key: DetailKey) =>
  callDetailEndpoint<LionNoticeInfo>("noticeinfojson", key);

export interface LionOptionalInfo {
  OptionalInfoList?: unknown[];
  SelfSelectedList?: unknown[];
}

export const getOptionalInfo = (key: DetailKey) =>
  callDetailEndpoint<LionOptionalInfo>("optionalinfojson", key);

export interface LionTourInfo {
  TourIDList: Array<{
    TourID: string;
    MinGoDate: string;
    MaxGoDate: string;
  }>;
  AllMinGoDate: string;
  AllMaxGoDate: string;
}

export const getTourInfo = (key: DetailKey) =>
  callDetailEndpoint<LionTourInfo>("tourinfojson", key);

/**
 * Generic escape hatch for the 7 detail endpoints we haven't hand-typed
 * (groupcalendarjson, daytripinfojson, calljson, popularinfojson,
 * stationinfojson, packageinfojson, articleinfojson). Returns raw JSON.
 */
export const getDetailRaw = (endpoint: string, key: DetailKey) =>
  callDetailEndpoint<unknown>(endpoint, key);
