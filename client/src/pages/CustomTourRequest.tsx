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
import { Plane, Home, CheckCircle, CalendarIcon } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import type { z } from "zod";
import { useLocale } from "@/contexts/LocaleContext";

type CustomTourForm = z.infer<typeof customTourSchema>;

export default function CustomTourRequest() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { t, language } = useLocale();
  const isChineseMode = language === 'zh-TW';
  const dateLocale = isChineseMode ? zhTW : enUS;

  // Quick-pick destinations (inside component for i18n)
  const QUICK_DESTINATIONS = [
    { label: isChineseMode ? "🇯🇵 日本" : "🇯🇵 Japan", value: isChineseMode ? "日本" : "Japan" },
    { label: isChineseMode ? "🇰🇷 韓國" : "🇰🇷 South Korea", value: isChineseMode ? "韓國" : "South Korea" },
    { label: isChineseMode ? "🇹🇭 泰國" : "🇹🇭 Thailand", value: isChineseMode ? "泰國" : "Thailand" },
    { label: isChineseMode ? "🇸🇬 新加坡" : "🇸🇬 Singapore", value: isChineseMode ? "新加坡" : "Singapore" },
    { label: isChineseMode ? "🇪🇺 歐洲" : "🇪🇺 Europe", value: isChineseMode ? "歐洲" : "Europe" },
    { label: isChineseMode ? "🇺🇸 美國" : "🇺🇸 USA", value: isChineseMode ? "美國" : "USA" },
  ];

  // Quick-pick durations
  const QUICK_DURATIONS = [
    { label: isChineseMode ? "3 天" : "3 days", value: 3 },
    { label: isChineseMode ? "5 天" : "5 days", value: 5 },
    { label: isChineseMode ? "7 天" : "7 days", value: 7 },
    { label: isChineseMode ? "10 天" : "10 days", value: 10 },
    { label: isChineseMode ? "14 天" : "14 days", value: 14 },
  ];

  // Quick-pick group sizes
  const QUICK_PEOPLE = [
    { label: isChineseMode ? "1 人" : "1 pax", value: 1 },
    { label: isChineseMode ? "2 人" : "2 pax", value: 2 },
    { label: isChineseMode ? "4 人" : "4 pax", value: 4 },
    { label: isChineseMode ? "6 人" : "6 pax", value: 6 },
    { label: isChineseMode ? "10+ 人" : "10+ pax", value: 10 },
  ];

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<CustomTourForm>({
    resolver: zodResolver(customTourSchema),
  });

  const watchedDestination = watch("destination");
  const watchedDays = watch("numberOfDays");
  const watchedPeople = watch("numberOfPeople");

  const createInquiry = trpc.inquiries.create.useMutation({
    onSuccess: () => {
      setIsSubmitted(true);
      reset();
      setTimeout(() => setIsSubmitted(false), 5000);
    },
    onError: (error) => {
      alert(`${t("customTourRequest.submitError").replace("{message}", error.message)}`);
    },
  });

  const onSubmit = (data: CustomTourForm) => {
    createInquiry.mutate(data);
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12">
      <SEO title="客製行程申請" description="填寫您的旅遊需求，PACK&GO 專業顧問將為您規劃最適合的客製化行程。" url="/custom-tour-request" />
        <div className="container max-w-2xl">
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-6" />
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-4">
              {t("customTourRequest.successTitle2")}
            </h2>
            <p className="text-gray-600 mb-8">
              {t("customTourRequest.successDesc2")}
            </p>
            <div className="flex gap-4 justify-center">
              <Link href="/">
                <Button className="rounded-lg">
                  <Home className="h-4 w-4 mr-2" />
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container max-w-4xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-serif font-bold text-gray-900 mb-2">
              {t("customTourRequest.pageTitle")}
            </h1>
            <p className="text-gray-600">{t("customTourRequest.pageSubtitle")}</p>
          </div>
          <Link href="/">
            <Button variant="outline" className="rounded-lg">
              <Home className="h-4 w-4 mr-2" />
              {t("customTourRequest.backHome")}
            </Button>
          </Link>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white  shadow-lg p-8">
          <div className="space-y-6">
            {/* Personal Info Section */}
            <div className="pb-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {t("customTourRequest.contactSection")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="customerName">{t("customTourRequest.nameRequired")}</Label>
                  <Input
                    id="customerName"
                    {...register("customerName")}
                    placeholder={t("customTourRequest.namePlaceholder")}
                    className="rounded-lg mt-2"
                  />
                  {errors.customerName && (
                    <p className="text-red-500 text-sm mt-1">{errors.customerName.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="customerPhone">{t("customTourRequest.phone")}</Label>
                  <Input
                    id="customerPhone"
                    {...register("customerPhone")}
                    placeholder={t("customTourRequest.phonePlaceholder")}
                    className="rounded-lg mt-2"
                  />
                  {errors.customerPhone && (
                    <p className="text-red-500 text-sm mt-1">{errors.customerPhone.message}</p>
                  )}
                </div>

                <div className="md:col-span-2">
                  <Label htmlFor="customerEmail">{t("customTourRequest.emailRequired")}</Label>
                  <Input
                    id="customerEmail"
                    type="email"
                    {...register("customerEmail")}
                    placeholder="example@email.com"
                    className="rounded-lg mt-2"
                  />
                  {errors.customerEmail && (
                    <p className="text-red-500 text-sm mt-1">{errors.customerEmail.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Travel Details Section */}
            <div className="pb-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {t("customTourRequest.travelSection")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Destination with quick chips */}
                <div>
                  <Label htmlFor="destination">{t("customTourRequest.destinationRequired")}</Label>
                  {/* Quick destination chips */}
                  <div className="flex flex-wrap gap-2 mt-2 mb-2">
                    {QUICK_DESTINATIONS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setValue("destination", d.value, { shouldValidate: true })}
                        className={`px-3 py-1 rounded-full border text-xs font-medium transition-all ${
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
                    <p className="text-red-500 text-sm mt-1">{errors.destination.message}</p>
                  )}
                </div>

                {/* Number of days with quick chips */}
                <div>
                  <Label htmlFor="numberOfDays">{t("customTourRequest.numberOfDays")}</Label>
                  {/* Quick duration chips */}
                  <div className="flex flex-wrap gap-2 mt-2 mb-2">
                    {QUICK_DURATIONS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setValue("numberOfDays", d.value, { shouldValidate: true })}
                        className={`px-3 py-1 rounded-full border text-xs font-medium transition-all ${
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
                    <p className="text-red-500 text-sm mt-1">{errors.numberOfDays.message}</p>
                  )}
                </div>

                {/* Number of people with quick chips */}
                <div>
                  <Label htmlFor="numberOfPeople">{t("customTourRequest.numberOfPeople")}</Label>
                  {/* Quick group size chips */}
                  <div className="flex flex-wrap gap-2 mt-2 mb-2">
                    {QUICK_PEOPLE.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setValue("numberOfPeople", p.value, { shouldValidate: true })}
                        className={`px-3 py-1 rounded-full border text-xs font-medium transition-all ${
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
                    <p className="text-red-500 text-sm mt-1">{errors.numberOfPeople.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="budget">{t("customTourRequest.budget")}</Label>
                  <Input
                    id="budget"
                    type="number"
                    {...register("budget", { valueAsNumber: true })}
                    placeholder={t("customTourRequest.budgetPlaceholder")}
                    className="rounded-lg mt-2"
                  />
                  {errors.budget && (
                    <p className="text-red-500 text-sm mt-1">{errors.budget.message}</p>
                  )}
                </div>

                <div className="md:col-span-2">
                  <Label>{t("customTourRequest.preferredDepartureDate")}</Label>
                  <Controller
                    control={control}
                    name="preferredDepartureDate"
                    render={({ field }) => (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
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
                        <PopoverContent className="w-auto p-0" align="start">
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
                  {errors.preferredDepartureDate && (
                    <p className="text-red-500 text-sm mt-1">
                      {errors.preferredDepartureDate.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Requirements Section */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {t("customTourRequest.requirementSection")}
              </h3>
              <div className="space-y-6">
                <div>
                  <Label htmlFor="subject">{t("customTourRequest.subject")}</Label>
                  <Input
                    id="subject"
                    {...register("subject")}
                    placeholder={t("customTourRequest.subjectPlaceholder")}
                    className="rounded-lg mt-2"
                  />
                  {errors.subject && (
                    <p className="text-red-500 text-sm mt-1">{errors.subject.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="message">{t("customTourRequest.message")}</Label>
                  <Textarea
                    id="message"
                    {...register("message")}
                    placeholder={t("customTourRequest.messagePlaceholder")}
                    rows={8}
                    className=" mt-2"
                  />
                  {errors.message && (
                    <p className="text-red-500 text-sm mt-1">{errors.message.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={createInquiry.isPending}
              className="w-full rounded-lg h-12 text-lg"
            >
              <Plane className="h-5 w-5 mr-2" />
              {createInquiry.isPending
                ? t("customTourRequest.submitPending")
                : t("customTourRequest.submitButton")}
            </Button>
          </div>
        </form>

        {/* Info Box */}
        <div className="mt-8 bg-blue-50  p-6">
          <h3 className="font-semibold text-gray-900 mb-3">
            {t("customTourRequest.serviceTitle")}
          </h3>
          <ul className="space-y-2 text-gray-700 text-sm">
            <li>• {t("customTourRequest.serviceItem1")}</li>
            <li>• {t("customTourRequest.serviceItem2")}</li>
            <li>• {t("customTourRequest.serviceItem3")}</li>
            <li>• {t("customTourRequest.serviceItem4")}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
