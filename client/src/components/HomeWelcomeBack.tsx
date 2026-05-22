/**
 * HomeWelcomeBack — v78m Sprint 5C: personalized greeting + recently viewed
 * tours for logged-in users.
 *
 * Tracking: tour view IDs are persisted in localStorage on TourDetailPeony
 * mount; this component shows the last 4 across sessions.
 *
 * If the user is anonymous, this component renders nothing — the homepage
 * looks normal.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { ArrowRight, Clock } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

const STORAGE_KEY = "packgo:recentlyViewedTourIds";
const MAX_RECENT = 4;

// v78o: 跳過 "好運發發發" 這類行銷前綴 — 短、無數字/天/夜 → 取下一段才是真行程名
function _stripMarketingPrefix(title: string): string {
  const segs = (title || "").split(/[|｜]/).map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return "";
  const isMarketing = (s: string) => s.length < 6 && !/[0-9]|day|night|天|夜/i.test(s);
  return segs.length > 1 && isMarketing(segs[0]) ? segs[1] : segs[0];
}

export function recordTourView(tourId: number) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let ids: number[] = raw ? JSON.parse(raw) : [];
    ids = ids.filter((id) => id !== tourId);
    ids.unshift(tourId);
    ids = ids.slice(0, 12); // store more, display fewer
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {}
}

function readRecentIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export default function HomeWelcomeBack() {
  const { user, isAuthenticated } = useAuth();
  const { language, t, formatPrice } = useLocale();
  const isEN = language === "en";
  const [recentIds, setRecentIds] = useState<number[]>(() => readRecentIds());
  const { data: allTours } = trpc.tours.list.useQuery(undefined, {
    enabled: isAuthenticated && recentIds.length > 0,
  });

  // Refresh from localStorage on mount in case user navigated back
  useEffect(() => {
    setRecentIds(readRecentIds());
  }, []);

  if (!isAuthenticated || !user) return null;

  // Time-based greeting (use i18n keys for both languages)
  const hour = new Date().getHours();
  const greetingKey =
    hour < 6 ? "homeWelcomeBack.greetingLate"
    : hour < 12 ? "homeWelcomeBack.greetingMorning"
    : hour < 18 ? "homeWelcomeBack.greetingAfternoon"
    : "homeWelcomeBack.greetingEvening";
  const greeting = t(greetingKey);

  const displayName = user.name || (user.email || "").split("@")[0] || "Traveler";

  // Resolve tour objects from IDs in order
  const recentTours =
    allTours && recentIds.length > 0
      ? recentIds
          .map((id) => (allTours as any[]).find((t: any) => t.id === id))
          .filter(Boolean)
      : [];

  // v78z-z2 Sprint 8: render NOTHING when no recent views.
  // Empty-state greeting bar was visual noise for the 95% of returning users
  // without recent tour views (per UX audit).
  if (recentTours.length === 0) {
    return null;
  }

  // v78o: 用 LocaleContext 的 formatPrice — 自動依使用者選的幣別轉換 + 格式化
  const fmtPrice = (price: number, currency: string) => {
    if (!price) return "";
    const cur = (currency || "TWD").toUpperCase();
    return formatPrice(price, cur === "USD" ? "USD" : "TWD");
  };

  return (
    <section className="bg-white border-b border-gray-200">
      <div className="container py-6">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
          <div>
            <p className="text-xs font-bold tracking-wide uppercase text-[#8a6f3a] mb-1 flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              {t("homeWelcomeBack.recentlyViewed")}
            </p>
            <h2 className="text-xl md:text-2xl font-bold text-gray-900">
              {greeting}{t("common.greetingComma")}{displayName}
            </h2>
          </div>
          <Link href="/tours">
            <button className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              {t("homeWelcomeBack.viewAllTours")}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {recentTours.map((tour: any) => (
            <RecentTourCard
              key={tour.id}
              tour={tour}
              isEN={isEN}
              t={t}
              fmtPrice={fmtPrice}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * v78o: Each card lazily fetches its English translation when needed.
 * React Query dedupes / caches by tour ID so the 4 calls are cheap.
 */
function RecentTourCard({
  tour,
  isEN,
  t,
  fmtPrice,
}: {
  tour: any;
  isEN: boolean;
  t: (k: string) => string;
  fmtPrice: (price: number, currency: string) => string;
}) {
  const { data: translation } = trpc.translation.getTourTranslations.useQuery(
    { tourId: tour.id, targetLanguage: "en" as const },
    { enabled: isEN, staleTime: 1000 * 60 * 5 }
  );

  const displayTitle = isEN
    ? _stripMarketingPrefix(translation?.title || tour.titleEn || tour.title)
    : _stripMarketingPrefix(tour.title);

  return (
    <Link href={`/tours/${tour.id}`} className="block group">
      <div className="rounded-xl overflow-hidden bg-gray-100 aspect-[4/3] mb-2">
        {tour.imageUrl || tour.heroImage ? (
          <img
            src={tour.imageUrl || tour.heroImage}
            alt={displayTitle}
            loading="lazy"
            className="w-full h-full object-cover rounded-xl group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-foreground/20 to-foreground/40 rounded-xl" />
        )}
      </div>
      <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-tight mb-1">
        {displayTitle}
      </h3>
      <p className="text-xs text-gray-500">
        {tour.duration ? `${tour.duration} ${t("common.days")}` : null}
        {tour.price ? ` · ${fmtPrice(Number(tour.price), tour.priceCurrency || "TWD")}` : null}
      </p>
    </Link>
  );
}
