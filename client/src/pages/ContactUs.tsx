import { useState } from "react";
import GenericPage from "@/components/GenericPage";
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
import { MessageSquare, Phone, Mail, MapPin, Clock, CheckCircle } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type { z } from "zod";

type QuickInquiryForm = z.infer<typeof quickInquirySchema>;

const SUBJECT_OPTIONS = [
  { value: "一般詢問", label: "一般詢問" },
  { value: "行程預訂", label: "行程預訂" },
  { value: "客製旅遊", label: "客製旅遊" },
  { value: "簽證服務", label: "簽證服務" },
  { value: "機票預購", label: "機票預購" },
  { value: "機場接送", label: "機場接送" },
  { value: "飯店預訂", label: "飯店預訂" },
  { value: "包團旅遊", label: "包團旅遊" },
  { value: "郵輪旅遊", label: "郵輪旅遊" },
  { value: "其他問題", label: "其他問題" },
];

const QUICK_SUBJECTS = [
  { value: "行程預訂", emoji: "🗺️" },
  { value: "客製旅遊", emoji: "✨" },
  { value: "機票預購", emoji: "✈️" },
  { value: "飯店預訂", emoji: "🏨" },
  { value: "簽證服務", emoji: "📋" },
  { value: "郵輪旅遊", emoji: "🚢" },
];

export default function ContactUs() {
  const { t } = useLocale();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [quickSubject, setQuickSubject] = useState("");

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
      alert(`送出失敗：${error.message}`);
    },
  });

  const onSubmit = (data: QuickInquiryForm) => {
    createInquiry.mutate(data);
  };

  const handleQuickSubject = (value: string) => {
    setQuickSubject(value);
    setValue("subject", value, { shouldValidate: true });
  };

  return (
    <GenericPage
      title={t('contactUs.title')}
      subtitle={t('contactUs.subtitle')}
    >
      <SEO title="聯絡我們" description="聯絡 PACK&GO 旅行社，我們的旅遊顧問將盡快回覆您的詢問。" url="/contact-us" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 mt-4">

        {/* Left: Contact Info */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 mb-5">聯絡資訊</h3>
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="bg-black rounded-lg p-2.5 shrink-0">
                  <MapPin className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-0.5">{t('contactUs.address')}</p>
                  <p className="text-sm font-medium text-gray-800 leading-relaxed">
                    39055 Cedar Blvd #126<br />Newark CA 94560
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="bg-black rounded-lg p-2.5 shrink-0">
                  <Phone className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-0.5">{t('contactUs.phone')}</p>
                  <a href="tel:+15106342307" className="text-sm font-semibold text-gray-900 hover:text-primary transition-colors">
                    +1 (510) 634-2307
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="bg-black rounded-lg p-2.5 shrink-0">
                  <Mail className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-0.5">{t('contactUs.email')}</p>
                  <a href="mailto:Jeffhsieh09@gmail.com" className="text-sm font-semibold text-gray-900 hover:text-primary transition-colors break-words">
                    Jeffhsieh09@gmail.com
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="bg-black rounded-lg p-2.5 shrink-0">
                  <Clock className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">{t('contactUs.businessHours')}</p>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {t('contactUs.weekdays')}：11:30 - 19:30<br />
                    {t('contactUs.sunday')}：{t('contactUs.closed')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-amber-800 text-sm font-semibold mb-1 flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> 快速回覆</p>
            <p className="text-amber-700 text-sm leading-relaxed">
              填寫右側表單後，我們的旅遊顧問將在 24 小時內以電子郵件回覆您。
            </p>
          </div>
        </div>

        {/* Right: Inline Form */}
        <div className="lg:col-span-2">
          {isSubmitted ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-gray-900 mb-3">諮詢已送出！</h3>
              <p className="text-gray-600 mb-6">感謝您的詢問，我們將在 24 小時內回覆您。</p>
              <Button onClick={() => setIsSubmitted(false)} size="lg" className="rounded-lg px-8">
                再次諮詢
              </Button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-6">填寫諮詢表單</h2>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <Label htmlFor="customerName" className="text-sm font-medium text-gray-700 mb-1.5 block">
                      姓名 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="customerName"
                      {...register("customerName")}
                      placeholder="請輸入您的姓名"
                      className="h-11 rounded-lg"
                    />
                    {errors.customerName && (
                      <p className="text-red-500 text-xs mt-1">{errors.customerName.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="customerPhone" className="text-sm font-medium text-gray-700 mb-1.5 block">
                      電話
                    </Label>
                    <Input
                      id="customerPhone"
                      {...register("customerPhone")}
                      placeholder="請輸入您的電話"
                      className="h-11 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="customerEmail" className="text-sm font-medium text-gray-700 mb-1.5 block">
                    電子郵件 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="customerEmail"
                    type="email"
                    {...register("customerEmail")}
                    placeholder="請輸入您的電子郵件"
                    className="h-11 rounded-lg"
                  />
                  {errors.customerEmail && (
                    <p className="text-red-500 text-xs mt-1">{errors.customerEmail.message}</p>
                  )}
                </div>

                {/* Subject with Quick-pick chips */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    諮詢主題 <span className="text-red-500">*</span>
                  </Label>
                  {/* Quick-pick chips */}
                  <div className="flex flex-wrap gap-2 mb-2.5">
                    {QUICK_SUBJECTS.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => handleQuickSubject(s.value)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                          (watchedSubject || quickSubject) === s.value
                            ? "border-black bg-black text-white"
                            : "border-gray-300 text-gray-600 hover:border-black hover:text-black bg-white"
                        }`}
                      >
                        <span>{s.emoji}</span>
                        <span>{s.value}</span>
                      </button>
                    ))}
                  </div>
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
                        <SelectTrigger className="h-11 rounded-lg">
                          <SelectValue placeholder="或從下拉選單選擇..." />
                        </SelectTrigger>
                        <SelectContent>
                          {SUBJECT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="py-2.5">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.subject && (
                    <p className="text-red-500 text-xs mt-1">{errors.subject.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="message" className="text-sm font-medium text-gray-700 mb-1.5 block">
                    詢問內容 <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="message"
                    {...register("message")}
                    placeholder="請詳細描述您的旅遊需求或問題..."
                    rows={5}
                    className="rounded-lg resize-none"
                  />
                  {errors.message && (
                    <p className="text-red-500 text-xs mt-1">{errors.message.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={createInquiry.isPending}
                  size="lg"
                  className="w-full h-12 text-base font-bold rounded-lg"
                >
                  <MessageSquare className="h-5 w-5 mr-2" />
                  {createInquiry.isPending ? '送出中...' : '送出諮詢'}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </GenericPage>
  );
}
