import { ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";

export default function Destinations() {
  const [, setLocation] = useLocation();
  const { t, language } = useLocale();

  const destinations = [
    { id: 1, nameKey: "destinations.europe", image: "/images/dest-europe.webp", labelEn: "Europe", region: "europe" },
    { id: 2, nameKey: "destinations.asia", image: "/images/dest-asia.webp", labelEn: "Asia", region: "asia" },
    { id: 3, nameKey: "destinations.americas", image: "/images/dest-southamerica.webp", labelEn: "Americas", region: "south-america" },
    { id: 4, nameKey: "destinations.middleEast", image: "/images/dest-israel.webp", labelEn: "Middle East", region: "middle-east" },
    { id: 5, nameKey: "destinations.africa", image: "/images/dest-africa.webp", labelEn: "Africa", region: "africa" },
    { id: 6, nameKey: "destinations.cruises", image: "/images/dest-cruise.webp", labelEn: "Cruises", region: "cruise" },
  ];

  const handleDestinationClick = (region: string) => {
    if (region === "cruise") {
      setLocation("/cruises");
    } else {
      setLocation(`/destinations/${region}`);
    }
  };

  // In Chinese/Spanish mode: large Chinese/Spanish name + small English label
  // In English mode: large English name only (no redundant subtitle)
  const isChineseMode = language === 'zh-TW';

  return (
    <section id="destinations" className="py-20 bg-gray-50">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-serif font-bold text-gray-900 mb-4 relative inline-block">
            {t('destinations.title')}
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-1 bg-primary"></span>
          </h2>
          <p className="text-gray-500 mt-4">{t('destinations.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {destinations.map((dest) => (
            <div 
              key={dest.id} 
              onClick={() => handleDestinationClick(dest.region)}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl cursor-pointer shadow-md hover:shadow-xl transition-all duration-500"
            >
              <img 
                src={dest.image} 
                alt={t(dest.nameKey)} 
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 rounded-xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />
              
              <div className="absolute bottom-0 left-0 w-full p-4 sm:p-6 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-500">
                <h3 className="text-lg sm:text-2xl font-bold text-white mb-1">{t(dest.nameKey)}</h3>
                {/* Show English label only in non-English modes as a subtitle */}
                {isChineseMode && (
                  <p className="text-gray-300 text-xs sm:text-sm uppercase tracking-wider mb-2 sm:mb-4">{dest.labelEn}</p>
                )}
                <div className="flex items-center text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
                  {t('destinations.viewTours')} <ArrowRight className="ml-2 h-4 w-4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
