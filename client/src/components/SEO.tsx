import { Helmet } from "react-helmet-async";
import { useLocale } from "@/contexts/LocaleContext";

// Round 72: corrected from stale packgo09.manus.space. Fly.io is the canonical host.
const SITE_URL = "https://packgo-travel.fly.dev";
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
}: SEOProps) {
  const { language } = useLocale();
  const isEn = language === "en";
  const siteName = isEn ? SITE_NAME_EN : SITE_NAME_ZH;

  const resolvedTitle = pickLocalized(title, isEn);
  const resolvedDesc = pickLocalized(description, isEn);

  const fullTitle = resolvedTitle
    ? `${resolvedTitle} | ${siteName}`
    : isEn
      ? `${siteName} | Professional Travel Planning`
      : `${siteName} | 專業旅遊規劃`;

  const metaDesc =
    resolvedDesc ??
    (isEn
      ? "PACK&GO Travel offers professional travel planning: group tours, custom itineraries, flight & hotel booking, cruise packages, and more."
      : "PACK&GO 旅行社提供專業旅遊規劃服務，包含團體旅遊、客製行程、機票預訂、飯店預訂、郵輪旅遊等服務。");

  const metaImage = image ?? DEFAULT_OG_IMAGE;
  const metaUrl = url ? `${SITE_URL}${url}` : SITE_URL;
  const ogLocale = isEn ? "en_US" : "zh_TW";

  // Normalise schema to array
  const schemas = schema ? (Array.isArray(schema) ? schema : [schema]) : [];

  return (
    <Helmet>
      {/* Primary */}
      <html lang={isEn ? "en" : "zh-TW"} />
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      <link rel="canonical" href={metaUrl} />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={metaUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:image" content={metaImage} />
      <meta property="og:locale" content={ogLocale} />
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

/** Organization schema for the homepage */
export function buildOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    name: SITE_NAME_ZH,
    alternateName: SITE_NAME_EN,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    description:
      "PACK&GO 旅行社提供專業旅遊規劃服務，包含團體旅遊、客製行程、機票預訂、飯店預訂、郵輪旅遊等服務。",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      availableLanguage: ["Chinese", "English"],
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

/** TouristTrip schema for individual tour detail pages */
export function buildTourSchema(tour: {
  id: number;
  title: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  duration?: number | null;
  destination?: string | null;
  images?: string[] | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    name: tour.title,
    description: tour.description ?? undefined,
    url: `${SITE_URL}/tours/${tour.id}`,
    image: tour.images?.[0] ?? DEFAULT_OG_IMAGE,
    touristType: "Group",
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
        priceCurrency: tour.currency ?? "TWD",
        availability: "https://schema.org/InStock",
        url: `${SITE_URL}/tours/${tour.id}`,
      },
    }),
    ...(tour.duration && {
      duration: `P${tour.duration}D`,
    }),
    provider: {
      "@type": "TravelAgency",
      name: SITE_NAME_ZH,
      url: SITE_URL,
    },
  };
}
