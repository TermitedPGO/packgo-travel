import { useState } from "react";
import { trackVisaStart, trackVisaStep, trackVisaCheckout } from "@/lib/analytics";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import VisaPreCheck from "@/components/visa/VisaPreCheck";
import VisaIdentitySelector from "@/components/visa/VisaIdentitySelector";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/contexts/LocaleContext";
import {
  ChevronRight,
  ChevronLeft,
  CreditCard,
  CheckCircle,
  Clock,
  Shield,
  Users,
  AlertCircle,
  Loader2,
} from "lucide-react";

// ── 簽證類型資料 ──────────────────────────────────────────────
// Round 79: Pack&Go only handles the 10-year multiple-entry tourist visa
// (L tourist, multiple_12m × 10y per CN consulate policy for US passport
// holders). Other visa categories (M business, Q family, S dependent,
// Z work, X student) are out of scope.
const VISA_TYPES = [
  {
    value: "L_tourist_10yr",
    titleKey: "chinaVisaPage.visaTypes.L_tourist10yrTitle",
    descKey: "chinaVisaPage.visaTypes.L_tourist10yrDesc",
  },
];

const ENTRY_TYPES = [
  { value: "multiple_10y", labelKey: "chinaVisaPage.entryTypes.multiple_10y" },
];

const REQUIRED_DOC_KEYS = [
  "chinaVisaPage.docs.doc1",
  "chinaVisaPage.docs.doc2",
  "chinaVisaPage.docs.doc3",
  "chinaVisaPage.docs.doc4",
  "chinaVisaPage.docs.doc5",
  "chinaVisaPage.docs.doc6",
];

const PROCESS_STEP_KEYS = [
  "chinaVisaPage.steps.step1",
  "chinaVisaPage.steps.step2",
  "chinaVisaPage.steps.step3",
  "chinaVisaPage.steps.step4",
  "chinaVisaPage.steps.step5",
];

const FAQ_KEYS: Array<{ q: string; a: string }> = [
  { q: "chinaVisaPage.faqs.q1", a: "chinaVisaPage.faqs.a1" },
  { q: "chinaVisaPage.faqs.q2", a: "chinaVisaPage.faqs.a2" },
  { q: "chinaVisaPage.faqs.q3", a: "chinaVisaPage.faqs.a3" },
  { q: "chinaVisaPage.faqs.q4", a: "chinaVisaPage.faqs.a4" },
  { q: "chinaVisaPage.faqs.q5", a: "chinaVisaPage.faqs.a5" },
];

