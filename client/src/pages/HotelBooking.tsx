import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trackAffiliateClick } from "@/lib/analytics";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Hotel, Star, Wifi, Car, Utensils, Dumbbell, Shield, Headphones, ArrowRight, MapPin, CheckCircle, Building2, Palmtree, Waves, Flame, ExternalLink, Search } from "lucide-react";
import AITravelAdvisorDialog from "@/components/AITravelAdvisorDialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function HotelBooking() {
  const { t, language } = useLocale();
  const isChineseMode = language === 'zh-TW';
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorInitialMsg, setAdvisorInitialMsg] = useState("");

  // Hotel search form state
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const utils = trpc.useUtils();
  const trackClickMutation = trpc.affiliate.trackClick.useMutation();

  const openAdvisor = (msg: string) => {
    setAdvisorInitialMsg(msg);
    setAdvisorOpen(true);
  };

  const handleSearchHotels = async () => {
    setIsSearching(true);
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: "hotels",
        city: city || undefined,
        checkIn: checkIn || undefined,
        checkOut: checkOut || undefined,
      });
      const url = result.url;
      await trackClickMutation.mutateAsync({
        platform: "trip_hotels",
        targetUrl: url,
        referrerPage: "/hotel-booking",
      });
      trackAffiliateClick({ platform: 'trip.com', linkType: 'hotel', destination: city || undefined, searchQuery: city || '' });
      toast.info(t('hotelBooking.page.toastSearching'));
      window.open(url, "_blank");
    } catch (err) {
      toast.error(t('hotelBooking.page.toastError'));
    } finally {
      setIsSearching(false);
    }
  };

  const handleDestinationClick = async (dest: { city: string; country: string }) => {
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: "hotels",
        city: dest.city,
      });
      await trackClickMutation.mutateAsync({
        platform: "trip_hotels",
        targetUrl: result.url,
        referrerPage: "/hotel-booking",
      });
      trackAffiliateClick({ platform: 'trip.com', linkType: 'hotel', destination: dest.city, searchQuery: `${dest.country}${dest.city}` });
      toast.info(t('hotelBooking.page.toastSearching'));
      window.open(result.url, "_blank");
    } catch {
      openAdvisor(`${dest.country} ${dest.city}`);
    }
  };

  const features = [
    { icon: Star, title: t('hotelBooking.page.feature1Title'), desc: t('hotelBooking.page.feature1Desc') },
    { icon: Shield, title: t('hotelBooking.page.feature2Title'), desc: t('hotelBooking.page.feature2Desc') },
    { icon: Headphones, title: t('hotelBooking.page.feature3Title'), desc: t('hotelBooking.page.feature3Desc') },
    { icon: CheckCircle, title: t('hotelBooking.page.feature4Title'), desc: t('hotelBooking.page.feature4Desc') },
  ];

  const hotelTypes = [
    { name: t('hotelBooking.page.type1Name'), desc: t('hotelBooking.page.type1Desc'), Icon: Hotel, tag: t('hotelBooking.page.type1Tag') },
    { name: t('hotelBooking.page.type2Name'), desc: t('hotelBooking.page.type2Desc'), Icon: Building2, tag: t('hotelBooking.page.type2Tag') },
    { name: t('hotelBooking.page.type3Name'), desc: t('hotelBooking.page.type3Desc'), Icon: Palmtree, tag: t('hotelBooking.page.type3Tag') },
    { name: t('hotelBooking.page.type4Name'), desc: t('hotelBooking.page.type4Desc'), Icon: Star, tag: t('hotelBooking.page.type4Tag') },
    { name: t('hotelBooking.page.type5Name'), desc: t('hotelBooking.page.type5Desc'), Icon: Flame, tag: t('hotelBooking.page.type5Tag') },
    { name: t('hotelBooking.page.type6Name'), desc: t('hotelBooking.page.type6Desc'), Icon: Waves, tag: t('hotelBooking.page.type6Tag') },
  ];

  const amenities = [
    { icon: Wifi, label: t('hotelBooking.filters.wifi') },
    { icon: Car, label: t('hotelBooking.filters.parking') },
    { icon: Utensils, label: t('hotelBooking.filters.restaurant') },
    { icon: Dumbbell, label: t('hotelBooking.filters.gym') },
    { icon: Star, label: t('hotelBooking.filters.pool') },
    { icon: Shield, label: t('hotelBooking.filters.security') },
  ];

  const destinations = [
    { city: isChineseMode ? "東京" : "Tokyo", country: isChineseMode ? "日本" : "Japan", hotels: "500+" },
    { city: isChineseMode ? "大阪" : "Osaka", country: isChineseMode ? "日本" : "Japan", hotels: "300+" },
    { city: isChineseMode ? "首爾" : "Seoul", country: isChineseMode ? "韓國" : "South Korea", hotels: "400+" },
    { city: isChineseMode ? "曼谷" : "Bangkok", country: isChineseMode ? "泰國" : "Thailand", hotels: "600+" },
    { city: isChineseMode ? "新加坡" : "Singapore", country: isChineseMode ? "新加坡" : "Singapore", hotels: "250+" },
    { city: isChineseMode ? "峇里島" : "Bali", country: isChineseMode ? "印尼" : "Indonesia", hotels: "350+" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />

      {/* Hotel Search Card */}
      <section className="py-10 bg-gray-50 border-b border-gray-200">
        <div className="container">
          <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
                <Search className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-black">{t('hotelBooking.page.searchTitle')}</h2>
                <p className="text-sm text-gray-500">{t('hotelBooking.page.searchSubtitle')}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">{t('hotelBooking.page.destinationLabel')}</Label>
                <Input placeholder={t('hotelBooking.page.destinationPlaceholder')} value={city} onChange={e => setCity(e.target.value)} className="h-11" />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">{t('hotelBooking.page.checkInLabel')}</Label>
                <Input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} className="h-11" />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">{t('hotelBooking.page.checkOutLabel')}</Label>
                <Input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} className="h-11" />
              </div>
            </div>
            <Button onClick={handleSearchHotels} disabled={isSearching} className="w-full h-12 bg-black hover:bg-gray-800 text-white font-bold text-base rounded-xl flex items-center justify-center gap-2">
              <Search className="h-5 w-5" />
              {isSearching ? t('hotelBooking.page.searching') : t('hotelBooking.page.searchBtn')}
              <ExternalLink className="h-4 w-4 opacity-70" />
            </Button>
            <p className="text-center text-xs text-gray-400 mt-3">{t('hotelBooking.page.redirectNote')}</p>
          </div>
        </div>
      </section>

      {/* Hero */}
      <section className="relative bg-black text-white overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=2070&auto=format&fit=crop"
            alt="Hotel booking"
            className="w-full h-full object-cover opacity-40"
          />
        </div>
        <div className="relative container py-24 md:py-32">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
              <Hotel className="h-4 w-4" />
              <span>{t('hotelBooking.page.heroBadge')}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              {t('hotelBooking.page.heroTitle')}<br />
              <span className="text-gray-300">{t('hotelBooking.page.heroTitleHighlight')}</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              {t('hotelBooking.page.heroDesc')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  {t('hotelBooking.page.heroCtaInquiry')} <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contact-us">
                <Button variant="outline" className="border-white/50 text-white hover:bg-white/10 font-bold px-8 py-3 h-auto rounded-lg text-base bg-transparent">
                  {t('hotelBooking.page.heroCtaContact')}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-gray-900 text-white py-8">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { num: "5,000+", label: t('hotelBooking.page.statPartnerHotels') },
              { num: "80+", label: t('hotelBooking.page.statCities') },
              { num: "3★-5★", label: t('hotelBooking.page.statStarRange') },
              { num: "99%", label: t('hotelBooking.page.statSuccessRate') },
            ].map((stat, i) => (
              <div key={i}>
                <div className="text-3xl font-bold text-white mb-1">{stat.num}</div>
                <div className="text-gray-400 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('hotelBooking.page.featuresTitle')}</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">{t('hotelBooking.page.featuresSubtitle')}</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, i) => (
              <div key={i} className="group">
                <div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-black mb-2">{feature.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Hotel Types — clickable to open AI advisor */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('hotelBooking.page.typesTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('hotelBooking.page.typesSubtitle')}</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {hotelTypes.map((type, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openAdvisor(`${type.name}: ${type.desc}`)}
                className="bg-white rounded-xl p-6 border border-gray-100 hover:border-black hover:shadow-md transition-all flex items-start gap-4 text-left w-full"
              >
                <div className="w-10 h-10 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                  <type.Icon className="h-5 w-5 text-black" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-bold text-black">{type.name}</h3>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{type.tag}</span>
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed mb-3">{type.desc}</p>
                  <span className="text-xs text-black font-medium underline underline-offset-2">{t('hotelBooking.page.typeClickHint')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Destinations — clickable to open AI advisor */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('hotelBooking.page.destTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('hotelBooking.page.destSubtitle')}</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {destinations.map((dest, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleDestinationClick(dest)}
                className="flex items-center gap-4 p-5 border border-gray-200 rounded-xl hover:border-black hover:shadow-sm transition-all group text-left w-full"
              >
                <div className="w-12 h-12 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                  <MapPin className="h-6 w-6 text-black" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-black">{dest.city}</div>
                  <div className="flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5" />
                    {dest.country}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-black text-sm">{dest.hotels}</div>
                  <div className="text-xs text-gray-500">{t('hotelBooking.page.destHotels')}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Amenities — clickable chips to open AI advisor */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('hotelBooking.page.amenitiesTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('hotelBooking.page.amenitiesSubtitle')}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {amenities.map((amenity, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openAdvisor(`${amenity.label}`)}
                className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all"
              >
                <amenity.icon className="h-4 w-4" />
                {amenity.label}
              </button>
            ))}
          </div>
          <p className="text-center text-gray-500 text-sm mt-6">
            {t('hotelBooking.page.amenitiesHint')}
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-black text-white">
        <div className="container text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('hotelBooking.page.ctaTitle')}</h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            {t('hotelBooking.page.ctaDesc')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                {t('hotelBooking.page.ctaInquiry')} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base bg-transparent">
                {t('hotelBooking.page.ctaContact')}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* AI Travel Advisor Dialog */}
      <AITravelAdvisorDialog
        open={advisorOpen}
        onOpenChange={setAdvisorOpen}
        initialMessage={advisorInitialMsg}
      />

      <Footer />
    </div>
  );
}
