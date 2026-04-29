import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Loader2, 
  ArrowLeft,
  CheckCircle2,
  XCircle,
  CreditCard,
  User,
  Mail,
  Phone
} from "lucide-react";
import { useParams, useLocation } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useLocale } from "@/contexts/LocaleContext";

export default function BookingDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { t } = useLocale();
  const bookingId = params.id ? parseInt(params.id) : 0;

  const { data: booking, isLoading, refetch } = trpc.bookings.getById.useQuery(
    { id: bookingId },
    { enabled: !!bookingId && !!user }
  );

  const createCheckoutMutation = trpc.bookings.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      toast.success(t('bookingDetail.redirectingToPayment'));
      if (data.url) {
        window.open(data.url, "_blank");
      }
      // Refetch booking data after a delay to update payment status
      setTimeout(() => {
        refetch();
      }, 3000);
    },
    onError: (error) => {
      toast.error(t('bookingDetail.createCheckoutFailed'), {
        description: error.message,
      });
    },
  });

  // v78w: Wire up cancel-booking endpoint that already exists server-side.
  // Triggers an unrefundable warning prompt before calling the mutation.
  const cancelMutation = trpc.bookings.cancel.useMutation({
    onSuccess: () => {
      toast.success(t('bookingDetail.cancelSuccess') || "Booking cancelled. Refund (if eligible) processed within 1 week.");
      refetch();
    },
    onError: (error) => {
      toast.error(t('bookingDetail.cancelFailed') || "Failed to cancel booking", {
        description: error.message,
      });
    },
  });

  const handleCancelBooking = () => {
    const confirmMsg = t('bookingDetail.cancelConfirm') ||
      "Are you sure you want to cancel this booking?\n\nRefund eligibility depends on time-to-departure and tour cancellation policy. We'll review and email you within 1 week.";
    if (window.confirm(confirmMsg)) {
      cancelMutation.mutate({ id: bookingId });
    }
  };

  const handlePayment = (paymentType: "deposit" | "balance" | "full") => {
    if (!user) {
      toast.error(t('bookingDetail.loginRequiredToast'));
      window.location.href = getLoginUrl();
      return;
    }

    // Convert payment type to API format
    const apiPaymentType = paymentType === "balance" || paymentType === "full" ? "remaining" : "deposit";

    createCheckoutMutation.mutate({
      bookingId,
      paymentType: apiPaymentType,
    });
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-grow flex items-center justify-center bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-black" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-grow flex items-center justify-center bg-white">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-black mb-4">{t('bookingDetail.loginRequired')}</h2>
            <Button onClick={() => window.location.href = getLoginUrl()} className="bg-black hover:bg-gray-800 text-white">
              {t('bookingDetail.goToLogin')}
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-grow flex items-center justify-center bg-white">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-black mb-4">{t('bookingDetail.bookingNotFound')}</h2>
            <Button onClick={() => navigate("/profile")} className="bg-black hover:bg-gray-800 text-white">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t('bookingDetail.backToProfile2')}
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: t('bookingDetail.statusPending'), className: "bg-yellow-100 text-yellow-800 border-yellow-300" },
      confirmed: { label: t('bookingDetail.statusConfirmed'), className: "bg-blue-100 text-blue-800 border-blue-300" },
      cancelled: { label: t('bookingDetail.statusCancelled'), className: "bg-red-100 text-red-800 border-red-300" },
      completed: { label: t('bookingDetail.statusCompleted'), className: "bg-green-100 text-green-800 border-green-300" },
    };
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    return <Badge className={`${config.className} border`}>{config.label}</Badge>;
  };

  // Calculate amounts
  const totalAmount = booking.totalPrice;
  const depositAmount = booking.depositAmount;
  const balanceAmount = booking.remainingAmount;
  const paidAmount = booking.paymentStatus === 'unpaid' ? 0 : 
                     booking.paymentStatus === 'deposit' ? depositAmount : 
                     booking.paymentStatus === 'paid' ? totalAmount : 0;

  const getPaymentStatusBadge = (status: string) => {
    const statusConfig = {
      unpaid: { label: t('bookingDetail.paymentUnpaid'), className: "bg-gray-100 text-gray-800 border-gray-300", icon: Clock },
      deposit: { label: t('bookingDetail.paymentDeposit'), className: "bg-blue-100 text-blue-800 border-blue-300", icon: CheckCircle2 },
      paid: { label: t('bookingDetail.paymentPaid'), className: "bg-green-100 text-green-800 border-green-300", icon: CheckCircle2 },
      refunded: { label: t('bookingDetail.paymentRefunded'), className: "bg-red-100 text-red-800 border-red-300", icon: XCircle },
    };
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.unpaid;
    const Icon = config.icon;
    return (
      <Badge className={`${config.className} border flex items-center gap-1`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const canPayDeposit = booking.paymentStatus === "unpaid";
  const canPayBalance = booking.paymentStatus === "deposit";
  const isFullyPaid = booking.paymentStatus === "paid";

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />
      
      <main className="flex-grow container py-12">
        <Button 
          variant="outline" 
          onClick={() => navigate("/profile")}
          className="mb-6 border-2 border-black  hover:bg-black hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('bookingDetail.backToProfile2')}
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Booking Header */}
            <Card className="border-2 border-black ">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-2xl mb-2">{t('bookingDetail.bookingIdLabel')}{booking.id}</CardTitle>
                    <p className="text-sm text-gray-600">
                      {t('bookingDetail.createdAt')}{new Date(booking.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {getStatusBadge(booking.bookingStatus)}
                    {getPaymentStatusBadge(booking.paymentStatus)}
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Tour Information */}
            <Card className="border-2 border-black ">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  {t('bookingDetail.tourInfo')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-bold text-lg mb-2">{t('bookingDetail.tourIdLabel')}{booking.tourId}</h3>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>{t('bookingDetail.departureIdLabel')}{booking.departureId}</span>
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">{t('bookingDetail.adults')}</p>
                    <p className="font-bold">{booking.numberOfAdults} {t('bookingDetail.personsUnit')}</p>
                  </div>
                  {booking.numberOfChildrenWithBed > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">{t('bookingDetail.childrenWithBed')}</p>
                      <p className="font-bold">{booking.numberOfChildrenWithBed} {t('bookingDetail.personsUnit')}</p>
                    </div>
                  )}
                  {booking.numberOfChildrenNoBed > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">{t('bookingDetail.childrenNoBed')}</p>
                      <p className="font-bold">{booking.numberOfChildrenNoBed} {t('bookingDetail.personsUnit')}</p>
                    </div>
                  )}
                  {booking.numberOfInfants > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">{t('bookingDetail.infants')}</p>
                      <p className="font-bold">{booking.numberOfInfants} {t('bookingDetail.personsUnit')}</p>
                    </div>
                  )}
                  {booking.numberOfSingleRooms > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">{t('bookingDetail.singleRooms')}</p>
                      <p className="font-bold">{booking.numberOfSingleRooms} {t('bookingDetail.roomsUnit')}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Contact Information */}
            <Card className="border-2 border-black ">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t('bookingDetail.contactInfo')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-gray-600" />
                  <span>{booking.customerName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-gray-600" />
                  <span>{booking.customerEmail}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-gray-600" />
                  <span>{booking.customerPhone}</span>
                </div>
                {booking.message && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm text-gray-600 mb-2">{t('bookingDetail.specialRequests')}</p>
                      <p className="text-sm">{booking.message}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Payment Card */}
          <div className="lg:col-span-1">
            <Card className="border-2 border-black  sticky top-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  {t('bookingDetail.paymentInfo')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">{t('bookingDetail.totalAmount')}</span>
                    <span className="font-bold">NT$ {totalAmount.toLocaleString()}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">{t('bookingDetail.deposit20')}</span>
                    <span className="font-medium">NT$ {depositAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">{t('bookingDetail.balance')}</span>
                    <span className="font-medium">NT$ {balanceAmount.toLocaleString()}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">{t('bookingDetail.paidAmount')}</span>
                    <span className="font-bold text-green-600">NT$ {paidAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">{t('bookingDetail.unpaidAmount')}</span>
                    <span className="font-bold text-red-600">
                      NT$ {(totalAmount - paidAmount).toLocaleString()}
                    </span>
                  </div>
                </div>

                {!isFullyPaid && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h3 className="font-bold text-sm">{t('bookingDetail.choosePaymentMethod')}</h3>
                      {canPayDeposit && (
                        <Button 
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => handlePayment("deposit")}
                          disabled={createCheckoutMutation.isPending}
                        >
                          {createCheckoutMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <CreditCard className="h-4 w-4 mr-2" />
                          )}
                          {t('bookingDetail.payDeposit')} NT$ {depositAmount.toLocaleString()}
                        </Button>
                      )}
                      {canPayBalance && (
                        <Button 
                          className="w-full bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handlePayment("balance")}
                          disabled={createCheckoutMutation.isPending}
                        >
                          {createCheckoutMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <CreditCard className="h-4 w-4 mr-2" />
                          )}
                          {t('bookingDetail.payBalance')} NT$ {balanceAmount.toLocaleString()}
                        </Button>
                      )}
                      {canPayDeposit && (
                        <Button 
                          className="w-full bg-black hover:bg-gray-800 text-white"
                          onClick={() => handlePayment("full")}
                          disabled={createCheckoutMutation.isPending}
                        >
                          {createCheckoutMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <CreditCard className="h-4 w-4 mr-2" />
                          )}
                          {t('bookingDetail.payFull')} NT$ {totalAmount.toLocaleString()}
                        </Button>
                      )}
                    </div>
                  </>
                )}

                {isFullyPaid && (
                  <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 text-center">
                    <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
                    <p className="font-bold text-green-800">{t('bookingDetail.paymentCompleted')}</p>
                    <p className="text-sm text-green-600 mt-1">{t('bookingDetail.thankYou')}</p>
                  </div>
                )}

                <Separator />
                <div className="text-xs text-gray-500 space-y-1">
                  <p>• {t('bookingDetail.keepReceipt')}</p>
                  <p>• {t('bookingDetail.contactSupport')}</p>
                  <p>• {t('bookingDetail.cancellationPolicy')}</p>
                </div>

                {/* v78w: Cancel booking button (only shown for non-cancelled, non-completed) */}
                {booking.bookingStatus !== "cancelled" && booking.bookingStatus !== "completed" && (
                  <>
                    <Separator />
                    <Button
                      variant="outline"
                      onClick={handleCancelBooking}
                      disabled={cancelMutation.isPending}
                      className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 hover:text-red-700 rounded-lg"
                    >
                      {cancelMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4 mr-2" />
                      )}
                      {t('bookingDetail.cancelBookingBtn') || "Cancel booking"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