// ── 主頁面 ────────────────────────────────────────────────────
export default function ChinaVisa() {
  const { t } = useLocale();
  const [currentStep, setCurrentStep] = useState(0); // 0 = landing, 1-5 = wizard steps
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Form state
  const [form, setForm] = useState({
    // Step 1: Visa type
    visaType: "L_tourist_10yr",
    entryType: "multiple_10y",
    travelDate: "",
    travelPurpose: "",
    groupSize: 1,
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

  // Pricing query — simplified flat pricing
  const pricingQuery = trpc.visa.calculatePricing.useQuery({
    groupSize: form.groupSize,
  }, { enabled: currentStep >= 1 });

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

  const goToStep = (step: number) => {
    setCurrentStep(step);
    if (step === 1) trackVisaStart();
    else {
      const names = [
        "",
        t("chinaVisaPage.stepVisaType"),
        t("chinaVisaPage.stepPersonalInfo"),
        t("chinaVisaPage.stepPassportInfo"),
        t("chinaVisaPage.stepReview"),
        t("chinaVisaPage.stepPayment"),
      ];
      trackVisaStep(step, names[step] || `Step ${step}`);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError("");
    trackVisaCheckout({
      applicantCount: form.groupSize,
      totalAmount: pricing ? pricing.grandTotal : 290,
    });
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
      travelDate: form.travelDate || undefined,
      travelPurpose: form.travelPurpose || undefined,
      previousVisits: 0,
      groupSize: form.groupSize,
      isReturningCustomer: false,
    });
  };

  const selectedVisaType = VISA_TYPES.find(v => v.value === form.visaType);
  const selectedEntryType = ENTRY_TYPES.find(e => e.value === form.entryType);

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
                  <div className="inline-block border border-white/30 rounded-md px-3 py-1 text-xs tracking-widest text-white/60 mb-6">
                    {t("chinaVisaPage.eyebrow")}
                  </div>
                  <h1 className="text-4xl md:text-5xl font-serif font-bold mb-6 leading-tight">
                    {t("chinaVisaPage.title")}
                  </h1>
                  <p className="text-gray-400 text-lg mb-8 leading-relaxed">
                    {t("chinaVisaPage.subtitle")}
                  </p>
                  {/* FTC 16 CFR §260.5: removed "15 years experience" and "99% approval rate"
                      claims — no substantiating records on file. */}
                  <div className="flex flex-wrap gap-4 mb-8">
                    {[
                      { icon: <Clock className="h-4 w-4" />, label: t("chinaVisaPage.badgeProcessing") },
                      { icon: <Users className="h-4 w-4" />, label: t("chinaVisaPage.badgeGroup") },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-white/70">
                        {item.icon}
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={() => goToStep(1)}
                    className="bg-white text-black hover:bg-gray-100 px-8 py-3 text-base font-bold rounded-lg"
                  >
                    {t("chinaVisaPage.applyNow")}
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="border border-white/20 rounded-xl p-6 flex flex-col">
                    <div className="text-xs text-white/50 tracking-widest mb-3">{t("chinaVisaPage.individualLabel")}</div>
                    <div className="text-4xl font-bold text-white mb-1">$290</div>
                    <div className="text-sm text-white/60 mb-4">{t("chinaVisaPage.perPersonAllIn")}</div>
                    <ul className="space-y-1.5 text-xs text-white/70">
                      <li>✅ {t("chinaVisaPage.featureConsulateFee")}</li>
                      <li>✅ {t("chinaVisaPage.featurePassportPhoto")}</li>
                      <li>✅ {t("chinaVisaPage.featureFormAssist")}</li>
                      <li>✅ {t("chinaVisaPage.featureCourier")}</li>
                    </ul>
                  </div>
                  <div className="border-2 border-white/60 rounded-xl p-6 flex flex-col bg-white/5">
                    <div className="text-xs text-white/50 tracking-widest mb-3">{t("chinaVisaPage.groupLabel")}</div>
                    <div className="text-4xl font-bold text-white mb-1">$275</div>
                    <div className="text-sm text-white/60 mb-4">{t("chinaVisaPage.perPersonAllIn")}</div>
                    <ul className="space-y-1.5 text-xs text-white/70">
                      <li>✅ {t("chinaVisaPage.featureConsulateFee")}</li>
                      <li>✅ {t("chinaVisaPage.featurePassportPhoto")}</li>
                      <li>✅ {t("chinaVisaPage.featureFormAssist")}</li>
                      <li>✅ {t("chinaVisaPage.featureCourier")}</li>
                    </ul>
                    <div className="mt-3 text-xs text-green-400 font-semibold">{t("chinaVisaPage.savePerPerson")}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Pricing Cards — 2 columns */}
          <section className="py-16 bg-gray-50 border-b border-gray-200">
            <div className="container max-w-4xl mx-auto px-4">
              <h2 className="text-2xl font-serif font-bold mb-2 text-center">
                {t("chinaVisaPage.pricingTitle")}
              </h2>
              <p className="text-center text-gray-500 text-sm mb-10">
                {t("chinaVisaPage.pricingSubtitle")}
              </p>
              <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
                {/* Individual */}
                <div className="border-2 border-gray-200 rounded-xl p-8 flex flex-col">
                  <div className="text-xs text-gray-400 tracking-widest mb-4">{t("chinaVisaPage.individualLabel")}</div>
                  <div className="text-5xl font-bold text-[#1A1A1A] mb-1">$290</div>
                  <div className="text-sm text-gray-500 mb-6">{t("chinaVisaPage.perPerson")}</div>
                  <ul className="space-y-2 text-sm text-gray-700 mb-6">
                    <li className="flex items-center gap-2"><span className="text-green-600">✅</span>{t("chinaVisaPage.featureConsulateFee")}</li>
                    <li className="flex items-center gap-2"><span className="text-green-600">✅</span>{t("chinaVisaPage.featurePassportPhoto")}</li>
                    <li className="flex items-center gap-2"><span className="text-green-600">✅</span>{t("chinaVisaPage.featureFormAssist")}</li>
                    <li className="flex items-center gap-2"><span className="text-green-600">✅</span>{t("chinaVisaPage.featureCourier")}</li>
                  </ul>
                  <Button onClick={() => setCurrentStep(1)} className="bg-[#1A1A1A] text-white hover:bg-gray-800 rounded-lg w-full mt-auto">
                    {t("chinaVisaPage.applyNow")}
                  </Button>
                </div>
                {/* Group */}
                <div className="border-2 border-[#1A1A1A] rounded-xl p-8 flex flex-col relative">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#1A1A1A] text-white rounded-md text-xs px-4 py-1 font-bold tracking-wider">
                    {t("chinaVisaPage.bestValue")}
                  </div>
                  <div className="text-xs text-gray-400 tracking-widest mb-4">{t("chinaVisaPage.groupLabel")}</div>
                  <div className="text-5xl font-bold text-[#1A1A1A] mb-1">$275</div>
                  <div className="text-sm text-gray-500 mb-1">{t("chinaVisaPage.perPerson")}</div>
                  <div className="text-xs text-green-600 font-semibold mb-6">{t("chinaVisaPage.savePerPerson")}</div>
                  <ul className="space-y-2 text-sm text-gray-700 mb-6">
                    <li className="flex items-center gap-2"><span className="text-green-600">✅</span>{t("chinaVisaPage.featureConsulateFee")}</li>
                    <li className="flex items-center gap-2"><span className="text-green-600">✅</span>{t("chinaVisaPage.featurePassportPhoto")}</li>
                    <li className="flex items-center gap-2"><span className="text-green-600">✅</span>{t("chinaVisaPage.featureFormAssist")}</li>
                    <li className="flex items-center gap-2"><span className="text-green-600">✅</span>{t("chinaVisaPage.featureCourier")}</li>
                  </ul>
                  <Button onClick={() => setCurrentStep(1)} className="bg-[#1A1A1A] text-white hover:bg-gray-800 rounded-lg w-full mt-auto">
                    {t("chinaVisaPage.applyNow")}
                  </Button>
                </div>
              </div>
              <p className="text-center text-xs text-gray-400 mt-6">
                {t("chinaVisaPage.pricingFooter")}
              </p>
            </div>
          </section>

          {/* Pre-check (3 conditions per Jeff's SOP) */}
          <VisaPreCheck />

          {/* Identity selector with per-category document checklist (PDF SOP §02) */}
          <VisaIdentitySelector />

          {/* Process Steps */}
          <section className="py-16 border-b border-gray-200">
            <div className="container max-w-3xl mx-auto px-4">
              <h2 className="text-2xl font-serif font-bold mb-8 text-center">
                {t("chinaVisaPage.processTitle")}
              </h2>
              <ol className="space-y-4">
                {PROCESS_STEP_KEYS.map((key, i) => (
                  <li key={i} className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-foreground text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {i + 1}
                    </div>
                    <span className="text-foreground/80 pt-1">{t(key)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* FAQ */}
          <section className="py-16 bg-gray-50 border-b border-gray-200">
            <div className="container max-w-5xl mx-auto px-4">
              <h2 className="text-2xl font-serif font-bold mb-8 text-center">
                {t("chinaVisaPage.faqTitle")}
              </h2>
              <div className="space-y-6 max-w-3xl mx-auto">
                {FAQ_KEYS.map((faq, i) => (
                  <div key={i} className="border-b border-gray-200 pb-6">
                    <h3 className="font-bold text-gray-900 mb-2">
                      {t(faq.q)}
                    </h3>
                    <p className="text-gray-600 text-sm leading-relaxed">
                      {t(faq.a)}
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
                {t("chinaVisaPage.ctaTitle")}
              </h2>
              <p className="text-gray-400 mb-8">
                {t("chinaVisaPage.ctaSubtitle")}
              </p>
              <Button
                onClick={() => setCurrentStep(1)}
                className="bg-white text-black hover:bg-gray-100 px-10 py-3 text-base font-bold rounded-lg"
              >
                {t("chinaVisaPage.ctaButton")}
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
  const stepTitles = [
    t("chinaVisaPage.step1Title"),
    t("chinaVisaPage.step2Title"),
    t("chinaVisaPage.step3Title"),
    t("chinaVisaPage.step4Title"),
    t("chinaVisaPage.stepPayment"),
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <Header />
      <main className="flex-grow">
        {/* Wizard header */}
        <div className="bg-[#1A1A1A] text-white py-8">
          <div className="container max-w-4xl mx-auto px-4">
            <h1 className="text-2xl font-serif font-bold mb-6">
              {t("chinaVisaPage.wizardTitle")}
            </h1>
            {/* Step indicators */}
            <div className="flex items-center gap-0">
              {stepTitles.map((title, i) => (
                <div key={i} className="flex items-center">
                  <div className={`flex items-center gap-2 rounded-md px-3 py-1 text-sm ${
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
                    {t("chinaVisaPage.step1Title")}
                  </h2>

                  <div className="space-y-6">
                    {/* Round 79: only one product (10-year tourist visa). Show as a
                        single confirmed card instead of a dropdown — no choice to make. */}
                    <div>
                      <Label className="text-sm font-bold mb-2 block">
                        {t("chinaVisaPage.visaTypeLabel")}
                      </Label>
                      <div className="rounded-lg border-2 border-foreground bg-foreground text-white p-4">
                        <div className="font-serif font-bold text-base">
                          {t(VISA_TYPES[0].titleKey)}
                        </div>
                        <div className="text-sm mt-1 text-white/80 leading-relaxed">
                          {t(VISA_TYPES[0].descKey)}
                        </div>
                        <div className="mt-3 inline-flex items-center gap-2 text-xs tracking-widest uppercase text-white/60">
                          <span>{t(ENTRY_TYPES[0].labelKey)}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-bold mb-2 block">
                        {t("chinaVisaPage.applicantsLabel")}
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        value={form.groupSize}
                        onChange={e => updateForm("groupSize", parseInt(e.target.value) || 1)}
                        className="w-32 border-2 border-gray-300 rounded-lg"
                      />
                      {form.groupSize >= 2 && (
                        <p className="text-xs text-green-600 mt-1">
                          {t("chinaVisaPage.groupDiscountNote")}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label className="text-sm font-bold mb-2 block">
                        {t("chinaVisaPage.travelDateLabel")}
                      </Label>
                      <Input
                        type="date"
                        value={form.travelDate}
                        onChange={e => updateForm("travelDate", e.target.value)}
                        className="border-2 border-gray-300 rounded-lg"
                      />
                    </div>

                    {/* Returning customer discount removed — flat pricing */}
                  </div>
                </div>
              )}

              {/* Step 2: Personal Info */}
              {currentStep === 2 && (
                <div>
                  <h2 className="text-xl font-bold mb-6">
                    {t("chinaVisaPage.step2Title")}
                  </h2>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-bold mb-1 block">
                          {t("chinaVisaPage.firstName")} *
                        </Label>
                        <Input
                          value={form.firstName}
                          onChange={e => updateForm("firstName", e.target.value)}
                          placeholder={t('common.passportDisplayPlaceholder')}
                          className="border-2 border-gray-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-bold mb-1 block">
                          {t("chinaVisaPage.lastName")} *
                        </Label>
                        <Input
                          value={form.lastName}
                          onChange={e => updateForm("lastName", e.target.value)}
                          placeholder={t('common.passportDisplayPlaceholder')}
                          className="border-2 border-gray-300 rounded-lg"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {t("chinaVisaPage.email")} *
                      </Label>
                      <Input
                        type="email"
                        value={form.email}
                        onChange={e => updateForm("email", e.target.value)}
                        className="border-2 border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {t("chinaVisaPage.phone")} *
                      </Label>
                      <Input
                        value={form.phone}
                        onChange={e => updateForm("phone", e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        className="border-2 border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {t("chinaVisaPage.dob")} *
                      </Label>
                      <Input
                        type="date"
                        value={form.dateOfBirth}
                        onChange={e => updateForm("dateOfBirth", e.target.value)}
                        className="border-2 border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {t("chinaVisaPage.pob")}
                      </Label>
                      <Input
                        value={form.placeOfBirth}
                        onChange={e => updateForm("placeOfBirth", e.target.value)}
                        placeholder={t('common.cityCountryPlaceholder')}
                        className="border-2 border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {t("chinaVisaPage.travelPurpose")}
                      </Label>
                      <Textarea
                        value={form.travelPurpose}
                        onChange={e => updateForm("travelPurpose", e.target.value)}
                        rows={3}
                        className="border-2 border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Passport */}
              {currentStep === 3 && (
                <div>
                  <h2 className="text-xl font-bold mb-6">
                    {t("chinaVisaPage.step3Title")}
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {t("chinaVisaPage.passportNumber")} *
                      </Label>
                      <Input
                        value={form.passportNumber}
                        onChange={e => updateForm("passportNumber", e.target.value.toUpperCase())}
                        placeholder="A12345678"
                        className="border-2 border-gray-300 rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {t("chinaVisaPage.passportExpiry")} *
                      </Label>
                      <Input
                        type="date"
                        value={form.passportExpiry}
                        onChange={e => updateForm("passportExpiry", e.target.value)}
                        className="border-2 border-gray-300 rounded-lg"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {t("chinaVisaPage.passportExpiryNote")}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm font-bold mb-1 block">
                        {t("chinaVisaPage.passportCountry")} *
                      </Label>
                      <Select
                        value={form.passportCountry}
                        onValueChange={v => updateForm("passportCountry", v)}
                      >
                        <SelectTrigger className="border-2 border-gray-300 rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["United States", "Canada", "United Kingdom", "Australia", "Taiwan", "Hong Kong", "Japan", "South Korea", "Germany", "France", "Other"].map((c: string) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <div className="flex gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-amber-800">
                          {t("chinaVisaPage.passportWarning")}
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
                    {t("chinaVisaPage.step4Title")}
                  </h2>
                  <div className="space-y-6">
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 font-bold text-sm border-b border-gray-200">
                        {t("chinaVisaPage.reviewVisaInfo")}
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            { label: t("chinaVisaPage.visaTypeLabel"), value: selectedVisaType ? t(selectedVisaType.titleKey) : "" },
                            { label: t("chinaVisaPage.reviewEntryType"), value: selectedEntryType ? t(selectedEntryType.labelKey) : "" },
                            // Processing speed removed from review
                            { label: t("chinaVisaPage.reviewGroupSize"), value: form.groupSize },
                            ...(form.travelDate ? [{ label: t("chinaVisaPage.reviewTravelDate"), value: form.travelDate }] : []),
                          ].map((row, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="px-4 py-2 text-gray-500 w-1/3">{row.label}</td>
                              <td className="px-4 py-2 font-medium">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 font-bold text-sm border-b border-gray-200">
                        {t("chinaVisaPage.reviewPersonalInfo")}
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            { label: t("chinaVisaPage.reviewName"), value: `${form.firstName} ${form.lastName}` },
                            { label: t("chinaVisaPage.reviewEmail"), value: form.email },
                            { label: t("chinaVisaPage.reviewPhone"), value: form.phone },
                            { label: t("chinaVisaPage.reviewDob"), value: form.dateOfBirth },
                          ].map((row, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="px-4 py-2 text-gray-500 w-1/3">{row.label}</td>
                              <td className="px-4 py-2 font-medium">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 font-bold text-sm border-b border-gray-200">
                        {t("chinaVisaPage.reviewPassportInfo")}
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {[
                            { label: t("chinaVisaPage.reviewPassportNumber"), value: form.passportNumber },
                            { label: t("chinaVisaPage.reviewExpiry"), value: form.passportExpiry },
                            { label: t("chinaVisaPage.reviewCountry"), value: form.passportCountry },
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
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
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
                  className="border-2 border-gray-300 rounded-lg"
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  {t("chinaVisaPage.back")}
                </Button>

                {currentStep < 4 ? (
                  <Button
                    onClick={() => setCurrentStep(s => s + 1)}
                    className="bg-black text-white hover:bg-gray-800 rounded-lg px-8"
                  >
                    {t("chinaVisaPage.next")}
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="bg-black text-white hover:bg-gray-800 rounded-lg px-8"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("chinaVisaPage.processing")}
                      </>
                    ) : (
                      <>
                        <CreditCard className="mr-2 h-4 w-4" />
                        {t("chinaVisaPage.proceedToPayment")}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Pricing sidebar */}
            <div className="md:col-span-1">
              <div className="sticky top-4 border-2 border-gray-200 rounded-xl p-6">
                <h3 className="font-bold text-sm mb-4 pb-3 border-b border-gray-200">
                  {t("chinaVisaPage.feeBreakdown")}
                </h3>
                {pricing ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">
                        {t("chinaVisaPage.feeItemName")}
                      </span>
                      <span>${pricing.pricePerPerson}</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>{t("chinaVisaPage.feeApplicants")}</span>
                      <span>{pricing.groupSize} {t("chinaVisaPage.personLabel")}</span>
                    </div>
                    {pricing.isGroupDiscount && (
                      <div className="text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg p-2">
                        {t("chinaVisaPage.groupRateNote", { amount: String(pricing.savedPerPerson) })}
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-base pt-3 border-t border-gray-200">
                      <span>{t("chinaVisaPage.totalLabel")}</span>
                      <span>USD ${pricing.grandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-400 text-sm">
                    {t("chinaVisaPage.calculating")}
                  </div>
                )}

                <div className="mt-6 pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Shield className="h-3 w-3" />
                    <span>{t("chinaVisaPage.secureSsl")}</span>
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
