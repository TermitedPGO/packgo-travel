import { useState } from "react";
import SEO from "@/components/SEO";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc";
import { quickInquirySchema } from "@/lib/validationSchemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, CheckCircle, Phone, Mail, Clock, Map, Sparkles, Plane, Hotel, FileText, Anchor } from "lucide-react";
import { Link } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLocale } from "@/contexts/LocaleContext";
import type { z } from "zod";

type QuickInquiryForm = z.infer<typeof quickInquirySchema>;

// Round 72: keep `value` in Chinese so DB rows stay stable across existing inquiries;
// labels are pulled from i18n at render time.
const SUBJECT_OPTIONS = [
  { value: "一般詢問", labelKey: "quickInquiry.form.subjects.general" },
  { value: "行程預訂", labelKey: "quickInquiry.form.subjects.booking" },
  { value: "客製旅遊", labelKey: "quickInquiry.form.subjects.customTour" },
  { value: "簽證服務", labelKey: "quickInquiry.form.subjects.visa" },
  { value: "機票預購", labelKey: "quickInquiry.form.subjects.flightBooking" },
  { value: "機場接送", labelKey: "quickInquiry.form.subjects.airportTransfer" },
  { value: "飯店預訂", labelKey: "quickInquiry.form.subjects.hotelBooking" },
  { value: "包團旅遊", labelKey: "quickInquiry.form.subjects.groupTour" },
  { value: "郵輪旅遊", labelKey: "quickInquiry.form.subjects.cruise" },
  { value: "其他問題", labelKey: "quickInquiry.form.subjects.other" },
] as const;

// Quick-pick subject chips (most common ones)
// v78h: chip icons via lucide-react SVG (replaces emoji)
const QUICK_SUBJECTS: { value: string; labelKey: string; icon: React.ElementType }[] = [
  { value: "行程預訂", labelKey: "quickInquiry.form.subjects.booking", icon: Map },
  { value: "客製旅遊", labelKey: "quickInquiry.form.subjects.customTour", icon: Sparkles },
  { value: "機票預購", labelKey: "quickInquiry.form.subjects.flightBooking", icon: Plane },
  { value: "飯店預訂", labelKey: "quickInquiry.form.subjects.hotelBooking", icon: Hotel },
  { value: "簽證服務", labelKey: "quickInquiry.form.subjects.visa", icon: FileText },
  { value: "郵輪旅遊", labelKey: "quickInquiry.form.subjects.cruise", icon: Anchor },
];

