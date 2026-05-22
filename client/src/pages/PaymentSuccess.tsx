import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { CheckCircle, Phone, Mail, FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { trackPurchase } from "@/lib/analytics";
import SEO from "@/components/SEO";

export default function PaymentSuccess() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split("?")[1]);
  const bookingId = searchParams.get("booking_id");
  const { t } = useLocale();

  const { data: booking, isLoading } = trpc.bookings.getById.useQuery(
    { id: Number(bookingId) },
    { enabled: !!bookingId }
  );

  // GA4: purchase conversion event (fires once when booking data loads)
  useEffect(() => {
    if (booking) {
      trackPurchase({
        orderId: booking.id,
        tourId: (booking as any).tourId ?? 0,
        tourName: (booking as any).tourTitle ?? (booking as any).tour?.title ?? "Tour",
        value: booking.totalPrice ?? 0,
        currency: "TWD",
        numTravelers:
          (booking.numberOfAdults ?? 0) +
          (booking.numberOfChildrenWithBed ?? 0) +
          (booking.numberOfChildrenNoBed ?? 0) +
          (booking.numberOfInfants ?? 0),
      });
    }
  }, [booking?.id]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-14 w-14 border-b-4 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">{t("paymentSuccess.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <SEO
        title={{ zh: "付款成功", en: "Payment Successful" }}
        description={{ zh: "PACK&GO 付款確認頁", en: "PACK&GO payment confirmation" }}
        url="/payment/success"
        noindex
      />
      <div className="container max-w-2xl">

        {/* Success header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-[#c9a563]/10 rounded-full mb-5">
            <CheckCircle className="w-14 h-14 text-[#c9a563]" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">{t("paymentSuccess.successTitle")}</h1>
          <p className="text-xl text-gray-600">
            {t("paymentSuccess.thankYou")}
          </p>
        </div>

        {/* Order summary */}
        {booking ? (
          <>
            {/* Order number callout */}
            <div className="bg-[#c9a563]/10 border-2 border-[#c9a563]/35 rounded-xl p-6 mb-6 text-center">
              <p className="text-base text-[#8a6f3a] mb-1">{t("paymentSuccess.orderNumberLabel")}</p>
              <p className="text-5xl font-bold text-foreground tracking-wider">
                #{booking.id}
              </p>
              <p className="text-sm text-[#8a6f3a] mt-2">
                {t("paymentSuccess.saveNumberNote")}
              </p>
            </div>

            {/* Order details */}
            <Card className="p-8 mb-6 rounded-xl">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 pb-4 border-b border-gray-200">
                {t("paymentSuccess.orderDetails")}
              </h2>

              {/* v78w: Tour summary at top — was missing despite data being available.
                  Customer needs to see "what they bought" prominently before contact info. */}
              {((booking as any).tourTitle || (booking as any).tour?.title) && (
                <div className="mb-6 p-4 rounded-xl bg-[#c9a563]/10 border border-[#c9a563]/35">
                  <p className="text-xs uppercase tracking-wider text-[#8a6f3a] font-semibold mb-1">
                    {t("paymentSuccess.tourLabel")}
                  </p>
                  <p className="text-lg md:text-xl font-bold text-gray-900 leading-snug mb-2">
                    {((booking as any).tourTitle || (booking as any).tour?.title || "").split(/[|｜]/)[0].trim()}
                  </p>
                  {(booking as any).departureDate && (
                    <p className="text-sm text-gray-700 flex items-center gap-2">
                      <svg className="h-4 w-4 text-[#8a6f3a]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <strong>{t("paymentSuccess.departureLabel")}:</strong>{" "}
                      {new Date((booking as any).departureDate).toLocaleDateString(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (booking as any).language === "en" ? "en-US" : "zh-TW",
                        { year: "numeric", month: "long", day: "numeric" }
                      )}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center py-2">
                  <span className="text-lg text-gray-600">{t("paymentSuccess.customerName")}</span>
                  <span className="text-lg font-semibold text-gray-900">{booking.customerName}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-lg text-gray-600">{t("paymentSuccess.customerPhone")}</span>
                  <span className="text-lg font-semibold text-gray-900">{booking.customerPhone}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-lg text-gray-600">{t("paymentSuccess.customerEmail")}</span>
                  <span className="text-lg font-semibold text-gray-900 break-all">{booking.customerEmail}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-lg text-gray-600">{t("paymentSuccess.travelerCount")}</span>
                  <span className="text-lg font-semibold text-gray-900">
                    {t("paymentSuccess.adultsWithCount", { count: String(booking.numberOfAdults) })}
                    {(booking.numberOfChildrenWithBed + booking.numberOfChildrenNoBed) > 0 &&
                      t("paymentSuccess.childrenSuffix", {
                        count: String(booking.numberOfChildrenWithBed + booking.numberOfChildrenNoBed),
                      })}
                    {booking.numberOfInfants > 0 &&
                      t("paymentSuccess.infantsSuffix", { count: String(booking.numberOfInfants) })}
                  </span>
                </div>
              </div>

              {/* Payment breakdown */}
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">{t("paymentSuccess.paymentBreakdown")}</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600">{t("paymentSuccess.deposit20")}</span>
                    <span className="font-semibold text-gray-900">
                      NT$ {booking.depositAmount?.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600">{t("paymentSuccess.remainingPayment")}</span>
                    <span className="font-semibold text-gray-900">
                      NT$ {booking.remainingAmount?.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-xl font-bold pt-3 border-t-2 border-gray-300">
                    <span className="text-gray-900">{t("paymentSuccess.totalAmount")}</span>
                    <span className="text-primary">NT$ {booking.totalPrice.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* v78w: "What happens next" — concrete timeline replaces vague "email sent" */}
              <div className="mt-6 bg-foreground/[0.04] border border-foreground/15 rounded-xl p-5">
                <h3 className="font-bold text-foreground mb-3">
                  {t("paymentSuccess.whatNextTitle")}
                </h3>
                <ol className="space-y-2.5 text-sm text-foreground/80">
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-foreground text-white text-xs font-bold">1</span>
                    <span>
                      <strong>{t("paymentSuccess.confirmationSentLabel")}</strong>{" "}
                      {t("paymentSuccess.confirmationSentBody", { email: booking.customerEmail })}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-foreground text-white text-xs font-bold">2</span>
                    <span>{t("paymentSuccess.nextStep2")}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-foreground text-white text-xs font-bold">3</span>
                    <span>{t("paymentSuccess.nextStep3") || "30 days before departure, we'll send pre-trip preparation reminders (visa, packing, contact info)."}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-foreground text-white text-xs font-bold">4</span>
                    <span>{t("paymentSuccess.nextStep4")}</span>
                  </li>
                </ol>
              </div>
            </Card>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <Button
                variant="default"
                className="flex-1 h-14 text-lg rounded-lg"
                asChild
              >
                <Link href={`/bookings/${bookingId}`}>
                  <FileText className="w-5 h-5 mr-2" />
                  {t("paymentSuccess.viewOrder")}
                </Link>
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-14 text-lg bg-white rounded-lg"
                asChild
              >
                <Link href="/tours">
                  {t("paymentSuccess.continueBrowsing")}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          /* Fallback when booking data is unavailable */
          <Card className="p-8 mb-6 text-center rounded-xl">
            <CheckCircle className="w-16 h-16 text-[#c9a563] mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{t("paymentSuccess.paymentCompleted")}</h2>
            <p className="text-gray-600 mb-6">
              {t("paymentSuccess.paymentProcessed")}
            </p>
            <Button asChild className="h-12 text-lg rounded-lg">
              <Link href="/">{t("paymentSuccess.backToHome")}</Link>
            </Button>
          </Card>
        )}

        {/* Customer service contact */}
        <Card className="p-8 bg-white border-2 border-gray-200 rounded-xl">
          <h3 className="text-2xl font-bold text-gray-900 mb-6">{t("paymentSuccess.needHelp")}</h3>
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                <Phone className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-base text-gray-500">{t("paymentSuccess.customerServicePhone")}</p>
                <a
                  href="tel:+15106342307"
                  className="text-2xl font-bold text-gray-900 hover:text-primary transition-colors"
                >
                  +1 (510) 634-2307
                </a>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                <Mail className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-base text-gray-500">{t("paymentSuccess.customerServiceEmail")}</p>
                <a
                  href="mailto:support@packgoplay.com"
                  className="text-xl font-bold text-gray-900 hover:text-primary transition-colors"
                >
                  support@packgoplay.com
                </a>
              </div>
            </div>
          </div>
          <p className="mt-6 text-base text-gray-500 border-t border-gray-200 pt-4">
            {t("paymentSuccess.serviceHours")}
          </p>
        </Card>

      </div>
    </div>
  );
}
