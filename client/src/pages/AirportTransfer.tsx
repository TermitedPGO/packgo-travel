import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Car, Clock, Shield, Star, ArrowRight, Phone, Truck, Bus, Plane } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

export default function AirportTransfer() {
  const { language } = useLocale();
  const isChineseMode = language === 'zh-TW';

  const features = [
    {
      icon: Clock,
      title: isChineseMode ? "準時接送保證" : "On-Time Pickup Guarantee",
      desc: isChineseMode
        ? "即時追蹤航班動態，確保準時接機，讓您無需擔心等待問題。"
        : "Real-time flight tracking ensures on-time pickup, so you never have to worry about waiting.",
    },
    {
      icon: Shield,
      title: isChineseMode ? "安全有保障" : "Safety Guaranteed",
      desc: isChineseMode
        ? "所有司機均通過嚴格背景審查，車輛定期保養，讓您安心乘坐。"
        : "All drivers pass rigorous background checks and vehicles are regularly maintained for your peace of mind.",
    },
    {
      icon: Star,
      title: isChineseMode ? "舒適豪華車輛" : "Comfortable Luxury Vehicles",
      desc: isChineseMode
        ? "提供多種車型選擇，從商務轎車到豪華 MPV，滿足不同需求。"
        : "A wide range of vehicles available, from business sedans to luxury MPVs, to suit every need.",
    },
    {
      icon: Phone,
      title: isChineseMode ? "24/7 緊急聯絡" : "24/7 Emergency Contact",
      desc: isChineseMode
        ? "全天候客服支援，遇到任何突發狀況，立即為您處理解決。"
        : "Round-the-clock customer support ready to handle any unexpected situation immediately.",
    },
  ];

  const vehicleTypes = [
    {
      name: isChineseMode ? "商務轎車" : "Business Sedan",
      capacity: isChineseMode ? "1-3 人" : "1-3 passengers",
      desc: isChineseMode ? "舒適私密，適合商務旅客或小家庭" : "Comfortable and private, ideal for business travelers or small families",
      Icon: Car,
      examples: "Toyota Camry / Honda Accord",
    },
    {
      name: isChineseMode ? "豪華 SUV" : "Luxury SUV",
      capacity: isChineseMode ? "1-4 人" : "1-4 passengers",
      desc: isChineseMode ? "寬敞舒適，適合攜帶大型行李的旅客" : "Spacious and comfortable, perfect for travelers with large luggage",
      Icon: Truck,
      examples: "Toyota Land Cruiser / BMW X5",
    },
    {
      name: isChineseMode ? "商務 MPV" : "Business MPV",
      capacity: isChineseMode ? "5-7 人" : "5-7 passengers",
      desc: isChineseMode ? "大空間設計，適合家庭或小型團體" : "Large space design, suitable for families or small groups",
      Icon: Bus,
      examples: "Toyota Alphard / Vellfire",
    },
    {
      name: isChineseMode ? "豪華禮車" : "Luxury Limousine",
      capacity: isChineseMode ? "1-3 人" : "1-3 passengers",
      desc: isChineseMode ? "頂級奢華體驗，適合重要商務場合" : "Ultimate luxury experience, perfect for important business occasions",
      Icon: Star,
      examples: "Mercedes-Benz S-Class / BMW 7",
    },
  ];

  const airports = [
    { name: isChineseMode ? "桃園國際機場" : "Taoyuan International Airport", code: "TPE", country: isChineseMode ? "台灣" : "Taiwan" },
    { name: isChineseMode ? "成田國際機場" : "Narita International Airport", code: "NRT", country: isChineseMode ? "日本東京" : "Tokyo, Japan" },
    { name: isChineseMode ? "關西國際機場" : "Kansai International Airport", code: "KIX", country: isChineseMode ? "日本大阪" : "Osaka, Japan" },
    { name: isChineseMode ? "仁川國際機場" : "Incheon International Airport", code: "ICN", country: isChineseMode ? "韓國首爾" : "Seoul, South Korea" },
    { name: isChineseMode ? "素萬那普機場" : "Suvarnabhumi Airport", code: "BKK", country: isChineseMode ? "泰國曼谷" : "Bangkok, Thailand" },
    { name: isChineseMode ? "樟宜國際機場" : "Changi Airport", code: "SIN", country: isChineseMode ? "新加坡" : "Singapore" },
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
              {isChineseMode
                ? "此服務目前由專業顧問協助辦理，線上自助訂購功能即將推出"
                : "This service is currently handled by our consultants. Online self-booking coming soon."}
            </span>
          </div>
          <Link href="/inquiry">
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0">
              {isChineseMode ? "立即詢問顧問" : "Ask Our Consultant"}
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
              <span>{isChineseMode ? "機場接送服務" : "Airport Transfer Service"}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              {isChineseMode ? "抵達即享受" : "Arrive in Comfort"}<br />
              <span className="text-gray-300">
                {isChineseMode ? "從機場到目的地無縫接送" : "Seamless transfers from airport to destination"}
              </span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              {isChineseMode
                ? "PACK&GO 提供全球主要機場接送服務，專業司機準時接送，讓您的旅程從落地的那一刻起就充滿舒適與安心。"
                : "PACK&GO provides airport transfer services at major airports worldwide. Professional drivers ensure punctual pickups, making your journey comfortable and stress-free from the moment you land."}
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  {isChineseMode ? "立即預訂接送" : "Book a Transfer"} <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/contact-us">
                <Button variant="outline" className="border-white/50 text-white hover:bg-white/10 font-bold px-8 py-3 h-auto rounded-lg text-base bg-transparent">
                  {isChineseMode ? "聯絡我們" : "Contact Us"}
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
              {isChineseMode ? "為什麼選擇 PACK&GO 接送？" : "Why Choose PACK&GO Transfers?"}
            </h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              {isChineseMode
                ? "專業、安全、舒適，讓每一次接送都是愉快的旅程開始"
                : "Professional, safe, and comfortable — every transfer is the perfect start to your journey"}
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
              {isChineseMode ? "車型選擇" : "Vehicle Options"}
            </h2>
            <p className="text-gray-600 text-lg">
              {isChineseMode ? "多種車型滿足不同人數與需求" : "Multiple vehicle types to suit different group sizes and needs"}
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
              {isChineseMode ? "服務機場" : "Airports We Serve"}
            </h2>
            <p className="text-gray-600 text-lg">
              {isChineseMode
                ? "涵蓋亞洲主要國際機場，持續擴展服務範圍"
                : "Covering major international airports across Asia, with ongoing expansion"}
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
            {isChineseMode
              ? "未列出的機場也可提供服務，請直接聯絡我們詢問"
              : "Service is also available at unlisted airports — please contact us directly to inquire."}
          </p>
        </div>
      </section>

      {/* Process */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
              {isChineseMode ? "預訂流程" : "Booking Process"}
            </h2>
            <p className="text-gray-600 text-lg">
              {isChineseMode ? "簡單 4 步驟，輕鬆完成接送預訂" : "4 simple steps to complete your transfer booking"}
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              {
                step: "01",
                title: isChineseMode ? "提交需求" : "Submit Request",
                desc: isChineseMode ? "告知我們航班資訊、接送地點與人數" : "Share your flight details, pickup location, and group size",
              },
              {
                step: "02",
                title: isChineseMode ? "確認方案" : "Confirm Plan",
                desc: isChineseMode ? "顧問為您推薦最適合的車型與報價" : "Our consultant recommends the best vehicle and provides a quote",
              },
              {
                step: "03",
                title: isChineseMode ? "完成預訂" : "Complete Booking",
                desc: isChineseMode ? "確認後提供司機聯絡資訊與行程單" : "After confirmation, receive driver contact info and itinerary",
              },
              {
                step: "04",
                title: isChineseMode ? "準時接送" : "On-Time Transfer",
                desc: isChineseMode ? "司機準時到達，全程舒適接送服務" : "Driver arrives on time for a comfortable, full-service transfer",
              },
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
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {isChineseMode ? "預訂您的機場接送" : "Book Your Airport Transfer"}
          </h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            {isChineseMode
              ? "告訴我們您的航班資訊與目的地，我們為您安排最舒適的接送服務"
              : "Share your flight details and destination — we'll arrange the most comfortable transfer for you."}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                {isChineseMode ? "立即預訂" : "Book Now"} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base bg-transparent">
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
