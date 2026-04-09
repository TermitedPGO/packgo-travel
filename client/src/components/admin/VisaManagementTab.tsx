import { useState } from "react";
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
  CheckCircle,
  Clock,
  XCircle,
  FileText,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, { zh: string; color: string }> = {
  draft:               { zh: "草稿",       color: "bg-gray-100 text-gray-700" },
  submitted:           { zh: "已提交",     color: "bg-blue-100 text-blue-700" },
  paid:                { zh: "已付款",     color: "bg-emerald-100 text-emerald-700" },
  documents_received:  { zh: "文件已收到", color: "bg-cyan-100 text-cyan-700" },
  processing:          { zh: "處理中",     color: "bg-yellow-100 text-yellow-700" },
  approved:            { zh: "已核准",     color: "bg-green-100 text-green-700" },
  rejected:            { zh: "已拒絕",     color: "bg-red-100 text-red-700" },
  completed:           { zh: "已完成",     color: "bg-purple-100 text-purple-700" },
  cancelled:           { zh: "已取消",     color: "bg-gray-100 text-gray-500" },
};

const ALL_STATUSES = Object.keys(STATUS_LABELS);

export default function VisaManagementTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateNote, setUpdateNote] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: stats } = trpc.visa.adminStats.useQuery();
  const { data: listData, isLoading, refetch } = trpc.visa.adminListApplications.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    page,
    pageSize: 20,
  });

  const updateStatusMutation = trpc.visa.adminUpdateStatus.useMutation({
    onSuccess: () => {
      toast.success("狀態已更新", { description: "簽證申請狀態已成功更新。" });
      refetch();
      setDialogOpen(false);
    },
    onError: (err) => {
      toast.error("更新失敗", { description: err.message });
    },
  });

  const updateNotesMutation = trpc.visa.adminUpdateNotes.useMutation({
    onSuccess: () => {
      toast.success("備註已更新");
      refetch();
    },
    onError: (err) => {
      toast.error("更新失敗", { description: err.message });
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

  return (
    <div className="space-y-8">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "總申請數", value: stats.total, color: "text-gray-900" },
            { label: "待處理", value: stats.pending, color: "text-blue-600" },
            { label: "處理中", value: stats.processing, color: "text-yellow-600" },
            { label: "已核准", value: stats.approved, color: "text-green-600" },
          ].map((s, i) => (
            <div key={i} className="border border-gray-200 p-4">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-sm text-gray-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-bold">狀態篩選</Label>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 border-2 border-gray-300 rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {ALL_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]?.zh ?? s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          className="border-2 border-gray-300 rounded-none"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          重新整理
        </Button>
        <span className="text-sm text-gray-500 ml-auto">共 {total} 筆</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : applications.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>目前沒有符合條件的申請</p>
        </div>
      ) : (
        <div className="border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-bold">編號</th>
                <th className="px-4 py-3 text-left font-bold">申請人</th>
                <th className="px-4 py-3 text-left font-bold">護照國籍</th>
                <th className="px-4 py-3 text-left font-bold">簽證類型</th>
                <th className="px-4 py-3 text-left font-bold">金額</th>
                <th className="px-4 py-3 text-left font-bold">狀態</th>
                <th className="px-4 py-3 text-left font-bold">申請日期</th>
                <th className="px-4 py-3 text-left font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app: any) => {
                const statusCfg = STATUS_LABELS[app.applicationStatus] ?? { zh: app.applicationStatus, color: "bg-gray-100 text-gray-700" };
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
                      <div className="text-gray-500 text-xs">{app.entryType} · {app.processingSpeed}</div>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      USD ${Number(app.totalAmount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${statusCfg.color}`}>
                        {statusCfg.zh}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(app.createdAt).toLocaleDateString("zh-TW")}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDialog(app)}
                        className="border border-gray-300 rounded-none text-xs"
                      >
                        管理
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
            className="border-2 border-gray-300 rounded-none"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-gray-600">第 {page} / {totalPages} 頁</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="border-2 border-gray-300 rounded-none"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              管理簽證申請 #{selectedApp?.id}
            </DialogTitle>
          </DialogHeader>

          {selectedApp && (
            <div className="space-y-6">
              {/* Applicant info */}
              <div className="border border-gray-200">
                <div className="bg-gray-50 px-4 py-2 font-bold text-sm border-b border-gray-200">申請人資訊</div>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      { label: "姓名", value: `${selectedApp.firstName} ${selectedApp.lastName}` },
                      { label: "電子郵件", value: selectedApp.email },
                      { label: "電話", value: selectedApp.phone },
                      { label: "護照號碼", value: selectedApp.passportNumber },
                      { label: "護照國籍", value: selectedApp.passportCountry },
                      { label: "護照到期日", value: selectedApp.passportExpiry },
                      { label: "出生日期", value: selectedApp.dateOfBirth },
                      { label: "簽證類型", value: selectedApp.visaType },
                      { label: "入境次數", value: selectedApp.entryType },
                      { label: "處理速度", value: selectedApp.processingSpeed },
                      { label: "申請人數", value: selectedApp.groupSize },
                      { label: "總金額", value: `USD $${Number(selectedApp.totalAmount).toFixed(2)}` },
                      { label: "付款狀態", value: selectedApp.paymentStatus },
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
                <Label className="font-bold">更新申請狀態</Label>
                <Select value={updateStatus} onValueChange={setUpdateStatus}>
                  <SelectTrigger className="border-2 border-gray-300 rounded-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]?.zh ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div>
                  <Label className="text-sm mb-1 block">備註（選填，將發送給申請人）</Label>
                  <Textarea
                    value={updateNote}
                    onChange={e => setUpdateNote(e.target.value)}
                    rows={2}
                    className="border-2 border-gray-300 rounded-none"
                    placeholder="例如：文件已收到，正在審核中..."
                  />
                </div>
                <Button
                  onClick={handleUpdateStatus}
                  disabled={updateStatusMutation.isPending}
                  className="bg-black text-white hover:bg-gray-800 rounded-none"
                >
                  {updateStatusMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />更新中...</>
                  ) : "更新狀態"}
                </Button>
              </div>

              {/* Admin notes */}
              <div className="space-y-3 pt-4 border-t border-gray-200">
                <Label className="font-bold">內部備註 & 追蹤號碼</Label>
                <div>
                  <Label className="text-sm mb-1 block">追蹤號碼（核准後填寫）</Label>
                  <Input
                    value={trackingNumber}
                    onChange={e => setTrackingNumber(e.target.value)}
                    className="border-2 border-gray-300 rounded-none font-mono"
                    placeholder="例如：CN2024-001234"
                  />
                </div>
                <div>
                  <Label className="text-sm mb-1 block">內部備註</Label>
                  <Textarea
                    value={adminNotes}
                    onChange={e => setAdminNotes(e.target.value)}
                    rows={3}
                    className="border-2 border-gray-300 rounded-none"
                    placeholder="僅限內部查看的備註..."
                  />
                </div>
                <Button
                  onClick={handleUpdateNotes}
                  disabled={updateNotesMutation.isPending}
                  variant="outline"
                  className="border-2 border-gray-300 rounded-none"
                >
                  {updateNotesMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />儲存中...</>
                  ) : "儲存備註"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
