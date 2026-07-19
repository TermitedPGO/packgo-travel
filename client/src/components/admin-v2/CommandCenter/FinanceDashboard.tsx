/**
 * FinanceDashboard — 指揮中心 財務頁 dashboard (P4).
 *
 * 1A0a(plan v4.3 §4.2 E2/E3):「下載報稅 CSV」與 AI 財務顧問整段撤除,改
 * 「口徑收斂前停用」卡 —— 稅 CSV 是未經 CPA 裁定的正式稅務產品;advisor 內部
 * 讀第二套 P&L(financialReportService)。對應 procedures(downloadTaxCsv /
 * askFinanceAdvisor)由 1A0b 封鎖,advisor 待 1B 接 truth service 後另批復啟。
 * 保留:「一鍵掃描」(runFinanceAlerts,偵測性提醒非財務真值出口)。
 *
 * All strings via t(). Rounded corners per CLAUDE.md §2.1.
 */
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { KPIStrip, type KPI } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Lock, ScanSearch } from "lucide-react";

export default function FinanceDashboard() {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  const runAlerts = trpc.commandCenter.runFinanceAlerts.useMutation();

  // ── KPI tiles ─────────────────────────────────────────────────────────

  const kpis: KPI[] = [
    {
      label: t("admin.commandCenter.finDashOperating"),
      value: t("admin.commandCenter.finDashComingSoon"),
      tone: "muted" as const,
    },
    {
      label: t("admin.commandCenter.finDashTrust"),
      value: t("admin.commandCenter.finDashComingSoon"),
      tone: "muted" as const,
    },
    {
      label: t("admin.commandCenter.finDashEstimatedTax"),
      value: t("admin.commandCenter.finDashComingSoon"),
      tone: "muted" as const,
    },
    {
      label: t("admin.commandCenter.finDashUnclassified"),
      value: t("admin.commandCenter.finDashComingSoon"),
      tone: "muted" as const,
    },
  ];

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleScan() {
    try {
      const res = await runAlerts.mutateAsync();
      toast.success(
        t("admin.commandCenter.finScanResult", { n: String(res.produced) }),
      );
      utils.commandCenter.list.invalidate();
      utils.commandCenter.stats.invalidate();
    } catch {
      toast.error(t("admin.commandCenter.toastError"));
    }
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
          {t("admin.commandCenter.finDashTitle")}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleScan}
            disabled={runAlerts.isPending}
            className="h-8 rounded-lg gap-1.5"
          >
            <ScanSearch className="h-3.5 w-3.5" />
            {t("admin.commandCenter.finDashScan")}
          </Button>
        </div>
      </div>

      {/* KPI tiles (v1: placeholder — service doesn't expose balance directly) */}
      <KPIStrip items={kpis} />

      {/* 1A0a:稅 CSV 下載與 AI 財務顧問停用卡 */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/40 p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
          <Lock className="h-3.5 w-3.5" />
          {t("admin.commandCenter.finBlockedTitle")}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          {t("admin.commandCenter.finBlockedDesc")}
        </p>
      </div>
    </div>
  );
}
