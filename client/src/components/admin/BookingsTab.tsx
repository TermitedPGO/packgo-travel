import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Eye, Download, ShoppingCart, ChevronDown, Check, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { LoadingRow } from "@/components/ui/spinner";
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";

export default function BookingsTab() {
  const { t, language } = useLocale();
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; icon: React.ReactNode }> = useMemo(() => ({
    pending:   { label: t('admin.bookingsTab.statusPending'),   color: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: <Clock className="h-3 w-3" /> },
    confirmed: { label: t('admin.bookingsTab.statusConfirmed'), color: "bg-blue-50 text-blue-700 border-blue-200",       icon: <CheckCircle2 className="h-3 w-3" /> },
    completed: { label: t('admin.bookingsTab.statusCompleted'), color: "bg-green-50 text-green-700 border-green-200",    icon: <Check className="h-3 w-3" /> },
    cancelled: { label: t('admin.bookingsTab.statusCancelled'), color: "bg-red-50 text-red-700 border-red-200",          icon: <XCircle className="h-3 w-3" /> },
  }), [t]);

  const PAYMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = useMemo(() => ({
    pending:      { label: t('admin.bookingsTab.paymentPending'),      color: "bg-gray-50 text-gray-600 border-gray-200" },
    deposit_paid: { label: t('admin.bookingsTab.paymentDepositPaid'),  color: "bg-blue-50 text-blue-600 border-blue-200" },
    paid:         { label: t('admin.bookingsTab.paymentPaid'),         color: "bg-green-50 text-green-700 border-green-200" },
    refunded:     { label: t('admin.bookingsTab.paymentRefunded'),     color: "bg-orange-50 text-orange-700 border-orange-200" },
  }), [t]);

  const { data: bookings = [], isLoading, refetch } = trpc.bookings.adminList.useQuery();

  const updateStatusMutation = trpc.bookings.adminUpdateStatus.useMutation({
    onSuccess: () => { refetch(); toast.success(t('admin.bookingsTab.toastStatusUpdated')); },
    onError: () => toast.error(t('admin.bookingsTab.toastUpdateFailed')),
    onSettled: () => setUpdatingId(null),
  });

  const handleStatusChange = (bookingId: number, newStatus: BookingStatus) => {
    setUpdatingId(bookingId);
    updateStatusMutation.mutate({ id: bookingId, status: newStatus });
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-TW', { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  const formatCurrency = (amount: number | null | undefined, currency = "USD") => {
    if (amount == null) return "—";
    return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-TW', { style: "currency", currency }).format(amount);
  };

  const stats = {
    total:     bookings.length,
    pending:   bookings.filter((b: any) => b.bookingStatus === "pending").length,
    confirmed: bookings.filter((b: any) => b.bookingStatus === "confirmed").length,
    completed: bookings.filter((b: any) => b.bookingStatus === "completed").length,
  };

  const paxSuffix = t('admin.bookingsTab.paxSuffix');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t('admin.bookingsTab.title')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('admin.bookingsTab.totalCount', { n: String(stats.total) })}</p>
        </div>
        <Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg">
          <Download className="h-4 w-4 mr-2" />
          {t('admin.bookingsTab.exportButton')}
        </Button>
      </div>

      {/* Stats Row */}
      {bookings.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: t('admin.bookingsTab.statAll'),       value: stats.total,     color: "text-gray-900" },
            { label: t('admin.bookingsTab.statPending'),   value: stats.pending,   color: "text-yellow-700" },
            { label: t('admin.bookingsTab.statConfirmed'), value: stats.confirmed, color: "text-blue-700" },
            { label: t('admin.bookingsTab.statCompleted'), value: stats.completed, color: "text-green-700" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border border-gray-200 p-4 rounded-xl">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{stat.label}</p>
              <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bookings Table */}
      <div className="bg-white border border-gray-200 overflow-hidden rounded-xl">
        {isLoading ? (
          <LoadingRow />
        ) : bookings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnOrderNo')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnCustomer')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnTour')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnDeparture')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnPax')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnAmount')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnPayment')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnStatus')}</th>
                  <th className="px-5 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.bookingsTab.columnActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bookings.map((booking: any) => {
                  const statusCfg = STATUS_CONFIG[booking.bookingStatus as BookingStatus] || STATUS_CONFIG.pending;
                  const paymentCfg = PAYMENT_STATUS_CONFIG[booking.paymentStatus] || PAYMENT_STATUS_CONFIG.pending;
                  const isUpdating = updatingId === booking.id;

                  return (
                    <tr key={booking.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4">
                        <span className="text-sm font-mono text-gray-700">#{booking.id}</span>
                      </td>
                      <td className="px-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{booking.contactName || "—"}</p>
                          <p className="text-xs text-gray-500">{booking.contactEmail || ""}</p>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm text-gray-900 max-w-[180px] truncate">{booking.tourTitle || t('admin.bookingsTab.tourPlaceholder', { id: String(booking.tourId) })}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm text-gray-700">{formatDate(booking.departureDate)}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm text-gray-700">{booking.totalPax || "—"} {paxSuffix}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-gray-900">{formatCurrency(booking.totalAmount, booking.currency)}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border rounded-md ${paymentCfg.color}`}>
                          {paymentCfg.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-md transition-opacity ${statusCfg.color} ${isUpdating ? "opacity-50 cursor-not-allowed" : "hover:opacity-80 cursor-pointer"}`}
                              disabled={isUpdating}
                            >
                              {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : statusCfg.icon}
                              {statusCfg.label}
                              <ChevronDown className="h-3 w-3 ml-0.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-36 rounded-lg">
                            {(Object.entries(STATUS_CONFIG) as [BookingStatus, typeof STATUS_CONFIG[BookingStatus]][]).map(([status, cfg]) => (
                              <DropdownMenuItem
                                key={status}
                                className={`flex items-center gap-2 text-xs ${booking.bookingStatus === status ? "font-semibold" : ""}`}
                                onClick={() => handleStatusChange(booking.id, status)}
                              >
                                {cfg.icon}
                                {cfg.label}
                                {booking.bookingStatus === status && <Check className="h-3 w-3 ml-auto" />}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setSelectedBooking(booking); setIsDetailDialogOpen(true); }}
                          className="text-gray-600 hover:text-gray-900 h-8 px-3 rounded-lg"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          {t('admin.bookingsTab.viewButton')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-16 text-center">
            <ShoppingCart className="h-12 w-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-gray-700 mb-1">{t('admin.bookingsTab.emptyTitle')}</h3>
            <p className="text-sm text-gray-400">{t('admin.bookingsTab.emptyDesc')}</p>
          </div>
        )}
      </div>

      {/* Booking Detail Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('admin.bookingsTab.detailDialogTitle', { id: String(selectedBooking?.id ?? '') })}</DialogTitle>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-5 py-2">
              <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-md ${STATUS_CONFIG[selectedBooking.bookingStatus as BookingStatus]?.color || ""}`}>
                  {STATUS_CONFIG[selectedBooking.bookingStatus as BookingStatus]?.icon}
                  {STATUS_CONFIG[selectedBooking.bookingStatus as BookingStatus]?.label}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border rounded-md ${PAYMENT_STATUS_CONFIG[selectedBooking.paymentStatus]?.color || ""}`}>
                  {PAYMENT_STATUS_CONFIG[selectedBooking.paymentStatus]?.label}
                </span>
                <span className="text-xs text-gray-500 ml-auto">{t('admin.bookingsTab.createdAt', { date: formatDate(selectedBooking.createdAt) })}</span>
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('admin.bookingsTab.contactInfoLabel')}</p>
                  <div className="space-y-1.5">
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.contactName')}：</span><span className="font-medium">{selectedBooking.contactName || "—"}</span></p>
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.contactPhone')}：</span>{selectedBooking.contactPhone || "—"}</p>
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.contactEmail')}：</span>{selectedBooking.contactEmail || "—"}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('admin.bookingsTab.tourInfoLabel')}</p>
                  <div className="space-y-1.5">
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.tourField')}：</span><span className="font-medium">{selectedBooking.tourTitle || `#${selectedBooking.tourId}`}</span></p>
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.departureField')}：</span>{formatDate(selectedBooking.departureDate)}</p>
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.paxField')}：</span>{selectedBooking.totalPax || "—"} {paxSuffix}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('admin.bookingsTab.costInfoLabel')}</p>
                  <div className="space-y-1.5">
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.totalAmount')}：</span><span className="font-semibold">{formatCurrency(selectedBooking.totalAmount, selectedBooking.currency)}</span></p>
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.depositAmount')}：</span>{formatCurrency(selectedBooking.depositAmount, selectedBooking.currency)}</p>
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.remainingAmount')}：</span>{formatCurrency(selectedBooking.remainingAmount, selectedBooking.currency)}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('admin.bookingsTab.paxBreakdownLabel')}</p>
                  <div className="space-y-1.5">
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.adultsField')}：</span>{selectedBooking.adults || 0} {paxSuffix}</p>
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.childrenField')}：</span>{selectedBooking.children || 0} {paxSuffix}</p>
                    <p className="text-sm"><span className="text-gray-500">{t('admin.bookingsTab.infantsField')}：</span>{selectedBooking.infants || 0} {paxSuffix}</p>
                  </div>
                </div>
              </div>

              {selectedBooking.specialRequests && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('admin.bookingsTab.specialRequestsLabel')}</p>
                  <p className="text-sm text-gray-700 bg-gray-50 p-3 border border-gray-200 rounded-lg">{selectedBooking.specialRequests}</p>
                </div>
              )}

              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('admin.bookingsTab.quickStatusLabel')}</p>
                <div className="flex gap-2 flex-wrap">
                  {(Object.entries(STATUS_CONFIG) as [BookingStatus, typeof STATUS_CONFIG[BookingStatus]][]).map(([status, cfg]) => (
                    <Button
                      key={status}
                      variant="outline"
                      size="sm"
                      className={`text-xs h-8 rounded-lg ${selectedBooking.bookingStatus === status ? "ring-2 ring-offset-1 ring-gray-400" : ""}`}
                      onClick={() => {
                        handleStatusChange(selectedBooking.id, status);
                        setSelectedBooking({ ...selectedBooking, bookingStatus: status });
                      }}
                    >
                      {cfg.icon}
                      <span className="ml-1">{cfg.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
