import { Link, useLocation } from "wouter";
import { XCircle, RefreshCw, Mail, Phone, Home, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/contexts/LocaleContext";
import SEO from "@/components/SEO";

export default function PaymentFailure() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split("?")[1]);
  const bookingId = searchParams.get("booking_id");
  const error = searchParams.get("error");
  const { t } = useLocale();

  const getErrorMessage = () => {
    if (error === "cancelled") {
      return t('payment.failure.cancelled');
    }
    if (error === "expired") {
      return t('payment.failure.expired');
    }
    return t('payment.failure.description');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <SEO
        title={{ zh: "付款失敗", en: "Payment Failed" }}
        description={{ zh: "PACK&GO 付款失敗頁", en: "PACK&GO payment failure" }}
        url="/payment/failure"
        noindex
      />
      <div className="container max-w-3xl">
        {/* Error Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-lg mb-4">
            <XCircle className="w-12 h-12 text-red-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('payment.failure.title')}</h1>
          <p className="text-gray-600">{getErrorMessage()}</p>
        </div>

        {/* Error Details Card */}
        <Card className="p-8 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">{t('payment.failure.whatHappened')}</h2>
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-900">
                {t('payment.failure.reasons.intro')}
              </p>
              <ul className="list-disc list-inside mt-2 text-sm text-red-800 space-y-1">
                <li>{t('payment.failure.reasons.cardError')}</li>
                <li>{t('payment.failure.reasons.insufficientFunds')}</li>
                <li>{t('payment.failure.reasons.bankDeclined')}</li>
                <li>{t('payment.failure.reasons.networkError')}</li>
                <li>{t('payment.failure.reasons.userCancelled')}</li>
              </ul>
            </div>

            {bookingId && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  <strong>{t('booking.bookingNumber')}：</strong>#{bookingId}
                </p>
                <p className="text-sm text-blue-900 mt-2">
                  {t('payment.failure.bookingSaved')}
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          {bookingId ? (
            <>
              <Button
                variant="default"
                className="flex-1 h-12"
                asChild
              >
                <Link href={`/bookings/${bookingId}`}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t('payment.failure.retryPayment')}
                </Link>
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-12"
                asChild
              >
                <Link href="/tours">
                  {t('tours.title')}
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="default"
                className="flex-1 h-12"
                asChild
              >
                <Link href="/tours">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t('payment.failure.selectAgain')}
                </Link>
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-12"
                asChild
              >
                <Link href="/">
                  <Home className="w-4 h-4 mr-2" />
                  {t('common.backToHome')}
                </Link>
              </Button>
            </>
          )}
        </div>

        {/* Contact Information */}
        <Card className="p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">{t('common.haveMoreQuestions')}</h3>
          <p className="text-gray-600 mb-4">
            {t('payment.failure.contactSupport')}
          </p>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-gray-600" />
              <div>
                <p className="text-sm text-gray-600">{t('contactUs.phone')}</p>
                <p className="font-semibold text-gray-900">+1 (510) 634-2307</p>
                <p className="text-xs text-gray-500">{t('contactUs.weekdays')}：11:30-19:30</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-gray-600" />
              <div>
                <p className="text-sm text-gray-600">{t('contactUs.email')}</p>
                <p className="font-semibold text-gray-900">Jeffhsieh09@gmail.com</p>
                <p className="text-xs text-gray-500">{t('quickInquiry.success.description')}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Tips Card */}
        <Card className="p-6 mt-6 bg-gray-50">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><Lightbulb className="h-5 w-5 text-gray-600" /> {t('payment.failure.tips.title')}</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>{t('payment.failure.tips.checkCard')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>{t('payment.failure.tips.checkLimit')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>{t('payment.failure.tips.checkOverseas')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>{t('payment.failure.tips.stableNetwork')}</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
