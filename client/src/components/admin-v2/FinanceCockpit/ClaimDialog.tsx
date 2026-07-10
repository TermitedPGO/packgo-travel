/**
 * ClaimDialog —— 認領對話框(F3 塊B#2)。
 *
 * 三種認領去向,Jeff 二選一 + 金額 + 備註:
 *   1) 候選訂單(引擎猜的,從待認領表帶進來預選)
 *   2) 訂單搜尋逃生口(候選不對時,用單號 / 客人名 / 團名搜 customOrders)
 *   3) 內部分類(鎖 SCHEDULE_C_MAP 枚舉,禁自由文字 —— claimCategories.ts)
 *
 * 認領永遠是 Jeff 按的;AI 只把候選擺上來。成功後 invalidate listPending /
 * pendingSummary(server 端也主動失效 Redis 快取,真相列不滯後)。
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, Loader2, Search } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { CLAIM_CATEGORIES, CLAIM_CATEGORY_LABEL_KEY } from "./claimCategories";
import { fmtMoney } from "./cockpitMath";
import type { PendingItem } from "./PendingClaimsCard";

type Choice =
  | { kind: "order"; orderId: number; orderNumber: string; label: string }
  | { kind: "category"; categoryCode: string }
  | null;

export function ClaimDialog({
  item,
  initialOrderId,
  onClose,
}: {
  /** 待認領列(null = 關閉)。 */
  item: PendingItem | null;
  /** 從表上點了候選 chip 進來時的預選訂單。 */
  initialOrderId: number | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  // key 隨 item 變化重掛(dialog 每次打開都是乾淨狀態)—— 由 parent 控制。
  const preset = item?.candidates.find((c) => c.orderId === initialOrderId) ?? null;
  const [choice, setChoice] = useState<Choice>(
    preset
      ? { kind: "order", orderId: preset.orderId, orderNumber: preset.orderNumber, label: preset.title }
      : null,
  );
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");

  const search = trpc.bankTransactionLinks.searchClaimTargets.useQuery(
    { q },
    { enabled: q.trim().length >= 1 },
  );

  const claim = trpc.bankTransactionLinks.claim.useMutation({
    onSuccess: () => {
      utils.bankTransactionLinks.listPending.invalidate();
      utils.bankTransactionLinks.pendingSummary.invalidate();
      toast.success(t("financeCockpit.claim.toastClaimed"));
      onClose();
    },
    onError: (err) => toast.error(t("financeCockpit.claim.toastFailed") + err.message),
  });

  if (!item) return null;

  const amount = amountStr ? parseFloat(amountStr) : item.amount;
  const amountValid = Number.isFinite(amount) && amount > 0;

  const submit = () => {
    if (!choice || !amountValid) return;
    if (choice.kind === "order") {
      claim.mutate({
        bankTransactionId: item.bankTransactionId,
        targetType: "custom_order",
        targetId: choice.orderId,
        amountAllocated: amount,
        note: note.trim() || undefined,
      });
    } else {
      claim.mutate({
        bankTransactionId: item.bankTransactionId,
        targetType: "category",
        categoryCode: choice.categoryCode,
        amountAllocated: amount,
        note: note.trim() || undefined,
      });
    }
  };

  const chipCls = (selected: boolean) =>
    `rounded-md border px-2 py-1 text-xs transition-colors ${
      selected
        ? "border-gray-900 bg-gray-900 text-white"
        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
    }`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {t("financeCockpit.claim.title", {
              amount: fmtMoney(item.amount),
              id: String(item.bankTransactionId),
            })}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("financeCockpit.claim.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 候選(引擎猜的) */}
          {item.candidates.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-gray-500">
                {t("financeCockpit.claim.candidatesLabel")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.candidates.map((c) => (
                  <button
                    key={c.orderId}
                    type="button"
                    onClick={() =>
                      setChoice({ kind: "order", orderId: c.orderId, orderNumber: c.orderNumber, label: c.title })
                    }
                    className={chipCls(choice?.kind === "order" && choice.orderId === c.orderId)}
                  >
                    {c.orderNumber} · {c.title}
                    {t(`financeCockpit.claim.leg_${c.legKind}` as any)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 訂單搜尋逃生口 */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-gray-500">
              {t("financeCockpit.claim.searchLabel")}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("financeCockpit.claim.searchPlaceholder")}
                className="h-8 rounded-lg pl-8 text-xs"
              />
            </div>
            {q.trim().length >= 1 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {search.isLoading ? (
                  <span className="text-[11px] text-gray-400">{t("financeCockpit.loading")}</span>
                ) : (search.data?.orders ?? []).length === 0 ? (
                  <span className="text-[11px] text-gray-400">
                    {t("financeCockpit.claim.searchEmpty")}
                  </span>
                ) : (
                  (search.data?.orders ?? []).map((o) => (
                    <button
                      key={o.orderId}
                      type="button"
                      onClick={() =>
                        setChoice({ kind: "order", orderId: o.orderId, orderNumber: o.orderNumber, label: o.title })
                      }
                      className={chipCls(choice?.kind === "order" && choice.orderId === o.orderId)}
                    >
                      {o.orderNumber} · {o.customerName} · {o.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 內部分類(鎖 SCHEDULE_C_MAP 枚舉) */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-gray-500">
              {t("financeCockpit.claim.categoryLabel")}
            </div>
            <Select
              value={choice?.kind === "category" ? choice.categoryCode : ""}
              onValueChange={(v) => setChoice({ kind: "category", categoryCode: v })}
            >
              <SelectTrigger className="h-8 w-full rounded-lg text-xs">
                <SelectValue placeholder={t("financeCockpit.claim.categoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {CLAIM_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="rounded-lg text-xs">
                    {t(CLAIM_CATEGORY_LABEL_KEY[c])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 金額 + 備註 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-gray-500">
                {t("financeCockpit.claim.amountLabel")}
              </div>
              <Input
                type="number"
                step="0.01"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder={item.amount.toFixed(2)}
                className="h-8 rounded-lg text-right text-xs tabular-nums"
              />
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-gray-500">
                {t("financeCockpit.claim.noteLabel")}
              </div>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("financeCockpit.claim.notePlaceholder")}
                className="h-8 rounded-lg text-xs"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg text-xs"
            onClick={onClose}
            disabled={claim.isPending}
          >
            {t("financeCockpit.claim.cancel")}
          </Button>
          <Button
            size="sm"
            className="rounded-lg bg-gray-900 text-xs text-white hover:bg-gray-800"
            disabled={!choice || !amountValid || claim.isPending}
            onClick={submit}
          >
            {claim.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1 h-3.5 w-3.5" />
            )}
            {t("financeCockpit.claim.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
