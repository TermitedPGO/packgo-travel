import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Eye, MessageSquare, Clock } from "lucide-react";
import { LoadingRow } from "@/components/ui/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";

type InquiryStatus = "new" | "in_progress" | "replied" | "resolved" | "closed";

export default function InquiriesTab() {
  const { t, language } = useLocale();
  const [statusFilter, setStatusFilter] = useState<InquiryStatus | "all">("all");
  const [selectedInquiryId, setSelectedInquiryId] = useState<number | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data: inquiries, isLoading } = trpc.inquiries.list.useQuery();
  const { data: selectedInquiry } = trpc.inquiries.getById.useQuery(
    { id: selectedInquiryId! },
    { enabled: !!selectedInquiryId }
  );

  const updateStatusMutation = trpc.inquiries.update.useMutation({
    onSuccess: () => {
      utils.inquiries.list.invalidate();
      utils.inquiries.getById.invalidate();
      toast.success(t('admin.inquiriesTab.toastStatusUpdated'));
    },
    onError: (error) => {
      toast.error(t('admin.inquiriesTab.toastUpdateFailed', { err: error.message }));
    },
  });

  const addMessageMutation = trpc.inquiries.addMessage.useMutation({
    onSuccess: () => {
      utils.inquiries.getById.invalidate();
      setReplyMessage("");
      toast.success(t('admin.inquiriesTab.toastReplySent'));
    },
    onError: (error) => {
      toast.error(t('admin.inquiriesTab.toastReplyFailed', { err: error.message }));
    },
  });

  const handleStatusChange = (inquiryId: number, newStatus: InquiryStatus) => {
    updateStatusMutation.mutate({ id: inquiryId, status: newStatus });
  };

  const handleReply = () => {
    if (!selectedInquiryId || !replyMessage.trim()) return;
    addMessageMutation.mutate({
      inquiryId: selectedInquiryId,
      message: replyMessage,
    });
  };

  const handleViewDetails = (inquiryId: number) => {
    setSelectedInquiryId(inquiryId);
    setIsDetailDialogOpen(true);
  };

  const getStatusConfig = (status: string) => {
    const config: Record<string, { label: string; className: string }> = {
      new: { label: t('admin.inquiriesTab.statusNew'), className: "bg-amber-100 text-amber-800 border border-amber-200" },
      in_progress: { label: t('admin.inquiriesTab.statusInProgress'), className: "bg-blue-100 text-blue-800 border border-blue-200" },
      replied: { label: t('admin.inquiriesTab.statusReplied'), className: "bg-purple-100 text-purple-800 border border-purple-200" },
      resolved: { label: t('admin.inquiriesTab.statusResolved'), className: "bg-green-100 text-green-800 border border-green-200" },
      closed: { label: t('admin.inquiriesTab.statusClosed'), className: "bg-gray-100 text-gray-600 border border-gray-200" },
    };
    return config[status] || { label: status, className: "bg-gray-100 text-gray-600" };
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      general: t('admin.inquiriesTab.typeGeneral'),
      custom_tour: t('admin.inquiriesTab.typeCustomTour'),
      booking: t('admin.inquiriesTab.typeBooking'),
      complaint: t('admin.inquiriesTab.typeComplaint'),
    };
    return labels[type] || type;
  };

  const filteredInquiries =
    statusFilter === "all"
      ? inquiries
      : inquiries?.filter((inq) => inq.status === statusFilter);

  const dateLocale = language === 'en' ? enUS : zhTW;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t('admin.inquiriesTab.title')}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {t('admin.inquiriesTab.totalCount', { n: String(filteredInquiries?.length || 0) })}
          </p>
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as InquiryStatus | "all")}
        >
          <SelectTrigger className="w-[160px] border-gray-300 rounded-lg">
            <SelectValue placeholder={t('admin.inquiriesTab.filterPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.inquiriesTab.statusAll')}</SelectItem>
            <SelectItem value="new">{t('admin.inquiriesTab.statusNew')}</SelectItem>
            <SelectItem value="in_progress">{t('admin.inquiriesTab.statusInProgress')}</SelectItem>
            <SelectItem value="replied">{t('admin.inquiriesTab.statusReplied')}</SelectItem>
            <SelectItem value="resolved">{t('admin.inquiriesTab.statusResolved')}</SelectItem>
            <SelectItem value="closed">{t('admin.inquiriesTab.statusClosed')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Inquiries Table */}
      <div className="bg-white border border-gray-200 overflow-hidden rounded-xl">
        {isLoading ? (
          <LoadingRow />
        ) : filteredInquiries && filteredInquiries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.inquiriesTab.columnCustomer')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.inquiriesTab.columnType')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.inquiriesTab.columnSubject')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.inquiriesTab.columnStatus')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.inquiriesTab.columnTime')}</th>
                  <th className="px-5 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.inquiriesTab.columnActions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredInquiries.map((inquiry) => {
                  const statusConfig = getStatusConfig(inquiry.status);
                  return (
                    <tr key={inquiry.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-5">
                        <p className="font-semibold text-sm text-gray-900">{inquiry.customerName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{inquiry.customerEmail}</p>
                        {inquiry.customerPhone && (
                          <p className="text-xs text-gray-400">{inquiry.customerPhone}</p>
                        )}
                      </td>
                      <td className="px-5 py-5">
                        <span className="text-sm text-gray-600">{getTypeLabel(inquiry.inquiryType)}</span>
                      </td>
                      <td className="px-5 py-5 max-w-xs">
                        <p className="text-sm text-gray-900 truncate">{inquiry.subject}</p>
                      </td>
                      <td className="px-5 py-5">
                        <Select
                          value={inquiry.status}
                          onValueChange={(value) =>
                            handleStatusChange(inquiry.id, value as InquiryStatus)
                          }
                        >
                          <SelectTrigger className={`w-[110px] text-xs font-semibold h-8 rounded-lg ${statusConfig.className}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">{t('admin.inquiriesTab.statusNew')}</SelectItem>
                            <SelectItem value="in_progress">{t('admin.inquiriesTab.statusInProgress')}</SelectItem>
                            <SelectItem value="replied">{t('admin.inquiriesTab.statusReplied')}</SelectItem>
                            <SelectItem value="resolved">{t('admin.inquiriesTab.statusResolved')}</SelectItem>
                            <SelectItem value="closed">{t('admin.inquiriesTab.statusClosed')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-5 py-5">
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Clock className="h-3.5 w-3.5" />
                          {format(new Date(inquiry.createdAt), "MM/dd HH:mm", { locale: dateLocale })}
                        </div>
                      </td>
                      <td className="px-5 py-5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewDetails(inquiry.id)}
                          className="h-8 px-3 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1.5" />
                          {t('admin.inquiriesTab.viewButton')}
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
            <MessageSquare className="h-12 w-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-gray-700 mb-1">{t('admin.inquiriesTab.emptyTitle')}</h3>
            <p className="text-sm text-gray-400">{t('admin.inquiriesTab.emptyDesc')}</p>
          </div>
        )}
      </div>

      {/* Inquiry Detail Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('admin.inquiriesTab.detailDialogTitle')}</DialogTitle>
          </DialogHeader>
          {selectedInquiry && (
            <div className="space-y-5 py-2">
              {/* Customer Info */}
              <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('admin.inquiriesTab.customerInfoLabel')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500">{t('admin.inquiriesTab.nameLabel')}</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">{selectedInquiry.customerName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t('admin.inquiriesTab.phoneLabel')}</p>
                    <p className="text-sm font-medium text-gray-900 mt-0.5">{selectedInquiry.customerPhone || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t('admin.inquiriesTab.emailLabel')}</p>
                    <p className="text-sm font-medium text-gray-900 mt-0.5">{selectedInquiry.customerEmail}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t('admin.inquiriesTab.typeLabel')}</p>
                    <p className="text-sm font-medium text-gray-900 mt-0.5">{getTypeLabel(selectedInquiry.inquiryType)}</p>
                  </div>
                </div>
              </div>

              {/* Subject and Message */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('admin.inquiriesTab.subjectLabel')}</p>
                <p className="text-sm font-semibold text-gray-900">{selectedInquiry.subject}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('admin.inquiriesTab.messageLabel')}</p>
                <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{selectedInquiry.message}</p>
                </div>
              </div>

              {/* Reply Section */}
              <div className="border-t border-gray-200 pt-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('admin.inquiriesTab.replyToCustomer')}</p>
                <Textarea
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder={t('admin.inquiriesTab.replyPlaceholder')}
                  rows={4}
                  className="mb-3 border-gray-300 text-sm rounded-lg"
                />
                <Button
                  onClick={handleReply}
                  disabled={addMessageMutation.isPending || !replyMessage.trim()}
                  className="bg-black text-white hover:bg-gray-800 rounded-lg"
                >
                  {addMessageMutation.isPending ? t('admin.inquiriesTab.sendingReply') : t('admin.inquiriesTab.sendReply')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
