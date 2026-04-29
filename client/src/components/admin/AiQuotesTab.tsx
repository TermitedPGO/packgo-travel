/**
 * AiQuotesTab — admin view of v78 AI Quote Generator funnel.
 *
 * Lists generated quotes with status filter, lets admin open the PDF/HTML and
 * mark converted (links a quote to a booking). Insertions/updates happen
 * through aiQuotes.adminList / aiQuotes.adminMarkConverted tRPC procs.
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { LoadingRow } from "@/components/ui/spinner";
import { ExternalLink, FileText, CheckCircle2, Mail, Phone, Calendar } from "lucide-react";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

type QuoteStatus = "generated" | "sent" | "viewed" | "converted" | "expired";

export default function AiQuotesTab() {
  const { language } = useLocale();
  const dateLocale = language === "zh-TW" ? zhTW : enUS;
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "all">("all");
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [bookingIdInput, setBookingIdInput] = useState("");

  const utils = trpc.useUtils();
  const { data: quotes, isLoading } = trpc.aiQuotes.adminList.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 100,
    offset: 0,
  });

  const markConvertedMutation = trpc.aiQuotes.adminMarkConverted.useMutation({
    onSuccess: () => {
      utils.aiQuotes.adminList.invalidate();
      toast.success("已標記為轉單");
      setConvertingId(null);
      setBookingIdInput("");
    },
    onError: (err) => toast.error("更新失敗：" + err.message),
  });

  const statusConfig: Record<string, { label: string; className: string }> = {
    generated: { label: "已生成", className: "bg-blue-100 text-blue-800 border border-blue-200" },
    sent: { label: "已寄出", className: "bg-indigo-100 text-indigo-800 border border-indigo-200" },
    viewed: { label: "已開啟", className: "bg-purple-100 text-purple-800 border border-purple-200" },
    converted: { label: "已轉單", className: "bg-green-100 text-green-800 border border-green-200" },
    expired: { label: "已過期", className: "bg-gray-100 text-gray-600 border border-gray-200" },
  };

  const fmtDate = (d: Date | string | null) => {
    if (!d) return "—";
    try {
      return format(new Date(d), "yyyy/MM/dd HH:mm", { locale: dateLocale });
    } catch {
      return "—";
    }
  };

  const fmtMoney = (amt: number | null, currency: string) => {
    if (amt == null) return "—";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
      }).format(amt);
    } catch {
      return `${currency} ${amt.toLocaleString()}`;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI 報價單</h2>
          <p className="text-sm text-gray-500 mt-1">
            客戶透過 AI 報價產生器送出的詢價，全自動產出 PDF 後追蹤轉單。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-40 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部狀態</SelectItem>
              <SelectItem value="generated">已生成</SelectItem>
              <SelectItem value="sent">已寄出</SelectItem>
              <SelectItem value="viewed">已開啟</SelectItem>
              <SelectItem value="converted">已轉單</SelectItem>
              <SelectItem value="expired">已過期</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">報價單</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">客戶</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">需求摘要</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">估算</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">狀態</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">建立時間</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <LoadingRow colSpan={7} />}
              {!isLoading && (!quotes || quotes.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    目前沒有符合條件的報價單
                  </td>
                </tr>
              )}
              {quotes?.map((q: any) => {
                let params: any = {};
                try {
                  params = q.extractedParams ? JSON.parse(q.extractedParams) : {};
                } catch {}
                const summary = [
                  params.destinationCountry || params.destinationCity,
                  params.days ? `${params.days}天` : null,
                  params.adults ? `${params.adults}大${params.children ? "+" + params.children + "小" : ""}` : null,
                  params.budgetMax ? `預算 ${params.currency || "USD"} ${params.budgetMax}` : null,
                ].filter(Boolean).join(" · ");
                const status = statusConfig[q.status] || statusConfig.generated;
                return (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm text-gray-900">{q.quoteNumber}</div>
                      <div className="text-xs text-gray-500">#{q.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{q.customerName || "匿名"}</div>
                      {q.customerEmail && (
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {q.customerEmail}
                        </div>
                      )}
                      {q.customerPhone && (
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {q.customerPhone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <div className="text-sm text-gray-700 line-clamp-2">{summary || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-sm font-semibold text-gray-900">
                        {fmtMoney(q.estimatedTotal, q.currency || "USD")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-700 flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-gray-400" />
                        {fmtDate(q.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {q.pdfUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(q.pdfUrl, "_blank")}
                            className="rounded-lg gap-1"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            查看
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        )}
                        {q.status !== "converted" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConvertingId(q.id)}
                            className="rounded-lg gap-1"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            標記轉單
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

      <Dialog open={!!convertingId} onOpenChange={(o) => !o && setConvertingId(null)}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle>標記為已轉單</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              請輸入對應的訂單 ID（在訂單管理中可以找到），系統會把這張報價單與該訂單關聯。
            </p>
            <Input
              type="number"
              placeholder="訂單 ID"
              value={bookingIdInput}
              onChange={(e) => setBookingIdInput(e.target.value)}
              className="rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                className="rounded-lg"
                onClick={() => {
                  setConvertingId(null);
                  setBookingIdInput("");
                }}
              >
                取消
              </Button>
              <Button
                className="rounded-lg"
                disabled={!bookingIdInput || markConvertedMutation.isPending}
                onClick={() => {
                  if (!convertingId || !bookingIdInput) return;
                  markConvertedMutation.mutate({
                    quoteId: convertingId,
                    bookingId: parseInt(bookingIdInput, 10),
                  });
                }}
              >
                確認標記
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
