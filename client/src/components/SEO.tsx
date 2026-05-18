import { Helmet } from "react-helmet-async";
import { useLocale } from "@/contexts/LocaleContext";

// Production canonical domain. SEO audit 2026-05-09 found the previous fly.dev
// fallback was being emitted as canonical/og:url/hreflang on every page, which
// pointed Googlebot at a 308-redirecting domain (fly.dev → packgoplay.com) for
// every signal — weakening canonicalization. packgoplay.com is the real
// production hostname.
const SITE_URL = "https://packgoplay.com";
const SITE_NAME_ZH = "PACK&GO 旅行社";
const SITE_NAME_EN = "PACK&GO Travel";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.jpg`;

interface SEOProps {
  /**
   * Either a plain string (same in both languages) or a { zh, en } tuple.
   * Round 72: existing callers pass strings — those continue to work unchanged.
   */
  title?: string | { zh: string; en: string };
  description?: string | { zh: string; en: string };
  image?: string;
  url?: string;
  type?: "website" | "article";
  /** Schema.org JSON-LD structured data */
  schema?: object | object[];
  /**
   * Round 80.25: emit `<meta name="robots" content="noindex, nofollow">`.
   * Use for auth pages, payment results, booking detail, profile, search
   * results, /preview/*, admin pages — anywhere the URL is per-user, post-
   * purchase, or shouldn't appear in SERPs.
   */
  noindex?: boolean;
}

/**
 * Pick the locale-appropriate string from either a plain string (same in both
 * languages) or a { zh, en } tuple.
 */
function pickLocalized(
  value: string | { zh: string; en: string } | undefined,
  isEn: boolean
): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  return isEn ? value.en : value.zh;
}

/**
 * SEO component using react-helmet-async
 * Injects dynamic <head> meta tags and Schema.org JSON-LD for each page.
 *
 * Round 72: now locale-aware. og:locale is set based on current language,
 * and the default fallbacks pick the right language. Callers can optionally
 * pass { zh, en } tuples for title/description to localize per-page meta.
 */
export default function SEO({
  title,
  description,
  image,
  url,
  type = "website",
  schema,
  noindex = false,
}: SEOProps) {
  const { language } = useLocale();
  const isEn = language === "en";
  const siteName = isEn ? SITE_NAME_EN : SITE_NAME_ZH;

  const resolvedTitle = pickLocalized(title, isEn);
  const resolvedDesc = pickLocalized(description, isEn);

  // Guard against double-branding. Many page i18n titles already include
  // "PACK&GO" / "PACK&GO 旅行社" / "PACK&GO Travel" — appending the site name
  // again produces "...｜PACK&GO 旅行社 | PACK&GO 旅行社". When the page-supplied
  // title already mentions PACK&GO, keep it as-is; otherwise append.
  const alreadyBranded = resolvedTitle && /PACK\s*&\s*GO/i.test(resolvedTitle);
  const fullTitle = resolvedTitle
    ? alreadyBranded
      ? resolvedTitle
      : `${resolvedTitle} | ${siteName}`
    : isEn
      ? `${siteName} | Professional Travel Planning`
      : `${siteName} | 專業旅遊規劃`;

  const metaDesc =
    resolvedDesc ??
    (isEn
      ? "PACK&GO Travel offers professional travel planning: group tours, custom itineraries, flight & hotel booking, cruise packages, and more."
      : "PACK&GO 旅行社提供專業旅遊規劃服務，包含團體旅遊、客製行程、機票預訂、飯店預訂、郵輪旅遊等服務。");

  // Round 80.7: absolutize relative image paths so og:image always carries
  // a full https URL (Facebook / LINE / Twitter card crawlers reject relative).
  const rawImage = image ?? DEFAULT_OG_IMAGE;
  const metaImage = /^https?:\/\//.test(rawImage) ? rawImage : `${SITE_URL}${rawImage.startsWith("/") ? "" : "/"}${rawImage}`;
  const metaUrl = url ? `${SITE_URL}${url}` : SITE_URL;
  const ogLocale = isEn ? "en_US" : "zh_TW";

  // hreflang alternate URLs — share the same canonical path, language via ?lang= param
  const pathOnly = url ?? "/";
  const separator = pathOnly.includes("?") ? "&" : "?";
  const zhUrl = `${SITE_URL}${pathOnly}`;
  const enUrl = `${SITE_URL}${pathOnly}${separator}lang=en`;

  // Normalise schema to array
  const schemas = schema ? (Array.isArray(schema) ? schema : [schema]) : [];

  return (
    <Helmet>
      {/* Primary */}
      <html lang={isEn ? "en" : "zh-TW"} />
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <link rel="canonical" href={metaUrl} />

      {/* hreflang alternates — tells Google which URL serves which language */}
      <link rel="alternate" hrefLang="zh-TW" href={zhUrl} />
      <link rel="alternate" hrefLang="en" href={enUrl} />
      <link rel="alternate" hrefLang="x-default" href={zhUrl} />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={metaUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:image" content={metaImage} />
      <meta property="og:locale" content={ogLocale} />
      <meta property="og:locale:alternate" content={isEn ? "zh_TW" : "en_US"} />
      <meta property="og:site_name" content={siteName} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDesc} />
      <meta name="twitter:image" content={metaImage} />

      {/* Schema.org JSON-LD */}
      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(s)}
        </script>
      ))}
    </Helmet>
  );
}

// ─── Schema.org helpers ───────────────────────────────────────────────────────

/** Organization / TravelAgency schema for the homepage.
 *  Round 80.25 — enriched with full PostalAddress, telephone, founder,
 *  license number, opening hours, geo, and area served. Data sourced from
 *  client/src/lib/brand.ts (single source of truth). Without these fields,
 *  Google Knowledge Graph couldn't emit a brand panel for "PACK&GO 旅行社"
 *  branded searches; AI engines (ChatGPT/Perplexity/Claude) couldn't
 *  extract canonical business info for citations. */
export function buildOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    "@id": `${SITE_URL}#organization`,
    name: SITE_NAME_ZH,
    alternateName: [SITE_NAME_EN, "PACK&GO LLC", "PACK&GO 旅行社"],
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/images/logo-bag-black-v3.png`,
      width: 99,
      height: 140,
    },
    image: `${SITE_URL}/og-image.jpg`,
    description:
      "PACK&GO 旅行社提供專業旅遊規劃服務，包含團體旅遊、客製行程、機票預訂、飯店預訂、郵輪旅遊等服務。",
    telephone: "+1-510-634-2307",
    email: "support@packgo.us",
    address: {
      "@type": "PostalAddress",
      streetAddress: "39055 Cedar Blvd #126",
      addressLocality: "Newark",
      addressRegion: "CA",
      postalCode: "94560",
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 37.5266,
      longitude: -122.0405,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "09:00",
        closes: "18:00",
      },
    ],
    founder: {
      "@type": "Person",
      name: "Jeff Hsieh",
      jobTitle: "Founder",
    },
    areaServed: [
      { "@type": "Country", name: "United States" },
      { "@type": "Country", name: "Taiwan" },
      { "@type": "AdministrativeArea", name: "San Francisco Bay Area" },
    ],
    knowsLanguage: ["zh-TW", "zh-CN", "en"],
    priceRange: "$$$",
    identifier: [
      { "@type": "PropertyValue", propertyID: "CST", value: "2166984" },
      {
        "@type": "PropertyValue",
        propertyID: "Newark Business License",
        value: "115594",
      },
    ],
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+1-510-634-2307",
      email: "support@packgo.us",
      contactType: "customer service",
      availableLanguage: ["Chinese", "English"],
      areaServed: ["US", "TW"],
    },
  };
}

/** WebSite schema with sitelinks searchbox */
export function buildWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME_ZH,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** BreadcrumbList schema. Helps Google render breadcrumb-trail rich
 *  snippets in SERPs ("packgoplay.com › Tours › Switzerland 10-Day...").
 *  Pass an ordered array of {name, url} from page-level context. */
export function buildBreadcrumbSchema(
  items: Array<{ name: string; url: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

/** TouristTrip schema for individual tour detail pages.
 *  Round 80.25 — added aggregateRating (rich-result eligible star ratings),
 *  multi-image array, availableLanguage (Mandarin guide selling point),
 *  validFrom/validThrough on offer. priceCurrency now defaults to USD
 *  (PACK&GO bills in USD; TWD fallback was inverted). Provider links to
 *  the TravelAgency entity declared on the homepage via @id. */
export function buildTourSchema(tour: {
  id: number;
  title: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  duration?: number | null;
  destination?: string | null;
  images?: string[] | null;
  rating?: number | null;
  totalReviews?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const allImages =
    tour.images && tour.images.length > 0
      ? tour.images.filter((u) => /^https?:/.test(u))
      : [DEFAULT_OG_IMAGE];
  return {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    "@id": `${SITE_URL}/tours/${tour.id}#trip`,
    name: tour.title,
    description: tour.description ?? undefined,
    url: `${SITE_URL}/tours/${tour.id}`,
    image: allImages.length === 1 ? allImages[0] : allImages,
    touristType: "Group",
    availableLanguage: ["zh-TW", "zh-CN", "en"],
    ...(tour.destination && {
      itinerary: {
        "@type": "ItemList",
        name: tour.destination,
      },
    }),
    ...(tour.price && {
      offers: {
        "@type": "Offer",
        price: tour.price,
        priceCurrency: tour.currency ?? "USD",
        availability: "https://schema.org/InStock",
        url: `${SITE_URL}/tours/${tour.id}`,
        ...(tour.startDate && { validFrom: tour.startDate }),
        ...(tour.endDate && { validThrough: tour.endDate }),
      },
    }),
    ...(tour.duration && {
      duration: `P${tour.duration}D`,
    }),
    ...(tour.rating &&
      tour.totalReviews && {
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: tour.rating,
          reviewCount: tour.totalReviews,
          bestRating: 5,
          worstRating: 1,
        },
      }),
    provider: {
      "@type": "TravelAgency",
      "@id": `${SITE_URL}#organization`,
      name: SITE_NAME_ZH,
      url: SITE_URL,
    },
  };
}
