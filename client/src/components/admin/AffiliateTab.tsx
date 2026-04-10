import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ExternalLink, TrendingUp, MousePointerClick, Plane, Hotel, BarChart3, Plus, Pencil, Trash2 } from "lucide-react";

// ─── Stats Cards ─────────────────────────────────────────────────────────────
function StatsCards({ days }: { days: number }) {
  const { data: stats, isLoading } = trpc.affiliate.getStats.useQuery({ days });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-4 bg-gray-200 rounded mb-3 w-2/3" />
            <div className="h-8 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    { label: "總點擊數", value: stats?.totalClicks ?? 0, icon: MousePointerClick, color: "text-blue-600" },
    { label: "機票點擊", value: stats?.byPlatform?.trip_flights ?? 0, icon: Plane, color: "text-sky-600" },
    { label: "飯店點擊", value: stats?.byPlatform?.trip_hotels ?? 0, icon: Hotel, color: "text-amber-600" },
    { label: "熱門來源數", value: stats?.topReferrers?.length ?? 0, icon: TrendingUp, color: "text-green-600" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {cards.map((card, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <card.icon className={`h-4 w-4 ${card.color}`} />
            <p className="text-sm text-gray-500">{card.label}</p>
          </div>
          <p className="text-3xl font-bold text-gray-900">{card.value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Click Log ───────────────────────────────────────────────────────────────
function ClickLog() {
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const { data: clicks, isLoading } = trpc.affiliate.getClicks.useQuery({
    platform,
    limit: 100,
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <MousePointerClick className="h-4 w-4" /> 點擊記錄
        </h3>
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700"
          value={platform ?? ""}
          onChange={e => setPlatform(e.target.value || undefined)}
        >
          <option value="">全部平台</option>
          <option value="trip_flights">Trip.com 機票</option>
          <option value="trip_hotels">Trip.com 飯店</option>
        </select>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-gray-400">載入中...</div>
      ) : !clicks || clicks.length === 0 ? (
        <div className="p-8 text-center text-gray-400">尚無點擊記錄</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>時間</TableHead>
                <TableHead>平台</TableHead>
                <TableHead>來源頁面</TableHead>
                <TableHead>目標 URL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clicks.map((click: any) => (
                <TableRow key={click.id}>
                  <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                    {new Date(click.createdAt).toLocaleString("zh-TW")}
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      click.platform === "trip_flights"
                        ? "bg-sky-100 text-sky-700"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {click.platform === "trip_flights" ? "✈️ 機票" : "🏨 飯店"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">{click.referrerPage || "-"}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    <a
                      href={click.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline flex items-center gap-1"
                    >
                      {click.targetUrl} <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Price Comparison Management ─────────────────────────────────────────────
function PriceComparisonForm({
  tourId,
  existing,
  onSuccess,
}: {
  tourId: number;
  existing?: any;
  onSuccess: () => void;
}) {
  const utils = trpc.useUtils();
  const upsertMutation = trpc.affiliate.upsertPriceComparison.useMutation({
    onSuccess: () => {
      toast.success("價格比較資料已儲存");
      utils.affiliate.getPriceComparisons.invalidate();
      onSuccess();
    },
    onError: (err) => toast.error(`儲存失敗：${err.message}`),
  });

  const [form, setForm] = useState({
    flightEstimate: existing?.flightEstimate ?? "",
    hotelEstimate: existing?.hotelEstimate ?? "",
    activityEstimate: existing?.activityEstimate ?? "",
    mealEstimate: existing?.mealEstimate ?? "",
    transportEstimate: existing?.transportEstimate ?? "",
    otherEstimate: existing?.otherEstimate ?? "",
    flightSource: existing?.flightSource ?? "",
    hotelSource: existing?.hotelSource ?? "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    upsertMutation.mutate({
      tourId,
      flightEstimate: form.flightEstimate ? Number(form.flightEstimate) : undefined,
      hotelEstimate: form.hotelEstimate ? Number(form.hotelEstimate) : undefined,
      activityEstimate: form.activityEstimate ? Number(form.activityEstimate) : undefined,
      mealEstimate: form.mealEstimate ? Number(form.mealEstimate) : undefined,
      transportEstimate: form.transportEstimate ? Number(form.transportEstimate) : undefined,
      otherEstimate: form.otherEstimate ? Number(form.otherEstimate) : undefined,
      flightSource: form.flightSource || undefined,
      hotelSource: form.hotelSource || undefined,
    });
  };

  const fields = [
    { key: "flightEstimate", label: "✈️ 機票估算 (NT$)" },
    { key: "hotelEstimate", label: "🏨 飯店估算 (NT$)" },
    { key: "activityEstimate", label: "🎟 景點門票估算 (NT$)" },
    { key: "mealEstimate", label: "🍜 餐飲估算 (NT$)" },
    { key: "transportEstimate", label: "🚌 當地交通估算 (NT$)" },
    { key: "otherEstimate", label: "📦 其他費用估算 (NT$)" },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {fields.map((f) => (
          <div key={f.key}>
            <Label className="text-sm mb-1 block">{f.label}</Label>
            <Input
              type="number"
              placeholder="0"
              value={(form as any)[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm mb-1 block">機票資料來源</Label>
          <Input
            placeholder="如 Trip.com 查詢"
            value={form.flightSource}
            onChange={e => setForm(prev => ({ ...prev, flightSource: e.target.value }))}
          />
        </div>
        <div>
          <Label className="text-sm mb-1 block">飯店資料來源</Label>
          <Input
            placeholder="如 Trip.com 查詢"
            value={form.hotelSource}
            onChange={e => setForm(prev => ({ ...prev, hotelSource: e.target.value }))}
          />
        </div>
      </div>
      <Button type="submit" disabled={upsertMutation.isPending} className="w-full">
        {upsertMutation.isPending ? "儲存中..." : "儲存"}
      </Button>
    </form>
  );
}

function PriceComparisonManagement() {
  const utils = trpc.useUtils();
  const { data: comparisons, isLoading } = trpc.affiliate.getPriceComparisons.useQuery();
  const deleteMutation = trpc.affiliate.deletePriceComparison.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      utils.affiliate.getPriceComparisons.invalidate();
    },
    onError: (err) => toast.error(`刪除失敗：${err.message}`),
  });
  const [addTourId, setAddTourId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> 行程自助 vs. 跟團費用比較管理
        </h3>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex items-center gap-1">
              <Plus className="h-4 w-4" /> 新增
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新增價格比較資料</DialogTitle>
            </DialogHeader>
            <div className="mb-4">
              <Label className="text-sm mb-1 block">行程 ID</Label>
              <Input
                type="number"
                placeholder="輸入行程 ID"
                value={addTourId}
                onChange={e => setAddTourId(e.target.value)}
              />
            </div>
            {addTourId && (
              <PriceComparisonForm
                tourId={Number(addTourId)}
                onSuccess={() => setAddOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-gray-400">載入中...</div>
      ) : !comparisons || comparisons.length === 0 ? (
        <div className="p-8 text-center text-gray-400">尚無價格比較資料，請點擊「新增」建立</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>行程 ID</TableHead>
                <TableHead>機票估算</TableHead>
                <TableHead>飯店估算</TableHead>
                <TableHead>自助總計</TableHead>
                <TableHead>最後更新</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisons.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">#{item.tourId}</TableCell>
                  <TableCell>{item.flightEstimate ? `NT$ ${item.flightEstimate.toLocaleString()}` : "-"}</TableCell>
                  <TableCell>{item.hotelEstimate ? `NT$ ${item.hotelEstimate.toLocaleString()}` : "-"}</TableCell>
                  <TableCell className="font-bold">
                    {item.totalSelfBook ? `NT$ ${item.totalSelfBook.toLocaleString()}` : "-"}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {new Date(item.lastUpdated).toLocaleDateString("zh-TW")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Dialog open={editItem?.id === item.id} onOpenChange={(open) => !open && setEditItem(null)}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" onClick={() => setEditItem(item)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>編輯行程 #{item.tourId} 價格比較</DialogTitle>
                          </DialogHeader>
                          <PriceComparisonForm
                            tourId={item.tourId}
                            existing={item}
                            onSuccess={() => setEditItem(null)}
                          />
                        </DialogContent>
                      </Dialog>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => {
                          if (confirm(`確定刪除行程 #${item.tourId} 的比較資料？`)) {
                            deleteMutation.mutate({ tourId: item.tourId });
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Main AffiliateTab ────────────────────────────────────────────────────────
export default function AffiliateTab() {
  const [days, setDays] = useState(30);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">聯盟行銷管理</h2>
          <p className="text-sm text-gray-500 mt-1">Trip.com 聯盟點擊追蹤與自助 vs. 跟團費用比較</p>
        </div>
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700"
          value={days}
          onChange={e => setDays(Number(e.target.value))}
        >
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
          <option value={90}>近 90 天</option>
        </select>
      </div>

      {/* Stats */}
      <StatsCards days={days} />

      {/* Click Log */}
      <ClickLog />

      {/* Price Comparison Management */}
      <PriceComparisonManagement />
    </div>
  );
}