export default function QuickInquiry() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [quickSubject, setQuickSubject] = useState("");
  const { t } = useLocale();

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<QuickInquiryForm>({
    resolver: zodResolver(quickInquirySchema),
  });

  const watchedSubject = watch("subject");

  const createInquiry = trpc.inquiries.create.useMutation({
    onSuccess: () => {
      setIsSubmitted(true);
      reset();
      setQuickSubject("");
    },
    onError: (error) => {
      alert(`${t('common.error')}：${error.message}`);
    },
  });

  const onSubmit = (data: QuickInquiryForm) => {
    createInquiry.mutate(data);
  };

  const handleQuickSubject = (value: string) => {
    setQuickSubject(value);
    setValue("subject", value, { shouldValidate: true });
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <SEO
          title={{ zh: "快速諮詢", en: "Quick Inquiry" }}
          description={{
            zh: "快速填寫諮詢表單，PACK&GO 旅遊顧問將在最短時間內回覆您的旅遊需求。",
            en: "Fill out the quick inquiry form and a PACK&GO travel advisor will get back to you as soon as possible.",
          }}
          url="/inquiry"
        />
        <Header />
        <main className="flex-1 flex items-center justify-center py-16 px-4">
          <div className="bg-white shadow-lg p-12 text-center max-w-lg w-full rounded-xl">
            <CheckCircle className="h-20 w-20 text-[#c9a563] mx-auto mb-6" />
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-4">
              {t('quickInquiry.success.title')}
            </h2>
            <p className="text-gray-600 mb-8 text-lg leading-relaxed">
              {t('quickInquiry.success.description')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/">
                <Button size="lg" className="w-full sm:w-auto rounded-lg text-base px-8">
                  {t('common.backToHome')}
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setIsSubmitted(false)}
                className="w-full sm:w-auto rounded-lg text-base px-8"
              >
                {t('quickInquiry.success.submitAgain')}
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <SEO
        title={{ zh: "快速諮詢", en: "Quick Inquiry" }}
        description={{
          zh: "快速填寫諮詢表單，PACK&GO 旅遊顧問將在最短時間內回覆您的旅遊需求。",
          en: "Fill out the quick inquiry form and a PACK&GO travel advisor will get back to you as soon as possible.",
        }}
        url="/inquiry"
      />
      <Header />

      {/* Page Hero */}
      <div className="bg-black text-white py-12 px-4">
        <div className="container max-w-4xl text-center">
          <h1 className="text-4xl md:text-5xl font-serif font-bold mb-3">
            {t('quickInquiry.title')}
          </h1>
          <p className="text-gray-300 text-lg">
            {t('quickInquiry.subtitle')}
          </p>
        </div>
      </div>

      <main className="flex-1 py-12 px-4">
        <div className="container max-w-5xl">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* Left: Contact Info */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-5">{t('quickInquiry.contactInfo')}</h3>
                <div className="space-y-5">
                  <div className="flex items-start gap-4">
                    <div className="bg-black rounded-lg p-2.5 shrink-0">
                      <Phone className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 mb-0.5">{t('quickInquiry.phoneLabel')}</p>
                      <a href="tel:+15106342307" className="text-base font-semibold text-gray-900 hover:text-primary transition-colors">
                        +1 (510) 634-2307
                      </a>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-black rounded-lg p-2.5 shrink-0">
                      <Mail className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 mb-0.5">{t('quickInquiry.emailLabel')}</p>
                      <a href="mailto:support@packgoplay.com" className="text-base font-semibold text-gray-900 hover:text-primary transition-colors break-words">
                        support@packgoplay.com
                      </a>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-black rounded-lg p-2.5 shrink-0">
                      <Clock className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 mb-1">{t('quickInquiry.serviceHoursLabel')}</p>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {t('contactUs.weekdays')}：11:30 - 19:30<br />
                        {t('contactUs.sunday')}：{t('contactUs.closed')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                <p className="text-amber-800 text-sm font-medium mb-1 flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> {t('quickInquiry.tipTitle')}</p>
                <p className="text-amber-700 text-sm leading-relaxed">
                  {t('quickInquiry.tipDesc')}
                </p>
              </div>
            </div>

            {/* Right: Form */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl shadow-sm p-8 border border-gray-100">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">{t('quickInquiry.formTitle')}</h2>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

                  {/* Name + Phone Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <Label htmlFor="customerName" className="text-base font-medium text-gray-700 mb-2 block">
                        {t('quickInquiry.form.name')} <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="customerName"
                        {...register("customerName")}
                        placeholder={t('quickInquiry.form.namePlaceholder')}
                        className="h-12 text-base rounded-lg"
                      />
                      {errors.customerName && (
                        <p className="text-red-500 text-sm mt-1.5">{errors.customerName.message}</p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="customerPhone" className="text-base font-medium text-gray-700 mb-2 block">
                        {t('quickInquiry.form.phone')}
                      </Label>
                      <Input
                        id="customerPhone"
                        {...register("customerPhone")}
                        placeholder={t('quickInquiry.form.phonePlaceholder')}
                        className="h-12 text-base rounded-lg"
                      />
                      {errors.customerPhone && (
                        <p className="text-red-500 text-sm mt-1.5">{errors.customerPhone.message}</p>
                      )}
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <Label htmlFor="customerEmail" className="text-base font-medium text-gray-700 mb-2 block">
                      {t('quickInquiry.form.email')} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      {...register("customerEmail")}
                      placeholder={t('quickInquiry.form.emailPlaceholder')}
                      className="h-12 text-base rounded-lg"
                    />
                    {errors.customerEmail && (
                      <p className="text-red-500 text-sm mt-1.5">{errors.customerEmail.message}</p>
                    )}
                  </div>

                  {/* Subject with Quick-pick chips */}
                  <div>
                    <Label className="text-base font-medium text-gray-700 mb-2 block">
                      {t('quickInquiry.form.subject')} <span className="text-red-500">*</span>
                    </Label>
                    {/* Quick-pick chips */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {QUICK_SUBJECTS.map((s) => {
                        const Icon = s.icon;
                        return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => handleQuickSubject(s.value)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                            (watchedSubject || quickSubject) === s.value
                              ? "border-black bg-black text-white"
                              : "border-gray-300 text-gray-600 hover:border-black hover:text-black bg-white"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{t(s.labelKey)}</span>
                        </button>
                        );
                      })}
                    </div>
                    {/* Full dropdown for all options */}
                    <Controller
                      name="subject"
                      control={control}
                      render={({ field }) => (
                        <Select
                          onValueChange={(v) => {
                            field.onChange(v);
                            setQuickSubject(v);
                          }}
                          value={field.value || quickSubject}
                        >
                          <SelectTrigger className="h-12 text-base rounded-lg">
                            <SelectValue placeholder={t('quickInquiry.form.subjectDropdownPlaceholder')} />
                          </SelectTrigger>
                          <SelectContent>
                            {SUBJECT_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-base py-3">
                                {t(opt.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.subject && (
                      <p className="text-red-500 text-sm mt-1.5">{errors.subject.message}</p>
                    )}
                  </div>

                  {/* Message */}
                  <div>
                    <Label htmlFor="message" className="text-base font-medium text-gray-700 mb-2 block">
                      {t('quickInquiry.form.message')} <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="message"
                      {...register("message")}
                      placeholder={t('quickInquiry.form.messagePlaceholder')}
                      rows={5}
                      className="text-base rounded-lg resize-none"
                    />
                    {errors.message && (
                      <p className="text-red-500 text-sm mt-1.5">{errors.message.message}</p>
                    )}
                  </div>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    disabled={createInquiry.isPending}
                    size="lg"
                    className="w-full h-14 text-lg font-bold rounded-lg"
                  >
                    <MessageSquare className="h-5 w-5 mr-2" />
                    {createInquiry.isPending ? t('quickInquiry.form.submitting') : t('quickInquiry.form.submitButton')}
                  </Button>

                  <p className="text-center text-sm text-gray-400">
                    {t('quickInquiry.footerNote')}
                  </p>
                </form>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
