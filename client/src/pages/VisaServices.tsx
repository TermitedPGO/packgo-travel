import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { FileText, Clock, CheckCircle, Shield, ArrowRight, Phone, Globe, AlertCircle } from "lucide-react";

const visaTypes = [
  {
    country: "美國",
    code: "US",
    visas: ["B1/B2 觀光商務簽證", "F1 學生簽證", "J1 交流訪問簽證"],
    processingTime: "約 3–8 週",
    fee: "NT$3,500 起",
    difficulty: "中等",
    difficultyColor: "text-yellow-600 bg-yellow-50",
  },
  {
    country: "申根區（歐洲）",
    code: "EU",
    visas: ["申根短期旅遊簽證（C 類）", "長期居留簽證（D 類）"],
    processingTime: "約 2–4 週",
    fee: "NT$2,800 起",
    difficulty: "中等",
    difficultyColor: "text-yellow-600 bg-yellow-50",
  },
  {
    country: "日本",
    code: "JP",
    visas: ["短期停留觀光簽證（免簽 / 需簽）", "多次入境簽證"],
    processingTime: "約 5–7 個工作天",
    fee: "NT$1,200 起",
    difficulty: "較易",
    difficultyColor: "text-green-600 bg-green-50",
  },
  {
    country: "韓國",
    code: "KR",
    visas: ["短期觀光簽證（C-3）", "電子旅行許可 K-ETA"],
    processingTime: "約 3–5 個工作天",
    fee: "NT$1,000 起",
    difficulty: "較易",
    difficultyColor: "text-green-600 bg-green-50",
  },
  {
    country: "澳洲",
    code: "AU",
    visas: ["電子旅遊簽（ETA）", "觀光簽證（Subclass 600）", "打工度假簽（WHV）"],
    processingTime: "約 1–4 週",
    fee: "NT$2,500 起",
    difficulty: "中等",
    difficultyColor: "text-yellow-600 bg-yellow-50",
  },
  {
    country: "加拿大",
    code: "CA",
    visas: ["訪客簽證（TRV）", "電子旅行授權（eTA）", "打工度假簽（IEC）"],
    processingTime: "約 2–8 週",
    fee: "NT$3,000 起",
    difficulty: "中等",
    difficultyColor: "text-yellow-600 bg-yellow-50",
  },
  {
    country: "英國",
    code: "UK",
    visas: ["標準訪客簽證", "學生簽證", "工作簽證"],
    processingTime: "約 3–6 週",
    fee: "NT$4,000 起",
    difficulty: "較難",
    difficultyColor: "text-red-600 bg-red-50",
  },
  {
    country: "紐西蘭",
    code: "NZ",
    visas: ["訪客簽證", "電子旅行許可（NZeTA）", "打工度假簽"],
    processingTime: "約 1–3 週",
    fee: "NT$1,800 起",
    difficulty: "較易",
    difficultyColor: "text-green-600 bg-green-50",
  },
];

const processSteps = [
  {
    step: "01",
    title: "免費諮詢評估",
    desc: "聯繫我們的簽證顧問，告知目的地、停留時間與旅遊目的，我們為您評估所需簽證類型及成功率。",
    icon: Phone,
  },
  {
    step: "02",
    title: "文件清單確認",
    desc: "根據您的情況，提供詳細的文件清單，包含護照、財力證明、行程表、訂房記錄等，確保資料齊全。",
    icon: FileText,
  },
  {
    step: "03",
    title: "專業文件整理",
    desc: "我們協助您整理並翻譯所有必要文件，確保格式符合各國使館要求，提高簽證核准率。",
    icon: CheckCircle,
  },
  {
    step: "04",
    title: "代為遞件申請",
    desc: "由專業顧問代為向使館或簽證中心遞交申請，全程追蹤進度，並在必要時協助補件。",
    icon: Globe,
  },
  {
    step: "05",
    title: "簽證核發通知",
    desc: "簽證核發後即時通知您，並提供入境注意事項說明，確保您順利通關入境。",
    icon: Shield,
  },
];

const faqs = [
  {
    q: "辦理簽證需要多久時間？",
    a: "依目的地不同，處理時間從 3 個工作天到 8 週不等。建議出發前至少 6–8 週開始準備，以確保充裕的處理時間。",
  },
  {
    q: "簽證被拒怎麼辦？",
    a: "我們會分析被拒原因並提供改善建議，協助您重新申請。部分國家可提出申訴，我們也可代為處理。",
  },
  {
    q: "需要親自到使館嗎？",
    a: "大多數國家可由我們代為遞件，無需親自前往。部分國家（如美國、英國）需要親自面試，我們會提前告知並協助面試準備。",
  },
  {
    q: "費用包含哪些項目？",
    a: "費用包含文件審查、翻譯協助、代為遞件及全程追蹤服務。使館官方簽證費用另計，會在報價時一併說明。",
  },
];

