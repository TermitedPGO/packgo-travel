/**
 * InvoicesTab — admin view of customer invoices.
 *
 * Lists all invoices with status filter; admin can view the HTML invoice
 * (served via R2 URL or DB-fallback /api/invoices/:id/view) and update status.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { LoadingRow } from "@/components/ui/spinner";
import { ExternalLink, FileText, Calendar, Mail } from "lucide-react";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export default function InvoicesTab() {
  const { language, t } = useLocale();
  const dateLocale = language === "zh-TW" ? zhTW : enUS;
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");

  const utils = trpc.useUtils();
  const { data: invoices, isLoading } = trpc.invoices.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 100,
    offset: 0,
  });

  const updateStatusMutation = trpc.invoices.updateStatus.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate();
      toast.success(t("invoicesTab.toastStatusUpdated"));
    },
    onError: (err) => toast.error(t("invoicesTab.toastFailed") + err.message),
  });

  const statusConfig: Record<string, { label: string; className: string }> = {
    draft: { label: t("invoicesTab.statusDraft"), className: "bg-gray-100 text-gray-700 border border-gray-200" },
    sent: { label: t("invoicesTab.statusSent"), className: "bg-blue-100 text-blue-800 border border-blue-200" },
    paid: { label: t("invoicesTab.statusPaid"), className: "bg-green-100 text-green-800 border border-green-200" },
    overdue: { label: t("invoicesTab.statusOverdue"), className: "bg-red-100 text-red-800 border border-red-200" },
    cancelled: { label: t("invoicesTab.statusCancelled"), className: "bg-gray-100 text-gray-500 border border-gray-200" },
  };

  const fmtDate = (d: Date | string | null) => {
    if (!d) return "—";
    try {
      return format(new Date(d), "yyyy/MM/dd", { locale: dateLocale });
    } catch {
      return "—";
    }
  };

  const fmtMoney = (amt: string | number, currency: string) => {
    const n = typeof amt === "string" ? parseFloat(amt) : amt;
    if (Number.isNaN(n)) return "—";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${currency} ${n.toLocaleString()}`;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("invoicesTab.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {t("invoicesTab.subtitle")}
          </p>
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40 rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("invoicesTab.filterAll")}</SelectItem>
            <SelectItem value="draft">{t("invoicesTab.statusDraft")}</SelectItem>
            <SelectItem value="sent">{t("invoicesTab.statusSent")}</SelectItem>
            <SelectItem value="paid">{t("invoicesTab.statusPaid")}</SelectItem>
            <SelectItem value="overdue">{t("invoicesTab.statusOverdue")}</SelectItem>
            <SelectItem value="cancelled">{t("invoicesTab.statusCancelled")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("invoicesTab.colInvoiceNumber")}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("invoicesTab.colCustomer")}</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("invoicesTab.colTotal")}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("invoicesTab.colStatus")}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("invoicesTab.colIssuedAt")}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("invoicesTab.colPaidAt")}</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("invoicesTab.colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <LoadingRow colSpan={7} />}
              {!isLoading && (!invoices || invoices.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    {t("invoicesTab.emptyList")}
                  </td>
                </tr>
              )}
              {invoices?.map((inv: any) => {
                const status = statusConfig[inv.status] || statusConfig.draft;
                return (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm text-gray-900">{inv.invoiceNumber}</div>
                      <div className="text-xs text-gray-500">#{inv.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{inv.customerName}</div>
                      {inv.customerEmail && (
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {inv.customerEmail}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-sm font-semibold text-gray-900">
                        {fmtMoney(inv.totalAmount, inv.currency || "USD")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={inv.status}
                        onValueChange={(v) =>
                          updateStatusMutation.mutate({ id: inv.id, status: v as any })
                        }
                      >
                        <SelectTrigger className={`w-28 h-7 text-xs rounded-md ${status.className}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">{t("invoicesTab.statusDraft")}</SelectItem>
                          <SelectItem value="sent">{t("invoicesTab.statusSent")}</SelectItem>
                          <SelectItem value="paid">{t("invoicesTab.statusPaid")}</SelectItem>
                          <SelectItem value="overdue">{t("invoicesTab.statusOverdue")}</SelectItem>
                          <SelectItem value="cancelled">{t("invoicesTab.statusCancelled")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-700 flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-gray-400" />
                        {fmtDate(inv.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-700">
                        {inv.paidAt ? fmtDate(inv.paidAt) : <span className="text-gray-400">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {inv.pdfUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(inv.pdfUrl, "_blank")}
                            className="rounded-lg gap-1"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            {t("invoicesTab.actionView")}
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
