/**
 * FinanceDashboard — 指揮中心 財務頁 dashboard (P4).
 *
 * Rendered above the 審核箱 when the "finance" lane is selected. Shows:
 *   - 4 KPI tiles (v1: placeholder values with "coming soon" where needed)
 *   - "一鍵掃描" button → runs all 5 finance alert checks
 *   - "下載報稅 CSV" button → triggers browser download
 *   - Simple AI advisor chat input
 *
 * All strings via t(). Rounded corners per CLAUDE.md §2.1.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { KPIStrip, type KPI } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DollarSign,
  Download,
  MessageSquare,
  RefreshCw,
  ScanSearch,
  Send,
  Shield,
} from "lucide-react";

export default function FinanceDashboard() {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  const [question, setQuestion] = useState("");
  const [advisorAnswer, setAdvisorAnswer] = useState<string | null>(null);

  const runAlerts = trpc.commandCenter.runFinanceAlerts.useMutation();
  const askAdvisor = trpc.commandCenter.askFinanceAdvisor.useMutation();
  const downloadCsv = trpc.commandCenter.downloadTaxCsv.useMutation();

  const busy = runAlerts.isPending || askAdvisor.isPending || downloadCsv.isPending;

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
        res.skipped > 0
          ? t("admin.commandCenter.finScanResultSkipped", {
              n: String(res.produced),
              skipped: String(res.skipped),
            })
          : t("admin.commandCenter.finScanResult", { n: String(res.produced) }),
      );
      utils.commandCenter.list.invalidate();
      utils.commandCenter.stats.invalidate();
    } catch {
      toast.error(t("admin.commandCenter.toastError"));
    }
  }

  async function handleDownloadCsv() {
    try {
      const year = new Date().getFullYear();
      const res = await downloadCsv.mutateAsync({ year });
      // Trigger browser download
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("admin.commandCenter.finCsvDownloaded"));
    } catch {
      toast.error(t("admin.commandCenter.toastError"));
    }
  }

  async function handleAskAdvisor() {
    const q = question.trim();
    if (!q) return;
    try {
      const res = await askAdvisor.mutateAsync({ question: q });
      setAdvisorAnswer(res.answer);
      setQuestion("");
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
            disabled={busy}
            className="h-8 rounded-lg gap-1.5"
          >
            <ScanSearch className="h-3.5 w-3.5" />
            {t("admin.commandCenter.finDashScan")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadCsv}
            disabled={busy}
            className="h-8 rounded-lg gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            {t("admin.commandCenter.finDashDownloadCsv")}
          </Button>
        </div>
      </div>

      {/* KPI tiles (v1: placeholder — service doesn't expose balance directly) */}
      <KPIStrip items={kpis} />

      {/* AI Advisor */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
          <MessageSquare className="h-3.5 w-3.5" />
          {t("admin.commandCenter.finAdvisorTitle")}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("admin.commandCenter.finAdvisorPlaceholder")}
            className="h-8 rounded-lg text-xs flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAskAdvisor();
              }
            }}
          />
          <Button
            variant="default"
            size="sm"
            onClick={handleAskAdvisor}
            disabled={busy || !question.trim()}
            className="h-8 rounded-lg gap-1.5"
          >
            {askAdvisor.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {/* Answer */}
        {advisorAnswer && (
          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">
              {advisorAnswer}
            </pre>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-[11px] text-gray-400 flex items-center gap-1">
          <Shield className="h-3 w-3" />
          {t("admin.commandCenter.finAdvisorDisclaimer")}
        </p>
      </div>
    </div>
  );
}
