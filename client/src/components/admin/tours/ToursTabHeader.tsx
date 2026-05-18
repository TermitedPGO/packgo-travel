/**
 * ToursTabHeader — title row + action buttons (manual + AI primary) + 4 stat tiles.
 *
 * Round 80.10 redesign:
 * - AI 自動生成 is the PRIMARY action with gold sparkle + 推薦 badge
 * - 手動新增 is outline secondary
 * - 4 stat tiles below: 上架中 / 草稿 / 精選 / 本月轉換
 *
 * Round 80.21 — merge:
 * - Jeff's complaint: 「整批匯入」+「AI 自動生成」 confused users with two
 *   parallel buttons doing similar mental work ("add tours"). Merged into
 *   ONE primary "新增行程" button — the dialog itself surfaces 3 mode chips
 *   (URL / PDF / 整批) so the user picks INSIDE the flow, not outside.
 *   `onBulkImport` prop kept for back-compat but no longer renders a button.
 *
 * Brand baseline (CLAUDE.md):
 * - rounded-xl on tile cards, rounded-lg on buttons
 * - Only foreground/white/gold (#c9a563/#8a6f3a) — no purple/blue/etc
 */
import { useLocale } from "@/contexts/LocaleContext";
import { Plus, Sparkles, Eye, Edit, Star, Clock } from "lucide-react";

type Stats = {
  active: number;
  draft: number;
  featured: number;
  /** Round 80.14: count of tours created in the last 7 days. Replaced the
   *  unwired conversion-rate placeholder. */
  recent: number;
};

interface ToursTabHeaderProps {
  total: number;
  stats: Stats;
  onAddManual: () => void;
  /** Opens the unified create dialog (URL / PDF / bulk import). */
  onAddAi: () => void;
  /** @deprecated Round 80.21 — bulk import is now a tab inside onAddAi's dialog. Kept for back-compat. */
  onBulkImport?: () => void;
}

export function ToursTabHeader({
  total,
  stats,
  onAddManual,
  onAddAi,
}: ToursTabHeaderProps) {
  const { t } = useLocale();

  return (
    <div className="space-y-6">
      {/* Title + actions */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {t("toursTab.title")}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {t("toursTab.subtitle")}
            <span className="ml-2 text-gray-400">
              {t("toursTab.totalCount").replace("{count}", String(total))}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddManual}
            className="flex items-center gap-2 h-10 px-4 text-sm font-medium text-foreground border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("toursTab.addTour")}
          </button>
          {/* Round 80.21: single primary CTA — dialog itself surfaces
              URL / PDF / 整批 mode chips so the user picks inside the flow.
              Replaces the previous two-button layout (整批匯入 + AI 自動生成). */}
          <button
            type="button"
            onClick={onAddAi}
            className="relative flex items-center gap-2 h-10 px-5 text-sm font-semibold bg-foreground text-white rounded-lg hover:bg-foreground/85 transition-colors shadow-sm"
          >
            <Sparkles className="w-4 h-4 text-[#c9a563]" />
            新增行程
            <span className="absolute -top-2 -right-2 bg-[#c9a563] text-foreground text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full">
              {t("toursTab.aiRecommendedBadge")}
            </span>
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={<Eye className="w-3.5 h-3.5 text-foreground" />}
          label={t("toursTab.statActiveLabel")}
          value={stats.active}
          sub={t("toursTab.statActiveSub")}
        />
        <StatTile
          icon={<Edit className="w-3.5 h-3.5 text-foreground/60" />}
          label={t("toursTab.statDraftLabel")}
          value={stats.draft}
          sub={t("toursTab.statDraftSub")}
        />
        <StatTile
          icon={<Star className="w-3.5 h-3.5 text-[#c9a563]" />}
          label={t("toursTab.statFeaturedLabel")}
          value={stats.featured}
          sub={t("toursTab.statFeaturedSub")}
        />
        <StatTile
          icon={<Clock className="w-3.5 h-3.5 text-foreground" />}
          label={t("toursTab.statRecentLabel")}
          value={stats.recent}
          sub={t("toursTab.statRecentSub")}
        />
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:border-foreground/30 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}
