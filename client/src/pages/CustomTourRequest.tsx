/**
 * CustomTourRequest — v78j: redesigned as a 4-step wizard.
 *
 * Why: the previous single-page form showed ~10 fields at once. User feedback
 * was "太多問題一次性大家就會放棄" — too many questions at once causes drop-off.
 *
 * New flow (4 small steps + AI shortcut):
 *
 *   Express mode (top): single textarea → AI extracts everything → instant quote
 *   Step 1/4: 您想去哪？(destination + departure date)
 *   Step 2/4: 幾位旅客？(people + days)
 *   Step 3/4: 預算範圍？(budget + travel notes)
 *   Step 4/4: 聯絡方式（提交）
 *
 * Each step shows ONLY 1-2 questions. Progress bar at top.
 */
import { useState } from "react";
import SEO from "@/components/SEO";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc";
import { customTourSchema } from "@/lib/validationSchemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Home,
  CheckCircle,
  CalendarIcon,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Users,
  DollarSign,
  Mail,
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import type { z } from "zod";
import { useLocale } from "@/contexts/LocaleContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { toast } from "sonner";

type CustomTourForm = z.infer<typeof customTourSchema>;

// One step's metadata: title, icon, fields it owns (used for validation gate)
interface StepDef {
  id: number;
  title: string;
  subtitle: string;
  icon: any;
  fields: (keyof CustomTourForm)[];
}

