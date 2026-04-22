import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Quote, Star } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";

/**
 * Real-review carousel.
 *
 * Legal note (FTC 16 CFR Part 465, effective 2024-10-21):
 * Displaying fabricated or unverifiable testimonials is a civil violation
 * punishable by up to $51,744 per occurrence. This component therefore
 * ONLY renders reviews that come from `reviews.listVerified` on the server,
 * where each row is required to carry a matching `bookingId` proving the
 * reviewer actually completed a tour. If no verified reviews exist yet,
 * an honest placeholder is shown instead.
 */

interface VerifiedReview {
  id: number;
  displayName: string;
  location?: string | null;
  tourTitle: string;
  rating: number;
  text: string;
  createdAt: string;
  bookingId: number;
}

export default function TestimonialsCarousel() {
  const [current, setCurrent] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const { language, t } = useLocale();
  const isEn = language === "en";

  // Only show reviews that are tied to a real completed booking.
  // If the endpoint doesn't exist yet, the query returns undefined and we
  // fall through to the "no reviews yet" placeholder.
  const reviewsQuery = (trpc as any)?.reviews?.listVerified?.useQuery?.(
    { limit: 10 },
    { retry: false }
  );
  const reviews: VerifiedReview[] = reviewsQuery?.data ?? [];
  const isLoading: boolean = reviewsQuery?.isLoading ?? false;

  const goTo = (index: number) => {
    if (isAnimating) return;
    setIsAnimating(true);
    setCurrent(index);
    setTimeout(() => setIsAnimating(false), 300);
  };

  const prev = () =>
    goTo((current - 1 + Math.max(reviews.length, 1)) % Math.max(reviews.length, 1));
  const next = () => goTo((current + 1) % Math.max(reviews.length, 1));

  useEffect(() => {
    if (reviews.length <= 1) return;
    const timer = setInterval(next, 6000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reviews.length]);

  // --- Empty state (no verified reviews yet) ---------------------------------
  if (!isLoading && reviews.length === 0) {
    return (
      <section className="py-16 bg-white border-b border-gray-200">
        <div className="container">
          <div className="text-center mb-8">
            <p className="text-xs font-bold tracking-[0.3em] text-gray-400 uppercase mb-3">
              {isEn ? "VERIFIED REVIEWS" : "實證旅客評價"}
            </p>
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-black mb-4">
              {isEn ? "Be Our First Story" : "成為我們第一位說故事的旅客"}
            </h2>
          </div>
          <div className="max-w-2xl mx-auto rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
            <Quote className="h-10 w-10 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-700 text-base leading-relaxed mb-2">
              {isEn
                ? "Pack & Go publishes reviews only after a customer has completed a tour. We don't display fabricated or unverified testimonials."
                : "Pack & Go 僅發布真實旅客完成行程後的評價。我們不展示任何未經驗證的推薦。"}
            </p>
            <p className="text-gray-500 text-sm">
              {isEn
                ? "Your trip can be the first review shown here."
                : "您的旅程，將是這裡的第一則真實回饋。"}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="py-16 bg-white border-b border-gray-200">
        <div className="container">
          <div className="h-48 animate-pulse rounded-xl bg-gray-100 max-w-3xl mx-auto" />
        </div>
      </section>
    );
  }

  const r = reviews[current];

  return (
    <section className="py-16 bg-white border-b border-gray-200">
      <div className="container">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="text-xs font-bold tracking-[0.3em] text-gray-400 uppercase mb-3">
            {isEn ? "VERIFIED REVIEWS" : "實證旅客評價"}
          </p>
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-black mb-4">
            {isEn ? "What Our Travelers Say" : "旅客怎麼說"}
          </h2>
          <p className="text-xs text-gray-500">
            {isEn
              ? "Each review is linked to a completed booking. FTC 16 CFR §465 compliant."
              : "每則評價皆對應實際完成之訂單。符合美國 FTC 16 CFR §465 規範。"}
          </p>
        </div>

        {/* Carousel */}
        <div className="max-w-3xl mx-auto">
          <div
            className={`transition-opacity duration-300 ${isAnimating ? "opacity-0" : "opacity-100"}`}
          >
            <div className="flex justify-center mb-6">
              <Quote className="h-10 w-10 text-gray-200" />
            </div>

            <div className="flex justify-center gap-1 mb-6">
              {Array.from({ length: r.rating }).map((_, i) => (
                <Star key={i} className="h-5 w-5 fill-black text-black" />
              ))}
            </div>

            <blockquote className="text-center text-gray-700 text-lg leading-relaxed mb-8 font-serif italic px-4">
              &ldquo;{r.text}&rdquo;
            </blockquote>

            <div className="text-center">
              <p className="font-bold text-black text-base">{r.displayName}</p>
              <p className="text-gray-500 text-sm mt-1">
                {[r.location, r.tourTitle, new Date(r.createdAt).toLocaleDateString(isEn ? "en-US" : "zh-TW", { year: "numeric", month: "short" })]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-[10px] text-gray-400 mt-2 tracking-wider uppercase">
                {isEn ? `Verified booking #${r.bookingId}` : `已驗證訂單 #${r.bookingId}`}
              </p>
            </div>
          </div>

          {reviews.length > 1 && (
            <div className="flex items-center justify-center gap-6 mt-10">
              <button
                onClick={prev}
                className="w-10 h-10 rounded-lg border border-gray-300 hover:border-black flex items-center justify-center transition-colors"
                aria-label={t('common.previousReview')}
              >
                <ChevronLeft className="h-5 w-5 text-gray-600" />
              </button>

              <div className="flex gap-2">
                {reviews.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`h-2 rounded-full transition-all ${
                      i === current ? "bg-black w-6" : "bg-gray-300 w-2 hover:bg-gray-500"
                    }`}
                    aria-label={t('common.goToReview', { index: i + 1 })}
                  />
                ))}
              </div>

              <button
                onClick={next}
                className="w-10 h-10 rounded-lg border border-gray-300 hover:border-black flex items-center justify-center transition-colors"
                aria-label={t('common.nextReview')}
              >
                <ChevronRight className="h-5 w-5 text-gray-600" />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
