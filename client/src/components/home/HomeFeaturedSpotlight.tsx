import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowRight, Clock, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";

/**
 * Round 79.1: editorial featured-tour section.
 * Round 80.3 fix: converted from `<Link><a className="lg:col-span-7">` legacy
 * pattern to Wouter 3's modern `<Link className="...">` API. The legacy pattern
 * was double-wrapping the anchor and the inner className (incl. `lg:col-span-7`)
 * was applied to the WRONG element, so the feature card lost its grid span and
 * collapsed to ~100px wide on desktop. All Link instances in this file now
 * apply className directly on Link.
 *
 * Sits between the search bar and the regions grid. Magazine layout — one
 * tall feature on the left, two stacked cards on the right — so the page has
 * a real visual rhythm beyond a bunch of equal-sized grids stacked vertically.
 * Uses the same pool as the hero rotator so the home reads as a single
 * curated edition rather than disconnected modules.
 */
export default function HomeFeaturedSpotlight() {
  const { t, language, formatPrice } = useLocale();
  const { data: tours } = trpc.tours.list.useQuery();

  const picks = useMemo(() => {
    if (!tours) return [];
    const active = tours.filter(
      (tour) => tour.status === "active" && (tour.heroImage || tour.imageUrl)
    );
    const featured = active.filter((tour) => tour.featured === 1);
    const pool = featured.length >= 3 ? featured : active;
    // Pick 3 with diverse destination countries when possible
    const seen = new Set<string>();
    const diverse: typeof active = [];
    for (const tour of pool) {
      const country = (tour.destinationCountry || "other").trim();
      if (!seen.has(country)) {
        seen.add(country);
        diverse.push(tour);
      }
      if (diverse.length >= 3) break;
    }
    if (diverse.length < 3) {
      for (const tour of pool) {
        if (!diverse.find((d) => d.id === tour.id)) diverse.push(tour);
        if (diverse.length >= 3) break;
      }
    }
    return diverse;
  }, [tours]);

  if (picks.length < 3) return null;

  const [feature, second, third] = picks;
  const sideCards = [second, third];

  return (
    <section className="relative w-full bg-white py-20 md:py-28">
      <div className="container mx-auto px-6 md:px-10">
        {/* Section header */}
        <div className="flex items-end justify-between gap-6 mb-12 md:mb-16">
          <div>
            <p className="text-xs tracking-[0.3em] uppercase text-foreground/50 mb-3">
              {t("homeSpotlight.eyebrow")}
            </p>
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground tracking-tight">
              {t("homeSpotlight.title")}
            </h2>
          </div>
          <Link
            href="/tours"
            className="hidden md:inline-flex items-center gap-2 text-sm tracking-wide text-foreground/70 hover:text-foreground transition-colors"
          >
            {t("homeSpotlight.viewAll")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Magazine grid — generous gap so cards breathe instead of crowding */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
          {/* Feature card — tall on the left, span 7/12 on desktop */}
          <Link
            href={`/tours/${feature.id}`}
            className="group relative block lg:col-span-7 overflow-hidden rounded-xl bg-foreground/[0.04] aspect-[4/5] md:aspect-[5/6] lg:aspect-auto lg:h-[540px]"
          >
            <img
              src={feature.heroImage || feature.imageUrl || undefined}
              alt={feature.title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1500ms] ease-out group-hover:scale-105"
              loading="lazy"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/15"
              aria-hidden
            />
            <div className="relative z-10 flex flex-col justify-end h-full p-8 md:p-12 text-white">
              <div className="flex items-center gap-3 mb-5 text-xs tracking-[0.3em] uppercase text-[#c9a563]">
                <span className="h-px w-6 bg-[#c9a563]" aria-hidden />
                <span>{t("homeSpotlight.featured")}</span>
              </div>
              <h3 className="font-serif font-bold text-2xl md:text-4xl leading-[1.15] tracking-tight mb-3 line-clamp-2">
                {feature.title}
              </h3>
              {feature.heroSubtitle && (
                <p className="text-base md:text-lg text-white/80 leading-relaxed line-clamp-1 mb-5 max-w-xl">
                  {feature.heroSubtitle}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/80">
                {feature.destinationCountry && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" />
                    {translateDestination(feature.destinationCountry, language)}
                  </span>
                )}
                {feature.duration && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    {feature.duration}
                    {language === "en" ? "D" : "天"}
                  </span>
                )}
                {feature.price && (
                  <span className="font-semibold text-white">
                    {formatPrice(
                      feature.price,
                      ((feature.priceCurrency as "TWD" | "USD") || "TWD")
                    )}
                    <span className="text-xs font-normal text-white/65 ml-1">
                      {t("common.startingFrom")}
                    </span>
                  </span>
                )}
              </div>
              <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold tracking-wide group-hover:gap-3 transition-all">
                {t("homeSpotlight.viewTour")}
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </Link>

          {/* Side stack — two cards. lg:h math: 2 × 254 + 32 gap = 540 = feature height */}
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-6 md:gap-8">
            {sideCards.map((tour) => (
              <Link
                key={tour.id}
                href={`/tours/${tour.id}`}
                className="group relative block overflow-hidden rounded-xl bg-foreground/[0.04] aspect-[4/5] sm:aspect-[3/4] lg:aspect-auto lg:h-[254px]"
              >
                <img
                  src={tour.heroImage || tour.imageUrl || undefined}
                  alt={tour.title}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1500ms] ease-out group-hover:scale-105"
                  loading="lazy"
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
                  aria-hidden
                />
                <div className="relative z-10 flex flex-col justify-end h-full p-6 md:p-7 text-white">
                  {tour.destinationCountry && (
                    <span className="inline-flex items-center gap-1.5 text-xs tracking-[0.2em] uppercase text-white/75 mb-2">
                      <MapPin className="h-3 w-3" />
                      {translateDestination(tour.destinationCountry, language)}
                    </span>
                  )}
                  <h3 className="font-serif font-bold text-lg md:text-xl leading-snug tracking-tight line-clamp-2 mb-3">
                    {tour.title}
                  </h3>
                  <div className="flex items-center justify-between text-sm">
                    {tour.duration && (
                      <span className="inline-flex items-center gap-1.5 text-white/75">
                        <Clock className="h-3.5 w-3.5" />
                        {tour.duration}
                        {language === "en" ? "D" : "天"}
                      </span>
                    )}
                    {tour.price && (
                      <span className="font-semibold">
                        {formatPrice(
                          tour.price,
                          ((tour.priceCurrency as "TWD" | "USD") || "TWD")
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Mobile view-all link */}
        <div className="md:hidden mt-8 text-center">
          <Link
            href="/tours"
            className="inline-flex items-center gap-2 text-sm tracking-wide text-foreground/70 hover:text-foreground transition-colors"
          >
            {t("homeSpotlight.viewAll")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
