import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { cn } from "@/lib/utils";
// Round 80.21 v20: HeroSearchBar removed from the hero. The standalone
// HomeSearchBar (with date picker + chip filters) sits below the hero
// and is the single primary search experience now. Two stacked search
// bars looked amateur and confused first-time visitors.

interface HomeHeroProps {
  /** Override the rotating background with a single static image. Mostly for previews. */
  bgImage?: string;
}

const ROTATE_MS = 9000;

/**
 * Round 79.1: photographic hero with rotating tour backgrounds.
 *
 * The B&W brand baseline rule says "全站黑白底色，除了團的照片是例外" — so the
 * tour photos are explicitly the right exception here. The brand text layer
 * (eyebrow + serif headline + subtitle + dual CTA) stays static; the
 * background image fades through 4–6 active tour photos with a heavy gradient
 * overlay so type stays legible. A subtle per-slide accent line surfaces the
 * current tour name and links to its detail page.
 */
export default function HomeHero({ bgImage }: HomeHeroProps) {
  const { t, language } = useLocale();
  const { data: tours } = trpc.tours.list.useQuery();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Round 80.10: track which slide images have actually finished downloading.
  // The rotator div used to render with opacity-100 the moment slides arrived
  // from tRPC — but the IMAGE inside hadn't finished decoding yet, so for ~1
  // frame the user saw the sakura LCP fallback peek through, then the real
  // tour photo would pop in. That pop-in is the flicker Jeff observed.
  // Now: the active slide stays opacity-0 until its image fires onLoad, so
  // sakura stays visible the whole time and the swap is a smooth crossfade.
  const [loadedSlideIds, setLoadedSlideIds] = useState<Set<number>>(new Set());
  const markSlideLoaded = (id: number) =>
    setLoadedSlideIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const slides = useMemo(() => {
    if (bgImage) return [];
    if (!tours) return [];
    const active = tours.filter(
      (tour) => tour.status === "active" && (tour.heroImage || tour.imageUrl)
    );
    const featured = active.filter((tour) => tour.featured === 1);
    const pool = featured.length >= 3 ? featured : active;
    return pool.slice(0, 6);
  }, [tours, bgImage]);

  useEffect(() => {
    if (paused || reducedMotion || slides.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, reducedMotion, slides.length]);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length, index]);

  const current = slides[index];
  const showRotator = slides.length > 0;
  const showStaticImage = !!bgImage;

  return (
    <section
      className={cn(
        "relative w-full overflow-hidden bg-foreground",
        "h-[82vh] min-h-[600px] max-h-[860px]",
        "flex items-center"
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Static bgImage override */}
      {showStaticImage && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          aria-hidden
        />
      )}

      {/* Round 80.21 — sakura banished for good.
          v80.24 attempt left sakura as final fallback when slides=[] OR
          when slides[0] had no hero/imageUrl. Jeff still saw it on prod
          (screenshot 5/5) because tRPC's first paint shows slides=[] for
          ~200ms while the query resolves AND because some seed tours
          actually have empty heroImage/imageUrl strings.
          New: brand-aligned dark gradient placeholder — never sakura, ever
          again. Black + cream + gold radial = PACK&GO baseline. The real
          tour photo (line ~155) crossfades in over this when ready. */}
      {!showStaticImage && slides.length === 0 && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 30% 40%, rgba(201,165,99,0.22) 0%, transparent 55%), radial-gradient(ellipse at 75% 65%, rgba(255,255,255,0.05) 0%, transparent 50%), linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
          }}
          aria-hidden="true"
        />
      )}
      {/* First-slide LCP layer — renders unconditionally without onLoad
          gating, so even if the image is slow the user sees PACK&GO 行程
          (not sakura). Subsequent slides fade in via the rotator below.
          Round 80.21: when neither heroImage nor imageUrl exists for a
          tour (ratio 0% in clean data, but seeded test tours hit it),
          we render the dark-gradient placeholder div instead of sakura. */}
      {!showStaticImage && slides.length > 0 && (() => {
        const heroSrc = slides[0].heroImage || slides[0].imageUrl;
        if (!heroSrc) {
          return (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse at 30% 40%, rgba(201,165,99,0.22) 0%, transparent 55%), radial-gradient(ellipse at 75% 65%, rgba(255,255,255,0.05) 0%, transparent 50%), linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
              }}
              aria-hidden="true"
            />
          );
        }
        return (
        <div className="absolute inset-0">
          <img
            src={heroSrc}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover"
            // @ts-expect-error fetchPriority is valid HTML but not yet typed in React
            fetchpriority="high"
            loading="eager"
            decoding="async"
          />
        </div>
        );
      })()}

      {/* Rotating tour-photo background — Round 80.10: each slide stays
          opacity-0 until its image fires onLoad. Combined with the sakura
          LCP fallback above, this means the user sees:
            t=0s    sakura instantly (LCP)
            t=~1s   first tour photo crossfades in (1200ms ease-in-out)
            t=10s+  rotator continues normally between loaded slides
          No more 1-frame "wrong photo flash" while the maple photo decodes. */}
      {showRotator && (
        <div className="absolute inset-0">
          {slides.map((slide, i) => {
            const img = slide.heroImage || slide.imageUrl;
            const isLoaded = loadedSlideIds.has(slide.id);
            return (
              <div
                key={slide.id}
                className={cn(
                  "absolute inset-0 transition-opacity ease-in-out",
                  reducedMotion ? "duration-0" : "duration-[1200ms]",
                  i === index && isLoaded ? "opacity-100" : "opacity-0"
                )}
                aria-hidden={i !== index}
              >
                <img
                  src={img ?? undefined}
                  alt=""
                  aria-hidden="true"
                  className="w-full h-full object-cover"
                  loading={i === 0 ? "eager" : "lazy"}
                  onLoad={() => markSlideLoaded(slide.id)}
                  // Round 80.7: hint browser to prioritise the first slide so
                  // it becomes LCP before tRPC starts fetching tours data.
                  {...(i === 0 ? { fetchPriority: "high" as const } : {})}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Heavy B&W gradient overlay — legibility + brand-on-photo */}
      {(showRotator || showStaticImage) && (
        <div
          className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/45 to-black/75"
          aria-hidden
        />
      )}

      {/* Brand text layer */}
      <div className="container relative z-10 mx-auto px-6 md:px-10">
        <div className="max-w-3xl">
          <p className="text-xs md:text-sm tracking-[0.35em] uppercase text-white/65 mb-6 md:mb-8">
            {t("homeHero.eyebrow")}
          </p>

          <h1 className="font-serif font-bold text-white text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight">
            {t("homeHero.title")}
          </h1>

          <p className="mt-5 md:mt-6 text-lg md:text-xl text-white/85 leading-relaxed max-w-2xl">
            {t("homeHero.subtitle")}
          </p>

          {/* Per-slide accent — Round 80.18: was line-clamp-2 with full
              marketing title (often 40+ chars wrapping ugly). Now uses
              destinationCity + days + price as a 1-line teaser, linking
              to the current featured tour. Marketing title is preserved
              on hover via title= attribute and on the actual /tours/:id
              page. Goal: clean glance, not crammed essay. */}
          {current && (
            <Link
              href={`/tours/${current.id}`}
              className="group mt-6 inline-flex items-center gap-3 max-w-2xl"
              title={current.title}
            >
              <span
                className="inline-block h-px w-8 bg-[#c9a563] flex-shrink-0"
                aria-hidden
              />
              <span className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] tracking-[0.3em] uppercase text-[#c9a563] font-semibold">
                  {t("hero.spotlight.eyebrow")}
                </span>
                <span className="text-white/40 text-xs">·</span>
                <span className="text-sm md:text-base text-white/95 group-hover:text-[#c9a563] transition-colors font-medium">
                  {current.destinationCity
                    ? translateDestination(current.destinationCity, language)
                    : current.destinationCountry
                    ? translateDestination(current.destinationCountry, language)
                    : t("hero.spotlight.fallback")}
                  {current.duration
                    ? ` · ${current.duration} ${t("common.days")}`
                    : ""}
                  {current.price
                    ? ` · ${t("common.from")} NT$ ${(current.price / 1000).toFixed(0)}K`
                    : ""}
                </span>
              </span>
            </Link>
          )}

          {/* Round 80.21 v20: Hero search bar removed (was duplicating
              the HomeSearchBar that sits just below the hero). Dual CTA
              is now the primary in-hero action, search moved into a
              single dedicated section below. */}
          <div className="mt-8 md:mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Link href="/custom-tour-request">
              <Button
                size="default"
                className="rounded-lg px-5 h-10 bg-white text-foreground hover:bg-white/90 font-semibold tracking-wide gap-2 w-full sm:w-auto"
              >
                {t("homeHero.ctaPrimary")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/tours">
              <Button
                size="default"
                variant="outline"
                className="rounded-lg px-5 h-10 bg-transparent text-white border-white/40 hover:bg-white/10 hover:text-white hover:border-white/70 font-medium tracking-wide w-full sm:w-auto"
              >
                {t("homeHero.ctaSecondary")}
              </Button>
            </Link>
          </div>

          {/* 2026-05-22: removed duplicate phone row — Header.tsx top utility bar
              already shows +1 (510) 634-2307 on every page. Hero CTA buttons
              above carry the conversion weight; phone stays a click away in
              the persistent header. */}
        </div>
      </div>

      {/* Pagination dots — bottom-right, low-key */}
      {showRotator && slides.length > 1 && (
        <div className="absolute bottom-6 right-6 md:bottom-8 md:right-10 z-10 flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              className={cn(
                "h-1 rounded-full transition-all",
                i === index ? "w-8 bg-white" : "w-1 bg-white/45 hover:bg-white/70"
              )}
            />
          ))}
        </div>
      )}

      {/* Gold rule at bottom — anchors brand baseline above search */}
      <div
        className="absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#c9a563] to-transparent opacity-50"
        aria-hidden
      />
    </section>
  );
}
