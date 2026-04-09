import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trackAffiliateClick } from "@/lib/analytics";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Hotel, Star, Wifi, Car, Utensils, Dumbbell, Shield, Headphones, ArrowRight, MapPin, CheckCircle, Building2, Palmtree, Waves, Flame, ExternalLink, Search } from "lucide-react";
import AITravelAdvisorDialog from "@/components/AITravelAdvisorDialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function HotelBooking() {
  const { t } = useLocale();
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorInitialMsg, setAdvisorInitialMsg] = useState("");

  // Hotel search form state
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const utils = trpc.useUtils();
  const trackClickMutation = trpc.affiliate.trackClick.useMutation();

  const openAdvisor = (msg: string) => {
    setAdvisorInitialMsg(msg);
    setAdvisorOpen(true);
  };

  const handleSearchHotels = async () => {
    setIsSearching(true);
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: "hotels",
        city: city || undefined,
        checkIn: checkIn || undefined,
        checkOut: checkOut || undefined,
      });
      const url = result.url;
      await trackClickMutation.mutateAsync({
        platform: "trip_hotels",
        targetUrl: url,
        referrerPage: "/hotel-booking",
      });
      trackAffiliateClick({ platform: 'trip.com', linkType: 'hotel', destination: city || undefined, searchQuery: city || '' });
      toast.info("正在前往 Trip.com 搜尋飯店...");
      window.open(url, "_blank");
    } catch (err) {
      toast.error("無法開啟搜尋頁面，請稍後再試");
    } finally {
      setIsSearching(false);
    }
  };

  const handleDestinationClick = async (dest: { city: string; country: string }) => {
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: "hotels",
        city: dest.city,
      });
      await trackClickMutation.mutateAsync({
        platform: "trip_hotels",
        targetUrl: result.url,
        referrerPage: "/hotel-booking",
      });
      trackAffiliateClick({ platform: 'trip.com', linkType: 'hotel', destination: dest.city, searchQuery: `${dest.country}${dest.city}` });
      toast.info(`正在前往 Trip.com 搜尋${dest.country}${dest.city}飯店...`);
      window.open(result.url, "_blank");
    } catch {
      openAdvisor(`我想在${dest.country}${dest.city}找住宿，請問有哪些推薦的飯店？大概的價位範圍是多少？`);
    }
  };

  const features = [
    { icon: Star, title: "精選優質飯店", desc: "嚴格篩選全球各地優質飯店，從精品民宿到五星豪華酒店，滿足各種需求。" },
    { icon: Shield, title: "最低價格保證", desc: "提供最具競爭力的飯店價格，若您找到更低價，我們承諾差額退還。" },
    { icon: Headphones, title: "專人入住協助", desc: "提前確認入住細節，協助特殊需求安排，讓您抵達即享受。" },
    { icon: CheckCircle, title: "彈性取消政策", desc: "提供多種取消方案選擇，讓您的行程規劃更有彈性。" },
  ];

  const hotelTypes = [
    { name: "精品設計旅館", desc: "獨特設計風格，體驗當地文化與藝術", Icon: Hotel, tag: "個性首選" },
    { name: "商務酒店", desc: "完善商務設施，高效舒適的工作環境", Icon: Building2, tag: "商旅必備" },
    { name: "度假村", desc: "全包式服務，享受無憂無慮的假期", Icon: Palmtree, tag: "休閒放鬆" },
    { name: "五星豪華酒店", desc: "頂級服務與設施，尊享奢華體驗", Icon: Star, tag: "頂級享受" },
    { name: "溫泉旅館", desc: "日式傳統風情，療愈身心的溫泉體驗", Icon: Flame, tag: "日本特色" },
    { name: "海景民宿", desc: "絕美海景視野，感受大自然的壯闊", Icon: Waves, tag: "自然風情" },
  ];

  const amenities = [
    { icon: Wifi, label: "免費 Wi-Fi" },
    { icon: Car, label: "停車場" },
    { icon: Utensils, label: "餐廳" },
    { icon: Dumbbell, label: "健身房" },
    { icon: Star, label: "游泳池" },
    { icon: Shield, label: "24H 保全" },
  ];

  const destinations = [
    { city: "東京", country: "日本", hotels: "500+" },
    { city: "大阪", country: "日本", hotels: "300+" },
    { city: "首爾", country: "韓國", hotels: "400+" },
    { city: "曼谷", country: "泰國", hotels: "600+" },
    { city: "新加坡", country: "新加坡", hotels: "250+" },
    { city: "峨里島", country: "印尼", hotels: "350+" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />

      {/* Hotel Search Card */}
      <section className="py-10 bg-gray-50 border-b border-gray-200">
        <div className="container">
          <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
                <Search className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-black">搜尋飯店</h2>
                <p className="text-sm text-gray-500">透過 Trip.com 即時比價，找到最優惠住宿</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">目的地城市</Label>
                <Input placeholder="城市名稱（如 Tokyo）" value={city} onChange={e => setCity(e.target.value)} className="h-11" />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">入住日期</Label>
                <Input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} className="h-11" />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5 block">退房日期</Label>
                <Input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} className="h-11" />
              </div>
            </div>
            <Button onClick={handleSearchHotels} disabled={isSearching} className="w-full h-12 bg-black hover:bg-gray-800 text-white font-bold text-base rounded-xl flex items-center justify-center gap-2">
              <Search className="h-5 w-5" />
              {isSearching ? "正在開啟 Trip.com..." : "搜尋飯店"}
              <ExternalLink className="h-4 w-4 opacity-70" />
            </Button>
            <p className="text-center text-xs text-gray-400 mt-3">將跳轉至 Trip.com 完成搜尋與預訂 · 由 PACK&GO 聯盟合作提供</p>
          </div>
        </div>
      </section>

      {/* Hero */}
      <section className="relative bg-black text-white overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=2070&auto=format&fit=crop"
            alt="Hotel booking"
            className="w-full h-full object-cover opacity-40"
          />
        </div>
        <div className="relative container py-24 md:py-32">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
              <Hotel className="h-4 w-4" />
              <span>飯店預訂服務</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              每一晚都是<br />
              <span className="text-gray-300">難忘的旅程記憶</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              PACK&GO 精選全球優質飯店，從溫馨民宿到頂級豪華酒店，
              專業顧問為您找到最適合的住宿選擇。
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  立即諮詢住宿 <ArrowRight className="ml-2 h-5 w-5" />
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
              { num: "5,000+", label: "合作飯店" },
              { num: "80+", label: "目的地城市" },
              { num: "3★-5★", label: "星級範圍" },
              { num: "99%", label: "訂房成功率" },
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
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">我們的飯店服務優勢</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">不只是訂房，更是為您打造完美的住宿體驗</p>
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

      {/* Hotel Types — clickable to open AI advisor */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">住宿類型</h2>
            <p className="text-gray-600 text-lg">多元住宿選擇，滿足不同旅行風格</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {hotelTypes.map((type, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openAdvisor(`我對「${type.name}」有興趣，${type.desc}，請問有哪些推薦的選擇和大概的價位？`)}
                className="bg-white rounded-xl p-6 border border-gray-100 hover:border-black hover:shadow-md transition-all flex items-start gap-4 text-left w-full"
              >
                <div className="w-10 h-10 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                  <type.Icon className="h-5 w-5 text-black" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-bold text-black">{type.name}</h3>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{type.tag}</span>
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed mb-3">{type.desc}</p>
                  <span className="text-xs text-black font-medium underline underline-offset-2">點擊諮詢此類型 →</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Destinations — clickable to open AI advisor */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">熱門目的地</h2>
            <p className="text-gray-600 text-lg">精選亞洲熱門城市，提供最豐富的住宿選擇</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {destinations.map((dest, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleDestinationClick(dest)}
                className="flex items-center gap-4 p-5 border border-gray-200 rounded-xl hover:border-black hover:shadow-sm transition-all group text-left w-full"
              >
                <div className="w-12 h-12 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                  <MapPin className="h-6 w-6 text-black" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-black">{dest.city}</div>
                  <div className="flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5" />
                    {dest.country}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-black text-sm">{dest.hotels}</div>
                  <div className="text-xs text-gray-500">間飯店</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Amenities — clickable chips to open AI advisor */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">常見設施篩選</h2>
            <p className="text-gray-600 text-lg">告訴我們您的需求，我們為您找到最合適的飯店</p>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {amenities.map((amenity, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openAdvisor(`我在找有「${amenity.label}」設施的飯店，請問有哪些推薦的選擇？`)}
                className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all"
              >
                <amenity.icon className="h-4 w-4" />
                {amenity.label}
              </button>
            ))}
          </div>
          <p className="text-center text-gray-500 text-sm mt-6">
            點擊設施標籤，AI 顧問將為您推薦符合需求的飯店
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-black text-white">
        <div className="container text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">找到您的完美住所</h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            告訴我們您的旅行日期、目的地與預算，我們為您推薦最適合的住宿選擇
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
