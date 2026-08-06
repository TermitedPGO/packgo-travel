/**
 * UV Bookings (Universal Vision / ToursBMS) public storefront API client.
 *
 * Source: toursbms-api-report.pdf §2.7 + §7.3, dated 2026-05-15.
 *
 * Architecture:
 *   The UV Bookings public storefront (uvbookings.toursbms.com) is a
 *   React + Ctrip nfes frontend that proxies to Ctrip's SOA2 API gateway
 *   at online.ctrip.com/restapi/soa2/{serviceId}/{endpoint}.json. The
 *   B2B BMS backend (bms.toursbms.com) uses the SAME gateway but with
 *   cookie auth (travelagency_token) — we don't use that path until
 *   Phase 3 (Playwright auto-book).
 *
 *   Key breakthrough from the research: the public storefront uses
 *   HEADER-based auth (no cookies, no token). Five HTTP headers identify
 *   the request as a guest of UV's storefront. Server-side curl verified.
 *
 * Pack&Go agent codes (for future BMS-authenticated calls, Phase 3):
 *   jgCode    = B00006135  (代理商代碼)
 *   userCode  = U00005218  (使用者代碼)
 *   jgUpCode  = B00000003  (UV's root branch code, same as UV_BRANCH_CODE)
 *
 * Service IDs in use:
 *   17626 — 產品服務 (157 endpoints): catalog + detail + departures
 *   17615 — 團期/團隊服務 (141 endpoints): future booking flow
 *   17113 — 系統服務 (142 endpoints): toursLogin, getUserMain
 *   18244 — 訂單服務 (90 endpoints): future order CRUD
 */

import { SupplierApiError } from "./types";
import { uvImportLanguage, type UvLanguage } from "../_core/featureFlags";

const SOA2_BASE = "https://online.ctrip.com/restapi/soa2";

/** UV's root branch code. Same value populates branchcode header + body. */
const UV_BRANCH_CODE = "B00000003";

/** Guest user body sent on every public-storefront call. */
const GUEST_USER = {
  branchcode: UV_BRANCH_CODE,
  upBranchCode: UV_BRANCH_CODE,
  userCode: "U000000",
  userName: "GUEST",
  systemCode: 0,
};

/**
 * 每次請求組一份 headers。
 *
 * 這裡原本是模組層級常數,`languageCode` 寫死 `"3"`(英文),註解寫著
 * 「UV storefront defaults to English」—— 當初照供應商前台預設值抄下來。
 * 後果不只是「名錄是英文」:`supplierSync/hydration.ts` 是零 LLM 的純轉換,
 * 供應商給的英文字會原封不動寫進 `tours` 對客欄位,客人頁就長出英文原文。
 * 歷史裁定不美化 —— 記在這裡是為了讓下一個人看得懂為什麼改成函式。
 *
 * 改成函式(而非常數)是因為語言要在**請求時**決定,不能在模組載入時凍結。
 * 語言來自 `featureFlags.uvImportLanguage()`,預設繁中;該檔為 boot 時讀取、
 * 無快取,所以這裡不需要另外做快取。
 */
function commonHeaders(lang: UvLanguage) {
  return {
    "Content-Type": "application/json",
    branchcode: UV_BRANCH_CODE,
    languageCode: lang.code,
    "X-Requested-With": "XMLHttpRequest",
    Origin: "https://uvbookings.toursbms.com",
    Referer: "https://uvbookings.toursbms.com/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": lang.acceptLanguage,
  };
}

// 2026-05-16: same bump rationale as lionClient.ts — Ctrip SOA2's
// gateway gives sub-second responses warm but can stall past 15s when
// the storefront API gets a burst from our paginated sync.
const DEFAULT_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Standard SOA2 response envelope.
 *   responseResult.code === 200 = success
 *   responseResult.code !== 200 = soft failure (HTTP often still 200);
 *                                  msg / msgCode contain the detail
 */
interface SoaResponse<T> {
  ResponseStatus: { Ack: string; Errors: unknown[] };
  responseResult: { code: number; msg: string; msgCode: string };
  responseData: T;
}

/**
 * 語言由本函式統一注入 header 與 body,呼叫點不再各自帶 `productLanguage`。
 *
 * 這是刻意的結構性保證:UV 的語言要同時出現在 header(`languageCode`)與
 * body(`productLanguage`),兩者若能各自設定,就有「header 說中文、body 說
 * 英文」而無人察覺的空間。兩者同源於一次 `uvImportLanguage()`,不可能不一致。
 *
 * 因此 `productLanguage` 放在 `...body` **之後**:語言是傳輸層的事,由本函式
 * 擁有,不是可以從 body 夾帶進來的每次呼叫參數。日後若真有單次指定語言的需求,
 * 請加一個明確的 opts 參數,不要從 body 偷渡。
 */
async function callSoa<T>(
  serviceId: number,
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = `${SOA2_BASE}/${serviceId}/${endpoint}.json`;
  const lang = uvImportLanguage();
  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: commonHeaders(lang),
      body: JSON.stringify({
        requestUser: GUEST_USER,
        ...body,
        productLanguage: lang.num,
      }),
    });
  } catch (err) {
    throw new SupplierApiError("uv", `${serviceId}/${endpoint}`, "network error", err);
  }
  if (!resp.ok) {
    throw new SupplierApiError(
      "uv",
      `${serviceId}/${endpoint}`,
      `HTTP ${resp.status}`
    );
  }
  const data = (await resp.json()) as SoaResponse<T>;
  if (data.responseResult?.code !== 200) {
    throw new SupplierApiError(
      "uv",
      `${serviceId}/${endpoint}`,
      `responseResult ${data.responseResult?.code} ${data.responseResult?.msg ?? ""} (${data.responseResult?.msgCode ?? ""})`
    );
  }
  return data.responseData;
}