export default function VisaServices() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title="代辦簽證服務"
        description="PACK&GO 提供美國、申根、日本、韓國、澳洲等全球主要國家簽證代辦服務，專業顧問全程協助，提高核准率。"
      />
      <Header />

      {/* Hero */}
      <section className="relative bg-black text-white overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1578662996442-48f60103fc96?q=80&w=2070&auto=format&fit=crop"
            alt="Passport and visa"
            className="w-full h-full object-cover opacity-35"
          />
        </div>
        <div className="relative container py-24 md:py-32">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
              <FileText className="h-4 w-4" />
              <span>代辦簽證服務</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              簽證煩惱交給我們<br />
              <span className="text-gray-300">專業代辦，提高核准率</span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              PACK&GO 簽證顧問擁有豐富的各國簽證辦理經驗，從文件準備到遞件追蹤，全程協助，讓您安心等待出發。
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/inquiry">
                <Button className="bg-white text-black hover:bg-gray-100 font-bold px-8 py-3 h-auto rounded-lg text-base">
                  免費諮詢簽證 <ArrowRight className="ml-2 h-5 w-5" />
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
              { value: "15+", label: "可辦理國家" },
              { value: "98%", label: "簽證核准率" },
              { value: "1,200+", label: "成功案例" },
              { value: "10年+", label: "專業經驗" },
            ].map((stat, i) => (
              <div key={i}>
                <div className="text-3xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-gray-400 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Visa Types */}
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">可辦理簽證國家</h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">涵蓋全球主要熱門旅遊及留學目的地，費用及處理時間僅供參考，以實際報價為準</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {visaTypes.map((v, i) => (
              <div key={i} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-10 h-10 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center text-xs font-bold text-gray-700">{v.code}</span>
                  <div>
                    <h3 className="font-bold text-gray-900">{v.country}</h3>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${v.difficultyColor}`}>{v.difficulty}</span>
                  </div>
                </div>
                <ul className="space-y-1 mb-4">
                  {v.visas.map((visa, j) => (
                    <li key={j} className="text-sm text-gray-600 flex items-start gap-1.5">
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                      {visa}
                    </li>
                  ))}
                </ul>
                <div className="border-t border-gray-100 pt-3 space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>處理時間</span>
                    <span className="font-medium text-gray-700">{v.processingTime}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>服務費</span>
                    <span className="font-medium text-gray-700">{v.fee}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-gray-400 mt-6 flex items-center justify-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            以上費用不含使館官方簽證費，實際費用依個人情況報價
          </p>
        </div>
      </section>

      {/* Process */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">辦理流程</h2>
            <p className="text-gray-500 text-lg">簡單 5 步驟，輕鬆完成簽證申請</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            {processSteps.map((step, i) => (
              <div key={i} className="text-center relative">
                {i < processSteps.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-0.5 bg-gray-200 z-0" />
                )}
                <div className="relative z-10 inline-flex items-center justify-center w-16 h-16 rounded-full bg-black text-white text-xl font-bold mb-4">
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
      <section className="py-20 bg-gray-50">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">為什麼選擇 PACK&GO 代辦簽證？</h2>
              <div className="space-y-5">
                {[
                  { icon: Shield, title: "專業顧問把關", desc: "每位簽證顧問均接受專業訓練，熟悉各國使館要求，確保文件正確無誤。" },
                  { icon: Clock, title: "節省您的時間", desc: "從文件清單到遞件追蹤，全程代辦，您只需準備文件，其餘交給我們。" },
                  { icon: CheckCircle, title: "高核准率保證", desc: "憑藉豐富經驗，我們的簽證核准率高達 98%，讓您的旅遊計畫不受阻礙。" },
                  { icon: Phone, title: "全程追蹤服務", desc: "申請後持續追蹤進度，有任何狀況立即通知，讓您隨時掌握最新動態。" },
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
                src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2074&auto=format&fit=crop"
                alt="Travel documents"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute bottom-6 left-6 text-white">
                <div className="text-4xl font-bold">98%</div>
                <div className="text-gray-200">簽證核准率</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-white">
        <div className="container max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">常見問題</h2>
          </div>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-6">
                <h3 className="font-bold text-gray-900 mb-2 flex items-start gap-2">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-black text-white text-xs flex items-center justify-center mt-0.5">Q</span>
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
          <h2 className="text-3xl md:text-4xl font-bold mb-4">準備好出發了嗎？</h2>
          <p className="text-gray-300 text-lg mb-8 max-w-xl mx-auto">立即聯繫我們的簽證顧問，免費評估您的簽證需求，讓旅程順利啟程。</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/inquiry">
              <Button className="bg-white text-black hover:bg-gray-100 font-bold px-10 py-3 h-auto rounded-lg text-base">
                立即免費諮詢 <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/contact-us">
              <Button variant="outline" className="border-white text-white hover:bg-white/10 font-bold px-10 py-3 h-auto rounded-lg text-base">
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
