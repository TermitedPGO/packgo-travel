/**
 * ReviewsTab — Round 80.22 Phase E.
 *
 * Wired to live tRPC data: reviews.adminList paginated query, plus
 * adminApprove / adminReject / adminHide mutations. Approved reviews
 * automatically award +50 Packpoint to the author (server-side).
 *
 * Filter pills along the top let admin focus on `pending` queue first
 * (the moderation backlog), then drill into approved / rejected / hidden
 * for retroactive cleanup.
 */
import { Button } from "@/components/ui/button";
import { Star, Check, X, EyeOff, Loader2 } from "lucide-react";
import { LoadingRow } from "@/components/ui/spinner";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "hidden";

export default function ReviewsTab() {
  const { t } = useLocale();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selected, setSelected] = useState<any | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.reviews.adminList.useQuery({
    status: statusFilter,
    limit: 50,
  });
  const reviews = data?.items ?? [];

  const approveMutation = trpc.reviews.adminApprove.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.awarded > 0
          ? `已通過 — 作者獲得 +${res.awarded} Packpoint`
          : "已通過(此評論先前曾通過,未重發點數)"
      );
      utils.reviews.adminList.invalidate();
      setSelected(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const rejectMutation = trpc.reviews.adminReject.useMutation({
    onSuccess: () => {
      toast.success("已拒絕並通知作者");
      utils.reviews.adminList.invalidate();
      setSelected(null);
      setRejectionReason("");
    },
    onError: (e) => toast.error(e.message),
  });
  const hideMutation = trpc.reviews.adminHide.useMutation({
    onSuccess: () => {
      toast.success("已隱藏");
      utils.reviews.adminList.invalidate();
      setSelected(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      pending: { label: "待審核", className: "bg-yellow-100 text-yellow-800" },
      approved: { label: "已通過", className: "bg-green-100 text-green-800" },
      rejected: { label: "已拒絕", className: "bg-red-100 text-red-800" },
      hidden: { label: "已隱藏", className: "bg-gray-100 text-gray-700" },
    };
    const cfg = map[status] || { label: status, className: "bg-gray-100 text-gray-700" };
    return (
      <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${cfg.className}`}>
        {cfg.label}
      </span>
    );
  };

  const ratingStars = (rating: number) => (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-4 w-4 ${s <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">客戶評價審核</h2>
          <p className="text-sm text-gray-500 mt-1">
            通過後自動發 +50 Packpoint。共 {reviews.length} 則
          </p>
        </div>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-[160px] border-gray-300 rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">待審核</SelectItem>
            <SelectItem value="approved">已通過</SelectItem>
            <SelectItem value="rejected">已拒絕</SelectItem>
            <SelectItem value="hidden">已隱藏</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Reviews Table */}
      <div className="bg-white border border-gray-200 overflow-hidden rounded-xl">
        {isLoading ? (
          <LoadingRow />
        ) : reviews.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">作者</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">行程</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">評分</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">標題</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">狀態</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reviews.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm text-gray-900">
                      <div className="font-medium">{r.authorName || "—"}</div>
                      <div className="text-xs text-gray-500">{r.authorEmail}</div>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700 max-w-xs truncate">
                      {r.tourTitle || `Tour #${r.tourId}`}
                    </td>
                    <td className="px-5 py-3">{ratingStars(r.rating)}</td>
                    <td className="px-5 py-3 text-sm text-gray-700 max-w-xs truncate">
                      {r.title}
                    </td>
                    <td className="px-5 py-3">{statusBadge(r.status)}</td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() => setSelected(r)}
                      >
                        查看 / 處理
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-16 text-center">
            <Star className="h-12 w-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-gray-700 mb-1">尚無此狀態的評論</h3>
            <p className="text-sm text-gray-400">登入後訪客在 tour 詳情頁皆可送出評論，會進入此佇列等待審核</p>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>評論詳情</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">作者</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">
                      {selected.authorName || "—"}
                    </p>
                    <p className="text-xs text-gray-500">{selected.authorEmail}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">行程 / 訂單</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">
                      {selected.tourTitle || `#${selected.tourId}`}
                    </p>
                    <p className="text-xs text-gray-500">Booking #{selected.bookingId}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    評分
                  </p>
                  {ratingStars(selected.rating)}
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    標題
                  </p>
                  <p className="text-base font-semibold text-gray-900">{selected.title}</p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    內容
                  </p>
                  <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                    {selected.content}
                  </div>
                </div>

                {selected.photos && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      照片
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(JSON.parse(selected.photos) as string[]).map((url, idx) => (
                        <img
                          key={idx}
                          src={url}
                          alt={`photo ${idx + 1}`}
                          className="rounded-lg w-full h-32 object-cover border border-gray-200"
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-gray-500">
                  狀態:{statusBadge(selected.status)} · 提交於{" "}
                  {new Date(selected.createdAt).toLocaleString("zh-TW")}
                  {selected.publishedAt && (
                    <> · 發布於 {new Date(selected.publishedAt).toLocaleString("zh-TW")}</>
                  )}
                  {selected.rejectionReason && (
                    <p className="mt-1 text-red-600">拒絕原因:{selected.rejectionReason}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="border-t border-gray-200 pt-5 space-y-3">
                  {selected.status !== "approved" && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => approveMutation.mutate({ id: selected.id })}
                        disabled={approveMutation.isPending}
                        className="bg-green-600 hover:bg-green-700 text-white rounded-lg"
                      >
                        {approveMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 mr-2" />
                        )}
                        通過(發 +50 Packpoint)
                      </Button>
                      {selected.status !== "hidden" && (
                        <Button
                          variant="outline"
                          onClick={() => hideMutation.mutate({ id: selected.id })}
                          disabled={hideMutation.isPending}
                          className="rounded-lg"
                        >
                          <EyeOff className="h-4 w-4 mr-2" />
                          隱藏
                        </Button>
                      )}
                    </div>
                  )}
                  {selected.status === "approved" && (
                    <Button
                      variant="outline"
                      onClick={() => hideMutation.mutate({ id: selected.id })}
                      disabled={hideMutation.isPending}
                      className="rounded-lg"
                    >
                      <EyeOff className="h-4 w-4 mr-2" />
                      取消發布(隱藏)
                    </Button>
                  )}

                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs text-gray-500 mb-2">拒絕原因(會通知作者):</p>
                    <Textarea
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="例:評論內容包含廣告 / 與行程無關 / 違反社群規範"
                      rows={2}
                      className="text-sm rounded-lg mb-2"
                    />
                    <Button
                      variant="outline"
                      onClick={() =>
                        rejectMutation.mutate({
                          id: selected.id,
                          reason: rejectionReason,
                        })
                      }
                      disabled={rejectMutation.isPending || rejectionReason.trim().length < 3}
                      className="border-red-300 text-red-700 hover:bg-red-50 rounded-lg"
                    >
                      {rejectMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <X className="h-4 w-4 mr-2" />
                      )}
                      拒絕
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
