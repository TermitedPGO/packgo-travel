import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Clock, MapPin, Star } from "lucide-react";
import { LoadingPage } from "@/components/ui/spinner";
import { Link } from "wouter";
import { FavoriteButton } from "@/components/FavoriteButton";
import { useLocale } from "@/contexts/LocaleContext";
import { useMemo } from "react";
import { translateDestination } from "@/utils/locationMapping";

export default function FeaturedTours() {
  const { data: tours, isLoading, error } = trpc.tours.list.useQuery();
  const { t, formatPrice, language } = useLocale();

  // Show featured tours (featured=1) or fallback to diverse active tours from different regions
  const featuredTours = useMemo(() => {
    if (!tours) return [];
    const activeTours = tours.filter(tour => tour.status === 'active');
    // First try featured tours
    const markedFeatured = activeTours.filter(tour => tour.featured === 1);
    if (markedFeatured.length >= 4) return markedFeatured.slice(0, 6);
    // Fallback: pick diverse tours from different destination countries
    const seen = new Set<string>();
    const diverse: typeof activeTours = [];
    for (const tour of activeTours) {
      const country = (tour.destinationCountry || tour.destination || 'other').split('·')[0].trim();
      if (!seen.has(country)) {
        seen.add(country);
        diverse.push(tour);
      }
      if (diverse.length >= 6) break;
    }
    // If still not enough, fill with remaining active tours
    if (diverse.length < 4) {
      for (const tour of activeTours) {
        if (!diverse.find(t => t.id === tour.id)) diverse.push(tour);
        if (diverse.length >= 6) break;
      }
    }
    return diverse;
  }, [tours]);

  // Batch fetch translations for non-Chinese languages
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tourIds = useMemo(() => featuredTours.map(tour => tour.id), [featuredTours.length, featuredTours.map(tour => tour.id).join(',')]);
  const { data: batchTranslations } = trpc.translation.getBatchTourTranslations.useQuery(
    { tourIds, targetLanguage: language as 'zh-TW' | 'en' | 'ja' | 'ko' },
    { enabled: language !== 'zh-TW' && tourIds.length > 0 }
  );

  // Helper to get translated field for a specific tour
  const getTranslatedField = (tourId: number, field: string, fallback: string) => {
    if (language === 'zh-TW' || !batchTranslations) return fallback;
    const tourTranslations = (batchTranslations as Record<number, Record<string, string>>)[tourId];
    return tourTranslations?.[field] || fallback;
  };

  return (
    <section id="featured-tours" className="py-20 bg-white">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-serif font-bold text-black mb-4 relative inline-block">
            {t('featuredTours.title')}
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-1 bg-black"></span>
          </h2>
          <p className="text-gray-600 mt-4">{t('featuredTours.subtitle')}</p>
        </div>

        {isLoading && <LoadingPage />}

        {error && (
          <div className="text-center py-20">
            <p className="text-gray-600">{t('common.error')}</p>
          </div>
        )}

        {!isLoading && !error && featuredTours.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-600">{t('common.noResults')}</p>
          </div>
        )}

        {!isLoading && !error && featuredTours.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
              {featuredTours.map((tour) => (
                <Card key={tour.id} className="group overflow-hidden border-2 border-black   shadow-lg hover:shadow-lg transition-all duration-300">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl">
                    {(tour.imageUrl || tour.heroImage) ? (
                      <img 
                        src={(tour.imageUrl || tour.heroImage) ?? undefined} 
                        alt={getTranslatedField(tour.id, 'title', tour.title)} 
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 rounded-xl"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const parent = e.currentTarget.parentElement;
                          if (parent && !parent.querySelector('.img-fallback')) {
                            const div = document.createElement('div');
                            div.className = 'img-fallback absolute inset-0 bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center rounded-t-xl';
                            div.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>';
                            parent.appendChild(div);
                          }
                        }}
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center rounded-t-xl">
                        <MapPin className="h-12 w-12 text-white/40" />
                      </div>
                    )}
                    <div className="absolute top-4 left-4">
                      <Badge className="bg-black text-white hover:bg-black px-4 py-1 text-xs font-bold tracking-wider shadow-lg rounded-lg">
                        {t('featuredTours.title')}
                      </Badge>
                    </div>
                    <div className="absolute top-4 right-4">
                      <FavoriteButton tourId={tour.id} size="md" />
                    </div>
                    <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/80 to-transparent p-6">
                      <div className="flex items-center justify-between text-white">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-white" />
                          <span className="text-sm font-medium">{tour.duration} {t('common.days')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-white" />
                          <span className="text-sm font-medium">{translateDestination(tour.destination || '', language)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <Badge variant="outline" className="mb-2 text-black border-black rounded-lg">
                          {tour.category === 'group' && t('nav.groupTours')}
                          {tour.category === 'custom' && t('nav.customTours')}
                          {tour.category === 'theme' && t('common.features')}
                        </Badge>
                        <h3 className="text-xl sm:text-2xl font-bold text-black group-hover:text-gray-700 transition-colors">
                          {getTranslatedField(tour.id, 'title', tour.title)}
                        </h3>
                        <p className="text-gray-600 text-sm font-medium">{translateDestination(tour.destination || '', language)}</p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <p className="text-gray-600 text-sm line-clamp-3">
                      {getTranslatedField(tour.id, 'description', tour.description || '')}
                    </p>
                  </CardContent>

                  <CardFooter className="flex items-center justify-between border-t-2 border-black pt-6 bg-gray-50">
                    <div>
                      <span className="text-xs text-gray-500 block">{t('common.perPerson')}</span>
                      <span className="text-xl sm:text-2xl font-bold text-black">{formatPrice(tour.price, (tour.priceCurrency as 'TWD' | 'USD') || 'TWD')}</span>
                      <span className="text-xs text-gray-400 ml-1">{t('common.startingFrom')}</span>
                    </div>
                    <Link href={`/tours/${tour.id}`}>
                      <Button className="bg-black hover:bg-gray-800 text-white px-4 sm:px-8 shadow-md transition-transform active:scale-95 rounded-lg text-sm sm:text-base">
                        {t('common.viewMore')}
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>

            {/* View More Button */}
            <div className="text-center mt-12">
              <Link href="/tours">
                <Button 
                  variant="outline" 
                  className="border-2 border-black text-black hover:bg-black hover:text-white px-8 sm:px-12 py-4 sm:py-6 text-base sm:text-lg font-bold transition-all rounded-lg"
                >
                  {t('featuredTours.viewAll')}
                </Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
