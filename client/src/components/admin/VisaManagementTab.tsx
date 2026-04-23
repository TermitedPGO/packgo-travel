import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

export default function VisaManagementTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateNote, setUpdateNote] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { t, language } = useLocale();

  const STATUS_LABELS = useMemo<Record<string, { label: string; color: string }>>(() => ({
    draft:               { label: t('admin.visaManagement.statusDraft'),              color: "bg-gray-100 text-gray-700" },
    submitted:           { label: t('admin.visaManagement.statusSubmitted'),          color: "bg-blue-100 text-blue-700" },
    paid:                { label: t('admin.visaManagement.statusPaid'),               color: "bg-emerald-100 text-emerald-700" },
    documents_received:  { label: t('admin.visaManagement.statusDocumentsReceived'),  color: "bg-cyan-100 text-cyan-700" },
    processing:          { label: t('admin.visaManagement.statusProcessing'),         color: "bg-yellow-100 text-yellow-700" },
    approved:            { label: t('admin.visaManagement.statusApproved'),           color: "bg-green-100 text-green-700" },
    rejected:            { label: t('admin.visaManagement.statusRejected'),           color: "bg-red-100 text-red-700" },
    completed:           { label: t('admin.visaManagement.statusCompleted'),          color: "bg-purple-100 text-purple-700" },
    cancelled:           { label: t('admin.visaManagement.statusCancelled'),          color: "bg-gray-100 text-gray-500" },
  }), [t]);

  const ALL_STATUSES = Object.keys(STATUS_LABELS);

  const { data: stats } = trpc.visa.adminStats.useQuery();
  const { data: listData, isLoading, refetch } = trpc.visa.adminListApplications.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    page,
    pageSize: 20,
  });

  const updateStatusMutation = trpc.visa.adminUpdateStatus.useMutation({
    onSuccess: () => {
      toast.success(t('admin.visaManagement.toastStatusUpdated'), { description: t('admin.visaManagement.toastStatusUpdatedDesc') });
      refetch();
      setDialogOpen(false);
    },
    onError: (err) => {
      toast.error(t('admin.visaManagement.toastUpdateFailed'), { description: err.message });
    },
  });

  const updateNotesMutation = trpc.visa.adminUpdateNotes.useMutation({
    onSuccess: () => {
      toast.success(t('admin.visaManagement.toastNotesUpdated'));
      refetch();
    },
    onError: (err) => {
      toast.error(t('admin.visaManagement.toastUpdateFailed'), { description: err.message });
    },
  });

  const openDialog = (app: any) => {
    setSelectedApp(app);
    setUpdateStatus(app.applicationStatus);
    setUpdateNote("");
    setAdminNotes(app.adminNotes ?? "");
    setTrackingNumber(app.trackingNumber ?? "");
    setDialogOpen(true);
  };

  const handleUpdateStatus = () => {
    if (!selectedApp) return;
    updateStatusMutation.mutate({
      applicationId: selectedApp.id,
      newStatus: updateStatus as any,
      note: updateNote || undefined,
    });
  };

  const handleUpdateNotes = () => {
    if (!selectedApp) return;
    updateNotesMutation.mutate({
      applicationId: selectedApp.id,
      adminNotes,
      trackingNumber: trackingNumber || undefined,
    });
  };

  const applications = listData?.applications ?? [];
  const total = listData?.total ?? 0;
  const totalPages = Math.ceil(total / 20);
  const localeArg = language === 'en' ? 'en-US' : 'zh-TW';

  return (
    <div className="space-y-8">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: t('admin.visaManagement.statTotal'),      value: stats.total,      color: "text-gray-900" },
            { label: t('admin.visaManagement.statPending'),    value: stats.pending,    color: "text-blue-600" },
            { label: t('admin.visaManagement.statProcessing'), value: stats.processing, color: "text-yellow-600" },
            { label: t('admin.visaManagement.statApproved'),   value: stats.approved,   color: "text-green-600" },
          ].map((s, i) => (
            <div key={i} className="border border-gray-200 p-4 rounded-xl">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-sm text-gray-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-bold">{t('admin.visaManagement.filterLabel')}</Label>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 border-2 border-gray-300 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-lg">
              <SelectItem value="all">{t('admin.visaManagement.filterAll')}</SelectItem>
              {ALL_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]?.label ?? s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          className="border-2 border-gray-300 rounded-lg"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('admin.visaManagement.refreshButton')}
        </Button>
        <span className="text-sm text-gray-500 ml-auto">{t('admin.visaManagement.totalCount', { n: String(total) })}</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : applications.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>{t('admin.visaManagement.emptyMessage')}</p>
        </div>
      ) : (
        <div className="border border-gray-200 overflow-x-auto rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-bold">{t('admin.visaManagement.columnId')}</th>
                <th className="px-4 py-3 text-left font-bold">{t('admin.visaManagement.columnApplicant')}</th>
                <th className="px-4 py-3 text-left font-bold">{t('admin.visaManagement.columnPassportCountry')}</th>
                <th className="px-4 py-3 text-left font-bold">{t('admin.visaManagement.columnVisaType')}</th>
                <th className="px-4 py-3 text-left font-bold">{t('admin.visaManagement.columnAmount')}</th>
                <th className="px-4 py-3 text-left font-bold">{t('admin.visaManagement.columnStatus')}</th>
                <th className="px-4 py-3 text-left font-bold">{t('admin.visaManagement.columnDate')}</th>
                <th className="px-4 py-3 text-left font-bold">{t('admin.visaManagement.columnActions')}</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app: any) => {
                const statusCfg = STATUS_LABELS[app.applicationStatus] ?? { label: app.applicationStatus, color: "bg-gray-100 text-gray-700" };
                return (
                  <tr key={app.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">#{app.id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{app.firstName} {app.lastName}</div>
                      <div className="text-gray-500 text-xs">{app.email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{app.passportCountry}</td>
                    <td className="px-4 py-3">
                      <div>{app.visaType}</div>
                      <div className="text-gray-500 text-xs">{app.entryType}</div>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      USD ${Number(app.totalAmount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-md ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(app.createdAt).toLocaleDateString(localeArg)}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDialog(app)}
                        className="border border-gray-300 rounded-lg text-xs"
                      >
                        {t('admin.visaManagement.manageButton')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="border-2 border-gray-300 rounded-lg"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-gray-600">
            {t('admin.visaManagement.paginationSummary', { page: String(page), totalPages: String(totalPages) })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="border-2 border-gray-300 rounded-lg"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>
              {t('admin.visaManagement.dialogTitle', { id: String(selectedApp?.id ?? '') })}
            </DialogTitle>
          </DialogHeader>

          {selectedApp && (
            <div className="space-y-6">
              {/* Applicant info */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 font-bold text-sm border-b border-gray-200">{t('admin.visaManagement.sectionApplicantInfo')}</div>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      { label: t('admin.visaManagement.rowName'),            value: `${selectedApp.firstName} ${selectedApp.lastName}` },
                      { label: t('admin.visaManagement.rowEmail'),           value: selectedApp.email },
                      { label: t('admin.visaManagement.rowPhone'),           value: selectedApp.phone },
                      { label: t('admin.visaManagement.rowPassportNumber'),  value: selectedApp.passportNumber },
                      { label: t('admin.visaManagement.rowPassportCountry'), value: selectedApp.passportCountry },
                      { label: t('admin.visaManagement.rowPassportExpiry'),  value: selectedApp.passportExpiry },
                      { label: t('admin.visaManagement.rowDateOfBirth'),     value: selectedApp.dateOfBirth },
                      { label: t('admin.visaManagement.rowVisaType'),        value: selectedApp.visaType },
                      { label: t('admin.visaManagement.rowEntryType'),       value: selectedApp.entryType },
                      { label: t('admin.visaManagement.rowGroupSize'),       value: selectedApp.groupSize },
                      { label: t('admin.visaManagement.rowTotalAmount'),     value: `USD $${Number(selectedApp.totalAmount).toFixed(2)}` },
                      { label: t('admin.visaManagement.rowPaymentStatus'),   value: selectedApp.paymentStatus },
                    ].map((row, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-4 py-2 text-gray-500 w-1/3">{row.label}</td>
                        <td className="px-4 py-2 font-medium">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Update status */}
              <div className="space-y-3">
                <Label className="font-bold">{t('admin.visaManagement.updateStatusTitle')}</Label>
                <Select value={updateStatus} onValueChange={setUpdateStatus}>
                  <SelectTrigger className="border-2 border-gray-300 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    {ALL_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]?.label ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div>
                  <Label className="text-sm mb-1 block">{t('admin.visaManagement.updateNoteLabel')}</Label>
                  <Textarea
                    value={updateNote}
                    onChange={e => setUpdateNote(e.target.value)}
                    rows={2}
                    className="border-2 border-gray-300 rounded-lg"
                    placeholder={t('admin.visaManagement.updateNotePlaceholder')}
                  />
                </div>
                <Button
                  onClick={handleUpdateStatus}
                  disabled={updateStatusMutation.isPending}
                  className="bg-black text-white hover:bg-gray-800 rounded-lg"
                >
                  {updateStatusMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('admin.visaManagement.updatingButton')}</>
                  ) : t('admin.visaManagement.updateButton')}
                </Button>
              </div>

              {/* Admin notes */}
              <div className="space-y-3 pt-4 border-t border-gray-200">
                <Label className="font-bold">{t('admin.visaManagement.adminNotesTitle')}</Label>
                <div>
                  <Label className="text-sm mb-1 block">{t('admin.visaManagement.trackingNumberLabel')}</Label>
                  <Input
                    value={trackingNumber}
                    onChange={e => setTrackingNumber(e.target.value)}
                    className="border-2 border-gray-300 rounded-lg font-mono"
                    placeholder={t('admin.visaManagement.trackingNumberPlaceholder')}
                  />
                </div>
                <div>
                  <Label className="text-sm mb-1 block">{t('admin.visaManagement.internalNotesLabel')}</Label>
                  <Textarea
                    value={adminNotes}
                    onChange={e => setAdminNotes(e.target.value)}
                    rows={3}
                    className="border-2 border-gray-300 rounded-lg"
                    placeholder={t('admin.visaManagement.internalNotesPlaceholder')}
                  />
                </div>
                <Button
                  onClick={handleUpdateNotes}
                  disabled={updateNotesMutation.isPending}
                  variant="outline"
                  className="border-2 border-gray-300 rounded-lg"
                >
                  {updateNotesMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('admin.visaManagement.savingButton')}</>
                  ) : t('admin.visaManagement.saveNotesButton')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