export default function CustomTourRequest() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { t, language, formatPrice } = useLocale();
  const dateLocale = language === "zh-TW" ? zhTW : enUS;

  // Wizard state
  const [step, setStep] = useState(1);

  // Express AI mode toggle
  const [expressMode, setExpressMode] = useState(false);
  const [expressText, setExpressText] = useState("");
  const [expressResult, setExpressResult] = useState<any>(null);

  // Form state
  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
    trigger,
    reset,
  } = useForm<CustomTourForm>({
    resolver: zodResolver(customTourSchema),
    mode: "onTouched",
  });

  const watchedDestination = watch("destination");
  const watchedDays = watch("numberOfDays");
  const watchedPeople = watch("numberOfPeople");
  const watchedBudget = watch("budget");

  // Quick-pick chip data (no emoji per design rule)
  const QUICK_DESTINATIONS = [
    { label: t("customTourRequest.quickDestJapanLabel"), value: t("customTourRequest.quickDestJapanValue") },
    { label: t("customTourRequest.quickDestKoreaLabel"), value: t("customTourRequest.quickDestKoreaValue") },
    { label: t("customTourRequest.quickDestThailandLabel"), value: t("customTourRequest.quickDestThailandValue") },
    { label: t("customTourRequest.quickDestSingaporeLabel"), value: t("customTourRequest.quickDestSingaporeValue") },
    { label: t("customTourRequest.quickDestEuropeLabel"), value: t("customTourRequest.quickDestEuropeValue") },
    { label: t("customTourRequest.quickDestUSALabel"), value: t("customTourRequest.quickDestUSAValue") },
  ];
  const QUICK_DURATIONS = [3, 5, 7, 10, 14].map((v) => ({
    label: `${v}${t("customTourWizard.daySuffix")}`,
    value: v,
  }));
  const QUICK_PEOPLE = [1, 2, 4, 6, 10].map((v) => ({
    label: v >= 10
      ? t("customTourWizard.tenPlus")
      : `${v}${t(v === 1 ? "customTourWizard.adultSingular" : "customTourWizard.adultPlural")}`,
    value: v,
  }));
  // v78o: 預算 chip 用 formatPrice 自動轉換 — 使用者選 USD 自動顯示美金，選 TWD 顯示 NT$
  const QUICK_BUDGETS = [
    { label: formatPrice(50000, "TWD"), value: 50000 },
    { label: formatPrice(100000, "TWD"), value: 100000 },
    { label: formatPrice(150000, "TWD"), value: 150000 },
    { label: formatPrice(250000, "TWD") + "+", value: 250000 },
  ];

  const steps: StepDef[] = [
    {
      id: 1,
      title: t("customTourWizard.step1Title"),
      subtitle: t("customTourWizard.step1Subtitle"),
      icon: MapPin,
      fields: ["destination", "preferredDepartureDate"],
    },
    {
      id: 2,
      title: t("customTourWizard.step2Title"),
      subtitle: t("customTourWizard.step2Subtitle"),
      icon: Users,
      fields: ["numberOfPeople", "numberOfDays"],
    },
    {
      id: 3,
      title: t("customTourWizard.step3Title"),
      subtitle: t("customTourWizard.step3Subtitle"),
      icon: DollarSign,
      fields: ["budget", "subject", "message"],
    },
    {
      id: 4,
      title: t("customTourWizard.step4Title"),
      subtitle: t("customTourWizard.step4Subtitle"),
      icon: Mail,
      fields: ["customerName", "customerEmail", "customerPhone"],
    },
  ];

  const currentStepDef = steps[step - 1];

  const createInquiry = trpc.inquiries.create.useMutation({
    onSuccess: () => {
      setIsSubmitted(true);
      reset();
      setStep(1);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const aiQuoteMutation = trpc.aiQuotes.generate.useMutation({
    onSuccess: (data) => {
      setExpressResult(data);
      toast.success(t("customTourRequest.toastDraftReady"));
    },
    onError: (error) => toast.error(error.message),
  });

  const onSubmit = (data: CustomTourForm) => createInquiry.mutate(data);

  // Validate just the current step's fields before allowing Next
  const goNext = async () => {
    const ok = await trigger(currentStepDef.fields as any);
    if (ok) setStep((s) => Math.min(s + 1, steps.length));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 1));

  // ── SUCCESS STATE ──────────────────────────────────────────────────────
  if (isSubmitted) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <SEO
          title={{ zh: "客製行程申請", en: "Custom Tour Request" }}
          description={{ zh: "已收到您的需求", en: "Request received" }}
          url="/custom-tour-request"
        />
        <Header />
        <main className="flex-grow flex items-center justify-center py-16">
          <div className="container max-w-xl">
            <div className="bg-white rounded-xl shadow-md p-10 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#c9a563]/15 border border-[#c9a563]/35 mb-6">
                <CheckCircle className="h-8 w-8 text-[#c9a563]" />
              </div>
              <h2 className="text-2xl md:text-3xl font-serif font-bold text-gray-900 mb-3">
                {t("customTourRequest.successTitle2")}
              </h2>
              <p className="text-gray-600 mb-8">
                {t("customTourRequest.successDesc2")}
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <Link href="/">
                  <Button className="rounded-lg gap-2">
                    <Home className="h-4 w-4" />
                    {t("customTourRequest.backHome")}
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  onClick={() => setIsSubmitted(false)}
                  className="rounded-lg"
                >
                  {t("customTourRequest.continuePlanning")}
                </Button>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ── EXPRESS MODE — single textarea + AI quote ─────────────────────────
  if (expressMode) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <SEO
          title={{ zh: "AI 一句話報價", en: "AI One-line Quote" }}
          description={{
            zh: "用一句話告訴我們您的旅程偏好，AI 立即報價",
            en: "Describe your trip in one line — get an instant AI quote",
          }}
          url="/custom-tour-request"
        />
        <Header />
        <main className="flex-grow py-12">
          <div className="container max-w-2xl">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#c9a563]/15 border border-[#c9a563]/35 mb-4">
                <Sparkles className="h-7 w-7 text-[#c9a563]" />
              </div>
              <h1 className="text-3xl md:text-4xl font-serif font-bold text-gray-900 mb-2">
                {t("customTourRequest.expressTitle")}
              </h1>
              <p className="text-gray-600">
                {t("customTourRequest.expressSubtitle")}
              </p>
              {/* v78j: honest expectation — AI gives ITINERARY, suppliers give PRICE */}
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg inline-block px-3 py-1.5">
                {t("customTourRequest.expressNote")}
              </p>
              <div className="mt-4">
                <button
                  onClick={() => setExpressMode(false)}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  {t("customTourRequest.expressUseStepByStep")}
                </button>
              </div>
            </div>

            {!expressResult ? (
              <div className="bg-white rounded-xl shadow-md p-6">
                <Textarea
                  rows={6}
                  value={expressText}
                  onChange={(e) => setExpressText(e.target.value)}
                  placeholder={t("customTourRequest.expressPlaceholder")}
                  className="rounded-lg text-base"
                />
                <Button
                  className="w-full mt-4 h-12 rounded-lg gap-2 text-base"
                  disabled={expressText.length < 10 || aiQuoteMutation.isPending}
                  onClick={() =>
                    aiQuoteMutation.mutate({
                      rawRequest: expressText,
                    })
                  }
                >
                  {aiQuoteMutation.isPending ? (
                    t("customTourRequest.expressGenerating")
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {t("customTourRequest.expressGetItinerary")}
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-md p-6">
                <CheckCircle className="h-10 w-10 text-[#c9a563] mb-3" />
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  {t("customTourRequest.draftReadyHeading")}
                </h3>
                <p className="text-gray-600 mb-4">
                  {t("customTourRequest.referenceLabel")}{" "}
                  <span className="font-mono font-semibold">{expressResult.quoteNumber}</span>
                </p>
                {expressResult.matchedTourIds?.length > 0 && (
                  <p className="text-sm text-gray-700 mb-4">
                    {t("customTourRequest.matchedToursFound", { count: String(expressResult.matchedTourIds.length) })}
                  </p>
                )}
                {/* v78j: honest expectation about final pricing */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-900">
                  <p className="font-medium mb-1">
                    {t("customTourRequest.nextStepHeading")}
                  </p>
                  <p className="text-xs text-amber-800">
                    {t("customTourRequest.nextStepBody")}
                  </p>
                </div>
                <div className="flex gap-3 flex-wrap">
                  {expressResult.pdfUrl && (
                    <a
                      href={expressResult.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:opacity-90"
                    >
                      {t("customTourRequest.viewItineraryLink")}
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  )}
                  <Button
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => {
                      setExpressResult(null);
                      setExpressText("");
                    }}
                  >
                    {t("customTourRequest.submitAnother")}
                  </Button>
                  <Link href="/contact-us">
                    <Button variant="outline" className="rounded-lg">
                      {t("common.contactUs")}
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ── WIZARD MODE — step-by-step form ──────────────────────────────────
  const StepIcon = currentStepDef.icon;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Round 80.7: per-page SEO meta tuned for search intent. */}
      <SEO
        title={{
          zh: "客製諮詢｜30 分鐘免費規劃通話｜PACK&GO 旅行社",
          en: "Custom Tour Request | Free 30-min Planning Call | PACK&GO",
        }}
        description={{
          zh: "留下行程偏好，Jeff 親自 30 分鐘免費通話。預算、興趣、家庭組成皆納入規劃。一對一服務，無跟團束縛。",
          en: "Submit preferences and book a free 30-min call with founder Jeff. Budget, interests, family needs all considered. One-on-one, no group pressure.",
        }}
        image="/images/hero-sakura.webp"
        url="/custom-tour-request"
      />
      <Header />
      <main className="flex-grow py-10 md:py-14">
        <div className="container max-w-2xl">
          {/* Express mode toggle */}
          <div className="text-center mb-6">
            <button
              onClick={() => setExpressMode(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#c9a563]/10 border border-[#c9a563]/35 text-[#8a6f3a] text-sm font-medium hover:bg-[#c9a563]/15 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {t("customTourRequest.aiDraftCta")}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-gray-900 mb-2">
              {t("customTourRequest.pageTitle")}
            </h1>
            <p className="text-gray-600">
              {t("customTourRequest.pageSubtitle")}
            </p>
          </div>

          {/* Progress bar */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold tracking-wide uppercase text-gray-500">
                {t("customTourRequest.stepIndicator", { step: String(step), total: String(steps.length) })}
              </p>
              <p className="text-xs text-gray-500">
                {Math.round((step / steps.length) * 100)}%
              </p>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(step / steps.length) * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-2 mt-4">
              {steps.map((s, i) => {
                const Icon = s.icon;
                const isActive = i + 1 === step;
                const isDone = i + 1 < step;
                return (
                  <div
                    key={s.id}
                    className="flex-1 flex items-center justify-center"
                  >
                    <div
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
                        isActive
                          ? "text-primary"
                          : isDone
                          ? "text-gray-700"
                          : "text-gray-300"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline text-xs font-medium">{s.title}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step Card */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="bg-white rounded-xl shadow-md p-6 md:p-8 mb-6 animate-in fade-in duration-300">
              <div className="flex items-start gap-3 mb-6">
                <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <StepIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{currentStepDef.title}</h2>
                  <p className="text-sm text-gray-500">{currentStepDef.subtitle}</p>
                </div>
              </div>

              {/* STEP 1 — destination + date */}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <Label htmlFor="destination">
                      {t("customTourRequest.destinationRequired")} <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex flex-wrap gap-2 mt-2 mb-3">
                      {QUICK_DESTINATIONS.map((d) => (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => setValue("destination", d.value, { shouldValidate: true })}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                            watchedDestination === d.value
                              ? "border-black bg-black text-white"
                              : "border-gray-300 text-gray-600 hover:border-black hover:text-black bg-white"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <Input
                      id="destination"
                      {...register("destination")}
                      placeholder={t("customTourRequest.destinationPlaceholder")}
                      className="rounded-lg"
                    />
                    {errors.destination && (
                      <p className="text-red-500 text-sm mt-1">{errors.destination.message as string}</p>
                    )}
                  </div>

                  <div>
                    <Label>
                      {t("customTourRequest.preferredDepartureDate")} <span className="text-gray-400 text-xs">({t("common.optional")})</span>
                    </Label>
                    <Controller
                      control={control}
                      name="preferredDepartureDate"
                      render={({ field }) => (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full rounded-lg mt-2 justify-start text-left font-normal"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? (
                                format(field.value, "PPP", { locale: dateLocale })
                              ) : (
                                <span className="text-gray-500">
                                  {t("customTourRequest.selectDate")}
                                </span>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 rounded-xl" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      )}
                    />
                  </div>
                </div>
              )}

              {/* STEP 2 — people + days */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <Label htmlFor="numberOfPeople">
                      {t("customTourRequest.numberOfPeople")} <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex flex-wrap gap-2 mt-2 mb-3">
                      {QUICK_PEOPLE.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setValue("numberOfPeople", p.value, { shouldValidate: true })}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                            watchedPeople === p.value
                              ? "border-black bg-black text-white"
                              : "border-gray-300 text-gray-600 hover:border-black hover:text-black bg-white"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <Input
                      id="numberOfPeople"
                      type="number"
                      {...register("numberOfPeople", { valueAsNumber: true })}
                      placeholder={t("customTourRequest.numberOfPeoplePlaceholder")}
                      className="rounded-lg"
                    />
                    {errors.numberOfPeople && (
                      <p className="text-red-500 text-sm mt-1">{errors.numberOfPeople.message as string}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="numberOfDays">
                      {t("customTourRequest.numberOfDays")} <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex flex-wrap gap-2 mt-2 mb-3">
                      {QUICK_DURATIONS.map((d) => (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => setValue("numberOfDays", d.value, { shouldValidate: true })}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                            watchedDays === d.value
                              ? "border-black bg-black text-white"
                              : "border-gray-300 text-gray-600 hover:border-black hover:text-black bg-white"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <Input
                      id="numberOfDays"
                      type="number"
                      {...register("numberOfDays", { valueAsNumber: true })}
                      placeholder={t("customTourRequest.numberOfDaysPlaceholder")}
                      className="rounded-lg"
                    />
                    {errors.numberOfDays && (
                      <p className="text-red-500 text-sm mt-1">{errors.numberOfDays.message as string}</p>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3 — budget + notes */}
              {step === 3 && (
                <div className="space-y-5">
                  <div>
                    <Label htmlFor="budget">
                      {t("customTourRequest.budget")} <span className="text-gray-400 text-xs">({t("common.optional")})</span>
                    </Label>
                    <div className="flex flex-wrap gap-2 mt-2 mb-3">
                      {QUICK_BUDGETS.map((b) => (
                        <button
                          key={b.value}
                          type="button"
                          onClick={() => setValue("budget", b.value, { shouldValidate: true })}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                            watchedBudget === b.value
                              ? "border-black bg-black text-white"
                              : "border-gray-300 text-gray-600 hover:border-black hover:text-black bg-white"
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                    <Input
                      id="budget"
                      type="number"
                      {...register("budget", { valueAsNumber: true })}
                      placeholder={t("customTourRequest.budgetPlaceholder")}
                      className="rounded-lg"
                    />
                  </div>

                  <div>
                    <Label htmlFor="message">
                      {t("customTourRequest.message")} <span className="text-gray-400 text-xs">({t("common.optional")})</span>
                    </Label>
                    <Textarea
                      id="message"
                      {...register("message")}
                      placeholder={t("customTourRequest.notePlaceholder")}
                      rows={4}
                      className="rounded-lg mt-2"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4 — contact */}
              {step === 4 && (
                <div className="space-y-5">
                  <div>
                    <Label htmlFor="customerName">
                      {t("customTourRequest.nameRequired")} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="customerName"
                      {...register("customerName")}
                      placeholder={t("customTourRequest.namePlaceholder")}
                      className="rounded-lg mt-2"
                    />
                    {errors.customerName && (
                      <p className="text-red-500 text-sm mt-1">{errors.customerName.message as string}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="customerEmail">
                      {t("customTourRequest.emailRequired")} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      {...register("customerEmail")}
                      placeholder="example@email.com"
                      className="rounded-lg mt-2"
                    />
                    {errors.customerEmail && (
                      <p className="text-red-500 text-sm mt-1">{errors.customerEmail.message as string}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="customerPhone">
                      {t("customTourRequest.phone")} <span className="text-gray-400 text-xs">({t("common.optional")})</span>
                    </Label>
                    <Input
                      id="customerPhone"
                      {...register("customerPhone")}
                      placeholder={t("customTourRequest.phonePlaceholder")}
                      className="rounded-lg mt-2"
                    />
                  </div>

                  {/* Hidden subject field — auto-filled */}
                  <input
                    type="hidden"
                    {...register("subject")}
                    value={
                      watchedDestination
                        ? `${watchedDestination}${watchedDays ? ` ${watchedDays}天` : ""}${watchedPeople ? ` ${watchedPeople}人` : ""}`
                        : t("customTourRequest.subjectAutoFallback")
                    }
                  />
                </div>
              )}
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={step === 1}
                onClick={goBack}
                className="rounded-lg gap-1"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("customTourRequest.wizardBack")}
              </Button>

              {step < steps.length ? (
                <Button type="button" onClick={goNext} className="rounded-lg gap-1 px-6">
                  {t("customTourRequest.wizardNext")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={createInquiry.isPending}
                  className="rounded-lg px-6 gap-1"
                >
                  {createInquiry.isPending ? (
                    t("customTourRequest.submitting")
                  ) : (
                    <>
                      {t("customTourRequest.submitRequestBtn")}
                      <CheckCircle className="h-4 w-4" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}
