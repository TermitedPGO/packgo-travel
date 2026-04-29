/**
 * HomeHeroSpotlight — v78i: editorial-style featured-tour rotator above the
 * search box. Borrows the signettours.com pattern where the hero IS a tour
 * (one click to convert) instead of an empty search prompt.
 *
 * Behaviour:
 *   - Fetches all active tours, picks featured ones (fallback: first 5 active)
 *   - Auto-rotates every 6s; user can click pagination dots / arrows
 *   - Each slide: full-bleed hero image, gradient overlay, tour title,
 *     poetic subtitle (heroSubtitle), country/duration/price chips, primary CTA
 *   - On mobile, height collapses to 60vh; on desktop 70vh
 *   - Sits ABOVE EditableHero (search box) so EditableHero remains untouched
 */
import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { ChevronLeft, ChevronRight, MapPin, Clock, ArrowRight } from "lucide-react";

// v78z-z2 Sprint 8: slowed auto-rotation 6s → 12s + respects
// prefers-reduced-motion (older audience, accessibility).
const ROTATE_MS = 12000;

export default function HomeHeroSpotlight() {
  const { t, language, formatPrice } = useLocale();
  const { data: tours } = trpc.tours.list.useQuery();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Detect prefers-reduced-motion (accessibility)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Pick featured tours; fallback to most-recent active tours
  const slides = useMemo(() => {
    if (!tours) return [];
    const active = tours.filter((t: any) => t.status === "active" && (t.imageUrl || t.heroImage));
    const featured = active.filter((t: any) => t.featured === 1);
    const pick = (featured.length >= 3 ? featured : active).slice(0, 5);
    return pick;
  }, [tours]);

  // Auto-rotate (12s, pause on hover/focus, disable for reduced-motion users)
  useEffect(() => {
    if (paused || reducedMotion || slides.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, reducedMotion, slides.length]);

  // Reset index if slides change to avoid out-of-bounds
  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length, index]);

  // v78o: Translation fetch — call hook UNCONDITIONALLY (rules of hooks).
  // For empty slides, current is undefined; tourId fallback to 0 disables the query via `enabled`.
  const current: any = slides.length > 0 ? slides[index] : undefined;
  const tourIdForQuery = current?.id || 0;
  const { data: translation } = trpc.translation.getTourTranslations.useQuery(
    { tourId: tourIdForQuery, targetLanguage: "en" as const },
    { enabled: language === "en" && tourIdForQuery > 0, staleTime: 1000 * 60 * 10 }
  );

  if (slides.length === 0 || !current) {
    // Render nothing so EditableHero takes over
    return null;
  }

  const heroImg = current.heroImage || current.imageUrl;

  const titleField = language === "en"
    ? (translation?.title || current.titleEn || current.title_en || current.title)
    : current.title;
  const subtitleField = language === "en"
    ? (translation?.heroSubtitle || current.heroSubtitleEn || current.heroSubtitle_en || current.heroSubtitle)
    : current.heroSubtitle;

  const goPrev = () => setIndex((i) => (i - 1 + slides.length) % slides.length);
  const goNext = () => setIndex((i) => (i + 1) % slides.length);

  // v78o: 用 LocaleContext 的 formatPrice — 自動依使用者選的幣別轉換 + 格式化
  const fmtPrice = (price: number, currency: string) => {
    if (!price) return null;
    const cur = (currency || "TWD").toUpperCase();
    return formatPrice(price, cur === "USD" ? "USD" : "TWD");
  };

  return (
    <section
      className="relative w-full h-[60vh] md:h-[70vh] overflow-hidden bg-gray-900"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      {/* Slides — only the active one is visually rendered; others stacked invisibly to keep transition simple */}
      {slides.map((slide: any, i: number) => {
        const slideImg = slide.heroImage || slide.imageUrl;
        return (
          <div
            key={slide.id}
            className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${i === index ? "opacity-100 z-10" : "opacity-0 z-0"}`}
            aria-hidden={i !== index}
          >
            <img
              src={slideImg}
              alt={slide.title}
              className="w-full h-full object-cover"
              loading={i === 0 ? "eager" : "lazy"}
            />
            {/* Dark gradient for legibility */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/70" />
          </div>
        );
      })}

      {/* Foreground content (refers to current slide for content) */}
      <div className="relative z-20 h-full flex items-end md:items-center">
        <div className="container pb-12 md:pb-0">
          <div className="max-w-3xl text-white">
            <p className="text-xs font-bold tracking-[0.3em] uppercase text-white/70 mb-3 animate-in fade-in duration-700">
              {t("hero.spotlight.eyebrow") || "本週精選"}
            </p>
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-serif font-bold leading-tight mb-3 animate-in fade-in slide-in-from-bottom-4 duration-700 line-clamp-2">
              {/* v78j: split title at pipe; skip first segment if it's a short
                  marketing prefix (< 6 chars, no digits/天/夜). */}
              {(() => {
                const segs = (titleField || "").split(/[|｜]/).map(s => s.trim()).filter(Boolean);
                const skipFirst = segs.length > 1 && segs[0].length < 6 && !/[0-9]|day|night|天|夜/i.test(segs[0]);
                return segs[skipFirst ? 1 : 0] || titleField;
              })()}
            </h1>
            {subtitleField && (
              <p className="text-base md:text-xl text-white/85 mb-5 leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                {subtitleField}
              </p>
            )}

            {/* Meta chips — v78p: city names go through translateDestination for EN */}
            <div className="flex flex-wrap items-center gap-3 mb-6 text-sm text-white/85 animate-in fade-in duration-700 delay-200">
              {(current.destinationCountry || current.destinationCity) && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {translateDestination(current.destinationCity || current.destinationCountry || "", language)}
                </span>
              )}
              {current.duration && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {current.duration}{language === "en" ? "D" : "天"}{current.nights ? `${current.nights}${language === "en" ? "N" : "夜"}` : ""}
                </span>
              )}
              {current.price && (
                <span className="font-semibold text-white">
                  {fmtPrice(current.price, current.priceCurrency || "USD")}
                  <span className="text-xs font-normal text-white/70 ml-1">
                    {t("tours.startingFrom") || "起"}
                  </span>
                </span>
              )}
            </div>

            <Link href={`/tours/${current.id}`}>
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-white text-black font-bold text-sm hover:bg-white/90 transition-all hover:gap-3">
                {t("hero.spotlight.cta") || "查看完整行程"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Carousel arrows (desktop) */}
      {slides.length > 1 && (
        <>
          <button
            onClick={goPrev}
            aria-label="Previous"
            className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm hover:bg-white/30 text-white items-center justify-center transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={goNext}
            aria-label="Next"
            className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm hover:bg-white/30 text-white items-center justify-center transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Pagination dots */}
      {slides.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
          {slides.map((_: any, i: number) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-8 bg-white" : "w-1.5 bg-white/50 hover:bg-white/70"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
