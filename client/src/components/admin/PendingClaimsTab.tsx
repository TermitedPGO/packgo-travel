/**
 * PendingClaimsTab — F1 對帳引擎 塊A「待認領入帳」(2026-07-08)。
 *
 * 每筆還沒有 link 的入帳,顯示金額 + 系統猜的候選訂單(有就顯示,沒有就要
 * Jeff 選一個內部分類)。認領永遠是 Jeff 自己按 —— AI 只搬運候選,不代按。
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
import { trpc } from "@/lib/trpc";
import { LoadingRow } from "@/components/ui/spinner";
import { Check, Calendar } from "lucide-react";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

// F3 塊C 小修(2026-07-10):claim 的 categoryCode 在 server 端 zod 鎖
// SCHEDULE_C_MAP 枚舉後,舊值 owner_transfer/interest/other 不再合法。
// F2 塊D 回令 #3:選項抽到 pendingClaimCategoryOptions.ts(純模組),
// 納入 accountingCategories.test.ts parity 守門;駕駛艙 ClaimDialog 用全 12 枚舉。
import {
  PENDING_CLAIM_CATEGORY_OPTIONS as CATEGORY_OPTIONS,
  type PendingClaimCategoryValue as CategoryValue,
} from "./pendingClaimCategoryOptions";

type ClaimChoice =
  | { kind: "order"; orderId: number; orderNumber: string }
  | { kind: "category"; categoryCode: CategoryValue }
  | null;

export default function PendingClaimsTab() {
  const { language, t } = useLocale();
  const dateLocale = language === "zh-TW" ? zhTW : enUS;

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.bankTransactionLinks.listPending.useQuery({ limit: 100 });

  const [choices, setChoices] = useState<Record<number, ClaimChoice>>({});
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  const claimMutation = trpc.bankTransactionLinks.claim.useMutation({
    onSuccess: () => {
      utils.bankTransactionLinks.listPending.invalidate();
      toast.success(t("pendingClaimsTab.toastClaimed"));
    },
    onError: (err) => toast.error(t("pendingClaimsTab.toastFailed") + err.message),
  });

  const fmtDate = (d: string) => {
    try {
      return format(new Date(d), "yyyy/MM/dd", { locale: dateLocale });
    } catch {
      return d;
    }
  };

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

  const handleClaim = (bankTransactionId: number, fullAmount: number) => {
    const choice = choices[bankTransactionId];
    if (!choice) {
      toast.error(t("pendingClaimsTab.errorPickTarget"));
      return;
    }
    const amountStr = amounts[bankTransactionId];
    const amountAllocated = amountStr ? parseFloat(amountStr) : fullAmount;
    if (!Number.isFinite(amountAllocated) || amountAllocated <= 0) {
      toast.error(t("pendingClaimsTab.errorBadAmount"));
      return;
    }

    if (choice.kind === "order") {
      claimMutation.mutate({
        bankTransactionId,
        targetType: "custom_order",
        targetId: choice.orderId,
        amountAllocated,
      });
    } else {
      claimMutation.mutate({
        bankTransactionId,
        targetType: "category",
        categoryCode: choice.categoryCode,
        amountAllocated,
      });
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t("pendingClaimsTab.title")}</h2>
        <p className="text-sm text-gray-500 mt-1">{t("pendingClaimsTab.subtitle")}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("pendingClaimsTab.colDate")}</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("pendingClaimsTab.colAmount")}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("pendingClaimsTab.colTarget")}</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("pendingClaimsTab.colAllocated")}</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{t("pendingClaimsTab.colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <LoadingRow />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                    {t("pendingClaimsTab.emptyList")}
                  </td>
                </tr>
              )}
              {items.map((item) => {
                const choice = choices[item.bankTransactionId] ?? null;
                return (
                  <tr key={item.bankTransactionId} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-700 flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-gray-400" />
                        {fmtDate(item.date)}
                      </div>
                      <div className="text-xs text-gray-400">#{item.bankTransactionId}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-sm font-semibold text-gray-900">{fmtMoney(item.amount)}</div>
                    </td>
                    <td className="px-4 py-3">
                      {item.candidates.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {item.candidates.map((c) => (
                            <button
                              key={c.orderId}
                              onClick={() =>
                                setChoices((prev) => ({
                                  ...prev,
                                  [item.bankTransactionId]: { kind: "order", orderId: c.orderId, orderNumber: c.orderNumber },
                                }))
                              }
                              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                                choice?.kind === "order" && choice.orderId === c.orderId
                                  ? "border-teal-600 bg-teal-50 text-teal-700"
                                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              {c.orderNumber}({t(`pendingClaimsTab.leg.${c.legKind}` as any)})
                            </button>
                          ))}
                        </div>
                      )}
                      <Select
                        value={choice?.kind === "category" ? choice.categoryCode : ""}
                        onValueChange={(v) =>
                          // 值只可能來自 CATEGORY_OPTIONS,cast 安全
                          setChoices((prev) => ({ ...prev, [item.bankTransactionId]: { kind: "category", categoryCode: v as CategoryValue } }))
                        }
                      >
                        <SelectTrigger className="w-44 h-8 text-xs rounded-lg">
                          <SelectValue placeholder={t("pendingClaimsTab.categoryPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORY_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {t(opt.labelKey as any)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        className="w-28 h-8 text-xs text-right rounded-lg ml-auto"
                        placeholder={item.amount.toFixed(2)}
                        value={amounts[item.bankTransactionId] ?? ""}
                        onChange={(e) =>
                          setAmounts((prev) => ({ ...prev, [item.bankTransactionId]: e.target.value }))
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        className="rounded-lg gap-1"
                        disabled={!choice || claimMutation.isPending}
                        onClick={() => handleClaim(item.bankTransactionId, item.amount)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t("pendingClaimsTab.actionClaim")}
                      </Button>
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
