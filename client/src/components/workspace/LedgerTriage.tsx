/**
 * LedgerTriage — 批3 m1 記帳待分類卡(桌面版,mockup 後台_06 PAGE 1).
 *
 * 同 mobile BankTriagePage 的資料線:transactionsList → needsTriage 過濾,
 * 動作 reuse 既有 plaid.transactionUpdate(分類/排除)。零新碰錢路徑。
 * 「全部接受 AI 建議」一鍵 mutation 不存在 — 不放死按鈕(gap 見 task 文件)。
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Badge, BadgeK, BtnB, BtnO, Src } from "./ws-ui";
import { formatRelTime } from "./relTime";
import {
  CANONICAL_CATEGORIES,
  needsTriage,
  isInflow,
  absAmount,
} from "./workspaceLedger.helpers";

type Txn = {
  id: number;
  date: Date | string;
  amount: string | number;
  merchantName: string | null;
  description: string | null;
  agentCategory: string | null;
  agentConfidence: number | null;
  agentReasoning: string | null;
  jeffOverrideCategory: string | null;
  excludeFromAccounting: number | null;
};

export default function LedgerTriage() {
  const { t } = useLocale();
  const txQ = trpc.plaid.transactionsList.useQuery({ limit: 200 });

  const all = (txQ.data?.items ?? []) as Txn[];
  const cards = all.filter(needsTriage);
  // 1A0a(Codex 7-18 P1-3):未取得 → 副標顯「–」,不在 loading/error 上方先報 0。
  const nDisplay = txQ.data === undefined ? "–" : String(cards.length);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        {t("workspace.ldgTriageSub", { n: nDisplay })}
      </p>

      {txQ.isLoading && (
        <p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>
      )}
      {/* 1A0a:讀取失敗 ≠ 全部處理完 */}
      {!txQ.isLoading && txQ.isError && txQ.data === undefined && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-xs text-amber-700">
          {t("workspace.ldgLoadFailed")}
        </div>
      )}
      {/* cached refetch 失敗 = stale,不得顯「沒有待分類」(Codex 7-18 P1-6) */}
      {!txQ.isLoading && txQ.isError && txQ.data !== undefined && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-xs text-amber-700">
          {t("workspace.ldgStaleNotice")}
        </div>
      )}
      {!txQ.isLoading && !txQ.isError && cards.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
          {t("workspace.ldgTriageEmpty")}
        </div>
      )}

      <div className="space-y-2.5">
        {cards.map((txn) => (
          <TriageCard key={txn.id} txn={txn} />
        ))}
      </div>
    </div>
  );
}

function TriageCard({ txn }: { txn: Txn }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const inflow = isInflow(txn.amount);
  const suggested =
    txn.agentCategory && txn.agentCategory !== "other_review"
      ? txn.agentCategory
      : inflow
        ? "income_booking"
        : "other_review";
  const [category, setCategory] = useState(suggested);

  const updateMut = trpc.plaid.transactionUpdate.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.ldgSaved"));
      utils.plaid.transactionsList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 border-l-2 border-l-black p-3 min-w-0">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {inflow ? (
          <BadgeK>{t("workspace.ldgInflow")}</BadgeK>
        ) : (
          <Badge>{t("workspace.ldgOutflow")}</Badge>
        )}
        {txn.agentCategory === "other_review" && (
          <Badge>{t("workspace.ldgAiPunted")}</Badge>
        )}
        <span className="text-[10px] text-gray-400">
          {formatRelTime(txn.date, t)}
        </span>
      </div>

      <div className="flex justify-between items-start gap-3 mb-2 min-w-0">
        <div className="min-w-0">
          {txn.description && (
            <div className="text-[10px] text-gray-400 font-mono truncate">
              {txn.description}
            </div>
          )}
          <div className="font-semibold text-[14px] mt-0.5 break-words">
            {txn.merchantName || t("workspace.ldgUnknownMerchant")}
          </div>
        </div>
        <div className="font-bold text-[15px] flex-shrink-0">
          ${absAmount(txn.amount).toLocaleString()}
        </div>
      </div>

      {txn.agentCategory && txn.agentConfidence != null && (
        <div className="text-[11px] text-gray-500 mb-2 break-words">
          {t("workspace.ldgAiSuggest", {
            cat: t(`workspace.ldgCat_${txn.agentCategory}`),
            conf: txn.agentConfidence,
          })}
          {txn.agentReasoning && (
            <span className="text-gray-400"> — {txn.agentReasoning}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-base sm:text-xs min-w-0"
        >
          {CANONICAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`workspace.ldgCat_${c}`)}
            </option>
          ))}
        </select>
        <BtnB
          onClick={() =>
            updateMut.mutate({
              transactionId: txn.id,
              category: category as (typeof CANONICAL_CATEGORIES)[number],
            })
          }
          disabled={updateMut.isPending}
        >
          {updateMut.isPending
            ? t("workspace.ldgSaving")
            : t("workspace.ldgConfirmCat")}
        </BtnB>
        <BtnO
          onClick={() =>
            updateMut.mutate({ transactionId: txn.id, exclude: true })
          }
          disabled={updateMut.isPending}
        >
          {t("workspace.ldgExclude")}
        </BtnO>
      </div>
      {inflow && <Src>{t("workspace.ldgInflowNote")}</Src>}
    </div>
  );
}
