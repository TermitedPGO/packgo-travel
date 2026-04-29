/**
 * PosterGenPanel — v78z-z3 Sprint 11 (Image 2.0 Phase A v0).
 *
 * Admin UI for tour poster generation. Pick a tour, optionally tweak the
 * theme prompt, click Generate. Backend runs gpt-image-2 → Sharp overlay
 * → R2 → returns signed URL. Card shows preview + download + cost.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Sparkles, Download, RefreshCw, AlertCircle, DollarSign } from "lucide-react";
import { toast } from "sonner";

export default function PosterGenPanel() {
  const { t } = useLocale();
  const [tourId, setTourId] = useState<number | null>(null);
  const [theme, setTheme] = useState("");
  const [language, setLanguage] = useState<"zh-TW" | "en">("zh-TW");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);

  const { data: tours } = trpc.tours.list.useQuery();
  const { data: costStatus, refetch: refetchCost } = trpc.posterGen.getCostStatus.useQuery();

  const generateMutation = trpc.posterGen.generate.useMutation({
    onSuccess: (data) => {
      setPosterUrl(data.posterUrl);
      setLastCost(data.costUsd);
      setLastDurationMs(data.durationMs);
      toast.success(t("posterGen.toastGenerated", { cost: data.costUsd.toFixed(3) }));
      refetchCost();
    },
    onError: (err) => {
      toast.error(t("posterGen.toastFailed") + " " + err.message);
    },
  });

  const handleGenerate = () => {
    if (!tourId) {
      toast.error(t("posterGen.toastPickTour"));
      return;
    }
    generateMutation.mutate({
      tourId,
      themePrompt: theme || undefined,
      language,
      quality,
    });
  };

  const todaySpend = costStatus?.todaySpend ?? 0;
  const todayCount = costStatus?.todayCount ?? 0;
  const monthSpend = costStatus?.monthSpend ?? 0;
  const monthCount = costStatus?.monthCount ?? 0;
  const dailyBudget = costStatus?.dailyBudget ?? 5;
  const monthlyBudget = costStatus?.monthlyBudget ?? 50;
  const dailyPct = (todaySpend / dailyBudget) * 100;
  const monthlyPct = (monthSpend / monthlyBudget) * 100;

  return (
    <div className="space-y-6">
      {/* Header + cost surface */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("posterGen.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">{t("posterGen.subtitle")}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1 justify-end">
              <DollarSign className="h-3 w-3" /> {t("posterGen.todaySpend")}
            </p>
            <p className={`text-lg font-bold tabular-nums ${dailyPct > 80 ? "text-red-600" : "text-gray-900"}`}>
              ${todaySpend.toFixed(2)} / ${dailyBudget.toFixed(0)}
            </p>
            <p className="text-xs text-gray-500">{t("posterGen.imagesCount", { n: String(todayCount) })}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{t("posterGen.monthSpend")}</p>
            <p className={`text-lg font-bold tabular-nums ${monthlyPct > 80 ? "text-red-600" : "text-gray-900"}`}>
              ${monthSpend.toFixed(2)} / ${monthlyBudget.toFixed(0)}
            </p>
            <p className="text-xs text-gray-500">{t("posterGen.imagesCount", { n: String(monthCount) })}</p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Tour picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              {t("posterGen.selectTour")}
            </label>
            <Select value={tourId ? String(tourId) : ""} onValueChange={(v) => setTourId(parseInt(v))}>
              <SelectTrigger className="rounded-lg">
                <SelectValue placeholder={t("posterGen.tourPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {(tours || [])
                  .filter((tour: any) => tour.status === "active")
                  .slice(0, 50)
                  .map((tour: any) => (
                    <SelectItem key={tour.id} value={String(tour.id)}>
                      #{tour.id} · {(tour.title || "").split(/[|｜]/)[0].trim()}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Language */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              {t("posterGen.language")}
            </label>
            <Select value={language} onValueChange={(v) => setLanguage(v as any)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-TW">繁體中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Quality */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              {t("posterGen.quality")}
            </label>
            <Select value={quality} onValueChange={(v) => setQuality(v as any)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">{t("posterGen.qualityLow")}</SelectItem>
                <SelectItem value="medium">{t("posterGen.qualityMedium")}</SelectItem>
                <SelectItem value="high">{t("posterGen.qualityHigh")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Theme prompt */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
            {t("posterGen.themePromptLabel")}
            <span className="ml-2 text-gray-400 font-normal">{t("posterGen.themePromptHint")}</span>
          </label>
          <textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder={t("posterGen.themePlaceholder")}
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            {t("posterGen.estimateHint", {
              cost: quality === "low" ? "$0.02" : quality === "high" ? "$0.30" : "$0.07",
            })}
          </p>
          <Button
            onClick={handleGenerate}
            disabled={!tourId || generateMutation.isPending}
            className="rounded-lg gap-2"
          >
            {generateMutation.isPending ? (
              <>
                <Spinner className="h-4 w-4" />
                {t("posterGen.generating")}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {t("posterGen.generate")}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Result */}
      {posterUrl && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                {t("posterGen.preview")}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {lastCost !== null && t("posterGen.previewMeta", {
                  cost: lastCost.toFixed(3),
                  duration: lastDurationMs ? Math.round(lastDurationMs / 1000) + "s" : "—",
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
                className="rounded-lg gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                {t("posterGen.regenerate")}
              </Button>
              <a
                href={posterUrl}
                download={`packgo-poster-${tourId}-${Date.now()}.png`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button className="rounded-lg gap-1.5">
                  <Download className="h-4 w-4" />
                  {t("posterGen.download")}
                </Button>
              </a>
            </div>
          </div>
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex justify-center">
            <img
              src={posterUrl}
              alt="Generated poster"
              className="max-w-full max-h-[80vh] rounded-lg shadow-lg"
            />
          </div>
        </div>
      )}

      {/* Recent generations log */}
      {costStatus?.recentLogs && costStatus.recentLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-3">
            {t("posterGen.recent")}
          </h3>
          <div className="divide-y divide-gray-100">
            {costStatus.recentLogs.map((log: any) => (
              <div key={log.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {log.status === "errored" ? (
                    <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-teal-500 flex-shrink-0" />
                  )}
                  <span className="text-gray-900 truncate">
                    Tour #{log.tourId} · {log.quality}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-gray-500 tabular-nums">${log.costUsd.toFixed(3)}</span>
                  <span className="text-xs text-gray-400">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
