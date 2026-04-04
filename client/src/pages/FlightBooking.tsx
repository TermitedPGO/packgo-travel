import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Plane, Clock, Shield, Globe, CreditCard, Headphones, ArrowRight, Briefcase, Crown, Star } from "lucide-react";
import AITravelAdvisorDialog from "@/components/AITravelAdvisorDialog";

export default function FlightBooking() {
  const { t } = useLocale();
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorInitialMsg, setAdvisorInitialMsg] = useState("");

  const openAdvisor = (msg: string) => {
    setAdvisorInitialMsg(msg);
    setAdvisorOpen(true);
  };

  const features = [
    { icon: Globe, title: "全球航線覆蓋", desc: "與全球 500+ 航空公司合作，涵蓋亞洲、歐洲、美洲等主要航線。" },
    { icon: CreditCard, title: "最優惠票價", desc: "透過專業採購管道，取得市場最具競爭力的機票價格，提供彈性退改票服務。" },
    { icon: Headphones, title: "24/7 專人服務", desc: "從訂票到登機，全程專業顧問陪伴，遇到任何問題隨時聯繫。" },
    { icon: Shield, title: "行程保障", desc: "提供全面的旅遊保險方案，包含航班延誤補償、行李遺失保障。" },
  ];

  const cabinClasses = [
    { name: "經濟艙", nameEn: "Economy", desc: "性價比最高的選擇，適合預算有限的旅客", Icon: Plane },
    { name: "豪華經濟艙", nameEn: "Premium Economy", desc: "更寬敞的座位與升級餐飲，享受更舒適的旅程", Icon: Star },
    { name: "商務艙", nameEn: "Business", desc: "全平躺座椅、精綻餐飲與優先登機，商旅首選", Icon: Briefcase },
    { name: "頭等艙", nameEn: "First Class", desc: "頂級奢華體驗，私人套房、米其林級餐飲服務", Icon: Crown },
  ];

  const popularRoutes = [
    { from: "台北 TPE", to: "東京 TYO", duration: "約 3.5 小時", tag: "熱門" },
    { from: "台北 TPE", to: "大阪 OSA", duration: "約 3 小時", tag: "熱門" },
    { from: "台北 TPE", to: "首爾 SEL", duration: "約 2.5 小時", tag: "熱門" },
    { from: "台北 TPE", to: "曼谷 BKK", duration: "約 4 小時", tag: "推薦" },
    { from: "台北 TPE", to: "新加坡 SIN", duration: "約 4.5 小時", tag: "推薦" },
    { from: "台北 TPE", to: "洛杉磯 LAX", duration: "約 12 小時", tag: "長途" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />

      {/* BUG-004: Coming Soon advisory banner */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="container py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-800">
            <span className="text-lg">✈️</span>
            <span className="text-sm font-medium">此服務目前由專業顧問協助辦理，線上自助訂購功能即將推出</span>
          </div>
          <Link href="/inquiry">
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0">
              立即詢問顧問
            </Button>
          </Link>
        </div>
      </div>

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
              <span>機票預購服務</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              飛往世界每個角落<br />
              <span className="text-gray-300">讓旅程從起飛開始</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              PACK&GO 提供全球機票代購服務，專業顧問為您比較最優惠票價，從訂票到登機全程陪伴。
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  立即諮詢票價 <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contact-us">
                <Button variant="outline" className="border-white/50 text-white hover:bg-white/10 font-bold px-8 py-3 h-auto rounded-lg text-base bg-transparent">
                  聯絡我們
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
              { num: "500+", label: "合作航空公司" },
              { num: "150+", label: "目的地國家" },
              { num: "10,000+", label: "服務旅客" },
              { num: "98%", label: "客戶滿意度" },
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
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">為什麼選擇 PACK&GO 訂機票？</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">我們不只是訂票平台，更是您的專屬旅遊顧問</p>
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
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">艙等選擇</h2>
            <p className="text-gray-600 text-lg">依您的需求與預算，選擇最適合的艙等</p>
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
                  onClick={() => openAdvisor(`我想詢問${cabin.name}（${cabin.nameEn}）的機票，請問有哪些航線和票價可以選擇？`)}
                  className="mt-auto w-full py-2 rounded-lg border border-black text-black text-sm font-medium hover:bg-black hover:text-white transition-all"
                >
                  諮詢此艙等
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
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">熱門航線</h2>
            <p className="text-gray-600 text-lg">精選熱門目的地，提供最優惠的機票方案</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {popularRoutes.map((route, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openAdvisor(`我想查詢從 ${route.from} 到 ${route.to} 的機票，飛行時間約 ${route.duration}，請問有哪些航班和票價？`)}
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
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  route.tag === "熱門" ? "bg-black text-white" :
                  route.tag === "推薦" ? "bg-gray-100 text-gray-700" :
                  "bg-gray-50 text-gray-500"
                }`}>
                  {route.tag}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">訂票流程</h2>
            <p className="text-gray-600 text-lg">簡單 4 步驟，輕鬆完成機票預訂</p>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: "01", title: "提交需求", desc: "告知我們出發地、目的地、日期及人數" },
              { step: "02", title: "比較方案", desc: "顧問為您比較多家航空的最優惠票價" },
              { step: "03", title: "確認訂位", desc: "選定方案後，我們協助完成訂位手續" },
              { step: "04", title: "收取機票", desc: "電子機票直接發送至您的電子信箱" },
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
          <h2 className="text-3xl md:text-4xl font-bold mb-4">準備好出發了嗎？</h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            立即聯絡我們的機票顧問，獲取專屬報價與最新優惠資訊
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                立即諮詢 <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base bg-transparent">
                查看聯絡方式
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
