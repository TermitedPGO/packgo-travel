import { useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Round 79.1: instagram-style horizontal photo band.
 *
 * Six tour images in a horizontal strip — this is the "page-feels-rich"
 * surface area at low cost. Hover lifts the destination caption. Hidden
 * if fewer than 4 active tours have photos.
 */
export default function HomeMomentsStrip() {
  const { t } = useLocale();
  const { data: tours } = trpc.tours.list.useQuery();

  const moments = useMemo(() => {
    if (!tours) return [];
    const active = tours.filter(
      (tour) => tour.status === "active" && (tour.heroImage || tour.imageUrl)
    );
    // Diverse country pick, max 6
    const seen = new Set<string>();
    const out: typeof active = [];
    for (const tour of active) {
      const key = (tour.destinationCountry || tour.destination || "").trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(tour);
      }
      if (out.length >= 6) break;
    }
    if (out.length < 6) {
      for (const tour of active) {
        if (!out.find((d) => d.id === tour.id)) out.push(tour);
        if (out.length >= 6) break;
      }
    }
    return out;
  }, [tours]);

  if (moments.length < 4) return null;

  return (
    <section className="relative w-full bg-foreground py-16 md:py-20">
      <div className="container mx-auto px-6 md:px-10">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-xs tracking-[0.3em] uppercase text-white/55 mb-3">
            {t("homeMoments.eyebrow")}
          </p>
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-white tracking-tight">
            {t("homeMoments.title")}
          </h2>
          <div className="mt-6 mx-auto w-12 h-px bg-[#c9a563]/60" aria-hidden />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {moments.map((tour, i) => (
            // Round 80.3: Wouter 3 modern API — className on Link directly so
            // aspect-square actually applies to the grid child.
            <Link
              key={tour.id}
              href={`/tours/${tour.id}`}
              className={
                "group relative block overflow-hidden rounded-xl aspect-square " +
                // Stagger heights on larger viewports for editorial rhythm
                (i % 3 === 1 ? "lg:aspect-[3/4]" : "lg:aspect-square")
              }
            >
              <img
                src={tour.heroImage || tour.imageUrl || undefined}
                alt={tour.title}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-110"
                loading="lazy"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-80 group-hover:opacity-100 transition-opacity"
                aria-hidden
              />
              <div className="relative z-10 flex flex-col justify-end h-full p-3 md:p-4 text-white">
                <span className="text-[10px] md:text-xs tracking-[0.25em] uppercase text-white/70">
                  {tour.destinationCountry || tour.destination}
                </span>
                <span className="text-xs md:text-sm font-medium leading-tight line-clamp-2 mt-0.5">
                  {tour.duration ? `${tour.duration}` : ""}
                  {tour.duration && (t("homeMoments.daySuffix") || "天")} ·{" "}
                  {tour.title.split(/[|｜]/)[0].trim()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
