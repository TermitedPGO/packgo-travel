import { useState, useRef, useEffect } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trackAffiliateClick } from "@/lib/analytics";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  Hotel, Star, Wifi, Car, Utensils, Dumbbell, Shield, Headphones,
  ArrowRight, MapPin, CheckCircle, Building2, Palmtree, Waves, Flame,
  ExternalLink, Search, Users
} from "lucide-react";
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

  // Room & guest picker
  const [rooms, setRooms] = useState(1);
  const [hotelAdults, setHotelAdults] = useState(2);
  const [hotelChildren, setHotelChildren] = useState(0);
  const [showRoomPicker, setShowRoomPicker] = useState(false);
  const roomPickerRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  const trackClickMutation = trpc.affiliate.trackClick.useMutation();

  // Close picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (roomPickerRef.current && !roomPickerRef.current.contains(e.target as Node)) {
        setShowRoomPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        rooms,
        hotelAdults,
        hotelChildren,
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

  const roomSummary = `${rooms} ${t('hero.search.hotel.room')}, ${hotelAdults + hotelChildren} ${t('hero.search.hotel.guests')}`;

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

      {/* ─── Full-width Trip.com-style Hotel Search Card ─── */}
      <section className="py-10 bg-gray-50 border-b border-gray-200">
        <div className="container">
          <div className="max-w-5xl mx-auto bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden">
            {/* Card Header */}
            <div className="flex items-center gap-3 px-8 pt-7 pb-4 border-b border-gray-100">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
                <Hotel className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-black">{t('hotelBooking.page.searchTitle')}</h2>
                <p className="text-sm text-gray-500">{t('hotelBooking.page.searchSubtitle')}</p>
              </div>
            </div>

            <div className="px-8 py-6 space-y-5">
              {/* Row: Destination + Check-in + Check-out + Rooms/Guests + Search */}
              <div className="flex flex-col md:flex-row gap-4 items-end">
                {/* Destination */}
                <div className="w-full" style={{ flex: '1.5 1 0', minWidth: 0 }}>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hotelBooking.page.destinationLabel')}</label>
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder={t('hotelBooking.page.destinationPlaceholder')}
                    className="h-12 rounded-lg bg-gray-50 border-gray-200 focus:ring-black focus:border-black"
                  />
                </div>

                {/* Check-in */}
                <div className="w-full" style={{ flex: '0.8 1 0', minWidth: 0 }}>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hotelBooking.page.checkInLabel')}</label>
                  <Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="h-12 rounded-lg bg-gray-50 border-gray-200" />
                </div>

                {/* Check-out */}
                <div className="w-full" style={{ flex: '0.8 1 0', minWidth: 0 }}>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hotelBooking.page.checkOutLabel')}</label>
                  <Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="h-12 rounded-lg bg-gray-50 border-gray-200" />
                </div>

                {/* Room & Guest picker */}
                <div className="w-full relative" style={{ flex: '1 1 0', minWidth: 0 }} ref={roomPickerRef}>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.hotel.roomsGuests')}</label>
                  <button
                    onClick={() => setShowRoomPicker(!showRoomPicker)}
                    className="w-full h-12 px-4 text-sm text-left border border-gray-200 rounded-lg bg-gray-50 text-gray-700 hover:border-gray-300 flex items-center justify-between"
                  >
                    <span>{roomSummary}</span>
                    <Users className="h-4 w-4 text-gray-400" />
                  </button>
                  {showRoomPicker && (
                    <div className="absolute top-full mt-2 bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-50 w-full md:w-72 left-0 md:left-auto md:right-0">
                      {/* Rooms */}
                      <div className="flex items-center justify-between py-2">
                        <div className="text-sm font-medium text-gray-900">{t('hero.search.hotel.room')}</div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setRooms(Math.max(1, rooms - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={rooms <= 1}>−</button>
                          <span className="w-6 text-center font-medium">{rooms}</span>
                          <button onClick={() => setRooms(Math.min(8, rooms + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={rooms >= 8}>+</button>
                        </div>
                      </div>
                      {/* Adults */}
                      <div className="flex items-center justify-between py-2 border-t border-gray-100">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.adults')}</div>
                          <div className="text-xs text-gray-500">{t('hero.search.hotel.perRoom')}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setHotelAdults(Math.max(1, hotelAdults - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={hotelAdults <= 1}>−</button>
                          <span className="w-6 text-center font-medium">{hotelAdults}</span>
                          <button onClick={() => setHotelAdults(Math.min(6, hotelAdults + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={hotelAdults >= 6}>+</button>
                        </div>
                      </div>
                      {/* Children */}
                      <div className="flex items-center justify-between py-2 border-t border-gray-100">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.children')}</div>
                          <div className="text-xs text-gray-500">{t('hero.search.hotel.childrenAge')}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setHotelChildren(Math.max(0, hotelChildren - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={hotelChildren <= 0}>−</button>
                          <span className="w-6 text-center font-medium">{hotelChildren}</span>
                          <button onClick={() => setHotelChildren(Math.min(4, hotelChildren + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={hotelChildren >= 4}>+</button>
                        </div>
                      </div>
                      <button onClick={() => setShowRoomPicker(false)} className="mt-3 w-full py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                        {t('common.confirm')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Search button */}
                <div className="w-full md:w-40 flex-shrink-0">
                  <Button
                    onClick={handleSearchHotels}
                    disabled={isSearching}
                    className="w-full h-12 bg-black hover:bg-gray-900 text-white rounded-lg font-bold shadow-md transition-all hover:shadow-lg flex items-center justify-center gap-2"
                  >
                    <Search className="h-4 w-4" />
                    {isSearching ? t('hotelBooking.page.searching') : t('hotelBooking.page.searchBtn')}
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                  </Button>
                </div>
              </div>

              <p className="text-center text-xs text-gray-400">{t('hotelBooking.page.redirectNote')}</p>
            </div>
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

      {/* Hotel Types */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('hotelBooking.page.typesTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('hotelBooking.page.typesSubtitle')}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {hotelTypes.map((type, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 border border-gray-200 hover:border-black hover:shadow-md transition-all group cursor-pointer">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-gray-100 group-hover:bg-black rounded-xl flex items-center justify-center transition-colors">
                    <type.Icon className="h-6 w-6 text-gray-700 group-hover:text-white transition-colors" />
                  </div>
                  <span className="text-xs font-bold bg-gray-100 text-gray-600 px-3 py-1 rounded-full">{type.tag}</span>
                </div>
                <h3 className="text-lg font-bold text-black mb-2">{type.name}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{type.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Amenities */}
      <section className="py-16 bg-white border-t border-gray-100">
        <div className="container">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-black mb-2">{t('hotelBooking.page.amenitiesTitle')}</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {amenities.map((amenity, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-5 py-2.5">
                <amenity.icon className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">{amenity.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Destinations */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('hotelBooking.page.destinationsTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('hotelBooking.page.destinationsSubtitle')}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {destinations.map((dest, i) => (
              <button
                key={i}
                onClick={() => handleDestinationClick(dest)}
                className="group bg-white border border-gray-200 rounded-2xl p-6 hover:border-black hover:shadow-md transition-all text-left"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gray-100 group-hover:bg-black rounded-xl flex items-center justify-center transition-colors">
                    <MapPin className="h-5 w-5 text-gray-600 group-hover:text-white transition-colors" />
                  </div>
                  <div>
                    <div className="font-bold text-black">{dest.city}</div>
                    <div className="text-xs text-gray-500">{dest.country}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">{dest.hotels} {t('hotelBooking.page.hotelsCount')}</span>
                  <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-black transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-black text-white">
        <div className="container text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">{t('hotelBooking.page.ctaTitle')}</h2>
          <p className="text-gray-300 text-lg mb-10 max-w-2xl mx-auto">{t('hotelBooking.page.ctaDesc')}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-4 h-auto rounded-xl text-base">
                {t('hotelBooking.page.ctaInquiry')} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white/50 text-white hover:bg-white/10 font-bold px-10 py-4 h-auto rounded-xl text-base bg-transparent">
                {t('hotelBooking.page.ctaContact')}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
      <AITravelAdvisorDialog open={advisorOpen} onOpenChange={setAdvisorOpen} initialMessage={advisorInitialMsg} />
    </div>
  );
}
