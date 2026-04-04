import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Car, Clock, Shield, Star, ArrowRight, Phone, Truck, Bus, Plane, MapPin } from "lucide-react";

export default function AirportTransfer() {
  const features = [
    { icon: Clock, title: "準時接送保證", desc: "即時追蹤航班動態，確保準時接機，讓您無需擔心等待問題。" },
    { icon: Shield, title: "安全有保障", desc: "所有司機均通過嚴格背景審查，車輛定期保養，讓您安心乘坐。" },
    { icon: Star, title: "舒適豪華車輛", desc: "提供多種車型選擇，從商務轎車到豪華 MPV，滿足不同需求。" },
    { icon: Phone, title: "24/7 緊急聯絡", desc: "全天候客服支援，遇到任何突發狀況，立即為您處理解決。" },
  ];

  const vehicleTypes = [
    { name: "商務轎車", capacity: "1-3 人", desc: "舒適私密，適合商務旅客或小家庭", Icon: Car, examples: "Toyota Camry / Honda Accord" },
    { name: "豪華 SUV", capacity: "1-4 人", desc: "寬敞舒適，適合攜帶大型行李的旅客", Icon: Truck, examples: "Toyota Land Cruiser / BMW X5" },
    { name: "商務 MPV", capacity: "5-7 人", desc: "大空間設計，適合家庭或小型團體", Icon: Bus, examples: "Toyota Alphard / Vellfire" },
    { name: "豪華禮車", capacity: "1-3 人", desc: "頂級奢華體驗，適合重要商務場合", Icon: Star, examples: "Mercedes-Benz S-Class / BMW 7" },
  ];

  const airports = [
    { name: "桃園國際機場", code: "TPE", country: "台灣" },
    { name: "成田國際機場", code: "NRT", country: "日本東京" },
    { name: "關西國際機場", code: "KIX", country: "日本大阪" },
    { name: "仁川國際機場", code: "ICN", country: "韓國首爾" },
    { name: "素萬那普機場", code: "BKK", country: "泰國曼谷" },
    { name: "樟宜國際機場", code: "SIN", country: "新加坡" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />

      {/* BUG-004: Coming Soon advisory banner */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="container py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-800">
            <span className="text-lg">🚗</span>
            <span className="text-sm font-medium">此服務目前由專業顧問協助辦理，線上自助訂購功能即將推出</span>
          </div>
          <Link href="/inquiry">
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0">
              立即詢問顧問
            </Button>
          </Link>
        </div>
      </div>

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
              <span>機場接送服務</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              抵達即享受<br />
              <span className="text-gray-300">從機場到目的地無縫接送</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              PACK&GO 提供全球主要機場接送服務，專業司機準時接送，讓您的旅程從落地的那一刻起就充滿舒適與安心。
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  立即預訂接送 <ArrowRight className="ml-2 h-5 w-5" />
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

      <section className="bg-gray-900 text-white py-8">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { num: "50+", label: "服務機場" },
              { num: "30+", label: "服務城市" },
              { num: "5,000+", label: "完成接送次數" },
              { num: "100%", label: "準時率" },
            ].map((stat, i) => (
              <div key={i}>
                <div className="text-3xl font-bold text-white mb-1">{stat.num}</div>
                <div className="text-gray-400 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">為什麼選擇 PACK&GO 接送？</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">專業、安全、舒適，讓每一次接送都是愉快的旅程開始</p>
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

      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">車型選擇</h2>
            <p className="text-gray-600 text-lg">多種車型滿足不同人數與需求</p>
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

      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">服務機場</h2>
            <p className="text-gray-600 text-lg">涵蓋亞洲主要國際機場，持續擴展服務範圍</p>
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
          <p className="text-center text-gray-500 text-sm mt-6">未列出的機場也可提供服務，請直接聯絡我們詢問</p>
        </div>
      </section>

      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">預訂流程</h2>
            <p className="text-gray-600 text-lg">簡單 4 步驟，輕鬆完成接送預訂</p>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: "01", title: "提交需求", desc: "告知我們航班資訊、接送地點與人數" },
              { step: "02", title: "確認方案", desc: "顧問為您推薦最適合的車型與報價" },
              { step: "03", title: "完成預訂", desc: "確認後提供司機聯絡資訊與行程單" },
              { step: "04", title: "準時接送", desc: "司機準時到達，全程舒適接送服務" },
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

      <section className="py-20 bg-black text-white">
        <div className="container text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">預訂您的機場接送</h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            告訴我們您的航班資訊與目的地，我們為您安排最舒適的接送服務
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                立即預訂 <ArrowRight className="ml-2 h-5 w-5" />
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

      <Footer />
    </div>
  );
}
