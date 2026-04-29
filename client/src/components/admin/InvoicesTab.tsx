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
  const { language } = useLocale();
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
      toast.success("狀態已更新");
    },
    onError: (err) => toast.error("失敗：" + err.message),
  });

  const statusConfig: Record<string, { label: string; className: string }> = {
    draft: { label: "草稿", className: "bg-gray-100 text-gray-700 border border-gray-200" },
    sent: { label: "已寄送", className: "bg-blue-100 text-blue-800 border border-blue-200" },
    paid: { label: "已付款", className: "bg-green-100 text-green-800 border border-green-200" },
    overdue: { label: "逾期", className: "bg-red-100 text-red-800 border border-red-200" },
    cancelled: { label: "已取消", className: "bg-gray-100 text-gray-500 border border-gray-200" },
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
          <h2 className="text-2xl font-bold text-gray-900">發票管理</h2>
          <p className="text-sm text-gray-500 mt-1">
            所有客戶發票一覽，可即時開啟 HTML 版發票，並更新付款狀態。
          </p>
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40 rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="draft">草稿</SelectItem>
            <SelectItem value="sent">已寄送</SelectItem>
            <SelectItem value="paid">已付款</SelectItem>
            <SelectItem value="overdue">逾期</SelectItem>
            <SelectItem value="cancelled">已取消</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">發票號</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">客戶</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">總金額</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">狀態</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">開立日</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">付款日</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <LoadingRow colSpan={7} />}
              {!isLoading && (!invoices || invoices.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    目前沒有符合條件的發票
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
                          <SelectItem value="draft">草稿</SelectItem>
                          <SelectItem value="sent">已寄送</SelectItem>
                          <SelectItem value="paid">已付款</SelectItem>
                          <SelectItem value="overdue">逾期</SelectItem>
                          <SelectItem value="cancelled">已取消</SelectItem>
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
                            查看
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
