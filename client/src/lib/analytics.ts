/**
 * GA4 Analytics Helper
 * Measurement ID: G-91VLGFSK70
 *
 * Provides typed wrappers around window.gtag() for all custom events.
 * All functions are no-ops if gtag is not loaded (e.g., ad-blocker).
 *
 * CCPA/CPRA: gtag.js is NOT loaded on page load. It is injected by loadGA4()
 * only after the user accepts analytics cookies via CookieConsentBanner.
 */

const GA4_MEASUREMENT_ID = "G-91VLGFSK70";

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

/** Has the user accepted analytics cookies (CCPA/CPRA gate). */
function hasAnalyticsConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("pag_cookie_consent") === "all";
  } catch {
    return false;
  }
}

/**
 * Inject the GA4 gtag.js script and update consent to granted.
 * Idempotent — safe to call multiple times (guarded by window.__ga4Loaded).
 * Must be called AFTER the user accepts analytics cookies.
 */
export function loadGA4() {
  if (typeof window === "undefined") return;
  if (!hasAnalyticsConsent()) return;
  const w = window as unknown as { __ga4Loaded?: boolean; gtag?: (...a: unknown[]) => void };
  if (w.__ga4Loaded) {
    w.gtag?.("consent", "update", { analytics_storage: "granted" });
    return;
  }
  w.__ga4Loaded = true;
  w.gtag?.("consent", "update", { analytics_storage: "granted" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
  document.head.appendChild(script);
  w.gtag?.("config", GA4_MEASUREMENT_ID, { anonymize_ip: true });
}

/** Safe gtag caller — skips if gtag is blocked OR user has not opted in. */
function gtag(...args: unknown[]) {
  if (!hasAnalyticsConsent()) return;
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag(...args);
  }
}

// ─── Page View ───────────────────────────────────────────────────────────────

/**
 * Track a page view. Call this inside useEffect on route changes.
 * GA4 fires page_view automatically on first load; this covers SPA navigation.
 */
export function trackPageView(path: string, title?: string) {
  gtag("event", "page_view", {
    page_path: path,
    page_title: title ?? document.title,
  });
}

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Fired when a user submits a search query on SearchResults page.
 */
export function trackSearch(params: {
  keyword: string;
  destination?: string;
  duration?: string;
  budget?: string;
  resultCount?: number;
}) {
  gtag("event", "search", {
    search_term: params.keyword,
    destination: params.destination ?? "",
    duration: params.duration ?? "",
    budget: params.budget ?? "",
    result_count: params.resultCount ?? 0,
  });
}

// ─── Tour Detail ─────────────────────────────────────────────────────────────

/**
 * Fired when a user views a tour detail page.
 */
export function trackViewTour(params: {
  tourId: string | number;
  tourName: string;
  destination?: string;
  price?: number;
  currency?: string;
}) {
  gtag("event", "view_tour", {
    tour_id: String(params.tourId),
    tour_name: params.tourName,
    destination: params.destination ?? "",
    value: params.price ?? 0,
    currency: params.currency ?? "TWD",
  });

  // Also fire GA4 standard view_item for e-commerce reports
  gtag("event", "view_item", {
    currency: params.currency ?? "TWD",
    value: params.price ?? 0,
    items: [
      {
        item_id: String(params.tourId),
        item_name: params.tourName,
        item_category: params.destination ?? "",
        price: params.price ?? 0,
      },
    ],
  });
}

// ─── Checkout ────────────────────────────────────────────────────────────────

/**
 * Fired when a user enters the booking / checkout flow.
 */
export function trackBeginCheckout(params: {
  tourId: string | number;
  tourName: string;
  price: number;
  currency?: string;
  numTravelers?: number;
}) {
  gtag("event", "begin_checkout", {
    currency: params.currency ?? "TWD",
    value: params.price,
    items: [
      {
        item_id: String(params.tourId),
        item_name: params.tourName,
        price: params.price,
        quantity: params.numTravelers ?? 1,
      },
    ],
  });
}

// ─── Purchase ────────────────────────────────────────────────────────────────

/**
 * Fired when a booking is confirmed / payment succeeds.
 */
export function trackPurchase(params: {
  orderId: string | number;
  tourId: string | number;
  tourName: string;
  value: number;
  currency?: string;
  numTravelers?: number;
}) {
  gtag("event", "purchase", {
    transaction_id: String(params.orderId),
    currency: params.currency ?? "TWD",
    value: params.value,
    items: [
      {
        item_id: String(params.tourId),
        item_name: params.tourName,
        price: params.value,
        quantity: params.numTravelers ?? 1,
      },
    ],
  });
}

// ─── China Visa Funnel ───────────────────────────────────────────────────────
/**
 * Fired when a user starts the China visa application wizard (Step 1).
 */
export function trackVisaStart() {
  gtag("event", "visa_start", {
    event_category: "china_visa",
    event_label: "wizard_step_1",
  });
}

/**
 * Fired when a user advances to a specific step in the visa wizard.
 */
export function trackVisaStep(step: number, stepName: string) {
  gtag("event", "visa_step", {
    event_category: "china_visa",
    step_number: step,
    step_name: stepName,
  });
}

/**
 * Fired when a user submits the visa application and proceeds to payment.
 */
export function trackVisaCheckout(params: {
  applicantCount: number;
  totalAmount: number;
}) {
  gtag("event", "visa_checkout", {
    event_category: "china_visa",
    applicant_count: params.applicantCount,
    value: params.totalAmount,
    currency: "USD",
  });
  // Also fire GA4 standard begin_checkout
  gtag("event", "begin_checkout", {
    currency: "USD",
    value: params.totalAmount,
    items: [
      {
        item_id: "china_visa",
        item_name: "中國簽證代辦",
        price: params.totalAmount,
        quantity: params.applicantCount,
      },
    ],
  });
}

/**
 * Fired when a visa application payment is confirmed (on /china-visa/success).
 */
export function trackVisaPurchase(params: {
  applicationId: number;
  totalAmount: number;
  applicantCount: number;
}) {
  gtag("event", "purchase", {
    transaction_id: `visa_${params.applicationId}`,
    currency: "USD",
    value: params.totalAmount,
    items: [
      {
        item_id: "china_visa",
        item_name: "中國簽證代辦",
        price: params.totalAmount,
        quantity: params.applicantCount,
      },
    ],
  });
}

// ─── Affiliate / Trip.com clickout ───────────────────────────────────────────
/** The closed set of clickout sources — mirrors the server /go/trip/:source enum. */
export type TripRedirectSource = "flight_search" | "hotel_search" | "tour_flight" | "tour_hotel";

const TRIP_REDIRECT_SOURCES: ReadonlySet<string> = new Set([
  "flight_search", "hotel_search", "tour_flight", "tour_hotel",
]);

/**
 * Fired when a customer clicks a Trip.com clickout button. GA receives ONLY the
 * closed source enum and a fixed destination marker — never any free-text route,
 * city, name or other user input (that would leak PII to a third party). The enum
 * is re-checked at runtime so even a type-cast caller cannot push an arbitrary
 * string to GA (it collapses to "unknown"). Phase 1 is homepage-only, so the
 * destination is always `homepage_redirect`.
 */
export function trackAffiliateClick(source: TripRedirectSource) {
  gtag("event", "affiliate_click", {
    event_category: "affiliate",
    source: TRIP_REDIRECT_SOURCES.has(source) ? source : "unknown",
    destination: "homepage_redirect",
  });
}

// ─── Newsletter ──────────────────────────────────────────────────────────────
/**
 * Fired when a user subscribes to the newsletter.
 */
export function trackNewsletterSignup(source: string) {
  gtag("event", "newsletter_signup", {
    event_category: "engagement",
    source,
  });
}

// ─── Contact / Inquiry ───────────────────────────────────────────────────────
/**
 * Fired when a user submits a contact or inquiry form.
 */
export function trackInquirySubmit(params: {
  tourId?: string | number;
  tourName?: string;
  inquiryType?: string;
}) {
  gtag("event", "inquiry_submit", {
    event_category: "lead",
    tour_id: params.tourId ? String(params.tourId) : "",
    tour_name: params.tourName ?? "",
    inquiry_type: params.inquiryType ?? "general",
  });
}
