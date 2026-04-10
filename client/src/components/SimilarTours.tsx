import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
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

  const sectionTitle = title || (language === 'zh-TW' ? '您可能也喜歡' : t('tours.similar') || 'You May Also Like');
  const viewAllLabel = language === 'zh-TW' ? '查看所有行程' : t('common.viewAll') || 'View All';
  const perPersonLabel = language === 'zh-TW' ? '每人起' : t('common.perPerson') || 'Per Person';
  const featuredLabel = language === 'zh-TW' ? '精選' : t('featuredTours.title') || 'Featured';

  const getCategoryLabel = (category: string) => {
    if (language === 'zh-TW') {
      return category === 'group' ? '團體' :
             category === 'private' ? '私人' :
             category === 'self_guided' ? '自由行' :
             category === 'cruise' ? '郵輪' :
             category === 'theme' ? '主題' : category;
    }
    return category === 'group' ? 'Group' :
           category === 'private' ? 'Private' :
           category === 'self_guided' ? 'Self-Guided' :
           category === 'cruise' ? 'Cruise' :
           category === 'theme' ? 'Theme' : category;
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
              className="bg-white border border-gray-200 cursor-pointer group hover:shadow-md transition-all duration-200"
            >
              {/* Image */}
              <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-gray-100">
                {(tour.imageUrl || tour.heroImage) ? (
                  <img
                    src={tour.imageUrl || tour.heroImage}
                    alt={getTranslatedTitle(tour)}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 rounded-xl"
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
                  <div className="absolute top-2 left-2 bg-black text-white text-xs px-2 py-0.5 font-medium">
                    {featuredLabel}
                  </div>
                )}
              </div>
              {/* Content */}
              <div className="p-4">
                <p className="text-xs text-gray-500 mb-1">
                  {tour.destinationCountry} · {tour.duration} {language === 'zh-TW' ? '天' : t('common.days') || 'Days'}
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
                  <span className="text-xs text-gray-500 border border-gray-200 px-2 py-0.5">
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
