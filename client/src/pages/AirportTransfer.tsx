import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Car, Clock, Shield, Star, ArrowRight, Phone, Truck, Bus, Plane } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

export default function AirportTransfer() {
  const { t } = useLocale();

  const features = [
    { icon: Clock, title: t("airportTransfer.page.feature1Title"), desc: t("airportTransfer.page.feature1Desc") },
    { icon: Shield, title: t("airportTransfer.page.feature2Title"), desc: t("airportTransfer.page.feature2Desc") },
    { icon: Star, title: t("airportTransfer.page.feature3Title"), desc: t("airportTransfer.page.feature3Desc") },
    { icon: Phone, title: t("airportTransfer.page.feature4Title"), desc: t("airportTransfer.page.feature4Desc") },
  ];

  const vehicleTypes = [
    {
      name: t("airportTransfer.page.vehicle1Name"),
      capacity: t("airportTransfer.page.vehicle1Capacity"),
      desc: t("airportTransfer.page.vehicle1Desc"),
      Icon: Car,
      examples: "Toyota Camry / Honda Accord",
    },
    {
      name: t("airportTransfer.page.vehicle2Name"),
      capacity: t("airportTransfer.page.vehicle2Capacity"),
      desc: t("airportTransfer.page.vehicle2Desc"),
      Icon: Truck,
      examples: "Toyota Land Cruiser / BMW X5",
    },
    {
      name: t("airportTransfer.page.vehicle3Name"),
      capacity: t("airportTransfer.page.vehicle3Capacity"),
      desc: t("airportTransfer.page.vehicle3Desc"),
      Icon: Bus,
      examples: "Toyota Alphard / Vellfire",
    },
    {
      name: t("airportTransfer.page.vehicle4Name"),
      capacity: t("airportTransfer.page.vehicle4Capacity"),
      desc: t("airportTransfer.page.vehicle4Desc"),
      Icon: Star,
      examples: "Mercedes-Benz S-Class / BMW 7",
    },
  ];

  const airports = [
    { name: t("airportTransfer.page.airport1Name"), code: "TPE", country: t("airportTransfer.page.airport1Country") },
    { name: t("airportTransfer.page.airport2Name"), code: "NRT", country: t("airportTransfer.page.airport2Country") },
    { name: t("airportTransfer.page.airport3Name"), code: "KIX", country: t("airportTransfer.page.airport3Country") },
    { name: t("airportTransfer.page.airport4Name"), code: "ICN", country: t("airportTransfer.page.airport4Country") },
    { name: t("airportTransfer.page.airport5Name"), code: "BKK", country: t("airportTransfer.page.airport5Country") },
    { name: t("airportTransfer.page.airport6Name"), code: "SIN", country: t("airportTransfer.page.airport6Country") },
  ];

  const processSteps = [
    { step: "01", title: t("airportTransfer.page.step1Title"), desc: t("airportTransfer.page.step1Desc") },
    { step: "02", title: t("airportTransfer.page.step2Title"), desc: t("airportTransfer.page.step2Desc") },
    { step: "03", title: t("airportTransfer.page.step3Title"), desc: t("airportTransfer.page.step3Desc") },
    { step: "04", title: t("airportTransfer.page.step4Title"), desc: t("airportTransfer.page.step4Desc") },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />

      {/* Advisory banner */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="container py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-800">
            <span className="text-lg">🚗</span>
            <span className="text-sm font-medium">
              {t("airportTransfer.page.advisoryMessage")}
            </span>
          </div>
          <Link href="/inquiry">
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0">
              {t("airportTransfer.page.advisoryCta")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Hero */}
      <section className="relative bg-black text-white overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?q=80&w=2069&auto=format&fit=crop"
            alt="Airport transfer"
            className="w-full h-full object-cover opacity-40"
          />
        </div>
        <div className="relative container py-24 md:py-32">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
              <Car className="h-4 w-4" />
              <span>{t("airportTransfer.page.heroTag")}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              {t("airportTransfer.page.heroTitleLine1")}<br />
              <span className="text-gray-300">
                {t("airportTransfer.page.heroTitleLine2")}
              </span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              {t("airportTransfer.page.heroSubtitle")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  {t("airportTransfer.page.ctaBook")} <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contact-us">
                <Button variant="outline" className="border-white/50 text-white hover:bg-white/10 font-bold px-8 py-3 h-auto rounded-lg text-base bg-transparent">
                  {t("airportTransfer.page.ctaContact")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/*
        Stats Row removed per FTC Act §5 / 16 CFR Part 260. Prior hardcoded
        numbers ("50+ airports", "30+ cities", "5,000+ transfers", "100%
        on-time") had no reasonable basis documented. Re-introduce only
        when backed by auditable data from partner API or booking records.
      */}

      {/* Features */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
              {t("airportTransfer.page.featuresTitle")}
            </h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              {t("airportTransfer.page.featuresSubtitle")}
            </p>
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

      {/* Vehicle Types */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
              {t("airportTransfer.page.vehiclesTitle")}
            </h2>
            <p className="text-gray-600 text-lg">
              {t("airportTransfer.page.vehiclesSubtitle")}
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {vehicleTypes.map((vehicle, i) => (
              <div key={i} className="bg-white rounded-xl p-6 border border-gray-100 hover:border-black hover:shadow-md transition-all">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                    <vehicle.Icon className="h-6 w-6 text-black" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-bold text-black">{vehicle.name}</h3>
                      <span className="text-sm text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">{vehicle.capacity}</span>
                    </div>
                    <p className="text-gray-600 text-sm mb-2">{vehicle.desc}</p>
                    <p className="text-xs text-gray-400">{vehicle.examples}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Airports */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
              {t("airportTransfer.page.airportsTitle")}
            </h2>
            <p className="text-gray-600 text-lg">
              {t("airportTransfer.page.airportsSubtitle")}
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {airports.map((airport, i) => (
              <div key={i} className="flex items-center gap-4 p-5 border border-gray-200 rounded-xl hover:border-black hover:shadow-sm transition-all">
                <div className="w-10 h-10 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Plane className="h-5 w-5 text-black" />
                </div>
                <div>
                  <div className="font-bold text-black text-sm">{airport.name}</div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{airport.code}</span>
                    <span>{airport.country}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-gray-500 text-sm mt-6">
            {t("airportTransfer.page.airportsFootnote")}
          </p>
        </div>
      </section>

      {/* Process */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
              {t("airportTransfer.page.processTitle")}
            </h2>
            <p className="text-gray-600 text-lg">
              {t("airportTransfer.page.processSubtitle")}
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {processSteps.map((item, i) => (
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
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {t("airportTransfer.page.finalCtaTitle")}
          </h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            {t("airportTransfer.page.finalCtaSubtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                {t("airportTransfer.page.finalCtaBook")} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base bg-transparent">
                {t("airportTransfer.page.finalCtaContact")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
