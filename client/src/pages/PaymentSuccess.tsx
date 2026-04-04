import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { CheckCircle, Phone, Mail, FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { trackPurchase } from "@/lib/analytics";

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
          <p className="text-gray-600 text-lg">正在載入訂單資訊...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container max-w-2xl">

        {/* ── 成功標題 ── */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-green-100 rounded-full mb-5">
            <CheckCircle className="w-14 h-14 text-green-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">付款成功！</h1>
          <p className="text-xl text-gray-600">
            感謝您的訂購，我們已收到您的付款
          </p>
        </div>

        {/* ── 訂單摘要 ── */}
        {booking ? (
          <>
            {/* 訂單編號大字顯示 */}
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-6 mb-6 text-center">
              <p className="text-base text-green-700 mb-1">您的訂單編號</p>
              <p className="text-5xl font-bold text-green-800 tracking-wider">
                #{booking.id}
              </p>
              <p className="text-sm text-green-600 mt-2">
                請保存此編號，以便日後查詢訂單
              </p>
            </div>

            {/* 訂單詳情 */}
            <Card className="p-8 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 pb-4 border-b border-gray-200">
                訂單詳情
              </h2>

              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center py-2">
                  <span className="text-lg text-gray-600">旅客姓名</span>
                  <span className="text-lg font-semibold text-gray-900">{booking.customerName}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-lg text-gray-600">聯絡電話</span>
                  <span className="text-lg font-semibold text-gray-900">{booking.customerPhone}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-lg text-gray-600">電子郵件</span>
                  <span className="text-lg font-semibold text-gray-900 break-all">{booking.customerEmail}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-lg text-gray-600">旅客人數</span>
                  <span className="text-lg font-semibold text-gray-900">
                    大人 {booking.numberOfAdults} 人
                    {(booking.numberOfChildrenWithBed + booking.numberOfChildrenNoBed) > 0 &&
                      `・小孩 ${booking.numberOfChildrenWithBed + booking.numberOfChildrenNoBed} 人`}
                    {booking.numberOfInfants > 0 && `・嬰兒 ${booking.numberOfInfants} 人`}
                  </span>
                </div>
              </div>

              {/* 付款金額 */}
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">付款明細</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600">訂金（20%）</span>
                    <span className="font-semibold text-gray-900">
                      NT$ {booking.depositAmount?.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600">尾款（出發前繳清）</span>
                    <span className="font-semibold text-gray-900">
                      NT$ {booking.remainingAmount?.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-xl font-bold pt-3 border-t-2 border-gray-300">
                    <span className="text-gray-900">總金額</span>
                    <span className="text-primary">NT$ {booking.totalPrice.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* 確認信提示 */}
              <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-base text-blue-900">
                  <strong>確認信已寄出：</strong>
                  訂單確認信已寄送至 <strong>{booking.customerEmail}</strong>，
                  請查收您的電子郵件（包含垃圾郵件匣）。
                </p>
              </div>
            </Card>

            {/* 操作按鈕 */}
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <Button
                variant="default"
                className="flex-1 h-14 text-lg"
                asChild
              >
                <Link href={`/bookings/${bookingId}`}>
                  <FileText className="w-5 h-5 mr-2" />
                  查看訂單詳情
                </Link>
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-14 text-lg bg-white"
                asChild
              >
                <Link href="/tours">
                  繼續瀏覽行程
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          /* 無 booking 資料時的備用顯示 */
          <Card className="p-8 mb-6 text-center">
            <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">付款已完成</h2>
            <p className="text-gray-600 mb-6">
              您的付款已成功處理。確認信將寄送至您的電子郵件。
            </p>
            <Button asChild className="h-12 text-lg">
              <Link href="/">返回首頁</Link>
            </Button>
          </Card>
        )}

        {/* ── 客服聯絡資訊 ── */}
        <Card className="p-8 bg-white border-2 border-gray-200">
          <h3 className="text-2xl font-bold text-gray-900 mb-6">需要協助？請聯絡我們</h3>
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                <Phone className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-base text-gray-500">客服電話</p>
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
                <p className="text-base text-gray-500">客服信箱</p>
                <a
                  href="mailto:Jeffhsieh09@gmail.com"
                  className="text-xl font-bold text-gray-900 hover:text-primary transition-colors"
                >
                  Jeffhsieh09@gmail.com
                </a>
              </div>
            </div>
          </div>
          <p className="mt-6 text-base text-gray-500 border-t border-gray-200 pt-4">
            服務時間：週一至週五 09:00–18:00（太平洋時間）
          </p>
        </Card>

      </div>
    </div>
  );
}
