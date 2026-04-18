import { Shield, Clock, Users, Star, Globe, Headphones } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

const reasons = [
  {
    icon: Shield,
    titleZh: "安心保障",
    titleEn: "Peace of Mind",
    descZh: "全程旅遊保險，緊急狀況 24 小時支援，讓您旅途無憂",
    descEn: "Full travel insurance coverage and 24/7 emergency support throughout your journey",
  },
  {
    icon: Users,
    titleZh: "專業領隊",
    titleEn: "Expert Guides",
    descZh: "資深中文領隊全程陪同，深入介紹當地文化與景點",
    descEn: "Experienced Mandarin-speaking guides accompany you throughout the entire trip",
  },
  {
    icon: Globe,
    titleZh: "豐富目的地",
    titleEn: "Rich Destinations",
    descZh: "涵蓋亞洲、歐洲、美洲等全球熱門旅遊目的地",
    descEn: "Covering popular destinations across Asia, Europe, Americas and beyond",
  },
  {
    icon: Star,
    titleZh: "精選行程",
    titleEn: "Curated Itineraries",
    descZh: "每條行程都經過精心設計，確保您獲得最佳旅遊體驗",
    descEn: "Every itinerary is carefully crafted to ensure you get the best travel experience",
  },
  {
    icon: Clock,
    titleZh: "快速回覆",
    titleEn: "Fast Response",
    descZh: "諮詢問題 24 小時內回覆，預訂流程簡單快速",
    descEn: "Inquiries answered within 24 hours, with a simple and fast booking process",
  },
  {
    icon: Headphones,
    titleZh: "貼心服務",
    titleEn: "Personalized Service",
    descZh: "從行前準備到返程，全程提供一對一的專屬服務",
    descEn: "One-on-one dedicated service from pre-trip preparation to your return",
  },
];

export default function WhyChooseUs() {
  const { language } = useLocale();
  const isEn = language === "en";

  return (
    <section className="py-16 bg-black text-white border-b border-gray-800">
      <div className="container">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="text-xs font-bold tracking-[0.3em] text-gray-400 uppercase mb-3">
            {isEn ? "WHY PACK&GO" : "為什麼選擇我們"}
          </p>
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-white mb-4">
            {isEn ? "Travel with Confidence" : "讓旅行更有保障"}
          </h2>
          <p className="text-gray-400 text-base max-w-2xl mx-auto leading-relaxed">
            {isEn
              ? "PACK&GO has been serving Chinese-speaking travelers for years. We understand your needs and deliver exceptional experiences."
              : "PACK&GO 多年來專注服務華人旅客，深刻了解您的需求，為您提供卓越的旅遊體驗"}
          </p>
        </div>

        {/* Reasons Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reasons.map((reason, index) => {
            const Icon = reason.icon;
            return (
              <div
                key={index}
                className="border border-gray-700 p-4 sm:p-6 hover:border-white transition-colors duration-300 group"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 border border-gray-600 group-hover:border-white flex items-center justify-center transition-colors">
                    <Icon className="h-5 w-5 text-gray-400 group-hover:text-white transition-colors" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-2">
                      {isEn ? reason.titleEn : reason.titleZh}
                    </h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                      {isEn ? reason.descEn : reason.descZh}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/*
          Stats Row removed per FTC Act §5 (deceptive acts/practices) and
          16 CFR Part 260 (advertising substantiation).
          Prior hardcoded numbers ("10+ years", "1,200+ travelers",
          "50+ destinations", "98% satisfaction") had no reasonable basis
          documented. Re-introduce only when backed by auditable data
          (e.g., tRPC query over bookings table with tourist-facing caveats).
        */}
      </div>
    </section>
  );
}
