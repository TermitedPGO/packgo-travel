import { useState, useRef, useEffect } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trackAffiliateClick } from "@/lib/analytics";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  Plane, Clock, Shield, Globe, CreditCard, Headphones, ArrowRight,
  Briefcase, Crown, Star, ExternalLink, Search, Users, ArrowLeftRight
} from "lucide-react";
import AITravelAdvisorDialog from "@/components/AITravelAdvisorDialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function FlightBooking() {
  const { t, language } = useLocale();
  const isChineseMode = language === 'zh-TW';
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorInitialMsg, setAdvisorInitialMsg] = useState("");

  // Trip type toggle
  const [tripType, setTripType] = useState<'roundtrip' | 'oneway'>('roundtrip');

  // Search form state
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departDate, setDepartDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [cabinClass, setCabinClass] = useState<'economy' | 'premiumEconomy' | 'business' | 'first'>('economy');

  // Passenger picker
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [showPassengerPicker, setShowPassengerPicker] = useState(false);
  const passengerPickerRef = useRef<HTMLDivElement>(null);

  const [isSearching, setIsSearching] = useState(false);

  const utils = trpc.useUtils();
  const trackClickMutation = trpc.affiliate.trackClick.useMutation();

  // Close picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (passengerPickerRef.current && !passengerPickerRef.current.contains(e.target as Node)) {
        setShowPassengerPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openAdvisor = (msg: string) => {
    setAdvisorInitialMsg(msg);
    setAdvisorOpen(true);
  };

  const handleSwapCities = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  };

  const handleSearchFlights = async () => {
    setIsSearching(true);
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: "flights",
        origin: origin || undefined,
        destination: destination || undefined,
        departDate: departDate || undefined,
        returnDate: tripType === 'roundtrip' ? (returnDate || undefined) : undefined,
        adults,
        children,
        infants,
        cabinClass,
      });
      const url = result.url;
      await trackClickMutation.mutateAsync({
        platform: "trip_flights",
        targetUrl: url,
        referrerPage: "/flight-booking",
      });
      trackAffiliateClick({ platform: 'trip.com', linkType: 'flight', destination: destination || undefined, searchQuery: `${origin || ''}→${destination || ''}` });
      toast.info(t('flightBooking.page.toastSearching'));
      window.open(url, "_blank");
    } catch (err) {
      toast.error(t('flightBooking.page.toastError'));
    } finally {
      setIsSearching(false);
    }
  };

  const handleRouteClick = async (route: { fromCode: string; toCode: string; from: string; to: string; duration: string }) => {
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: "flights",
        origin: route.fromCode,
        destination: route.toCode,
      });
      await trackClickMutation.mutateAsync({
        platform: "trip_flights",
        targetUrl: result.url,
        referrerPage: "/flight-booking",
      });
      trackAffiliateClick({ platform: 'trip.com', linkType: 'flight', destination: route.toCode, searchQuery: `${route.from}→${route.to}` });
      toast.info(t('flightBooking.page.toastSearching'));
      window.open(result.url, "_blank");
    } catch {
      openAdvisor(`${route.from} → ${route.to} (${route.duration})`);
    }
  };

  const totalPassengers = adults + children + infants;
  const passengerSummary = `${totalPassengers} ${t('hero.search.flight.passengers')}`;

  const features = [
    { icon: Globe, title: t('flightBooking.page.feature1Title'), desc: t('flightBooking.page.feature1Desc') },
    { icon: CreditCard, title: t('flightBooking.page.feature2Title'), desc: t('flightBooking.page.feature2Desc') },
    { icon: Headphones, title: t('flightBooking.page.feature3Title'), desc: t('flightBooking.page.feature3Desc') },
    { icon: Shield, title: t('flightBooking.page.feature4Title'), desc: t('flightBooking.page.feature4Desc') },
  ];

  const cabinClasses = [
    { name: t('flightBooking.page.cabin1Name'), nameEn: "Economy", desc: t('flightBooking.page.cabin1Desc'), Icon: Plane },
    { name: t('flightBooking.page.cabin2Name'), nameEn: "Premium Economy", desc: t('flightBooking.page.cabin2Desc'), Icon: Star },
    { name: t('flightBooking.page.cabin3Name'), nameEn: "Business", desc: t('flightBooking.page.cabin3Desc'), Icon: Briefcase },
    { name: t('flightBooking.page.cabin4Name'), nameEn: "First Class", desc: t('flightBooking.page.cabin4Desc'), Icon: Crown },
  ];

  const popularRoutes = [
    { from: isChineseMode ? "台北 TPE" : "Taipei TPE", to: isChineseMode ? "東京 TYO" : "Tokyo TYO", fromCode: "TPE", toCode: "TYO", duration: isChineseMode ? "約 3.5 小時" : "~3.5 hours", tagKey: "popular" as const },
    { from: isChineseMode ? "台北 TPE" : "Taipei TPE", to: isChineseMode ? "大阪 OSA" : "Osaka OSA", fromCode: "TPE", toCode: "OSA", duration: isChineseMode ? "約 3 小時" : "~3 hours", tagKey: "popular" as const },
    { from: isChineseMode ? "台北 TPE" : "Taipei TPE", to: isChineseMode ? "首爾 SEL" : "Seoul SEL", fromCode: "TPE", toCode: "SEL", duration: isChineseMode ? "約 2.5 小時" : "~2.5 hours", tagKey: "popular" as const },
    { from: isChineseMode ? "台北 TPE" : "Taipei TPE", to: isChineseMode ? "曼谷 BKK" : "Bangkok BKK", fromCode: "TPE", toCode: "BKK", duration: isChineseMode ? "約 4 小時" : "~4 hours", tagKey: "recommended" as const },
    { from: isChineseMode ? "台北 TPE" : "Taipei TPE", to: isChineseMode ? "新加坡 SIN" : "Singapore SIN", fromCode: "TPE", toCode: "SIN", duration: isChineseMode ? "約 4.5 小時" : "~4.5 hours", tagKey: "recommended" as const },
    { from: isChineseMode ? "台北 TPE" : "Taipei TPE", to: isChineseMode ? "洛杉磯 LAX" : "Los Angeles LAX", fromCode: "TPE", toCode: "LAX", duration: isChineseMode ? "約 12 小時" : "~12 hours", tagKey: "longhaul" as const },
  ];

  const routeTagLabels = {
    popular: isChineseMode ? "熱門" : "Popular",
    recommended: isChineseMode ? "推薦" : "Recommended",
    longhaul: isChineseMode ? "長途" : "Long-haul",
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />

      {/* ─── Full-width Trip.com-style Search Card ─── */}
      <section className="py-10 bg-gray-50 border-b border-gray-200">
        <div className="container">
          <div className="max-w-5xl mx-auto bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden">
            {/* Card Header */}
            <div className="flex items-center gap-3 px-8 pt-7 pb-4 border-b border-gray-100">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
                <Plane className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-black">{t('flightBooking.page.searchTitle')}</h2>
                <p className="text-sm text-gray-500">{t('flightBooking.page.searchSubtitle')}</p>
              </div>
            </div>

            <div className="px-8 py-6 space-y-5">
              {/* Row 1: Trip type + Cabin + Passengers */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Trip type toggle */}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setTripType('roundtrip')}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                      tripType === 'roundtrip' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t('hero.search.flight.roundtrip')}
                  </button>
                  <button
                    onClick={() => setTripType('oneway')}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                      tripType === 'oneway' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t('hero.search.flight.oneway')}
                  </button>
                </div>

                {/* Cabin class */}
                <select
                  value={cabinClass}
                  onChange={(e) => setCabinClass(e.target.value as typeof cabinClass)}
                  className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700 focus:ring-black focus:border-black"
                >
                  <option value="economy">{t('hero.search.flight.cabinEconomy')}</option>
                  <option value="premiumEconomy">{t('hero.search.flight.cabinPremiumEconomy')}</option>
                  <option value="business">{t('hero.search.flight.cabinBusiness')}</option>
                  <option value="first">{t('hero.search.flight.cabinFirst')}</option>
                </select>

                {/* Passenger picker */}
                <div className="relative" ref={passengerPickerRef}>
                  <button
                    onClick={() => setShowPassengerPicker(!showPassengerPicker)}
                    className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700 hover:border-gray-300 flex items-center gap-2"
                  >
                    <Users className="h-3.5 w-3.5" />
                    {passengerSummary}
                  </button>
                  {showPassengerPicker && (
                    <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-50">
                      {/* Adults */}
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.adults')}</div>
                          <div className="text-xs text-gray-500">{t('hero.search.flight.adultsAge')}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setAdults(Math.max(1, adults - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={adults <= 1}>−</button>
                          <span className="w-6 text-center font-medium">{adults}</span>
                          <button onClick={() => setAdults(Math.min(9, adults + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={adults >= 9}>+</button>
                        </div>
                      </div>
                      {/* Children */}
                      <div className="flex items-center justify-between py-2 border-t border-gray-100">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.children')}</div>
                          <div className="text-xs text-gray-500">{t('hero.search.flight.childrenAge')}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setChildren(Math.max(0, children - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={children <= 0}>−</button>
                          <span className="w-6 text-center font-medium">{children}</span>
                          <button onClick={() => setChildren(Math.min(9, children + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={children >= 9}>+</button>
                        </div>
                      </div>
                      {/* Infants */}
                      <div className="flex items-center justify-between py-2 border-t border-gray-100">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.infants')}</div>
                          <div className="text-xs text-gray-500">{t('hero.search.flight.infantsAge')}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setInfants(Math.max(0, infants - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={infants <= 0}>−</button>
                          <span className="w-6 text-center font-medium">{infants}</span>
                          <button onClick={() => setInfants(Math.min(adults, infants + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={infants >= adults}>+</button>
                        </div>
                      </div>
                      <button onClick={() => setShowPassengerPicker(false)} className="mt-3 w-full py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                        {t('common.confirm')}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: Origin ⇄ Destination + Dates + Search */}
              <div className="flex flex-col md:flex-row gap-4 items-end">
                {/* Origin */}
                <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.flight.origin')}</label>
                  <Input
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    placeholder={t('hero.search.flight.originPlaceholder')}
                    className="h-12 rounded-lg bg-gray-50 border-gray-200 focus:ring-black focus:border-black"
                  />
                </div>

                {/* Swap button */}
                <button
                  onClick={handleSwapCities}
                  className="hidden md:flex w-10 h-10 flex-shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white hover:bg-gray-50 text-gray-500 hover:text-black transition-colors mb-1"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </button>

                {/* Destination */}
                <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.flight.destination')}</label>
                  <Input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={t('hero.search.flight.destinationPlaceholder')}
                    className="h-12 rounded-lg bg-gray-50 border-gray-200 focus:ring-black focus:border-black"
                  />
                </div>

                {/* Depart date */}
                <div className="w-full" style={{ flex: '0.8 1 0', minWidth: 0 }}>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.flight.departDate')}</label>
                  <Input type="date" value={departDate} onChange={(e) => setDepartDate(e.target.value)} className="h-12 rounded-lg bg-gray-50 border-gray-200" />
                </div>

                {/* Return date */}
                {tripType === 'roundtrip' && (
                  <div className="w-full" style={{ flex: '0.8 1 0', minWidth: 0 }}>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.flight.returnDate')}</label>
                    <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="h-12 rounded-lg bg-gray-50 border-gray-200" />
                  </div>
                )}

                {/* Search button */}
                <div className="w-full md:w-40 flex-shrink-0">
                  <Button
                    onClick={handleSearchFlights}
                    disabled={isSearching}
                    className="w-full h-12 bg-black hover:bg-gray-900 text-white rounded-lg font-bold shadow-md transition-all hover:shadow-lg flex items-center justify-center gap-2"
                  >
                    <Search className="h-4 w-4" />
                    {isSearching ? t('flightBooking.page.searching') : t('flightBooking.page.searchBtn')}
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                  </Button>
                </div>
              </div>

              <p className="text-center text-xs text-gray-400">{t('flightBooking.page.redirectNote')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Hero */}
      <section className="relative bg-black text-white overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2074&auto=format&fit=crop"
            alt="Flight booking"
            className="w-full h-full object-cover opacity-40"
          />
        </div>
        <div className="relative container py-24 md:py-32">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
              <Plane className="h-4 w-4" />
              <span>{t('flightBooking.page.heroBadge')}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              {t('flightBooking.page.heroTitle')}<br />
              <span className="text-gray-300">{t('flightBooking.page.heroTitleHighlight')}</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              {t('flightBooking.page.heroDesc')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  {t('flightBooking.page.heroCtaInquiry')} <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contact-us">
                <Button variant="outline" className="border-white/50 text-white hover:bg-white/10 font-bold px-8 py-3 h-auto rounded-lg text-base bg-transparent">
                  {t('flightBooking.page.heroCtaContact')}
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
              { num: "500+", label: t('flightBooking.page.statAirlines') },
              { num: "150+", label: t('flightBooking.page.statCountries') },
              { num: "10,000+", label: t('flightBooking.page.statPassengers') },
              { num: "98%", label: t('flightBooking.page.statSatisfaction') },
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
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('flightBooking.page.featuresTitle')}</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">{t('flightBooking.page.featuresSubtitle')}</p>
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

      {/* Cabin Classes */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('flightBooking.page.cabinTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('flightBooking.page.cabinSubtitle')}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {cabinClasses.map((cabin, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 border border-gray-200 hover:border-black hover:shadow-md transition-all cursor-pointer group">
                <div className="w-12 h-12 bg-gray-100 group-hover:bg-black rounded-xl flex items-center justify-center mb-4 transition-colors">
                  <cabin.Icon className="h-6 w-6 text-gray-700 group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-lg font-bold text-black mb-1">{cabin.name}</h3>
                <p className="text-xs text-gray-400 mb-3">{cabin.nameEn}</p>
                <p className="text-gray-600 text-sm leading-relaxed">{cabin.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Routes */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('flightBooking.page.routesTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('flightBooking.page.routesSubtitle')}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {popularRoutes.map((route, i) => (
              <button
                key={i}
                onClick={() => handleRouteClick(route)}
                className="group bg-white border border-gray-200 rounded-2xl p-6 hover:border-black hover:shadow-md transition-all text-left"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                    route.tagKey === 'popular' ? 'bg-red-100 text-red-700' :
                    route.tagKey === 'recommended' ? 'bg-blue-100 text-blue-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {routeTagLabels[route.tagKey]}
                  </span>
                  <Clock className="h-4 w-4 text-gray-400" />
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-bold text-black text-sm">{route.from}</span>
                  <Plane className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <span className="font-bold text-black text-sm">{route.to}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{route.duration}</span>
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
          <h2 className="text-3xl md:text-4xl font-bold mb-6">{t('flightBooking.page.ctaTitle')}</h2>
          <p className="text-gray-300 text-lg mb-10 max-w-2xl mx-auto">{t('flightBooking.page.ctaDesc')}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-4 h-auto rounded-xl text-base">
                {t('flightBooking.page.ctaInquiry')} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white/50 text-white hover:bg-white/10 font-bold px-10 py-4 h-auto rounded-xl text-base bg-transparent">
                {t('flightBooking.page.ctaContact')}
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
