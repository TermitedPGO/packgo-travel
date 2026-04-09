import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocale } from "@/contexts/LocaleContext";
import {
  ChevronRight,
  ChevronLeft,
  FileText,
  CreditCard,
  CheckCircle,
  Clock,
  Shield,
  Users,
  AlertCircle,
  Loader2,
} from "lucide-react";

// ── 簽證類型資料 ──────────────────────────────────────────────
const VISA_TYPES = [
  { value: "L_tourist", zh: "L 簽 — 旅遊簽證", en: "L Visa — Tourist", desc_zh: "適合觀光、探親、探友", desc_en: "For tourism, visiting relatives/friends" },
  { value: "M_business", zh: "M 簽 — 商務簽證", en: "M Visa — Business", desc_zh: "適合商業活動、參展、洽談", desc_en: "For business activities, exhibitions, negotiations" },
  { value: "Q1_family_long", zh: "Q1 簽 — 家庭團聚（長期）", en: "Q1 Visa — Family Reunion (Long-term)", desc_zh: "定居中國的外籍配偶或子女", desc_en: "Foreign spouses/children residing in China" },
  { value: "Q2_family_short", zh: "Q2 簽 — 家庭探親（短期）", en: "Q2 Visa — Family Visit (Short-term)", desc_zh: "短期探訪在中國的家庭成員", desc_en: "Short-term visit to family members in China" },
  { value: "S1_dependent_long", zh: "S1 簽 — 隨行家屬（長期）", en: "S1 Visa — Dependent (Long-term)", desc_zh: "在華工作外籍人員的長期家屬", desc_en: "Long-term dependents of foreigners working in China" },
  { value: "S2_dependent_short", zh: "S2 簽 — 隨行家屬（短期）", en: "S2 Visa — Dependent (Short-term)", desc_zh: "在華工作外籍人員的短期家屬", desc_en: "Short-term dependents of foreigners working in China" },
  { value: "Z_work", zh: "Z 簽 — 工作簽證", en: "Z Visa — Work", desc_zh: "在中國就業的外籍人員", desc_en: "Foreigners employed in China" },
  { value: "X1_study_long", zh: "X1 簽 — 學生簽證（長期）", en: "X1 Visa — Student (Long-term)", desc_zh: "在中國就讀 6 個月以上", desc_en: "Studying in China for more than 6 months" },
  { value: "X2_study_short", zh: "X2 簽 — 學生簽證（短期）", en: "X2 Visa — Student (Short-term)", desc_zh: "在中國就讀 6 個月以下", desc_en: "Studying in China for 6 months or less" },
];

const ENTRY_TYPES = [
  { value: "single", zh: "單次入境", en: "Single Entry" },
  { value: "double", zh: "兩次入境", en: "Double Entry" },
  { value: "multiple_6m", zh: "半年多次入境", en: "Multiple Entry (6 months)" },
  { value: "multiple_12m", zh: "一年多次入境", en: "Multiple Entry (12 months)" },
];

const PROCESSING_SPEEDS = [
  { value: "regular", zh: "普通", en: "Regular", duration_zh: "10-15 個工作日", duration_en: "10-15 business days" },
  { value: "express", zh: "加急", en: "Express", duration_zh: "5-7 個工作日", duration_en: "5-7 business days" },
  { value: "rush", zh: "特急", en: "Rush", duration_zh: "2-3 個工作日", duration_en: "2-3 business days" },
];

const REQUIRED_DOCUMENTS = [
  { zh: "有效護照正本（效期需超過 6 個月）", en: "Valid passport (must be valid for more than 6 months)" },
  { zh: "護照照片頁影本", en: "Copy of passport photo page" },
  { zh: "近期 2 吋白底彩色照片 2 張", en: "2 recent 2-inch white background color photos" },
  { zh: "填寫完整的中國簽證申請表", en: "Completed China visa application form" },
  { zh: "來回機票訂位確認單", en: "Round-trip flight booking confirmation" },
  { zh: "飯店訂房確認單或邀請函", en: "Hotel booking confirmation or invitation letter" },
];

const PROCESS_STEPS = [
  { zh: "線上填寫申請表", en: "Fill out online application form" },
  { zh: "線上付款代辦費用", en: "Pay service fee online" },
  { zh: "郵寄或親送護照及文件", en: "Mail or deliver passport and documents" },
  { zh: "我們代為送件至領事館", en: "We submit to the consulate on your behalf" },
  { zh: "簽證核准後通知取件", en: "Notify you to pick up after visa approval" },
];

