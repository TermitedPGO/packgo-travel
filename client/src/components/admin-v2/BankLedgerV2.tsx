/**
 * BankLedgerV2 — monthly-close bank ledger admin (Round 81 v2).
 *
 * Trip.com-dense pattern, same primitives as BookingsTabV2 / InquiriesTabV2.
 * This is Jeff's core "clean up Plaid imports before P&L" workflow:
 *
 *   - 4 filter pills (全部 / 未分類 / 已分類 / 已排除) with live counts
 *   - Search by merchant / description / amount string
 *   - Date range (defaults to this month)
 *   - 36px DataTable: date | merchant | category | amount | source | excluded
 *   - Row click → Sheet drawer with read-only Plaid+AI sections + editable
 *     override section (category dropdown, reason, link booking, exclude toggle)
 *
 * Backend wire (existing, no schema change):
 *   - trpc.plaid.transactionsList   — paginated, supports includeExcluded
 *   - trpc.plaid.transactionUpdate  — sets jeffOverrideCategory/Reason/exclude/relatedBookingId
 *
 * Sign convention (from Plaid): amount > 0 = outflow (red), amount < 0 = inflow (green).
 *
 * Phase C tab #8.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DataTable,
  StatusDot,
  EmptyState,
  type Column,
  type StatusTone,
} from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Landmark,
  Loader2,
  Upload,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────
// Categories — mirror AccountingTab so Jeff's overrides flow into the same
// P&L bucket. Kept in-file to avoid churning AccountingTab's exports.
// ────────────────────────────────────────────────────────────────────────

const INCOME_CATEGORY_KEYS: Record<string, string> = {
  tour_booking: "catTourBooking",
  visa_service: "catVisaService",
  affiliate_commission: "catAffiliateCommission",
  flight_booking: "catFlightBooking",
  hotel_booking: "catHotelBooking",
  other_income: "catOtherIncome",
};

const EXPENSE_CATEGORY_KEYS: Record<string, string> = {
  rent: "catRent",
  utilities: "catUtilities",
  salary: "catSalary",
  marketing: "catMarketing",
  travel_cost: "catTravelCost",
  supplier_payment: "catSupplierPayment",
  office_supplies: "catOfficeSupplies",
  software: "catSoftware",
  insurance: "catInsurance",
  tax_payment: "catTaxPayment",
  bank_fee: "catBankFee",
  stripe_fee: "catStripeFee",
  consulate_fee: "catConsulateFee",
  other_expense: "catOtherExpense",
};

const CUSTOM_VALUE = "__custom__";

// ────────────────────────────────────────────────────────────────────────
// Types — mirror plaidRouter.transactionsList output (loose; backend is
// the source of truth, this just gives the table sane intellisense).
// ────────────────────────────────────────────────────────────────────────

type TxRow = {
  id: number;
  linkedAccountId: number;
  date: string | Date;
  authorizedDate?: string | Date | null;
  amount: string | number; // Drizzle decimal returns string
  isoCurrencyCode?: string | null;
  merchantName?: string | null;
  description?: string | null;
  plaidCategoryPrimary?: string | null;
  plaidCategoryDetailed?: string | null;
  agentCategory?: string | null;
  agentConfidence?: number | null;
  agentReasoning?: string | null;
  jeffOverrideCategory?: string | null;
  jeffOverrideReason?: string | null;
  excludeFromAccounting?: number | null;
  excludeReason?: string | null;
  isPending?: number | null;
  accountOwner?: string | null;
  relatedBookingId?: number | null;
  relatedInquiryId?: number | null;
  // IRS Schedule C-grade fields (migration 0080, 2026-05-22)
  counterparty?: string | null;
  counterpartyType?: string | null;
  purposeNote?: string | null;
  receiptUrl?: string | null;
};

// IRS counterparty taxonomy — must match server/agents/autonomous/accountingAgent.ts
const COUNTERPARTY_TYPES = [
  "vendor",
  "customer",
  "owner",
  "employee",
  "refund",
  "transfer",
  "tax",
  "other",
] as const;
type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

type FilterTab = "all" | "uncategorized" | "categorized" | "excluded";

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

function toNumber(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  return typeof amount === "number" ? amount : Number(amount);
}

function isOutflow(tx: TxRow): boolean {
  return toNumber(tx.amount) > 0;
}

function effectiveCategory(tx: TxRow): string | null {
  return tx.jeffOverrideCategory ?? tx.agentCategory ?? null;
}

function isExcluded(tx: TxRow): boolean {
  return (tx.excludeFromAccounting ?? 0) === 1;
}

function isUncategorized(tx: TxRow): boolean {
  return !tx.jeffOverrideCategory && !tx.agentCategory;
}

// ────────────────────────────────────────────────────────────────────────
// Filter pill (matches BookingsTabV2 pattern)
// ────────────────────────────────────────────────────────────────────────

function StatusToggle({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: StatusTone;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`h-7 px-2.5 rounded-md text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
      }`}
    >
      {tone && !active && <StatusDot tone={tone} size="xs" />}
      <span>{label}</span>
      <span className={`tabular-nums ${active ? "text-white/70" : "text-gray-400"}`}>
        {count}
      </span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

export default function BankLedgerV2() {
  const { t, language } = useLocale();
  const dateLocale = language === "en" ? "en-US" : "zh-TW";

  const [tab, setTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const initialRange = thisMonthRange();
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.plaid.transactionsList.useQuery({
    dateFrom,
    dateTo,
    includeExcluded: true, // we filter client-side so the "已排除" tab works
    limit: 200,
    offset: 0,
  });

  const rawItems = (data?.items ?? []) as TxRow[];

  const counts = useMemo(() => {
    return {
      all: rawItems.length,
      uncategorized: rawItems.filter((tx) => isUncategorized(tx) && !isExcluded(tx)).length,
      categorized: rawItems.filter((tx) => !isUncategorized(tx) && !isExcluded(tx)).length,
      excluded: rawItems.filter(isExcluded).length,
    };
  }, [rawItems]);

  const filtered = useMemo(() => {
    let list = rawItems;
    if (tab === "uncategorized") {
      list = list.filter((tx) => isUncategorized(tx) && !isExcluded(tx));
    } else if (tab === "categorized") {
      list = list.filter((tx) => !isUncategorized(tx) && !isExcluded(tx));
    } else if (tab === "excluded") {
      list = list.filter(isExcluded);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((tx) =>
        (tx.merchantName ?? "").toLowerCase().includes(q) ||
        (tx.description ?? "").toLowerCase().includes(q) ||
        String(toNumber(tx.amount)).includes(q),
      );
    }
    return list;
  }, [rawItems, tab, searchQuery]);

  const selected = useMemo(
    () => (selectedId !== null ? rawItems.find((tx) => tx.id === selectedId) ?? null : null),
    [selectedId, rawItems],
  );

  const updateMutation = trpc.plaid.transactionUpdate.useMutation({
    onSuccess: () => {
      utils.plaid.transactionsList.invalidate();
      toast.success(t("admin.bankLedgerTab.toastSaved"));
    },
    onError: (e) =>
      toast.error(t("admin.bankLedgerTab.toastSaveFailed", { err: e.message })),
  });

  // 2026-05-22 — Run AccountingAgent on uncategorized transactions. Server
  // pulls all transactions where agentCategory IS NULL AND jeffOverrideCategory
  // IS NULL, hits the LLM, writes agentCategory/agentConfidence/agentReasoning
  // back to the row. Batch size 50 per call to stay under timeout.
  const classifyBatchMutation = trpc.plaid.classifyBatch.useMutation({
    onSuccess: (res) => {
      utils.plaid.transactionsList.invalidate();
      const succ = (res as any)?.succeeded ?? 0;
      const failed = (res as any)?.failed ?? 0;
      const needsReview = (res as any)?.needsReviewCount ?? 0;
      toast.success(
        t("admin.bankLedgerTab.toastClassifyDone", {
          succ: String(succ),
          failed: String(failed),
          review: String(needsReview),
        }),
      );
    },
    onError: (e) =>
      toast.error(t("admin.bankLedgerTab.toastClassifyFailed", { err: e.message })),
  });

  const formatDate = (d: string | Date | null | undefined): string => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(dateLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatMoney = (amount: string | number | null | undefined, currency?: string | null): string => {
    const n = toNumber(amount);
    const cur = (currency || "USD").toUpperCase();
    const symbol = cur === "USD" ? "$" : cur === "TWD" ? "NT$" : cur + " ";
    // Plaid: positive = outflow (display as negative-looking), negative = inflow.
    // We render the sign explicitly so it's never ambiguous.
    const sign = n > 0 ? "-" : n < 0 ? "+" : "";
    const abs = Math.abs(n);
    return `${sign}${symbol}${abs.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const categoryLabel = (key: string | null | undefined): string => {
    if (!key) return "—";
    const i18nKey = INCOME_CATEGORY_KEYS[key] || EXPENSE_CATEGORY_KEYS[key];
    if (i18nKey) return t(`admin.accounting.${i18nKey}`);
    return key; // custom override label flows through as-is
  };

  // ── Columns ───────────────────────────────────────────────────────────
  const columns: Column<TxRow>[] = [
    {
      key: "date",
      header: t("admin.bankLedgerTab.columnDate"),
      width: "w-28",
      sortable: true,
      sortValue: (tx) => new Date(tx.date).getTime(),
      render: (tx) => (
        <span className="text-gray-700 tabular-nums">{formatDate(tx.date)}</span>
      ),
    },
    {
      key: "merchant",
      header: t("admin.bankLedgerTab.columnMerchant"),
      sortable: true,
      sortValue: (tx) => tx.merchantName ?? "",
      render: (tx) => (
        <div className="min-w-0">
          <div className="text-gray-900 truncate font-medium">
            {tx.merchantName || t("admin.bankLedgerTab.unknownMerchant")}
          </div>
          {tx.description && (
            <div className="text-[11px] text-gray-500 truncate">{tx.description}</div>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: t("admin.bankLedgerTab.columnCategory"),
      width: "w-36",
      render: (tx) => {
        const cat = effectiveCategory(tx);
        if (cat) {
          return <span className="text-xs text-gray-700">{categoryLabel(cat)}</span>;
        }
        if (tx.plaidCategoryPrimary) {
          return (
            <span className="text-[11px] text-gray-400 italic">
              {tx.plaidCategoryPrimary}
            </span>
          );
        }
        return <span className="text-gray-300">—</span>;
      },
    },
    {
      key: "amount",
      header: t("admin.bankLedgerTab.columnAmount"),
      width: "w-32",
      align: "right",
      sortable: true,
      sortValue: (tx) => toNumber(tx.amount),
      render: (tx) => (
        <span
          className={`tabular-nums font-medium ${
            isOutflow(tx) ? "text-red-600" : "text-green-600"
          }`}
        >
          {formatMoney(tx.amount, tx.isoCurrencyCode)}
        </span>
      ),
    },
    {
      key: "source",
      header: t("admin.bankLedgerTab.columnSource"),
      width: "w-32",
      render: (tx) => {
        if (tx.jeffOverrideCategory) {
          return (
            <StatusDot tone="warn" label={t("admin.bankLedgerTab.sourceJeff")} />
          );
        }
        if (tx.agentCategory) {
          return (
            <StatusDot tone="info" label={t("admin.bankLedgerTab.sourceAI")} />
          );
        }
        if (tx.plaidCategoryPrimary) {
          return (
            <StatusDot tone="muted" label={t("admin.bankLedgerTab.sourcePlaid")} />
          );
        }
        return (
          <StatusDot tone="warn" label={t("admin.bankLedgerTab.sourceUncat")} />
        );
      },
    },
    {
      key: "excluded",
      header: "",
      width: "w-20",
      render: (tx) =>
        isExcluded(tx) ? (
          <Badge variant="outline" className="rounded-md text-[10px] h-5 px-1.5 border-gray-300 text-gray-600">
            {t("admin.bankLedgerTab.excludedBadge")}
          </Badge>
        ) : null,
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Header: filter pills + date range + search + refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusToggle
            label={t("admin.bankLedgerTab.tabAll")}
            count={counts.all}
            active={tab === "all"}
            onClick={() => setTab("all")}
          />
          <StatusToggle
            label={t("admin.bankLedgerTab.tabUncategorized")}
            count={counts.uncategorized}
            active={tab === "uncategorized"}
            tone="warn"
            onClick={() => setTab("uncategorized")}
          />
          <StatusToggle
            label={t("admin.bankLedgerTab.tabCategorized")}
            count={counts.categorized}
            active={tab === "categorized"}
            tone="success"
            onClick={() => setTab("categorized")}
          />
          <StatusToggle
            label={t("admin.bankLedgerTab.tabExcluded")}
            count={counts.excluded}
            active={tab === "excluded"}
            tone="muted"
            onClick={() => setTab("excluded")}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 rounded-lg text-xs w-36"
              aria-label={t("admin.bankLedgerTab.dateFrom")}
            />
            <span className="text-gray-400 text-xs">→</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 rounded-lg text-xs w-36"
              aria-label={t("admin.bankLedgerTab.dateTo")}
            />
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("admin.bankLedgerTab.searchPlaceholder")}
              className="h-8 rounded-lg pl-8 text-xs w-56"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label={t("common.clear")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-8 rounded-lg gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("common.refresh")}
          </Button>
          {/* CSV import — 2025 BofA history (Plaid only retains ~90 days) */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCsvImportOpen(true)}
            className="h-8 rounded-lg gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" />
            {t("admin.bankLedgerTab.csvImportButtonLabel")}
          </Button>
          {/* AI classify — pulls uncategorized batch through accountingAgentService */}
          <Button
            size="sm"
            disabled={classifyBatchMutation.isPending}
            onClick={() => {
              if (!confirm(t("admin.bankLedgerTab.confirmClassify"))) return;
              classifyBatchMutation.mutate({ limit: 50 });
            }}
            className="h-8 rounded-lg gap-1.5 bg-[#c9a563] hover:bg-[#b8924d] text-white"
          >
            {classifyBatchMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t("admin.bankLedgerTab.classifyButton")}
          </Button>
        </div>
      </div>
      <CsvImportDialog
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onComplete={() => {
          utils.plaid.transactionsList.invalidate();
          utils.plaid.financeKpi.invalidate();
        }}
      />

      {/* Table */}
      {!isLoading && filtered.length === 0 ? (
        <EmptyState
          icon={<Landmark className="h-8 w-8" />}
          title={t("admin.bankLedgerTab.emptyTitle")}
          description={t("admin.bankLedgerTab.emptyDesc")}
        />
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(tx) => {
            setSelectedId(tx.id);
            setDrawerOpen(true);
          }}
          selectedId={selectedId ?? undefined}
        />
      )}

      {/* Detail drawer */}
      <BankTxDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setSelectedId(null);
        }}
        tx={selected}
        formatDate={formatDate}
        formatMoney={formatMoney}
        categoryLabel={categoryLabel}
        savePending={updateMutation.isPending}
        onSave={(patch) =>
          selected &&
          updateMutation.mutate(
            { transactionId: selected.id, ...patch },
            {
              onSuccess: () => {
                setDrawerOpen(false);
                setSelectedId(null);
              },
            },
          )
        }
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Drawer — read-only sections (Plaid + AI) + editable override form
// ────────────────────────────────────────────────────────────────────────