/* ─────────────────── product list (Service 17626) ─────────────────── */

export interface UvProductListItem {
  productCode: string; // e.g. "P00008687"
  productViewCode: string;
  groupNo: string; // e.g. "YXYYVR8-A"
  productName: string;
  departCityName: string;
  destinationName: string;
  tripDay: number;
  nightDay: number;
  groupLatelyDate: string;
  groupLatelyPrice: number;
  tempImageUrl: string;
  productCurrencyNum: string; // "USD"
  confirmType: number; // 1 = manual, 2 = auto
}

export interface UvProductListResponse {
  pager: { totalCount: number; pageIndex: number; pageSize: number };
  list: UvProductListItem[];
}

export interface UvListInput {
  page: number;
  pageSize: number; // max 200
  keywords?: string;
  /** beginGroupDate / endGroupDate filter the visible departure window. */
  beginGroupDate?: string;
  endGroupDate?: string;
}

export async function listProducts(
  input: UvListInput
): Promise<UvProductListResponse> {
  return callSoa<UvProductListResponse>(17626, "getPagerProductTemp", {
    keywords: input.keywords ?? "",
    currencyCode: "CI00000002", // USD
    productOrderBy: 1, // default
    // productLanguage 由 callSoa 統一注入(與 header languageCode 同源)
    status: 200, // active
    pager: { pageIndex: input.page, pageSize: input.pageSize },
    departCountryCode: "",
    departCityCode: "",
    leaveCode: "",
    destinationCode: "",
    productType: "",
    tagIds: "",
    tripDays: "",
    beginTripDay: -1,
    endTripDay: -1,
    beginGroupPrice: -1,
    endGroupPrice: -1,
    beginGroupDate: input.beginGroupDate ?? "",
    endGroupDate: input.endGroupDate ?? "",
    productTransfer: "",
    productForm: "",
    confirmType: "",
  });
}

/* ─────────────────── product detail (Service 17626) ─────────────────── */

export interface UvProductMain {
  productCode: string;
  groupNo: string;
  productName: string;
  tripDay: number;
  nightDay: number;
  departureDate?: string;
  rewardCode?: string;
  createTime?: string;
  [key: string]: unknown;
}

export async function getProductMain(productCode: string): Promise<UvProductMain> {
  // productLanguage 由 callSoa 統一注入(與 header languageCode 同源)
  return callSoa<UvProductMain>(17626, "getProductMain", { productCode });
}

export interface UvProductTravelDetail {
  productTravel?: unknown;
  productNotice?: unknown;
  productCost?: unknown;
  productShop?: unknown;
  [key: string]: unknown;
}

export async function getProductTravelDetail(
  productCode: string
): Promise<UvProductTravelDetail> {
  // productLanguage 由 callSoa 統一注入(與 header languageCode 同源)
  return callSoa<UvProductTravelDetail>(17626, "getProductTravelDetail", {
    productCode,
  });
}

/* ─────────────────── departures (Service 17626) ─────────────────── */

export interface UvDepartureRow {
  groupDate: string; // "2026-05-01"
  groupStock: number;
  groupSaleStock: number;
  stockStatus: number; // 200 = sellable
  groupPrice: Array<{
    priceType: number; // ROOM OCCUPANCY (not pax type): 3=單人入住 / 4=兩人一房 / 5=三人 / 6=四人
    groupPrice: number;
  }>;
  currencyNum: string;
  [key: string]: unknown;
}

/**
 * getProductGroup returns departures within a date window.
 *
 * Quirk: dates here are datetime strings ("YYYY-MM-DD HH:MM:SS"), not
 * the YYYY-MM-DD format used by other UV endpoints. The research had to
 * unify this by hand — don't pass a bare date or you'll get an empty
 * list with code 200 and no error.
 */
export async function getProductGroup(input: {
  productCode: string;
  startTime: string; // "YYYY-MM-DD HH:MM:SS"
  endTime: string; // "YYYY-MM-DD HH:MM:SS"
}): Promise<UvDepartureRow[]> {
  const data = await callSoa<{ list?: UvDepartureRow[] } | UvDepartureRow[]>(
    17626,
    "getProductGroup",
    {
      startTime: input.startTime,
      endTime: input.endTime,
      productCode: input.productCode,
      currencyCode: "CI00000002",
      stockStatus: 200,
    }
  );
  // The SOA2 response shape for getProductGroup wraps the rows in either
  // a `list` field or a bare array depending on language pack. Normalize.
  if (Array.isArray(data)) return data;
  return data.list ?? [];
}

/**
 * Convenience helper — wraps getProductGroup with sane defaults
 * (today → today+180days, full-day datetime padding).
 */
export async function getDeparturesNext180Days(
  productCode: string
): Promise<UvDepartureRow[]> {
  const today = new Date();
  const end = new Date(today.getTime() + 180 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return getProductGroup({
    productCode,
    startTime: `${fmt(today)} 00:00:00`,
    endTime: `${fmt(end)} 23:59:59`,
  });
}
