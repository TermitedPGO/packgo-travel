import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trackAffiliateClick } from "@/lib/analytics";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Plane, Clock, Shield, Globe, CreditCard, Headphones, ArrowRight, Briefcase, Crown, Star, ExternalLink, Search } from "lucide-react";
import AITravelAdvisorDialog from "@/components/AITravelAdvisorDialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function FlightBooking() {
  const { t, language } = useLocale();
  const isChineseMode = language === 'zh-TW';
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorInitialMsg, setAdvisorInitialMsg] = useState("");

  // Search form state
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departDate, setDepartDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const utils = trpc.useUtils();
  const trackClickMutation = trpc.affiliate.trackClick.useMutation();

  const openAdvisor = (msg: string) => {
    setAdvisorInitialMsg(msg);
    setAdvisorOpen(true);
  };

  const handleSearchFlights = async () => {
    setIsSearching(true);
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: "flights",
        origin: origin || undefined,
        destination: destination || undefined,
        departDate: departDate || undefined,
        returnDate: returnDate || undefined,
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

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />

      {/* Search Card — placed before hero for immediate visibility */}
      <section className="py-10 bg-gray-50 border-b border-gray-200">
        <div className="container">
          <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
                <Search className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-black">{t('flightBooking.page.searchTitle')}</h2>
                <p className="text-sm text-gray-500">{t('flightBooking.page.searchSubtitle')}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">{t('flightBooking.page.originLabel')}</Label>
                <Input placeholder={t('flightBooking.page.originPlaceholder')} value={origin} onChange={e => setOrigin(e.target.value)} className="h-11" />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">{t('flightBooking.page.destLabel')}</Label>
                <Input placeholder={t('flightBooking.page.destPlaceholder')} value={destination} onChange={e => setDestination(e.target.value)} className="h-11" />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">{t('flightBooking.page.departDateLabel')}</Label>
                <Input type="date" value={departDate} onChange={e => setDepartDate(e.target.value)} className="h-11" />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">{t('flightBooking.page.returnDateLabel')}</Label>
                <Input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} className="h-11" />
              </div>
            </div>
            <Button onClick={handleSearchFlights} disabled={isSearching} className="w-full h-12 bg-black hover:bg-gray-800 text-white font-bold text-base rounded-xl flex items-center justify-center gap-2">
              <Search className="h-5 w-5" />
              {isSearching ? t('flightBooking.page.searching') : t('flightBooking.page.searchBtn')}
              <ExternalLink className="h-4 w-4 opacity-70" />
            </Button>
            <p className="text-center text-xs text-gray-400 mt-3">{t('flightBooking.page.redirectNote')}</p>
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

      {/* Cabin Classes — clickable to open AI advisor */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('flightBooking.page.cabinTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('flightBooking.page.cabinSubtitle')}</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {cabinClasses.map((cabin, i) => (
              <div key={i} className="bg-white rounded-xl p-6 border border-gray-100 hover:border-black hover:shadow-md transition-all flex flex-col">
                <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-lg flex items-center justify-center">
                  <cabin.Icon className="h-6 w-6 text-black" />
                </div>
                <h3 className="text-lg font-bold text-black mb-1">{cabin.name}</h3>
                <p className="text-gray-500 text-xs mb-3">{cabin.nameEn}</p>
                <p className="text-gray-600 text-sm leading-relaxed mb-4">{cabin.desc}</p>
                <button
                  type="button"
                  onClick={() => openAdvisor(`${cabin.name} (${cabin.nameEn})`)}
                  className="mt-auto w-full py-2 rounded-lg border border-black text-black text-sm font-medium hover:bg-black hover:text-white transition-all"
                >
                  {t('flightBooking.page.cabinConsultBtn')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Routes — clickable to open AI advisor */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('flightBooking.page.routesTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('flightBooking.page.routesSubtitle')}</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {popularRoutes.map((route, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleRouteClick(route)}
                className="flex items-center justify-between p-5 border border-gray-200 rounded-xl hover:border-black hover:shadow-sm transition-all group text-left w-full"
              >
                <div className="flex items-center gap-4">
                  <Plane className="h-5 w-5 text-gray-400 group-hover:text-black transition-colors" />
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-black text-sm">
                      <span>{route.from}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                      <span>{route.to}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {route.duration}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    route.tagKey === "popular" ? "bg-black text-white" :
                    route.tagKey === "recommended" ? "bg-gray-100 text-gray-700" :
                    "bg-gray-50 text-gray-500"
                  }`}>
                    {route.tagKey === "popular" ? t('flightBooking.page.routeTagHot') : route.tagKey === "recommended" ? t('flightBooking.page.routeTagRecommended') : t('flightBooking.page.routeTagLongHaul')}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-gray-400 group-hover:text-black transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">{t('flightBooking.page.processTitle')}</h2>
            <p className="text-gray-600 text-lg">{t('flightBooking.page.processSubtitle')}</p>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: "01", title: t('flightBooking.page.step1Title'), desc: t('flightBooking.page.step1Desc') },
              { step: "02", title: t('flightBooking.page.step2Title'), desc: t('flightBooking.page.step2Desc') },
              { step: "03", title: t('flightBooking.page.step3Title'), desc: t('flightBooking.page.step3Desc') },
              { step: "04", title: t('flightBooking.page.step4Title'), desc: t('flightBooking.page.step4Desc') },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <div className="w-14 h-14 bg-black text-white rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="text-lg font-bold text-black mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-black text-white">
        <div className="container text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('flightBooking.page.ctaTitle')}</h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            {t('flightBooking.page.ctaDesc')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                {t('flightBooking.page.ctaInquiry')} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base bg-transparent">
                {t('flightBooking.page.ctaContact')}
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
