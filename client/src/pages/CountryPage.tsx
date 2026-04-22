import { useParams, useLocation } from "wouter";
import SEO from "@/components/SEO";

import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { 
  MapPin, Calendar, Heart, Star, Plane, Bus, Ship, Train, 
  Sparkles, Mountain, Utensils, Camera, Users, ArrowRight, ArrowLeft
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";

// 智能標籤生成函數
const generateSmartTags = (tour: any, t: (key: string) => string): { label: string; icon: any; color: string }[] => {
  const tags: { label: string; icon: any; color: string }[] = [];
  
  // 根據天數判斷行程類型
  if (tour.duration >= 10) {
    tags.push({ label: t('tours.filters.deepTravel') || "深度旅遊", icon: Mountain, color: "bg-emerald-100 text-emerald-700" });
  } else if (tour.duration >= 7) {
    tags.push({ label: t('tours.filters.classic') || "經典行程", icon: Star, color: "bg-amber-100 text-amber-700" });
  } else if (tour.duration <= 4) {
    tags.push({ label: t('tours.filters.shortTrip') || "輕旅行", icon: Sparkles, color: "bg-sky-100 text-sky-700" });
  }
  
  // 根據價格判斷行程等級
  if (tour.price && tour.price >= 80000) {
    tags.push({ label: t('tours.filters.premium') || "精緻行程", icon: Star, color: "bg-purple-100 text-purple-700" });
  } else if (tour.price && tour.price < 30000) {
    tags.push({ label: t('tours.filters.budget') || "超值優惠", icon: Sparkles, color: "bg-rose-100 text-rose-700" });
  }
  
  // 根據交通方式判斷
  const category = tour.category?.toLowerCase() || "";
  const title = tour.title?.toLowerCase() || "";
  const description = tour.description?.toLowerCase() || "";
  const combinedText = `${title} ${description}`;
  
  if (category === "cruise" || combinedText.includes("郵輪") || combinedText.includes("遊輪")) {
    tags.push({ label: t('cruise.title') || "郵輪", icon: Ship, color: "bg-blue-100 text-blue-700" });
  }
  
  if (tour.outboundAirline || combinedText.includes("航空") || combinedText.includes("飛機")) {
    tags.push({ label: t('flightBooking.title') || "航空", icon: Plane, color: "bg-indigo-100 text-indigo-700" });
  }
  
  if (combinedText.includes("高鐵") || combinedText.includes("火車") || combinedText.includes("列車")) {
    tags.push({ label: t('tours.filters.rail') || "鐵道", icon: Train, color: "bg-orange-100 text-orange-700" });
  }
  
  if (combinedText.includes("巴士") || combinedText.includes("遊覽車")) {
    tags.push({ label: t('tours.filters.bus') || "巴士", icon: Bus, color: "bg-gray-100 text-gray-700" });
  }
  
  // 根據特色活動判斷
  if (combinedText.includes("美食") || combinedText.includes("料理") || combinedText.includes("餐廳")) {
    tags.push({ label: t('tours.filters.foodTour') || "美食之旅", icon: Utensils, color: "bg-red-100 text-red-700" });
  }
  
  if (combinedText.includes("攝影") || combinedText.includes("拍照") || combinedText.includes("打卡")) {
    tags.push({ label: t('tours.filters.photoTour') || "攝影之旅", icon: Camera, color: "bg-pink-100 text-pink-700" });
  }
  
  // 根據行程類型判斷
  if (category === "group" || combinedText.includes("團體")) {
    tags.push({ label: t('groupPackages.title') || "團體旅遊", icon: Users, color: "bg-teal-100 text-teal-700" });
  }
  
  // 解析資料庫中的 tags 欄位
  if (tour.tags) {
    try {
      const dbTags = typeof tour.tags === "string" ? JSON.parse(tour.tags) : tour.tags;
      if (Array.isArray(dbTags)) {
        dbTags.forEach((tag: string) => {
          if (!tags.some(t => t.label === tag)) {
            tags.push({ label: tag, icon: Star, color: "bg-gray-100 text-gray-700" });
          }
        });
      }
    } catch (e) {
      // 忽略解析錯誤
    }
  }
  
  return tags.slice(0, 5);
};

// 地區配置
const getRegionConfig = (t: (key: string) => string): Record<string, {
  name: string;
  label: string;
}> => ({
  "europe": { name: t('destinations.regions.europe') || "歐洲地區", label: "Europe" },
  "asia": { name: t('destinations.regions.asia') || "亞洲地區", label: "Asia" },
  "south-america": { name: t('destinations.regions.americas') || "美洲地區", label: "Americas" },
  "middle-east": { name: t('destinations.regions.middleEast') || "中東地區", label: "Middle East" },
  "africa": { name: t('destinations.regions.africa') || "非洲地區", label: "Africa" },
  "cruise": { name: t('cruise.title') || "郵輪之旅", label: "Cruises" },
  "oceania": { name: t('destinations.regions.oceania') || "大洋洲地區", label: "Oceania" }
});

// 國家圖片映射
const countryImages: Record<string, string> = {
  "日本": "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1600",
  "韓國": "https://images.unsplash.com/photo-1517154421773-0529f29ea451?w=1600",
  "台灣": "https://images.unsplash.com/photo-1470004914212-05527e49370b?w=1600",
  "中國": "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=1600",
  "泰國": "https://images.unsplash.com/photo-1528181304800-259b08848526?w=1600",
  "越南": "https://images.unsplash.com/photo-1557750255-c76072a7aad1?w=1600",
  "新加坡": "https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=1600",
  "英國": "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1600",
  "法國": "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1600",
  "德國": "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=1600",
  "義大利": "https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?w=1600",
  "西班牙": "https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=1600",
  "瑞士": "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?w=1600",
  "希臘": "https://images.unsplash.com/photo-1533105079780-92b9be482077?w=1600",
  "巴爾幹半島": "https://images.unsplash.com/photo-1555990538-1e6c0c1b1b0c?w=1600",
  "澳洲": "https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?w=1600",
  "紐西蘭": "https://images.unsplash.com/photo-1507699622108-4be3abd695ad?w=1600",
  "美國": "https://images.unsplash.com/photo-1485738422979-f5c462d49f74?w=1600",
  "加拿大": "https://images.unsplash.com/photo-1517935706615-2717063c2225?w=1600",
  "埃及": "https://images.unsplash.com/photo-1539650116574-8efeb43e2750?w=1600",
  "南非": "https://images.unsplash.com/photo-1484318571209-661cf29a69c3?w=1600",
  "阿聯酋": "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1600",
  "約旦": "https://images.unsplash.com/photo-1548786811-dd6e453ccca7?w=1600",
  "以色列": "https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=1600",
};

export default function CountryPage() {
  const { region, country } = useParams<{ region: string; country: string }>();
  const [, setLocation] = useLocation();
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const { t, language } = useLocale();
  
  const decodedCountry = decodeURIComponent(country || "");
  const regionConfig = getRegionConfig(t);
  const regionInfo = regionConfig[region || ""] || { name: t('common.unknown') || "未知地區", label: "Unknown" };

  // 搜尋該國家的所有行程
  const { data: searchResults, isLoading } = trpc.tours.search.useQuery({
    destination: decodedCountry,
    page: 1,
    pageSize: 50
  });

  const tours = searchResults?.tours || [];

  // Batch fetch translations for non-Chinese languages
  const tourIds = tours.map((t: any) => t.id);
  const { data: batchTranslations } = trpc.translation.getBatchTourTranslations.useQuery(
    { tourIds, targetLanguage: language as 'en' | 'ja' | 'ko' },
    { enabled: language !== 'zh-TW' && tourIds.length > 0, staleTime: 1000 * 60 * 5 }
  );
  const getTranslatedTitle = (tour: any): string => {
    if (language === 'zh-TW' || !batchTranslations) return tour.title || '';
    const tourTrans = (batchTranslations as Record<number, Record<string, string>>)[tour.id];
    return tourTrans?.title || tour.title || '';
  };

  const handleTourClick = (tourId: number) => {
    setLocation(`/tours/${tourId}`);
  };

  const handleBackClick = () => {
    setLocation(`/destinations/${region}`);
  };

  const toggleFavorite = (e: React.MouseEvent, tourId: number) => {
    e.stopPropagation();
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(tourId)) {
        newFavorites.delete(tourId);
      } else {
        newFavorites.add(tourId);
      }
      return newFavorites;
    });
  };

  const heroImage = countryImages[decodedCountry] || "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1600";

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title={{
          zh: `${translateDestination(decodedCountry, 'zh-TW')} 旅遊行程`,
          en: `${translateDestination(decodedCountry, 'en')} Tours`,
        }}
        description={{
          zh: `探索 ${translateDestination(decodedCountry, 'zh-TW')} 精選旅遊行程，PACK&GO 為您規劃難忘的旅遊體驗。`,
          en: `Explore curated tour packages in ${translateDestination(decodedCountry, 'en')} — PACK&GO plans unforgettable travel experiences for you.`,
        }}
        url={`/destinations/${encodeURIComponent(decodedCountry)}`}
      />
      <Header />
      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative h-[350px] overflow-hidden">
          <img 
            src={heroImage} 
            alt={decodedCountry}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 w-full p-8">
            <div className="container">
              <Button 
                variant="ghost" 
                className="text-white mb-4 hover:bg-white/20"
                onClick={handleBackClick}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('common.backTo')} {regionInfo.name}
              </Button>
              <h1 className="text-4xl md:text-5xl font-serif font-bold text-white mb-2">
                {decodedCountry}
              </h1>
              <p className="text-gray-200 text-lg">
                {tours.length} {t('countryPage.tours')}
              </p>
            </div>
          </div>
        </section>

        {/* 行程列表 */}
        <section className="py-12">
          <div className="container">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="aspect-[16/10] bg-gray-200 rounded-lg mb-4" />
                    <div className="h-6 bg-gray-200 rounded w-3/4 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : tours.length === 0 ? (
              <div className="text-center py-16">
                <MapPin className="mx-auto h-16 w-16 text-gray-300 mb-4" />
                <h3 className="text-xl font-medium text-gray-700 mb-2">
                  {t('countryPage.noTours')}
                </h3>
                <p className="text-gray-500 mb-6">
                  {t('countryPage.checkBackLater')}
                </p>
                <Button 
                  variant="outline" 
                  onClick={handleBackClick}
                >
                  {t('common.backTo')} {regionInfo.name}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tours.map((tour) => {
                  const smartTags = generateSmartTags(tour, t);
                  const displayTags = smartTags.slice(0, 3);
                  const hasMoreTags = smartTags.length > 3;

                  return (
                    <div
                      key={tour.id}
                      onClick={() => handleTourClick(tour.id)}
                      className="group cursor-pointer bg-white border border-gray-100 rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300"
                    >
                      {/* 圖片 */}
                      <div className="relative aspect-[16/10] overflow-hidden rounded-xl">
                        <img
                          src={tour.imageUrl || "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800"}
                          alt={getTranslatedTitle(tour)}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 rounded-xl"
                        />
                        <button
                          onClick={(e) => toggleFavorite(e, tour.id)}
                          className="absolute top-3 right-3 p-2 bg-white/90 rounded-lg hover:bg-white transition-colors"
                        >
                          <Heart 
                            className={`h-5 w-5 ${favorites.has(tour.id) ? 'fill-red-500 text-red-500' : 'text-gray-600'}`}
                          />
                        </button>
                        {tour.duration && (
                          <div className="absolute bottom-3 left-3 px-3 py-1 bg-black/70 text-white text-sm rounded-lg">
                            {tour.duration} {t('common.days')}
                          </div>
                        )}
                      </div>

                      {/* 內容 */}
                      <div className="p-4">
                        <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                          <MapPin className="h-4 w-4" />
                          <span>{translateDestination(tour.destination || '', language)}</span>
                        </div>
                        
                        <h3 className="font-bold text-gray-900 mb-3 line-clamp-2 group-hover:text-primary transition-colors">
                          {getTranslatedTitle(tour)}
                        </h3>

                        {/* 標籤 */}
                        <div className="flex flex-wrap gap-1 mb-4">
                          {displayTags.map((tag: { label: string; icon: any; color: string }, idx: number) => {
                            const IconComponent = tag.icon;
                            return (
                              <span
                                key={idx}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg ${tag.color}`}
                              >
                                <IconComponent className="h-3 w-3" />
                                {tag.label}
                              </span>
                            );
                          })}
                          {hasMoreTags && (
                            <span className="inline-flex items-center px-2 py-0.5 text-xs rounded-lg bg-gray-100 text-gray-600">
                              +{smartTags.length - 3}
                            </span>
                          )}
                        </div>

                        {/* 價格 */}
                        <div className="flex items-end justify-between">
                          <div>
                            <span className="text-gray-500 text-sm">{t('tours.perPerson')}</span>
                            <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-bold text-primary">
                                NT$ {tour.price?.toLocaleString() || t('common.contactUs')}
                              </span>
                              <span className="text-gray-500 text-sm">{t('tours.priceFrom')}</span>
                            </div>
                          </div>
                          <div className="flex items-center text-gray-600 text-sm group-hover:text-primary transition-colors">
                            {t('common.viewDetails')}
                            <ArrowRight className="ml-1 h-4 w-4" />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