const FAQS = [
  {
    q_zh: "申請中國簽證需要多久？",
    q_en: "How long does it take to get a China visa?",
    a_zh: "普通處理需 10-15 個工作日，加急 5-7 個工作日，特急 2-3 個工作日。",
    a_en: "Regular processing takes 10-15 business days, express 5-7 business days, rush 2-3 business days.",
  },
  {
    q_zh: "我需要親自前往領事館嗎？",
    q_en: "Do I need to visit the consulate in person?",
    a_zh: "不需要！我們全程代辦，您只需郵寄或親送護照及文件至我們辦公室即可。",
    a_en: "No! We handle everything. You just need to mail or deliver your passport and documents to our office.",
  },
  {
    q_zh: "如果簽證被拒，可以退款嗎？",
    q_en: "Can I get a refund if my visa is rejected?",
    a_zh: "若簽證被拒，我們將退還代辦服務費。領事館費用（政府費用）恕不退還。",
    a_en: "If your visa is rejected, we will refund the service fee. Consulate fees (government fees) are non-refundable.",
  },
  {
    q_zh: "美國公民申請中國簽證費用較高嗎？",
    q_en: "Is the China visa fee higher for US citizens?",
    a_zh: "是的，根據互惠原則，美國公民的領事館費用為 USD $185，其他國家通常為 USD $50-151。",
    a_en: "Yes, based on reciprocity, the consulate fee for US citizens is USD $185, while other countries are typically USD $50-151.",
  },
  {
    q_zh: "可以申請多次入境簽證嗎？",
    q_en: "Can I apply for a multiple-entry visa?",
    a_zh: "可以，我們提供單次、兩次、半年多次及一年多次入境選項。多次入境需要額外費用。",
    a_en: "Yes, we offer single, double, 6-month multiple, and 12-month multiple entry options. Multiple entries require additional fees.",
  },
];

