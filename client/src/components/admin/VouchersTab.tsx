/**
 * VouchersTab — Round 80.22 Phase G admin moderation for reward vouchers.
 *
 * Tracks the lifecycle of every issued voucher (flight credit, photo book,
 * etc.). Admin marks 'issued' → 'redeemed' when the voucher is consumed
 * (e.g., applied to a flight booking). Filter by status / type for triage.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { LoadingRow } from "@/components/ui/spinner";
import { Ticket, Plane, BookOpen, Loader2, Check, Copy } from "lucide-react";
import { toast } from "sonner";

const TYPE_LABEL: Record<string, { label: string; icon: any }> = {
  flight_credit: { label: "機票券", icon: Plane },
  photo_book: { label: "相簿券", icon: BookOpen },
  tour_credit: { label: "行程券", icon: Ticket },
};
const STATUS_LABEL: Record<string, string> = {
  issued: "可使用",
  redeemed: "已使用",
  expired: "已過期",
  voided: "已作廢",
};
const STATUS_COLOR: Record<string, string> = {
  issued: "bg-green-100 text-green-800",
  redeemed: "bg-gray-100 text-gray-700",
  expired: "bg-red-100 text-red-800",
  voided: "bg-red-100 text-red-800",
};

export default function VouchersTab() {
  const [statusFilter, setStatusFilter] = useState<
    "issued" | "redeemed" | "expired" | "voided" | "all"
  >("issued");
  const [typeFilter, setTypeFilter] = useState<
    "flight_credit" | "photo_book" | "tour_credit" | "all"
  >("all");
  const [selected, setSelected] = useState<any | null>(null);
  const [bookingIdInput, setBookingIdInput] = useState("");
  const [notesInput, setNotesInput] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.vouchers.adminList.useQuery({
    status: statusFilter,
    type: typeFilter,
    limit: 100,
  });
  const vouchers = data?.items ?? [];

  const markRedeemedMutation = trpc.vouchers.adminMarkRedeemed.useMutation({
    onSuccess: () => {
      toast.success("已標記為已使用");
      utils.vouchers.adminList.invalidate();
      setSelected(null);
      setBookingIdInput("");
      setNotesInput("");
    },
    onError: (e) => toast.error(e.message),
  });

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`複製 ${code}`);
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Ticket className="h-6 w-6 text-[#c9a563]" />
            Voucher 管理
          </h2>
          <p className="text-sm text-foreground/60 mt-1">
            客人用 Packpoint 兌換的 voucher,使用後標記已用
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger className="w-[120px] rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="issued">可使用</SelectItem>
              <SelectItem value="redeemed">已使用</SelectItem>
              <SelectItem value="expired">已過期</SelectItem>
              <SelectItem value="voided">已作廢</SelectItem>
              <SelectItem value="all">全部</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
            <SelectTrigger className="w-[120px] rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部類型</SelectItem>
              <SelectItem value="flight_credit">機票券</SelectItem>
              <SelectItem value="photo_book">相簿券</SelectItem>
              <SelectItem value="tour_credit">行程券</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingRow />
          ) : vouchers.length === 0 ? (
            <div className="p-16 text-center">
              <Ticket className="h-12 w-12 text-gray-200 mx-auto mb-4" />
              <h3 className="text-base font-semibold text-gray-700 mb-1">尚無此狀態 voucher</h3>
              <p className="text-sm text-gray-400">客人在 /rewards 兌換後會出現在此</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-5 py-3 text-left">代碼</th>
                    <th className="px-5 py-3 text-left">類型</th>
                    <th className="px-5 py-3 text-left">客人</th>
                    <th className="px-5 py-3 text-right">金額</th>
                    <th className="px-5 py-3 text-right">點數</th>
                    <th className="px-5 py-3 text-left">狀態</th>
                    <th className="px-5 py-3 text-left">過期</th>
                    <th className="px-5 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vouchers.map((v) => {
                    const cfg = TYPE_LABEL[v.type] ?? TYPE_LABEL.tour_credit;
                    const Icon = cfg.icon;
                    return (
                      <tr key={v.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-xs">{v.code}</code>
                            <button
                              type="button"
                              onClick={() => copyCode(v.code)}
                              className="text-foreground/40 hover:text-foreground"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1 text-xs">
                            <Icon className="h-3.5 w-3.5 text-[#8a6f3a]" />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="text-foreground font-medium">{v.authorName || "—"}</div>
                          <div className="text-xs text-foreground/60">{v.authorEmail}</div>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">
                          ${v.amountUsd}
                        </td>
                        <td className="px-5 py-3 text-right text-foreground/60 tabular-nums">
                          {v.pointsCost.toLocaleString()}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${
                              STATUS_COLOR[v.status] ?? "bg-gray-100"
                            }`}
                          >
                            {STATUS_LABEL[v.status] ?? v.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-foreground/60">
                          {new Date(v.expiresAt).toLocaleDateString("zh-TW")}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {v.status === "issued" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg"
                              onClick={() => setSelected(v)}
                            >
                              標記已用
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg"
                              onClick={() => setSelected(v)}
                            >
                              查看
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail / mark-redeemed dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="rounded-xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Voucher 詳情</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60 text-sm">代碼</span>
                  <code className="font-mono text-sm font-semibold">{selected.code}</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60 text-sm">客人</span>
                  <span className="text-sm">{selected.authorEmail}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60 text-sm">類型</span>
                  <span className="text-sm">
                    {TYPE_LABEL[selected.type]?.label ?? selected.type}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60 text-sm">面額 / 點數</span>
                  <span className="text-sm">
                    ${selected.amountUsd} ({selected.pointsCost.toLocaleString()} pt)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60 text-sm">建立 / 過期</span>
                  <span className="text-xs text-foreground/70">
                    {new Date(selected.createdAt).toLocaleDateString("zh-TW")} →{" "}
                    {new Date(selected.expiresAt).toLocaleDateString("zh-TW")}
                  </span>
                </div>
                {selected.redeemedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/60 text-sm">已使用</span>
                    <span className="text-sm">
                      {new Date(selected.redeemedAt).toLocaleString("zh-TW")}
                      {selected.redeemedAgainstBookingId && (
                        <> · Booking #{selected.redeemedAgainstBookingId}</>
                      )}
                    </span>
                  </div>
                )}
                {selected.notes && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-foreground/70">
                    {selected.notes}
                  </div>
                )}

                {selected.status === "issued" && (
                  <div className="border-t pt-4 space-y-3">
                    <p className="text-xs font-semibold text-foreground/70">標記為已使用:</p>
                    <Input
                      type="number"
                      placeholder="關聯 Booking ID(選填)"
                      value={bookingIdInput}
                      onChange={(e) => setBookingIdInput(e.target.value)}
                      className="rounded-lg"
                    />
                    <Textarea
                      placeholder="備註(例:套用到 booking #123,折抵 $250)"
                      value={notesInput}
                      onChange={(e) => setNotesInput(e.target.value)}
                      rows={2}
                      className="rounded-lg"
                      maxLength={500}
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)} className="rounded-lg">
                  關閉
                </Button>
                {selected.status === "issued" && (
                  <Button
                    onClick={() =>
                      markRedeemedMutation.mutate({
                        voucherId: selected.id,
                        bookingId: bookingIdInput
                          ? parseInt(bookingIdInput, 10)
                          : undefined,
                        notes: notesInput || undefined,
                      })
                    }
                    disabled={markRedeemedMutation.isPending}
                    className="bg-foreground hover:bg-foreground/90 text-white rounded-lg"
                  >
                    {markRedeemedMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    確認已使用
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
