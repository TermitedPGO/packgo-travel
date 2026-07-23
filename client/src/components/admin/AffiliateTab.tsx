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
import { ExternalLink, Home, MousePointerClick, Plane, Hotel, BarChart3, Plus, Pencil, Trash2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

// ─── Stats Cards ─────────────────────────────────────────────────────────────
function StatsCards({ days }: { days: number }) {
  const { t } = useLocale();
  const { data: stats, isLoading } = trpc.affiliate.getStats.useQuery({ days });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-4 bg-gray-200 rounded-md mb-3 w-2/3" />
            <div className="h-8 bg-gray-200 rounded-md w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  // Phase 1 is homepage-only clickout, so trip_homepage is the live category;
  // trip_flights / trip_hotels remain for pre-Phase-1 legacy rows. The old
  // "top referrers" card was dropped: referrerPage now stores the closed source
  // enum, not page paths.
  const cards = [
    { label: t('admin.affiliateTab.statTotalClicks'),    value: stats?.totalClicks ?? 0,               icon: MousePointerClick, color: "text-blue-600" },
    { label: t('admin.affiliateTab.statHomepageClicks'), value: stats?.byPlatform?.trip_homepage ?? 0, icon: Home,              color: "text-green-600" },
    { label: t('admin.affiliateTab.statFlightClicks'),   value: stats?.byPlatform?.trip_flights ?? 0,  icon: Plane,             color: "text-sky-600" },
    { label: t('admin.affiliateTab.statHotelClicks'),    value: stats?.byPlatform?.trip_hotels ?? 0,   icon: Hotel,             color: "text-amber-600" },
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
  const { t, language } = useLocale();
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const { data: clicks, isLoading } = trpc.affiliate.getClicks.useQuery({
    platform,
    limit: 100,
  });

  const localeArg = language === 'en' ? 'en-US' : 'zh-TW';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <MousePointerClick className="h-4 w-4" /> {t('admin.affiliateTab.clickLogTitle')}
        </h3>
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700"
          value={platform ?? ""}
          onChange={e => setPlatform(e.target.value || undefined)}
        >
          <option value="">{t('admin.affiliateTab.allPlatforms')}</option>
          <option value="trip_homepage">{t('admin.affiliateTab.platformHomepage')}</option>
          <option value="trip_flights">{t('admin.affiliateTab.platformFlights')}</option>
          <option value="trip_hotels">{t('admin.affiliateTab.platformHotels')}</option>
        </select>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-gray-400">{t('admin.affiliateTab.loading')}</div>
      ) : !clicks || clicks.length === 0 ? (
        <div className="p-8 text-center text-gray-400">{t('admin.affiliateTab.emptyClicks')}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.affiliateTab.colTime')}</TableHead>
                <TableHead>{t('admin.affiliateTab.colPlatform')}</TableHead>
                <TableHead>{t('admin.affiliateTab.colReferrer')}</TableHead>
                <TableHead>{t('admin.affiliateTab.colTargetUrl')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clicks.map((click: any) => (
                <TableRow key={click.id}>
                  <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                    {new Date(click.createdAt).toLocaleString(localeArg)}
                  </TableCell>
                  <TableCell>
                    {/* Three-way badge: a trip_homepage row must read as Homepage,
                        never get mislabeled as Hotel by a binary fallback. */}
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      click.platform === "trip_flights"
                        ? "bg-sky-100 text-sky-700"
                        : click.platform === "trip_hotels"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-green-100 text-green-700"
                    }`}>
                      {click.platform === "trip_flights"
                        ? t('admin.affiliateTab.badgeFlights')
                        : click.platform === "trip_hotels"
                          ? t('admin.affiliateTab.badgeHotels')
                          : t('admin.affiliateTab.badgeHomepage')}
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
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const upsertMutation = trpc.affiliate.upsertPriceComparison.useMutation({
    onSuccess: () => {
      toast.success(t('admin.affiliateTab.toastSaved'));
      utils.affiliate.getPriceComparisons.invalidate();
      onSuccess();
    },
    onError: (err) => toast.error(t('admin.affiliateTab.toastSaveFailed', { err: err.message })),
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
    { key: "flightEstimate",    label: t('admin.affiliateTab.fieldFlight') },
    { key: "hotelEstimate",     label: t('admin.affiliateTab.fieldHotel') },
    { key: "activityEstimate",  label: t('admin.affiliateTab.fieldActivity') },
    { key: "mealEstimate",      label: t('admin.affiliateTab.fieldMeal') },
    { key: "transportEstimate", label: t('admin.affiliateTab.fieldTransport') },
    { key: "otherEstimate",     label: t('admin.affiliateTab.fieldOther') },
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
              className="rounded-lg"
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm mb-1 block">{t('admin.affiliateTab.flightSourceLabel')}</Label>
          <Input
            placeholder={t('admin.affiliateTab.sourcePlaceholder')}
            value={form.flightSource}
            onChange={e => setForm(prev => ({ ...prev, flightSource: e.target.value }))}
            className="rounded-lg"
          />
        </div>
        <div>
          <Label className="text-sm mb-1 block">{t('admin.affiliateTab.hotelSourceLabel')}</Label>
          <Input
            placeholder={t('admin.affiliateTab.sourcePlaceholder')}
            value={form.hotelSource}
            onChange={e => setForm(prev => ({ ...prev, hotelSource: e.target.value }))}
            className="rounded-lg"
          />
        </div>
      </div>
      <Button type="submit" disabled={upsertMutation.isPending} className="w-full rounded-lg">
        {upsertMutation.isPending ? t('admin.affiliateTab.savingButton') : t('admin.affiliateTab.saveButton')}
      </Button>
    </form>
  );
}

function PriceComparisonManagement() {
  const { t, language } = useLocale();
  const utils = trpc.useUtils();
  const { data: comparisons, isLoading } = trpc.affiliate.getPriceComparisons.useQuery();
  const deleteMutation = trpc.affiliate.deletePriceComparison.useMutation({
    onSuccess: () => {
      toast.success(t('admin.affiliateTab.toastDeleted'));
      utils.affiliate.getPriceComparisons.invalidate();
    },
    onError: (err) => toast.error(t('admin.affiliateTab.toastDeleteFailed', { err: err.message })),
  });
  const [addTourId, setAddTourId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const localeArg = language === 'en' ? 'en-US' : 'zh-TW';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> {t('admin.affiliateTab.priceSectionTitle')}
        </h3>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex items-center gap-1 rounded-lg">
              <Plus className="h-4 w-4" /> {t('admin.affiliateTab.addButton')}
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-xl">
            <DialogHeader>
              <DialogTitle>{t('admin.affiliateTab.addDialogTitle')}</DialogTitle>
            </DialogHeader>
            <div className="mb-4">
              <Label className="text-sm mb-1 block">{t('admin.affiliateTab.tourIdLabel')}</Label>
              <Input
                type="number"
                placeholder={t('admin.affiliateTab.tourIdPlaceholder')}
                value={addTourId}
                onChange={e => setAddTourId(e.target.value)}
                className="rounded-lg"
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
        <div className="p-8 text-center text-gray-400">{t('admin.affiliateTab.loading')}</div>
      ) : !comparisons || comparisons.length === 0 ? (
        <div className="p-8 text-center text-gray-400">{t('admin.affiliateTab.emptyComparisons')}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.affiliateTab.colTourId')}</TableHead>
                <TableHead>{t('admin.affiliateTab.colFlightEst')}</TableHead>
                <TableHead>{t('admin.affiliateTab.colHotelEst')}</TableHead>
                <TableHead>{t('admin.affiliateTab.colSelfTotal')}</TableHead>
                <TableHead>{t('admin.affiliateTab.colLastUpdated')}</TableHead>
                <TableHead>{t('admin.affiliateTab.colActions')}</TableHead>
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
                    {new Date(item.lastUpdated).toLocaleDateString(localeArg)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Dialog open={editItem?.id === item.id} onOpenChange={(open) => !open && setEditItem(null)}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => setEditItem(item)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="rounded-xl">
                          <DialogHeader>
                            <DialogTitle>{t('admin.affiliateTab.editDialogTitle', { id: String(item.tourId) })}</DialogTitle>
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
                        className="text-red-600 border-red-200 hover:bg-red-50 rounded-lg"
                        onClick={() => {
                          if (confirm(t('admin.affiliateTab.deleteConfirm', { id: String(item.tourId) }))) {
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
  const { t } = useLocale();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t('admin.affiliateTab.title')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('admin.affiliateTab.subtitle')}</p>
        </div>
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700"
          value={days}
          onChange={e => setDays(Number(e.target.value))}
        >
          <option value={7}>{t('admin.affiliateTab.days7')}</option>
          <option value={30}>{t('admin.affiliateTab.days30')}</option>
          <option value={90}>{t('admin.affiliateTab.days90')}</option>
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
