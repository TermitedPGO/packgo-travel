import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Users, Star, Shield, Clock, ArrowRight, Phone,
  MapPin, CheckCircle, Headphones, Gift
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

export default function GroupPackages() {
  const { t } = useLocale();

  const processSteps = [
    { step: "01", title: t("groupPackages.page.step1Title"), desc: t("groupPackages.page.step1Desc") },
    { step: "02", title: t("groupPackages.page.step2Title"), desc: t("groupPackages.page.step2Desc") },
    { step: "03", title: t("groupPackages.page.step3Title"), desc: t("groupPackages.page.step3Desc") },
    { step: "04", title: t("groupPackages.page.step4Title"), desc: t("groupPackages.page.step4Desc") },
  ];

  const faqs = [
    { q: t("groupPackages.page.faq1Q"), a: t("groupPackages.page.faq1A") },
    { q: t("groupPackages.page.faq2Q"), a: t("groupPackages.page.faq2A") },
    { q: t("groupPackages.page.faq3Q"), a: t("groupPackages.page.faq3A") },
    { q: t("groupPackages.page.faq4Q"), a: t("groupPackages.page.faq4A") },
  ];

  const advantages = [
    { icon: Star, title: t("groupPackages.page.advantage1Title"), desc: t("groupPackages.page.advantage1Desc") },
    { icon: MapPin, title: t("groupPackages.page.advantage2Title"), desc: t("groupPackages.page.advantage2Desc") },
    { icon: Gift, title: t("groupPackages.page.advantage3Title"), desc: t("groupPackages.page.advantage3Desc") },
    { icon: Shield, title: t("groupPackages.page.advantage4Title"), desc: t("groupPackages.page.advantage4Desc") },
  ];

  const whyUs = [
    { icon: Users, title: t("groupPackages.page.whyUs1Title"), desc: t("groupPackages.page.whyUs1Desc") },
    { icon: Clock, title: t("groupPackages.page.whyUs2Title"), desc: t("groupPackages.page.whyUs2Desc") },
    { icon: CheckCircle, title: t("groupPackages.page.whyUs3Title"), desc: t("groupPackages.page.whyUs3Desc") },
    { icon: Headphones, title: t("groupPackages.page.whyUs4Title"), desc: t("groupPackages.page.whyUs4Desc") },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title={{
          zh: "團體包團｜公司獎勵旅遊、家族出遊、社團包車｜PACK&GO",
          en: "Group Packages | Corporate, Family Reunion, Club Tours | PACK&GO",
        }}
        description={{
          zh: "10 人以上包團專案：公司獎勵、家族團聚、教會社團。獨家行程、專車專導、彈性付款，CST #2166984 合法承辦。",
          en: "Groups of 10+: corporate incentives, family reunions, church or club trips. Private itineraries, dedicated guides, flexible billing. CST #2166984.",
        }}
        image="/images/dest-asia.webp"
        url="/group-packages"
      />
      <Header />

      {/* Hero */}
      <section className="relative bg-black text-white overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1527631746610-bca00a040d60?q=80&w=2070&auto=format&fit=crop"
            alt="Group travel"
            className="w-full h-full object-cover opacity-35"
          />
        </div>
        <div className="relative container py-24 md:py-32">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg px-4 py-1.5 text-sm mb-6">
              <Users className="h-4 w-4" />
              <span>{t("groupPackages.page.heroTag")}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              {t("groupPackages.page.heroTitleLine1")}<br />
              <span className="text-gray-300">
                {t("groupPackages.page.heroTitleLine2")}
              </span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              {t("groupPackages.page.heroSubtitle")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  {t("groupPackages.page.ctaPrimary")} <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contact-us">
                <Button variant="outline" className="border-white text-white hover:bg-white/10 font-bold px-8 py-3 h-auto rounded-lg text-base bg-transparent">
                  {t("groupPackages.page.ctaSecondary")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/*
        Stats Row removed per FTC Act §5 / 16 CFR Part 260. Prior numbers
        ("200+ successful group tours", "98% customer satisfaction") had
        no reasonable basis documented. The "10–50 pax" range and "24/7
        support" labels are factual policy statements and could be
        re-introduced separately as non-numeric service descriptors.
      */}

      {/* Features Grid */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {t("groupPackages.page.advantagesTitle")}
            </h2>
            <p className="text-gray-500 text-lg">
              {t("groupPackages.page.advantagesSubtitle")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {advantages.map((feature, i) => (
              <div key={i} className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-all">
                <div className="w-12 h-12 rounded-lg bg-black text-white flex items-center justify-center mb-5">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">{feature.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Process Steps */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {t("groupPackages.page.processTitle")}
            </h2>
            <p className="text-gray-500 text-lg">
              {t("groupPackages.page.processSubtitle")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {processSteps.map((step, i) => (
              <div key={i} className="text-center relative">
                {i < processSteps.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-0.5 bg-gray-200 z-0" />
                )}
                <div className="relative z-10 inline-flex items-center justify-center w-16 h-16 rounded-lg bg-black text-white text-xl font-bold mb-4">
                  {step.step}
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Us */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                {t("groupPackages.page.whyUsTitle")}
              </h2>
              <div className="space-y-5">
                {whyUs.map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-lg bg-black text-white flex items-center justify-center">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 mb-1">{item.title}</h3>
                      <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative rounded-2xl overflow-hidden h-[400px]">
              <img
                src="https://images.unsplash.com/photo-1539635278303-d4002c07eae3?q=80&w=2070&auto=format&fit=crop"
                alt="Happy group travelers"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              {/* FTC 16 CFR §260.5: unsubstantiated numeric claim removed (no verified tour count) */}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-gray-50">
        <div className="container max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {t("groupPackages.page.faqTitle")}
            </h2>
          </div>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-6">
                <h3 className="font-bold text-gray-900 mb-2 flex items-start gap-2">
                  <span className="shrink-0 w-6 h-6 rounded-lg bg-black text-white text-xs flex items-center justify-center mt-0.5">Q</span>
                  {faq.q}
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed pl-8">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-black text-white">
        <div className="container text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {t("groupPackages.page.finalCtaTitle")}
          </h2>
          <p className="text-gray-300 text-lg mb-8 max-w-xl mx-auto">
            {t("groupPackages.page.finalCtaSubtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                {t("groupPackages.page.finalCtaInquire")} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base bg-transparent">
                <Phone className="mr-2 h-4 w-4" />
                {t("groupPackages.page.finalCtaContact")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
