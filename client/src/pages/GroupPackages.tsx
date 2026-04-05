import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Users, Star, Shield, Clock, ArrowRight, Phone,
  MapPin, CheckCircle, Headphones, Gift
} from "lucide-react";

const processSteps = [
  {
    step: "01",
    title: "專業詮詢",
    desc: "聯繫我們的包團顧問，說明您的需求、人數、目的地與預算，我們將為您提供初步規劃建議。",
  },
  {
    step: "02",
    title: "客製方案",
    desc: "根據您的需求量身打造行程，包含航班、住宿、餐食、景點與導遊安排，提供完整報價。",
  },
  {
    step: "03",
    title: "確認訂金",
    desc: "確認行程細節後繳付訂金，我們立即為您鎖位並開始辦理相關手續。",
  },
  {
    step: "04",
    title: "出發旅遊",
    desc: "專業領隊全程陪同，讓您和團員盡情享受旅程，無後顧之憂。",
  },
];

const faqs = [
  {
    q: "最少幾人可以包團？",
    a: "一般包團最少需要 10 人，最多可達 50 人。人數越多，每人費用越優惠。我們也提供 10 人以下的小包團服務，費用另議。",
  },
  {
    q: "可以指定出發日期嗎？",
    a: "包團旅遊最大的優勢就是可以自由選擇出發日期，完全配合您的團員時間安排。",
  },
  {
    q: "行程可以客製化嗎？",
    a: "當然可以！我們提供完全客製化服務，從景點選擇、住宿等級到餐食安排，都可依照您的需求調整。",
  },
  {
    q: "費用包含哪些項目？",
    a: "標準包套費用包含來回機票、全程住宿、接送交通、專業領隊及部分餐食。詳細包含項目會在報價單中清楚列明。",
  },
];

export default function GroupPackages() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title="包團旅遊"
        description="PACK&GO 提供專業包團旅遊服務，10-50 人團體皆可客製行程，專業領隊全程陪同，享受最優惠的團體價格。"
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
              <span>包團旅遊服務</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              與親友共享旅程<br />
              <span className="text-gray-300">專屬包團，全程無憂</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              PACK&GO 包團顧問擁有豐富的團體旅遊規劃經驗，從行程設計到現場領隊，全程貼心照顧，讓您的團體旅遊留下美好回憶。
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  立即諮詢包團 <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contact-us">
                <Button variant="outline" className="border-white text-white hover:bg-white/10 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  聯絡我們
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-[#1A1A1A] text-white py-12">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: "200+", label: "成功包團案例" },
              { value: "10–50人", label: "彈性團體規模" },
              { value: "98%", label: "客戶滿意度" },
              { value: "24hr", label: "全天客服支援" },
            ].map((stat, i) => (
              <div key={i}>
                <div className="text-3xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-gray-400 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">包團旅遊的優勢</h2>
            <p className="text-gray-500 text-lg">專為您的團體量身打造，享受最貼心的旅遊服務</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Star,
                title: "專業領隊全程陪同",
                desc: "經驗豐富的專業領隊全程照顧，熟悉當地文化與景點，讓您放心享受旅程。",
              },
              {
                icon: MapPin,
                title: "完全客製化行程",
                desc: "依照團員喜好與需求量身設計行程，景點、餐食、住宿均可靈活調整。",
              },
              {
                icon: Gift,
                title: "團體優惠價格",
                desc: "多人同行享受更優惠的團體價格，人數越多折扣越大，物超所值。",
              },
              {
                icon: Shield,
                title: "全程安心保障",
                desc: "完善的行程安排與旅遊保險，緊急狀況即時處理，讓您的旅程安全無虞。",
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
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">包團流程</h2>
            <p className="text-gray-500 text-lg">簡單 4 步驟，輕鬆完成包團預訂</p>
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
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">為什麼選擇 PACK&GO 包團？</h2>
              <div className="space-y-5">
                {[
                  { icon: Users, title: "豐富包團經驗", desc: "超過 200 個成功包團案例，服務過各種規模與類型的團體，從家族旅遊到企業員工旅遊皆有豐富經驗。" },
                  { icon: Clock, title: "節省規劃時間", desc: "從行程設計到機票訂位、飯店預訂，全程由我們代勞，您只需告訴我們需求，其餘交給我們。" },
                  { icon: CheckCircle, title: "透明報價無隱費", desc: "提供詳細的費用明細，包含與不含項目一目了然，讓您安心預算規劃。" },
                  { icon: Headphones, title: "24 小時緊急支援", desc: "旅途中遇到任何問題，我們的客服團隊隨時待命，確保您的旅程順利無阻。" },
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
              <div className="absolute bottom-6 left-6 text-white">
                <div className="text-4xl font-bold">200+</div>
                <div className="text-gray-200">成功包團案例</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-gray-50">
        <div className="container max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">常見問題</h2>
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
          <h2 className="text-3xl md:text-4xl font-bold mb-4">準備好規劃您的包團旅遊了嗎？</h2>
          <p className="text-gray-300 text-lg mb-8 max-w-xl mx-auto">立即聯繫我們的包團顧問，評估您的需求，讓團體旅遊成為最美好的共同回憑。</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                立即諮詢 <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base">
                <Phone className="mr-2 h-4 w-4" />
                查看聯絡方式
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
