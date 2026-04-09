import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus,
  RefreshCw,
  Pause,
  Play,
  Trash2,
  Bell,
  BellOff,
  ArrowLeft,
  ExternalLink,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Search,
  Eye,
  Loader2,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────
type ViewMode = "list" | "alerts" | "detail";

// ── Main Component ───────────────────────────────────────────
export default function CompetitorMonitorTab() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedTourId, setSelectedTourId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCompetitor, setFilterCompetitor] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const handleViewDetail = (tourId: number) => {
    setSelectedTourId(tourId);
    setViewMode("detail");
  };

  return (
    <div className="space-y-6">
      {viewMode === "list" && (
        <TourListView
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filterCompetitor={filterCompetitor}
          setFilterCompetitor={setFilterCompetitor}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          onViewDetail={handleViewDetail}
          onViewAlerts={() => setViewMode("alerts")}
        />
      )}
      {viewMode === "alerts" && (
        <AlertsView onBack={() => setViewMode("list")} />
      )}
      {viewMode === "detail" && selectedTourId && (
        <DetailView
          tourId={selectedTourId}
          onBack={() => setViewMode("list")}
        />
      )}
    </div>
  );
}

// ── 6A: Tour List View ───────────────────────────────────────
function TourListView({
  searchQuery,
  setSearchQuery,
  filterCompetitor,
  setFilterCompetitor,
  filterStatus,
  setFilterStatus,
  onViewDetail,
  onViewAlerts,
}: {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  filterCompetitor: string;
  setFilterCompetitor: (v: string) => void;
  filterStatus: string;
  setFilterStatus: (v: string) => void;
  onViewDetail: (id: number) => void;
  onViewAlerts: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.competitor.list.useQuery({
    search: searchQuery || undefined,
    competitor: filterCompetitor !== "all" ? filterCompetitor : undefined,
    scrapeStatus: filterStatus !== "all" ? filterStatus : undefined,
  });
  const { data: unreadCount } = trpc.competitor.unreadAlertCount.useQuery();

  const triggerScrape = trpc.competitor.triggerScrape.useMutation({
    onSuccess: () => {
      toast.success("爬取任務已加入佇列");
      utils.competitor.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateTour = trpc.competitor.update.useMutation({
    onSuccess: () => {
      toast.success("已更新");
      utils.competitor.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteTour = trpc.competitor.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      utils.competitor.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />;
      case "paused":
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500" />;
      case "error":
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />;
      default:
        return null;
    }
  };

  const competitorLabel = (c: string) => {
    switch (c) {
      case "liontravel": return "雄獅旅遊";
      case "colatour": return "可樂旅遊";
      case "settour": return "東南旅遊";
      default: return c;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-900">競品監控</h2>
          <button
            onClick={onViewAlerts}
            className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Bell className="h-5 w-5 text-gray-600" />
            {typeof unreadCount === "number" && unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        </div>
        <AddTourDialog />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="搜尋行程名稱或目的地..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 rounded-lg"
          />
        </div>
        <Select value={filterCompetitor} onValueChange={setFilterCompetitor}>
          <SelectTrigger className="w-[140px] rounded-lg">
            <SelectValue placeholder="競爭對手" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="liontravel">雄獅旅遊</SelectItem>
            <SelectItem value="colatour">可樂旅遊</SelectItem>
            <SelectItem value="settour">東南旅遊</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[120px] rounded-lg">
            <SelectValue placeholder="狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="active">監控中</SelectItem>
            <SelectItem value="paused">已暫停</SelectItem>
            <SelectItem value="error">錯誤</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : !data?.tours?.length ? (
        <div className="text-center py-12 text-gray-500">
          <Search className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">尚無監控行程</p>
          <p className="text-sm mt-1">點擊「新增監控」開始追蹤競品行程</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/60">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">行程名稱</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">競爭對手</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">目的地</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">天數</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">最新價格</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">上次爬取</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">狀態</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.tours.map((tour: any) => (
                  <tr
                    key={tour.id}
                    className="border-b last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                    onClick={() => onViewDetail(tour.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 line-clamp-1 max-w-[280px]">
                        {tour.tourTitle || "（未命名）"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="rounded-md text-xs">
                        {competitorLabel(tour.competitor)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{tour.destination || "—"}</td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {tour.duration ? `${tour.duration}天` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {tour.basePrice
                        ? `NT$ ${tour.basePrice.toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {tour.lastScrapedAt
                        ? new Date(tour.lastScrapedAt).toLocaleString("zh-TW")
                        : "尚未爬取"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {statusIcon(tour.scrapeStatus)}
                        <span className="text-xs text-gray-500">
                          {tour.scrapeStatus === "active" ? "監控中" : tour.scrapeStatus === "paused" ? "已暫停" : "錯誤"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => triggerScrape.mutate({ id: tour.id })}
                          disabled={triggerScrape.isPending}
                          title="立即爬取"
                        >
                          <RefreshCw className={`h-4 w-4 ${triggerScrape.isPending ? "animate-spin" : ""}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() =>
                            updateTour.mutate({
                              id: tour.id,
                              scrapeStatus: tour.scrapeStatus === "active" ? "paused" : "active",
                            })
                          }
                          title={tour.scrapeStatus === "active" ? "暫停" : "恢復"}
                        >
                          {tour.scrapeStatus === "active" ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                          onClick={() => {
                            if (confirm("確定要刪除此監控行程？")) {
                              deleteTour.mutate({ id: tour.id });
                            }
                          }}
                          title="刪除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.pageSize && (
            <div className="px-4 py-3 border-t text-sm text-gray-500 text-center">
              顯示 {data.tours.length} / {data.total} 筆
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 6B: Add Tour Dialog ──────────────────────────────────────
function AddTourDialog() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [competitor, setCompetitor] = useState<"liontravel" | "colatour" | "settour">("liontravel");
  const [frequency, setFrequency] = useState<"6h" | "12h" | "daily" | "weekly">("daily");
  const [notes, setNotes] = useState("");

  const createTour = trpc.competitor.create.useMutation({
    onSuccess: (tour) => {
      toast.success("已新增監控行程，正在執行第一次爬取...");
      utils.competitor.list.invalidate();
      setOpen(false);
      setUrl("");
      setNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!url.trim()) {
      toast.error("請輸入行程 URL");
      return;
    }
    createTour.mutate({
      tourUrl: url.trim(),
      competitor,
      scrapeFrequency: frequency,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white">
          <Plus className="h-4 w-4 mr-1.5" />
          新增監控
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-xl max-w-md">
        <DialogHeader>
          <DialogTitle>新增競品監控</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">行程 URL</label>
            <Input
              placeholder="https://travel.liontravel.com/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="rounded-lg"
            />
            <p className="text-xs text-gray-400 mt-1">貼上雄獅旅遊的行程頁面網址</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">競爭對手</label>
            <Select value={competitor} onValueChange={(v: any) => setCompetitor(v)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="liontravel">雄獅旅遊</SelectItem>
                <SelectItem value="colatour">可樂旅遊</SelectItem>
                <SelectItem value="settour">東南旅遊</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">爬取頻率</label>
            <Select value={frequency} onValueChange={(v: any) => setFrequency(v)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6h">每 6 小時</SelectItem>
                <SelectItem value="12h">每 12 小時</SelectItem>
                <SelectItem value="daily">每天</SelectItem>
                <SelectItem value="weekly">每週</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">備註（選填）</label>
            <Textarea
              placeholder="例如：主要競品、需特別關注..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-lg resize-none"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" className="rounded-lg">取消</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={createTour.isPending || !url.trim()}
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white"
          >
            {createTour.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            新增並開始爬取
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 6C: Alerts View ──────────────────────────────────────────
function AlertsView({ onBack }: { onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.competitor.alerts.useQuery({ pageSize: 50 });

  const markRead = trpc.competitor.markAlertRead.useMutation({
    onSuccess: () => {
      utils.competitor.alerts.invalidate();
      utils.competitor.unreadAlertCount.invalidate();
    },
  });

  const markAllRead = trpc.competitor.markAllAlertsRead.useMutation({
    onSuccess: () => {
      toast.success("已全部標為已讀");
      utils.competitor.alerts.invalidate();
      utils.competitor.unreadAlertCount.invalidate();
    },
  });

  const severityConfig = (severity: string) => {
    switch (severity) {
      case "critical":
        return { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" };
      case "warning":
        return { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200" };
      default:
        return { icon: Info, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" };
    }
  };

  const alertTypeIcon = (type: string) => {
    if (type.includes("price_drop")) return <TrendingDown className="h-4 w-4" />;
    if (type.includes("price_increase")) return <TrendingUp className="h-4 w-4" />;
    if (type === "sold_out") return <AlertCircle className="h-4 w-4" />;
    if (type === "guaranteed") return <CheckCircle2 className="h-4 w-4" />;
    return <Bell className="h-4 w-4" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="rounded-lg">
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h2 className="text-xl font-bold text-gray-900">告警列表</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
        >
          <BellOff className="h-4 w-4 mr-1.5" />
          全部標為已讀
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : !data?.alerts?.length ? (
        <div className="text-center py-12 text-gray-500">
          <Bell className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">暫無告警</p>
          <p className="text-sm mt-1">當競品行程有價格或座位變動時，告警會出現在這裡</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.alerts.map((alert: any) => {
            const config = severityConfig(alert.severity);
            const Icon = config.icon;
            return (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-4 rounded-xl border ${config.border} ${config.bg} ${
                  !alert.isRead ? "ring-1 ring-offset-1 ring-gray-200" : "opacity-75"
                }`}
              >
                <div className={`mt-0.5 ${config.color}`}>
                  {alertTypeIcon(alert.alertType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 text-sm">{alert.title}</span>
                    {!alert.isRead && (
                      <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                    )}
                  </div>
                  {alert.message && (
                    <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{alert.message}</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">
                    {new Date(alert.createdAt).toLocaleString("zh-TW")}
                  </p>
                </div>
                {!alert.isRead && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs rounded-md"
                    onClick={() => markRead.mutate({ alertId: alert.id })}
                  >
                    已讀
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 6D: Detail View ──────────────────────────────────────────
function DetailView({ tourId, onBack }: { tourId: number; onBack: () => void }) {
  const { data, isLoading } = trpc.competitor.getById.useQuery({ id: tourId });
  const { data: priceHistory } = trpc.competitor.priceHistory.useQuery({
    competitorTourId: tourId,
    limit: 50,
  });
  const { data: alertsData } = trpc.competitor.alerts.useQuery({
    competitorTourId: tourId,
    pageSize: 20,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>找不到此行程</p>
        <Button variant="outline" className="mt-3 rounded-lg" onClick={onBack}>
          返回列表
        </Button>
      </div>
    );
  }

  const { tour, departures } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="rounded-lg">
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <h2 className="text-xl font-bold text-gray-900 line-clamp-1">
          {tour.tourTitle || "（未命名行程）"}
        </h2>
        {tour.tourUrl && (
          <a
            href={tour.tourUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal-600 hover:text-teal-700"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCard label="目的地" value={tour.destination || "—"} />
        <InfoCard label="天數" value={tour.duration ? `${tour.duration} 天` : "—"} />
        <InfoCard
          label="最新基準價"
          value={tour.basePrice ? `NT$ ${tour.basePrice.toLocaleString()}` : "—"}
        />
        <InfoCard
          label="上次爬取"
          value={
            tour.lastScrapedAt
              ? new Date(tour.lastScrapedAt).toLocaleString("zh-TW")
              : "尚未爬取"
          }
        />
      </div>

      {/* Departures Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50/60">
          <h3 className="font-semibold text-gray-900">出團日期</h3>
        </div>
        {!departures?.length ? (
          <div className="px-4 py-8 text-center text-gray-500 text-sm">尚無出團資料</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/30">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">出發日期</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">回程日期</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">大人價</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">小孩價</th>
                  <th className="text-center px-4 py-2.5 font-medium text-gray-600">剩餘座位</th>
                  <th className="text-center px-4 py-2.5 font-medium text-gray-600">狀態</th>
                </tr>
              </thead>
              <tbody>
                {departures.map((dep: any) => (
                  <tr key={dep.id} className="border-b last:border-0 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-900">{dep.departureDate}</td>
                    <td className="px-4 py-2.5 text-gray-600">{dep.returnDate || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {dep.adultPrice ? `NT$ ${dep.adultPrice.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {dep.childPrice ? `NT$ ${dep.childPrice.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {dep.availableSeats !== null ? (
                        <span
                          className={`font-medium ${
                            dep.availableSeats <= 3
                              ? "text-red-600"
                              : dep.availableSeats <= 8
                              ? "text-yellow-600"
                              : "text-green-600"
                          }`}
                        >
                          {dep.availableSeats}
                          {dep.totalSeats ? ` / ${dep.totalSeats}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <DepartureStatusBadge status={dep.departureStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Price History */}
      {priceHistory && priceHistory.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50/60">
            <h3 className="font-semibold text-gray-900">價格變動紀錄</h3>
          </div>
          <div className="p-4">
            <PriceHistoryChart history={priceHistory} />
          </div>
        </div>
      )}

      {/* Alerts for this tour */}
      {alertsData?.alerts && alertsData.alerts.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50/60">
            <h3 className="font-semibold text-gray-900">歷史告警</h3>
          </div>
          <div className="divide-y">
            {alertsData.alerts.map((alert: any) => (
              <div key={alert.id} className="px-4 py-3 flex items-start gap-3">
                <SeverityDot severity={alert.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                  {alert.message && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{alert.message}</p>
                  )}
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {new Date(alert.createdAt).toLocaleString("zh-TW")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper Components ────────────────────────────────────────

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="font-semibold text-gray-900 text-sm">{value}</p>
    </div>
  );
}

function DepartureStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    open: { label: "可報名", className: "bg-green-100 text-green-700" },
    full: { label: "已滿團", className: "bg-red-100 text-red-700" },
    cancelled: { label: "已取消", className: "bg-gray-100 text-gray-600" },
    guaranteed: { label: "確認出團", className: "bg-blue-100 text-blue-700" },
  };
  const c = config[status] || config.open;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "critical"
      ? "bg-red-500"
      : severity === "warning"
      ? "bg-yellow-500"
      : "bg-blue-500";
  return <span className={`inline-block w-2 h-2 rounded-full mt-1.5 ${color}`} />;
}

function PriceHistoryChart({ history }: { history: any[] }) {
  // Simple SVG line chart for price history
  if (!history.length) return null;

  const sorted = [...history].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  const prices = sorted.map((h) => h.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;

  const width = 600;
  const height = 180;
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const points = sorted.map((h, i) => {
    const x = padding.left + (i / Math.max(sorted.length - 1, 1)) * chartW;
    const y = padding.top + chartH - ((h.price - minPrice) / range) * chartH;
    return { x, y, ...h };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[600px]">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartH * (1 - ratio);
          const price = minPrice + range * ratio;
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e5e7eb"
                strokeDasharray="4 2"
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="text-[10px] fill-gray-400">
                {Math.round(price).toLocaleString()}
              </text>
            </g>
          );
        })}
        {/* Line */}
        <path d={pathD} fill="none" stroke="#0D9488" strokeWidth="2" />
        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="#0D9488" />
        ))}
        {/* Change indicators */}
        {points.map((p, i) => {
          if (p.changeType === "decrease") {
            return (
              <circle key={`change-${i}`} cx={p.x} cy={p.y} r="5" fill="none" stroke="#ef4444" strokeWidth="1.5" />
            );
          }
          if (p.changeType === "increase") {
            return (
              <circle key={`change-${i}`} cx={p.x} cy={p.y} r="5" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
            );
          }
          return null;
        })}
      </svg>
      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-teal-600 inline-block" /> 價格走勢
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border-2 border-red-500 inline-block" /> 降價
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border-2 border-yellow-500 inline-block" /> 漲價
        </span>
      </div>
    </div>
  );
}
