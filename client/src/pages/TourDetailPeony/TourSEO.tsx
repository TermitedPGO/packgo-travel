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
import SEO, { buildTourSchema, buildBreadcrumbSchema, buildFAQSchema } from "@/components/SEO";
import { parseJSON } from "./helpers";
import { useLocale } from "@/contexts/LocaleContext";

export type TourSEOProps = {
  tour: any;
  tourTranslations: unknown;
  displayTitle: string;
  displayDescription: string | null | undefined;
  language: string;
  /**
   * Locale-resolved noticeDetailed (already parsed + translated in index.tsx).
   * Drives the FAQPage schema below. Same object NotesSection renders, so the
   * schema Q&A always matches the visible on-page content (Google on-page
   * parity requirement + what AI answer engines actually cite).
   */
  noticeDetailed?: any;
};

export default function TourSEO({
  tour,
  tourTranslations,
  displayTitle,
  displayDescription,
  language,
  noticeDetailed,
}: TourSEOProps) {
  const { t } = useLocale();

  // FAQPage schema from the tour's notices. We mirror NotesSection exactly:
  // same category keys, same i18n heading as the question (so the schema text
  // is verbatim on-page), and the bullet items joined as the answer. Only
  // categories with real content contribute; buildFAQSchema returns null when
  // nothing is populated, so tours without notices emit no FAQ schema.
  const toArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  const faqItems =
    noticeDetailed && typeof noticeDetailed === "object"
      ? [
          { question: t("tourDetail.preTrip"), answer: toArr(noticeDetailed.preparation).join("\n") },
          { question: t("tourDetail.documents"), answer: toArr(noticeDetailed.documents).join("\n") },
          { question: t("tourDetail.health"), answer: toArr(noticeDetailed.health).join("\n") },
          { question: t("tourDetail.emergency"), answer: toArr(noticeDetailed.emergency).join("\n") },
          { question: t("tourDetail.terms"), answer: toArr(noticeDetailed.terms).join("\n") },
        ]
      : [];
  const faqSchema = buildFAQSchema(faqItems);

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
          { name: t("nav.home"), url: "/" },
          { name: t("nav.tours"), url: "/tours" },
          { name: displayTitle, url: `/tours/${tour.id}` },
        ]),
        // FAQPage from real, on-page tour notices (null → omitted).
        ...(faqSchema ? [faqSchema] : []),
      ]}
    />
  );
}
