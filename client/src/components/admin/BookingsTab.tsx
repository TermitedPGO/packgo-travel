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

  const { data: rawBookings = [], isLoading, refetch } = trpc.bookings.adminList.useQuery();
  // v78v: status quick-filter via clicking stats cards (default 'all')
  const [statusFilter, setStatusFilter] = useState<"all" | BookingStatus>("all");
  const bookings = useMemo(() => {
    if (statusFilter === "all") return rawBookings;
    return (rawBookings as any[]).filter((b) => b.bookingStatus === statusFilter);
  }, [rawBookings, statusFilter]);

  const updateStatusMutation = trpc.bookings.adminUpdateStatus.useMutation({
    onSuccess: () => { refetch(); toast.success(t('admin.bookingsTab.toastStatusUpdated')); },
    onError: () => toast.error(t('admin.bookingsTab.toastUpdateFailed')),
    onSettled: () => setUpdatingId(null),
  });

  // QA audit 2026-05-11 Phase 9 fix wire-up: generate deposit invoice PDF
  // for a booking with one click. Opens the resulting PDF in a new tab so
  // Jeff can sanity-check before forwarding to the customer.
  const generateDepositMutation = trpc.tools.generateDeposit.useMutation({
    onSuccess: (res) => {
      toast.success(t('admin.bookingsTab.toastDepositGenerated') || "訂金通知 PDF 已產生");
      if (res.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      }
    },
    onError: (err: any) =>
      toast.error(err?.message || (t('admin.bookingsTab.toastDepositFailed') || "PDF 產生失敗")),
  });

  const handleStatusChange = (bookingId: number, newStatus: BookingStatus, currentStatus?: BookingStatus) => {
    // v70: confirm before destructive transitions. Without this an admin can
    // mis-click the dropdown and instantly change a booking's status with no
    // undo — e.g. flipping a paid booking to "cancelled" sends the wrong
    // signal to refund/operations and there's no audit trail to recover from.
    // Only require confirmation for transitions that affect the customer:
    // → cancelled (irreversible side effects)
    // → completed (final state, hard to revert)
    // → refunded   (financial)
    if (newStatus !== currentStatus) {
      // refunded isn't part of bookingStatus enum (it's a payment status), so
      // we only check booking-status destructive transitions here.
      const destructive: BookingStatus[] = ["cancelled", "completed"];
      if (destructive.includes(newStatus)) {
        const labelKey = `admin.bookingsTab.confirmStatusChange.${newStatus}`;
        const fallback =
          newStatus === "cancelled"
            ? "確定要將此訂單改為「已取消」嗎？此動作無法復原。"
            : "確定要將此訂單改為「已完成」嗎？此狀態屬於最終狀態。";
        const message = t(labelKey) || fallback;
        if (!window.confirm(message)) return;
      }
    }
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

  // v78v: stats count from raw (unfiltered) so they don't move when user filters
  const stats = {
    total:     rawBookings.length,
    pending:   (rawBookings as any[]).filter((b) => b.bookingStatus === "pending").length,
    confirmed: (rawBookings as any[]).filter((b) => b.bookingStatus === "confirmed").length,
    completed: (rawBookings as any[]).filter((b) => b.bookingStatus === "completed").length,
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

      {/* Stats Row — v78v: clickable, acts as quick status filter */}
      {rawBookings.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {([
            { key: "all" as const,       label: t('admin.bookingsTab.statAll'),       value: stats.total,     color: "text-gray-900",     ring: "ring-gray-900" },
            { key: "pending" as const,   label: t('admin.bookingsTab.statPending'),   value: stats.pending,   color: "text-yellow-700",   ring: "ring-yellow-500" },
            { key: "confirmed" as const, label: t('admin.bookingsTab.statConfirmed'), value: stats.confirmed, color: "text-blue-700",     ring: "ring-blue-500" },
            { key: "completed" as const, label: t('admin.bookingsTab.statCompleted'), value: stats.completed, color: "text-green-700",    ring: "ring-green-500" },
          ]).map((stat) => {
            const isActive = statusFilter === stat.key;
            return (
              <button
                key={stat.label}
                onClick={() => setStatusFilter(stat.key as any)}
                className={`text-left bg-white border p-4 rounded-xl transition-all ${
                  isActive
                    ? `border-transparent ring-2 ${stat.ring} shadow-sm`
                    : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
              >
                <p className="text-xs text-gray-500 uppercase tracking-wide">{stat.label}</p>
                <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
              </button>
            );
          })}
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
                                onClick={() => handleStatusChange(booking.id, status, booking.bookingStatus)}
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
                        handleStatusChange(selectedBooking.id, status, selectedBooking.bookingStatus);
                        setSelectedBooking({ ...selectedBooking, bookingStatus: status });
                      }}
                    >
                      {cfg.icon}
                      <span className="ml-1">{cfg.label}</span>
                    </Button>
                  ))}
                </div>
              </div>

              {/* QA audit Phase 9 fix: one-click deposit invoice PDF for the
                  customer. Jeff can copy the URL into the confirmation email
                  manually until the auto-attach flow ships. */}
              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  {t('admin.bookingsTab.toolsLabel') || "工具"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-8 rounded-lg"
                  disabled={
                    generateDepositMutation.isPending ||
                    !selectedBooking.totalAmount ||
                    !selectedBooking.depositAmount
                  }
                  onClick={() => {
                    const depUSD = Number(selectedBooking.depositAmount ?? 0);
                    const totUSD = Number(selectedBooking.totalAmount ?? 0);
                    if (!depUSD || !totUSD) {
                      toast.error(
                        t('admin.bookingsTab.toastMissingAmount') ||
                          "訂單缺少金額,無法產生 PDF"
                      );
                      return;
                    }
                    generateDepositMutation.mutate({
                      bookingId: selectedBooking.id,
                      customerName: selectedBooking.contactName || "Customer",
                      customerEmail: selectedBooking.contactEmail || undefined,
                      tripName:
                        selectedBooking.tourTitle ||
                        `Tour #${selectedBooking.tourId}`,
                      departureDate: selectedBooking.departureDate
                        ? new Date(selectedBooking.departureDate).toLocaleDateString(
                            language === "en" ? "en-US" : "zh-TW",
                            { year: "numeric", month: "long", day: "numeric" }
                          )
                        : "未定",
                      passengers:
                        selectedBooking.totalPax != null
                          ? `${selectedBooking.totalPax} 位`
                          : undefined,
                      totalUSD: totUSD,
                      depositUSD: depUSD,
                    });
                  }}
                >
                  {generateDepositMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {t('admin.bookingsTab.generateDepositPdf') || "產生訂金通知 PDF"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