type DrawerSavePatch = {
  category?: string;
  reason?: string;
  exclude?: boolean;
  relatedBookingId?: number;
  // IRS Schedule C-grade fields (2026-05-22). null = clear, undefined = leave.
  counterparty?: string | null;
  counterpartyType?: CounterpartyType | null;
  purposeNote?: string | null;
  receiptUrl?: string | null;
};

function BankTxDrawer({
  open,
  onOpenChange,
  tx,
  formatDate,
  formatMoney,
  categoryLabel,
  savePending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tx: TxRow | null;
  formatDate: (d: string | Date | null | undefined) => string;
  formatMoney: (amount: string | number | null | undefined, currency?: string | null) => string;
  categoryLabel: (key: string | null | undefined) => string;
  savePending: boolean;
  onSave: (patch: DrawerSavePatch) => void;
}) {
  // Local form state — initialised from the row each time the drawer opens
  const initialCategory = tx?.jeffOverrideCategory ?? "";
  const isKnownCategory =
    initialCategory in INCOME_CATEGORY_KEYS ||
    initialCategory in EXPENSE_CATEGORY_KEYS;

  const [categoryDropdown, setCategoryDropdown] = useState<string>(
    !initialCategory ? "" : isKnownCategory ? initialCategory : CUSTOM_VALUE,
  );
  const [customCategory, setCustomCategory] = useState<string>(
    !initialCategory ? "" : isKnownCategory ? "" : initialCategory,
  );
  const [reason, setReason] = useState<string>(tx?.jeffOverrideReason ?? "");
  const [bookingId, setBookingId] = useState<string>(
    tx?.relatedBookingId ? String(tx.relatedBookingId) : "",
  );
  const [exclude, setExclude] = useState<boolean>(
    (tx?.excludeFromAccounting ?? 0) === 1,
  );
  // IRS Schedule C-grade per-transaction fields (2026-05-22 migration 0080).
  // counterparty / counterpartyType / purposeNote are AI-pre-filled when the
  // AccountingAgent classifies; Jeff edits + confirms in the drawer. Receipt
  // is optional R2 upload (PDF / image). Audit log captures every change.
  const [counterparty, setCounterparty] = useState<string>(tx?.counterparty ?? "");
  const [counterpartyType, setCounterpartyType] = useState<string>(
    tx?.counterpartyType ?? "",
  );
  const [purposeNote, setPurposeNote] = useState<string>(tx?.purposeNote ?? "");
  const [receiptUrl, setReceiptUrl] = useState<string>(tx?.receiptUrl ?? "");

  // Reset form when row changes (drawer reopens with a new tx)
  // We key on tx?.id so React resets state for us.
  const formKey = tx?.id ?? "none";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full xl:max-w-5xl xl:rounded-l-xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-gray-100">
          <SheetTitle className="text-base flex items-center gap-2">
            <span className="text-gray-500 tabular-nums font-normal">
              #{tx?.id ?? ""}
            </span>
            <span>{tx ? formatDate(tx.date) : ""}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            {tx?.merchantName ?? ""}
          </SheetDescription>
        </SheetHeader>

        {tx && (
          <BankTxDrawerForm
            key={formKey}
            tx={tx}
            formatMoney={formatMoney}
            categoryLabel={categoryLabel}
            categoryDropdown={categoryDropdown}
            setCategoryDropdown={setCategoryDropdown}
            customCategory={customCategory}
            setCustomCategory={setCustomCategory}
            reason={reason}
            setReason={setReason}
            bookingId={bookingId}
            setBookingId={setBookingId}
            exclude={exclude}
            setExclude={setExclude}
            counterparty={counterparty}
            setCounterparty={setCounterparty}
            counterpartyType={counterpartyType}
            setCounterpartyType={setCounterpartyType}
            purposeNote={purposeNote}
            setPurposeNote={setPurposeNote}
            receiptUrl={receiptUrl}
            setReceiptUrl={setReceiptUrl}
            savePending={savePending}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// Inner form component — separate so `key={tx.id}` cleanly resets all
// local state when the user opens a different row.
function BankTxDrawerForm({
  tx,
  formatMoney,
  categoryLabel,
  categoryDropdown,
  setCategoryDropdown,
  customCategory,
  setCustomCategory,
  reason,
  setReason,
  bookingId,
  setBookingId,
  exclude,
  setExclude,
  counterparty,
  setCounterparty,
  counterpartyType,
  setCounterpartyType,
  purposeNote,
  setPurposeNote,
  receiptUrl,
  setReceiptUrl,
  savePending,
  onSave,
  onCancel,
}: {
  tx: TxRow;
  formatMoney: (amount: string | number | null | undefined, currency?: string | null) => string;
  categoryLabel: (key: string | null | undefined) => string;
  categoryDropdown: string;
  setCategoryDropdown: (v: string) => void;
  customCategory: string;
  setCustomCategory: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  bookingId: string;
  setBookingId: (v: string) => void;
  exclude: boolean;
  setExclude: (v: boolean) => void;
  counterparty: string;
  setCounterparty: (v: string) => void;
  counterpartyType: string;
  setCounterpartyType: (v: string) => void;
  purposeNote: string;
  setPurposeNote: (v: string) => void;
  receiptUrl: string;
  setReceiptUrl: (v: string) => void;
  savePending: boolean;
  onSave: (patch: DrawerSavePatch) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();

  const finalCategory =
    categoryDropdown === CUSTOM_VALUE
      ? customCategory.trim()
      : categoryDropdown;

  // Track which fields the user actually changed vs initial. Without this,
  // Save would always send `category: ""` and clobber an AI-assigned override
  // whenever Jeff opens a row just to add purposeNote/counterparty.
  // Audit-log task #39 (2026-05-22).
  const initialCategoryRaw = tx?.jeffOverrideCategory ?? "";
  const initialCounterparty = tx?.counterparty ?? "";
  const initialCounterpartyType = tx?.counterpartyType ?? "";
  const initialPurposeNote = tx?.purposeNote ?? "";
  const initialReceiptUrl = tx?.receiptUrl ?? "";
  const initialReason = tx?.jeffOverrideReason ?? "";
  const initialBookingId = tx?.relatedBookingId ? String(tx.relatedBookingId) : "";
  const initialExclude = (tx?.excludeFromAccounting ?? 0) === 1;

  const handleSave = () => {
    const patch: DrawerSavePatch = {};

    // Only include category/reason if Jeff actually touched them.
    // (Pre-existing bug fix: drawer used to always send these even when
    // unchanged, wiping any prior Jeff override on every save.)
    if (finalCategory !== initialCategoryRaw) {
      patch.category = finalCategory;
    }
    if (reason.trim() !== initialReason.trim()) {
      patch.reason = reason.trim();
    }
    if (exclude !== initialExclude) {
      patch.exclude = exclude;
    }
    if (bookingId.trim() !== initialBookingId) {
      const parsed = bookingId.trim() ? Number(bookingId.trim()) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        patch.relatedBookingId = parsed;
      }
    }

    // IRS Schedule C-grade fields — null when cleared (so server unsets),
    // string when populated. Only send if changed.
    if (counterparty.trim() !== initialCounterparty.trim()) {
      patch.counterparty = counterparty.trim() || null;
    }
    if (counterpartyType !== initialCounterpartyType) {
      patch.counterpartyType =
        counterpartyType &&
        (COUNTERPARTY_TYPES as readonly string[]).includes(counterpartyType)
          ? (counterpartyType as CounterpartyType)
          : null;
    }
    if (purposeNote.trim() !== initialPurposeNote.trim()) {
      patch.purposeNote = purposeNote.trim() || null;
    }
    if (receiptUrl.trim() !== initialReceiptUrl.trim()) {
      patch.receiptUrl = receiptUrl.trim() || null;
    }

    onSave(patch);
  };

  const handleClearOverride = () => {
    setCategoryDropdown("");
    setCustomCategory("");
    setReason("");
    onSave({ category: "", reason: "" });
  };

  const handleClearBooking = () => setBookingId("");

  return (
    <div className="space-y-5 py-4">
      {/* Original (Plaid) */}
      <div className="space-y-2">
        <SectionTitle>{t("admin.bankLedgerTab.sectionOriginal")}</SectionTitle>
        <Field label={t("admin.bankLedgerTab.fieldMerchant")}>
          {tx.merchantName || t("admin.bankLedgerTab.unknownMerchant")}
        </Field>
        {tx.description && (
          <Field label={t("admin.bankLedgerTab.fieldDescription")}>
            <span className="break-words">{tx.description}</span>
          </Field>
        )}
        <Field label={t("admin.bankLedgerTab.fieldAmount")}>
          <span
            className={`font-semibold tabular-nums ${
              toNumber(tx.amount) > 0 ? "text-red-600" : "text-green-600"
            }`}
          >
            {formatMoney(tx.amount, tx.isoCurrencyCode)}
          </span>
        </Field>
        <Field label={t("admin.bankLedgerTab.fieldCurrency")}>
          {tx.isoCurrencyCode || "USD"}
        </Field>
        {tx.plaidCategoryPrimary && (
          <Field label={t("admin.bankLedgerTab.fieldPlaidCategory")}>
            {tx.plaidCategoryDetailed
              ? `${tx.plaidCategoryPrimary} · ${tx.plaidCategoryDetailed}`
              : tx.plaidCategoryPrimary}
          </Field>
        )}
        {tx.accountOwner && (
          <Field label={t("admin.bankLedgerTab.fieldAccountOwner")}>
            {tx.accountOwner}
          </Field>
        )}
      </div>

      {/* AI categorisation */}
      {tx.agentCategory && (
        <div className="space-y-2">
          <SectionTitle>{t("admin.bankLedgerTab.sectionAI")}</SectionTitle>
          <Field label={t("admin.bankLedgerTab.fieldAgentCategory")}>
            {categoryLabel(tx.agentCategory)}
          </Field>
          {typeof tx.agentConfidence === "number" && (
            <Field label={t("admin.bankLedgerTab.fieldConfidence")}>
              <span className="tabular-nums">{tx.agentConfidence}%</span>
            </Field>
          )}
          {tx.agentReasoning && (
            <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3">
              {tx.agentReasoning}
            </div>
          )}
        </div>
      )}

      {/* Override form */}
      <div className="space-y-4">
        <SectionTitle>{t("admin.bankLedgerTab.sectionOverride")}</SectionTitle>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700">
            {t("admin.bankLedgerTab.fieldCategory")}
          </Label>
          <Select
            value={categoryDropdown}
            onValueChange={(v) => setCategoryDropdown(v)}
          >
            <SelectTrigger className="h-10 rounded-lg text-sm">
              <SelectValue placeholder={t("admin.bankLedgerTab.categoryPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel className="text-xs uppercase tracking-wider">
                  {t("admin.bankLedgerTab.groupIncome")}
                </SelectLabel>
                {Object.keys(INCOME_CATEGORY_KEYS).map((k) => (
                  <SelectItem key={k} value={k}>
                    {categoryLabel(k)}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel className="text-xs uppercase tracking-wider">
                  {t("admin.bankLedgerTab.groupExpense")}
                </SelectLabel>
                {Object.keys(EXPENSE_CATEGORY_KEYS).map((k) => (
                  <SelectItem key={k} value={k}>
                    {categoryLabel(k)}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel className="text-xs uppercase tracking-wider">
                  {t("admin.bankLedgerTab.groupCustom")}
                </SelectLabel>
                <SelectItem value={CUSTOM_VALUE}>
                  {t("admin.bankLedgerTab.customCategoryOption")}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {categoryDropdown === CUSTOM_VALUE && (
            <Input
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder={t("admin.bankLedgerTab.customCategoryPlaceholder")}
              className="h-10 rounded-lg text-sm"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700">
            {t("admin.bankLedgerTab.fieldReason")}
          </Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("admin.bankLedgerTab.reasonPlaceholder")}
            className="rounded-lg text-sm min-h-[72px]"
            rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700">
            {t("admin.bankLedgerTab.fieldBookingId")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              placeholder={t("admin.bankLedgerTab.bookingIdPlaceholder")}
              className="h-10 rounded-lg text-sm"
            />
            {bookingId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearBooking}
                className="h-8 rounded-lg px-2"
                aria-label={t("common.clear")}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="space-y-0.5">
            <Label
              htmlFor="bank-tx-exclude"
              className="text-sm text-gray-700 font-medium cursor-pointer"
            >
              {t("admin.bankLedgerTab.fieldExclude")}
            </Label>
            <p className="text-xs text-gray-500 leading-relaxed">
              {t("admin.bankLedgerTab.excludeHint")}
            </p>
          </div>
          <Switch
            id="bank-tx-exclude"
            checked={exclude}
            onCheckedChange={setExclude}
          />
        </div>
      </div>

      {/* IRS Schedule C-grade documentation (migration 0080, 2026-05-22)
          AI pre-fills counterparty + counterpartyType + purposeNote during
          classifyBatch. Jeff confirms or edits here. Receipt upload optional
          (IRS Rev. Proc. 2017-30: required for expenses >= $75). */}
      <IRSDocumentationSection
        txId={tx.id}
        counterparty={counterparty}
        setCounterparty={setCounterparty}
        counterpartyType={counterpartyType}
        setCounterpartyType={setCounterpartyType}
        purposeNote={purposeNote}
        setPurposeNote={setPurposeNote}
        receiptUrl={receiptUrl}
        setReceiptUrl={setReceiptUrl}
      />

      {/* Audit trail — every change to this transaction (category, override,
          purpose, etc.) by every admin, newest first. Source: adminAuditLog. */}
      <ChangeHistorySection txId={tx.id} />

      {/* Footer actions */}
      <div className="pt-3 border-t border-gray-100 flex items-center gap-2">
        {(tx.jeffOverrideCategory || tx.jeffOverrideReason) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearOverride}
            className="h-8 rounded-lg text-xs text-gray-500"
            disabled={savePending}
          >
            {t("admin.bankLedgerTab.clearOverride")}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="ml-auto h-8 rounded-lg gap-1"
          disabled={savePending}
        >
          <X className="h-3.5 w-3.5" />
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={savePending}
          className="h-8 rounded-lg gap-1.5"
        >
          {savePending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-[0.18em] text-gray-500 font-semibold">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 text-right break-words max-w-[60%]">
        {children}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// IRS Schedule C-grade documentation section (migration 0080, 2026-05-22)
// ────────────────────────────────────────────────────────────────────────

function IRSDocumentationSection({
  txId,
  counterparty,
  setCounterparty,
  counterpartyType,
  setCounterpartyType,
  purposeNote,
  setPurposeNote,
  receiptUrl,
  setReceiptUrl,
}: {
  txId: number;
  counterparty: string;
  setCounterparty: (v: string) => void;
  counterpartyType: string;
  setCounterpartyType: (v: string) => void;
  purposeNote: string;
  setPurposeNote: (v: string) => void;
  receiptUrl: string;
  setReceiptUrl: (v: string) => void;
}) {
  const { t } = useLocale();
  const [uploading, setUploading] = useState(false);
  const uploadMutation = trpc.plaid.receiptUpload.useMutation();

  // Counterparty type → IRS-meaningful colour cue. vendor/customer/owner are
  // the high-frequency ones; tax/refund/transfer are distinct enough to merit
  // their own visual treatment.
  const typeStyles: Record<string, string> = {
    vendor: "bg-blue-50 text-blue-700 border-blue-200",
    customer: "bg-green-50 text-green-700 border-green-200",
    owner: "bg-purple-50 text-purple-700 border-purple-200",
    employee: "bg-cyan-50 text-cyan-700 border-cyan-200",
    refund: "bg-amber-50 text-amber-700 border-amber-200",
    transfer: "bg-gray-50 text-gray-700 border-gray-200",
    tax: "bg-rose-50 text-rose-700 border-rose-200",
    other: "bg-gray-50 text-gray-700 border-gray-200",
  };

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("admin.bankLedgerTab.toastReceiptTooLarge"));
      return;
    }
    setUploading(true);
    try {
      // Read as base64
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      // Validate content type — server enum is the source of truth.
      const allowed = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
      ] as const;
      const ct = file.type || "application/octet-stream";
      if (!(allowed as readonly string[]).includes(ct)) {
        toast.error(t("admin.bankLedgerTab.toastReceiptBadType"));
        setUploading(false);
        return;
      }
      const res = await uploadMutation.mutateAsync({
        transactionId: txId,
        contentType: ct as (typeof allowed)[number],
        base64Data: dataUrl,
        originalFilename: file.name,
      });
      setReceiptUrl(res.url);
      toast.success(t("admin.bankLedgerTab.toastReceiptUploaded"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("admin.bankLedgerTab.toastReceiptUploadFailed", { err: msg }));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle>{t("admin.bankLedgerTab.sectionIRS")}</SectionTitle>

      {/* Counterparty (誰) */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-gray-700">
          {t("admin.bankLedgerTab.fieldCounterparty")}
        </Label>
        <Input
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder={t("admin.bankLedgerTab.counterpartyPlaceholder")}
          maxLength={255}
          className="h-10 rounded-lg text-sm"
        />
      </div>

      {/* Counterparty type */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-gray-700">
          {t("admin.bankLedgerTab.fieldCounterpartyType")}
        </Label>
        <div className="flex flex-wrap gap-2">
          {COUNTERPARTY_TYPES.map((typ) => {
            const active = counterpartyType === typ;
            const styles = typeStyles[typ] ?? "bg-gray-50 text-gray-700 border-gray-200";
            return (
              <button
                key={typ}
                type="button"
                onClick={() => setCounterpartyType(active ? "" : typ)}
                className={`text-xs font-medium uppercase tracking-wider px-3 py-1.5 rounded-md border transition-colors ${
                  active ? styles : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {t(`admin.bankLedgerTab.counterpartyType_${typ}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Purpose note (為什麼) */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-gray-700">
          {t("admin.bankLedgerTab.fieldPurposeNote")}
        </Label>
        <Textarea
          value={purposeNote}
          onChange={(e) => setPurposeNote(e.target.value)}
          placeholder={t("admin.bankLedgerTab.purposeNotePlaceholder")}
          maxLength={2000}
          className="rounded-lg text-sm min-h-[80px]"
          rows={3}
        />
      </div>

      {/* Receipt upload */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-gray-700">
          {t("admin.bankLedgerTab.fieldReceipt")}
        </Label>
        {receiptUrl ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <a
              href={receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-teal-700 underline truncate flex-1"
            >
              {t("admin.bankLedgerTab.viewReceipt")}
            </a>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setReceiptUrl("")}
              className="h-8 rounded-md px-2 text-sm text-gray-500"
              aria-label={t("common.clear")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-5 text-sm text-gray-500 hover:bg-gray-50 cursor-pointer">
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("admin.bankLedgerTab.uploadingReceipt")}
              </>
            ) : (
              t("admin.bankLedgerTab.uploadReceiptHint")
            )}
          </label>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Change history (adminAuditLog entries) — migration 0080 audit trail
// ────────────────────────────────────────────────────────────────────────

function ChangeHistorySection({ txId }: { txId: number }) {
  const { t, language } = useLocale();
  const dateLocale = language === "en" ? "en-US" : "zh-TW";
  const { data, isLoading } = trpc.plaid.transactionAuditHistory.useQuery(
    { transactionId: txId },
    { staleTime: 30_000 },
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        <SectionTitle>{t("admin.bankLedgerTab.sectionHistory")}</SectionTitle>
        <div className="text-[10px] text-gray-400">
          {t("admin.bankLedgerTab.loadingHistory")}
        </div>
      </div>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <SectionTitle>{t("admin.bankLedgerTab.sectionHistory")}</SectionTitle>
        <div className="text-xs text-gray-400 italic">
          {t("admin.bankLedgerTab.emptyHistory")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SectionTitle>{t("admin.bankLedgerTab.sectionHistory")}</SectionTitle>
      <ul className="space-y-2">
        {rows.map((row) => {
          const ts = row.createdAt
            ? new Date(row.createdAt as any).toLocaleString(dateLocale, {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—";
          const changes = (row.changes as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null) ?? null;
          const fields = changes?.after ? Object.keys(changes.after) : [];
          return (
            <li
              key={row.id}
              className="text-xs text-gray-700 border-l-2 border-gray-200 pl-3 py-1"
            >
              <div className="flex items-baseline gap-2">
                <span className="tabular-nums text-gray-400">{ts}</span>
                <span className="font-medium text-gray-800">{row.userEmail}</span>
              </div>
              {fields.length > 0 && (
                <div className="mt-1 text-gray-600 break-all leading-relaxed">
                  {fields
                    .map((f) => {
                      const before = changes?.before?.[f];
                      const after = changes?.after?.[f];
                      return `${f}: ${formatHistoryValue(before)} → ${formatHistoryValue(after)}`;
                    })
                    .join(" · ")}
                </div>
              )}
              {row.reason && (
                <div className="mt-1 italic text-gray-500">{`"${row.reason}"`}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatHistoryValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    return v.length > 40 ? `${v.slice(0, 37)}...` : v;
  }
  return String(v);
}

// ────────────────────────────────────────────────────────────────────────
// CSV import dialog — 2026-05-23 (Plaid only retains ~90 days BofA history,
// so 2025 data comes from BofA online banking CSV download)
// ────────────────────────────────────────────────────────────────────────

function CsvImportDialog({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { t } = useLocale();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [preview, setPreview] = useState<any | null>(null);

  const accounts = trpc.plaid.linkedAccountsList.useQuery();
  const importMut = trpc.plaid.csvImport.useMutation({
    onError: (e) => toast.error(t("admin.bankLedgerTab.csvImportToastFail", { err: e.message })),
  });

  const handleFile = (file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    if (!selectedAccountId || !csvText) {
      toast.error(t("admin.bankLedgerTab.csvImportToastSelectFirst"));
      return;
    }
    const r = await importMut.mutateAsync({
      linkedAccountId: selectedAccountId,
      csvText,
      dryRun: true,
    });
    setPreview(r);
  };

  const handleCommit = async () => {
    if (!selectedAccountId || !csvText) return;
    const r = await importMut.mutateAsync({
      linkedAccountId: selectedAccountId,
      csvText,
      dryRun: false,
    });
    toast.success(t("admin.bankLedgerTab.csvImportToastSuccess", { count: r.upserted ?? 0, format: r.format ?? "" }));
    onComplete();
    onClose();
    setCsvText("");
    setFilename("");
    setPreview(null);
    setSelectedAccountId(null);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t("admin.bankLedgerTab.csvImportTitle")}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-900 leading-relaxed">
            <strong>{t("admin.bankLedgerTab.csvImportHowTo")}</strong>
            <ol className="list-decimal ml-4 mt-1 space-y-0.5">
              <li>{t("admin.bankLedgerTab.csvImportStep1")}</li>
              <li>{t("admin.bankLedgerTab.csvImportStep2")}</li>
              <li>{t("admin.bankLedgerTab.csvImportStep3")}</li>
              <li>{t("admin.bankLedgerTab.csvImportStep4")}</li>
            </ol>
          </div>

          <div>
            <Label className="text-sm font-medium">{t("admin.bankLedgerTab.csvImportSelectAccount")}</Label>
            <Select
              value={selectedAccountId?.toString() ?? ""}
              onValueChange={(v) => setSelectedAccountId(Number(v))}
            >
              <SelectTrigger className="h-10 rounded-lg mt-1.5">
                <SelectValue placeholder={t("admin.bankLedgerTab.csvImportSelectAccountPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {(accounts.data ?? []).map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.accountName} (#{a.accountMask})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium">{t("admin.bankLedgerTab.csvImportUploadCsv")}</Label>
            <div className="mt-1.5">
              <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>{filename || t("admin.bankLedgerTab.csvImportChooseFile")}</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
            </div>
          </div>

          {csvText && selectedAccountId && !preview && (
            <Button
              onClick={handlePreview}
              disabled={importMut.isPending}
              className="w-full h-10 rounded-lg"
            >
              {importMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {t("admin.bankLedgerTab.csvImportPreviewButton")}
            </Button>
          )}

          {preview && (
            <div className="rounded-lg border border-gray-200 p-3 bg-gray-50 space-y-2">
              <div className="text-sm font-semibold text-gray-900">
                {t("admin.bankLedgerTab.csvImportPreviewTitle")}
              </div>
              <div className="text-xs text-gray-700 space-y-1">
                <div>{t("admin.bankLedgerTab.csvImportFormat", { format: preview.format })}</div>
                <div>{t("admin.bankLedgerTab.csvImportParsedCount", { count: preview.parsedCount })}</div>
                <div>
                  {t("admin.bankLedgerTab.csvImportDateRange", { min: preview.dateMin, max: preview.dateMax })}
                </div>
                {preview.warnings?.length > 0 && (
                  <div className="text-amber-700">
                    ⚠️ {t("admin.bankLedgerTab.csvImportWarnings", { count: preview.warnings.length })}:
                    {preview.warnings.slice(0, 3).map((w: string, i: number) => (
                      <div key={i} className="text-[10px] ml-2">{w}</div>
                    ))}
                  </div>
                )}
              </div>
              {preview.sample?.length > 0 && (
                <div className="text-[10px] text-gray-600 mt-2">
                  <div className="font-semibold mb-1">{t("admin.bankLedgerTab.csvImportSampleTitle")}</div>
                  {preview.sample.map((s: any, i: number) => (
                    <div key={i} className="tabular-nums">
                      {s.date} · ${s.amount} · {s.description}
                    </div>
                  ))}
                </div>
              )}
              <Button
                onClick={handleCommit}
                disabled={importMut.isPending || preview.parsedCount === 0}
                className="w-full h-10 rounded-lg bg-teal-600 hover:bg-teal-700"
              >
                {importMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {t("admin.bankLedgerTab.csvImportCommitButton", { count: preview.parsedCount })}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
