/**
 * TrustComplianceV2 — M5 (記帳強化) 信託合規報表 + 稽核匯出。
 *
 * 兩個關注點：
 *
 * 1) 信託遞延對帳 (CST §17550)。客人訂金放在 Trust #5442 不能算營收，要等
 *    出發後才認列 (Jeff:「放在 trust account 是客人訂金 不能算我的，除非真的
 *    跑到我的 checking」)。本頁顯示每個信託帳戶的：未認列訂金 (outstanding) /
 *    信託餘額 (bank balance) / 差異 (drift) / 未配對 (unmatched，待 Jeff 連
 *    booking)。功能未啟用 (PLAID_TRUST_DEFERRAL_ENABLED off) 時顯示「未啟用」
 *    橫幅而非報錯。
 *
 * 2) 稽核匯出。把「不進損益表」的交易 (transfer 業主資金 + other_review 待審)
 *    列成可下載 CSV，讓會計師對帳 Schedule-C 時看得到錢為什麼動卻不算營收。
 *
 * 後端全已存在：
 *   - plaid.trustReconciliation() → 每信託帳戶 outstanding/balance/drift/...
 *   - plaid.trustDeferredList({ status, limit }) → 遞延明細
 *   - plaid.auditExclusionList({ startDate, endDate }) → { records, summary, csv }
 *
 * 金額計算權威在 server (foldOutstandingTrust / foldExclusionRows，已單測)；
 * 此處只呈現後端數字，不重算。
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Landmark,
  Lock,
  AlertTriangle,
  Scale,
  Link2,
  Link2Off,
  ArrowDownToLine,
  Loader2,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import {
  KpiCard,
  SectionCard,
  LandingGreeting,
} from "@/components/admin/landings/landingPrimitives";
import { useLocale } from "@/contexts/LocaleContext";
import { resolveTileState } from "@/components/admin-v2/FinanceCockpit/cockpitMath";

/* ── helpers ─────────────────────────────────────────────────────────── */

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const fmtSigned = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

const MIN_YEAR = 2020;
/** A drift smaller than this (in $) is treated as clean reconciliation. */
const DRIFT_CLEAN_THRESHOLD = 1;

type DeferredStatus = "unmatched" | "pending" | "recognized" | "reversed" | "all";
const STATUS_FILTERS: DeferredStatus[] = [
  "unmatched",
  "pending",
  "recognized",
  "reversed",
  "all",
];

/** Derive a display status from a deferred row's recognized/reversed/booking. */
function rowStatus(row: {
  recognizedAt?: string | Date | null;
  reversedAt?: string | Date | null;
  bookingId?: number | null;
  matchMethod?: string | null;
}): "recognized" | "reversed" | "unmatched" | "pending" {
  if (row.reversedAt) return "reversed";
  if (row.recognizedAt) return "recognized";
  if (!row.bookingId || row.matchMethod === "unmatched") return "unmatched";
  return "pending";
}

function dateStr(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return String(d).slice(0, 10);
}

/** User-initiated CSV download from an in-memory string (no server round-trip). */
function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── component ───────────────────────────────────────────────────────── */