// ── 主頁面 ────────────────────────────────────────────────────
export default function ChinaVisa() {
  const { language } = useLocale();
  const isChineseMode = language === "zh-TW";
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState(0); // 0 = landing, 1-5 = wizard steps
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Form state
  const [form, setForm] = useState({
    // Step 1: Visa type
    visaType: "L_tourist",
    entryType: "single",
    processingSpeed: "regular",
    travelDate: "",
    travelPurpose: "",
    groupSize: 1,
    isReturningCustomer: false,
    // Step 2: Personal info
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    placeOfBirth: "",
    // Step 3: Passport
    passportNumber: "",
    passportExpiry: "",
    passportCountry: "United States",
    // Step 4: Review (no extra fields)
    // Step 5: Payment (handled by Stripe)
  });

  const updateForm = (field: string, value: string | number | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Pricing query
  const pricingQuery = trpc.visa.calculatePricing.useQuery({
    visaType: form.visaType,
    entryType: form.entryType,
    processingSpeed: form.processingSpeed,
    passportCountry: form.passportCountry,
    groupSize: form.groupSize,
    isReturningCustomer: form.isReturningCustomer,
  }, { enabled: currentStep >= 1 });

  const countriesQuery = trpc.visa.getSupportedCountries.useQuery();

  const submitMutation = trpc.visa.submitApplication.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err) => {
      setSubmitError(err.message);
      setIsSubmitting(false);
    },
  });

  const pricing = pricingQuery.data;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError("");
    submitMutation.mutate({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      passportNumber: form.passportNumber,
      passportExpiry: form.passportExpiry,
      passportCountry: form.passportCountry,
      dateOfBirth: form.dateOfBirth,
      placeOfBirth: form.placeOfBirth || undefined,
      visaType: form.visaType,
      entryType: form.entryType,
      processingSpeed: form.processingSpeed,
      travelDate: form.travelDate || undefined,
      travelPurpose: form.travelPurpose || undefined,
      previousVisits: 0,
      groupSize: form.groupSize,
      isReturningCustomer: form.isReturningCustomer,
    });
  };

  const selectedVisaType = VISA_TYPES.find(v => v.value === form.visaType);
  const selectedEntryType = ENTRY_TYPES.find(e => e.value === form.entryType);
  const selectedSpeed = PROCESSING_SPEEDS.find(s => s.value === form.processingSpeed);

  // ── Landing page (step 0) ─────────────────────────────────
  if (currentStep === 0) {
    return (
      <div className="min-h-screen flex flex-col bg-white font-sans">
        <Header />
        <main className="flex-grow">
          {/* Hero */}
          <section className="bg-[#1A1A1A] text-white py-20">
            <div className="container max-w-5xl mx-auto px-4">
              <div className="flex flex-col md:flex-row items-center gap-12">
                <div className="flex-1">
                  <div className="inline-block border border-white/30 px-3 py-1 text-xs tracking-widest text-white/60 mb-6">
                    {isChineseMode ? "中國簽證代辦服務" : "CHINA VISA SERVICE"}
                  </div>
                  <h1 className="text-4xl md:text-5xl font-serif font-bold mb-6 leading-tight">
                    {isChineseMode ? "中國簽證代辦" : "China Visa Application"}
                  </h1>
                  <p className="text-gray-400 text-lg mb-8 leading-relaxed">
                    {isChineseMode
                      ? "專業代辦中國各類型簽證，省時省力，全程協助。超過 15 年簽證代辦經驗，核准率高達 99%。"
                      : "Professional China visa application service. Save time and effort with our full assistance. Over 15 years of experience with a 99% approval rate."}
                  </p>
                  <div className="flex flex-wrap gap-4 mb-8">
                    {[
                      { icon: <Shield className="h-4 w-4" />, zh: "99% 核准率", en: "99% Approval Rate" },
                      { icon: <Clock className="h-4 w-4" />, zh: "最快 2 天", en: "As fast as 2 days" },
                      { icon: <Users className="h-4 w-4" />, zh: "團體優惠", en: "Group Discounts" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-white/70">
                        {item.icon}
                        <span>{isChineseMode ? item.zh : item.en}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={() => setCurrentStep(1)}
                    className="bg-white text-black hover:bg-gray-100 px-8 py-3 text-base font-bold rounded-none"
                  >
                    {isChineseMode ? "立即申請" : "Apply Now"}
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4">
                  {[
                    { zh: "旅遊簽 L", en: "Tourist L", price: "from $120" },
                    { zh: "商務簽 M", en: "Business M", price: "from $150" },
                    { zh: "學生簽 X", en: "Student X", price: "from $150" },
                    { zh: "工作簽 Z", en: "Work Z", price: "from $200" },
                  ].map((item, i) => (
                    <div key={i} className="border border-white/20 p-4">
                      <div className="text-lg font-bold mb-1">{isChineseMode ? item.zh : item.en}</div>
                      <div className="text-gray-400 text-sm">{item.price}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Pricing Table */}
          <section className="py-16 bg-gray-50 border-b border-gray-200">
            <div className="container max-w-5xl mx-auto px-4">
              <h2 className="text-2xl font-serif font-bold mb-8 text-center">
                {isChineseMode ? "代辦費用一覽" : "Service Fee Schedule"}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#1A1A1A] text-white">
                      <th className="px-4 py-3 text-left">{isChineseMode ? "簽證類型" : "Visa Type"}</th>
                      <th className="px-4 py-3 text-center">{isChineseMode ? "普通 (10-15天)" : "Regular (10-15d)"}</th>
                      <th className="px-4 py-3 text-center">{isChineseMode ? "加急 (5-7天)" : "Express (5-7d)"}</th>
                      <th className="px-4 py-3 text-center">{isChineseMode ? "特急 (2-3天)" : "Rush (2-3d)"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {VISA_TYPES.slice(0, 4).map((vt, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-4 py-3 font-medium">{isChineseMode ? vt.zh : vt.en}</td>
                        <td className="px-4 py-3 text-center">
                          ${i === 0 ? 120 : i === 1 ? 150 : i === 2 ? 180 : 150}
                        </td>
                        <td className="px-4 py-3 text-center">
                          ${i === 0 ? 180 : i === 1 ? 210 : i === 2 ? 240 : 210}
                        </td>
                        <td className="px-4 py-3 text-center">
                          ${i === 0 ? 240 : i === 1 ? 270 : i === 2 ? 300 : 270}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-500 mt-3">
                  {isChineseMode
                    ? "* 以上為代辦服務費，不含領事館費用（依護照國籍而定，美國公民 $185，其他國家 $50-151）"
                    : "* Above are service fees only, excluding consulate fees (varies by nationality: US citizens $185, others $50-151)"}
                </p>
              </div>
            </div>
          </section>

          {/* Required Documents */}
          <section className="py-16 border-b border-gray-200">
            <div className="container max-w-5xl mx-auto px-4">
              <div className="grid md:grid-cols-2 gap-12">
                <div>
                  <h2 className="text-2xl font-serif font-bold mb-6">
                    {isChineseMode ? "所需文件" : "Required Documents"}
                  </h2>
                  <ul className="space-y-3">
                    {REQUIRED_DOCUMENTS.map((doc, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700">{isChineseMode ? doc.zh : doc.en}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="text-2xl font-serif font-bold mb-6">
                    {isChineseMode ? "申請流程" : "Application Process"}
                  </h2>
                  <ol className="space-y-4">
                    {PROCESS_STEPS.map((step, i) => (
                      <li key={i} className="flex items-start gap-4">
                        <div className="w-8 h-8 bg-[#1A1A1A] text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                          {i + 1}
                        </div>
                        <span className="text-gray-700 pt-1">{isChineseMode ? step.zh : step.en}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section className="py-16 bg-gray-50 border-b border-gray-200">
            <div className="container max-w-5xl mx-auto px-4">
              <h2 className="text-2xl font-serif font-bold mb-8 text-center">
                {isChineseMode ? "常見問題" : "Frequently Asked Questions"}
              </h2>
              <div className="space-y-6 max-w-3xl mx-auto">
                {FAQS.map((faq, i) => (
                  <div key={i} className="border-b border-gray-200 pb-6">
                    <h3 className="font-bold text-gray-900 mb-2">
                      {isChineseMode ? faq.q_zh : faq.q_en}
                    </h3>
                    <p className="text-gray-600 text-sm leading-relaxed">
                      {isChineseMode ? faq.a_zh : faq.a_en}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="py-16 bg-[#1A1A1A] text-white text-center">
            <div className="container max-w-2xl mx-auto px-4">
              <h2 className="text-3xl font-serif font-bold mb-4">
                {isChineseMode ? "準備好申請了嗎？" : "Ready to Apply?"}
              </h2>
              <p className="text-gray-400 mb-8">
                {isChineseMode
                  ? "只需 5 分鐘填寫申請表，我們為您處理所有繁瑣手續"
                  : "Just 5 minutes to fill out the form, we handle all the paperwork for you"}
              </p>
              <Button
                onClick={() => setCurrentStep(1)}
                className="bg-white text-black hover:bg-gray-100 px-10 py-3 text-base font-bold rounded-none"
              >
                {isChineseMode ? "立即開始申請" : "Start Application Now"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  // ── Wizard (steps 1-5) ────────────────────────────────────
  const stepTitles = isChineseMode
    ? ["選擇簽證類型", "個人資訊", "護照資訊", "確認申請", "付款"]
    : ["Select Visa Type", "Personal Info", "Passport Info", "Review", "Payment"];

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <Header />
      <main className="flex-grow">
        {/* Wizard header */}
        <div className="bg-[#1A1A1A] text-white py-8">
          <div className="container max-w-4xl mx-auto px-4">
            <h1 className="text-2xl font-serif font-bold mb-6">
              {isChineseMode ? "中國簽證申請" : "China Visa Application"}
            </h1>
            {/* Step indicators */}
            <div className="flex items-center gap-0">
              {stepTitles.map((title, i) => (
                <div key={i} className="flex items-center">
                  <div className={`flex items-center gap-2 px-3 py-1 text-sm ${
                    i + 1 === currentStep ? "bg-white text-black font-bold" :
                    i + 1 < currentStep ? "text-white/60" : "text-white/30"
                  }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                      i + 1 < currentStep ? "bg-green-500 text-white" :
                      i + 1 === currentStep ? "bg-black text-white" : "bg-white/20 text-white/40"
                    }`}>
                      {i + 1 < currentStep ? "✓" : i + 1}
                    </span>
                    <span className="hidden sm:inline">{title}</span>
                  </div>
                  {i < stepTitles.length - 1 && (
                    <ChevronRight className="h-4 w-4 text-white/30 mx-1" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="container max-w-4xl mx-auto px-4 py-10">
          <div className="grid md:grid-cols-3 gap-8">
            {/* Main form */}
            <div className="md:col-span-2">
              {/* Step 1: Visa Type */}
              {currentStep === 1 && (
                <div>
                  <h2 className="text-xl font-bold mb-6">
                    {isChineseMode ? "選擇簽證類型" : "Select Visa Type"}
                  </h2>

                  <div className="space-y-6">
                    <div>
                      <Label className="text-sm font-bold mb-2 block">
                        {isChineseMode ? "簽證類型" : "Visa Type"}
                      </Label>
                      <div className="grid gap-2">
                        {VISA_TYPES.map(vt => (
                          <button
                            key={vt.value}
                            onClick={() => updateForm("visaType", vt.value)}
                            className={`text-left p-3 border-2 transition-colors ${
                              form.visaType === vt.value
                                ? "border-black bg-black text-white"
                                : "border-gray-200 hover:border-gray-400"
                            }`}
                          >
                            <div className="font-medium text-sm">{isChineseMode ? vt.zh : vt.en}</div>
                            <div className={`text-xs mt-0.5 ${form.visaType === vt.value ? "text-white/70" : "text-gray-500"}`}>
                              {isChineseMode ? vt.desc_zh : vt.desc_en}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-bold mb-2 block">
                        {isChineseMode ? "入境次數" : "Entry Type"}
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        {ENTRY_TYPES.map(et => (
                          <button
                            key={et.value}
                            onClick={() => updateForm("entryType", et.value)}
                            className={`p-3 border-2 text-sm font-medium transition-colors ${
                              form.entryType === et.value
                                ? "border-black bg-black text-white"
                                : "border-gray-200 hover:border-gray-400"
                            }`}
                          >
                            {isChineseMode ? et.zh : et.en}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-bold mb-2 block">
                        {isChineseMode ? "處理速度" : "Processing Speed"}
                      </Label>
                      <div className="grid grid-cols-3 gap-2">
                        {PROCESSING_SPEEDS.map(ps => (
                          <button
                            key={ps.value}
                            onClick={() => updateForm("processingSpeed", ps.value)}
                            className={`p-3 border-2 text-sm transition-colors ${
                              form.processingSpeed === ps.value
                                ? "border-black bg-black text-white"
                                : "border-gray-200 hover:border-gray-400"
                            }`}
                          >
                            <div className="font-medium">{isChineseMode ? ps.zh : ps.en}</div>
                            <div className={`text-xs mt-0.5 ${form.processingSpeed === ps.value ? "text-white/70" : "text-gray-500"}`}>
                              {isChineseMode ? ps.duration_zh : ps.duration_en}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-bold mb-2 block">
                        {isChineseMode ? "申請人數" : "Number of Applicants"}
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        value={form.groupSize}
                        onChange={e => updateForm("groupSize", parseInt(e.target.value) || 1)}
                        className="w-32 border-2 border-gray-300 rounded-none"
                      />
                      {form.groupSize >= 5 && (
                        <p className="text-xs text-green-600 mt-1">
                          {isChineseMode ? "✓ 5人以上享有 10% 團體優惠" : "✓ 10% group discount for 5+ applicants"}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label className="text-sm font-bold mb-2 block">
                        {isChineseMode ? "預計出行日期（選填）" : "Planned Travel Date (Optional)"}
                      </Label>
                      <Input
                        type="date"
                        value={form.travelDate}
                        onChange={e => updateForm("travelDate", e.target.value)}
                        className="border-2 border-gray-300 rounded-none"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="returning"
                        checked={form.isReturningCustomer}
                        onCheckedChange={v => updateForm("isReturningCustomer", !!v)}
                      />
                      <Label htmlFor="returning" className="text-sm cursor-pointer">
                        {isChineseMode ? "我是回頭客（享 5% 優惠）" : "I am a returning customer (5% discount)"}
                      </Label>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Personal Info */}
              {currentStep === 2 && (
                <div>
                  <h2 className="text-xl font-bold mb-6">
                    {isChineseMode ? "個人資訊" : "Personal Information"}
                  </h2>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-bold mb-1 block">
                          {isChineseMode ? "名字" : "First Name"} *
                        </Label>
                        <Input
                          value={form.firstName}
                          onChange={e => updateForm("firstName", e.target.value)}
                          placeholder={isChineseMode ? "如護照所示" : "As shown on passport"}
                          className="border-2 border-gray-300 rounded-none"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-bold mb-1 block">
                          {isChineseMode ? "姓氏" : "Last Name"} *
                        </Label>
                        <Input
                          value={form.lastName}
                          onChange={e => updateForm("lastName", e.target.value)}
                          placeholder={isChineseMode ? "如護照所示" : "As shown on passport"}
                          className="border-2 border-gray-300 rounded-none"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {isChineseMode ? "電子郵件" : "Email"} *
                      </Label>
                      <Input
                        type="email"
                        value={form.email}
                        onChange={e => updateForm("email", e.target.value)}
                        className="border-2 border-gray-300 rounded-none"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {isChineseMode ? "電話號碼" : "Phone Number"} *
                      </Label>
                      <Input
                        value={form.phone}
                        onChange={e => updateForm("phone", e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        className="border-2 border-gray-300 rounded-none"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {isChineseMode ? "出生日期" : "Date of Birth"} *
                      </Label>
                      <Input
                        type="date"
                        value={form.dateOfBirth}
                        onChange={e => updateForm("dateOfBirth", e.target.value)}
                        className="border-2 border-gray-300 rounded-none"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {isChineseMode ? "出生地點（選填）" : "Place of Birth (Optional)"}
                      </Label>
                      <Input
                        value={form.placeOfBirth}
                        onChange={e => updateForm("placeOfBirth", e.target.value)}
                        placeholder={isChineseMode ? "城市, 國家" : "City, Country"}
                        className="border-2 border-gray-300 rounded-none"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {isChineseMode ? "旅行目的（選填）" : "Travel Purpose (Optional)"}
                      </Label>
                      <Textarea
                        value={form.travelPurpose}
                        onChange={e => updateForm("travelPurpose", e.target.value)}
                        rows={3}
                        className="border-2 border-gray-300 rounded-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Passport */}
              {currentStep === 3 && (
                <div>
                  <h2 className="text-xl font-bold mb-6">
                    {isChineseMode ? "護照資訊" : "Passport Information"}
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {isChineseMode ? "護照號碼" : "Passport Number"} *
                      </Label>
                      <Input
                        value={form.passportNumber}
                        onChange={e => updateForm("passportNumber", e.target.value.toUpperCase())}
                        placeholder="A12345678"
                        className="border-2 border-gray-300 rounded-none font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {isChineseMode ? "護照到期日" : "Passport Expiry Date"} *
                      </Label>
                      <Input
                        type="date"
                        value={form.passportExpiry}
                        onChange={e => updateForm("passportExpiry", e.target.value)}
                        className="border-2 border-gray-300 rounded-none"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {isChineseMode
                          ? "護照效期需超過 6 個月"
                          : "Passport must be valid for more than 6 months"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {isChineseMode ? "護照國籍" : "Passport Country"} *
                      </Label>
                      <Select
                        value={form.passportCountry}
                        onValueChange={v => updateForm("passportCountry", v)}
                      >
                        <SelectTrigger className="border-2 border-gray-300 rounded-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(countriesQuery.data ?? ["United States", "Canada", "United Kingdom", "Australia", "Other"]).map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 p-4">
                      <div className="flex gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-amber-800">
                          {isChineseMode
                            ? "請確保護照資訊與護照完全一致，任何錯誤可能導致簽證被拒。"
                            : "Please ensure passport information exactly matches your passport. Any discrepancy may result in visa rejection."}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Review */}
              {currentStep === 4 && (
                <div>
                  <h2 className="text-xl font-bold mb-6">
                    {isChineseMode ? "確認申請資訊" : "Review Your Application"}
                  </h2>
                  <div className="space-y-6">
                    <div className="border border-gray-200">
                      <div className="bg-gray-50 px-4 py-2 font-bold text-sm border-b border-gray-200">
                        {isChineseMode ? "簽證資訊" : "Visa Information"}
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            { label: isChineseMode ? "簽證類型" : "Visa Type", value: isChineseMode ? selectedVisaType?.zh : selectedVisaType?.en },
                            { label: isChineseMode ? "入境次數" : "Entry Type", value: isChineseMode ? selectedEntryType?.zh : selectedEntryType?.en },
                            { label: isChineseMode ? "處理速度" : "Processing Speed", value: isChineseMode ? selectedSpeed?.zh : selectedSpeed?.en },
                            { label: isChineseMode ? "申請人數" : "Group Size", value: form.groupSize },
                            ...(form.travelDate ? [{ label: isChineseMode ? "預計出行日期" : "Travel Date", value: form.travelDate }] : []),
                          ].map((row, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="px-4 py-2 text-gray-500 w-1/3">{row.label}</td>
                              <td className="px-4 py-2 font-medium">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="border border-gray-200">
                      <div className="bg-gray-50 px-4 py-2 font-bold text-sm border-b border-gray-200">
                        {isChineseMode ? "個人資訊" : "Personal Information"}
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            { label: isChineseMode ? "姓名" : "Name", value: `${form.firstName} ${form.lastName}` },
                            { label: isChineseMode ? "電子郵件" : "Email", value: form.email },
                            { label: isChineseMode ? "電話" : "Phone", value: form.phone },
                            { label: isChineseMode ? "出生日期" : "Date of Birth", value: form.dateOfBirth },
                          ].map((row, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="px-4 py-2 text-gray-500 w-1/3">{row.label}</td>
                              <td className="px-4 py-2 font-medium">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="border border-gray-200">
                      <div className="bg-gray-50 px-4 py-2 font-bold text-sm border-b border-gray-200">
                        {isChineseMode ? "護照資訊" : "Passport Information"}
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            { label: isChineseMode ? "護照號碼" : "Passport Number", value: form.passportNumber },
                            { label: isChineseMode ? "到期日" : "Expiry Date", value: form.passportExpiry },
                            { label: isChineseMode ? "國籍" : "Country", value: form.passportCountry },
                          ].map((row, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="px-4 py-2 text-gray-500 w-1/3">{row.label}</td>
                              <td className="px-4 py-2 font-medium">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {submitError && (
                      <div className="bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                        {submitError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep(s => s - 1)}
                  className="border-2 border-gray-300 rounded-none"
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  {isChineseMode ? "上一步" : "Back"}
                </Button>

                {currentStep < 4 ? (
                  <Button
                    onClick={() => setCurrentStep(s => s + 1)}
                    className="bg-black text-white hover:bg-gray-800 rounded-none px-8"
                  >
                    {isChineseMode ? "下一步" : "Next"}
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="bg-black text-white hover:bg-gray-800 rounded-none px-8"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {isChineseMode ? "處理中..." : "Processing..."}
                      </>
                    ) : (
                      <>
                        <CreditCard className="mr-2 h-4 w-4" />
                        {isChineseMode ? "前往付款" : "Proceed to Payment"}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Pricing sidebar */}
            <div className="md:col-span-1">
              <div className="sticky top-4 border-2 border-gray-200 p-6">
                <h3 className="font-bold text-sm mb-4 pb-3 border-b border-gray-200">
                  {isChineseMode ? "費用明細" : "Fee Breakdown"}
                </h3>
                {pricing ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">{isChineseMode ? "基本服務費" : "Base Service Fee"}</span>
                      <span>${pricing.breakdown.baseServiceFee}</span>
                    </div>
                    {pricing.breakdown.entryTypeSurcharge > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">{isChineseMode ? "入境次數附加費" : "Entry Type Surcharge"}</span>
                        <span>+${pricing.breakdown.entryTypeSurcharge}</span>
                      </div>
                    )}
                    {pricing.breakdown.processingSpeedSurcharge > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">{isChineseMode ? "加急費用" : "Processing Surcharge"}</span>
                        <span>+${pricing.breakdown.processingSpeedSurcharge}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600">{isChineseMode ? "領事館費用" : "Consulate Fee"}</span>
                      <span>+${pricing.consulateFee}</span>
                    </div>
                    {pricing.discountAmount > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>{isChineseMode ? "折扣" : "Discount"}</span>
                        <span>-${pricing.discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-base pt-3 border-t border-gray-200">
                      <span>{isChineseMode ? "總計" : "Total"}</span>
                      <span>USD ${pricing.totalAmount.toFixed(2)}</span>
                    </div>
                    {pricing.discountType !== "none" && (
                      <div className="bg-green-50 border border-green-200 p-2 text-xs text-green-700">
                        {pricing.breakdown.discountLabel}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-400 text-sm">
                    {isChineseMode ? "計算中..." : "Calculating..."}
                  </div>
                )}

                <div className="mt-6 pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Shield className="h-3 w-3" />
                    <span>{isChineseMode ? "安全 SSL 加密付款" : "Secure SSL encrypted payment"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
