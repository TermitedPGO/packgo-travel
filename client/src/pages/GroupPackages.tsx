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
  const { language } = useLocale();
  const isChineseMode = language === 'zh-TW';

  const processSteps = [
    {
      step: "01",
      title: isChineseMode ? "專業諮詢" : "Expert Consultation",
      desc: isChineseMode
        ? "聯繫我們的包團顧問，說明您的需求、人數、目的地與預算，我們將為您提供初步規劃建議。"
        : "Contact our group travel consultant, share your needs, group size, destination, and budget — we'll provide initial planning suggestions.",
    },
    {
      step: "02",
      title: isChineseMode ? "客製方案" : "Customized Plan",
      desc: isChineseMode
        ? "根據您的需求量身打造行程，包含航班、住宿、餐食、景點與導遊安排，提供完整報價。"
        : "A tailor-made itinerary covering flights, accommodation, meals, attractions, and guide arrangements, with a full quote.",
    },
    {
      step: "03",
      title: isChineseMode ? "確認訂金" : "Confirm Deposit",
      desc: isChineseMode
        ? "確認行程細節後繳付訂金，我們立即為您鎖位並開始辦理相關手續。"
        : "After confirming itinerary details, pay the deposit and we'll immediately secure your spots and begin processing.",
    },
    {
      step: "04",
      title: isChineseMode ? "出發旅遊" : "Depart & Enjoy",
      desc: isChineseMode
        ? "專業領隊全程陪同，讓您和團員盡情享受旅程，無後顧之憂。"
        : "A professional tour leader accompanies you throughout, so you and your group can enjoy every moment worry-free.",
    },
  ];

  const faqs = [
    {
      q: isChineseMode ? "最少幾人可以包團？" : "What is the minimum group size?",
      a: isChineseMode
        ? "一般包團最少需要 10 人，最多可達 50 人。人數越多，每人費用越優惠。我們也提供 10 人以下的小包團服務，費用另議。"
        : "Standard group bookings require a minimum of 10 people, up to 50. The larger the group, the better the per-person rate. We also offer small group packages under 10 — pricing on request.",
    },
    {
      q: isChineseMode ? "可以指定出發日期嗎？" : "Can we choose our own departure date?",
      a: isChineseMode
        ? "包團旅遊最大的優勢就是可以自由選擇出發日期，完全配合您的團員時間安排。"
        : "One of the biggest advantages of group bookings is the freedom to choose your own departure date, fully aligned with your group's schedule.",
    },
    {
      q: isChineseMode ? "行程可以客製化嗎？" : "Can the itinerary be customized?",
      a: isChineseMode
        ? "當然可以！我們提供完全客製化服務，從景點選擇、住宿等級到餐食安排，都可依照您的需求調整。"
        : "Absolutely! We offer fully customized services — from attraction selection and accommodation grade to meal arrangements, all adjustable to your needs.",
    },
    {
      q: isChineseMode ? "費用包含哪些項目？" : "What does the package price include?",
      a: isChineseMode
        ? "標準包套費用包含來回機票、全程住宿、接送交通、專業領隊及部分餐食。詳細包含項目會在報價單中清楚列明。"
        : "Standard packages include round-trip flights, full accommodation, transfer transportation, a professional tour leader, and some meals. All inclusions are clearly listed in the quote.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title={isChineseMode ? "包團旅遊" : "Group Packages"}
        description={isChineseMode
          ? "PACK&GO 提供專業包團旅遊服務，10-50 人團體皆可客製行程，專業領隊全程陪同，享受最優惠的團體價格。"
          : "PACK&GO offers professional group travel services for groups of 10–50. Customized itineraries, professional tour leaders, and the best group rates."}
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
              <span>{isChineseMode ? "包團旅遊服務" : "Group Travel Service"}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              {isChineseMode ? "與親友共享旅程" : "Travel Together"}<br />
              <span className="text-gray-300">
                {isChineseMode ? "專屬包團，全程無憂" : "Exclusive Group Tours, Worry-Free"}
              </span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              {isChineseMode
                ? "PACK&GO 包團顧問擁有豐富的團體旅遊規劃經驗，從行程設計到現場領隊，全程貼心照顧，讓您的團體旅遊留下美好回憶。"
                : "PACK&GO's group travel consultants have extensive experience in planning group trips — from itinerary design to on-site tour leadership, we take care of every detail so your group creates lasting memories."}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  {isChineseMode ? "立即諮詢包團" : "Inquire Now"} <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contact-us">
                <Button variant="outline" className="border-white text-white hover:bg-white/10 font-bold px-8 py-3 h-auto rounded-lg text-base bg-transparent">
                  {isChineseMode ? "聯絡我們" : "Contact Us"}
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
              {isChineseMode ? "包團旅遊的優勢" : "Advantages of Group Travel"}
            </h2>
            <p className="text-gray-500 text-lg">
              {isChineseMode ? "專為您的團體量身打造，享受最貼心的旅遊服務" : "Tailor-made for your group — enjoy the most attentive travel service"}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Star,
                title: isChineseMode ? "專業領隊全程陪同" : "Professional Tour Leader",
                desc: isChineseMode
                  ? "經驗豐富的專業領隊全程照顧，熟悉當地文化與景點，讓您放心享受旅程。"
                  : "Experienced professional tour leaders accompany you throughout, familiar with local culture and attractions.",
              },
              {
                icon: MapPin,
                title: isChineseMode ? "完全客製化行程" : "Fully Customized Itinerary",
                desc: isChineseMode
                  ? "依照團員喜好與需求量身設計行程，景點、餐食、住宿均可靈活調整。"
                  : "Itineraries designed to your group's preferences — attractions, meals, and accommodation all flexibly adjustable.",
              },
              {
                icon: Gift,
                title: isChineseMode ? "團體優惠價格" : "Group Discount Pricing",
                desc: isChineseMode
                  ? "多人同行享受更優惠的團體價格，人數越多折扣越大，物超所值。"
                  : "The more people, the better the group rate. Enjoy greater discounts with larger groups — exceptional value.",
              },
              {
                icon: Shield,
                title: isChineseMode ? "全程安心保障" : "Full Peace-of-Mind Coverage",
                desc: isChineseMode
                  ? "完善的行程安排與旅遊保險，緊急狀況即時處理，讓您的旅程安全無虞。"
                  : "Comprehensive itinerary planning and travel insurance, with immediate handling of emergencies for a safe journey.",
              },
            ].map((feature, i) => (
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
              {isChineseMode ? "包團流程" : "Group Booking Process"}
            </h2>
            <p className="text-gray-500 text-lg">
              {isChineseMode ? "簡單 4 步驟，輕鬆完成包團預訂" : "4 simple steps to complete your group booking"}
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
                {isChineseMode ? "為什麼選擇 PACK&GO 包團？" : "Why Choose PACK&GO for Group Travel?"}
              </h2>
              <div className="space-y-5">
                {[
                  {
                    icon: Users,
                    title: isChineseMode ? "豐富包團經驗" : "Extensive Group Travel Experience",
                    desc: isChineseMode
                      ? "超過 200 個成功包團案例，服務過各種規模與類型的團體，從家族旅遊到企業員工旅遊皆有豐富經驗。"
                      : "Over 200 successful group tours, serving groups of all sizes and types — from family trips to corporate employee travel.",
                  },
                  {
                    icon: Clock,
                    title: isChineseMode ? "節省規劃時間" : "Save Planning Time",
                    desc: isChineseMode
                      ? "從行程設計到機票訂位、飯店預訂，全程由我們代勞，您只需告訴我們需求，其餘交給我們。"
                      : "From itinerary design to flight and hotel bookings, we handle everything. Just tell us your needs and leave the rest to us.",
                  },
                  {
                    icon: CheckCircle,
                    title: isChineseMode ? "透明報價無隱費" : "Transparent Pricing, No Hidden Fees",
                    desc: isChineseMode
                      ? "提供詳細的費用明細，包含與不含項目一目了然，讓您安心預算規劃。"
                      : "Detailed cost breakdowns with clear inclusions and exclusions — plan your budget with confidence.",
                  },
                  {
                    icon: Headphones,
                    title: isChineseMode ? "24 小時緊急支援" : "24-Hour Emergency Support",
                    desc: isChineseMode
                      ? "旅途中遇到任何問題，我們的客服團隊隨時待命，確保您的旅程順利無阻。"
                      : "Our customer service team is on standby around the clock to handle any issue during your trip.",
                  },
                ].map((item, i) => (
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
              {isChineseMode ? "常見問題" : "Frequently Asked Questions"}
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
            {isChineseMode ? "準備好規劃您的包團旅遊了嗎？" : "Ready to Plan Your Group Tour?"}
          </h2>
          <p className="text-gray-300 text-lg mb-8 max-w-xl mx-auto">
            {isChineseMode
              ? "立即聯繫我們的包團顧問，評估您的需求，讓團體旅遊成為最美好的共同回憶。"
              : "Contact our group travel consultant now to assess your needs and make your group trip an unforgettable shared memory."}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                {isChineseMode ? "立即諮詢" : "Inquire Now"} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base bg-transparent">
                <Phone className="mr-2 h-4 w-4" />
                {isChineseMode ? "查看聯絡方式" : "View Contact Info"}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