export default function TrustComplianceV2() {
  const { t } = useLocale();
  const now = new Date();
  const [status, setStatus] = useState<DeferredStatus>("unmatched");
  const [auditYear, setAuditYear] = useState(now.getFullYear());

  const recon = trpc.plaid.trustReconciliation.useQuery(undefined, {
    refetchInterval: 120_000,
  });
  const deferredList = trpc.plaid.trustDeferredList.useQuery(
    { status, limit: 100 },
    { refetchInterval: 120_000 },
  );

  const auditRange = useMemo(
    () => ({ startDate: `${auditYear}-01-01`, endDate: `${auditYear}-12-31` }),
    [auditYear],
  );
  const audit = trpc.plaid.auditExclusionList.useQuery(auditRange);

  const accounts = recon.data ?? [];
  // Feature-flag state: every account row carries `enabled` from the server's
  // isTrustDeferralEnabled(). When off → show the "未啟用" banner (not an error).
  const enabled = accounts.length > 0 ? accounts.some((a) => a.enabled) : null;

  // Aggregate the CST reconciliation triad across all trust accounts.
  const agg = useMemo(() => {
    let outstanding = 0;
    let balance = 0;
    let unmatchedTotal = 0;
    let unmatchedCount = 0;
    for (const a of accounts) {
      outstanding += a.outstandingTotal ?? 0;
      balance += a.balance ?? 0;
      unmatchedTotal += a.unmatchedTotal ?? 0;
      unmatchedCount += a.unmatchedCount ?? 0;
    }
    return {
      outstanding,
      balance,
      drift: balance - outstanding,
      unmatchedTotal,
      unmatchedCount,
    };
  }, [accounts]);

  const driftClean = Math.abs(agg.drift) < DRIFT_CLEAN_THRESHOLD;

  // 1A0a(Codex 7-18 P1-4):頁首/KPI 與 recon 狀態一致 —— 冷啟失敗不得顯
  // 假 $0 與假「勾稽乾淨」;stale 顯舊值+標記。
  const reconState = resolveTileState({
    isLoading: recon.isLoading,
    isError: recon.isError,
    hasData: recon.data !== undefined,
  });
  const reconHasValue = reconState === "ready" || reconState === "stale";

  const yearOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = now.getFullYear(); y >= MIN_YEAR; y--) out.push(y);
    return out;
  }, [now]);

  const auditSummary = audit.data?.summary;
  const auditRecords = audit.data?.records ?? [];

  const handleDownload = () => {
    const csv = audit.data?.csv;
    if (!csv || auditRecords.length === 0) {
      toast.info(t("admin.trustCompliance.auditEmpty"));
      return;
    }
    downloadCsv(`packgo-exclusion-audit-${auditYear}.csv`, csv);
    toast.success(
      t("admin.trustCompliance.auditDownloaded", {
        count: String(auditRecords.length),
      }),
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* ── Header ── */}
      <LandingGreeting
        title={t("admin.trustCompliance.title")}
        subtitle={t("admin.trustCompliance.subtitle", {
          outstanding: reconHasValue ? fmt(agg.outstanding) : "—",
        })}
      />

      {/* ── Feature-flag banner ── */}
      {enabled === false && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-amber-900">
              {t("admin.trustCompliance.disabledTitle")}
            </div>
            <div className="text-xs text-amber-800/80 mt-0.5">
              {t("admin.trustCompliance.disabledDesc")}
            </div>
          </div>
        </div>
      )}
      {enabled === true && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-xs font-medium text-emerald-900">
            {t("admin.trustCompliance.enabledNote")}
          </span>
        </div>
      )}

      {/* ── Reconciliation KPI strip(1A0a:transport-error 整條錯誤態,stale 標記) ── */}
      {reconState === "transport-error" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700">
          {t("admin.trustCompliance.loadFailed")}
        </div>
      ) : (
      <>
      {reconState === "stale" && (
        <div className="text-[11px] text-foreground/40">{t("financeCockpit.truth.staleHint")}</div>
      )}
      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${reconState === "stale" ? "opacity-60" : ""}`}>
        <KpiCard
          icon={Lock}
          label={t("admin.trustCompliance.kpiOutstanding")}
          primary={fmt(agg.outstanding)}
          secondary={t("admin.trustCompliance.kpiOutstandingNote")}
          accent="violet"
          loading={recon.isLoading}
        />
        <KpiCard
          icon={Landmark}
          label={t("admin.trustCompliance.kpiBalance")}
          primary={fmt(agg.balance)}
          secondary={t("admin.trustCompliance.kpiBalanceNote")}
          accent="slate"
          loading={recon.isLoading}
        />
        <KpiCard
          icon={Scale}
          label={t("admin.trustCompliance.kpiDrift")}
          primary={fmtSigned(agg.drift)}
          secondary={
            driftClean
              ? t("admin.trustCompliance.driftClean")
              : t("admin.trustCompliance.driftWarn")
          }
          accent={driftClean ? "emerald" : "amber"}
          loading={recon.isLoading}
        />
        <KpiCard
          icon={Link2Off}
          label={t("admin.trustCompliance.kpiUnmatched")}
          primary={fmt(agg.unmatchedTotal)}
          secondary={t("admin.trustCompliance.kpiUnmatchedNote", {
            count: String(agg.unmatchedCount),
          })}
          accent={agg.unmatchedCount > 0 ? "amber" : "emerald"}
          loading={recon.isLoading}
        />
      </div>
      </>
      )}

      {/* ── Per-account reconciliation ── */}
      <SectionCard
        title={t("admin.trustCompliance.accountsTitle")}
        icon={Landmark}
        iconTone="text-indigo-500"
      >
        {recon.isLoading ? (
          <div className="py-6 text-center text-xs text-foreground/40">
            {t("admin.trustCompliance.loading")}
          </div>
        ) : recon.isError && recon.data === undefined ? (
          /* 1A0a U5:讀取失敗不再被空清單語意吞掉 */
          <div className="py-6 text-center text-xs text-amber-700">
            {t("admin.trustCompliance.loadFailed")}
          </div>
        ) : recon.isError && accounts.length === 0 ? (
          /* 1A0a(Codex 7-18 R3):cached-empty + refetch 失敗 = stale,不得畫成乾淨「無帳戶」 */
          <div className="py-6 text-center text-xs text-amber-700">
            {t("financeCockpit.truth.staleHint")}
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-6 text-center text-xs text-foreground/40">
            {t("admin.trustCompliance.noAccounts")}
          </div>
        ) : (
          <div className="space-y-2.5">
            {accounts.map((a) => {
              const clean = Math.abs(a.drift ?? 0) < DRIFT_CLEAN_THRESHOLD;
              return (
                <div
                  key={a.id}
                  className="rounded-lg border border-foreground/10 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">
                      {a.accountName || a.institutionName || "Trust"}
                      {a.accountMask && (
                        <span className="ml-1.5 text-xs font-normal text-foreground/45">
                          ····{a.accountMask}
                        </span>
                      )}
                    </div>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        clean
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {clean
                        ? t("admin.trustCompliance.driftClean")
                        : t("admin.trustCompliance.driftWarn")}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-foreground/45">
                        {t("admin.trustCompliance.kpiOutstanding")}
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {fmt(a.outstandingTotal ?? 0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-foreground/45">
                        {t("admin.trustCompliance.kpiBalance")}
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {fmt(a.balance ?? 0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-foreground/45">
                        {t("admin.trustCompliance.kpiDrift")}
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {fmtSigned(a.drift ?? 0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-foreground/45">
                        {t("admin.trustCompliance.kpiUnmatched")}
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {fmt(a.unmatchedTotal ?? 0)} · {a.unmatchedCount ?? 0}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Deferred list ── */}
      <SectionCard
        title={t("admin.trustCompliance.listTitle")}
        icon={Lock}
        iconTone="text-violet-500"
      >
        {/* status filter pills */}
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-foreground/15 p-0.5 mb-3">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                status === s
                  ? "bg-teal-600 text-white"
                  : "text-foreground/60 hover:text-foreground/90"
              }`}
            >
              {t(`admin.trustCompliance.filter_${s}`)}
            </button>
          ))}
        </div>

        {deferredList.isLoading ? (
          <div className="py-6 text-center text-xs text-foreground/40">
            {t("admin.trustCompliance.loading")}
          </div>
        ) : deferredList.isError && deferredList.data === undefined ? (
          /* 1A0a U5:讀取失敗 ≠ 空清單 */
          <div className="py-6 text-center text-xs text-amber-700">
            {t("admin.trustCompliance.loadFailed")}
          </div>
        ) : deferredList.isError && (deferredList.data ?? []).length === 0 ? (
          /* cached empty + refetch 失敗 = stale,不得顯真空清單(Codex 7-18 P1-6) */
          <div className="py-6 text-center text-xs text-amber-700">
            {t("financeCockpit.truth.staleHint")}
          </div>
        ) : (deferredList.data ?? []).length === 0 ? (
          <div className="py-6 text-center text-xs text-foreground/40">
            {t("admin.trustCompliance.listEmpty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* cached-nonempty + refetch 失敗 = stale 標記(Codex 7-18 R3:與主 list 一致) */}
            {deferredList.isError && (
              <div className="pb-1 text-[10px] text-amber-700">{t("financeCockpit.truth.staleHint")}</div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-foreground/45 border-b border-foreground/10">
                  <th className="py-1.5 pr-2 font-medium">
                    {t("admin.trustCompliance.colDate")}
                  </th>
                  <th className="py-1.5 pr-2 font-medium text-right">
                    {t("admin.trustCompliance.colAmount")}
                  </th>
                  <th className="py-1.5 pr-2 font-medium">
                    {t("admin.trustCompliance.colStatus")}
                  </th>
                  <th className="py-1.5 pr-2 font-medium">
                    {t("admin.trustCompliance.colBooking")}
                  </th>
                  <th className="py-1.5 font-medium">
                    {t("admin.trustCompliance.colRecognition")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(deferredList.data ?? []).map((row: any) => {
                  const st = rowStatus(row);
                  const tone =
                    st === "recognized"
                      ? "bg-emerald-50 text-emerald-700"
                      : st === "reversed"
                        ? "bg-rose-50 text-rose-600"
                        : st === "unmatched"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-100 text-slate-600";
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-foreground/5 last:border-0"
                    >
                      <td className="py-1.5 pr-2 tabular-nums text-foreground/70">
                        {dateStr(row.depositDate)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums font-medium text-foreground">
                        {fmt(parseFloat(String(row.amount)) || 0)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}
                        >
                          {t(`admin.trustCompliance.badge_${st}`)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-foreground/70">
                        {row.bookingId ? (
                          <span className="inline-flex items-center gap-1">
                            <Link2 className="w-3 h-3 text-emerald-600" />#
                            {row.bookingId}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <Link2Off className="w-3 h-3" />
                            {t("admin.trustCompliance.bookingUnlinked")}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 tabular-nums text-foreground/55">
                        {dateStr(row.expectedRecognitionDate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Audit export (exclusion list) ── */}
      <SectionCard
        title={t("admin.trustCompliance.auditTitle")}
        icon={ArrowDownToLine}
        iconTone="text-slate-500"
      >
        <p className="text-xs text-foreground/50 -mt-1 mb-3">
          {t("admin.trustCompliance.auditDesc")}
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Select
            value={String(auditYear)}
            onValueChange={(v) => setAuditYear(Number(v))}
          >
            <SelectTrigger className="w-28 h-9 rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {yearOptions.map((y) => (
                <SelectItem
                  key={y}
                  value={String(y)}
                  className="rounded-lg text-sm"
                >
                  {t("admin.trustCompliance.auditYearLabel", { year: String(y) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs"
            disabled={audit.isFetching}
            onClick={handleDownload}
          >
            {audit.isFetching ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />
            )}
            {t("admin.trustCompliance.auditDownload", { year: String(auditYear) })}
          </Button>
        </div>

        {/* summary tiles(1A0a U5:audit 讀取失敗顯性,不折 $0;stale 標記) */}
        {audit.isError && audit.data !== undefined && (
          <div className="text-[11px] text-amber-700">{t("financeCockpit.truth.staleHint")}</div>
        )}
        {audit.isError && audit.data === undefined ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            {t("admin.trustCompliance.loadFailed")}
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-foreground/10 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
              <Landmark className="w-3.5 h-3.5 text-slate-500" />
              {t("admin.trustCompliance.auditTransferTile")}
            </div>
            <div className="mt-1 text-base font-bold tabular-nums text-foreground">
              {auditSummary !== undefined ? fmtSigned(auditSummary.transferTotal) : "—"}
            </div>
            <div className="text-[11px] text-foreground/45">
              {t("admin.trustCompliance.auditTransferDesc", {
                count: auditSummary !== undefined ? String(auditSummary.transferCount) : "—",
              })}
            </div>
          </div>
          <div className="rounded-lg border border-foreground/10 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              {t("admin.trustCompliance.auditReviewTile")}
            </div>
            <div className="mt-1 text-base font-bold tabular-nums text-foreground">
              {auditSummary !== undefined ? fmt(auditSummary.otherReviewTotal) : "—"}
            </div>
            <div className="text-[11px] text-foreground/45">
              {t("admin.trustCompliance.auditReviewDesc", {
                count: auditSummary !== undefined ? String(auditSummary.otherReviewCount) : "—",
              })}
            </div>
          </div>
        </div>
        )}

        {/* preview table (first 20 rows) */}
        {auditRecords.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-foreground/45 border-b border-foreground/10">
                  <th className="py-1.5 pr-2 font-medium">
                    {t("admin.trustCompliance.colDate")}
                  </th>
                  <th className="py-1.5 pr-2 font-medium">
                    {t("admin.trustCompliance.auditColCategory")}
                  </th>
                  <th className="py-1.5 pr-2 font-medium text-right">
                    {t("admin.trustCompliance.colAmount")}
                  </th>
                  <th className="py-1.5 font-medium">
                    {t("admin.trustCompliance.auditColParty")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditRecords.slice(0, 20).map((rec) => (
                  <tr
                    key={rec.id ?? `${rec.date}-${rec.amount}`}
                    className="border-b border-foreground/5 last:border-0"
                  >
                    <td className="py-1.5 pr-2 tabular-nums text-foreground/70">
                      {rec.date}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          rec.category === "transfer"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {t(`admin.trustCompliance.cat_${rec.category}`)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-medium text-foreground">
                      {fmt(rec.amount)}
                    </td>
                    <td className="py-1.5 text-foreground/60 truncate max-w-[180px]">
                      {rec.counterparty || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditRecords.length > 20 && (
              <div className="pt-2 text-[11px] text-foreground/40">
                {t("admin.trustCompliance.auditMoreRows", {
                  count: String(auditRecords.length - 20),
                })}
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
