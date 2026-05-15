/**
 * BankAccountsTab — Phase 2 of the QBO-replacement plan.
 *
 * Lives under FinanceTab as the 4th sub-tab ("銀行帳戶"). Surfaces every
 * Plaid-linked bank/credit account: balance, last-sync state, sync errors,
 * with controls for "立即同步" / "標記信託" / "解除連結" and "連結新銀行"
 * via Plaid Link.
 *
 * Sub-views:
 *   1. Account cards (top) — institution name, mask, type, balance, sync status
 *   2. Recent transactions table — newest 50 txns across all linked accounts,
 *      filterable by account
 *
 * Trust-account UX (CST §17550 compliance):
 *   The ⚐ "信託" badge marks a trust account; toggle via the per-card menu.
 *   Phase 4 will use this flag to defer income recognition until the
 *   departure date. Today it's display-only.
 *
 * Phase 0 unblock:
 *   If PLAID_CLIENT_ID is unset on the server, createLinkToken throws
 *   "Plaid not configured"; we surface that as a friendly empty state
 *   pointing Jeff to the env-var instructions.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CreditCard,
  PiggyBank,
  Wallet,
  RefreshCw,
  Trash2,
  ShieldCheck,
  AlertCircle,
  Plus,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  FileArchive,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow, format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

type AccountType = "depository" | "credit" | "loan" | "investment" | "other";

function fmtMoney(amt: string | number | null, currency = "USD") {
  if (amt == null) return "—";
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
}

function iconForType(type: AccountType) {
  switch (type) {
    case "credit":
      return CreditCard;
    case "depository":
      return PiggyBank;
    case "investment":
      return Wallet;
    case "loan":
      return Building2;
    default:
      return Building2;
  }
}

export default function BankAccountsTab() {
  const { language, t } = useLocale();
  const dateLocale = language === "zh-TW" ? zhTW : enUS;
  const utils = trpc.useUtils();

  const [filterAccountId, setFilterAccountId] = useState<number | "all">("all");

  const { data: accounts, isLoading: accountsLoading } =
    trpc.plaid.linkedAccountsList.useQuery();

  const { data: txnData, isLoading: txnsLoading } =
    trpc.plaid.transactionsList.useQuery({
      linkedAccountId: filterAccountId === "all" ? undefined : filterAccountId,
      limit: 50,
      offset: 0,
    });

  // 2026-05-14: Removed embedded usePlaidLink integration entirely.
  // Jeff's Chrome has an extension that blocks cdn.plaid.com (Honorlock or
  // similar proctoring/privacy tool), which makes the embedded SDK flow
  // unreliable — every click would hit our 4s watchdog before falling
  // through to Hosted Link. Instead, just redirect to secure.plaid.com
  // directly on token creation. Plaid's own domain is much harder to
  // block, and the UX is one redirect step rather than waiting + toast +
  // redirect. Webhook handler (handleHostedLinkSessionFinished) takes
  // care of exchange + persistence server-side after the user completes
  // the flow at secure.plaid.com.
  const createLinkTokenMut = trpc.plaid.createLinkToken.useMutation({
    onSuccess: ({ hostedLinkUrl }) => {
      if (!hostedLinkUrl) {
        // Should never happen (server always passes hosted_link options
        // to Plaid), but guard anyway so we don't leave the user stuck.
        toast.error(t("bankAccounts.errNoHostedUrl"), { duration: 10000 });
        return;
      }
      toast.info(t("bankAccounts.redirectingHostedLink"), { duration: 4000 });
      // Brief delay so the toast is visible before the page unloads
      setTimeout(() => {
        window.location.href = hostedLinkUrl;
      }, 800);
    },
    onError: (err) => toast.error(t("bankAccounts.errLinkToken") + err.message),
  });

  const syncMut = trpc.plaid.syncNow.useMutation({
    onSuccess: (data) => {
      const totalAdded = data.results.reduce((s, r) => s + (r.added ?? 0), 0);
      toast.success(
        t("bankAccounts.toastSynced").replace("{count}", String(totalAdded))
      );
      utils.plaid.linkedAccountsList.invalidate();
      utils.plaid.transactionsList.invalidate();
    },
    onError: (err) => toast.error(t("bankAccounts.errSync") + err.message),
  });

  const trustMut = trpc.plaid.markTrustAccount.useMutation({
    onSuccess: () => {
      toast.success(t("bankAccounts.toastTrustUpdated"));
      utils.plaid.linkedAccountsList.invalidate();
    },
    onError: (err) => toast.error(t("bankAccounts.errTrust") + err.message),
  });

  const removeMut = trpc.plaid.removeLinkedAccount.useMutation({
    onSuccess: () => {
      toast.success(t("bankAccounts.toastUnlinked"));
      utils.plaid.linkedAccountsList.invalidate();
      utils.plaid.transactionsList.invalidate();
    },
    onError: (err) => toast.error(t("bankAccounts.errRemove") + err.message),
  });

  const yearEndMut = trpc.plaid.yearEndExport.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("bankAccounts.toastExportReady")
          .replace("{count}", String(data.fileCounts.transactions))
      );
      // Trigger download by opening the signed URL in a new tab
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
    onError: (err) =>
      toast.error(t("bankAccounts.errExport") + err.message),
  });

  const handleStartLink = () => {
    createLinkTokenMut.mutate();
  };

  // After Hosted Link redirects back to /admin?plaid=done, show a success
  // toast and refresh the accounts list. The webhook handler does the
  // actual public_token exchange server-side; this is just UX.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("plaid") === "done") {
      toast.success(t("bankAccounts.toastHostedLinkDone"), { duration: 8000 });
      // Strip the query param so refresh doesn't re-toast
      window.history.replaceState({}, "", window.location.pathname);
      // Poll for newly linked accounts — webhook may take a few seconds
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        utils.plaid.linkedAccountsList.invalidate();
        utils.plaid.transactionsList.invalidate();
        if (attempts >= 10) clearInterval(poll);
      }, 3000);
      return () => clearInterval(poll);
    }
  }, [utils, t]);

  // Month-to-date P&L for the "本月損益" card
  const monthRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    };
  }, []);

  const { data: plReport } = trpc.plaid.profitLossReport.useQuery(monthRange, {
    enabled: (accounts?.length ?? 0) > 0,
  });

  const accountsList = accounts ?? [];
  const txns = txnData?.items ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {t("bankAccounts.title")}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {t("bankAccounts.subtitle")}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {accountsList.length > 0 && (
            <Button
              onClick={() => {
                const year = new Date().getFullYear();
                if (
                  confirm(
                    t("bankAccounts.confirmExport").replace(
                      "{year}",
                      String(year)
                    )
                  )
                ) {
                  yearEndMut.mutate({ year });
                }
              }}
              disabled={yearEndMut.isPending}
              variant="outline"
              className="rounded-lg"
            >
              <FileArchive
                className={`h-4 w-4 mr-2 ${yearEndMut.isPending ? "animate-pulse" : ""}`}
              />
              {t("bankAccounts.yearEndExport")}
            </Button>
          )}
          <Button
            onClick={() => syncMut.mutate(undefined)}
            disabled={syncMut.isPending || accountsList.length === 0}
            variant="outline"
            className="rounded-lg"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${syncMut.isPending ? "animate-spin" : ""}`}
            />
            {t("bankAccounts.syncAll")}
          </Button>
          <Button
            onClick={handleStartLink}
            disabled={createLinkTokenMut.isPending}
            className="rounded-lg bg-teal-600 hover:bg-teal-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("bankAccounts.linkNew")}
          </Button>
        </div>
      </div>

      {/* Account cards */}
      {accountsLoading ? (
        <div className="text-sm text-gray-500 p-4">
          {t("bankAccounts.loadingAccounts")}
        </div>
      ) : accountsList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <Building2 className="h-10 w-10 text-gray-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700">
            {t("bankAccounts.emptyTitle")}
          </p>
          <p className="text-xs text-gray-500 mt-1 mb-4">
            {t("bankAccounts.emptySubtitle")}
          </p>
          <Button
            onClick={handleStartLink}
            disabled={createLinkTokenMut.isPending}
            className="rounded-lg bg-teal-600 hover:bg-teal-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("bankAccounts.linkFirst")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accountsList
            .filter((a: any) => a.isActive === 1)
            .map((acc: any) => {
              const Icon = iconForType(acc.accountType as AccountType);
              const balance =
                acc.accountType === "credit"
                  ? acc.currentBalance
                  : acc.availableBalance ?? acc.currentBalance;
              const errored = Boolean(acc.lastSyncError);
              const lastSyncText = acc.lastSyncedAt
                ? formatDistanceToNow(new Date(acc.lastSyncedAt), {
                    addSuffix: true,
                    locale: dateLocale,
                  })
                : t("bankAccounts.neverSynced");

              return (
                <div
                  key={acc.id}
                  className={`rounded-xl border bg-white p-5 shadow-sm ${
                    errored ? "border-red-200" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {acc.institutionLogoUrl ? (
                      <img
                        src={acc.institutionLogoUrl}
                        alt={acc.institutionName}
                        className="h-10 w-10 rounded-lg object-cover bg-gray-100"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-gray-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {acc.institutionName}
                        </h3>
                        {acc.isTrustAccount === 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-xs font-medium border border-amber-200">
                            <ShieldCheck className="h-3 w-3" />
                            {t("bankAccounts.trustBadge")}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 truncate">
                        {acc.accountName}
                        {acc.accountMask && ` · •••• ${acc.accountMask}`}
                      </p>
                      <p className="text-xs text-gray-400 capitalize">
                        {acc.accountType}
                        {acc.accountSubtype && ` · ${acc.accountSubtype}`}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="rounded-lg">
                          ⋯
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-lg">
                        <DropdownMenuItem
                          onClick={() =>
                            syncMut.mutate({ linkedAccountId: acc.id })
                          }
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          {t("bankAccounts.menuSync")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            trustMut.mutate({
                              linkedAccountId: acc.id,
                              isTrust: acc.isTrustAccount !== 1,
                            })
                          }
                        >
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          {acc.isTrustAccount === 1
                            ? t("bankAccounts.menuUnmarkTrust")
                            : t("bankAccounts.menuMarkTrust")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            if (
                              confirm(
                                t("bankAccounts.confirmUnlink").replace(
                                  "{name}",
                                  acc.accountName
                                )
                              )
                            ) {
                              removeMut.mutate({ linkedAccountId: acc.id });
                            }
                          }}
                          className="text-red-600 focus:text-red-700"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t("bankAccounts.menuUnlink")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs text-gray-500">
                      {acc.accountType === "credit"
                        ? t("bankAccounts.owedLabel")
                        : t("bankAccounts.balanceLabel")}
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-0.5">
                      {fmtMoney(balance, acc.isoCurrencyCode)}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                    <span className="text-gray-500">
                      {t("bankAccounts.lastSyncLabel")}: {lastSyncText}
                    </span>
                    {errored && (
                      <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                        <AlertCircle className="h-3 w-3" />
                        {t("bankAccounts.syncErrorBadge")}
                      </span>
                    )}
                  </div>
                  {errored && (
                    <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">
                      {acc.lastSyncError}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Month-to-date P&L summary */}
      {plReport && plReport.transactionCount > 0 && (
        <div className="mt-8">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-3">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {t("bankAccounts.mtdPLTitle")}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {t("bankAccounts.mtdPLSubtitle")
                  .replace("{start}", monthRange.startDate)
                  .replace("{end}", monthRange.endDate)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <TrendingUp className="h-3 w-3 text-green-600" />
                {t("bankAccounts.plIncome")}
              </div>
              <div className="text-xl font-bold text-gray-900">
                {fmtMoney(plReport.income.total)}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <TrendingDown className="h-3 w-3 text-orange-600" />
                {t("bankAccounts.plCogs")}
              </div>
              <div className="text-xl font-bold text-gray-900">
                {fmtMoney(plReport.expenses.cogs)}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <TrendingDown className="h-3 w-3 text-red-600" />
                {t("bankAccounts.plOperating")}
              </div>
              <div className="text-xl font-bold text-gray-900">
                {fmtMoney(plReport.expenses.operating)}
              </div>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                plReport.netProfit >= 0
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <div className="text-xs text-gray-600 mb-1">
                {t("bankAccounts.plNet")}
              </div>
              <div
                className={`text-xl font-bold ${
                  plReport.netProfit >= 0 ? "text-green-700" : "text-red-700"
                }`}
              >
                {fmtMoney(plReport.netProfit)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {plReport.profitMargin.toFixed(1)}%{" "}
                {t("bankAccounts.plMargin")}
              </div>
            </div>
          </div>
          {plReport.needsReviewCount > 0 && (
            <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              ⚠️ {plReport.needsReviewCount}{" "}
              {t("bankAccounts.plNeedsReview")
                .replace("{amount}", fmtMoney(plReport.needsReviewAmount))}
            </div>
          )}
        </div>
      )}

      {/* Recent transactions */}
      <div className="mt-8">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {t("bankAccounts.recentTxnsTitle")}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {t("bankAccounts.recentTxnsSubtitle")}
            </p>
          </div>
          {accountsList.length > 0 && (
            <Select
              value={String(filterAccountId)}
              onValueChange={(v) =>
                setFilterAccountId(v === "all" ? "all" : Number(v))
              }
            >
              <SelectTrigger className="w-56 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("bankAccounts.filterAllAccounts")}
                </SelectItem>
                {accountsList
                  .filter((a: any) => a.isActive === 1)
                  .map((a: any) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.institutionName}
                      {a.accountMask && ` (•••• ${a.accountMask})`}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {txnsLoading ? (
            <div className="text-sm text-gray-500 p-6">
              {t("bankAccounts.loadingTxns")}
            </div>
          ) : txns.length === 0 ? (
            <div className="text-sm text-gray-500 p-6 text-center">
              {t("bankAccounts.emptyTxns")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    {t("bankAccounts.colDate")}
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    {t("bankAccounts.colMerchant")}
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600 hidden md:table-cell">
                    {t("bankAccounts.colCategory")}
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">
                    {t("bankAccounts.colAmount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {txns.map((tx: any) => {
                  const isPending = tx.isPending === 1;
                  const isExcluded = tx.excludeFromAccounting === 1;
                  const amount = parseFloat(tx.amount);
                  // Plaid sign convention: positive = outflow, negative = inflow.
                  // We display with a leading sign + color for clarity.
                  const isOutflow = amount > 0;
                  return (
                    <tr
                      key={tx.id}
                      className={`border-b border-gray-100 hover:bg-gray-50 ${
                        isExcluded ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {format(new Date(tx.date), "MM/dd")}
                        {isPending && (
                          <span className="ml-1 text-xs text-orange-600 font-medium">
                            ·{t("bankAccounts.pendingBadge")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 truncate max-w-[280px]">
                          {tx.merchantName ?? tx.description ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                        {tx.jeffOverrideCategory ??
                          tx.agentCategory ??
                          tx.plaidCategoryPrimary ??
                          "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono whitespace-nowrap ${
                          isOutflow ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {isOutflow ? "-" : "+"}
                        {fmtMoney(Math.abs(amount), tx.isoCurrencyCode)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {txnData && txnData.total > 50 && (
          <p className="text-xs text-gray-500 mt-2 text-right">
            {t("bankAccounts.showingNote")
              .replace("{shown}", String(txns.length))
              .replace("{total}", String(txnData.total))}{" "}
            <a
              href="#"
              className="text-teal-600 hover:underline inline-flex items-center gap-0.5"
              onClick={(e) => {
                e.preventDefault();
                toast.info(t("bankAccounts.fullViewSoon"));
              }}
            >
              {t("bankAccounts.viewAll")}
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
