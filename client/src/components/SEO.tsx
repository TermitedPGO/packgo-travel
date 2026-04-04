import { Helmet } from "react-helmet-async";

const SITE_URL = "https://packgo-d3xjbq67.manus.space";
const SITE_NAME = "PACK&GO 旅行社";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.jpg`;

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: "website" | "article";
  /** Schema.org JSON-LD structured data */
  schema?: object | object[];
}

/**
 * SEO component using react-helmet-async
 * Injects dynamic <head> meta tags and Schema.org JSON-LD for each page.
 */
export default function SEO({
  title,
  description,
  image,
  url,
  type = "website",
  schema,
}: SEOProps) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | 專業旅遊規劃`;
  const metaDesc =
    description ??
    "PACK&GO 旅行社提供專業旅遊規劃服務，包含團體旅遊、客製行程、機票預訂、飯店預訂、郵輪旅遊等服務。";
  const metaImage = image ?? DEFAULT_OG_IMAGE;
  const metaUrl = url ? `${SITE_URL}${url}` : SITE_URL;

  // Normalise schema to array
  const schemas = schema ? (Array.isArray(schema) ? schema : [schema]) : [];

  return (
    <Helmet>
      {/* Primary */}
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      <link rel="canonical" href={metaUrl} />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={metaUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:image" content={metaImage} />
      <meta property="og:locale" content="zh_TW" />
      <meta property="og:site_name" content={SITE_NAME} />

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
    name: SITE_NAME,
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
    name: SITE_NAME,
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
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}
