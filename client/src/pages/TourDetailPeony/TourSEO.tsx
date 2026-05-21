/**
 * TourDetailPeony / TourSEO.tsx
 *
 * Bilingual SEO meta + structured-data (tour + breadcrumb) for the
 * tour detail page. Round 72: always emits { zh, en } tuples so crawlers
 * see correct language regardless of viewer locale.
 *
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import SEO, { buildTourSchema, buildBreadcrumbSchema } from "@/components/SEO";
import { parseJSON } from "./helpers";

export type TourSEOProps = {
  tour: any;
  tourTranslations: unknown;
  displayTitle: string;
  displayDescription: string | null | undefined;
  language: string;
};

export default function TourSEO({
  tour,
  tourTranslations,
  displayTitle,
  displayDescription,
  language,
}: TourSEOProps) {
  return (
    <SEO
      title={{
        zh: tour.title,
        en: ((tourTranslations as Record<string, string> | undefined)?.title) ?? tour.title,
      }}
      description={{
        zh: tour.description ?? "",
        en: ((tourTranslations as Record<string, string> | undefined)?.description) ?? tour.description ?? "",
      }}
      image={(tour as any).heroImage || (tour as any).imageUrl || undefined}
      url={`/tours/${tour.id}`}
      type="article"
      schema={[
        buildTourSchema({
          id: tour.id,
          title: displayTitle,
          description: displayDescription,
          price: (tour as any).price,
          currency: (tour as any).currency ?? "USD",
          duration: (tour as any).duration,
          destination: (tour as any).destinationCountry ?? (tour as any).destination,
          images: (() => {
            const fi = parseJSON(tour?.featureImages, []) as any[];
            const featureUrls = Array.isArray(fi)
              ? fi.map((f) => f?.url || f?.image).filter((u) => typeof u === 'string')
              : [];
            const hero = (tour as any).heroImage || (tour as any).imageUrl;
            const all = [hero, ...featureUrls].filter(Boolean) as string[];
            return all.length > 0 ? all.slice(0, 8) : undefined;
          })(),
          rating: (tour as any).rating || (tour as any).averageRating,
          totalReviews: (tour as any).totalReviews || (tour as any).reviewCount,
          startDate: (tour as any).startDate,
          endDate: (tour as any).endDate,
        }),
        // Round 80.25 — BreadcrumbList Schema. Helps Google render
        // breadcrumb-trail rich snippets in SERPs. Dropped destination
        // level since destination slugs aren't standardized (Chinese
        // country names don't map to /destinations/:region routes).
        // 3-level (Home > Tours > [tour]) is valid breadcrumb structure.
        buildBreadcrumbSchema([
          { name: language === "en" ? "Home" : "首頁", url: "/" },
          { name: language === "en" ? "Tours" : "行程", url: "/tours" },
          { name: displayTitle, url: `/tours/${tour.id}` },
        ]),
      ]}
    />
  );
}
