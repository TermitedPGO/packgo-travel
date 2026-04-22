import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { useMemo } from "react";

interface SimilarToursProps {
  tourId: number;
  title?: string;
}

export default function SimilarTours({ tourId, title }: SimilarToursProps) {
  const [, navigate] = useLocation();
  const { language, t, formatPrice } = useLocale();

  const { data: similarTours, isLoading } = trpc.tours.getSimilar.useQuery(
    { tourId, limit: 4 },
    { enabled: !!tourId }
  );

  // Batch fetch translations for non-Chinese languages
  const tourIds = useMemo(
    () => (similarTours ?? []).map((t: any) => t.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(similarTours ?? []).map((t: any) => t.id).join(',')]
  );
  const { data: batchTranslations } = trpc.translation.getBatchTourTranslations.useQuery(
    { tourIds, targetLanguage: language as 'zh-TW' | 'en' | 'ja' | 'ko' },
    { enabled: language !== 'zh-TW' && tourIds.length > 0 }
  );

  const getTranslatedTitle = (tour: any) => {
    if (language === 'zh-TW' || !batchTranslations) return tour.title;
    const tourTrans = (batchTranslations as Record<number, Record<string, string>>)[tour.id];
    return tourTrans?.title || tour.title;
  };

  const sectionTitle = title || t('tours.similar');
  const viewAllLabel = t('similarTours.viewAll');
  const perPersonLabel = t('similarTours.perPersonFrom');
  const featuredLabel = t('similarTours.featured');

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'group': return t('similarTours.catGroup');
      case 'private': return t('similarTours.catPrivate');
      case 'self_guided': return t('similarTours.catSelfGuided');
      case 'cruise': return t('similarTours.catCruise');
      case 'theme': return t('similarTours.catTheme');
      default: return category;
    }
  };

  if (isLoading || !similarTours || similarTours.length === 0) return null;

  return (
    <section className="py-16 bg-gray-50 border-t border-gray-200">
      <div className="container">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">{sectionTitle}</h2>
          <button
            onClick={() => navigate("/tours")}
            className="text-sm text-gray-500 hover:text-black transition-colors underline underline-offset-4"
          >
            {viewAllLabel}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {(similarTours as any[]).map((tour: any) => (
            <div
              key={tour.id}
              onClick={() => navigate(`/tours/${tour.id}`)}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden cursor-pointer group hover:shadow-md transition-all duration-200"
            >
              {/* Image */}
              <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-gray-100">
                {(tour.imageUrl || tour.heroImage) ? (
                  <img
                    src={tour.imageUrl || tour.heroImage}
                    alt={getTranslatedTitle(tour)}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 rounded-t-xl"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const parent = e.currentTarget.parentElement;
                      if (parent && !parent.querySelector('.img-fallback')) {
                        const div = document.createElement('div');
                        div.className = 'img-fallback w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200';
                        div.innerHTML = `<span style="color:#9ca3af;font-size:12px">${t('common.tourImage')}</span>`;
                        parent.appendChild(div);
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                    <span className="text-gray-400 text-sm">{t('common.tourImage')}</span>
                  </div>
                )}
                {tour.featured === 1 && (
                  <div className="absolute top-2 left-2 bg-black text-white text-xs px-2 py-0.5 rounded-md font-medium">
                    {featuredLabel}
                  </div>
                )}
              </div>
              {/* Content */}
              <div className="p-4">
                <p className="text-xs text-gray-500 mb-1">
                  {translateDestination(tour.destinationCountry || '', language)} · {tour.duration} {t('similarTours.days')}
                </p>
                <h3 className="font-bold text-gray-900 text-sm leading-snug mb-2 line-clamp-2 group-hover:text-black">
                  {getTranslatedTitle(tour)}
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-gray-400">{perPersonLabel}</span>
                    <p className="text-base font-bold text-black">
                      {formatPrice(tour.price || 0, (tour.priceCurrency || 'TWD') as 'TWD' | 'USD')}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 border border-gray-200 rounded-md px-2 py-0.5">
                    {getCategoryLabel(tour.category)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
