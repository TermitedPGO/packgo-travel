import { lazy, Suspense, useState, useRef, useEffect } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { openTripClickout } from "@/lib/tripClickout";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  Plane, Clock, Shield, Globe, CreditCard, Headphones, ArrowRight,
  Briefcase, Crown, Star, ExternalLink, Search, Users, ArrowLeftRight, MessageCircle
} from "lucide-react";
// Lazy: AITravelAdvisorDialog pulls in streamdown + Shiki (~600KB+).
const AITravelAdvisorDialog = lazy(() => import("@/components/AITravelAdvisorDialog"));

export default function FlightBooking() {
  const { t } = useLocale();
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

  // Phase 1 is homepage-only clickout: open the first-party redirect endpoint, which
  // 302s to the approved Trip.com entry. Search-box fields are NOT sent (the persistent
  // notice next to the button tells the customer to re-enter them on Trip.com).
  const handleSearchFlights = () => openTripClickout('flight_search');

  // Popular routes can't be carried to a homepage-only clickout, so they open the
  // PACK&GO advisor (which can actually help with that route) instead of pretending
  // Trip.com will pre-fill it.
  const handleRouteClick = (route: { from: string; to: string; duration: string }) => {
    openAdvisor(`${route.from} → ${route.to} (${route.duration})`);
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

  const cityTpe = t('flightBooking.page.cityTpe');
  const popularRoutes = [
    { from: cityTpe, to: t('flightBooking.page.cityTyo'), fromCode: "TPE", toCode: "TYO", duration: t('flightBooking.page.duration3h5'), tagKey: "popular" as const },
    { from: cityTpe, to: t('flightBooking.page.cityOsa'), fromCode: "TPE", toCode: "OSA", duration: t('flightBooking.page.duration3h'), tagKey: "popular" as const },
    { from: cityTpe, to: t('flightBooking.page.citySel'), fromCode: "TPE", toCode: "SEL", duration: t('flightBooking.page.duration2h5'), tagKey: "popular" as const },
    { from: cityTpe, to: t('flightBooking.page.cityBkk'), fromCode: "TPE", toCode: "BKK", duration: t('flightBooking.page.duration4h'), tagKey: "recommended" as const },
    { from: cityTpe, to: t('flightBooking.page.citySin'), fromCode: "TPE", toCode: "SIN", duration: t('flightBooking.page.duration4h5'), tagKey: "recommended" as const },
    { from: cityTpe, to: t('flightBooking.page.cityLax'), fromCode: "TPE", toCode: "LAX", duration: t('flightBooking.page.duration12h'), tagKey: "longhaul" as const },
  ];

  const routeTagLabels = {
    popular: t('flightBooking.page.routeTagHot'),
    recommended: t('flightBooking.page.routeTagRecommended'),
    longhaul: t('flightBooking.page.routeTagLongHaul'),
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title={{
          zh: "機票代訂｜中文客服、改票協助｜PACK&GO 旅行社",
          en: "Flight Booking | Mandarin Support & Rebooking Help | PACK&GO",
        }}
        description={{
          zh: "跨太平洋航線、商務艙、家庭機位專人代訂。改票、退票、行李問題全程中文協助,免你和航空公司客服周旋。",
          en: "Trans-Pacific routes, business class, family seating handled by Mandarin agents. We deal with rebooking, refunds, baggage issues so you don't.",
        }}
        image="/images/dest-asia.webp"
        url="/flight-booking"
      />
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
                    <div className="absolute top-full mt-2 bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-50 w-full md:w-72 left-0">
                      {/* Adults */}
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.adults')}</div>
                          <div className="text-xs text-gray-500">{t('hero.search.flight.adultsAge')}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button aria-label={t('common.decrease')} onClick={() => setAdults(Math.max(1, adults - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={adults <= 1}>−</button>
                          <span className="w-6 text-center font-medium">{adults}</span>
                          <button aria-label={t('common.increase')} onClick={() => setAdults(Math.min(9, adults + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={adults >= 9}>+</button>
                        </div>
                      </div>
                      {/* Children */}
                      <div className="flex items-center justify-between py-2 border-t border-gray-100">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.children')}</div>
                          <div className="text-xs text-gray-500">{t('hero.search.flight.childrenAge')}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button aria-label={t('common.decrease')} onClick={() => setChildren(Math.max(0, children - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={children <= 0}>−</button>
                          <span className="w-6 text-center font-medium">{children}</span>
                          <button aria-label={t('common.increase')} onClick={() => setChildren(Math.min(9, children + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={children >= 9}>+</button>
                        </div>
                      </div>
                      {/* Infants */}
                      <div className="flex items-center justify-between py-2 border-t border-gray-100">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.infants')}</div>
                          <div className="text-xs text-gray-500">{t('hero.search.flight.infantsAge')}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button aria-label={t('common.decrease')} onClick={() => setInfants(Math.max(0, infants - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={infants <= 0}>−</button>
                          <span className="w-6 text-center font-medium">{infants}</span>
                          <button aria-label={t('common.increase')} onClick={() => setInfants(Math.min(adults, infants + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={infants >= adults}>+</button>
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
                    className="w-full h-12 bg-black hover:bg-gray-900 text-white rounded-lg font-bold shadow-md transition-all hover:shadow-lg flex items-center justify-center gap-2"
                  >
                    <Search className="h-4 w-4" />
                    {t('flightBooking.page.searchBtn')}
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                  </Button>
                </div>
              </div>

              {/* Persistent clickout notice (§ homepage-only): the button leaves to
                  Trip.com and does NOT carry the fields above. Always visible next to
                  the button — not a toast the customer can miss after redirecting. */}
              <p className="text-center text-xs text-gray-500">{t('flightBooking.page.redirectNotice')}</p>
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

      {/*
        Stats Row removed per FTC Act §5 (deceptive acts/practices) and
        16 CFR Part 260 (advertising substantiation). Prior hardcoded
        numbers ("500+ airlines", "150+ countries", "10,000+ passengers",
        "98% satisfaction") had no reasonable basis documented. Re-introduce
        only when backed by auditable data (e.g., live Trip.com API metrics
        or tRPC query over bookings with tourist-facing caveats).
      */}

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
                  {/* Advisor dialog, not an external site — icon must not imply leaving. */}
                  <MessageCircle className="h-4 w-4 text-gray-400 group-hover:text-black transition-colors" />
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
      {advisorOpen && (
        <Suspense fallback={null}>
          <AITravelAdvisorDialog open={advisorOpen} onOpenChange={setAdvisorOpen} initialMessage={advisorInitialMsg} />
        </Suspense>
      )}
    </div>
  );
}

