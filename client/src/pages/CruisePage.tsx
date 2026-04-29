import { useState, useMemo } from "react";
import Header from "@/components/Header";
import SEO from "@/components/SEO";
import Footer from "@/components/Footer";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Ship,
  MapPin,
  Calendar,
  Search,
  Heart,
  ChevronRight,
  ArrowLeft,
  Anchor,
  Waves,
  Star,
} from "lucide-react";

// 郵輪圖片
const cruiseImages: Record<string, string> = {
  "地中海": "https://images.unsplash.com/photo-1548574505-5e239809ee19?w=800",
  "加勒比海": "https://images.unsplash.com/photo-1599640842225-85d111c60e6b?w=800",
  "阿拉斯加": "https://images.unsplash.com/photo-1531176175280-33e7c0eb7b3c?w=800",
  "北歐": "https://images.unsplash.com/photo-1507272931001-fc06c17e4f43?w=800",
  "亞洲": "https://images.unsplash.com/photo-1559494007-9f5847c49d94?w=800",
  "default": "https://images.unsplash.com/photo-1548574505-5e239809ee19?w=800",
};

export default function CruisePage() {
  const { t, language, formatPrice } = useLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState<Set<number>>(new Set());

  // TAG_LABELS: maps tag key → translated label
  const TAG_LABELS = {
    deepTravel:  t('cruise.deepTravel'),
    classicTour: t('cruise.classicTour'),
    lightTravel: t('cruise.lightTravel'),
    premiumTour: t('cruise.premiumTour'),
    valueDeal:   t('cruise.valueDeal'),
    cruise:      t('cruise.cruise'),
  };

  // 智能標籤生成函數 — uses TAG_LABELS instead of hardcoded Chinese
  function generateSmartTags(tour: any): { text: string; color: string; icon?: string }[] {
    const tags: { text: string; color: string; icon?: string }[] = [];

    const days = tour.days || 0;
    if (days >= 10) {
      tags.push({ text: TAG_LABELS.deepTravel, color: "bg-teal-100 text-teal-700 border-teal-200" });
    } else if (days >= 7) {
      tags.push({ text: TAG_LABELS.classicTour, color: "bg-blue-100 text-blue-700 border-blue-200" });
    } else if (days <= 4 && days > 0) {
      tags.push({ text: TAG_LABELS.lightTravel, color: "bg-green-100 text-green-700 border-green-200" });
    }

    const price = tour.price || 0;
    if (price >= 80000) {
      tags.push({ text: TAG_LABELS.premiumTour, color: "bg-amber-100 text-amber-700 border-amber-200", icon: "star" });
    } else if (price <= 30000 && price > 0) {
      tags.push({ text: TAG_LABELS.valueDeal, color: "bg-red-100 text-red-700 border-red-200", icon: "tag" });
    }

    tags.push({ text: TAG_LABELS.cruise, color: "bg-cyan-100 text-cyan-700 border-cyan-200", icon: "ship" });

    return tags;
  }

  // 搜尋郵輪行程
  const { data: searchResults, isLoading } = trpc.tours.search.useQuery({
    pageSize: 100,
  });

  // 過濾郵輪行程
  const cruiseTours = useMemo(() => {
    if (!searchResults?.tours) return [];

    return searchResults.tours.filter((tour: any) => {
      const tagsArray = Array.isArray(tour.tags) ? tour.tags : [];
      const isCruise =
        tour.title?.includes("郵輪") ||
        tour.tourType?.includes("郵輪") ||
        tagsArray.some((tag: string) => tag.includes("郵輪"));

      const matchesSearch = !searchQuery ||
        tour.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tour.destination?.toLowerCase().includes(searchQuery.toLowerCase());

      return isCruise && matchesSearch;
    });
  }, [searchResults, searchQuery]);

  // Batch fetch translations for non-Chinese languages
  const tourIds = useMemo(() => cruiseTours.map((t: any) => t.id), [cruiseTours.length, cruiseTours.map((t: any) => t.id).join(',')]);
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

  const toggleFavorite = (id: number) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(id)) {
        newFavorites.delete(id);
      } else {
        newFavorites.add(id);
      }
      return newFavorites;
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <SEO
        title={t('cruise.title')}
        description={t('cruise.subtitle')}
        url="/cruise"
      />
      <Header />

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative h-[400px] overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url('https://images.unsplash.com/photo-1548574505-5e239809ee19?w=1920')`,
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/60" />
          </div>

          <div className="relative container h-full flex flex-col justify-center items-center text-center text-white">
            <div className="flex items-center gap-3 mb-4">
              <Ship className="h-12 w-12" />
              <Anchor className="h-8 w-8 opacity-60" />
              <Waves className="h-8 w-8 opacity-60" />
            </div>
            <h1 className="text-4xl md:text-5xl font-serif font-bold mb-4">
              {t('cruise.title')}
            </h1>
            <p className="text-xl text-white/90 max-w-2xl">
              {t('cruise.subtitle')}
            </p>
          </div>
        </section>

        {/* 麵包屑導航 */}
        <div className="bg-white border-b">
          <div className="container py-3">
            <nav className="flex items-center gap-2 text-sm">
              <Link href="/" className="text-gray-500 hover:text-primary transition-colors">
                {t('cruise.home')}
              </Link>
              <ChevronRight className="h-4 w-4 text-gray-400" />
              <span className="text-gray-900 font-medium">{t('cruise.title')}</span>
            </nav>
          </div>
        </div>

        {/* 搜尋區 */}
        <section className="bg-white py-6 border-b">
          <div className="container">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  placeholder={t('cruise.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span>{t('cruise.totalCruises', { count: cruiseTours.length })}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 郵輪行程列表 */}
        <section className="py-12">
          <div className="container">
            {isLoading ? (
              <div className="flex justify-center items-center py-20">
                <div className="animate-spin rounded-lg h-12 w-12 border-b-2 border-primary"></div>
              </div>
            ) : cruiseTours.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {cruiseTours.map((tour: any) => {
                  const smartTags = generateSmartTags(tour);
                  const displayTags = smartTags.slice(0, 3);
                  const hasMoreTags = smartTags.length > 3;
                  const displayTitle = getTranslatedField(tour.id, 'title', tour.title);

                  return (
                    <Link key={tour.id} href={`/tours/${tour.id}`}>
                      <div className="bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 group cursor-pointer h-full flex flex-col">
                        {/* 圖片 */}
                        <div className="relative h-48 overflow-hidden rounded-t-xl">
                          <img
                            src={tour.imageUrl || cruiseImages.default}
                            alt={displayTitle}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 rounded-xl"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

                          {/* 收藏按鈕 */}
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleFavorite(tour.id);
                            }}
                            className="absolute top-3 right-3 p-2 rounded-lg bg-white/90 hover:bg-white transition-colors"
                          >
                            <Heart
                              className={`h-5 w-5 ${
                                favorites.has(tour.id)
                                  ? "fill-red-500 text-red-500"
                                  : "text-gray-600"
                              }`}
                            />
                          </button>

                          {/* 郵輪標識 */}
                          <div className="absolute top-3 left-3 bg-cyan-500 text-white px-3 py-1 rounded-lg text-sm font-medium flex items-center gap-1">
                            <Ship className="h-4 w-4" />
                            {TAG_LABELS.cruise}
                          </div>
                        </div>

                        {/* 內容 */}
                        <div className="p-4 flex-1 flex flex-col">
                          {/* 目的地 */}
                          <div className="flex items-center gap-1 text-gray-500 text-sm mb-2">
                            <MapPin className="h-4 w-4" />
                            <span>{tour.destination ? translateDestination(tour.destination, language) : t('cruise.multipleDestinations')}</span>
                          </div>

                          {/* 標題 */}
                          <h3 className="font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                            {displayTitle}
                          </h3>

                          {/* 標籤 */}
                          <div className="flex flex-wrap gap-1.5 mb-3 h-[28px] overflow-hidden">
                            {displayTags.map((tag, idx) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className={`text-xs ${tag.color} border`}
                              >
                                {tag.text}
                              </Badge>
                            ))}
                            {hasMoreTags && (
                              <Badge
                                variant="outline"
                                className="text-xs bg-gray-100 text-gray-600 border-gray-200"
                              >
                                +{smartTags.length - 3}
                              </Badge>
                            )}
                          </div>

                          {/* 天數與價格 */}
                          <div className="mt-auto pt-3 border-t flex items-center justify-between">
                            <div className="flex items-center gap-1 text-gray-600 text-sm">
                              <Calendar className="h-4 w-4" />
                              <span>{tour.days || "-"} {t('cruise.days')}</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-gray-500">{t('cruise.perPerson')}</div>
                              <div className="text-lg font-bold text-primary">
                                {tour.price ? formatPrice(Number(tour.price), "TWD") : "-"}
                                <span className="text-sm font-normal text-gray-500">{t('cruise.from')}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-20">
                <Ship className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-xl font-medium text-gray-600 mb-2">
                  {t('cruise.noCruises')}
                </h3>
                <p className="text-gray-500 mb-6">
                  {t('cruise.noCruisesDesc')}
                </p>
                <Link href="/search">
                  <Button variant="outline">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t('cruise.browseAll')}
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* 郵輪特色介紹 */}
        <section className="py-12 bg-white">
          <div className="container">
            <h2 className="text-2xl font-serif font-bold text-center mb-8">
              {t('cruise.whyChoose')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-cyan-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Ship className="h-8 w-8 text-cyan-600" />
                </div>
                <h3 className="font-bold mb-2">{t('cruise.feature1Title')}</h3>
                <p className="text-gray-600 text-sm">
                  {t('cruise.feature1Desc')}
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-cyan-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Star className="h-8 w-8 text-cyan-600" />
                </div>
                <h3 className="font-bold mb-2">{t('cruise.feature2Title')}</h3>
                <p className="text-gray-600 text-sm">
                  {t('cruise.feature2Desc')}
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-cyan-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Waves className="h-8 w-8 text-cyan-600" />
                </div>
                <h3 className="font-bold mb-2">{t('cruise.feature3Title')}</h3>
                <p className="text-gray-600 text-sm">
                  {t('cruise.feature3Desc')}
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
